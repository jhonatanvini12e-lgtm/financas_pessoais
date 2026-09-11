import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { raiseAlert, alreadyAlertedToday } from './notificationEngine.js';
import { sendBudgetAlert } from './emailService.js';

function currentMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
}

export function getBudgetStatus(userId) {
    const { start, end } = currentMonthRange();

    const categories = db
        .prepare("SELECT * FROM categories WHERE user_id = ? AND type = 'EXPENSE'")
        .all(userId);

    const spentRows = db
        .prepare(
            `SELECT category_id, SUM(ABS(amount)) as total
             FROM transactions
             WHERE user_id = ? AND date >= ? AND date <= ? AND amount < 0
             GROUP BY category_id`
        )
        .all(userId, start, end);
    const spentByCategory = {};
    for (const row of spentRows) {
        spentByCategory[row.category_id] = row.total;
    }

    const categoryStatus = categories.map((cat) => {
        const spent = spentByCategory[cat.id] || 0;
        const ratio = cat.budget_limit > 0 ? spent / cat.budget_limit : 0;
        return {
            categoryId: cat.id,
            name: cat.name,
            spent,
            limit: cat.budget_limit,
            ratio,
            level: ratio >= budgetParams.budgetCriticalThreshold
                ? 'CRITICAL'
                : ratio >= budgetParams.budgetWarningThreshold
                ? 'WARNING'
                : 'OK',
        };
    });

    // Lancamentos sem categoria (nenhuma keyword bateu na hora de importar/lancar)
    // nao pertencem a nenhuma categoria cadastrada, entao ficavam de fora do
    // orcamento por completo -- contavam no saldo mas desapareciam da analise.
    // Entram aqui sem teto proprio (igual a uma categoria com budget_limit 0).
    const uncategorizedSpent = spentByCategory[null] || 0;
    if (uncategorizedSpent > 0) {
        categoryStatus.push({
            categoryId: null,
            name: 'Sem categoria',
            spent: uncategorizedSpent,
            limit: 0,
            ratio: 0,
            level: 'OK',
        });
    }

    const fixedNames = new Set(budgetParams.fixedCostCategoryNames);
    const fixedSpent = categoryStatus.filter((c) => fixedNames.has(c.name)).reduce((s, c) => s + c.spent, 0);
    const variableSpent = categoryStatus.filter((c) => !fixedNames.has(c.name)).reduce((s, c) => s + c.spent, 0);

    return {
        period: { start, end },
        categories: categoryStatus,
        fixed: {
            spent: fixedSpent,
            ceiling: budgetParams.fixedCostsCeiling,
            ratio: budgetParams.fixedCostsCeiling > 0 ? fixedSpent / budgetParams.fixedCostsCeiling : 0,
        },
        variable: {
            spent: variableSpent,
            ceiling: budgetParams.variableCostsCeiling,
            ratio: budgetParams.variableCostsCeiling > 0 ? variableSpent / budgetParams.variableCostsCeiling : 0,
        },
    };
}

// Chamado pelo cron diario e apos cada nova transacao: dispara alerta (log +
// e-mail) quando uma categoria ou os tetos globais cruzam 80%/100%.
export function checkBudgetAlerts(userId) {
    const status = getBudgetStatus(userId);
    const monthKey = status.period.start.slice(0, 7);

    for (const cat of status.categories) {
        if (cat.level === 'OK') continue;
        const key = `${cat.name}-${monthKey}-${cat.level}`;
        if (alreadyAlertedToday(userId, 'BUDGET', key)) continue;

        raiseAlert({
            userId,
            type: 'BUDGET',
            severity: cat.level === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
            message: `Categoria "${cat.name}" atingiu ${(cat.ratio * 100).toFixed(0)}% do orcamento (${key})`,
            emailFn: () => sendBudgetAlert(cat.name, cat.ratio),
        });
    }

    return status;
}

export function getBudgetParams() {
    return budgetParams;
}
