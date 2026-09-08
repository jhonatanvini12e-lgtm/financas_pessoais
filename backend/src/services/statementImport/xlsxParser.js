import XLSX from 'xlsx';
import { rowsToTransactions } from './columnMapper.js';

export function parseXlsx(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

    if (rows.length < 2) return [];
    const [headerRow, ...dataRows] = rows;
    return rowsToTransactions(headerRow, dataRows);
}
