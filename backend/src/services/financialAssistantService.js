import db from '../db/index.js';
import { getBudgetStatus } from './budgetEngine.js';
import { getAllBillsStatus } from './billsService.js';
import { getDebtSummary, getDebtPayoffPlan } from './debtCalculator.js';
import { getGlobalCreditUsage } from './cardService.js';
import { getContributionSuggestions } from './envelopeService.js';
import { getInvestmentTrackStatus, getGoalsPlans } from './investmentCalculator.js';

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
    const investmentLines = ['=== Investimentos e reserva de emergencia ===',
        `Reserva de emergencia: ${money(contributions.emergencyFund.current)} de meta ${money(contributions.emergencyFund.target)} (${contributions.emergencyFund.complete ? 'completa' : 'incompleta'})`,
        `Total investido: ${money(investmentTrack.totalInvested)} (perfil ${investmentTrack.profile})`,
    ];
    if (investmentTrack.investments.length) {
        investmentLines.push(...investmentTrack.investments.map((i) => `- ${i.name} (${i.type}): valor atual ${money(i.current_value)}`));
    }
    if (goalsPlans.length) {
        investmentLines.push('Metas de investimento:');
        investmentLines.push(...goalsPlans.map((g) => `- ${g.name}: aporte mensal necessario ${money(g.monthlyContributionRequired)} (${g.months} mes(es) restantes)`));
    }
    sections.push(investmentLines.join('\n'));

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
