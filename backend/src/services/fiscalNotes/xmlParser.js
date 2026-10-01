import { XMLParser } from 'fast-xml-parser';

// Parser de NF-e (modelo 55) e NFC-e (modelo 65). O XML da nota segue o layout
// oficial da SEFAZ: a raiz pode vir embrulhada em <nfeProc> (XML "autorizado",
// com protocolo) ou ser direto <NFe>. Em ambos os casos o conteudo fiscal fica
// em NFe > infNFe. So extraimos o cabecalho que interessa para a tela de notas
// -- o XML inteiro e' guardado em xml_raw para quem precisar do resto depois.

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Campos como numero da nota e CNPJ as vezes sao lidos como numero e
    // perdem zeros a esquerda -- tratamos tudo como texto e normalizamos nos.
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
});

// A chave de acesso vem no atributo Id do infNFe como "NFe" + 44 digitos.
// Alguns emissores mandam so os 44 digitos; cobrimos os dois casos.
function extractAccessKey(infNFe) {
    const id = infNFe?.['@_Id'];
    if (!id) return null;
    const digits = String(id).replace(/\D/g, '');
    return digits.length === 44 ? digits : null;
}

// Pega o primeiro campo nao-vazio de uma lista de nomes possiveis (o layout
// mudou entre versoes: dhEmi/dEmi, por ex).
function firstOf(obj, ...keys) {
    for (const key of keys) {
        const value = obj?.[key];
        if (value != null && String(value).trim() !== '') return String(value).trim();
    }
    return null;
}

// dhEmi vem como "2024-03-15T10:30:00-03:00"; dEmi (layout antigo) como
// "2024-03-15". Guardamos so a parte da data (AAAA-MM-DD) para a tela.
function normalizeDate(raw) {
    if (!raw) return null;
    const match = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

function toNumber(raw) {
    if (raw == null || raw === '') return null;
    const n = Number(String(raw).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

const MODEL_LABEL = { 55: 'NF-e', 65: 'NFC-e' };

/**
 * @param {string} xml conteudo bruto do arquivo XML
 * @returns dados normalizados da nota prontos para gravar em fiscal_notes
 * @throws {Error} se o XML nao for uma NF-e/NFC-e reconhecivel
 */
export function parseNfeXml(xml) {
    let root;
    try {
        root = parser.parse(xml);
    } catch (err) {
        throw new Error(`XML invalido: ${err.message}`);
    }

    // Desembrulha nfeProc > NFe > infNFe, ou NFe > infNFe direto.
    const nfe = root?.nfeProc?.NFe || root?.NFe;
    const infNFe = nfe?.infNFe;
    if (!infNFe) {
        throw new Error('Este XML nao e uma NF-e/NFC-e valida (tag infNFe nao encontrada).');
    }

    const ide = infNFe.ide || {};
    const emit = infNFe.emit || {};
    const dest = infNFe.dest || {};
    const icmsTot = infNFe.total?.ICMSTot || {};

    const model = firstOf(ide, 'mod');
    const accessKey = extractAccessKey(infNFe);

    return {
        accessKey,
        model,
        modelLabel: MODEL_LABEL[model] || model,
        number: firstOf(ide, 'nNF'),
        series: firstOf(ide, 'serie'),
        issuerName: firstOf(emit, 'xNome', 'xFant'),
        issuerCnpj: firstOf(emit, 'CNPJ'),
        recipientName: firstOf(dest, 'xNome'),
        // NFC-e de consumidor costuma trazer so CPF; NF-e pode trazer CNPJ.
        recipientCpf: firstOf(dest, 'CPF'),
        recipientCnpj: firstOf(dest, 'CNPJ'),
        issueDate: normalizeDate(firstOf(ide, 'dhEmi', 'dEmi')),
        totalAmount: toNumber(firstOf(icmsTot, 'vNF')),
    };
}
