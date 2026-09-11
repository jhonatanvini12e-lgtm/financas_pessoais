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

// Invariante: conta fixa (recurring=true) precisa de due_day (1-31, repete
// todo mes); conta avulsa (recurring=false) precisa de due_date (data unica).
// Reaproveitada pelo POST e pelo PUT para nao deixar o PUT gravar um estado
// inconsistente (ex: recurring=true sem due_day).
function validateRecurringInvariant(isRecurring, due_day, due_date) {
    if (isRecurring && (due_day == null || due_day < 1 || due_day > 31)) {
        return 'due_day (1-31) e obrigatorio para conta fixa';
    }
    if (!isRecurring && !due_date) {
        return 'due_date e obrigatorio para conta avulsa';
    }
    return null;
}

router.get('/', (req, res) => {
    res.json(getAllBillsStatus(req.user.householdId));
});

router.post('/', (req, res) => {
    const { name, category_id, expected_amount, due_day, due_date, recurring } = req.body;
    const isRecurring = recurring !== false && recurring !== 0;

    if (!name) return res.status(400).json({ error: 'name e obrigatorio' });
    const invariantError = validateRecurringInvariant(isRecurring, due_day, due_date);
    if (invariantError) return res.status(400).json({ error: invariantError });

    const info = db
        .prepare(
            `INSERT INTO bills (user_id, name, category_id, expected_amount, due_day, recurring, due_date)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            req.user.householdId,
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
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.householdId);
    if (!bill) return res.status(404).json({ error: 'Conta nao encontrada' });

    const { name, category_id, expected_amount, due_day, due_date, recurring, active } = req.body;

    const effectiveRecurring = recurring != null ? recurring !== false && recurring !== 0 : Boolean(bill.recurring);
    const effectiveDueDay = due_day ?? bill.due_day;
    const effectiveDueDate = due_date ?? bill.due_date;
    const invariantError = validateRecurringInvariant(effectiveRecurring, effectiveDueDay, effectiveDueDate);
    if (invariantError) return res.status(400).json({ error: invariantError });

    db.prepare(
        `UPDATE bills SET name = ?, category_id = ?, expected_amount = ?, due_day = ?, due_date = ?, recurring = ?, active = ?
         WHERE id = ?`
    ).run(
        name ?? bill.name,
        category_id ?? bill.category_id,
        expected_amount ?? bill.expected_amount,
        effectiveRecurring ? effectiveDueDay : null,
        effectiveRecurring ? null : effectiveDueDate,
        effectiveRecurring ? 1 : 0,
        active ?? bill.active,
        bill.id
    );
    res.json(db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id));
});

router.delete('/:id', (req, res) => {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(req.params.id, req.user.householdId);
    if (!bill) return res.status(404).json({ error: 'Conta nao encontrada' });

    db.prepare('DELETE FROM bill_payments WHERE bill_id = ?').run(bill.id);
    db.prepare('DELETE FROM bills WHERE id = ?').run(bill.id);
    res.json({ ok: true });
});

router.post('/:id/pay', (req, res) => {
    try {
        res.json(markBillPaid(req.user.householdId, req.params.id, req.body));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/unpay', (req, res) => {
    try {
        res.json(unmarkBillPaid(req.user.householdId, req.params.id, req.body.period));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/card-invoices/:cardId/pay', (req, res) => {
    try {
        res.json(markCardInvoicePaid(req.user.householdId, req.params.cardId, req.body));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/card-invoices/:cardId/unpay', (req, res) => {
    try {
        res.json(unmarkCardInvoicePaid(req.user.householdId, req.params.cardId, req.body.period));
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

export default router;
