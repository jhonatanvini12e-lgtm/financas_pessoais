import express from 'express';
import db from '../db/index.js';
import { getBudgetStatus } from '../services/budgetEngine.js';
import { getGlobalCreditUsage, getCardInvoice } from '../services/cardService.js';
import { getDebtSummary } from '../services/debtCalculator.js';
import { getContributionSuggestions } from '../services/envelopeService.js';
import { listAlerts } from '../services/notificationEngine.js';

const router = express.Router();

router.get('/', (req, res) => {
    const userId = req.user.id;

    // Mesmo calculo de accounts.js: saldo inicial da conta + lancamentos
    // feitos depois (manuais ou import de extrato/fatura).
    const totalBalance = db
        .prepare(
            `SELECT COALESCE(SUM(
                a.balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id), 0)
             ), 0) as total
             FROM accounts a
             WHERE a.user_id = ?`
        )
        .get(userId).total;

    const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
    const upcomingInvoices = cards
        .map((card) => getCardInvoice(card))
        .filter((invoice) => invoice.total > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    res.json({
        totalBalance,
        budget: getBudgetStatus(userId),
        creditUsage: getGlobalCreditUsage(userId),
        upcomingInvoices,
        debtSummary: getDebtSummary(userId),
        envelopeSuggestions: getContributionSuggestions(userId),
        recentAlerts: listAlerts(userId).slice(0, 10),
    });
});

export default router;
