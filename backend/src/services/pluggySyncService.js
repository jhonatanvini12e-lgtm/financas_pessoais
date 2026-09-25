import crypto from 'node:crypto';
import db from '../db/index.js';
import { getItemIds, listAccounts, getAccount, listTransactions, listBills } from './pluggyClient.js';
import { categorize, buildCategoryLearningMap, buildCategoryKeywordList, normalizeForMatch } from './categorizationEngine.js';
import { addMonths } from './statementImport/columnMapper.js';
import { upsertCardBill } from './billsService.js';
import { checkBudgetAlerts } from './budgetEngine.js';

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
function buildDesiredRows(accountId, remoteTxns) {
    const rows = [];
    const groups = new Map();
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
            date: toLocalDate(txn.date),
            status: txn.status === 'POSTED' ? 'CLEARED' : 'PENDING',
            description: baseDescription,
        };

        if (meta.totalInstallments > 1 && meta.installmentNumber >= 1) {
            row.installmentNumber = meta.installmentNumber;
            row.installmentTotal = meta.totalInstallments;
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

        let previous = null;
        for (const row of installments) {
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
            const categoryId = categorize(link.user_id, d.description, learningMap, categoriesWithKeywords);
            insert.run(link.user_id, link.card_id, categoryId || null, d.amount, d.date, d.description, d.status, d.fitid, SOURCE,
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
            const bills = await listBills(account.id);
            const suggestion = suggestCycleDays(bills);
            result.push({
                id: account.id,
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

const runningLinks = new Set();

export async function syncCardLink(linkId) {
    if (runningLinks.has(linkId)) return { skipped: true };
    runningLinks.add(linkId);

    const setStatus = db.prepare(
        'UPDATE pluggy_card_links SET last_sync_at = CURRENT_TIMESTAMP, last_sync_status = ?, last_sync_message = ? WHERE id = ?'
    );

    try {
        const link = db.prepare('SELECT * FROM pluggy_card_links WHERE id = ?').get(linkId);
        if (!link) throw new Error('Vinculo nao encontrado');
        const card = db.prepare('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?').get(link.card_id, link.user_id);
        if (!card) throw new Error('Cartao vinculado nao encontrado');

        const [account, remoteTxns, bills] = await Promise.all([
            getAccount(link.pluggy_account_id),
            listTransactions(link.pluggy_account_id),
            listBills(link.pluggy_account_id),
        ]);

        const payments = remoteTxns.filter(isCardPayment);
        const desired = buildDesiredRows(link.pluggy_account_id, remoteTxns.filter((t) => !isCardPayment(t)))
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
            return summary;
        })();

        checkBudgetAlerts(link.user_id);
        return result;
    } catch (err) {
        setStatus.run('ERROR', err.message, linkId);
        throw err;
    } finally {
        runningLinks.delete(linkId);
    }
}

// Chamado pelo cron: sincroniza todos os cartoes vinculados, sem deixar a
// falha de um impedir os demais.
export async function syncAllLinks() {
    const links = db.prepare('SELECT id FROM pluggy_card_links').all();
    for (const { id } of links) {
        try {
            await syncCardLink(id);
        } catch (err) {
            console.error(`Erro na sync Pluggy do vinculo ${id}:`, err.message);
        }
    }
}
