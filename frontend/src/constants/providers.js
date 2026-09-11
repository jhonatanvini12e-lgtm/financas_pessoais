export const PROVIDERS = [
    { value: 'nubank', label: 'Nubank' },
    { value: 'inter', label: 'Inter' },
    { value: 'santander', label: 'Santander' },
    { value: 'mercadopago', label: 'Mercado Pago' },
    { value: 'outro', label: 'Outro' },
];

// "outro" fica de fora do mapa de labels de proposito: em Transactions.jsx,
// bankNameForTxn faz `PROVIDER_LABELS[card.provider] || card.card_name` --
// se "outro" tivesse label aqui, cartoes com esse provider mostrariam a
// string generica "Outro" em vez de caírem no apelido (card_name) que o
// usuario escolheu, quebrando o fallback documentado naquele arquivo.
export const PROVIDER_LABELS = Object.fromEntries(
    PROVIDERS.filter((p) => p.value !== 'outro').map((p) => [p.value, p.label])
);
