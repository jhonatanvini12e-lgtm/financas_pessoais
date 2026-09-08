import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { getContributionSuggestions } from './envelopeService.js';
import { simulatePayoff } from './debtCalculator.js';
import { getGlobalCreditUsage } from './cardService.js';
import { getSelicRate, approximateCdiFromSelic } from './marketDataService.js';

// Trilha de investimento: perfil Moderado. A reserva de emergencia tem
// prioridade absoluta -- so sugerimos outros ativos quando ela estiver completa.
export function getInvestmentTrackStatus(userId) {
    const suggestions = getContributionSuggestions(userId);
    const investments = db.prepare('SELECT * FROM investments WHERE user_id = ?').all(userId);
    const totalInvested = investments.reduce((s, i) => s + i.current_value, 0);

    return {
        emergencyFundComplete: suggestions.emergencyFund.complete,
        emergencyFund: suggestions.emergencyFund,
        canSuggestOtherAssets: suggestions.emergencyFund.complete,
        totalInvested,
        investments,
        profile: 'MODERADO',
    };
}

function monthsUntil(targetDate) {
    const now = new Date();
    const target = new Date(targetDate);
    return Math.max(
        (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()),
        1
    );
}

// PMT necessario para atingir target_amount ate target_date, dado um valor ja
// acumulado (currentAmount) e a taxa de retorno esperada do perfil moderado.
export function calculateGoalPlan(goal, currentAmount = 0) {
    const n = monthsUntil(goal.target_date);
    const r = budgetParams.moderateProfileExpectedMonthlyReturn;
    const fv = goal.target_amount;
    const pv = currentAmount;

    const futureValueOfCurrent = pv * Math.pow(1 + r, n);
    const monthlyContribution = r === 0
        ? (fv - pv) / n
        : ((fv - futureValueOfCurrent) * r) / (Math.pow(1 + r, n) - 1);

    return {
        goalId: goal.id,
        name: goal.name,
        months: n,
        monthlyContributionRequired: Number(Math.max(monthlyContribution, 0).toFixed(2)),
    };
}

export function getGoalsPlans(userId) {
    const goals = db.prepare('SELECT * FROM investment_goals WHERE user_id = ? ORDER BY priority DESC').all(userId);
    const totalInvested = db
        .prepare('SELECT COALESCE(SUM(current_value),0) as total FROM investments WHERE user_id = ?')
        .get(userId).total;
    return goals.map((goal) => calculateGoalPlan(goal, totalInvested));
}

// Projecao de longo prazo: compara os juros pagos acumulados nas dividas
// (seguindo o metodo Avalanche) com o retorno acumulado dos investimentos
// (aporte mensal sugerido, crescendo a taxa do perfil moderado). O "ponto de
// virada" e o primeiro mes em que o retorno acumulado supera o juro pago acumulado.
export function getTurningPointProjection(userId, { monthlyContribution } = {}) {
    const months = budgetParams.turningPointProjectionMonths;
    const rate = budgetParams.moderateProfileExpectedMonthlyReturn;

    const debts = db.prepare("SELECT * FROM debts WHERE user_id = ? AND status = 'OPEN'").all(userId);
    const debtSimulation = debts.length > 0 ? simulatePayoff(debts, 0, 'avalanche') : { schedule: [] };

    const initialInvested = db
        .prepare('SELECT COALESCE(SUM(current_value),0) as total FROM investments WHERE user_id = ?')
        .get(userId).total;

    const contribution = monthlyContribution ?? getContributionSuggestions(userId).emergencyFund.suggestedMonthlyContribution;

    let balance = initialInvested;
    let cumulativeReturn = 0;
    let cumulativeDebtInterest = 0;
    let turningPointMonth = null;

    const series = [];
    for (let m = 1; m <= months; m++) {
        const monthlyReturn = balance * rate;
        cumulativeReturn += monthlyReturn;
        balance += monthlyReturn + contribution;

        const debtMonth = debtSimulation.schedule[m - 1];
        cumulativeDebtInterest += debtMonth ? debtMonth.interestThisMonth : 0;

        if (turningPointMonth === null && cumulativeReturn > cumulativeDebtInterest && cumulativeDebtInterest > 0) {
            turningPointMonth = m;
        }

        series.push({
            month: m,
            cumulativeInvestmentReturn: Number(cumulativeReturn.toFixed(2)),
            cumulativeDebtInterest: Number(cumulativeDebtInterest.toFixed(2)),
            investmentBalance: Number(balance.toFixed(2)),
        });
    }

    return {
        turningPointMonth,
        monthlyContributionUsed: contribution,
        expectedMonthlyReturnRate: rate,
        series,
    };
}

// Alocacao do perfil moderado entre os tipos suportados em `investments.type`.
// Quando a Selic esta "alta" (acima do limiar de config), a sugestao pesa mais
// para renda fixa pos-fixada; quando esta "baixa", equilibra com renda variavel.
function moderateProfileAllocation(selicAnnual) {
    return selicAnnual >= budgetParams.selicHighThresholdAnnual
        ? [
            { type: 'RENDA_FIXA', percent: 0.45 },
            { type: 'TESOURO_DIRETO', percent: 0.30 },
            { type: 'FII', percent: 0.15 },
            { type: 'ACOES', percent: 0.10 },
        ]
        : [
            { type: 'RENDA_FIXA', percent: 0.25 },
            { type: 'TESOURO_DIRETO', percent: 0.25 },
            { type: 'FII', percent: 0.25 },
            { type: 'ACOES', percent: 0.25 },
        ];
}

// Recomendacao unificada de "quanto e onde investir", cruzando sobra mensal
// (renda - despesas), dividas em aberto, uso dos cartoes de credito e a taxa
// de mercado atual (Selic/CDI). Segue a mesma prioridade da aba Ponto de
// Virada: divida cara vem antes de qualquer aporte.
export async function getInvestmentRecommendation(userId) {
    const suggestions = getContributionSuggestions(userId);
    const cardUsage = getGlobalCreditUsage(userId);
    const openDebts = db.prepare("SELECT * FROM debts WHERE user_id = ? AND status = 'OPEN'").all(userId);
    const { selicAnnual, source } = await getSelicRate();
    const cdiApprox = approximateCdiFromSelic(selicAnnual);

    const monthlyAmountAvailable = Number(Math.max(suggestions.avgIncome - suggestions.avgExpense, 0).toFixed(2));
    const marketRate = { selicAnnual, cdiApprox, source };

    const worstDebt = openDebts.reduce(
        (worst, d) => (!worst || d.interest_rate_monthly > worst.interest_rate_monthly ? d : worst),
        null
    );

    if (worstDebt && worstDebt.interest_rate_monthly > budgetParams.moderateProfileExpectedMonthlyReturn) {
        return {
            monthlyAmountAvailable,
            action: 'PAY_DEBT',
            reasoning: `A divida "${worstDebt.name}" tem juro de ${(worstDebt.interest_rate_monthly * 100).toFixed(2)}% ao mes, acima do retorno esperado de investimentos (${(budgetParams.moderateProfileExpectedMonthlyReturn * 100).toFixed(2)}% a.m.). Quitar essa divida rende mais do que qualquer aplicacao no momento.`,
            allocation: [],
            marketRate,
        };
    }

    if (cardUsage.usageRatio >= budgetParams.cardGlobalUsageAlertThreshold) {
        return {
            monthlyAmountAvailable,
            action: 'REDUCE_CARD_USAGE',
            reasoning: `O uso dos seus cartoes esta em ${(cardUsage.usageRatio * 100).toFixed(0)}% do limite total. Reduza o uso do cartao antes de comprometer a sobra mensal com investimentos, para evitar cair no rotativo.`,
            allocation: [],
            marketRate,
        };
    }

    if (!suggestions.emergencyFund.complete) {
        return {
            monthlyAmountAvailable,
            action: 'BUILD_EMERGENCY_FUND',
            reasoning: `A Reserva de Emergencia ainda nao atingiu a meta de ${suggestions.emergencyFund.target.toFixed(2)}. Direcione a sobra mensal para a caixinha de reserva antes de outros ativos.`,
            allocation: [{ type: 'RESERVA_EMERGENCIA', percent: 1, amount: Number(suggestions.emergencyFund.suggestedMonthlyContribution.toFixed(2)) }],
            marketRate,
        };
    }

    const investableAmount = monthlyAmountAvailable * (1 - budgetParams.investmentRecommendationSurplusReserveRatio);
    const allocation = moderateProfileAllocation(selicAnnual).map((a) => ({
        ...a,
        amount: Number((investableAmount * a.percent).toFixed(2)),
    }));

    return {
        monthlyAmountAvailable,
        action: 'INVEST',
        reasoning: `Reserva de emergencia completa e cartoes sob controle. Com a Selic em ${(selicAnnual * 100).toFixed(2)}% a.a., sugerimos alocar R$ ${investableAmount.toFixed(2)} (mantendo ${(budgetParams.investmentRecommendationSurplusReserveRatio * 100).toFixed(0)}% da sobra como folga) na trilha moderada abaixo.`,
        allocation,
        marketRate,
    };
}
