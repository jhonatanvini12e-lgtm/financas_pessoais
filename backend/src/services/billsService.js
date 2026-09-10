import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';
import { raiseAlert, alreadyAlertedToday } from './notificationEngine.js';
import { sendBillDueAlert } from './emailService.js';
import { getCardInvoice } from './cardService.js';

function currentPeriod(referenceDate = new Date()) {
    return referenceDate.toISOString().slice(0, 7); // 'YYYY-MM'
}

// Contas com vencimento no dia 29-31 precisam de um teto por mes (fevereiro
// so tem 28/29 dias) -- sem isso, `new Date(year, month-1, 31)` "rola" para o
// mes seguinte e a conta de fevereiro apareceria com vencimento em marco.
function dueDateForPeriod(period, dueDay) {
    const [year, month] = period.split('-').map(Number);
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    return new Date(year, month - 1, Math.min(dueDay, lastDayOfMonth));
}

function statusFor(dueDate, paid, referenceDate) {
    if (paid) return 'PAID';
    return referenceDate > dueDate ? 'LATE' : 'PENDING';
}

// Contas cadastradas manualmente. Fixas (recurring=1) repetem todo mes: o
// vencimento do mes corrente e' calculado a partir de due_day, e "paga" vale
// so para o (bill_id, period) do mes corrente -- no mes seguinte ela volta a
// aparecer como pendente. Avulsas (recurring=0) tem uma data unica em
// due_date e, uma vez pagas, ficam paga para sempre (nao regeneram).
// "paga" nunca e' detectado a partir de transacoes -- e' o usuario quem marca.
export function getBillsStatus(userId, referenceDate = new Date()) {
    const bills = db.prepare('SELECT * FROM bills WHERE user_id = ? AND active = 1').all(userId);

    return bills.map((bill) => {
        const isRecurring = bill.recurring !== 0;
        const period = isRecurring ? currentPeriod(referenceDate) : bill.due_date.slice(0, 7);
        const dueDate = isRecurring ? dueDateForPeriod(period, bill.due_day) : new Date(bill.due_date);
        const payment = db
            .prepare('SELECT * FROM bill_payments WHERE bill_id = ? AND period = ?')
            .get(bill.id, period);
        const category = bill.category_id
            ? db.prepare('SELECT name FROM categories WHERE id = ?').get(bill.category_id)
            : null;

        return {
            id: bill.id,
            kind: 'BILL',
            name: bill.name,
            categoryName: bill.card_id ? 'Cartao de credito' : category?.name || null,
            expectedAmount: bill.expected_amount,
            dueDay: bill.due_day,
            recurring: isRecurring,
            cardId: bill.card_id || null,
            period,
            dueDate: dueDate.toISOString().slice(0, 10),
            paid: Boolean(payment),
            amountPaid: payment?.amount_paid ?? null,
            paidDate: payment?.paid_date ?? null,
            status: statusFor(dueDate, Boolean(payment), referenceDate),
        };
    });
}

// Faturas de cartao ainda nao registradas explicitamente (ver
// registerCardInvoiceFromImport): calculadas ao vivo por cardService a partir
// das transacoes do periodo aberto, com o mesmo controle de "paga" via
// card_invoice_payments. Uma fatura ja registrada (mesmo card_id + due_date
// em bills) e' pulada aqui para nao aparecer duas vezes na lista -- a linha
// registrada e' quem manda a partir dai (ver getBillsStatus).
export function getCardInvoicesStatus(userId, referenceDate = new Date()) {
    const cards = db.prepare('SELECT * FROM credit_cards WHERE user_id = ?').all(userId);

    return cards
        .map((card) => {
            const invoice = getCardInvoice(card, referenceDate);
            if (invoice.total <= 0) return null;

            const alreadyRegistered = db
                .prepare('SELECT id FROM bills WHERE user_id = ? AND card_id = ? AND due_date = ? AND active = 1')
                .get(userId, card.id, invoice.dueDate);
            if (alreadyRegistered) return null;

            const period = invoice.dueDate.slice(0, 7);
            const payment = db
                .prepare('SELECT * FROM card_invoice_payments WHERE card_id = ? AND period = ?')
                .get(card.id, period);
            const dueDate = new Date(invoice.dueDate);

            return {
                id: card.id,
                kind: 'CARD_INVOICE',
                name: `Fatura ${card.card_name}`,
                categoryName: 'Cartao de credito',
                expectedAmount: invoice.total,
                dueDay: card.due_day,
                period,
                dueDate: invoice.dueDate,
                paid: Boolean(payment),
                amountPaid: payment?.amount_paid ?? null,
                paidDate: payment?.paid_date ?? null,
                status: statusFor(dueDate, Boolean(payment), referenceDate),
            };
        })
        .filter(Boolean);
}

// Chamado apos a importacao de um extrato/fatura de cartao (ver
// POST /transactions/import-statement/commit): calcula a fatura (valor +
// vencimento) do ciclo em que os lancamentos importados caem -- usando
// getCardInvoice com a data dos proprios lancamentos como referencia, entao
// funciona tanto para a fatura aberta atual quanto para uma fatura ja
// fechada de um mes anterior -- e registra/atualiza uma linha avulsa em
// bills para ela aparecer em Contas a Pagar com o vencimento certo, sem
// precisar de nenhuma acao manual do usuario. Idempotente: reimportar mais
// lancamentos da mesma fatura atualiza o valor em vez de duplicar a linha.
export function registerCardInvoiceFromImport(userId, cardId, referenceDate = new Date()) {
    const card = db.prepare('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?').get(cardId, userId);
    if (!card) return null;

    const invoice = getCardInvoice(card, referenceDate);
    if (invoice.total <= 0) return null;

    const existing = db
        .prepare('SELECT * FROM bills WHERE user_id = ? AND card_id = ? AND due_date = ?')
        .get(userId, cardId, invoice.dueDate);

    if (existing) {
        db.prepare('UPDATE bills SET expected_amount = ?, active = 1 WHERE id = ?').run(invoice.total, existing.id);
        return existing.id;
    }

    const info = db
        .prepare(
            `INSERT INTO bills (user_id, name, expected_amount, recurring, due_date, card_id)
             VALUES (?, ?, ?, 0, ?, ?)`
        )
        .run(userId, `Fatura ${card.card_name}`, invoice.total, invoice.dueDate, cardId);
    return info.lastInsertRowid;
}

export function getAllBillsStatus(userId, referenceDate = new Date()) {
    const items = [...getBillsStatus(userId, referenceDate), ...getCardInvoicesStatus(userId, referenceDate)].sort(
        (a, b) => a.dueDate.localeCompare(b.dueDate)
    );
    const pending = items.filter((i) => !i.paid);
    const late = pending.filter((i) => i.status === 'LATE');

    return {
        items,
        totalPending: Number(pending.reduce((s, i) => s + i.expectedAmount, 0).toFixed(2)),
        totalLate: Number(late.reduce((s, i) => s + i.expectedAmount, 0).toFixed(2)),
        lateCount: late.length,
    };
}

export function markBillPaid(userId, billId, { amount_paid, period } = {}) {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(billId, userId);
    if (!bill) throw new Error('Conta nao encontrada');

    const p = period || currentPeriod();
    db.prepare(
        `INSERT INTO bill_payments (bill_id, period, amount_paid, paid_date) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(bill_id, period) DO UPDATE SET amount_paid = excluded.amount_paid, paid_date = CURRENT_TIMESTAMP`
    ).run(bill.id, p, amount_paid ?? bill.expected_amount);

    return getBillsStatus(userId).find((b) => b.id === bill.id);
}

export function unmarkBillPaid(userId, billId, period) {
    const bill = db.prepare('SELECT * FROM bills WHERE id = ? AND user_id = ?').get(billId, userId);
    if (!bill) throw new Error('Conta nao encontrada');

    db.prepare('DELETE FROM bill_payments WHERE bill_id = ? AND period = ?').run(bill.id, period || currentPeriod());
    return getBillsStatus(userId).find((b) => b.id === bill.id);
}

export function markCardInvoicePaid(userId, cardId, { amount_paid, period } = {}) {
    const card = db.prepare('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?').get(cardId, userId);
    if (!card) throw new Error('Cartao nao encontrado');

    const invoice = getCardInvoice(card);
    const p = period || invoice.dueDate.slice(0, 7);
    db.prepare(
        `INSERT INTO card_invoice_payments (card_id, period, amount_paid, paid_date) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(card_id, period) DO UPDATE SET amount_paid = excluded.amount_paid, paid_date = CURRENT_TIMESTAMP`
    ).run(card.id, p, amount_paid ?? invoice.total);

    return getCardInvoicesStatus(userId).find((c) => c.id === card.id);
}

export function unmarkCardInvoicePaid(userId, cardId, period) {
    const card = db.prepare('SELECT * FROM credit_cards WHERE id = ? AND user_id = ?').get(cardId, userId);
    if (!card) throw new Error('Cartao nao encontrado');

    const invoice = getCardInvoice(card);
    db.prepare('DELETE FROM card_invoice_payments WHERE card_id = ? AND period = ?').run(
        card.id,
        period || invoice.dueDate.slice(0, 7)
    );
    return getCardInvoicesStatus(userId).find((c) => c.id === card.id);
}

// Chamado pelo cron diario: alerta contas manuais (nao-cartao, ja cobertas por
// cardService.runCardChecks) que estao a N dias do vencimento e ainda nao pagas.
export function runBillChecks(userId) {
    const bills = getBillsStatus(userId);
    const now = new Date();

    for (const bill of bills) {
        if (bill.paid) continue;
        const daysUntilDue = Math.ceil((new Date(bill.dueDate) - now) / (1000 * 60 * 60 * 24));
        if (daysUntilDue !== budgetParams.billDueDateWarningDays) continue;

        const key = `${bill.id}-${bill.period}`;
        if (alreadyAlertedToday(userId, 'BILL_DUE', key)) continue;

        raiseAlert({
            userId,
            type: 'BILL_DUE',
            severity: 'WARNING',
            message: `Conta "${bill.name}" (${key}) vence em ${bill.dueDate}, valor R$ ${bill.expectedAmount.toFixed(2)}`,
            emailFn: () => sendBillDueAlert(bill.name, bill.dueDate, bill.expectedAmount),
        });
    }

    return bills;
}
