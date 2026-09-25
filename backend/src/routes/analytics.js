import express from 'express';
import db from '../db/index.js';
import { getCurrentInvoicePeriod } from '../services/cardService.js';

const router = express.Router();

function monthsAgoISO(months) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
}

function clampMonths(value) {
    return Math.min(Math.max(Number(value) || 6, 1), 36);
}

// Gasto mensal total (soma das saidas, amount < 0), com filtro opcional por
// cartao e por quem realizou o gasto (created_by).
router.get('/monthly-spending', (req, res) => {
    const since = monthsAgoISO(clampMonths(req.query.months));
    const { card_id, created_by } = req.query;

    let query = `SELECT strftime('%Y-%m', date) as month, SUM(ABS(amount)) as total
                 FROM transactions
                 WHERE user_id = ? AND date >= ? AND amount < 0`;
    const params = [req.user.householdId, since];
    if (card_id) { query += ' AND card_id = ?'; params.push(card_id); }
    if (created_by) { query += ' AND created_by = ?'; params.push(created_by); }
    query += ' GROUP BY month ORDER BY month';

    res.json({ monthly: db.prepare(query).all(...params) });
});

// Fluxo de caixa: entradas (amount >= 0) e saidas (amount < 0) por mes, saldo
// liquido do mes e saldo acumulado ao longo do periodo.
router.get('/cash-flow', (req, res) => {
    const since = monthsAgoISO(clampMonths(req.query.months));

    const monthly = db
        .prepare(
            `SELECT strftime('%Y-%m', date) as month,
                    SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expense
             FROM transactions
             WHERE user_id = ? AND date >= ?
             GROUP BY month ORDER BY month`
        )
        .all(req.user.householdId, since);

    let cumulative = 0;
    const withNet = monthly.map((m) => {
        const net = m.income - m.expense;
        cumulative += net;
        return { ...m, net, cumulative };
    });

    res.json({ monthly: withNet });
});

// Limite de credito usado por cartao (fatura do ciclo atual, mesma logica de
// cardService.getCardInvoice), com filtro opcional por cartao e por quem
// realizou os gastos que compoem o valor usado.
router.get('/credit-usage', (req, res) => {
    const { card_id, created_by } = req.query;

    let cardsQuery = 'SELECT * FROM credit_cards WHERE user_id = ?';
    const cardsParams = [req.user.householdId];
    if (card_id) { cardsQuery += ' AND id = ?'; cardsParams.push(card_id); }
    const cards = db.prepare(`${cardsQuery} ORDER BY id`).all(...cardsParams);

    const byCard = cards.map((card) => {
        const { periodStart, periodEnd, dueDate } = getCurrentInvoicePeriod(card.closing_day, card.due_day);

        let usageQuery = `SELECT COALESCE(SUM(ABS(amount)), 0) as used
                           FROM transactions
                           WHERE card_id = ? AND user_id = ? AND date >= ? AND date <= ? AND amount < 0`;
        const usageParams = [
            card.id,
            req.user.householdId,
            periodStart.toISOString().slice(0, 10),
            periodEnd.toISOString().slice(0, 10),
        ];
        if (created_by) { usageQuery += ' AND created_by = ?'; usageParams.push(created_by); }
        const { used } = db.prepare(usageQuery).get(...usageParams);

        return {
            cardId: card.id,
            cardName: card.card_name,
            limit: card.credit_limit,
            used,
            ratio: card.credit_limit > 0 ? used / card.credit_limit : 0,
            dueDate: dueDate.toISOString().slice(0, 10),
        };
    });

    const totalLimit = byCard.reduce((sum, c) => sum + c.limit, 0);
    const totalUsed = byCard.reduce((sum, c) => sum + c.used, 0);

    res.json({
        totalLimit,
        totalUsed,
        usageRatio: totalLimit > 0 ? totalUsed / totalLimit : 0,
        byCard,
    });
});

// Numero de parcelamentos (compras parceladas, agrupadas por
// installment_group) em aberto, com filtro opcional por cartao e por quem
// realizou a compra. Cada parcelamento conta uma vez, independente de
// quantas parcelas ja foram lancadas.
router.get('/installments', (req, res) => {
    const { card_id, created_by } = req.query;

    let query = `SELECT installment_group, card_id, MAX(installment_total) as installment_total,
                        SUM(ABS(amount)) as group_total
                 FROM transactions
                 WHERE user_id = ? AND installment_group IS NOT NULL`;
    const params = [req.user.householdId];
    if (card_id) { query += ' AND card_id = ?'; params.push(card_id); }
    if (created_by) { query += ' AND created_by = ?'; params.push(created_by); }
    query += ' GROUP BY installment_group';

    const groups = db.prepare(query).all(...params);

    const cards = db.prepare('SELECT id, card_name FROM credit_cards WHERE user_id = ?').all(req.user.householdId);
    const cardNameById = new Map(cards.map((c) => [c.id, c.card_name]));

    const countByCard = new Map();
    for (const g of groups) {
        const key = g.card_id ?? 'none';
        countByCard.set(key, (countByCard.get(key) || 0) + 1);
    }

    const byCard = Array.from(countByCard.entries()).map(([key, count]) => ({
        cardId: key === 'none' ? null : key,
        cardName: key === 'none' ? 'Sem cartao' : cardNameById.get(key) || '-',
        count,
    }));

    res.json({
        total: groups.length,
        totalValue: groups.reduce((sum, g) => sum + g.group_total, 0),
        byCard,
    });
});

export default router;
