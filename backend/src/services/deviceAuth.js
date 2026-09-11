import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { JWT_SECRET, JWT_EXPIRES_IN, AUTH_COOKIE_NAME, authCookieOptions } from '../config/jwt.js';
import { CSRF_COOKIE_NAME, generateCsrfToken } from '../middleware/csrf.js';

// codigo -> { userId, expires, reason }
export const twoFactorStore = new Map();

const TWO_FACTOR_CODE_EXPIRY_MS = budgetParams.twoFactorCodeExpiryMinutes * 60000;

export function deviceFingerprint(req) {
    const ua = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return crypto.createHash('sha256').update(`${ua}::${ip}`).digest('hex');
}

export function issueTwoFactorCode(userId, fingerprint) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    twoFactorStore.set(userId, { code, expires: Date.now() + TWO_FACTOR_CODE_EXPIRY_MS, fingerprint });
    return code;
}

export function hasWebauthnCredential(userId, fingerprint) {
    return !!db
        .prepare('SELECT id FROM webauthn_credentials WHERE user_id = ? AND device_fingerprint = ?')
        .get(userId, fingerprint);
}

// Registra o dispositivo como conhecido, abre a sessao (JWT + cookies) e
// atualiza last_login. Usado tanto pelo login por e-mail (verify-2fa) quanto
// pelo login por biometria (webauthn login-verify).
export function completeLogin(userId, fingerprint, res) {
    db.prepare(
        `INSERT INTO known_devices (user_id, fingerprint, last_seen) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, fingerprint) DO UPDATE SET last_seen = CURRENT_TIMESTAMP`
    ).run(userId, fingerprint);

    const jti = crypto.randomUUID();
    db.prepare('INSERT INTO sessions (user_id, jti, device_fingerprint) VALUES (?, ?, ?)').run(
        userId,
        jti,
        fingerprint
    );
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);

    const token = jwt.sign({ jti }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    const cookieOptions = authCookieOptions();
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions);
    // Cookie CSRF precisa ser legivel por JS (nao-httpOnly) para o front devolver
    // o valor num header customizado a cada request que altera estado.
    res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), { ...cookieOptions, httpOnly: false });
}
