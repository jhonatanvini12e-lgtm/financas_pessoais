import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { JWT_SECRET, AUTH_COOKIE_NAME } from '../config/jwt.js';

const INACTIVITY_MS = budgetParams.inactivityTimeoutMinutes * 60 * 1000;

// SQLite grava CURRENT_TIMESTAMP como 'YYYY-MM-DD HH:MM:SS' em UTC sem timezone.
const parseSqliteUtc = (value) => new Date(value.replace(' ', 'T') + 'Z').getTime();

// Le e valida o cookie de sessao sem aplicar a checagem de inatividade --
// usado tanto pelo authMiddleware quanto por /auth/request-reauth, que
// precisa reconhecer uma sessao ja inativa (essa e a razao dela existir).
export function loadSessionFromRequest(req) {
    const token = req.cookies?.[AUTH_COOKIE_NAME] || null;
    if (!token) {
        return { error: 'Token ausente' };
    }

    let payload;
    try {
        payload = jwt.verify(token, JWT_SECRET);
    } catch {
        return { error: 'Token invalido ou expirado' };
    }

    const session = db.prepare('SELECT * FROM sessions WHERE jti = ? AND revoked = 0').get(payload.jti);
    if (!session) {
        return { error: 'Sessao invalida' };
    }

    return { session };
}

// Em caso de falha, responde 401 com `reason`:
//  - 'UNAUTHORIZED': sem cookie, token invalido/expirado ou sessao revogada -- exige login completo de novo.
//  - 'INACTIVE': sessao valida mas ociosa ha mais de inactivityTimeoutMinutes -- o front deve
//    chamar POST /auth/request-reauth (usa o mesmo cookie ainda presente) em vez de mandar pro login.
// Em sucesso, injeta `req.user = { id, householdId, sessionId }`.
export function authMiddleware(req, res, next) {
    const { session, error } = loadSessionFromRequest(req);
    if (error) {
        return res.status(401).json({ error, reason: 'UNAUTHORIZED' });
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
