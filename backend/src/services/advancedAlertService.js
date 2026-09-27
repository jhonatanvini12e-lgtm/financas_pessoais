import db from '../db/index.js';
import { raiseAlert, alreadyAlertedToday } from './notificationEngine.js';
import { getPreferences } from './alertPreferencesService.js';
import {
    sendCategorySpendingAlert,
    sendMonthlyCeilingAlert,
    sendLargePurchaseAlert,
    sendCardInvoiceLimitAlert,
    sendLowBalanceAlert,
    sendRelevantTransactionAlert,
    sendDailySummaryEmail,
    sendWeeklySummaryEmail,
    sendMonthlySummaryEmail,
    sendPeriodComparisonEmail,
} from './emailService.js';

function fmt(value) {
    return `R$ ${Math.abs(value).toFixed(2).replace('.', ',')}`;
}

// -- Gasto semanal por categoria -----------------------------------------

export function checkCategorySpendingWeekly(userId) {
    const prefs = getPreferences(userId);
    if (!prefs.cat_spending_enabled) return;

    const rows = db
        .prepare(
            `SELECT COALESCE(c.name, 'Sem categoria') as category_name, SUM(ABS(t.amount)) as total
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.user_id = ? AND t.amount < 0
               AND t.date >= date('now', '-7 days')
             GROUP BY t.category_id`
        )
        .all(userId);

    for (const row of rows) {
        if (row.total >= prefs.cat_spending_threshold) {
            const key = `cat_spending_${row.category_name}`;
            if (alreadyAlertedToday(userId, key, row.category_name)) continue;
            raiseAlert({
                userId,
                type: key,
                severity: 'WARNING',
                message: `Categoria "${row.category_name}" gastou ${fmt(row.total)} nos ultimos 7 dias (limite: ${fmt(prefs.cat_spending_threshold)})`,
                emailFn: () => sendCategorySpendingAlert(row.category_name, row.total, prefs.cat_spending_threshold),
            });
        }
    }
}

// -- Total mensal acima do teto ------------------------------------------

export function checkMonthlyCeiling(userId) {
    const prefs = getPreferences(userId);
    if (!prefs.monthly_ceiling_enabled) return;

    const month = new Date().toISOString().slice(0, 7);
    const { total } = db
        .prepare(
            `SELECT COALESCE(SUM(ABS(amount)), 0) as total
             FROM transactions
             WHERE user_id = ? AND amount < 0
               AND strftime('%Y-%m', date) = ?`
        )
        .get(userId, month);

    if (total >= prefs.monthly_ceiling_amount) {
        if (alreadyAlertedToday(userId, 'monthly_ceiling', month)) return;
        raiseAlert({
            userId,
            type: 'monthly_ceiling',
            severity: 'CRITICAL',
            message: `Gasto mensal atingiu ${fmt(total)} em ${month} (teto: ${fmt(prefs.monthly_ceiling_amount)})`,
            emailFn: () => sendMonthlyCeilingAlert(total, prefs.monthly_ceiling_amount, month),
        });
    }
}

// -- Compra acima de valor especifico (chamado ao inserir transacao) -----

export function checkLargePurchase(userId, amount, description) {
    const prefs = getPreferences(userId);
    if (!prefs.large_purchase_enabled) return;
    if (amount >= 0) return; // somente saidas

    const absAmount = Math.abs(amount);
    if (absAmount >= prefs.large_purchase_amount) {
        raiseAlert({
            userId,
            type: 'large_purchase',
            severity: 'WARNING',
            message: `Compra de ${fmt(absAmount)} registrada${description ? `: "${description}"` : ''} (limite: ${fmt(prefs.large_purchase_amount)})`,
            emailFn: () => sendLargePurchaseAlert(absAmount, description, prefs.large_purchase_amount),
        });
    }
}

// -- Fatura de cartao ultrapassando valor --------------------------------

export function checkCardInvoiceLimits(userId) {
    const prefs = getPreferences(userId);
    if (!prefs.card_invoice_limit_enabled) return;

    const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
    for (const card of cards) {
        const { total } = db
            .prepare(
                `SELECT COALESCE(SUM(ABS(amount)), 0) as total
                 FROM transactions
                 WHERE user_id = ? AND card_id = ? AND amount < 0
                   AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')`
            )
            .get(userId, card.id);

        if (total >= prefs.card_invoice_limit_amount) {
            if (alreadyAlertedToday(userId, `card_invoice_limit_${card.id}`, card.name)) continue;
            raiseAlert({
                userId,
                type: `card_invoice_limit_${card.id}`,
                severity: 'WARNING',
                message: `Fatura do cartao "${card.name}" atingiu ${fmt(total)} (limite: ${fmt(prefs.card_invoice_limit_amount)})`,
                emailFn: () => sendCardInvoiceLimitAlert(card.name, total, prefs.card_invoice_limit_amount),
            });
        }
    }
}

// -- Saldo abaixo de valor minimo ----------------------------------------

export function checkLowBalance(userId) {
    const prefs = getPreferences(userId);
    if (!prefs.low_balance_enabled) return;

    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
    for (const acc of accounts) {
        const { saldo } = db
            .prepare(
                `SELECT COALESCE(SUM(amount), 0) as saldo
                 FROM transactions
                 WHERE user_id = ? AND account_id = ?`
            )
            .get(userId, acc.id);

        if (saldo < prefs.low_balance_amount) {
            if (alreadyAlertedToday(userId, `low_balance_${acc.id}`, acc.name)) continue;
            raiseAlert({
                userId,
                type: `low_balance_${acc.id}`,
                severity: 'WARNING',
                message: `Saldo da conta "${acc.name}" esta em ${fmt(saldo)} (minimo: ${fmt(prefs.low_balance_amount)})`,
                emailFn: () => sendLowBalanceAlert(acc.name, saldo, prefs.low_balance_amount),
            });
        }
    }
}

// -- Entrada ou saida relevante (chamado ao inserir transacao) -----------

export function checkRelevantTransaction(userId, amount, description) {
    const prefs = getPreferences(userId);
    if (!prefs.relevant_tx_enabled) return;

    const absAmount = Math.abs(amount);
    if (absAmount >= prefs.relevant_tx_amount) {
        const tipo = amount > 0 ? 'Entrada' : 'Saida';
        raiseAlert({
            userId,
            type: 'relevant_tx',
            severity: 'INFO',
            message: `${tipo} relevante de ${fmt(absAmount)}${description ? `: "${description}"` : ''}`,
            emailFn: () => sendRelevantTransactionAlert(tipo, absAmount, description),
        });
    }
}

// -- Resumo diario -------------------------------------------------------

export function sendDailySummary(userId) {
    const prefs = getPreferences(userId);
    if (!prefs.daily_summary_enabled) return;

    const today = new Date().toISOString().slice(0, 10);
    const rows = db
        .prepare(
            `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as entradas,
                    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as saidas,
                    COUNT(*) as qtd
             FROM transactions WHERE user_id = ? AND date = ?`
        )
        .get(userId, today);

    raiseAlert({
        userId,
        type: 'daily_summary',
        severity: 'INFO',
        message: `Resumo de hoje (${today}): ${rows.qtd} lancamentos, entradas ${fmt(rows.entradas)}, saidas ${fmt(rows.saidas)}`,
        emailFn: () => sendDailySummaryEmail(today, rows.entradas, rows.saidas, rows.qtd),
    });
}

// -- Resumo semanal ------------------------------------------------------

export function sendWeeklySummary(userId) {
    const prefs = getPreferences(userId);
    if (!prefs.weekly_summary_enabled) return;

    const rows = db
        .prepare(
            `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as entradas,
                    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as saidas,
                    COUNT(*) as qtd
             FROM transactions WHERE user_id = ? AND date >= date('now', '-7 days')`
        )
        .get(userId);

    const topCats = db
        .prepare(
            `SELECT COALESCE(c.name, 'Sem categoria') as cat, SUM(ABS(t.amount)) as total
             FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.user_id = ? AND t.amount < 0 AND t.date >= date('now', '-7 days')
             GROUP BY t.category_id ORDER BY total DESC LIMIT 3`
        )
        .all(userId);

    raiseAlert({
        userId,
        type: 'weekly_summary',
        severity: 'INFO',
        message: `Resumo da semana: ${rows.qtd} lancamentos, saidas ${fmt(rows.saidas)}`,
        emailFn: () => sendWeeklySummaryEmail(rows.entradas, rows.saidas, rows.qtd, topCats),
    });
}

// -- Resumo mensal -------------------------------------------------------

export function sendMonthlySummary(userId) {
    const prefs = getPreferences(userId);
    if (!prefs.monthly_summary_enabled) return;

    const month = new Date().toISOString().slice(0, 7);
    const rows = db
        .prepare(
            `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) as entradas,
                    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) as saidas,
                    COUNT(*) as qtd
             FROM transactions WHERE user_id = ? AND strftime('%Y-%m', date) = ?`
        )
        .get(userId, month);

    const topCats = db
        .prepare(
            `SELECT COALESCE(c.name, 'Sem categoria') as cat, SUM(ABS(t.amount)) as total
             FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.user_id = ? AND t.amount < 0 AND strftime('%Y-%m', t.date) = ?
             GROUP BY t.category_id ORDER BY total DESC LIMIT 5`
        )
        .all(userId, month);

    raiseAlert({
        userId,
        type: 'monthly_summary',
        severity: 'INFO',
        message: `Resumo de ${month}: ${rows.qtd} lancamentos, saidas ${fmt(rows.saidas)}, entradas ${fmt(rows.entradas)}`,
        emailFn: () => sendMonthlySummaryEmail(month, rows.entradas, rows.saidas, rows.qtd, topCats),
    });
}

// -- Comparativo com periodo anterior ------------------------------------

export function checkPeriodComparison(userId) {
    const prefs = getPreferences(userId);
    if (!prefs.period_comparison_enabled) return;

    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = prevDate.toISOString().slice(0, 7);

    const getMonthTotal = (month) =>
        db
            .prepare(
                `SELECT COALESCE(SUM(ABS(amount)), 0) as total
                 FROM transactions WHERE user_id = ? AND amount < 0
                   AND strftime('%Y-%m', date) = ?`
            )
            .get(userId, month).total;

    const current = getMonthTotal(currentMonth);
    const previous = getMonthTotal(prevMonth);
    if (previous === 0) return;

    const diffPct = ((current - previous) / previous) * 100;
    const sign = diffPct > 0 ? '+' : '';
    raiseAlert({
        userId,
        type: 'period_comparison',
        severity: diffPct > 10 ? 'WARNING' : 'INFO',
        message: `Gastos de ${currentMonth}: ${fmt(current)} vs ${prevMonth}: ${fmt(previous)} (${sign}${diffPct.toFixed(1)}%)`,
        emailFn: () => sendPeriodComparisonEmail(currentMonth, current, prevMonth, previous, diffPct),
    });
}
