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

// Extratos/faturas costumam trazer o numero completo do cartao e o CPF do
// titular no texto -- esses dados nao tem relacao com a extracao dos
// lancamentos, entao sao mascarados antes de sair do backend para a IA.
// Sequencia de 13-19 digitos (com espaco/ponto/traço opcional entre eles) e
// tratada como "parece numero de cartao"; o guard de 13+ digitos evita
// mascarar por engano numeros curtos comuns em extratos (datas, valores,
// contador de parcela).
const CARD_NUMBER_PATTERN = /\b(?:\d[ .-]?){12,18}\d\b/g;
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
// E-mail e telefone tambem aparecem com frequencia no cabecalho de faturas
// (dados do titular/correspondencia) sem nenhuma relacao com os lancamentos
// em si, entao sao mascarados pelo mesmo motivo que numero de cartao/CPF.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Cobre formatos comuns de telefone BR: "(11) 91234-5678", "11912345678",
// "+55 11 91234-5678", com ou sem o 9 extra de celular.
const PHONE_PATTERN = /(?:\+?55\s?)?(?:\(\d{2}\)|\d{2})\s?9?\d{4}[-.\s]?\d{4}\b/g;
// Linhas de identificacao do titular/conta costumam vir como "Rotulo: valor"
// -- mascaramos so o valor apos o rotulo (mantendo o rotulo visivel) para nao
// perder o contexto que ajuda a IA a distinguir essas linhas de lancamentos
// reais na hora de extrair as transacoes.
const LABELED_LINE_PATTERNS = [
    /^(Ag[êe]ncia[:\s]+).+$/gim,
    /^(Conta[:\s]+).+$/gim,
    /^(Titular[:\s]+).+$/gim,
    /^(Cliente[:\s]+).+$/gim,
    /^(CPF\/CNPJ[:\s]+).+$/gim,
    /^(Endere[çc]o[:\s]+).+$/gim,
];

function maskCardNumber(match) {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13) return match;
    return `**** **** **** ${digits.slice(-4)}`;
}

function maskSensitiveData(text) {
    let masked = text
        .replace(CARD_NUMBER_PATTERN, maskCardNumber)
        .replace(CPF_PATTERN, '***.***.***-**')
        .replace(EMAIL_PATTERN, '[REDACTED]')
        .replace(PHONE_PATTERN, '[REDACTED]');

    for (const pattern of LABELED_LINE_PATTERNS) {
        masked = masked.replace(pattern, '$1[REDACTED]');
    }

    return masked;
}

const MAX_STATEMENT_CHARS = 60000;

async function askAIForTransactions(statementText, categoryNames) {
    assertAnyApiKey();

    const masked = maskSensitiveData(statementText);

    // Fatura de cartao raramente passa de algumas paginas; limitamos por
    // seguranca para nao estourar o limite de tokens do free tier. Quando o
    // texto e maior que o limite, o restante da fatura simplesmente nao e
    // visto pela IA -- por isso o chamador precisa saber que houve corte
    // (ver `truncated` no retorno) para poder avisar o usuario.
    const textForAI = masked.slice(0, MAX_STATEMENT_CHARS);
    const wasTruncated = masked.length > MAX_STATEMENT_CHARS;
    const prompt = buildPrompt(categoryNames);

    if (process.env.GEMINI_API_KEY) {
        try {
            const raw = await callGemini(textForAI, prompt);
            return { items: parseItems(raw, 'Gemini'), truncated: wasTruncated };
        } catch (geminiError) {
            if (!process.env.GROQ_API_KEY) {
                throw new Error(`Falha ao ler o PDF com IA (Gemini): ${geminiError.message}`);
            }
            console.warn(`Gemini falhou ao ler PDF, tentando backup (Groq): ${geminiError.message}`);
            try {
                const raw = await callGroq(textForAI, prompt);
                return { items: parseItems(raw, 'Groq, backup'), truncated: wasTruncated };
            } catch (groqError) {
                throw new Error(`Falha ao ler o PDF: Gemini (${geminiError.message}) e o backup Groq (${groqError.message}) falharam.`);
            }
        }
    }

    try {
        const raw = await callGroq(textForAI, prompt);
        return { items: parseItems(raw, 'Groq'), truncated: wasTruncated };
    } catch (groqError) {
        throw new Error(`Falha ao ler o PDF com IA (Groq): ${groqError.message}`);
    }
}

// Procura um "total da fatura"/"total a pagar" identificavel no texto para
// servir de checagem de sanidade contra a soma dos lancamentos que a IA
// extraiu (ver checkInvoiceTotalDivergence). So aceita a primeira ocorrencia
// -- suficiente pro cabecalho/resumo tipico de fatura, onde o total aparece
// perto do rotulo.
const INVOICE_TOTAL_PATTERN = /(total\s+(?:desta\s+|da\s+)?fatura|total\s+a\s+pagar|valor\s+total)[\s\S]{0,20}?(-?\s*R\$\s*[\d.,]+|-?\d[\d.,]*\d)/i;

function extractInvoiceTotal(text) {
    const match = text.match(INVOICE_TOTAL_PATTERN);
    if (!match) return null;
    const value = parseAmount(match[2]);
    return Number.isFinite(value) && value !== 0 ? Math.abs(value) : null;
}

// Aviso (nao bloqueia a importacao) quando o total identificado na fatura
// diverge significativamente da soma dos lancamentos extraidos -- sinal de
// que a IA pode ter alucinado um valor ou deixado de extrair algum
// lancamento. Tolerancia relativa (10%) com piso absoluto (R$5) pra nao
// disparar por causa de arredondamento em faturas pequenas.
const INVOICE_TOTAL_DIVERGENCE_RATIO = 0.1;
const INVOICE_TOTAL_DIVERGENCE_MIN_ABS = 5;

function checkInvoiceTotalDivergence(invoiceTotal, transactions) {
    if (invoiceTotal == null) return null;

    const extractedTotal = Math.abs(transactions.reduce((sum, txn) => sum + txn.amount, 0));
    const diff = Math.abs(extractedTotal - invoiceTotal);
    const tolerance = Math.max(INVOICE_TOTAL_DIVERGENCE_MIN_ABS, invoiceTotal * INVOICE_TOTAL_DIVERGENCE_RATIO);
    if (diff <= tolerance) return null;

    return `O total da fatura identificado no PDF (R$ ${invoiceTotal.toFixed(2)}) diverge da soma dos lancamentos extraidos (R$ ${extractedTotal.toFixed(2)}). Confira os valores antes de importar -- a IA pode ter deixado de extrair algum lancamento ou alucinado um valor.`;
}

export async function parsePdf(buffer, categoryNames = [], password) {
    const text = await extractText(buffer, password);
    if (!text) {
        throw new Error('Nao foi possivel extrair texto do PDF (arquivo pode ser uma imagem escaneada).');
    }

    const { items, truncated } = await askAIForTransactions(text, categoryNames);

    const transactions = items
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

    const warnings = [];
    if (truncated) {
        warnings.push(
            `O texto do PDF passou de ${MAX_STATEMENT_CHARS.toLocaleString('pt-BR')} caracteres e foi cortado antes de ir para a IA -- o extrato pode estar incompleto. Confira se todos os lancamentos da fatura foram importados.`
        );
    }
    const divergenceWarning = checkInvoiceTotalDivergence(extractInvoiceTotal(text), transactions);
    if (divergenceWarning) warnings.push(divergenceWarning);

    return { transactions, warnings };
}
