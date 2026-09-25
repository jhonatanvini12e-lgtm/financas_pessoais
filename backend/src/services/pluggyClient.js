// Cliente minimo da API da Pluggy (https://docs.pluggy.ai), usado so no
// servidor: o clientSecret da acesso total aos dados bancarios conectados e
// nunca deve chegar ao navegador. So' faz leitura -- os dados sao atualizados
// pela propria Pluggy (Meu Pluggy sincroniza com o banco a cada ~24h), entao
// nao disparamos atualizacao de item aqui: cada atualizacao forcada consome a
// cota mensal de chamadas do Open Finance por CPF/instituicao.
const API_BASE = 'https://api.pluggy.ai';
const REQUEST_TIMEOUT_MS = 30_000;
// A API key vale 2h; renovamos com folga para nao usar uma chave que expira
// no meio de uma sync.
const API_KEY_TTL_MS = 110 * 60 * 1000;

let cachedApiKey = null; // { value, expiresAt }

export function isPluggyConfigured() {
    return Boolean(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET && getItemIds().length > 0);
}

// PLUGGY_ITEM_ID aceita varios ids separados por virgula (uma conexao por
// instituicao no Meu Pluggy).
export function getItemIds() {
    return (process.env.PLUGGY_ITEM_ID || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
}

async function fetchJson(url, options) {
    let res;
    try {
        res = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
        throw new Error(`Falha ao contatar a Pluggy: ${err.message}`);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        const error = new Error(`Pluggy respondeu ${res.status}: ${body?.message || 'erro desconhecido'}`);
        error.status = res.status;
        throw error;
    }
    return body;
}

async function getApiKey({ forceRefresh = false } = {}) {
    if (!forceRefresh && cachedApiKey && cachedApiKey.expiresAt > Date.now()) return cachedApiKey.value;

    const { apiKey } = await fetchJson(`${API_BASE}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET }),
    });
    cachedApiKey = { value: apiKey, expiresAt: Date.now() + API_KEY_TTL_MS };
    return apiKey;
}

async function pluggyGet(pathWithQuery) {
    const request = async (apiKey) => fetchJson(`${API_BASE}${pathWithQuery}`, { headers: { 'X-API-KEY': apiKey } });
    try {
        return await request(await getApiKey());
    } catch (err) {
        // Chave revogada/expirada antes do previsto: renova uma vez e tenta de novo.
        if (err.status === 401 || err.status === 403) return request(await getApiKey({ forceRefresh: true }));
        throw err;
    }
}

export async function getItem(itemId) {
    return pluggyGet(`/items/${encodeURIComponent(itemId)}`);
}

export async function listAccounts(itemId) {
    const { results } = await pluggyGet(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    return results;
}

export async function getAccount(accountId) {
    return pluggyGet(`/accounts/${encodeURIComponent(accountId)}`);
}

// /v2/transactions pagina por cursor: `next` ja vem como a query string
// pronta da proxima pagina (com o cursor opaco `after`), ou null na ultima.
// Sem filtro de data de proposito -- a sync reconcilia o estado completo que
// a Pluggy guarda (ate 12 meses), ver pluggySyncService.
export async function listTransactions(accountId) {
    const all = [];
    let query = `?accountId=${encodeURIComponent(accountId)}`;
    while (query) {
        const { results, next } = await pluggyGet(`/v2/transactions${query}`);
        all.push(...results);
        query = next;
    }
    return all;
}

// /bills ainda pagina por numero de pagina (nao ha versao v2).
export async function listBills(accountId) {
    const all = [];
    for (let page = 1; ; page += 1) {
        const { results, totalPages } = await pluggyGet(`/bills?accountId=${encodeURIComponent(accountId)}&page=${page}`);
        all.push(...results);
        if (page >= (totalPages || 1)) break;
    }
    return all;
}
