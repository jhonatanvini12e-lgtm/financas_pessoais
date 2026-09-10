import express from 'express';
import db from '../db/index.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name').all(req.user.householdId));
});

router.post('/', (req, res) => {
    const { name, type, keywords, budget_limit } = req.body;
    if (!name || !['INCOME', 'EXPENSE'].includes(type)) {
        return res.status(400).json({ error: 'name e type (INCOME|EXPENSE) sao obrigatorios' });
    }

    const info = db
        .prepare('INSERT INTO categories (user_id, name, type, keywords, budget_limit) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.householdId, name, type, keywords || '', budget_limit || 0);
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
    const category = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.householdId);
    if (!category) return res.status(404).json({ error: 'Categoria nao encontrada' });

    const { name, type, keywords, budget_limit } = req.body;
    db.prepare('UPDATE categories SET name = ?, type = ?, keywords = ?, budget_limit = ? WHERE id = ?').run(
        name ?? category.name,
        type ?? category.type,
        keywords ?? category.keywords,
        budget_limit ?? category.budget_limit,
        category.id
    );
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(category.id));
});

router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(req.params.id, req.user.householdId);
    if (result.changes === 0) return res.status(404).json({ error: 'Categoria nao encontrada' });
    res.json({ ok: true });
});

export default router;
