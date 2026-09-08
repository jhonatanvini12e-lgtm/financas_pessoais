import db from '../db/index.js';

const MAX_MONTHS = 600; // trava de seguranca (50 anos) contra amortizacao negativa infinita

function orderDebts(debts, method) {
    return method === 'avalanche'
        ? [...debts].sort((a, b) => b.interest_rate_monthly - a.interest_rate_monthly)
        : [...debts].sort((a, b) => a.balance - b.balance);
}

// Simula a quitacao mes a mes: juros incidem sobre o saldo, minimos sao pagos
// em todas as dividas, e o "extra" (orcamento livre + minimos de dividas ja
// quitadas) e direcionado a divida-alvo na ordem definida pelo metodo.
export function simulatePayoff(debtsInput, extraBudget, method) {
    const debts = debtsInput.map((d) => ({ ...d, balance: d.current_balance }));
    const order = orderDebts(debts, method);

    let month = 0;
    let totalInterestPaid = 0;
    const schedule = [];

    while (order.some((d) => d.balance > 0.01) && month < MAX_MONTHS) {
        month += 1;
        let monthInterest = 0;

        for (const debt of order) {
            if (debt.balance > 0) {
                const interest = debt.balance * debt.interest_rate_monthly;
                debt.balance += interest;
                monthInterest += interest;
            }
        }
        totalInterestPaid += monthInterest;

        let budget = extraBudget;
        for (const debt of order) {
            if (debt.balance > 0) {
                const pay = Math.min(debt.minimum_payment, debt.balance);
                debt.balance -= pay;
            }
        }
        for (const debt of order) {
            if (budget <= 0) break;
            if (debt.balance > 0) {
                const pay = Math.min(budget, debt.balance);
                debt.balance -= pay;
                budget -= pay;
            }
        }

        schedule.push({
            month,
            totalRemaining: Number(order.reduce((s, d) => s + Math.max(d.balance, 0), 0).toFixed(2)),
            interestThisMonth: Number(monthInterest.toFixed(2)),
        });
    }

    return {
        method,
        monthsToPayoff: month < MAX_MONTHS ? month : null,
        neverPaysOff: month >= MAX_MONTHS,
        totalInterestPaid: Number(totalInterestPaid.toFixed(2)),
        schedule,
    };
}

export function compareStrategies(userId, extraBudget) {
    const debts = db.prepare("SELECT * FROM debts WHERE user_id = ? AND status = 'OPEN'").all(userId);
    if (debts.length === 0) {
        return { avalanche: null, snowball: null, debts: [] };
    }
    return {
        avalanche: simulatePayoff(debts, extraBudget, 'avalanche'),
        snowball: simulatePayoff(debts, extraBudget, 'snowball'),
        debts,
    };
}

export function getDebtSummary(userId) {
    const debts = db.prepare("SELECT * FROM debts WHERE user_id = ? AND status = 'OPEN'").all(userId);
    const totalBalance = debts.reduce((s, d) => s + d.current_balance, 0);
    const weightedRate = totalBalance > 0
        ? debts.reduce((s, d) => s + d.current_balance * d.interest_rate_monthly, 0) / totalBalance
        : 0;
    return { totalBalance, weightedAverageRateMonthly: weightedRate, count: debts.length };
}

// Compara: (1) caminho atual (so minimos), (2) desconto a vista, (3) parcelamento novo.
export function simulateRenegotiation({ currentBalance, interestRateMonthly, minimumPayment, discountPercent, installments, newMonthlyRate }) {
    const currentPath = simulatePayoff(
        [{ current_balance: currentBalance, interest_rate_monthly: interestRateMonthly, minimum_payment: minimumPayment }],
        0,
        'avalanche'
    );

    const lumpSumAmount = Number((currentBalance * (1 - discountPercent)).toFixed(2));

    let installmentOption = null;
    if (installments && newMonthlyRate != null) {
        const r = newMonthlyRate;
        const payment = r === 0
            ? currentBalance / installments
            : (currentBalance * r) / (1 - Math.pow(1 + r, -installments));
        installmentOption = {
            installments,
            monthlyPayment: Number(payment.toFixed(2)),
            totalPaid: Number((payment * installments).toFixed(2)),
        };
    }

    return {
        currentPath: {
            totalPaid: Number((currentBalance + currentPath.totalInterestPaid).toFixed(2)),
            monthsToPayoff: currentPath.monthsToPayoff,
            totalInterestPaid: currentPath.totalInterestPaid,
        },
        lumpSumOption: { amount: lumpSumAmount, savings: Number((currentBalance - lumpSumAmount).toFixed(2)) },
        installmentOption,
    };
}
