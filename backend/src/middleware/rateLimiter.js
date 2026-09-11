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

// Sessao ja pode estar comprometida (cookie roubado) quando alguem tenta
// forcar a senha atual aqui -- sem limite, seria um brute-force sem custo.
export const changePasswordRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de troca de senha. Tente novamente em alguns minutos.' },
});

// Parsing de XLSX/PDF e pesado (CPU/memoria) e, no caso do PDF, cada chamada
// bem-sucedida aciona uma requisicao paga a um provedor de IA externo --
// sem limite, vira DoS/"denial of wallet" trivial de disparar.
export const importStatementRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas importacoes de extrato. Tente novamente mais tarde.' },
});

// Backup faz copia + gzip do banco inteiro -- caro em I/O de disco.
export const backupsRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitos backups disparados. Tente novamente mais tarde.' },
});
