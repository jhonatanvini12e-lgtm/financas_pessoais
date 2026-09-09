if (!process.env.JWT_SECRET) {
    console.error('Erro fatal: variavel de ambiente JWT_SECRET nao definida. Defina-a antes de iniciar o servidor.');
    process.exit(1);
}

export const JWT_SECRET = process.env.JWT_SECRET;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30m';

const DURATION_MULTIPLIERS = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };

export function parseDurationMs(duration) {
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
    if (!match) return DURATION_MULTIPLIERS.m * 30;
    return Number(match[1]) * DURATION_MULTIPLIERS[match[2]];
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
