import express from 'express';
import db from '../db/index.js';
import { askAssistant } from '../services/financialAssistantService.js';

const router = express.Router();

const MAX_MESSAGE_LENGTH = 4000;
const HISTORY_LIMIT = 50;

router.get('/', (req, res) => {
    const messages = db
        .prepare(
            `SELECT id, role, content, created_by, created_at FROM ai_chat_messages
             WHERE user_id = ? ORDER BY id DESC LIMIT ?`
        )
        .all(req.user.householdId, HISTORY_LIMIT)
        .reverse();
    res.json(messages);
});

router.post('/', async (req, res) => {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Mensagem vazia' });
    if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `Mensagem muito longa (maximo ${MAX_MESSAGE_LENGTH} caracteres)` });
    }

    const history = db
        .prepare(
            `SELECT role, content FROM ai_chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?`
        )
        .all(req.user.householdId, HISTORY_LIMIT)
        .reverse();

    const insertUser = db
        .prepare('INSERT INTO ai_chat_messages (user_id, created_by, role, content) VALUES (?, ?, ?, ?)')
        .run(req.user.householdId, req.user.id, 'user', message);

    // A mensagem do usuario ja foi gravada mesmo se a IA falhar -- fica no
    // historico sem resposta, e o usuario pode tentar de novo, em vez de
    // perder o que digitou.
    let reply;
    try {
        reply = await askAssistant(req.user.householdId, history, message);
    } catch (err) {
        return res.status(502).json({ error: err.message });
    }

    const insertAssistant = db
        .prepare('INSERT INTO ai_chat_messages (user_id, created_by, role, content) VALUES (?, NULL, ?, ?)')
        .run(req.user.householdId, 'assistant', reply);

    res.status(201).json({
        userMessage: db.prepare('SELECT id, role, content, created_by, created_at FROM ai_chat_messages WHERE id = ?').get(insertUser.lastInsertRowid),
        assistantMessage: db.prepare('SELECT id, role, content, created_by, created_at FROM ai_chat_messages WHERE id = ?').get(insertAssistant.lastInsertRowid),
    });
});

router.delete('/', (req, res) => {
    db.prepare('DELETE FROM ai_chat_messages WHERE user_id = ?').run(req.user.householdId);
    res.json({ ok: true });
});

export default router;
