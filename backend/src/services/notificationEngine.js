import db from '../db/index.js';

// Ponto unico de gravacao de alertas. Os servicos de dominio chamam raise()
// e opcionalmente passam uma funcao de envio de e-mail (ja "curried" com os
// dados do evento) para nao duplicar logica de template aqui.
export function raiseAlert({ userId, type, message, severity = 'INFO', emailFn = null }) {
    const info = db
        .prepare('INSERT INTO alerts (user_id, type, severity, message, emailed) VALUES (?, ?, ?, ?, ?)')
        .run(userId, type, severity, message, emailFn ? 1 : 0);

    if (emailFn) {
        Promise.resolve(emailFn()).catch((err) => console.error('Falha ao enviar email de alerta:', err.message));
    }

    return info.lastInsertRowid;
}

export function listAlerts(userId, { onlyUnread = false } = {}) {
    const query = onlyUnread
        ? 'SELECT * FROM alerts WHERE user_id = ? AND read = 0 ORDER BY created_at DESC'
        : 'SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200';
    return db.prepare(query).all(userId);
}

export function markAlertRead(userId, alertId) {
    db.prepare('UPDATE alerts SET read = 1 WHERE id = ? AND user_id = ?').run(alertId, userId);
}

export function deleteAlert(userId, alertId) {
    const result = db.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').run(alertId, userId);
    return result.changes > 0;
}

// Evita spam: nao repete o mesmo tipo de alerta para o mesmo "assunto" no mesmo dia.
export function alreadyAlertedToday(userId, type, messageContains) {
    const row = db
        .prepare(
            `SELECT id FROM alerts
             WHERE user_id = ? AND type = ? AND message LIKE ?
               AND date(created_at) = date('now')`
        )
        .get(userId, type, `%${messageContains}%`);
    return Boolean(row);
}
