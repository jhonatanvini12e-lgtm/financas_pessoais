import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { getContributionSuggestions } from './envelopeService.js';
import { getGlobalCreditUsage } from './cardService.js';

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

// Plano automatico de saida das dividas: cruza renda/despesa media, reserva de
// emergencia, uso de cartao e investimentos (mesmos dados usados em
// getInvestmentRecommendation/getTurningPointProjection) para decidir quanto
// da sobra mensal direcionar as dividas e gerar propostas concretas, sem
// exigir que o usuario monte a simulacao manualmente.
export function getDebtPayoffPlan(userId) {
    const debts = db.prepare("SELECT * FROM debts WHERE user_id = ? AND status = 'OPEN'").all(userId);
    if (debts.length === 0) {
        return { hasDebts: false, recommendations: ['Nenhuma divida em aberto no momento.'] };
    }

    const summary = getDebtSummary(userId);
    const { avgIncome, avgExpense, emergencyFund } = getContributionSuggestions(userId);
    const cardUsage = getGlobalCreditUsage(userId);
    const investments = db.prepare('SELECT * FROM investments WHERE user_id = ?').all(userId);

    const monthlySurplus = Math.max(avgIncome - avgExpense, 0);

    const priorityOrder = [...debts]
        .sort((a, b) => b.interest_rate_monthly - a.interest_rate_monthly)
        .map((d, i) => ({
            id: d.id,
            name: d.name,
            creditor: d.creditor,
            balance: d.current_balance,
            rateMonthly: d.interest_rate_monthly,
            priority: i + 1,
        }));
    const worstDebt = priorityOrder[0];

    // Mesma prioridade adotada em getInvestmentRecommendation: uma divida com
    // juro acima do retorno esperado de investimentos rende mais (quitada) do
    // que qualquer aplicacao, reserva de emergencia inclusive -- so protegemos
    // a contribuicao da reserva quando nenhuma divida for mais cara que isso.
    const debtCostlierThanReserve = worstDebt.rateMonthly > budgetParams.moderateProfileExpectedMonthlyReturn;
    const reserveContribution = !debtCostlierThanReserve && !emergencyFund.complete
        ? Math.min(emergencyFund.suggestedMonthlyContribution, monthlySurplus)
        : 0;
    const suggestedExtraPayment = Number(Math.max(monthlySurplus - reserveContribution, 0).toFixed(2));

    const withExtra = simulatePayoff(debts, suggestedExtraPayment, 'avalanche');
    const minimumOnly = simulatePayoff(debts, 0, 'avalanche');
    // Quando o minimo nunca quita (juro supera o pagamento minimo mes a mes), o
    // saldo projetado explode para valores sem sentido pratico (>=1e21 vira
    // notacao cientifica em toFixed) -- tratamos a economia como indefinida em
    // vez de expor esse numero.
    const interestSaved = minimumOnly.neverPaysOff || withExtra.neverPaysOff
        ? null
        : Number((minimumOnly.totalInterestPaid - withExtra.totalInterestPaid).toFixed(2));

    // Oportunidades de arbitragem: dinheiro aplicado rendendo menos do que custa
    // a divida mais cara -- resgatar para quitar rende mais do que manter aplicado.
    const arbitrageOpportunities = investments
        .filter((inv) => (inv.expected_monthly_return_rate ?? 0) < worstDebt.rateMonthly && inv.current_value > 0)
        .map((inv) => ({
            investmentName: inv.name,
            currentValue: inv.current_value,
            expectedMonthlyReturnRate: inv.expected_monthly_return_rate ?? 0,
            debtName: worstDebt.name,
            debtRateMonthly: worstDebt.rateMonthly,
            potentialAmountToUse: Number(Math.min(inv.current_value, worstDebt.balance).toFixed(2)),
        }));

    const recommendations = [];

    recommendations.push(
        `Priorize a divida "${worstDebt.name}": juro de ${(worstDebt.rateMonthly * 100).toFixed(2)}% a.m. e o mais alto entre suas dividas em aberto (metodo avalanche economiza mais juros que quitar pela menor primeiro).`
    );

    if (suggestedExtraPayment > 0) {
        recommendations.push(
            `Sobra mensal media de R$ ${monthlySurplus.toFixed(2)} (renda R$ ${avgIncome.toFixed(2)} - despesas R$ ${avgExpense.toFixed(2)}). Direcione R$ ${suggestedExtraPayment.toFixed(2)} extras por mes as dividas` +
                (reserveContribution > 0
                    ? `, mantendo R$ ${reserveContribution.toFixed(2)} para completar a reserva de emergencia.`
                    : '.')
        );
    } else if (monthlySurplus <= 0) {
        recommendations.push(
            'Sua renda media atual nao deixa sobra para acelerar o pagamento das dividas. Revise despesas variaveis (veja a aba Orcamento) antes de comprometer mais renda com as dividas.'
        );
    } else {
        recommendations.push(
            `Sobra mensal media de R$ ${monthlySurplus.toFixed(2)}, mas as dividas atuais tem juro baixo o suficiente para priorizar a reserva de emergencia primeiro: direcione R$ ${reserveContribution.toFixed(2)} por mes a ela antes de acelerar o pagamento das dividas.`
        );
    }

    if (withExtra.monthsToPayoff && minimumOnly.neverPaysOff) {
        recommendations.push(
            `Com esse extra, todas as dividas quitam em ${withExtra.monthsToPayoff} meses. Pagando so o minimo elas nunca quitariam -- o minimo atual nem cobre o juro do mes, entao o extra e o que impede a divida de crescer indefinidamente.`
        );
    } else if (withExtra.monthsToPayoff) {
        recommendations.push(
            `Com esse extra, todas as dividas quitam em ${withExtra.monthsToPayoff} meses e voce economiza R$ ${interestSaved.toFixed(2)} em juros em relacao a pagar so o minimo (${minimumOnly.monthsToPayoff} meses).`
        );
    } else if (withExtra.neverPaysOff) {
        recommendations.push(
            (suggestedExtraPayment > 0 ? 'Mesmo com o extra sugerido' : 'Pagando apenas o minimo') +
                ', as dividas nao quitam em 50 anos: o pagamento minimo atual e menor que o juro que incide todo mes, entao o saldo devedor so cresce. E necessario renegociar as taxas ou aumentar o valor pago mensalmente.'
        );
    }

    if (cardUsage.usageRatio >= budgetParams.cardGlobalUsageAlertThreshold) {
        recommendations.push(
            `Uso de cartao de credito em ${(cardUsage.usageRatio * 100).toFixed(0)}% do limite total. Evite novas compras parceladas ate reduzir esse uso, para nao criar mais divida rotativa em cima das atuais.`
        );
    }

    for (const opp of arbitrageOpportunities) {
        recommendations.push(
            `O investimento "${opp.investmentName}" rende ${(opp.expectedMonthlyReturnRate * 100).toFixed(2)}% a.m., menos que o juro da divida "${opp.debtName}" (${(opp.debtRateMonthly * 100).toFixed(2)}% a.m.). Resgatar ate R$ ${opp.potentialAmountToUse.toFixed(2)} para abater essa divida rende mais do que manter o investimento.`
        );
    }

    if (worstDebt.rateMonthly >= budgetParams.moderateProfileExpectedMonthlyReturn * 5) {
        recommendations.push(
            `A taxa da divida "${worstDebt.name}" esta muito acima do custo de credito saudavel. Procure o credor para negociar desconto a vista ou um novo parcelamento com juro menor antes de continuar pagando so o minimo.`
        );
    }

    return {
        hasDebts: true,
        summary,
        monthlyIncome: Number(avgIncome.toFixed(2)),
        monthlyExpense: Number(avgExpense.toFixed(2)),
        monthlySurplus: Number(monthlySurplus.toFixed(2)),
        suggestedExtraPayment,
        emergencyFund,
        priorityOrder,
        projection: {
            withExtra: {
                monthsToPayoff: withExtra.monthsToPayoff,
                totalInterestPaid: withExtra.totalInterestPaid,
                neverPaysOff: withExtra.neverPaysOff,
            },
            minimumOnly: {
                monthsToPayoff: minimumOnly.monthsToPayoff,
                totalInterestPaid: minimumOnly.totalInterestPaid,
                neverPaysOff: minimumOnly.neverPaysOff,
            },
            interestSaved,
        },
        arbitrageOpportunities,
        cardUsage,
        recommendations,
    };
}
