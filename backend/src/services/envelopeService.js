import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';

function monthlyAverages(userId, months = 3) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const sinceStr = since.toISOString().slice(0, 10);

    const rows = db
        .prepare(
            `SELECT strftime('%Y-%m', date) as month, amount
             FROM transactions
             WHERE user_id = ? AND date >= ?`
        )
        .all(userId, sinceStr);

    const byMonth = {};
    for (const row of rows) {
        byMonth[row.month] ??= { income: 0, expense: 0 };
        if (row.amount >= 0) byMonth[row.month].income += row.amount;
        else byMonth[row.month].expense += Math.abs(row.amount);
    }

    const monthKeys = Object.keys(byMonth);
    const count = monthKeys.length || 1;
    const totalIncome = monthKeys.reduce((s, m) => s + byMonth[m].income, 0);
    const totalExpense = monthKeys.reduce((s, m) => s + byMonth[m].expense, 0);

    return { avgIncome: totalIncome / count, avgExpense: totalExpense / count };
}

export function getEnvelopes(userId) {
    return db.prepare('SELECT * FROM envelopes WHERE user_id = ?').all(userId);
}

export function getContributionSuggestions(userId) {
    const { avgIncome, avgExpense } = monthlyAverages(userId, 3);
    const emergencyFund = db
        .prepare("SELECT * FROM envelopes WHERE user_id = ? AND type = 'EMERGENCY_FUND'")
        .get(userId);

    const emergencyTarget = avgExpense * budgetParams.emergencyFundTargetMonths;
    const emergencyRemaining = Math.max(emergencyTarget - (emergencyFund?.current_amount || 0), 0);
    const emergencyMonthlyContribution = emergencyRemaining / budgetParams.emergencyFundBuildupMonths;

    const surplus = Math.max(avgIncome - avgExpense, 0);
    const unexpectedMonthlyContribution = surplus * budgetParams.unexpectedExpensesContributionRate;

    return {
        avgIncome,
        avgExpense,
        emergencyFund: {
            target: emergencyTarget,
            current: emergencyFund?.current_amount || 0,
            suggestedMonthlyContribution: emergencyMonthlyContribution,
            complete: (emergencyFund?.current_amount || 0) >= emergencyTarget && emergencyTarget > 0,
        },
        unexpectedExpenses: {
            suggestedMonthlyContribution: unexpectedMonthlyContribution,
        },
    };
}

export function depositToEnvelope(userId, envelopeId, amount, note) {
    const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND user_id = ?').get(envelopeId, userId);
    if (!envelope) throw new Error('Caixinha nao encontrada');

    db.prepare('INSERT INTO envelope_transactions (envelope_id, amount, type, note) VALUES (?, ?, ?, ?)').run(
        envelopeId,
        amount,
        'DEPOSIT',
        note || null
    );
    db.prepare('UPDATE envelopes SET current_amount = current_amount + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        amount,
        envelopeId
    );

    return db.prepare('SELECT * FROM envelopes WHERE id = ?').get(envelopeId);
}

export function withdrawFromEnvelope(userId, envelopeId, amount, note) {
    const envelope = db.prepare('SELECT * FROM envelopes WHERE id = ? AND user_id = ?').get(envelopeId, userId);
    if (!envelope) throw new Error('Caixinha nao encontrada');
    if (envelope.current_amount < amount) throw new Error('Saldo insuficiente na caixinha');

    db.prepare('INSERT INTO envelope_transactions (envelope_id, amount, type, note) VALUES (?, ?, ?, ?)').run(
        envelopeId,
        amount,
        'WITHDRAW',
        note || null
    );
    db.prepare('UPDATE envelopes SET current_amount = current_amount - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        amount,
        envelopeId
    );

    return db.prepare('SELECT * FROM envelopes WHERE id = ?').get(envelopeId);
}
