// Arquivo unico de parametros do orcamento. Ajuste os valores aqui -- nenhuma
// logica de negocio deve ter numeros "magicos" fora deste arquivo.
export default {
    // Tetos globais de gasto por tipo de custo (R$/mes). 0 = sem teto definido.
    fixedCostsCeiling: 4000,
    variableCostsCeiling: 2000,

    // Categorias tratadas como "custo fixo" (o restante e considerado variavel).
    fixedCostCategoryNames: ['Moradia', 'Saude', 'Educacao', 'Assinaturas'],

    // Gatilhos de alerta de orcamento (percentual do teto da categoria/global).
    budgetWarningThreshold: 0.8,
    budgetCriticalThreshold: 1.0,

    // Uso de credito: soma de faturas abertas / soma de limites de todos os cartoes.
    cardGlobalUsageAlertThreshold: 0.7,

    // Dias de antecedencia para alertar vencimento de fatura.
    cardDueDateWarningDays: 2,

    // Caixinhas automaticas.
    emergencyFundTargetMonths: 6, // meta = N x media de despesas mensais
    emergencyFundBuildupMonths: 12, // prazo sugerido para juntar a meta
    unexpectedExpensesContributionRate: 0.1, // % da sobra (renda - despesas) media

    // Inatividade / seguranca de sessao.
    inactivityTimeoutMinutes: 60,
    twoFactorCodeExpiryMinutes: 60,

    // Backup.
    backupRetentionCount: 2,

    // Investimentos - trilha moderada.
    moderateProfileExpectedMonthlyReturn: 0.008, // ~0.8% a.m.
    turningPointProjectionMonths: 60,

    // Recomendacao de aporte (Caixinhas + Investimentos unificados).
    fallbackSelicRateAnnual: 0.1075, // usado so se a API do BCB estiver fora do ar
    selicHighThresholdAnnual: 0.1, // acima disso, pesa mais renda fixa pos-fixada na sugestao
    investmentRecommendationSurplusReserveRatio: 0.2, // fracao da sobra mantida como reserva, nao alocada

    // Janelas de comparacao da aba de Inteligencia Financeira.
    intelligenceComparisonWindowsMonths: [3, 6],
};
