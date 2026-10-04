import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { JWT_SECRET, JWT_EXPIRES_IN, AUTH_COOKIE_NAME, authCookieOptions } from '../config/jwt.js';
import { CSRF_COOKIE_NAME, generateCsrfToken } from '../middleware/csrf.js';

// codigo -> { userId, expires, reason }
export const twoFactorStore = new Map();

const TWO_FACTOR_CODE_EXPIRY_MS = budgetParams.twoFactorCodeExpiryMinutes * 60000;
const WEBAUTHN_EMAIL_RECHECK_MS = budgetParams.webauthnEmailRecheckDays * 24 * 60 * 60 * 1000;

// SQLite grava CURRENT_TIMESTAMP como 'YYYY-MM-DD HH:MM:SS' em UTC sem timezone.
const parseSqliteUtc = (value) => new Date(value.replace(' ', 'T') + 'Z').getTime();

export function deviceFingerprint(req) {
    const ua = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return crypto.createHash('sha256').update(`${ua}::${ip}`).digest('hex');
}

export function issueTwoFactorCode(userId, fingerprint) {
    const code = crypto.randomInt(100000, 1000000).toString();
    twoFactorStore.set(userId, { code, expires: Date.now() + TWO_FACTOR_CODE_EXPIRY_MS, fingerprint });
    return code;
}

export function hasWebauthnCredential(userId, fingerprint) {
    return !!db
        .prepare('SELECT id FROM webauthn_credentials WHERE user_id = ? AND device_fingerprint = ?')
        .get(userId, fingerprint);
}

// true se o e-mail nunca foi verificado neste dispositivo, ou ja faz mais de
// webauthnEmailRecheckDays desde a ultima vez -- usado por /login para
// decidir se o atalho da biometria ainda dispensa o codigo por e-mail.
export function needsEmailRecheck(userId, fingerprint) {
    const row = db
        .prepare('SELECT last_email_verified_at FROM known_devices WHERE user_id = ? AND fingerprint = ?')
        .get(userId, fingerprint);
    if (!row || !row.last_email_verified_at) return true;
    return Date.now() - parseSqliteUtc(row.last_email_verified_at) > WEBAUTHN_EMAIL_RECHECK_MS;
}

// Marca que o codigo por e-mail acabou de ser verificado neste dispositivo,
// reiniciando a janela de webauthnEmailRecheckDays. So deve ser chamado apos
// o codigo por e-mail ser de fato confirmado (nao quando a biometria sozinha
// completa o login).
export function markEmailVerified(userId, fingerprint) {
    db.prepare(
        `INSERT INTO known_devices (user_id, fingerprint, last_seen, last_email_verified_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, fingerprint) DO UPDATE SET last_seen = CURRENT_TIMESTAMP, last_email_verified_at = CURRENT_TIMESTAMP`
    ).run(userId, fingerprint);
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
