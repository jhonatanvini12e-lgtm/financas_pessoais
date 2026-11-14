import db from '../db/index.js';
import { normalizeForMatch } from './categorizationEngine.js';

// Mesmo padrao de services/financialAssistantService.js e
// services/statementImport/pdfParser.js: Gemini como provedor principal
// (free tier), Groq como backup, via fetch cru (sem SDK).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const AI_REQUEST_TIMEOUT_MS = 20000;

// Limite de grupos (descricoes distintas) enviados por chamada -- mantem o
// prompt pequeno e a lista de revisao no front administravel. Prioriza por
// valor total (maior impacto primeiro); rodar de novo depois de confirmar o
// primeiro lote traz o proximo.
const MAX_GROUPS_PER_BATCH = 60;

function assertAnyApiKey() {
    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
        throw new Error(
            'Sugestao de categoria por IA requer IA configurada: defina GEMINI_API_KEY (chave gratuita em aistudio.google.com/apikey) no .env do backend.'
        );
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Agrupa os lancamentos sem categoria do household por descricao normalizada
// (mesma normalizacao do aprendizado por historico, ver categorizationEngine),
// com contagem, soma e o sinal predominante (maioria dos lancamentos do grupo
// e' entrada ou saida) -- um grupo quase sempre tem um unico sinal (ex: "Pix
// enviado Fulano" so' existe como saida), mas o sinal predominante e' usado
// como salvaguarda caso um grupo raro misture os dois.
function groupUncategorized(userId) {
    const rows = db
        .prepare(
            `SELECT description, amount FROM transactions
             WHERE user_id = ? AND category_id IS NULL AND description IS NOT NULL`
        )
        .all(userId);

    const groups = new Map();
    for (const row of rows) {
        const key = normalizeForMatch(row.description);
        if (!key) continue;
        const group = groups.get(key) || { description: row.description, count: 0, total: 0, incomeCount: 0 };
        group.count += 1;
        group.total += row.amount;
        if (row.amount >= 0) group.incomeCount += 1;
        groups.set(key, group);
    }

    return Array.from(groups.values())
        .map((g) => ({ ...g, type: g.incomeCount * 2 >= g.count ? 'INCOME' : 'EXPENSE' }))
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function money(value) {
    return `R$ ${Number(value || 0).toFixed(2)}`;
}

function buildPrompt(categories, groups) {
    const categoryList = categories.map((c) => `- "${c.name}" (${c.type})`).join('\n');
    const groupList = groups
        .map((g, i) => `${i + 1}. "${g.description}" | ${g.type} | ${g.count} lancamento(s) | total ${money(g.total)}`)
        .join('\n');

    return `Voce ajuda a categorizar lancamentos financeiros de um app de financas pessoais (Brasil, valores em R$).

Categorias existentes (nome e tipo):
${categoryList}

Para cada lancamento abaixo (descricao, tipo INCOME=entrada/EXPENSE=saida, quantidade e valor total), escolha a categoria EXISTENTE da lista acima que melhor combina, ou null se nenhuma combinar bem ou a descricao for ambigua demais (ex: Pix/transferencia para uma pessoa fisica sem indicacao clara do motivo, pagamento de fatura de cartao -- que ja e' contado via os lancamentos originais do cartao e categorizar de novo duplicaria o gasto).

Regras obrigatorias:
- NUNCA escolha uma categoria do tipo INCOME para um lancamento do tipo EXPENSE, nem o contrario -- isso e' um erro grave, misture renda e despesa no orcamento do usuario.
- So' escolha uma categoria se o nome do estabelecimento/motivo for claro o suficiente (ex: nome de loja, servico, concessionaria). Na duvida, retorne null.
- Copie o nome da categoria EXATAMENTE como esta na lista, ou use null.

Lancamentos:
${groupList}

Devolva APENAS um array JSON, sem texto ao redor, no formato:
[{"description": "texto exatamente igual ao lancamento acima", "categoryName": "Nome da categoria ou null"}]`;
}

async function callGemini(prompt) {
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
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'LOW' } },
                }),
            });
        } catch (err) {
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

async function callGroq(prompt) {
    const apiKey = process.env.GROQ_API_KEY;
    const response = await fetchWithTimeout(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
            model: GROQ_MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: 'Voce categoriza lancamentos financeiros e devolve APENAS JSON valido, sem texto ao redor.' },
                { role: 'user', content: `${prompt}\n\nDevolva um objeto JSON no formato {"sugestoes": [...]} com o array pedido dentro da chave "sugestoes".` },
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

function parseSuggestions(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('A IA retornou um JSON invalido ao sugerir categorias.');
    }
    const items = Array.isArray(parsed) ? parsed : parsed?.sugestoes;
    if (!Array.isArray(items)) throw new Error('A IA nao retornou uma lista de sugestoes valida.');
    return items;
}

// Retorna, para os lancamentos sem categoria do household, um lote (maior
// valor primeiro) com a sugestao de categoria da IA -- so' sugestao, nada e'
// aplicado aqui. `categoryId` vem null quando a IA nao sugeriu nada ou
// sugeriu um nome que nao bate com nenhuma categoria existente, ou cujo tipo
// (INCOME/EXPENSE) nao bate com o sinal do grupo (salvaguarda contra a IA
// alucinar uma categoria do tipo errado).
export async function suggestCategoriesForUncategorized(userId) {
    assertAnyApiKey();

    const categories = db.prepare('SELECT id, name, type FROM categories WHERE user_id = ?').all(userId);
    const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));

    const allGroups = groupUncategorized(userId);
    const groups = allGroups.slice(0, MAX_GROUPS_PER_BATCH);
    if (groups.length === 0) {
        return { suggestions: [], remainingGroups: 0 };
    }

    const prompt = buildPrompt(categories, groups);

    let raw;
    if (process.env.GEMINI_API_KEY) {
        try {
            raw = await callGemini(prompt);
        } catch (geminiError) {
            if (!process.env.GROQ_API_KEY) throw new Error(`Falha ao consultar a IA (Gemini): ${geminiError.message}`);
            console.warn(`Gemini falhou ao sugerir categorias, tentando backup (Groq): ${geminiError.message}`);
            raw = await callGroq(prompt).catch((groqError) => {
                throw new Error(`Falha ao consultar a IA: Gemini (${geminiError.message}) e o backup Groq (${groqError.message}) falharam.`);
            });
        }
    } else {
        raw = await callGroq(prompt);
    }

    const items = parseSuggestions(raw);
    const suggestionByDescription = new Map(items.map((i) => [normalizeForMatch(i.description), i.categoryName]));

    const suggestions = groups.map((g) => {
        const suggestedName = suggestionByDescription.get(normalizeForMatch(g.description));
        const category = suggestedName ? categoryByName.get(String(suggestedName).trim().toLowerCase()) : null;
        const typeMatches = category && category.type === g.type;
        return {
            description: g.description,
            count: g.count,
            total: Number(g.total.toFixed(2)),
            type: g.type,
            suggestedCategoryId: typeMatches ? category.id : null,
            suggestedCategoryName: typeMatches ? category.name : null,
        };
    });

    return { suggestions, remainingGroups: Math.max(allGroups.length - groups.length, 0) };
}
