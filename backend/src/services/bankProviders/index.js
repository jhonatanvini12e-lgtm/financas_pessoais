import { MockBankProvider } from './mockProvider.js';

// Troque esta instancia por um provider real (implementando BankProvider)
// quando houver credenciamento com um agregador Open Finance.
export const activeBankProvider = new MockBankProvider();

export const SUPPORTED_PROVIDERS = ['nubank', 'inter', 'santander', 'mercadopago'];
