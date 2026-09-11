import budgetParams from './budgetParams.js';

// Valores de exemplo do .env.example: se alguem subir para producao copiando
// o arquivo sem trocar o segredo, ele fica publicamente conhecido (esta no
// historico git deste repositorio), permitindo forjar qualquer JWT valido.
const KNOWN_PLACEHOLDER_SECRETS = new Set(['troque_esta_chave_jwt']);

if (!process.env.JWT_SECRET) {
    console.error('Erro fatal: variavel de ambiente JWT_SECRET nao definida. Defina-a antes de iniciar o servidor.');
    process.exit(1);
}
if (KNOWN_PLACEHOLDER_SECRETS.has(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 32) {
    console.error(
        'Erro fatal: JWT_SECRET esta com o valor de exemplo ou e curto demais (minimo 32 caracteres). ' +
        'Gere um valor aleatorio forte antes de subir em producao.'
    );
    process.exit(1);
}

export const JWT_SECRET = process.env.JWT_SECRET;

const DURATION_MULTIPLIERS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };

export function parseDurationMs(duration) {
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
    if (!match) return DURATION_MULTIPLIERS.m * 30;
    return Number(match[1]) * DURATION_MULTIPLIERS[match[2]];
}

// O JWT precisa durar mais que o timeout de inatividade: ele e o limite
// absoluto da sessao, a inatividade e o limite mais cedo/suave que aciona o
// fluxo de reauth por codigo (ver middleware/auth.js). Se o JWT expirasse
// primeiro, esse fluxo nunca seria alcancado -- o usuario so veria "token
// invalido ou expirado" ao inves da tela de reautenticacao por inatividade.
const DEFAULT_JWT_EXPIRES_IN = `${budgetParams.inactivityTimeoutMinutes + 30}m`;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || DEFAULT_JWT_EXPIRES_IN;

if (parseDurationMs(JWT_EXPIRES_IN) <= budgetParams.inactivityTimeoutMinutes * 60000) {
    console.warn(
        `Aviso: JWT_EXPIRES_IN (${JWT_EXPIRES_IN}) e menor ou igual a inactivityTimeoutMinutes ` +
        `(${budgetParams.inactivityTimeoutMinutes}m). O fluxo de reautenticacao por inatividade nunca sera alcancado.`
    );
}

export const AUTH_COOKIE_NAME = 'token';
export const AUTH_COOKIE_MAX_AGE_MS = parseDurationMs(JWT_EXPIRES_IN);

function baseCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
    };
}

export function authCookieOptions() {
    return { ...baseCookieOptions(), maxAge: AUTH_COOKIE_MAX_AGE_MS };
}

// Sem maxAge: res.clearCookie precisa poder sobrescrever o Expires para o
// passado sem que um Max-Age concorrente mantenha o cookie vivo no browser.
export function clearAuthCookieOptions() {
    return baseCookieOptions();
}
