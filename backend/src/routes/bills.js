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
    const { name, category_id, expected_amount, due_day, due_date, recurring } = req.body;
    const isRecurring = recurring !== false && recurring !== 0;

    if (!name) return res.status(400).json({ error: 'name e obrigatorio' });
    if (isRecurring && (due_day == null || due_day < 1 || due_day > 31)) {
        return res.status(400).json({ error: 'due_day (1-31) e obrigatorio para conta fixa' });
    }
    if (!isRecurring && !due_date) {
        return res.status(400).json({ error: 'due_date e obrigatorio para conta avulsa' });
    }

    const info = db
        .prepare(
            `INSERT INTO bills (user_id, name, category_id, expected_amount, due_day, recurring, due_date)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            req.user.id,
            name,
            category_id || null,
            expected_amount || 0,
            isRecurring ? due_day : null,
            isRecurring ? 1 : 0,
            isRecurring ? null : due_date
        );
    res.status(201).json(db.prepare('SELECT * FROM bills WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!bill) return res.status(404).json({ error: 'Conta nao encontrada' });

    const { name, category_id, expected_amount, due_day, due_date, recurring, active } = req.body;
    db.prepare(
        `UPDATE bills SET name = ?, category_id = ?, expected_amount = ?, due_day = ?, due_date = ?, recurring = ?, active = ?
         WHERE id = ?`
    ).run(
        name ?? bill.name,
        category_id ?? bill.category_id,
        expected_amount ?? bill.expected_amount,
        due_day ?? bill.due_day,
        due_date ?? bill.due_date,
        recurring != null ? (recurring ? 1 : 0) : bill.recurring,
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
