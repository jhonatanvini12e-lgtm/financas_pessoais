import { getItemIds, listAccounts, listBills } from './pluggyClient.js';

// Agrega as faturas de cartao de credito que a Pluggy ja tem dos titulares
// configurados (uma conta Meu Pluggy por CPF, ver pluggyClient.js). Diferente
// da fatura "virtual" que o cardService calcula a partir das transacoes, aqui
// e' a fatura fechada que o proprio banco informa via Open Finance: valor
// total, pagamento minimo e vencimento como vieram da instituicao.
//
// So' leitura do estado que a Pluggy ja guarda -- nao dispara atualizacao de
// item (isso consome cota do Open Finance, ver comentario no pluggyClient).

function statusFor(dueDate) {
    if (!dueDate) return 'OPEN';
    const today = new Date().toISOString().slice(0, 10);
    return dueDate.slice(0, 10) < today ? 'LATE' : 'OPEN';
}

export async function listHouseholdBills() {
    const bills = [];
    for (const itemId of getItemIds()) {
        const accounts = await listAccounts(itemId);
        for (const account of accounts.filter((a) => a.type === 'CREDIT')) {
            const accountName = account.name?.trim() || 'Cartao';
            const label = account.number ? `${accountName} final ${account.number}` : accountName;
            const remoteBills = await listBills(account.id, itemId);
            for (const bill of remoteBills) {
                bills.push({
                    id: bill.id,
                    accountId: account.id,
                    accountName: label,
                    dueDate: bill.dueDate ? bill.dueDate.slice(0, 10) : null,
                    totalAmount: bill.totalAmount ?? null,
                    minimumPayment: bill.minimumPayment ?? null,
                    currencyCode: bill.totalAmountCurrencyCode || 'BRL',
                    status: statusFor(bill.dueDate),
                });
            }
        }
    }
    // Mais recentes primeiro; faturas sem vencimento vao para o fim.
    bills.sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
    return bills;
}
