import express from 'express';
import db from '../db/index.js';
import { getBudgetStatus } from '../services/budgetEngine.js';
import { getGlobalCreditUsage } from '../services/cardService.js';
import { getDebtSummary } from '../services/debtCalculator.js';
import { getContributionSuggestions } from '../services/envelopeService.js';
import { listAlerts } from '../services/notificationEngine.js';
import { getAllBillsStatus } from '../services/billsService.js';

const router = express.Router();

function daysAgoISO(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

function monthsAgoISO(months) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

router.get('/', (req, res) => {
    const userId = req.user.householdId;

    // Mesmo calculo de accounts.js: saldo inicial da conta + lancamentos
    // feitos depois (manuais ou import de extrato/fatura).
    const totalBalance = db
        .prepare(
            `SELECT COALESCE(SUM(
                a.balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id AND t.user_id = a.user_id), 0)
             ), 0) as total
             FROM accounts a
             WHERE a.user_id = ?`
        )
        .get(userId).total;

    const accountsCount = db.prepare('SELECT COUNT(*) as c FROM accounts WHERE user_id = ?').get(userId).c;

    // Gastos dos ultimos 7 dias (janela rolante, nao semana de calendario) --
    // alimenta o grafico "Gastos da semana" do dashboard.
    const spendingRows = db
        .prepare(
            `SELECT date(date) as day, SUM(ABS(amount)) as total
             FROM transactions
             WHERE user_id = ? AND date >= ? AND amount < 0
             GROUP BY day`
        )
        .all(userId, daysAgoISO(6));
    const spendingByDay = Object.fromEntries(spendingRows.map((r) => [r.day, r.total]));
    const weeklySpending = Array.from({ length: 7 }, (_, i) => 6 - i).map((daysAgo) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        const iso = d.toISOString().slice(0, 10);
        return { date: iso, label: WEEKDAY_LABELS[d.getDay()], total: spendingByDay[iso] || 0 };
    });

    // Saldo liquido (entradas - saidas) dos ultimos 6 meses -- alimenta o
    // sparkline de "Fluxo de caixa".
    const cashFlow = db
        .prepare(
            `SELECT strftime('%Y-%m', date) as month,
                    SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expense
             FROM transactions
             WHERE user_id = ? AND date >= ?
             GROUP BY month ORDER BY month`
        )
        .all(userId, monthsAgoISO(6))
        .map((m) => ({ month: m.month, income: m.income, expense: m.expense, net: m.income - m.expense }));

    res.json({
        totalBalance,
        accountsCount,
        budget: getBudgetStatus(userId),
        creditUsage: getGlobalCreditUsage(userId),
        bills: getAllBillsStatus(userId),
        debtSummary: getDebtSummary(userId),
        envelopeSuggestions: getContributionSuggestions(userId),
        recentAlerts: listAlerts(userId).slice(0, 10),
        weeklySpending,
        cashFlow,
    });
});

export default router;
