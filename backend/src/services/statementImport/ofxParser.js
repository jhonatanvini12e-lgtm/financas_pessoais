// Parser OFX minimalista: o formato OFX (usado por bancos/cartoes brasileiros
// para exportacao manual) e SGML-like, com tags nem sempre fechadas.
// Em vez de depender de uma lib externa pouco mantida, extraimos os blocos
// <STMTTRN>...</STMTTRN> por regex e lemos os campos que realmente usamos.

import { extractInstallmentInfo } from './columnMapper.js';

function extractTag(block, tag) {
    const match = block.match(new RegExp(`<${tag}>\\s*([^\\r\\n<]+)`, 'i'));
    return match ? match[1].trim() : null;
}

function parseOfxDate(raw) {
    // Formato tipico: 20240115120000[-3:BRT] ou apenas 20240115
    if (!raw) return null;
    const digits = raw.slice(0, 8);
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    return `${year}-${month}-${day}`;
}

export function parseOfx(fileContent) {
    const blocks = fileContent.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

    return blocks.map((block) => {
        const amount = parseFloat(extractTag(block, 'TRNAMT'));
        const rawDescription = extractTag(block, 'MEMO') || extractTag(block, 'NAME') || 'Transacao importada';
        const installment = extractInstallmentInfo(rawDescription);
        return {
            fitid: extractTag(block, 'FITID'),
            date: parseOfxDate(extractTag(block, 'DTPOSTED')),
            amount: Number.isFinite(amount) ? amount : 0,
            description: installment ? installment.cleanDescription : rawDescription,
            installmentNumber: installment?.number ?? null,
            installmentTotal: installment?.total ?? null,
        };
    });
}
