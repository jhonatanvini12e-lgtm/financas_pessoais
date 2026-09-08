// Heuristica compartilhada por CSV e XLSX: extratos de bancos diferentes usam
// cabecalhos diferentes (ex: "Data" vs "date", "Valor" vs "amount"), entao
// detectamos as colunas de data/descricao/valor pelo nome em vez de exigir um
// layout fixo.

const DATE_HEADERS = ['data lancamento', 'data da transacao', 'data', 'date', 'dt'];
const DESCRIPTION_HEADERS = ['descricao', 'historico', 'estabelecimento', 'lancamento', 'detalhes', 'title', 'memo', 'description'];
const AMOUNT_HEADERS = ['valor da transacao', 'valor (r$)', 'valor rs', 'valor', 'amount'];

function stripAccents(str) {
    return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeHeader(h) {
    return stripAccents(String(h ?? '').toLowerCase().trim());
}

function findColumnIndex(headers, candidates) {
    const normalized = headers.map(normalizeHeader);
    for (const candidate of candidates) {
        const idx = normalized.findIndex((h) => h === candidate || h.includes(candidate));
        if (idx !== -1) return idx;
    }
    return -1;
}

export function detectColumns(headerRow) {
    const dateIdx = findColumnIndex(headerRow, DATE_HEADERS);
    const descIdx = findColumnIndex(headerRow, DESCRIPTION_HEADERS);
    const amountIdx = findColumnIndex(headerRow, AMOUNT_HEADERS);

    if (dateIdx === -1 || amountIdx === -1) {
        throw new Error(
            `Nao foi possivel identificar as colunas de data/valor no arquivo. Colunas encontradas: ${headerRow.join(', ')}`
        );
    }

    return { dateIdx, descIdx, amountIdx };
}

export function parseAmount(raw) {
    if (typeof raw === 'number') return raw;

    let str = String(raw ?? '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
    const hasComma = str.includes(',');
    const hasDot = str.includes('.');

    if (hasComma && hasDot) {
        str = str.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
        str = str.replace(',', '.');
    }

    const value = parseFloat(str);
    return Number.isFinite(value) ? value : 0;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function normalizeDate(raw) {
    if (raw instanceof Date) return raw.toISOString().slice(0, 10);

    if (typeof raw === 'number') {
        return new Date(EXCEL_EPOCH_MS + raw * 86400000).toISOString().slice(0, 10);
    }

    const str = String(raw ?? '').trim();

    const brMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (brMatch) {
        const [, day, month, yearRaw] = brMatch;
        const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
        const [, year, month, day] = isoMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Faturas de cartao costumam marcar compras parceladas com um contador tipo
// "03/10" ou "PARC 3/10" dentro da propria descricao do lancamento. Extraimos
// esse contador aqui pra que o importador saiba gerar as parcelas restantes
// (ver services/statementImport/index.js e routes/transactions.js).
const INSTALLMENT_PATTERN = /(?<!\d)(?:parc(?:ela)?\.?\s*)?(\d{1,2})\s*[/x]\s*(\d{1,2})(?!\d)/i;

export function extractInstallmentInfo(description) {
    const text = String(description ?? '');
    const match = text.match(INSTALLMENT_PATTERN);
    if (!match) return null;

    const number = Number(match[1]);
    const total = Number(match[2]);
    // total < 2 descarta falsos positivos como "1/1"; number > total descarta
    // fracoes/proporcoes que nao fazem sentido como parcela.
    if (total < 2 || total > 60 || number < 1 || number > total) return null;

    const cleanDescription =
        (text.slice(0, match.index) + text.slice(match.index + match[0].length))
            .replace(/^[-–\s]+|[-–\s]+$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim() || text.trim();

    return { number, total, cleanDescription };
}

export function rowsToTransactions(headerRow, dataRows) {
    const { dateIdx, descIdx, amountIdx } = detectColumns(headerRow);

    return dataRows
        .filter((row) => row.length > 0 && row.some((cell) => cell !== '' && cell != null))
        .map((row) => {
            const rawDescription = descIdx !== -1 ? String(row[descIdx] ?? '').trim() : 'Transacao importada';
            const installment = extractInstallmentInfo(rawDescription);
            return {
                date: normalizeDate(row[dateIdx]),
                description: installment ? installment.cleanDescription : rawDescription,
                amount: parseAmount(row[amountIdx]),
                installmentNumber: installment?.number ?? null,
                installmentTotal: installment?.total ?? null,
            };
        })
        .filter((txn) => txn.date && Number.isFinite(txn.amount));
}
