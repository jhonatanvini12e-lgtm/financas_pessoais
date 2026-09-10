import express from 'express';
import db from '../db/index.js';
import {
    getInvestmentTrackStatus,
    getGoalsPlans,
    getTurningPointProjection,
    getInvestmentRecommendation,
} from '../services/investmentCalculator.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM investments WHERE user_id = ? ORDER BY id').all(req.user.householdId));
});

router.get('/track-status', (req, res) => {
    res.json(getInvestmentTrackStatus(req.user.householdId));
});

router.get('/recommendation', async (req, res) => {
    try {
        res.json(await getInvestmentRecommendation(req.user.householdId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/turning-point', (req, res) => {
    const monthlyContribution = req.query.monthly_contribution ? Number(req.query.monthly_contribution) : undefined;
    res.json(getTurningPointProjection(req.user.householdId, { monthlyContribution }));
});

router.post('/', (req, res) => {
    const status = getInvestmentTrackStatus(req.user.householdId);
    const { type, name, amount_invested, current_value, expected_monthly_return_rate } = req.body;

    if (!status.canSuggestOtherAssets && type !== 'RESERVA_EMERGENCIA') {
        return res.status(409).json({
            error: 'A Reserva de Emergencia ainda nao foi concluida. Complete-a antes de registrar outros ativos.',
            emergencyFund: status.emergencyFund,
        });
    }

    if (!type || !name || amount_invested == null || current_value == null) {
        return res.status(400).json({ error: 'type, name, amount_invested e current_value sao obrigatorios' });
    }

    const info = db
        .prepare(
            `INSERT INTO investments (user_id, type, name, amount_invested, current_value, expected_monthly_return_rate)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(req.user.householdId, type, name, amount_invested, current_value, expected_monthly_return_rate || null);
    res.status(201).json(db.prepare('SELECT * FROM investments WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM investments WHERE id = ? AND user_id = ?').run(req.params.id, req.user.householdId);
    if (result.changes === 0) return res.status(404).json({ error: 'Investimento nao encontrado' });
    res.json({ ok: true });
});

router.get('/goals', (req, res) => {
    res.json(getGoalsPlans(req.user.householdId));
});

router.post('/goals', (req, res) => {
    const { name, target_amount, target_date, priority } = req.body;
    if (!name || target_amount == null || !target_date) {
        return res.status(400).json({ error: 'name, target_amount e target_date sao obrigatorios' });
    }

    const info = db
        .prepare('INSERT INTO investment_goals (user_id, name, target_amount, target_date, priority) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.householdId, name, target_amount, target_date, priority || 0);
    res.status(201).json(db.prepare('SELECT * FROM investment_goals WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/goals/:id', (req, res) => {
    const result = db
        .prepare('DELETE FROM investment_goals WHERE id = ? AND user_id = ?')
        .run(req.params.id, req.user.householdId);
    if (result.changes === 0) return res.status(404).json({ error: 'Meta nao encontrada' });
    res.json({ ok: true });
});

export default router;
