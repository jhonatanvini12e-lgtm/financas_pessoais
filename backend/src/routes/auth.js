import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { send2FACode, sendNewDeviceAlert, sendInactivityReauthCode } from '../services/emailService.js';
import budgetParams from '../config/budgetParams.js';
import {
    JWT_SECRET,
    JWT_EXPIRES_IN,
    AUTH_COOKIE_NAME,
    authCookieOptions,
    clearAuthCookieOptions,
} from '../config/jwt.js';
import { CSRF_COOKIE_NAME, generateCsrfToken } from '../middleware/csrf.js';

const router = express.Router();

// codigo -> { userId, expires, reason }
const twoFactorStore = new Map();

const TWO_FACTOR_CODE_EXPIRY_MS = budgetParams.twoFactorCodeExpiryMinutes * 60000;

function deviceFingerprint(req) {
    const ua = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return crypto.createHash('sha256').update(`${ua}::${ip}`).digest('hex');
}

function issueTwoFactorCode(userId, fingerprint) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    twoFactorStore.set(userId, { code, expires: Date.now() + TWO_FACTOR_CODE_EXPIRY_MS, fingerprint });
    return code;
}

router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Credenciais invalidas' });
    }

    const fingerprint = deviceFingerprint(req);
    const knownDevice = db
        .prepare('SELECT id FROM known_devices WHERE user_id = ? AND fingerprint = ?')
        .get(user.id, fingerprint);

    const code = issueTwoFactorCode(user.id, fingerprint);

    if (knownDevice) {
        send2FACode(user.email, code);
    } else {
        sendNewDeviceAlert(user.email, code);
    }

    res.json({ message: 'Codigo 2FA enviado para seu e-mail.', userId: user.id, newDevice: !knownDevice });
});

router.post('/request-reauth', (req, res) => {
    const { userId } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (user) {
        const code = issueTwoFactorCode(user.id, deviceFingerprint(req));
        sendInactivityReauthCode(user.email, code);
    }

    // Resposta identica exista ou nao o usuario, para nao permitir enumeracao de userId.
    res.json({ message: 'Se o usuario existir, um codigo de reautenticacao foi enviado.' });
});

router.post('/verify-2fa', (req, res) => {
    const { userId, code } = req.body;
    const store = twoFactorStore.get(userId);

    if (!store || Date.now() > store.expires || store.code !== code) {
        return res.status(401).json({ error: 'Codigo 2FA invalido ou expirado' });
    }
    twoFactorStore.delete(userId);

    const fingerprint = store.fingerprint || deviceFingerprint(req);
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
    res.json({ message: 'Autenticado com sucesso' });
});

router.get('/me', authMiddleware, (req, res) => {
    const user = db.prepare('SELECT id, username, email, last_login FROM users WHERE id = ?').get(req.user.id);
    res.json(user);
});

router.post('/activity-ping', authMiddleware, (req, res) => {
    res.json({ ok: true });
});

router.post('/logout', authMiddleware, (req, res) => {
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(req.user.sessionId);
    res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions());
    res.clearCookie(CSRF_COOKIE_NAME, { ...clearAuthCookieOptions(), httpOnly: false });
    res.json({ ok: true });
});

router.patch('/change-password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
        return res.status(401).json({ error: 'Senha atual incorreta' });
    }
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Nova senha deve ter ao menos 6 caracteres' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    res.json({ ok: true });
});

export default router;
