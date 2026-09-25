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

// O plano gratuito do Meu Pluggy e' por CPF: cada titular que conecta seus
// proprios cartoes cria sua propria conta Meu Pluggy, com um client_id/secret
// diferente. Suportamos varios titulares via variaveis numeradas a partir de
// 1 (PLUGGY_CLIENT_ID_1/PLUGGY_CLIENT_SECRET_1/PLUGGY_ITEM_ID_1, depois _2,
// _3...) -- cada uma com seus proprios itens (conexoes com bancos).
function loadCredentialGroups() {
    const groups = [];
    for (let n = 1; ; n += 1) {
        const clientId = process.env[`PLUGGY_CLIENT_ID_${n}`];
        const clientSecret = process.env[`PLUGGY_CLIENT_SECRET_${n}`];
        if (!clientId || !clientSecret) break;
        const itemIds = (process.env[`PLUGGY_ITEM_ID_${n}`] || '').split(',').map((id) => id.trim()).filter(Boolean);
        groups.push({ clientId, clientSecret, itemIds });
    }
    return groups;
}

export function isPluggyConfigured() {
    return loadCredentialGroups().some((g) => g.itemIds.length > 0);
}

// Lista achatada de todos os itens de todos os titulares configurados -- para
// quem so precisa iterar "todo item configurado" sem se importar com de quem e'.
export function getItemIds() {
    return loadCredentialGroups().flatMap((g) => g.itemIds);
}

function credentialsForItem(itemId) {
    const group = loadCredentialGroups().find((g) => g.itemIds.includes(itemId));
    if (!group) throw new Error(`Nenhuma credencial Pluggy configurada para o item ${itemId}`);
    return group;
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

// Uma API key por titular (client_id) -- cada um autentica e expira
// independente dos outros.
const apiKeyCache = new Map(); // clientId -> { value, expiresAt }

async function getApiKey(credentials, { forceRefresh = false } = {}) {
    const cached = apiKeyCache.get(credentials.clientId);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;

    const { apiKey } = await fetchJson(`${API_BASE}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: credentials.clientId, clientSecret: credentials.clientSecret }),
    });
    apiKeyCache.set(credentials.clientId, { value: apiKey, expiresAt: Date.now() + API_KEY_TTL_MS });
    return apiKey;
}

async function pluggyGet(pathWithQuery, credentials) {
    const request = async (apiKey) => fetchJson(`${API_BASE}${pathWithQuery}`, { headers: { 'X-API-KEY': apiKey } });
    try {
        return await request(await getApiKey(credentials));
    } catch (err) {
        // Chave revogada/expirada antes do previsto: renova uma vez e tenta de novo.
        if (err.status === 401 || err.status === 403) return request(await getApiKey(credentials, { forceRefresh: true }));
        throw err;
    }
}

export async function getItem(itemId) {
    return pluggyGet(`/items/${encodeURIComponent(itemId)}`, credentialsForItem(itemId));
}

export async function listAccounts(itemId) {
    const { results } = await pluggyGet(`/accounts?itemId=${encodeURIComponent(itemId)}`, credentialsForItem(itemId));
    return results;
}

// accountId nao diz por si so' de qual titular/item ele veio -- os
// chamadores (pluggySyncService) precisam saber e passar o itemId
// correspondente para resolver a credencial certa.
export async function getAccount(accountId, itemId) {
    return pluggyGet(`/accounts/${encodeURIComponent(accountId)}`, credentialsForItem(itemId));
}

// /v2/transactions pagina por cursor: `next` ja vem como a query string
// pronta da proxima pagina (com o cursor opaco `after`), ou null na ultima.
// Sem filtro de data de proposito -- a sync reconcilia o estado completo que
// a Pluggy guarda (ate 12 meses), ver pluggySyncService.
export async function listTransactions(accountId, itemId) {
    const credentials = credentialsForItem(itemId);
    const all = [];
    let query = `?accountId=${encodeURIComponent(accountId)}`;
    while (query) {
        const { results, next } = await pluggyGet(`/v2/transactions${query}`, credentials);
        all.push(...results);
        query = next;
    }
    return all;
}

// /bills ainda pagina por numero de pagina (nao ha versao v2).
export async function listBills(accountId, itemId) {
    const credentials = credentialsForItem(itemId);
    const all = [];
    for (let page = 1; ; page += 1) {
        const { results, totalPages } = await pluggyGet(`/bills?accountId=${encodeURIComponent(accountId)}&page=${page}`, credentials);
        all.push(...results);
        if (page >= (totalPages || 1)) break;
    }
    return all;
}
