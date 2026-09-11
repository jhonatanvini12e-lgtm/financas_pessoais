import express from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { send2FACode, sendNewDeviceAlert, sendInactivityReauthCode } from '../services/emailService.js';
import {
    deviceFingerprint,
    issueTwoFactorCode,
    hasWebauthnCredential,
    twoFactorStore,
    completeLogin,
} from '../services/deviceAuth.js';
import { AUTH_COOKIE_NAME, clearAuthCookieOptions } from '../config/jwt.js';
import { CSRF_COOKIE_NAME } from '../middleware/csrf.js';
import webauthnRoutes from './webauthn.js';

const router = express.Router();

router.use('/webauthn', webauthnRoutes);

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

    // Sempre gera o codigo (fica de reserva), mas so manda por e-mail se este
    // dispositivo nao tiver biometria (WebAuthn) registrada -- nesse caso o
    // front pede a digital direto, sem depender do e-mail.
    const code = issueTwoFactorCode(user.id, fingerprint);

    if (hasWebauthnCredential(user.id, fingerprint)) {
        return res.json({ userId: user.id, newDevice: false, method: 'webauthn' });
    }

    if (knownDevice) {
        send2FACode(user.email, code);
    } else {
        sendNewDeviceAlert(user.email, code);
    }

    res.json({
        message: 'Codigo 2FA enviado para seu e-mail.',
        userId: user.id,
        newDevice: !knownDevice,
        method: 'email',
    });
});

// Fallback para quando o login sinalizou method: 'webauthn' mas a biometria
// falhou/foi cancelada no dispositivo -- reenvia por e-mail o mesmo codigo
// que ja tinha sido gerado (sem reservado) em /login.
router.post('/send-email-code', (req, res) => {
    const { userId } = req.body;
    const store = twoFactorStore.get(userId);
    const user = store && db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

    if (store && user) {
        send2FACode(user.email, store.code);
    }

    // Resposta identica em qualquer caso, para nao permitir enumeracao de userId.
    res.json({ message: 'Se a sessao ainda for valida, um codigo foi enviado por e-mail.' });
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
    completeLogin(userId, fingerprint, res);
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
