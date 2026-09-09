import crypto from 'crypto';

export const CSRF_COOKIE_NAME = 'csrfToken';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Login e verify-2fa nao tem cookie CSRF ainda (usuario nao autenticado) --
// e' nesse momento que o cookie e' emitido, por isso ficam de fora da checagem.
const EXEMPT_PATHS = new Set(['/api/auth/login', '/api/auth/verify-2fa']);

export function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Padrao "double submit cookie": o cookie CSRF (nao-httpOnly) so pode ser lido
// por JS que roda na mesma origem, entao um request forjado de outro site nao
// consegue reproduzir o header esperado, mesmo que o cookie de sessao seja
// enviado automaticamente pelo browser.
export function csrfProtection(req, res, next) {
    if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) {
        return next();
    }

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ error: 'Token CSRF invalido ou ausente' });
    }

    next();
}
