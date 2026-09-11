import express from 'express';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import db from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { RP_NAME, RP_ID, ORIGIN } from '../config/webauthn.js';
import { deviceFingerprint, twoFactorStore, completeLogin } from '../services/deviceAuth.js';

const router = express.Router();

// userId -> { challenge, expires }
const registrationChallenges = new Map();
const authenticationChallenges = new Map();
const CHALLENGE_TTL_MS = 5 * 60000;

function setChallenge(store, userId, challenge) {
    store.set(userId, { challenge, expires: Date.now() + CHALLENGE_TTL_MS });
}

function takeChallenge(store, userId) {
    const entry = store.get(userId);
    store.delete(userId);
    if (!entry || Date.now() > entry.expires) return null;
    return entry.challenge;
}

// --- Registro de biometria para o dispositivo atual (usuario ja logado) ---

router.post('/register-options', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const existing = db.prepare('SELECT credential_id FROM webauthn_credentials WHERE user_id = ?').all(userId);

    const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userID: Buffer.from(String(userId)),
        userName: user.username,
        attestationType: 'none',
        excludeCredentials: existing.map((c) => ({ id: c.credential_id })),
        authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'discouraged',
        },
    });

    setChallenge(registrationChallenges, userId, options.challenge);
    res.json(options);
});

router.post('/register-verify', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const expectedChallenge = takeChallenge(registrationChallenges, userId);
    if (!expectedChallenge) {
        return res.status(400).json({ error: 'Challenge de registro expirado, tente novamente' });
    }

    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response: req.body,
            expectedChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
        });
    } catch (err) {
        return res.status(400).json({ error: `Falha ao verificar dispositivo: ${err.message}` });
    }

    if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: 'Nao foi possivel verificar o dispositivo' });
    }

    const { credential } = verification.registrationInfo;
    const fingerprint = deviceFingerprint(req);

    db.prepare(
        `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_fingerprint, transports, label)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
        userId,
        credential.id,
        Buffer.from(credential.publicKey).toString('base64'),
        credential.counter,
        fingerprint,
        JSON.stringify(credential.transports || []),
        req.body.deviceLabel || null
    );

    res.json({ ok: true });
});

router.get('/devices', authMiddleware, (req, res) => {
    const rows = db
        .prepare('SELECT id, label, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC')
        .all(req.user.id);
    res.json(rows);
});

router.delete('/devices/:id', authMiddleware, (req, res) => {
    db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
});

// --- Login com biometria (ainda sem sessao/cookie) ---

router.post('/login-options', async (req, res) => {
    const { userId } = req.body;
    const fingerprint = deviceFingerprint(req);
    const cred = db
        .prepare('SELECT credential_id FROM webauthn_credentials WHERE user_id = ? AND device_fingerprint = ?')
        .get(userId, fingerprint);

    if (!cred) {
        return res.status(404).json({ error: 'Nenhuma biometria registrada para este dispositivo' });
    }

    const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        userVerification: 'required',
        allowCredentials: [{ id: cred.credential_id }],
    });

    setChallenge(authenticationChallenges, userId, options.challenge);
    res.json(options);
});

router.post('/login-verify', async (req, res) => {
    const { userId } = req.body;
    const expectedChallenge = takeChallenge(authenticationChallenges, userId);
    if (!expectedChallenge) {
        return res.status(400).json({ error: 'Challenge expirado, tente novamente' });
    }

    const fingerprint = deviceFingerprint(req);
    const storedCred = db
        .prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? AND device_fingerprint = ?')
        .get(userId, fingerprint);

    if (!storedCred) {
        return res.status(401).json({ error: 'Credencial nao encontrada para este dispositivo' });
    }

    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response: req.body,
            expectedChallenge,
            expectedOrigin: ORIGIN,
            expectedRPID: RP_ID,
            credential: {
                id: storedCred.credential_id,
                publicKey: Buffer.from(storedCred.public_key, 'base64'),
                counter: storedCred.counter,
            },
        });
    } catch (err) {
        return res.status(400).json({ error: `Falha na verificacao biometrica: ${err.message}` });
    }

    if (!verification.verified) {
        return res.status(401).json({ error: 'Verificacao biometrica invalida' });
    }

    db.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        verification.authenticationInfo.newCounter,
        storedCred.id
    );

    // Invalida o codigo por e-mail que ficou pendente desde o /auth/login.
    twoFactorStore.delete(userId);
    completeLogin(userId, fingerprint, res);
    res.json({ message: 'Autenticado com sucesso' });
});

export default router;
