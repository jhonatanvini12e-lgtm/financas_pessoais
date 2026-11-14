// Cliente da API da Pluggy (https://docs.pluggy.ai), usado so no servidor: o
// clientSecret da acesso total aos dados bancarios conectados e nunca deve
// chegar ao navegador. So' faz leitura -- os dados sao atualizados pela
// propria Pluggy (Meu Pluggy sincroniza com o banco a cada ~24h), entao nao
// disparamos atualizacao de item aqui: cada atualizacao forcada consome a
// cota mensal de chamadas do Open Finance por CPF/instituicao.
// Usa o SDK oficial (`pluggy-sdk`, pluggyai/pluggy-node no GitHub) em vez de
// fetch cru: ele ja cuida de autenticacao/renovacao de API key e retry de
// rede, e acompanha mudancas da API da Pluggy sem precisar atualizar este
// arquivo na mao.
import { PluggyClient } from 'pluggy-sdk';

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

// Uma instancia de PluggyClient por titular (client_id) -- o SDK cuida
// sozinho de buscar/renovar a API key dessa instancia, nao precisamos mais
// de cache/retry de autenticacao na mao.
const clientCache = new Map(); // clientId -> PluggyClient
function clientForItem(itemId) {
    const credentials = credentialsForItem(itemId);
    let client = clientCache.get(credentials.clientId);
    if (!client) {
        client = new PluggyClient({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
        clientCache.set(credentials.clientId, client);
    }
    return client;
}

// O SDK faz parse de todo campo de data (string ISO) para instancia `Date`
// (ver pluggy-sdk/dist/transforms.js, deserializeJSONWithDates). O resto do
// codigo (pluggySyncService, pluggyBillsService) espera as mesmas strings ISO
// cruas que a API da Pluggy devolve (ex: `txn.date.slice(0,10)`,
// `bill.dueDate.endsWith(...)`) -- convertemos de volta aqui, na borda, para
// nenhum consumidor precisar mudar.
function denormalizeDates(value) {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(denormalizeDates);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) out[key] = denormalizeDates(val);
        return out;
    }
    return value;
}

export async function getItem(itemId) {
    return denormalizeDates(await clientForItem(itemId).fetchItem(itemId));
}

export async function listAccounts(itemId) {
    const { results } = await clientForItem(itemId).fetchAccounts(itemId);
    return denormalizeDates(results);
}

// accountId nao diz por si so' de qual titular/item ele veio -- os
// chamadores (pluggySyncService) precisam saber e passar o itemId
// correspondente para resolver a credencial certa.
export async function getAccount(accountId, itemId) {
    return denormalizeDates(await clientForItem(itemId).fetchAccount(accountId));
}

// `fetchAllTransactions` ja pagina (cursor) por baixo dos panos -- sem filtro
// de data de proposito -- a sync reconcilia o estado completo que a Pluggy
// guarda (ate 12 meses), ver pluggySyncService.
export async function listTransactions(accountId, itemId) {
    const all = await clientForItem(itemId).fetchAllTransactions(accountId);
    return denormalizeDates(all);
}

// `fetchCreditCardBills` pagina por numero de pagina (sem helper "fetch all"
// no SDK para esse endpoint).
export async function listBills(accountId, itemId) {
    const client = clientForItem(itemId);
    const all = [];
    for (let page = 1; ; page += 1) {
        const { results, totalPages } = await client.fetchCreditCardBills(accountId, { page });
        all.push(...results);
        if (page >= (totalPages || 1)) break;
    }
    return denormalizeDates(all);
}
