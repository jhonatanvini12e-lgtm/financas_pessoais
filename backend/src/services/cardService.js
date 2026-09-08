import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { raiseAlert, alreadyAlertedToday } from './notificationEngine.js';
import { sendCardDueAlert, sendCardLimitAlert } from './emailService.js';

// Dado o dia de fechamento/vencimento de um cartao, calcula o periodo da
// fatura atualmente aberta e a data de vencimento correspondente.
export function getCurrentInvoicePeriod(closingDay, dueDay, referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth();
    const today = referenceDate.getDate();

    const thisMonthClosing = new Date(year, month, closingDay);
    let periodEnd;
    let periodStart;

    if (today <= closingDay) {
        periodEnd = thisMonthClosing;
        periodStart = new Date(year, month - 1, closingDay + 1);
    } else {
        periodEnd = new Date(year, month + 1, closingDay);
        periodStart = new Date(year, month, closingDay + 1);
    }

    const dueMonthOffset = dueDay <= closingDay ? 1 : 0;
    const dueDate = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + dueMonthOffset, dueDay);

    return { periodStart, periodEnd, dueDate };
}

export function getCardInvoice(card, referenceDate = new Date()) {
    const { periodStart, periodEnd, dueDate } = getCurrentInvoicePeriod(card.closing_day, card.due_day, referenceDate);

    const rows = db
        .prepare(
            `SELECT * FROM transactions
             WHERE card_id = ? AND date >= ? AND date <= ?
             ORDER BY date DESC`
        )
        .all(card.id, periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10));

    const total = rows.reduce((sum, txn) => sum + Math.abs(txn.amount), 0);

    return {
        cardId: card.id,
        periodStart: periodStart.toISOString().slice(0, 10),
        periodEnd: periodEnd.toISOString().slice(0, 10),
        dueDate: dueDate.toISOString().slice(0, 10),
        total,
        transactions: rows,
    };
}

export function getGlobalCreditUsage(userId) {
    const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
    const totalLimit = cards.reduce((sum, c) => sum + c.credit_limit, 0);
    const totalUsage = cards.reduce((sum, c) => sum + getCardInvoice(c).total, 0);
    const usageRatio = totalLimit > 0 ? totalUsage / totalLimit : 0;

    return { totalLimit, totalUsage, usageRatio, cards: cards.length };
}

// Chamado pelo cron diario: verifica vencimentos proximos e uso global de credito.
export function runCardChecks(userId) {
    const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
    const now = new Date();

    for (const card of cards) {
        const invoice = getCardInvoice(card, now);
        const dueDate = new Date(invoice.dueDate);
        const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

        if (daysUntilDue === budgetParams.cardDueDateWarningDays && invoice.total > 0) {
            const key = `fatura-${card.id}-${invoice.dueDate}`;
            if (!alreadyAlertedToday(userId, 'CARD_DUE', key)) {
                raiseAlert({
                    userId,
                    type: 'CARD_DUE',
                    severity: 'WARNING',
                    message: `Fatura do cartao "${card.card_name}" (${key}) vence em ${invoice.dueDate}, valor R$ ${invoice.total.toFixed(2)}`,
                    emailFn: () => sendCardDueAlert(card.card_name, invoice.dueDate, invoice.total),
                });
            }
        }
    }

    const usage = getGlobalCreditUsage(userId);
    if (usage.usageRatio >= budgetParams.cardGlobalUsageAlertThreshold) {
        const key = `uso-credito-${new Date().toISOString().slice(0, 10)}`;
        if (!alreadyAlertedToday(userId, 'CARD_LIMIT_70', key)) {
            raiseAlert({
                userId,
                type: 'CARD_LIMIT_70',
                severity: 'WARNING',
                message: `Uso de credito global atingiu ${(usage.usageRatio * 100).toFixed(0)}% (${key})`,
                emailFn: () => sendCardLimitAlert(usage.usageRatio),
            });
        }
    }

    return usage;
}
