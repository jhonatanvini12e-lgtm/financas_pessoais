import crypto from 'crypto';
import { parseOfx } from './ofxParser.js';
import { parseCsv } from './csvParser.js';
import { parseXlsx } from './xlsxParser.js';
import { parsePdf } from './pdfParser.js';

export const SUPPORTED_STATEMENT_EXTENSIONS = ['.ofx', '.csv', '.xlsx', '.xls', '.pdf'];

function syntheticFitid(txn, sourceTag) {
    const hash = crypto.createHash('sha1').update(`${txn.date}|${txn.description}|${txn.amount}`).digest('hex');
    return `${sourceTag}-${hash}`;
}

// OFX ja traz um identificador unico (FITID) por lancamento; CSV/XLSX nao tem
// isso, entao geramos um hash estavel de data+descricao+valor para permitir
// deduplicar reimportacoes do mesmo arquivo.
// `categoryNames` so e usado no caminho do PDF: e a lista de categorias do
// usuario que a IA usa para sugerir uma categoria por lancamento com base na
// descricao (ver statementImport/pdfParser.js).
// Retorno sempre no formato { transactions, warnings } -- so o caminho do PDF
// (interpretado por IA) pode gerar warnings hoje (ver pdfParser.js), mas os
// demais formatos devolvem o mesmo formato para o chamador nao precisar
// distinguir por extensao.
export async function parseStatementFile(originalFilename, buffer, categoryNames = [], password) {
    const ext = `.${(originalFilename.split('.').pop() || '').toLowerCase()}`;

    if (ext === '.ofx') {
        return { transactions: parseOfx(buffer.toString('utf8')), warnings: [] };
    }
    if (ext === '.csv') {
        const transactions = parseCsv(buffer.toString('utf8')).map((txn) => ({ ...txn, fitid: syntheticFitid(txn, 'CSV') }));
        return { transactions, warnings: [] };
    }
    if (ext === '.xlsx' || ext === '.xls') {
        const transactions = parseXlsx(buffer).map((txn) => ({ ...txn, fitid: syntheticFitid(txn, 'XLSX') }));
        return { transactions, warnings: [] };
    }
    if (ext === '.pdf') {
        const { transactions, warnings } = await parsePdf(buffer, categoryNames, password);
        return { transactions: transactions.map((txn) => ({ ...txn, fitid: syntheticFitid(txn, 'PDF') })), warnings };
    }

    throw new Error(`Formato de arquivo nao suportado: ${ext}. Use .ofx, .csv, .xlsx ou .pdf.`);
}
