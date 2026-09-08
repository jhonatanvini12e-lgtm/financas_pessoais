import { rowsToTransactions } from './columnMapper.js';

function detectDelimiter(sampleLine) {
    const commaCount = (sampleLine.match(/,/g) || []).length;
    const semicolonCount = (sampleLine.match(/;/g) || []).length;
    return semicolonCount > commaCount ? ';' : ',';
}

function parseCsvLine(line, delimiter) {
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (inQuotes) {
            if (char === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === delimiter) {
            cells.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current.trim());
    return cells;
}

export function parseCsv(fileContent) {
    const lines = fileContent.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (lines.length < 2) return [];

    const delimiter = detectDelimiter(lines[0]);
    const headerRow = parseCsvLine(lines[0], delimiter);
    const dataRows = lines.slice(1).map((line) => parseCsvLine(line, delimiter));

    return rowsToTransactions(headerRow, dataRows);
}
