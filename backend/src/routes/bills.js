import express from 'express';
import db from '../db/index.js';
import {
    getAllBillsStatus,
    markBillPaid,
    unmarkBillPaid,
    markCardInvoicePaid,
    unmarkCardInvoicePaid,
} from '../services/billsService.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json(getAllBillsStatus(req.user.id));
});

router.post('/', (req, res) => {
    const { name, category_id, expected_amount, due_day } = req.body;
    if (!name || due_day == null) {
        return res.status(400).json({ error: 'name e due_day sao obrigatorios' });
    }
    if (due_day < 1 || due_day > 31) {
        return res.status(400).json({ error: 'due_day deve estar entre 1 e 31' });
    }

    const info = db
        .prepare('INSERT INTO bills (user_id, name, category_id, expected_amount, due_day) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, name, category_id || null, expected_amount || 0, due_day);
    res.status(201).json(db.prepare('SELECT * FROM bills WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!bill) return res.status(404).json({ error: 'Conta nao encontrada' });

    const { name, category_id, expected_amount, due_day, active } = req.body;
    db.prepare(
        'UPDATE bills SET name = ?, category_id = ?, expected_amount = ?, due_day = ?, active = ? WHERE id = ?'
    ).run(
        name ?? bill.name,
        category_id ?? bill.category_id,
        expected_amount ?? bill.expected_amount,
        due_day ?? bill.due_day,
        active ?? bill.active,
        bill.id
    );
    res.json(db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id));
});

router.delete('/:id', (req, res) => {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!bill) return res.status(404).json({ error: 'Conta nao encontrada' });

    db.prepare('DELETE FROM bill_payments WHERE bill_id = ?').run(bill.id);
    db.prepare('DELETE FROM bills WHERE id = ?').run(bill.id);
    res.json({ ok: true });
});

router.post('/:id/pay', (req, res) => {
    try {
        res.json(markBillPaid(req.user.id, req.params.id, req.body));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/unpay', (req, res) => {
    try {
        res.json(unmarkBillPaid(req.user.id, req.params.id, req.body.period));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/card-invoices/:cardId/pay', (req, res) => {
    try {
        res.json(markCardInvoicePaid(req.user.id, req.params.cardId, req.body));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/card-invoices/:cardId/unpay', (req, res) => {
    try {
        res.json(unmarkCardInvoicePaid(req.user.id, req.params.cardId, req.body.period));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

export default router;
