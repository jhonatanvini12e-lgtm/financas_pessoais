import db from '../db/index.js';
import { getBudgetStatus } from './budgetEngine.js';
import { getAllBillsStatus } from './billsService.js';
import { getDebtSummary, getDebtPayoffPlan } from './debtCalculator.js';
import { getCurrentInvoicePeriod, getGlobalCreditUsage } from './cardService.js';
import { getContributionSuggestions, getEnvelopes } from './envelopeService.js';
import { getInvestmentTrackStatus, getGoalsPlans, getTurningPointProjection } from './investmentCalculator.js';

// Mesmo padrao de services/statementImport/pdfParser.js: Gemini como
// provedor principal (free tier), Groq como backup, via fetch cru (sem SDK).
// Nomes de modelo via env porque provedores de IA depreciam modelo com pouco
// aviso.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const AI_REQUEST_TIMEOUT_MS = 20000;
const MAX_HISTORY_MESSAGES = 12;

function money(value) {
    return `R$ ${Number(value || 0).toFixed(2)}`;
}

function percent(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function monthsAgoISO(months) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().slice(0, 10);
}

// Resumo textual em PT-BR da situacao financeira do household, reaproveitando
// os mesmos servicos usados pelas telas do app (nenhum calculo e duplicado
// aqui). Regenerado a cada mensagem para a IA sempre responder com base nos
// dados mais recentes.
export function buildFinancialSnapshot(userId) {
    const sections = [];

    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
    const accountBalances = accounts.map((a) => {
        const extra = db
            .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE account_id = ? AND user_id = ?')
            .get(a.id, userId).total;
        return { ...a, currentBalance: a.balance + extra };
    });
    sections.push(
        ['=== Contas bancarias ===',
            ...(accountBalances.length
                ? accountBalances.map((a) => `- ${a.bank_name}: saldo ${money(a.currentBalance)}`)
                : ['Nenhuma conta cadastrada.']),
            `Total em contas: ${money(accountBalances.reduce((s, a) => s + a.currentBalance, 0))}`,
        ].join('\n')
    );

    const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);
    const creditUsage = getGlobalCreditUsage(userId);
    sections.push(
        ['=== Cartoes de credito ===',
            ...(cards.length
                ? cards.map((c) => `- ${c.card_name}: limite ${money(c.credit_limit)}, fecha dia ${c.closing_day}, vence dia ${c.due_day}`)
                : ['Nenhum cartao cadastrado.']),
            `Uso global de credito: ${percent(creditUsage.usageRatio)} (${money(creditUsage.totalUsage)} de ${money(creditUsage.totalLimit)})`,
        ].join('\n')
    );

    const bills = getAllBillsStatus(userId);
    const pendingBills = bills.items.filter((b) => !b.paid);
    sections.push(
        ['=== Contas a pagar ===',
            ...(pendingBills.length
                ? pendingBills.map((b) => `- ${b.name}: ${money(b.expectedAmount)}, vence ${b.dueDate}, status ${b.status}`)
                : ['Nenhuma conta pendente.']),
            `Total pendente: ${money(bills.totalPending)}, total atrasado: ${money(bills.totalLate)} (${bills.lateCount} conta(s) atrasada(s))`,
        ].join('\n')
    );

    const budget = getBudgetStatus(userId);
    sections.push(
        ['=== Orcamento do mes atual ===',
            ...(budget.categories.length
                ? budget.categories.map((c) => `- ${c.name}: gasto ${money(c.spent)} de limite ${money(c.limit)} (${percent(c.ratio)}, nivel ${c.level})`)
                : ['Nenhuma categoria de despesa com orcamento definido.']),
            `Custos fixos: ${money(budget.fixed.spent)} de teto ${money(budget.fixed.ceiling)} (${percent(budget.fixed.ratio)})`,
            `Custos variaveis: ${money(budget.variable.spent)} de teto ${money(budget.variable.ceiling)} (${percent(budget.variable.ratio)})`,
        ].join('\n')
    );

    const debtSummary = getDebtSummary(userId);
    const debtPlan = getDebtPayoffPlan(userId);
    const debtLines = ['=== Dividas ==='];
    if (debtSummary.count > 0) {
        debtLines.push(`Total em dividas: ${money(debtSummary.totalBalance)}, taxa media ponderada: ${percent(debtSummary.weightedAverageRateMonthly)} a.m. (${debtSummary.count} divida(s) em aberto)`);
        if (debtPlan.hasDebts) {
            debtLines.push(`Sobra mensal media: ${money(debtPlan.monthlySurplus)}. Analise automatica:`);
            debtLines.push(...debtPlan.recommendations.map((r) => `- ${r}`));
        }
    } else {
        debtLines.push('Nenhuma divida em aberto.');
    }
    sections.push(debtLines.join('\n'));

    const contributions = getContributionSuggestions(userId);
    const investmentTrack = getInvestmentTrackStatus(userId);
    const goalsPlans = getGoalsPlans(userId);
    const envelopes = getEnvelopes(userId);
    const turningPoint = getTurningPointProjection(userId);
    const investmentLines = ['=== Caixinhas e investimentos ===',
        `Renda media (3 meses): ${money(contributions.avgIncome)}, despesa media: ${money(contributions.avgExpense)}`,
        `Reserva de emergencia: ${money(contributions.emergencyFund.current)} de meta ${money(contributions.emergencyFund.target)} (${contributions.emergencyFund.complete ? 'completa' : 'incompleta'}), aporte mensal sugerido ${money(contributions.emergencyFund.suggestedMonthlyContribution)}`,
        `Reserva para imprevistos: aporte mensal sugerido ${money(contributions.unexpectedExpenses.suggestedMonthlyContribution)}`,
        `Total investido: ${money(investmentTrack.totalInvested)} (perfil ${investmentTrack.profile})`,
    ];
    if (envelopes.length) {
        investmentLines.push('Caixinhas (envelopes):');
        investmentLines.push(...envelopes.map((e) => `- ${e.name} (${e.type}): ${money(e.current_amount)} de meta ${money(e.target_amount)}`));
    }
    if (investmentTrack.investments.length) {
        investmentLines.push('Investimentos:');
        investmentLines.push(...investmentTrack.investments.map((i) => `- ${i.name} (${i.type}): valor atual ${money(i.current_value)}`));
    }
    if (goalsPlans.length) {
        investmentLines.push('Metas de investimento:');
        investmentLines.push(...goalsPlans.map((g) => `- ${g.name}: aporte mensal necessario ${money(g.monthlyContributionRequired)} (${g.months} mes(es) restantes)`));
    }
    investmentLines.push(
        turningPoint.turningPointMonth
            ? `Ponto de virada: no mes ${turningPoint.turningPointMonth} da projecao, o retorno dos investimentos passa a superar os juros pagos nas dividas (aporte mensal usado na projecao: ${money(turningPoint.monthlyContributionUsed)}).`
            : 'Ponto de virada: sem cruzamento projetado no horizonte simulado entre retorno de investimentos e juros de dividas.'
    );
    sections.push(investmentLines.join('\n'));

    const categories = db.prepare('SELECT name, type, keywords FROM categories WHERE user_id = ? ORDER BY type, name').all(userId);
    sections.push(
        ['=== Categorias cadastradas ===',
            ...(categories.length
                ? categories.map((c) => `- ${c.name} (${c.type})${c.keywords ? `, palavras-chave: ${c.keywords}` : ''}`)
                : ['Nenhuma categoria cadastrada.']),
        ].join('\n')
    );

    const spendingByCategory = db
        .prepare(
            `SELECT c.name as category, SUM(ABS(t.amount)) as total
             FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.user_id = ? AND t.date >= ? AND t.amount < 0
             GROUP BY t.category_id ORDER BY total DESC LIMIT 10`
        )
        .all(userId, monthsAgoISO(3));
    sections.push(
        ['=== Gastos por categoria (ultimos 3 meses) ===',
            ...(spendingByCategory.length
                ? spendingByCategory.map((row) => `- ${row.category || 'Sem categoria'}: ${money(row.total)}`)
                : ['Sem lancamentos de despesa no periodo.']),
        ].join('\n')
    );

    const recentTransactions = db
        .prepare(
            `SELECT t.date, t.description, t.amount, c.name as category
             FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.user_id = ? ORDER BY t.date DESC, t.id DESC LIMIT 15`
        )
        .all(userId);
    sections.push(
        ['=== Lancamentos mais recentes ===',
            ...(recentTransactions.length
                ? recentTransactions.map((t) => `- ${t.date.slice(0, 10)} | ${t.description || '(sem descricao)'} | ${money(t.amount)} | ${t.category || 'sem categoria'}`)
                : ['Nenhum lancamento registrado.']),
        ].join('\n')
    );

    const monthlySpendingTrend = db
        .prepare(
            `SELECT strftime('%Y-%m', date) as month, SUM(ABS(amount)) as total
             FROM transactions WHERE user_id = ? AND date >= ? AND amount < 0
             GROUP BY month ORDER BY month`
        )
        .all(userId, monthsAgoISO(6));
    const cashFlowTrend = db
        .prepare(
            `SELECT strftime('%Y-%m', date) as month,
                    SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expense
             FROM transactions WHERE user_id = ? AND date >= ?
             GROUP BY month ORDER BY month`
        )
        .all(userId, monthsAgoISO(6));
    const creditUsageByCard = cards.map((card) => {
        const { periodStart, periodEnd } = getCurrentInvoicePeriod(card.closing_day, card.due_day);
        const { used } = db
            .prepare(
                `SELECT COALESCE(SUM(ABS(amount)), 0) as used FROM transactions
                 WHERE card_id = ? AND user_id = ? AND date >= ? AND date <= ? AND amount < 0`
            )
            .get(card.id, userId, periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10));
        return { name: card.card_name, used, limit: card.credit_limit };
    });
    const openInstallments = db
        .prepare(
            `SELECT COUNT(DISTINCT installment_group) as total, COALESCE(SUM(ABS(amount)), 0) as totalValue
             FROM transactions WHERE user_id = ? AND installment_group IS NOT NULL`
        )
        .get(userId);

    const analysisLines = ['=== Analises e inteligencia financeira ==='];
    analysisLines.push(
        'Gasto mensal total (ultimos 6 meses): ' +
            (monthlySpendingTrend.length ? monthlySpendingTrend.map((m) => `${m.month}: ${money(m.total)}`).join(', ') : 'sem dados')
    );
    analysisLines.push(
        'Fluxo de caixa mensal (entradas/saidas, ultimos 6 meses): ' +
            (cashFlowTrend.length ? cashFlowTrend.map((m) => `${m.month}: +${money(m.income)}/-${money(m.expense)}`).join(', ') : 'sem dados')
    );
    if (creditUsageByCard.length) {
        analysisLines.push('Uso de credito por cartao no ciclo atual:');
        analysisLines.push(...creditUsageByCard.map((c) => `- ${c.name}: ${money(c.used)} de ${money(c.limit)} (${percent(c.limit > 0 ? c.used / c.limit : 0)})`));
    }
    analysisLines.push(`Parcelamentos em aberto: ${openInstallments.total} parcelamento(s), valor total ${money(openInstallments.totalValue)}`);
    sections.push(analysisLines.join('\n'));

    return sections.join('\n\n');
}

function buildSystemPrompt(snapshot) {
    return `Voce e um assistente de IA especializado em financas pessoais, gestao de contas/cartoes/orcamento, quitacao de dividas e crises financeiras, e investimentos, integrado a um app de financas pessoais em uso no Brasil (valores em R$).

Regras importantes:
- Baseie TODA resposta somente nos dados reais abaixo (snapshot financeiro do usuario, gerado agora). Nao invente numeros, contas, dividas ou investimentos que nao estao listados.
- Se faltar um dado para responder com precisao, diga isso claramente em vez de supor.
- Nunca garanta retorno de investimento ou prometa resultado financeiro certo -- fale em termos de probabilidade/recomendacao.
- Quando o usuario parecer em dificuldade financeira (atraso em contas, dividas crescendo, uso alto de cartao), priorize um tom pratico, direto e acolhedor -- liste passos concretos e priorizados, nao so diagnostico.
- Quando pedirem "relatorio" ou "resumo", organize a resposta em topicos curtos com os numeros relevantes do snapshot.
- Responda sempre em portugues do Brasil, de forma objetiva (evite textao desnecessario).
- O snapshot abaixo cobre: contas/cartoes, contas a pagar, orcamento, dividas, caixinhas/investimentos (com ponto de virada), categorias cadastradas (com palavras-chave), lancamentos recentes, gastos por categoria e analises (tendencia de gasto mensal, fluxo de caixa, uso de credito por cartao, parcelamentos em aberto). Use essas secoes para responder perguntas sobre essas telas do app com dados concretos, nao generico.

=== Snapshot financeiro atual ===
${snapshot}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err.name === 'AbortError') throw new Error(`sem resposta em ${AI_REQUEST_TIMEOUT_MS / 1000}s (timeout)`);
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

function assertAnyApiKey() {
    if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
        throw new Error(
            'Assistente de IA requer IA configurada: defina GEMINI_API_KEY (chave gratuita em aistudio.google.com/apikey) no .env do backend. Opcionalmente, defina tambem GROQ_API_KEY (console.groq.com) como backup.'
        );
    }
}

async function callGemini(systemPrompt, history, userMessage) {
    const apiKey = process.env.GEMINI_API_KEY;
    const contents = [
        ...history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text: userMessage }] },
    ];

    const attempts = 2;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        let response;
        try {
            response = await fetchWithTimeout(`${GEMINI_URL}?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents,
                    generationConfig: { temperature: 0.3, thinkingConfig: { thinkingLevel: 'LOW' } },
                }),
            });
        } catch (err) {
            lastError = err;
            if (attempt === attempts) break;
            await sleep(500);
            continue;
        }

        if (response.ok) {
            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('a IA nao retornou nenhum conteudo');
            return text;
        }

        const retryable = response.status === 429 || response.status === 503;
        const errBody = await response.text().catch(() => '');
        lastError = new Error(`${response.status} ${errBody.slice(0, 200)}`);
        if (!retryable || attempt === attempts) break;
        await sleep(500);
    }

    throw lastError;
}

async function callGroq(systemPrompt, history, userMessage) {
    const apiKey = process.env.GROQ_API_KEY;
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
    ];

    const response = await fetchWithTimeout(GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: GROQ_MODEL, temperature: 0.3, messages }),
    });

    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`${response.status} ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('a IA nao retornou nenhum conteudo');
    return text;
}

// history: mensagens anteriores da conversa (sem a nova), na ordem
// cronologica, como [{ role: 'user'|'assistant', content }]. O snapshot e'
// recalculado a cada chamada para refletir o estado financeiro mais atual.
export async function askAssistant(userId, history, userMessage) {
    assertAnyApiKey();

    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const snapshot = buildFinancialSnapshot(userId);
    const systemPrompt = buildSystemPrompt(snapshot);

    if (process.env.GEMINI_API_KEY) {
        try {
            return await callGemini(systemPrompt, recentHistory, userMessage);
        } catch (geminiError) {
            if (!process.env.GROQ_API_KEY) {
                throw new Error(`Falha ao consultar a IA (Gemini): ${geminiError.message}`);
            }
            console.warn(`Gemini falhou no assistente de IA, tentando backup (Groq): ${geminiError.message}`);
            try {
                return await callGroq(systemPrompt, recentHistory, userMessage);
            } catch (groqError) {
                throw new Error(`Falha ao consultar a IA: Gemini (${geminiError.message}) e o backup Groq (${groqError.message}) falharam.`);
            }
        }
    }

    try {
        return await callGroq(systemPrompt, recentHistory, userMessage);
    } catch (groqError) {
        throw new Error(`Falha ao consultar a IA (Groq): ${groqError.message}`);
    }
}
