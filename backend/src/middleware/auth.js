import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';

const INACTIVITY_MS = budgetParams.inactivityTimeoutMinutes * 60 * 1000;

// SQLite grava CURRENT_TIMESTAMP como 'YYYY-MM-DD HH:MM:SS' em UTC sem timezone.
const parseSqliteUtc = (value) => new Date(value.replace(' ', 'T') + 'Z').getTime();

export function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'Token ausente', reason: 'UNAUTHORIZED' });
    }

    let payload;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET || 'secret_jwt_key');
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

    req.user = { id: session.user_id, sessionId: session.id };
    next();
}
