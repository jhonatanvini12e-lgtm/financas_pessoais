import express from 'express';
import db from '../db/index.js';
import { getCardInvoice, getGlobalCreditUsage } from '../services/cardService.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM credit_cards WHERE user_id = ? ORDER BY id').all(req.user.id));
});

router.get('/usage', (req, res) => {
    res.json(getGlobalCreditUsage(req.user.id));
});

router.get('/:id/invoice', (req, res) => {
    const card = db.prepare('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!card) return res.status(404).json({ error: 'Cartao nao encontrado' });
    res.json(getCardInvoice(card));
});

router.post('/', (req, res) => {
    const { card_name, credit_limit, closing_day, due_day, provider } = req.body;
    if (!card_name || !credit_limit || !closing_day || !due_day) {
        return res.status(400).json({ error: 'card_name, credit_limit, closing_day e due_day sao obrigatorios' });
    }

    const info = db
        .prepare(
            'INSERT INTO credit_cards (user_id, card_name, credit_limit, closing_day, due_day, provider) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(req.user.id, card_name, credit_limit, closing_day, due_day, provider || null);
    res.status(201).json(db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
    const card = db.prepare('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!card) return res.status(404).json({ error: 'Cartao nao encontrado' });

    const { card_name, credit_limit, closing_day, due_day, provider } = req.body;
    db.prepare(
        'UPDATE credit_cards SET card_name = ?, credit_limit = ?, closing_day = ?, due_day = ?, provider = ? WHERE id = ?'
    ).run(
        card_name ?? card.card_name,
        credit_limit ?? card.credit_limit,
        closing_day ?? card.closing_day,
        due_day ?? card.due_day,
        provider ?? card.provider,
        card.id
    );
    res.json(db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(card.id));
});

router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM credit_cards WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Cartao nao encontrado' });
    res.json({ ok: true });
});

export default router;
