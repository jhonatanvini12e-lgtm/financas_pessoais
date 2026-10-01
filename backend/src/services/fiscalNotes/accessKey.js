// Chave de acesso da NF-e/NFC-e: 44 digitos com estrutura fixa definida pela
// SEFAZ. Validamos tamanho e o digito verificador (ultimo digito, modulo 11)
// para rejeitar chaves digitadas errado antes de gravar, e extraimos o que da'
// pra saber so' da chave (UF e modelo) quando a nota e' cadastrada sem XML.
//
// Layout (posicoes): cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9)
//                    tpEmis(1) cNF(8) cDV(1)

const UF_BY_CODE = {
    11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO',
    21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA',
    31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP',
    41: 'PR', 42: 'SC', 43: 'RS',
    50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

export function onlyDigits(raw) {
    return String(raw || '').replace(/\D/g, '');
}

// Digito verificador por modulo 11, pesos ciclando de 2 a 9 da direita pra
// esquerda sobre os 43 primeiros digitos.
function checkDigit(key43) {
    let weight = 2;
    let sum = 0;
    for (let i = key43.length - 1; i >= 0; i -= 1) {
        sum += Number(key43[i]) * weight;
        weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    const dv = 11 - remainder;
    return dv >= 10 ? 0 : dv;
}

export function validateAccessKey(raw) {
    const key = onlyDigits(raw);
    if (key.length !== 44) {
        return { valid: false, error: 'A chave de acesso deve ter 44 digitos.' };
    }
    if (checkDigit(key.slice(0, 43)) !== Number(key[43])) {
        return { valid: false, error: 'Digito verificador da chave invalido -- confira os numeros.' };
    }
    const uf = UF_BY_CODE[Number(key.slice(0, 2))] || null;
    const model = key.slice(20, 22); // "55" ou "65"
    return { valid: true, key, uf, model };
}
