import crypto from 'node:crypto';
import db from '../db/index.js';
import { getItemIds, getItem, listAccounts, getAccount, listTransactions, listBills } from './pluggyClient.js';
import { categorize, buildCategoryLearningMap, buildCategoryKeywordList, normalizeForMatch } from './categorizationEngine.js';
import { addMonths } from './statementImport/columnMapper.js';
import { upsertCardBill } from './billsService.js';
import { checkBudgetAlerts } from './budgetEngine.js';
import { raiseAlert, alreadyAlertedToday } from './notificationEngine.js';

// Sync de cartoes de credito via Pluggy (Open Finance pelo Meu Pluggy).
//
// A cada execucao lemos o estado COMPLETO da conta na Pluggy (ate 12 meses) e
// reconciliamos com os lancamentos locais do cartao, em vez de so inserir o
// que for novo: no cartao, lancamentos PENDING mudam de valor/data, somem, e
// no fechamento da fatura podem ser apagados e recriados pela Pluggy com um
// id NOVO (o id so e' estavel se o banco manda um providerId, o que nao
// acontece no Meu Pluggy). Por isso o id da Pluggy (external_fitid) e' so a
// primeira tentativa de casar um lancamento -- ver reconcileTransactions.

const SOURCE = 'PLUGGY';

// Ultimo recurso de categorizacao (depois do historico e das palavras-chave
// do usuario, ver categorizeRow): traduz a categoria que a Pluggy atribui a
// cada lancamento para o nome de uma categoria do app. Se o usuario nao tiver
// uma categoria com esse nome (comparado sem acento/maiusculas), o
// lancamento fica sem categoria. Categorias genericas demais da Pluggy
// ("Shopping", "Services", "Transfers") ficam de fora de proposito -- melhor
// sem categoria do que numa errada.
const PLUGGY_CATEGORY_TO_APP = {
    'Eating out': 'Alimentacao',
    'Food delivery': 'Alimentacao',
    'Food and drinks': 'Alimentacao',
    Groceries: 'Alimentacao',
    'Taxi and ride-hailing': 'Transporte',
    'Gas stations': 'Transporte',
    Parking: 'Transporte',
    'Public transportation': 'Transporte',
    'Car rental': 'Transporte',
    Tolls: 'Transporte',
    Pharmacy: 'Saude',
    Healthcare: 'Saude',
    Optometry: 'Saude',
    'Gyms and fitness centers': 'Saude',
    'Wellness and fitness': 'Saude',
    'Vehicle maintenance': 'Manutencao',
    Automotive: 'Manutencao',
    'Online shopping': 'Compras Internet',
    Telecommunications: 'Assinaturas',
    'Digital services': 'Assinaturas',
    Insurance: 'Assinaturas',
    'Video streaming': 'Lazer',
    'Music streaming': 'Lazer',
    'Cinema, theater and concerts': 'Lazer',
    Leisure: 'Lazer',
    Tickets: 'Lazer',
    Accomodation: 'Lazer',
    School: 'Educacao',
    Bookstore: 'Educacao',
    Housing: 'Moradia',
    'Late payment and overdraft costs': 'Gastos Imprevistos',
};

const normalizeName = (name) => String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const FITID_PREFIX = 'PLUGGY-';

// Pluggy manda datas de transacao em UTC; um lancamento a meia-noite no
// horario de Brasilia chega como 03:00Z. Convertemos para a data local antes
// de gravar, senao compras perto da meia-noite caem no dia (e as vezes na
// fatura) errado. Excecao: valores a meia-noite UTC exata sao datas sem
// horario (ex: purchaseDate de parcelas futuras, "2026-01-28T00:00:00.000Z")
// -- converter esses jogaria a data para o dia anterior.
const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
const toLocalDate = (iso) => (iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : localDateFormatter.format(new Date(iso)));

const round2 = (n) => Math.round(n * 100) / 100;
const sameAmount = (a, b) => Math.abs(a - b) < 0.005;
const daysBetween = (a, b) => Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000;

function addDays(dateStr, days) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

// Pagamento da fatura aparece como um credito no proprio cartao. Nao vira
// lancamento (contaria como "receita" nos relatorios e o gasto real ja esta
// nas compras) -- e' usado so para marcar a fatura como paga (ver syncBills).
function isCardPayment(txn) {
    return txn.amount < 0 && (txn.category === 'Credit card payment' || /^pagamento/i.test((txn.description || '').trim()));
}

// Converte as transacoes da Pluggy no formato local (compra = valor
// negativo, convencao do resto do app -- na Pluggy compra e' positiva).
// Parcelas recebem tratamento especial:
// - a Pluggy nao manda um id que agrupe as parcelas de uma compra, entao o
//   grupo e' derivado de estabelecimento + data da compra + no de parcelas;
// - parcelas futuras as vezes chegam com a data da COMPRA (ex: 10/12 datada
//   no mesmo dia da 1/12), o que jogaria a parcela numa fatura antiga -- a
//   data e' corrigida para um mes depois da parcela anterior;
// - parcelas que o banco ainda nao mandou sao projetadas mes a mes ate a
//   ultima (mesma ideia da importacao por arquivo), com external_fitid NULL.
//   Quando a parcela real chega, ela casa com a projetada pelo numero.
// O app separa faturas so' pela data (closing_day = ultimo dia incluido, ver
// cardService.getCurrentInvoicePeriod), mas o banco decide a fatura de cada
// lancamento por regras proprias: o dia de fechamento anda (fim de semana,
// Inter fecha dia 4 ou 5), e no Mercado Pago parcelas lancadas NO dia do
// fechamento ficam na fatura que fecha, enquanto compras a vista no mesmo dia
// vao para a seguinte. Para o total de cada fatura no app bater com o banco:
// - lancados (com billId): se a data cai fora do ciclo do app correspondente
//   a fatura informada pela Pluggy, e' movida para a borda desse ciclo (so'
//   acontece com lancamentos no limite do ciclo, a diferenca e' de 1-2 dias);
// - parcelas futuras (sem billId ainda): se o historico do cartao mostra que
//   parcelas no dia do fechamento ficam na fatura que fecha, as que caem no
//   dia de fechamento habitual vao para a vespera.
function dateWithClampedDay(year, month, day) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function buildBillCycleAdjuster(remoteTxns, bills, closingDay) {
    // Ciclo do app que corresponde a cada fatura do banco: termina no
    // closing_day do mes em que o banco fechou a fatura.
    const cycleByBill = new Map();
    for (const b of bills) {
        if (!b.billClosingDate) continue;
        const [y, m] = b.billClosingDate.slice(0, 7).split('-').map(Number);
        const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
        cycleByBill.set(b.id, {
            start: addDays(dateWithClampedDay(py, pm, closingDay), 1),
            end: dateWithClampedDay(y, m, closingDay),
            closing: b.billClosingDate.slice(0, 10),
        });
    }
    const closingDates = new Set([...cycleByBill.values()].map((c) => c.closing));

    let installmentsInClosingBill = 0;
    let installmentsInNextBill = 0;
    for (const txn of remoteTxns) {
        const meta = txn.creditCardMetadata || {};
        const date = toLocalDate(txn.date);
        if (!(meta.installmentNumber > 1) || !closingDates.has(date) || !cycleByBill.has(meta.billId)) continue;
        if (cycleByBill.get(meta.billId).closing === date) installmentsInClosingBill += 1;
        else installmentsInNextBill += 1;
    }
    const shiftFutureInstallments = installmentsInClosingBill > installmentsInNextBill;

    const dayCounts = new Map();
    for (const d of closingDates) dayCounts.set(d.slice(8, 10), (dayCounts.get(d.slice(8, 10)) || 0) + 1);
    const usualClosingDay = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    return (txn, date) => {
        const meta = txn.creditCardMetadata || {};
        const cycle = cycleByBill.get(meta.billId);
        if (cycle) {
            if (date > cycle.end) return cycle.end;
            if (date < cycle.start) return cycle.start;
            return date;
        }
        if (shiftFutureInstallments && meta.installmentNumber > 1 && date.slice(8, 10) === usualClosingDay) return addDays(date, -1);
        return date;
    };
}

function buildDesiredRows(accountId, remoteTxns, bills, closingDay) {
    const rows = [];
    const groups = new Map();
    const adjustToBillCycle = buildBillCycleAdjuster(remoteTxns, bills, closingDay);
    // Parcelas que vieram sem purchaseDate (acontece com parcelas futuras)
    // nao da para agrupar pela data da compra -- entram depois no grupo do
    // mesmo estabelecimento/no de parcelas que ainda nao tem esse numero.
    const withoutPurchaseDate = [];

    for (const txn of remoteTxns) {
        const meta = txn.creditCardMetadata || {};
        const baseDescription = (txn.description || '').trim();
        const row = {
            fitid: FITID_PREFIX + txn.id,
            amount: round2(-txn.amount),
            date: adjustToBillCycle(txn, toLocalDate(txn.date)),
            status: txn.status === 'POSTED' ? 'CLEARED' : 'PENDING',
            description: baseDescription,
            pluggyCategory: txn.category || null,
        };

        if (meta.totalInstallments > 1 && meta.installmentNumber >= 1) {
            row.installmentNumber = meta.installmentNumber;
            row.installmentTotal = meta.totalInstallments;
            row.billId = meta.billId || null;
            if (!meta.purchaseDate) {
                withoutPurchaseDate.push(row);
                continue;
            }
            row.purchaseDate = toLocalDate(meta.purchaseDate);
            const key = [normalizeForMatch(baseDescription), row.purchaseDate, row.installmentTotal].join('|');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        } else {
            rows.push(row);
        }
    }

    for (const row of withoutPurchaseDate) {
        const prefix = `${normalizeForMatch(row.description)}|`;
        const suffix = `|${row.installmentTotal}`;
        const candidates = [...groups.entries()].filter(
            ([key, installments]) =>
                key.startsWith(prefix) && key.endsWith(suffix) && !installments.some((i) => i.installmentNumber === row.installmentNumber)
        );
        if (candidates.length === 1) {
            const [key, installments] = candidates[0];
            installments.push({ ...row, purchaseDate: key.split('|')[1] });
            continue;
        }
        row.purchaseDate = addMonths(row.date, -(row.installmentNumber - 1));
        const key = [normalizeForMatch(row.description), row.purchaseDate, row.installmentTotal].join('|');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }

    for (const [key, installments] of groups) {
        const installmentGroup = FITID_PREFIX + crypto.createHash('sha1').update(`${accountId}|${key}`).digest('hex').slice(0, 20);
        installments.sort((a, b) => a.installmentNumber - b.installmentNumber);

        // Parcela ja lancada numa fatura (billId) tem a data do banco como
        // verdade -- inclusive varias parcelas no mesmo dia, quando a compra
        // e' cancelada e o banco antecipa todas para a fatura do estorno. So'
        // as ainda sem fatura sao corrigidas.
        let previous = null;
        for (const row of installments) {
            if (row.billId) {
                previous = row;
                continue;
            }
            if (previous && row.date <= previous.date) {
                row.date = addMonths(previous.date, Math.max(row.installmentNumber - previous.installmentNumber, 1));
            } else if (!previous && row.installmentNumber > 1 && row.date <= row.purchaseDate) {
                row.date = addMonths(row.purchaseDate, row.installmentNumber - 1);
            }
            previous = row;
        }

        const baseDescription = installments[0].description;
        for (const row of installments) {
            rows.push({ ...row, installmentGroup, description: `${baseDescription} (${row.installmentNumber}/${row.installmentTotal})` });
        }

        const last = installments[installments.length - 1];
        for (let num = last.installmentNumber + 1; num <= last.installmentTotal; num += 1) {
            rows.push({
                fitid: null,
                amount: last.amount,
                date: addMonths(last.date, num - last.installmentNumber),
                status: 'PENDING',
                description: `${baseDescription} (${num}/${last.installmentTotal})`,
                installmentNumber: num,
                installmentTotal: last.installmentTotal,
                installmentGroup,
                pluggyCategory: last.pluggyCategory,
            });
        }
    }

    return rows;
}

// Criterios para casar um lancamento vindo da Pluggy com um local, do mais
// forte para o mais fraco. Cada criterio roda sobre a lista inteira antes do
// proximo, para um casamento fraco nao "roubar" a linha local que um
// casamento forte pegaria. Os criterios heuristicos tambem adotam
// lancamentos que ja existiam no cartao por outra origem (manual/arquivo)
// no periodo sincronizado, em vez de duplica-los.
const MATCHERS = [
    (d, l) => d.fitid != null && l.external_fitid === d.fitid,
    (d, l) => d.installmentGroup != null && l.installment_group === d.installmentGroup && l.installment_number === d.installmentNumber,
    (d, l) =>
        d.installmentNumber != null &&
        l.installment_number === d.installmentNumber &&
        l.installment_total === d.installmentTotal &&
        normalizeForMatch(l.description) === normalizeForMatch(d.description) &&
        daysBetween(l.date, d.date) <= 45,
    (d, l) => sameAmount(l.amount, d.amount) && l.date.slice(0, 10) === d.date && normalizeForMatch(l.description) === normalizeForMatch(d.description),
    // Lancamento recriado pela Pluggy com data ajustada (ex: pendente que
    // virou lancado no fechamento da fatura).
    (d, l) => sameAmount(l.amount, d.amount) && normalizeForMatch(l.description) === normalizeForMatch(d.description) && daysBetween(l.date, d.date) <= 7,
];

function recordHistory(userId, action, before, after) {
    db.prepare(
        `INSERT INTO transaction_history (transaction_id, user_id, action, before_data, after_data) VALUES (?, ?, ?, ?, ?)`
    ).run(before.id, userId, action, JSON.stringify(before), after ? JSON.stringify(after) : null);
}

function reconcileTransactions(link, desired) {
    const local = db
        .prepare('SELECT * FROM transactions WHERE user_id = ? AND card_id = ? AND date >= ?')
        .all(link.user_id, link.card_id, link.sync_from);

    const unmatched = new Set(local.map((l) => l.id));
    const matches = new Map(); // indice em desired -> linha local
    for (const matcher of MATCHERS) {
        desired.forEach((d, i) => {
            if (matches.has(i)) return;
            const found = local.find((l) => unmatched.has(l.id) && matcher(d, l));
            if (found) {
                matches.set(i, found);
                unmatched.delete(found.id);
            }
        });
    }

    const learningMap = buildCategoryLearningMap(link.user_id);
    const categoriesWithKeywords = buildCategoryKeywordList(link.user_id);
    const categoryIdByName = new Map(
        db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(link.user_id).map((c) => [normalizeName(c.name), c.id])
    );
    const categorizeRow = (d) =>
        categorize(link.user_id, d.description, learningMap, categoriesWithKeywords) ??
        categoryIdByName.get(normalizeName(PLUGGY_CATEGORY_TO_APP[d.pluggyCategory])) ??
        null;
    const insert = db.prepare(
        `INSERT INTO transactions (user_id, card_id, category_id, amount, date, description, status, external_fitid, source, installment_group, installment_number, installment_total, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // Descricao, categoria e "quem gastou" nao sao sobrescritos: podem ter
    // sido ajustados pelo usuario. Valor, data e status sao do banco.
    const update = db.prepare(
        `UPDATE transactions SET amount = ?, date = ?, status = ?, external_fitid = ?, source = ?,
             installment_group = ?, installment_number = ?, installment_total = ?
         WHERE id = ?`
    );

    let inserted = 0;
    let updated = 0;
    let deleted = 0;

    desired.forEach((d, i) => {
        const l = matches.get(i);
        const values = [d.amount, d.date, d.status, d.fitid, SOURCE, d.installmentGroup ?? null, d.installmentNumber ?? null, d.installmentTotal ?? null];

        if (!l) {
            insert.run(link.user_id, link.card_id, categorizeRow(d), d.amount, d.date, d.description, d.status, d.fitid, SOURCE,
                d.installmentGroup ?? null, d.installmentNumber ?? null, d.installmentTotal ?? null, link.created_by);
            inserted += 1;
            return;
        }

        const current = [l.amount, l.date, l.status, l.external_fitid, l.source, l.installment_group, l.installment_number, l.installment_total];
        if (current.every((v, idx) => v === values[idx])) return;

        update.run(...values, l.id);
        updated += 1;
        if (!sameAmount(l.amount, d.amount) || l.date !== d.date) {
            recordHistory(link.user_id, 'UPDATE', l, db.prepare('SELECT * FROM transactions WHERE id = ?').get(l.id));
        }
    });

    // So apaga pendentes que a propria sync criou e que sumiram da Pluggy
    // (compra cancelada, ou recriada com outro valor/descricao). Lancados
    // (CLEARED) ficam: a Pluggy as vezes para de mandar um lancamento por
    // alguns dias, e lancamentos antigos saem da janela de 12 meses.
    // Com a lista remota vazia nao apagamos nada -- mais provavel ser falha
    // de sync do que o cartao inteiro ter sido estornado.
    if (desired.length > 0) {
        const remove = db.prepare('DELETE FROM transactions WHERE id = ?');
        for (const l of local) {
            if (!unmatched.has(l.id) || l.source !== SOURCE || l.status !== 'PENDING') continue;
            remove.run(l.id);
            recordHistory(link.user_id, 'DELETE', l, null);
            deleted += 1;
        }
    }

    return { inserted, updated, deleted };
}

// Registra as faturas fechadas informadas pelo banco em Contas a Pagar (valor
// e vencimento reais, em vez de calculados pelos lancamentos) e as marca como
// pagas quando os pagamentos encontrados cobrem o valor total. Um pagamento
// e' atribuido a primeira fatura com vencimento a partir de 10 dias antes da
// data do pagamento (cobre pagar adiantado ou com alguns dias de atraso).
// So registra faturas recentes: o historico ja esta nos lancamentos, e 12
// faturas antigas quitadas so poluiriam Contas a Pagar.
const BILLS_REGISTER_LOOKBACK_DAYS = 60;

function syncBills(link, card, bills, payments) {
    const registerFrom = [link.sync_from, addDays(toLocalDate(new Date().toISOString()), -BILLS_REGISTER_LOOKBACK_DAYS)].sort()[1];
    const sortedBills = bills
        .map((b) => ({ dueDate: b.dueDate.slice(0, 10), total: round2(b.totalAmount) }))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const paidByDueDate = new Map();
    for (const payment of payments) {
        const paymentDate = toLocalDate(payment.date);
        const bill = sortedBills.find((b) => b.dueDate >= addDays(paymentDate, -10));
        if (!bill) continue;
        const entry = paidByDueDate.get(bill.dueDate) || { sum: 0, lastDate: paymentDate };
        entry.sum = round2(entry.sum + Math.abs(payment.amount));
        if (paymentDate > entry.lastDate) entry.lastDate = paymentDate;
        paidByDueDate.set(bill.dueDate, entry);
    }

    const markPaid = db.prepare(
        `INSERT INTO bill_payments (bill_id, period, amount_paid, paid_date) VALUES (?, ?, ?, ?)
         ON CONFLICT(bill_id, period) DO UPDATE SET amount_paid = excluded.amount_paid, paid_date = excluded.paid_date`
    );

    let registered = 0;
    for (const bill of sortedBills) {
        if (bill.dueDate < registerFrom || bill.total <= 0) continue;
        const billId = upsertCardBill(link.user_id, card, bill.dueDate, bill.total);
        registered += 1;

        const paid = paidByDueDate.get(bill.dueDate);
        if (paid && paid.sum >= bill.total - 0.01) markPaid.run(billId, bill.dueDate.slice(0, 7), paid.sum, paid.lastDate);
    }
    return registered;
}

// Sugestao de fechamento/vencimento para criar um cartao a partir da conta
// da Pluggy. Os lancamentos feitos NO dia do fechamento ja caem na fatura
// seguinte, e no app o closing_day e' o ultimo dia incluido na fatura (ver
// cardService.getCurrentInvoicePeriod) -- por isso o dia anterior. Usa o dia
// mais frequente porque o fechamento anda quando cai em fim de semana.
function suggestCycleDays(bills) {
    const mostFrequent = (values) => {
        const counts = new Map();
        for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const closing = mostFrequent(bills.filter((b) => b.billClosingDate).map((b) => Number(b.billClosingDate.slice(8, 10))));
    const due = mostFrequent(bills.map((b) => Number(b.dueDate.slice(8, 10))));
    return { closing_day: closing ? (closing === 1 ? 31 : closing - 1) : null, due_day: due };
}

export async function listRemoteCreditCards(userId) {
    const links = db.prepare('SELECT * FROM pluggy_card_links WHERE user_id = ?').all(userId);
    const linkByAccount = new Map(links.map((l) => [l.pluggy_account_id, l]));

    const result = [];
    for (const itemId of getItemIds()) {
        const accounts = await listAccounts(itemId);
        for (const account of accounts.filter((a) => a.type === 'CREDIT')) {
            const bills = await listBills(account.id, itemId);
            const suggestion = suggestCycleDays(bills);
            result.push({
                id: account.id,
                itemId,
                name: account.name.trim(),
                number: account.number,
                balance: account.balance,
                creditLimit: account.creditData?.creditLimit ?? null,
                suggestedCard: {
                    card_name: `${account.name.trim()} final ${account.number}`,
                    credit_limit: account.creditData?.creditLimit ?? null,
                    closing_day: suggestion.closing_day,
                    due_day: suggestion.due_day ?? (account.creditData?.balanceDueDate ? Number(account.creditData.balanceDueDate.slice(8, 10)) : null),
                },
                link: linkByAccount.get(account.id) || null,
            });
        }
    }
    return result;
}

// Sugestao de data inicial da sync para um cartao ja existente: o dia
// seguinte ao ultimo lancamento (ja ocorrido) que veio por outra origem,
// para nao duplicar faturas ja importadas por arquivo ou lancadas a mao.
export function suggestSyncFrom(userId, cardId) {
    const row = db
        .prepare(
            `SELECT MAX(date(date)) AS last FROM transactions
             WHERE user_id = ? AND card_id = ? AND source != ? AND date(date) <= date('now')`
        )
        .get(userId, cardId, SOURCE);
    return row?.last ? addDays(row.last, 1) : null;
}

// Horarios da sync automatica (hora local do servidor, mesma referencia do
// node-cron). O Meu Pluggy atualiza os dados com o banco ~1x por dia em
// horario que nao controlamos -- rodar algumas vezes ao dia pega essa
// atualizacao sem muito atraso.
export const SYNC_SCHEDULE = { minute: 45, hours: [1, 7, 13, 19] };
export const SYNC_CRON_EXPRESSION = `${SYNC_SCHEDULE.minute} ${SYNC_SCHEDULE.hours.join(',')} * * *`;

export function nextScheduledSync(now = new Date()) {
    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
        for (const hour of SYNC_SCHEDULE.hours) {
            const candidate = new Date(now);
            candidate.setDate(candidate.getDate() + dayOffset);
            candidate.setHours(hour, SYNC_SCHEDULE.minute, 0, 0);
            if (candidate > now) return candidate;
        }
    }
    return null;
}

// Mantemos so as ultimas execucoes por vinculo -- o suficiente para ver
// tendencia (falhas recorrentes, duracao) sem a tabela crescer sem limite.
const RUNS_KEPT_PER_LINK = 200;

function recordRun(link, { trigger, status, startedAt, remoteCount = null, summary = null, message = null }) {
    db.prepare(
        `INSERT INTO pluggy_sync_runs (link_id, user_id, trigger, status, started_at, duration_ms, remote_count, inserted, updated, deleted, bills_registered, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
        link.id, link.user_id, trigger, status,
        startedAt.toISOString().replace('T', ' ').slice(0, 19), Date.now() - startedAt.getTime(), remoteCount,
        summary?.inserted ?? 0, summary?.updated ?? 0, summary?.deleted ?? 0, summary?.billsRegistered ?? 0, message
    );
    db.prepare(
        `DELETE FROM pluggy_sync_runs WHERE link_id = ? AND id NOT IN (
             SELECT id FROM pluggy_sync_runs WHERE link_id = ? ORDER BY id DESC LIMIT ?
         )`
    ).run(link.id, link.id, RUNS_KEPT_PER_LINK);
}

// Vinculos criados antes do suporte a varias contas Meu Pluggy nao sabem seu
// itemId (ver migracao em db/index.js) -- descobre uma vez, testando contra
// os itens de cada titular configurado, e grava para nao repetir isso a cada
// sync.
async function resolveItemIdForAccount(accountId) {
    for (const itemId of getItemIds()) {
        const accounts = await listAccounts(itemId);
        if (accounts.some((a) => a.id === accountId)) return itemId;
    }
    throw new Error(`Conta ${accountId} nao encontrada em nenhuma credencial Pluggy configurada`);
}

const runningLinks = new Set();

// `trigger`: CRON (agendada), MANUAL (botao "sincronizar agora") ou LINK
// (primeira sync ao vincular) -- so' para o historico de monitoramento.
export async function syncCardLink(linkId, { trigger = 'MANUAL' } = {}) {
    if (runningLinks.has(linkId)) return { skipped: true };
    runningLinks.add(linkId);

    const startedAt = new Date();
    const setStatus = db.prepare(
        'UPDATE pluggy_card_links SET last_sync_at = CURRENT_TIMESTAMP, last_sync_status = ?, last_sync_message = ? WHERE id = ?'
    );
    const link = db.prepare('SELECT * FROM pluggy_card_links WHERE id = ?').get(linkId);
    let remoteCount = null;

    try {
        if (!link) throw new Error('Vinculo nao encontrado');
        const card = db.prepare('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?').get(link.card_id, link.user_id);
        if (!card) throw new Error('Cartao vinculado nao encontrado');

        let itemId = link.pluggy_item_id;
        if (!itemId) {
            itemId = await resolveItemIdForAccount(link.pluggy_account_id);
            db.prepare('UPDATE pluggy_card_links SET pluggy_item_id = ? WHERE id = ?').run(itemId, link.id);
        }

        const [account, remoteTxns, bills] = await Promise.all([
            getAccount(link.pluggy_account_id, itemId),
            listTransactions(link.pluggy_account_id, itemId),
            listBills(link.pluggy_account_id, itemId),
        ]);
        remoteCount = remoteTxns.length;

        const payments = remoteTxns.filter(isCardPayment);
        const desired = buildDesiredRows(link.pluggy_account_id, remoteTxns.filter((t) => !isCardPayment(t)), bills, card.closing_day)
            .filter((d) => d.date >= link.sync_from);

        const result = db.transaction(() => {
            const counts = reconcileTransactions(link, desired);
            const billsRegistered = syncBills(link, card, bills, payments);

            // Limite informado pelo banco e' a fonte da verdade (usado nos
            // alertas de uso de credito).
            const bankLimit = account.creditData?.creditLimit;
            if (bankLimit > 0 && bankLimit !== card.credit_limit) {
                db.prepare('UPDATE credit_cards SET credit_limit = ? WHERE id = ?').run(bankLimit, card.id);
            }

            const summary = { ...counts, billsRegistered };
            setStatus.run('OK', JSON.stringify(summary), link.id);
            recordRun(link, { trigger, status: 'OK', startedAt, remoteCount, summary });
            return summary;
        })();

        checkBudgetAlerts(link.user_id);
        return result;
    } catch (err) {
        if (link) {
            setStatus.run('ERROR', err.message, link.id);
            recordRun(link, { trigger, status: 'ERROR', startedAt, remoteCount, message: err.message });
            alertSyncFailure(link, err.message);
        }
        throw err;
    } finally {
        runningLinks.delete(linkId);
    }
}

// No maximo um alerta por dia por cartao -- uma conexao quebrada falharia a
// cada execucao do cron e inundaria a lista de alertas.
function alertSyncFailure(link, message) {
    const key = `vinculo-${link.id}`;
    if (alreadyAlertedToday(link.user_id, 'PLUGGY_SYNC', key)) return;
    const card = db.prepare('SELECT card_name FROM credit_cards WHERE id = ?').get(link.card_id);
    raiseAlert({
        userId: link.user_id,
        type: 'PLUGGY_SYNC',
        severity: 'WARNING',
        message: `Falha ao sincronizar o cartao "${card?.card_name ?? link.card_id}" com o banco (${key}): ${message}`,
    });
}

// Chamado pelo cron: sincroniza todos os cartoes vinculados, sem deixar a
// falha de um impedir os demais.
export async function syncAllLinks() {
    const links = db.prepare('SELECT id FROM pluggy_card_links').all();
    for (const { id } of links) {
        try {
            await syncCardLink(id, { trigger: 'CRON' });
        } catch (err) {
            console.error(`Erro na sync Pluggy do vinculo ${id}:`, err.message);
        }
    }
}

// ---------- Monitoramento de conexoes ----------

// Sync roda a cada 6h: sem sucesso ha mais de 7h significa que pelo menos
// uma execucao agendada falhou ou nao rodou (servidor fora do ar).
const LINK_STALE_HOURS = 7;
// Meu Pluggy atualiza com o banco a cada ~24h: 48h sem atualizar indica
// problema na conexao com o banco (consentimento, instabilidade).
const ITEM_STALE_HOURS = 48;
// Consentimento do Open Finance vale 12 meses e precisa ser renovado no
// app do banco / meu.pluggy.ai antes de expirar.
const CONSENT_WARNING_DAYS = 30;

const LEVEL_ORDER = { ok: 0, warning: 1, error: 2 };
const worstLevel = (levels) => levels.reduce((worst, l) => (LEVEL_ORDER[l] > LEVEL_ORDER[worst] ? l : worst), 'ok');
const hoursSince = (date, now) => (now - date) / 3_600_000;
const parseSqliteUtc = (value) => new Date(`${value.replace(' ', 'T')}Z`);

const PRODUCT_LABELS = { accounts: 'contas', creditCards: 'cartoes', transactions: 'lancamentos', investments: 'investimentos', identity: 'identidade' };

function evaluateItem(item, now) {
    const issues = [];
    if (['LOGIN_ERROR', 'WAITING_USER_INPUT', 'OUTDATED'].includes(item.status)) {
        issues.push({ level: 'error', message: `Conexao com o banco com status ${item.status} (${item.executionStatus}). Reconecte o banco em meu.pluggy.ai.` });
    }
    if (item.error?.message) {
        issues.push({ level: 'error', message: `Erro informado pela Pluggy: ${item.error.message}` });
    }
    if (item.executionStatus === 'PARTIAL_SUCCESS') {
        const failed = Object.entries(item.statusDetail || {})
            .filter(([, detail]) => detail && detail.isUpdated === false)
            .map(([product]) => PRODUCT_LABELS[product] || product);
        issues.push({
            level: 'warning',
            message: `Ultima atualizacao do banco foi parcial${failed.length ? ` (falhou: ${failed.join(', ')})` : ''}.`,
        });
    }
    if (item.autoSyncDisabledAt) {
        issues.push({ level: 'error', message: 'A Pluggy desativou a atualizacao automatica desta conexao. Reconecte o banco em meu.pluggy.ai.' });
    }
    if (item.lastUpdatedAt && hoursSince(new Date(item.lastUpdatedAt), now) > ITEM_STALE_HOURS) {
        issues.push({
            level: 'warning',
            message: `Dados do banco nao sao atualizados ha ${Math.floor(hoursSince(new Date(item.lastUpdatedAt), now))}h.`,
        });
    }
    if (item.consentExpiresAt) {
        const daysLeft = Math.floor((new Date(item.consentExpiresAt) - now) / 86_400_000);
        if (daysLeft < 0) {
            issues.push({ level: 'error', message: 'O consentimento do Open Finance expirou. Renove a conexao em meu.pluggy.ai.' });
        } else if (daysLeft <= CONSENT_WARNING_DAYS) {
            issues.push({ level: 'warning', message: `O consentimento do Open Finance expira em ${daysLeft} dias. Renove em meu.pluggy.ai.` });
        }
    }
    return { level: worstLevel(issues.map((i) => i.level)), issues };
}

function evaluateLink(link, now) {
    const issues = [];
    if (link.last_sync_status === 'ERROR') {
        issues.push({ level: 'error', message: `Ultima sincronizacao falhou: ${link.last_sync_message}` });
    }
    if (!link.last_sync_at) {
        issues.push({ level: 'warning', message: 'Ainda nao sincronizado.' });
    } else {
        const lastOk = db
            .prepare("SELECT MAX(started_at) AS at FROM pluggy_sync_runs WHERE link_id = ? AND status = 'OK'")
            .get(link.id)?.at;
        const reference = lastOk ? parseSqliteUtc(lastOk) : null;
        // Falhando sem nunca ter tido sucesso, o erro acima ja diz tudo.
        const redundant = !reference && link.last_sync_status === 'ERROR';
        if (!redundant && (!reference || hoursSince(reference, now) > LINK_STALE_HOURS)) {
            issues.push({
                level: 'warning',
                message: reference
                    ? `Sem sincronizacao bem-sucedida ha ${Math.floor(hoursSince(reference, now))}h.`
                    : 'Nenhuma sincronizacao bem-sucedida registrada.',
            });
        }
    }
    return { level: worstLevel(issues.map((i) => i.level)), issues };
}

// Status do item mudam pouco (Meu Pluggy atualiza ~1x/dia) e a tela de
// monitoramento faz polling -- cache curto evita bater na Pluggy a cada
// refresh. `refresh` (botao "verificar agora") ignora o cache.
const ITEM_CACHE_MS = 60_000;
const itemCache = new Map(); // itemId -> { at, value }

async function fetchItemStatus(itemId, { refresh }) {
    const cached = itemCache.get(itemId);
    if (!refresh && cached && Date.now() - cached.at < ITEM_CACHE_MS) return cached.value;

    const startedAt = Date.now();
    let value;
    try {
        const item = await getItem(itemId);
        value = { item, latencyMs: Date.now() - startedAt, fetchError: null };
    } catch (err) {
        value = { item: null, latencyMs: Date.now() - startedAt, fetchError: err.message };
    }
    itemCache.set(itemId, { at: Date.now(), value });
    return value;
}

function describeItem(itemId, { item, latencyMs, fetchError }, now) {
    if (fetchError) {
        return {
            id: itemId,
            connector: null,
            latencyMs,
            level: 'error',
            issues: [{ level: 'error', message: `Nao foi possivel consultar a Pluggy: ${fetchError}` }],
        };
    }
    return {
        id: itemId,
        connector: item.connector?.name ?? null,
        status: item.status,
        executionStatus: item.executionStatus,
        lastUpdatedAt: item.lastUpdatedAt,
        nextAutoSyncAt: item.nextAutoSyncAt,
        consentExpiresAt: item.consentExpiresAt,
        latencyMs,
        ...evaluateItem(item, now),
    };
}

export async function getConnectionsStatus(userId, { refresh = false } = {}) {
    const now = new Date();
    const items = [];
    for (const itemId of getItemIds()) {
        items.push(describeItem(itemId, await fetchItemStatus(itemId, { refresh }), now));
    }

    const since24h = new Date(now - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    const links = db
        .prepare(
            `SELECT l.*, c.card_name FROM pluggy_card_links l
             JOIN credit_cards c ON c.id = l.card_id
             WHERE l.user_id = ? ORDER BY l.id`
        )
        .all(userId)
        .map((link) => {
            const stats = db
                .prepare(
                    `SELECT COUNT(*) AS runs, SUM(status = 'ERROR') AS errors, ROUND(AVG(duration_ms)) AS avg_duration_ms
                     FROM pluggy_sync_runs WHERE link_id = ? AND started_at >= ?`
                )
                .get(link.id, since24h);
            let summary = null;
            if (link.last_sync_status === 'OK') {
                try { summary = JSON.parse(link.last_sync_message); } catch { summary = null; }
            }
            return {
                id: link.id,
                card_id: link.card_id,
                card_name: link.card_name,
                sync_from: link.sync_from,
                last_sync_at: link.last_sync_at,
                last_sync_status: link.last_sync_status,
                last_sync_summary: summary,
                stats24h: { runs: stats.runs, errors: stats.errors || 0, avgDurationMs: stats.avg_duration_ms },
                ...evaluateLink(link, now),
            };
        });

    const runs = db
        .prepare(
            `SELECT r.*, c.card_name FROM pluggy_sync_runs r
             JOIN pluggy_card_links l ON l.id = r.link_id
             JOIN credit_cards c ON c.id = l.card_id
             WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 50`
        )
        .all(userId);

    return {
        checkedAt: now.toISOString(),
        overall: worstLevel([...items, ...links].map((x) => x.level)),
        nextScheduledSyncAt: links.length ? nextScheduledSync(now)?.toISOString() ?? null : null,
        items,
        links,
        runs,
    };
}

// Chamado pelo cron depois da sync: alerta problemas na conexao com o banco
// (consentimento vencendo, Meu Pluggy sem atualizar) que a sync em si nao
// detecta -- ela so' le o que a Pluggy guardou, que pode estar velho.
export async function checkConnectionsHealth() {
    const userIds = db.prepare('SELECT DISTINCT user_id FROM pluggy_card_links').all().map((r) => r.user_id);
    if (userIds.length === 0) return;

    const now = new Date();
    for (const itemId of getItemIds()) {
        const described = describeItem(itemId, await fetchItemStatus(itemId, { refresh: true }), now);
        if (described.level === 'ok') continue;

        const key = `conexao-${itemId.slice(0, 8)}`;
        for (const userId of userIds) {
            if (alreadyAlertedToday(userId, 'PLUGGY_CONNECTION', key)) continue;
            raiseAlert({
                userId,
                type: 'PLUGGY_CONNECTION',
                severity: described.level === 'error' ? 'CRITICAL' : 'WARNING',
                message: `Conexao Open Finance ${described.connector ?? ''} (${key}): ${described.issues.map((i) => i.message).join(' ')}`,
            });
        }
    }
}
