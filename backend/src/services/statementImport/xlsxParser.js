import XLSX from 'xlsx';
import { rowsToTransactions } from './columnMapper.js';

// Planilhas .xlsx sao arquivos zip com o conteudo comprimido -- um arquivo
// pequeno e muito repetitivo (zip bomb) pode se descomprimir em memoria para
// centenas de MB de linhas, travando o event loop do processo Node inteiro
// (afeta todos os usuarios simultaneos, ja que o backend e single-process).
// Por isso checamos o tamanho da planilha pelo range declarado (sem custo de
// materializar as celulas) ANTES de chamar sheet_to_json, que e o passo caro.
const MAX_XLSX_ROWS = 20000;

export function parseXlsx(buffer) {
    // `sheetRows` faz o proprio SheetJS parar de processar linhas depois do
    // limite -- sem isso, o `XLSX.read` abaixo ja teria materializado todas as
    // celulas da planilha inteira em memoria ANTES de qualquer checagem
    // posterior ser possivel (a checagem de "!ref" sozinha, feita so depois
    // do read, chega tarde demais para evitar o custo da descompressao).
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, sheetRows: MAX_XLSX_ROWS + 1 });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    if (sheet && sheet['!ref']) {
        const range = XLSX.utils.decode_range(sheet['!ref']);
        const rowCount = range.e.r - range.s.r + 1;
        if (rowCount > MAX_XLSX_ROWS) {
            throw new Error('Planilha excede o limite de 20000 linhas suportado');
        }
    }

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

    if (rows.length < 2) return [];
    const [headerRow, ...dataRows] = rows;
    return rowsToTransactions(headerRow, dataRows);
}
