import rateLimit from 'express-rate-limit';

export const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

function ipAndUserIdKey(req) {
    return `${req.ip}:${req.body?.userId ?? 'unknown'}`;
}

// Codigo 2FA tem 6 digitos e fica valido por ate 60 min (budgetParams.twoFactorCodeExpiryMinutes),
// entao a janela precisa ser curta e o limite baixo para nao viabilizar forca bruta.
export const twoFactorRateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipAndUserIdKey,
    message: { error: 'Muitas tentativas de verificacao. Tente novamente em alguns minutos.' },
});

export const reauthRateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipAndUserIdKey,
    message: { error: 'Muitas tentativas de reautenticacao. Tente novamente em alguns minutos.' },
});
