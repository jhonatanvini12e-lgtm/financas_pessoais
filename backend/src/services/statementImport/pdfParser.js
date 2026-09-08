import { PDFParse } from 'pdf-parse';
import { normalizeDate, parseAmount, extractInstallmentInfo, resolveInstallmentDate } from './columnMapper.js';

// Extratos de cartao em PDF nao tem estrutura tabular (ao contrario de
// CSV/XLSX), entao nao da pra usar a mesma heuristica de colunas. Em vez
// disso extraimos o texto bruto do PDF e pedimos pra uma IA devolver os
// lancamentos ja estruturados em JSON. Gemini e o provedor principal, com
// retry em falhas transitorias; Groq (se configurado) entra como backup
// quando o Gemini esgota as tentativas ou nao esta configurado.
// Nomes de modelo via env porque provedores de IA depreciam modelo com
// pouco aviso (ja aconteceu 2x durante o desenvolvimento deste recurso).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// A mesma IA que le o PDF ja recebe a lista de categorias do usuario e
// sugere uma delas por lancamento com base na descricao (ex: "LONDRISUL
// TRANSPORTE C" -> "Transporte"). Essa sugestao e usada em transactions.js
// como fallback quando o aprendizado por historico e as keywords cadastradas
// nao encontram categoria -- que e o caso comum, ja que a descricao crua do
// extrato raramente bate com keyword generica.
function buildPrompt(categoryNames) {
    const categoryInstruction = categoryNames.length > 0
        ? `- "category": com base na descricao (nome do estabelecimento/pagador), escolha a categoria que melhor combina com o tipo de negocio (ex: nome de empresa de onibus/viacao => categoria de transporte; supermercado => alimentacao; etc). Copie EXATAMENTE um dos nomes da lista abaixo, com a mesma grafia. Se nenhuma combinar bem, use null.\nCategorias disponiveis:\n${categoryNames.map((name) => `  - ${name}`).join('\n')}`
        : '- "category": sempre null (o usuario ainda nao cadastrou categorias).';

    return `Voce recebe abaixo o texto extraido de um extrato bancario ou fatura de cartao de credito em PDF (a extracao pode ter espacamento/quebras de linha bagunçados).

Extraia TODOS os lancamentos (compras, pagamentos, estornos, tarifas, juros, saques, transferencias) e devolva APENAS um array JSON, sem nenhum texto ao redor, no formato:
[{"date": "YYYY-MM-DD", "description": "texto curto do lancamento", "amount": -123.45, "category": "Nome da categoria ou null"}]

Regras:
- "date": data do lancamento no formato ISO YYYY-MM-DD. Se so houver dia/mes, assuma o ano do extrato (procure no cabecalho/periodo do documento).
- "amount": numero (nao string), com ponto decimal. Compras, saques, tarifas, juros e demais debitos devem ser NEGATIVOS. Pagamentos recebidos, estornos e creditos devem ser POSITIVOS.
${categoryInstruction}
- Se o lancamento for uma compra parcelada, o extrato normalmente indica isso com um contador dentro do proprio texto do lancamento, em formatos como "3/10", "03/10", "PARC 3/10" ou por extenso "(Parcela 03 de 07)". Mantenha esse contador dentro de "description" exatamente como aparece (nao remova nem reescreva).
- Ignore linhas que nao sao lancamentos individuais: cabecalhos, rodapes, numero de pagina, "saldo anterior", "total da fatura", limites de credito, propaganda, instrucoes.
- Nao invente lancamentos que nao estao no texto.
- Se nao conseguir identificar nenhum lancamento, devolva [].

Texto do extrato:
"""
`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sob congestionamento o free tier do Gemini pode demorar dezenas de
// segundos pra sequer responder com erro -- sem um timeout por tentativa,
// o retry so multiplica essa espera em vez de acionar o backup a tempo.
const AI_REQUEST_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err.name === 'AbortError') throw new Error(`sem resposta em ${AI_REQUEST_TIMEOUT_MS / 1000}s (timeout)`);
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function assertAnyApiKey() {
    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
        throw new Error(
            'Importacao de PDF requer IA configurada: defina GEMINI_API_KEY (chave gratuita em aistudio.google.com/apikey) no .env do backend. Opcionalmente, defina tambem GROQ_API_KEY (console.groq.com) como backup.'
        );
    }
}

// pdf-parse (via pdfjs-dist) sinaliza PDF protegido por senha lancando uma
// PasswordException cuja causa original (pdfjs) carrega um `.code`: 1 quando
// nenhuma senha foi informada, 2 quando a senha informada esta errada. Sem
// isso o front nao teria como diferenciar "precisa de senha" de "senha
// incorreta" -- ambos chegariam como um erro generico.
const PDF_PASSWORD_NEEDED = 1;
const PDF_PASSWORD_INCORRECT = 2;

async function extractText(buffer, password) {
    const parser = new PDFParse({ data: buffer, password: password || undefined });
    try {
        const result = await parser.getText();
        return (result.text || '').trim();
    } catch (err) {
        if (err.name === 'PasswordException') {
            const code = err.cause?.code;
            const wrapped = new Error(
                code === PDF_PASSWORD_INCORRECT
                    ? 'Senha incorreta. Tente novamente.'
                    : 'Este PDF esta protegido por senha.'
            );
            wrapped.code = code === PDF_PASSWORD_INCORRECT ? 'PDF_PASSWORD_INCORRECT' : 'PDF_PASSWORD_REQUIRED';
            throw wrapped;
        }
        throw err;
    } finally {
        await parser.destroy?.();
    }
}

// Retry so em falhas transitorias (rate limit / indisponibilidade
// temporaria) -- erro de configuracao (400/404, ex: modelo errado) nao se
// resolve tentando de novo.
async function callGemini(statementText, prompt) {
    const apiKey = process.env.GEMINI_API_KEY;
    const attempts = 2;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        let response;
        try {
            response = await fetchWithTimeout(`${GEMINI_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `${prompt}${statementText}\n"""` }] }],
                    generationConfig: {
                        temperature: 0,
                        responseMimeType: 'application/json',
                        // Extracao de texto->JSON e uma tarefa simples e nao se
                        // beneficia do "thinking" (raciocinio estendido) que os
                        // modelos 3.x ligam por padrao -- isso so adiciona
                        // segundos de latencia sem melhorar o resultado.
                        thinkingConfig: { thinkingLevel: 'LOW' },
                    },
                }),
            });
        } catch (err) {
            // timeout (AbortError) -- trata como falha transitoria, tenta de novo
            lastError = err;
            if (attempt === attempts) break;
            await sleep(500);
            continue;
        }

        if (response.ok) {
            const data = await response.json();
            const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!raw) throw new Error('a IA nao retornou nenhum conteudo');
            return raw;
        }

        const retryable = response.status === 429 || response.status === 503;
        const errBody = await response.text().catch(() => '');
        lastError = new Error(`${response.status} ${errBody.slice(0, 200)}`);
        if (!retryable || attempt === attempts) break;
        await sleep(500);
    }

    throw lastError;
}

async function callGroq(statementText, prompt) {
    const apiKey = process.env.GROQ_API_KEY;

    const response = await fetchWithTimeout(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: GROQ_MODEL,
            temperature: 0,
            // Grande parte dos provedores OpenAI-compativeis so garante
            // "modo JSON" pra um objeto no topo, nao um array -- por isso
            // pedimos um objeto com a chave "transacoes" aqui.
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: 'Voce extrai lancamentos financeiros de extratos bancarios/faturas e devolve APENAS JSON valido, sem texto ao redor.',
                },
                {
                    role: 'user',
                    content: `${prompt}${statementText}\n"""\n\nDevolva um objeto JSON no formato {"transacoes": [...]} com o array pedido dentro da chave "transacoes".`,
                },
            ],
        }),
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`${response.status} ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error('a IA nao retornou nenhum conteudo');
    return raw;
}

function parseItems(raw, providerLabel) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`A IA (${providerLabel}) retornou um JSON invalido ao interpretar o extrato em PDF.`);
    }

    const items = Array.isArray(parsed) ? parsed : parsed?.transacoes;
    if (!Array.isArray(items)) throw new Error(`A IA (${providerLabel}) nao retornou uma lista de lancamentos valida.`);
    return items;
}

async function askAIForTransactions(statementText, categoryNames) {
    assertAnyApiKey();

    // Fatura de cartao raramente passa de algumas paginas; limitamos por
    // seguranca para nao estourar o limite de tokens do free tier.
    const truncated = statementText.slice(0, 60000);
    const prompt = buildPrompt(categoryNames);

    if (process.env.GEMINI_API_KEY) {
        try {
            const raw = await callGemini(truncated, prompt);
            return parseItems(raw, 'Gemini');
        } catch (geminiError) {
            if (!process.env.GROQ_API_KEY) {
                throw new Error(`Falha ao ler o PDF com IA (Gemini): ${geminiError.message}`);
            }
            console.warn(`Gemini falhou ao ler PDF, tentando backup (Groq): ${geminiError.message}`);
            try {
                const raw = await callGroq(truncated, prompt);
                return parseItems(raw, 'Groq, backup');
            } catch (groqError) {
                throw new Error(`Falha ao ler o PDF: Gemini (${geminiError.message}) e o backup Groq (${groqError.message}) falharam.`);
            }
        }
    }

    try {
        const raw = await callGroq(truncated, prompt);
        return parseItems(raw, 'Groq');
    } catch (groqError) {
        throw new Error(`Falha ao ler o PDF com IA (Groq): ${groqError.message}`);
    }
}

export async function parsePdf(buffer, categoryNames = [], password) {
    const text = await extractText(buffer, password);
    if (!text) {
        throw new Error('Nao foi possivel extrair texto do PDF (arquivo pode ser uma imagem escaneada).');
    }

    const items = await askAIForTransactions(text, categoryNames);

    return items
        .map((item) => {
            const rawDescription = String(item.description ?? '').trim() || 'Lancamento importado';
            const installment = extractInstallmentInfo(rawDescription);
            const categorySuggestion = String(item.category ?? '').trim();
            return {
                date: resolveInstallmentDate(normalizeDate(item.date), installment),
                description: installment ? installment.cleanDescription : rawDescription,
                amount: parseAmount(item.amount),
                installmentNumber: installment?.number ?? null,
                installmentTotal: installment?.total ?? null,
                categoryNameSuggestion: categorySuggestion || null,
            };
        })
        .filter((txn) => txn.date && Number.isFinite(txn.amount) && txn.amount !== 0);
}
