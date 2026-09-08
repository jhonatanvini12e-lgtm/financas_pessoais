import { BankProvider } from './BankProvider.js';

const SAMPLE_MERCHANTS = ['Ifood', 'Uber', 'Netflix', 'Supermercado Extra', 'Posto Ipiranga', 'Farmacia Drogasil'];

function randomTransaction() {
    const merchant = SAMPLE_MERCHANTS[Math.floor(Math.random() * SAMPLE_MERCHANTS.length)];
    const amount = -Number((Math.random() * 200 + 10).toFixed(2));
    const date = new Date().toISOString().slice(0, 10);
    return {
        fitid: `MOCK-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        date,
        amount,
        description: merchant,
    };
}

// Provider simulado: nao fala com nenhum banco real. Serve para exercitar toda
// a arquitetura de sincronizacao (status, falhas, alertas) sem credenciais de
// um agregador Open Finance certificado (Pluggy/Belvo).
export class MockBankProvider extends BankProvider {
    async sync(providerKey) {
        // ~15% de chance de falha simulada, para exercitar o fluxo de alerta de sync.
        if (Math.random() < 0.15) {
            throw new Error(`Timeout simulado ao conectar com ${providerKey}`);
        }

        const transactionCount = Math.floor(Math.random() * 3) + 1;
        const transactions = Array.from({ length: transactionCount }, randomTransaction);

        return {
            balance: Number((Math.random() * 3000 + 100).toFixed(2)),
            transactions,
        };
    }
}
