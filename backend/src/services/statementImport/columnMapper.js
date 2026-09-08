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

// Faturas de cartao costumam marcar compras parceladas com um contador dentro
// da propria descricao do lancamento, mas o formato varia por banco: a
// maioria usa "03/10" ou "PARC 3/10" -- e nesse formato a data da linha ja e a
// data real daquela parcela especifica. Ja o Inter usa por extenso "(Parcela
// 03 de 07)", mas repete em toda ocorrencia a data da COMPRA ORIGINAL (ou
// seja, a mesma data de quando a parcela 1 foi feita), nao a data em que
// aquela parcela especifica cai na fatura -- por isso marcamos esse formato
// como "verbose" para que o chamador saiba que precisa corrigir a data (ver
// resolveInstallmentDate abaixo).
const INSTALLMENT_PATTERNS = [
    { format: 'slash', regex: /(?<!\d)(?:parc(?:ela)?\.?\s*)?(\d{1,2})\s*[/x]\s*(\d{1,2})(?!\d)/i },
    // Exige o prefixo "parc(ela)" aqui porque "de" sozinho e uma palavra comum
    // demais em portugues pra usar como separador sem correr risco de falso
    // positivo (ex: "RUA 3 DE MAIO").
    { format: 'verbose', regex: /\bparc(?:ela)?\.?\s*(\d{1,2})\s*de\s*(\d{1,2})(?!\d)/i },
];

export function extractInstallmentInfo(description) {
    const text = String(description ?? '');
    let match = null;
    let format = null;
    for (const pattern of INSTALLMENT_PATTERNS) {
        match = text.match(pattern.regex);
        if (match) {
            format = pattern.format;
            break;
        }
    }
    if (!match) return null;

    const number = Number(match[1]);
    const total = Number(match[2]);
    // total < 2 descarta falsos positivos como "1/1"; number > total descarta
    // fracoes/proporcoes que nao fazem sentido como parcela.
    if (total < 2 || total > 60 || number < 1 || number > total) return null;

    const cleanDescription =
        (text.slice(0, match.index) + text.slice(match.index + match[0].length))
            // remove parenteses que sobram vazios, ex: "(Parcela 03 de 07)"
            // vira "()" depois de tirar o contador de dentro.
            .replace(/\(\s*\)/g, '')
            .replace(/^[-–\s]+|[-–\s]+$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim() || text.trim();

    return { number, total, cleanDescription, format };
}

export function addMonths(dateStr, months) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const totalMonths = (month - 1) + months;
    const targetYear = year + Math.floor(totalMonths / 12);
    const targetMonth = ((totalMonths % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const targetDay = Math.min(day, lastDayOfTargetMonth);
    return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

// So no formato "verbose" (ver comentario acima de INSTALLMENT_PATTERNS) a
// data da linha e a da compra original em vez da parcela atual -- desloca
// mes a mes para chegar na data real dessa parcela. Sem isso, tanto a parcela
// importada quanto as parcelas futuras geradas a partir dela (ver
// routes/transactions.js) ficam com a data errada.
export function resolveInstallmentDate(rawDate, installment) {
    if (!rawDate || !installment) return rawDate;
    if (installment.format === 'verbose' && installment.number > 1) {
        return addMonths(rawDate, installment.number - 1);
    }
    return rawDate;
}

export function rowsToTransactions(headerRow, dataRows) {
    const { dateIdx, descIdx, amountIdx } = detectColumns(headerRow);

    return dataRows
        .filter((row) => row.length > 0 && row.some((cell) => cell !== '' && cell != null))
        .map((row) => {
            const rawDescription = descIdx !== -1 ? String(row[descIdx] ?? '').trim() : 'Transacao importada';
            const installment = extractInstallmentInfo(rawDescription);
            return {
                date: resolveInstallmentDate(normalizeDate(row[dateIdx]), installment),
                description: installment ? installment.cleanDescription : rawDescription,
                amount: parseAmount(row[amountIdx]),
                installmentNumber: installment?.number ?? null,
                installmentTotal: installment?.total ?? null,
            };
        })
        .filter((txn) => txn.date && Number.isFinite(txn.amount));
}
