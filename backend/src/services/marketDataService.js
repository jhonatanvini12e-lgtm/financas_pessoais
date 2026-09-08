import budgetParams from '../config/budgetParams.js';

const BCB_SELIC_META_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

let cache = null; // { selicAnnual, source, fetchedAt }

async function fetchSelicFromBcb() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(BCB_SELIC_META_URL, { signal: controller.signal });
        if (!response.ok) throw new Error(`BCB respondeu ${response.status}`);

        const data = await response.json();
        const value = Number(data?.[0]?.valor);
        if (!Number.isFinite(value)) throw new Error('Formato inesperado na resposta do BCB');

        return value / 100; // API retorna percentual (ex.: 10.75)
    } finally {
        clearTimeout(timeout);
    }
}

// Meta Selic anual, com cache de 24h e fallback para o valor de configuracao
// quando a API do Banco Central estiver indisponivel (ex.: ambiente offline).
export async function getSelicRate() {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache;
    }

    try {
        const selicAnnual = await fetchSelicFromBcb();
        cache = { selicAnnual, source: 'bcb', fetchedAt: Date.now() };
    } catch {
        cache = { selicAnnual: budgetParams.fallbackSelicRateAnnual, source: 'fallback', fetchedAt: Date.now() };
    }

    return cache;
}

// CDI segue de perto a Selic no mercado brasileiro, tipicamente ~0.1 p.p. abaixo.
export function approximateCdiFromSelic(selicAnnual) {
    return Math.max(selicAnnual - 0.001, 0);
}
