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
export async function parseStatementFile(originalFilename, buffer, categoryNames = [], password) {
    const ext = `.${(originalFilename.split('.').pop() || '').toLowerCase()}`;

    if (ext === '.ofx') {
        return parseOfx(buffer.toString('utf8'));
    }
    if (ext === '.csv') {
        return parseCsv(buffer.toString('utf8')).map((txn) => ({ ...txn, fitid: syntheticFitid(txn, 'CSV') }));
    }
    if (ext === '.xlsx' || ext === '.xls') {
        return parseXlsx(buffer).map((txn) => ({ ...txn, fitid: syntheticFitid(txn, 'XLSX') }));
    }
    if (ext === '.pdf') {
        const txns = await parsePdf(buffer, categoryNames, password);
        return txns.map((txn) => ({ ...txn, fitid: syntheticFitid(txn, 'PDF') }));
    }

    throw new Error(`Formato de arquivo nao suportado: ${ext}. Use .ofx, .csv, .xlsx ou .pdf.`);
}
