import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { JWT_SECRET, AUTH_COOKIE_NAME } from '../config/jwt.js';

const INACTIVITY_MS = budgetParams.inactivityTimeoutMinutes * 60 * 1000;

// SQLite grava CURRENT_TIMESTAMP como 'YYYY-MM-DD HH:MM:SS' em UTC sem timezone.
const parseSqliteUtc = (value) => new Date(value.replace(' ', 'T') + 'Z').getTime();

export function authMiddleware(req, res, next) {
    const token = req.cookies?.[AUTH_COOKIE_NAME] || null;
    if (!token) {
        return res.status(401).json({ error: 'Token ausente', reason: 'UNAUTHORIZED' });
    }

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Token invalido ou expirado', reason: 'UNAUTHORIZED' });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE jti = ? AND revoked = 0').get(payload.jti);
    if (!session) {
        return res.status(401).json({ error: 'Sessao invalida', reason: 'UNAUTHORIZED' });
    }

    if (Date.now() - parseSqliteUtc(session.last_activity) > INACTIVITY_MS) {
        return res.status(401).json({
            error: 'Sessao expirada por inatividade',
            reason: 'INACTIVE',
            userId: session.user_id,
        });
    }

    db.prepare('UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?').run(session.id);

    // householdId e o "dono" dos dados financeiros: igual ao id de login,
    // a menos que essa conta esteja vinculada a outra (users.household_id).
    const user = db.prepare('SELECT household_id FROM users WHERE id = ?').get(session.user_id);
    req.user = {
        id: session.user_id,
        householdId: user?.household_id || session.user_id,
        sessionId: session.id,
    };
    next();
}
