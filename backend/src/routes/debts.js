import express from 'express';
import db from '../db/index.js';
import { compareStrategies, getDebtPayoffPlan, getDebtSummary, simulateRenegotiation } from '../services/debtCalculator.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM debts WHERE user_id = ? ORDER BY current_balance DESC').all(req.user.householdId));
});

router.get('/summary', (req, res) => {
    res.json(getDebtSummary(req.user.householdId));
});

router.get('/payoff-plan', (req, res) => {
    res.json(getDebtPayoffPlan(req.user.householdId));
});

router.get('/simulate', (req, res) => {
    const extraBudget = Number(req.query.extra_budget) || 0;
    res.json(compareStrategies(req.user.householdId, extraBudget));
});

router.post('/simulate-renegotiation', (req, res) => {
    const { currentBalance, interestRateMonthly, minimumPayment, discountPercent, installments, newMonthlyRate } = req.body;
    if (currentBalance == null || interestRateMonthly == null || minimumPayment == null || discountPercent == null) {
        return res.status(400).json({ error: 'currentBalance, interestRateMonthly, minimumPayment e discountPercent sao obrigatorios' });
    }
    res.json(
        simulateRenegotiation({ currentBalance, interestRateMonthly, minimumPayment, discountPercent, installments, newMonthlyRate })
    );
});

router.post('/', (req, res) => {
    const { name, creditor, principal, current_balance, interest_rate_monthly, minimum_payment, due_day } = req.body;
    if (!name || principal == null || current_balance == null || interest_rate_monthly == null || minimum_payment == null) {
        return res.status(400).json({ error: 'Campos obrigatorios faltando' });
    }

    const info = db
        .prepare(
            `INSERT INTO debts (user_id, name, creditor, principal, current_balance, interest_rate_monthly, minimum_payment, due_day)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(req.user.householdId, name, creditor || null, principal, current_balance, interest_rate_monthly, minimum_payment, due_day || null);
    res.status(201).json(db.prepare('SELECT * FROM debts WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
    const debt = db.prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.householdId);
    if (!debt) return res.status(404).json({ error: 'Divida nao encontrada' });

    const { name, creditor, current_balance, interest_rate_monthly, minimum_payment, due_day, status } = req.body;
    db.prepare(
        `UPDATE debts SET name = ?, creditor = ?, current_balance = ?, interest_rate_monthly = ?, minimum_payment = ?, due_day = ?, status = ?
         WHERE id = ?`
    ).run(
        name ?? debt.name,
        creditor ?? debt.creditor,
        current_balance ?? debt.current_balance,
        interest_rate_monthly ?? debt.interest_rate_monthly,
        minimum_payment ?? debt.minimum_payment,
        due_day ?? debt.due_day,
        status ?? debt.status,
        debt.id
    );
    res.json(db.prepare('SELECT * FROM debts WHERE id = ?').get(debt.id));
});

router.post('/:id/payments', (req, res) => {
    const debt = db.prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.householdId);
    if (!debt) return res.status(404).json({ error: 'Divida nao encontrada' });

    const amount = Number(req.body.amount);
    db.prepare('INSERT INTO debt_payments (debt_id, amount, note) VALUES (?, ?, ?)').run(debt.id, amount, req.body.note || null);
    const newBalance = Math.max(debt.current_balance - amount, 0);
    db.prepare('UPDATE debts SET current_balance = ?, status = ? WHERE id = ?').run(
        newBalance,
        newBalance === 0 ? 'PAID' : debt.status,
        debt.id
    );
    res.json(db.prepare('SELECT * FROM debts WHERE id = ?').get(debt.id));
});

router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM debts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.householdId);
    if (result.changes === 0) return res.status(404).json({ error: 'Divida nao encontrada' });
    res.json({ ok: true });
});

export default router;
