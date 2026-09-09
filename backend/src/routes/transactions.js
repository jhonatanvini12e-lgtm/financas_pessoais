import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import db from '../db/index.js';
import { categorize, buildCategoryLearningMap } from '../services/categorizationEngine.js';
import { parseStatementFile, SUPPORTED_STATEMENT_EXTENSIONS } from '../services/statementImport/index.js';
import { addMonths } from '../services/statementImport/columnMapper.js';
import { checkBudgetAlerts } from '../services/budgetEngine.js';

const router = express.Router();

// Mimetypes aceitos por extensao. OFX/CSV/XLS nao tem um mimetype padronizado
// entre browsers/SO (frequentemente chegam como text/plain ou
// application/octet-stream), por isso a lista e' permissiva nesses casos --
// a extensao continua sendo o filtro principal, o mimetype so pega
// descompassos grosseiros (ex: enviar um .exe renomeado como .csv).
const ALLOWED_MIME_TYPES_BY_EXTENSION = {
    '.ofx': ['application/x-ofx', 'application/ofx', 'application/vnd.intu.qfx', 'text/plain', 'application/octet-stream'],
    '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'],
    '.xlsx': [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip',
        'application/octet-stream',
    ],
    '.xls': ['application/vnd.ms-excel', 'application/octet-stream'],
    '.pdf': ['application/pdf'],
};

function statementFileFilter(req, file, cb) {
    const ext = `.${(file.originalname.split('.').pop() || '').toLowerCase()}`;
    const allowedMimeTypes = ALLOWED_MIME_TYPES_BY_EXTENSION[ext];

    if (!allowedMimeTypes) {
        return cb(new Error(`Formato de arquivo nao suportado. Use ${SUPPORTED_STATEMENT_EXTENSIONS.join(', ')}.`));
    }
    if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new Error('Tipo do arquivo enviado nao corresponde a extensao informada.'));
    }
    cb(null, true);
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: statementFileFilter,
});

function uploadStatementFile(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}

router.get('/', (req, res) => {
    const { start, end, category_id, account_id, card_id } = req.query;
    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [req.user.id];

    if (start) { query += ' AND date >= ?'; params.push(start); }
    if (end) { query += ' AND date <= ?'; params.push(end); }
    if (category_id) { query += ' AND category_id = ?'; params.push(category_id); }
    if (account_id) { query += ' AND account_id = ?'; params.push(account_id); }
    if (card_id) { query += ' AND card_id = ?'; params.push(card_id); }
    query += ' ORDER BY date DESC LIMIT 500';

    res.json(db.prepare(query).all(...params));
});

router.get('/compare', (req, res) => {
    const months = Number(req.query.months) === 6 ? 6 : 3;
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    const sinceStr = since.toISOString().slice(0, 10);

    const monthly = db
        .prepare(
            `SELECT strftime('%Y-%m', date) as month,
                    SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) as income,
                    SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expense
             FROM transactions
             WHERE user_id = ? AND date >= ?
             GROUP BY month ORDER BY month`
        )
        .all(req.user.id, sinceStr);

    // LEFT JOIN (nao JOIN): lancamentos sem categoria (nenhuma keyword bateu)
    // precisam continuar aparecendo aqui como "Sem categoria" em vez de
    // sumirem silenciosamente do grafico so por nao pertencer a nenhuma
    // categoria cadastrada.
    const byCategory = db
        .prepare(
            `SELECT COALESCE(c.name, 'Sem categoria') as category, SUM(ABS(t.amount)) as total
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE t.user_id = ? AND t.date >= ? AND t.amount < 0
             GROUP BY category ORDER BY total DESC`
        )
        .all(req.user.id, sinceStr);

    res.json({ months, monthly, byCategory });
});

// Limites de plausibilidade da data de um lancamento manual -- pegam erro de
// digitacao grosseiro (ex: ano trocado) sem incomodar lancamentos legitimos
// de fatura antiga ou conta agendada com alguns meses de antecedencia.
const TRANSACTION_DATE_MAX_YEARS_PAST = 10;
const TRANSACTION_DATE_MAX_MONTHS_AHEAD = 12;

function isPlausibleTransactionDate(dateStr) {
    const parsed = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;

    const now = new Date();
    const minDate = new Date(now);
    minDate.setUTCFullYear(minDate.getUTCFullYear() - TRANSACTION_DATE_MAX_YEARS_PAST);
    const maxDate = new Date(now);
    maxDate.setUTCMonth(maxDate.getUTCMonth() + TRANSACTION_DATE_MAX_MONTHS_AHEAD);

    return parsed >= minDate && parsed <= maxDate;
}

router.post('/', (req, res) => {
    const { account_id, card_id, category_id, amount, date, description, installments } = req.body;
    if (amount == null || !date) return res.status(400).json({ error: 'amount e date sao obrigatorios' });

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount === 0) {
        return res.status(400).json({ error: 'amount deve ser um numero diferente de zero' });
    }
    if (!isPlausibleTransactionDate(date)) {
        return res.status(400).json({
            error: `date deve estar entre ${TRANSACTION_DATE_MAX_YEARS_PAST} anos no passado e ${TRANSACTION_DATE_MAX_MONTHS_AHEAD} meses no futuro`,
        });
    }

    const resolvedCategory = category_id ?? categorize(req.user.id, description);
    const totalInstallments = Math.min(Math.max(Number(installments) || 1, 1), 120);

    const insert = db.prepare(
        `INSERT INTO transactions (user_id, account_id, card_id, category_id, amount, date, description, status, source, installment_group, installment_number, installment_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'CLEARED', 'MANUAL', ?, ?, ?)`
    );

    const installmentGroup = totalInstallments > 1 ? crypto.randomUUID() : null;
    const createdIds = [];
    for (let i = 0; i < totalInstallments; i += 1) {
        const installmentDate = i === 0 ? date : addMonths(date, i);
        const installmentDescription =
            totalInstallments > 1 && description ? `${description} (${i + 1}/${totalInstallments})` : description || null;
        const info = insert.run(
            req.user.id,
            account_id || null,
            card_id || null,
            resolvedCategory || null,
            numericAmount,
            installmentDate,
            installmentDescription,
            installmentGroup,
            totalInstallments > 1 ? i + 1 : null,
            totalInstallments > 1 ? totalInstallments : null
        );
        createdIds.push(info.lastInsertRowid);
    }

    checkBudgetAlerts(req.user.id);
    const created = createdIds.map((id) => db.prepare('SELECT * FROM transactions WHERE id = ?').get(id));
    res.status(201).json(totalInstallments > 1 ? created : created[0]);
});

function recordTransactionHistory(userId, action, before, after) {
    db.prepare(
        `INSERT INTO transaction_history (transaction_id, user_id, action, before_data, after_data) VALUES (?, ?, ?, ?, ?)`
    ).run(before.id, userId, action, JSON.stringify(before), after ? JSON.stringify(after) : null);
}

router.put('/:id', (req, res) => {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!txn) return res.status(404).json({ error: 'Transacao nao encontrada' });

    const { account_id, card_id, category_id, amount, date, description, status } = req.body;
    db.prepare(
        `UPDATE transactions SET account_id = ?, card_id = ?, category_id = ?, amount = ?, date = ?, description = ?, status = ?
         WHERE id = ?`
    ).run(
        account_id !== undefined ? account_id : txn.account_id,
        card_id !== undefined ? card_id : txn.card_id,
        category_id !== undefined ? category_id : txn.category_id,
        amount ?? txn.amount,
        date ?? txn.date,
        description !== undefined ? description : txn.description,
        status ?? txn.status,
        txn.id
    );
    const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txn.id);
    recordTransactionHistory(req.user.id, 'UPDATE', txn, updated);
    res.json(updated);
});

router.delete('/:id', (req, res) => {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!txn) return res.status(404).json({ error: 'Transacao nao encontrada' });

    db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    recordTransactionHistory(req.user.id, 'DELETE', txn, null);
    res.json({ ok: true });
});

// Plano de contingencia / exportacao de fatura: importacao manual de
// extrato (.ofx, .csv, .xlsx ou .pdf), ja que nao ha sync automatico com
// banco. PDF e interpretado por IA (ver services/statementImport/pdfParser.js),
// os demais formatos por parsers proprios.
//
// Importacao em duas etapas: /import-statement/preview extrai os lancamentos
// do arquivo e devolve pro usuario revisar/editar no front (data, descricao,
// valor, categoria) sem gravar nada; /import-statement/commit recebe essa
// lista (ja editada) e grava de fato. Isso evita que um erro da IA (PDF) ou
// do parser vá direto pro banco sem o usuario conferir.
router.post('/import-statement/preview', uploadStatementFile, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Arquivo e obrigatorio' });
    const { password } = req.body;

    const categories = db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(req.user.id);

    let parsed;
    let warnings;
    try {
        // Passa os nomes das categorias do usuario para que, no caso de PDF, a
        // mesma IA que le a fatura ja sugira uma categoria por lancamento com
        // base na descricao (ex: "LONDRISUL TRANSPORTE C" -> "Transporte").
        // `password` so e usado no caminho do PDF, para faturas protegidas.
        ({ transactions: parsed, warnings } = await parseStatementFile(
            req.file.originalname,
            req.file.buffer,
            categories.map((c) => c.name),
            password
        ));
    } catch (err) {
        // PDF_PASSWORD_REQUIRED/PDF_PASSWORD_INCORRECT (ver pdfParser.js) usam
        // 422 em vez de 400 para o front distinguir "precisa de senha" de um
        // erro comum de importacao e mostrar o popup de senha em vez do banner
        // de erro generico.
        const status = err.code === 'PDF_PASSWORD_REQUIRED' || err.code === 'PDF_PASSWORD_INCORRECT' ? 422 : 400;
        return res.status(status).json({ error: err.message, code: err.code });
    }

    const categoryIdByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));

    // Construido uma vez para o lote inteiro: aprende com o historico ja
    // categorizado do usuario em vez de re-escanear a tabela a cada linha.
    const learningMap = buildCategoryLearningMap(req.user.id);

    const preview = parsed.map((txn) => {
        // Prioridade: (1) historico ja categorizado pelo usuario, (2) keywords
        // cadastradas manualmente, (3) sugestao da IA que leu o PDF a partir
        // da descricao -- fallback usado sobretudo quando a descricao crua do
        // extrato nao bate com nenhuma keyword. So' uma sugestao inicial: o
        // usuario ainda pode trocar a categoria na tela de revisao.
        let categoryId = categorize(req.user.id, txn.description, learningMap);
        if (categoryId == null && txn.categoryNameSuggestion) {
            categoryId = categoryIdByName.get(txn.categoryNameSuggestion.trim().toLowerCase()) ?? null;
        }

        const duplicate = Boolean(
            txn.fitid &&
                db.prepare('SELECT id FROM transactions WHERE user_id = ? AND external_fitid = ?').get(req.user.id, txn.fitid)
        );

        return {
            fitid: txn.fitid || null,
            date: txn.date,
            description: txn.description,
            amount: txn.amount,
            category_id: categoryId,
            installment_number: txn.installmentNumber,
            installment_total: txn.installmentTotal,
            duplicate,
        };
    });

    res.json({ filename: req.file.originalname, transactions: preview, warnings });
});

router.post('/import-statement/commit', (req, res) => {
    const { account_id, card_id, filename, transactions } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({ error: 'Nenhum lancamento para importar' });
    }

    const insertTxn = db.prepare(
        `INSERT INTO transactions (user_id, account_id, card_id, category_id, amount, date, description, status, external_fitid, source, installment_group, installment_number, installment_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'CLEARED', ?, 'STATEMENT_IMPORT', ?, ?, ?)`
    );

    let imported = 0;
    let skipped = 0;
    let generatedInstallments = 0;
    for (const txn of transactions) {
        const amount = Number(txn.amount);
        const description = String(txn.description ?? '').trim();
        if (!txn.date || !Number.isFinite(amount) || amount === 0 || !description) { skipped += 1; continue; }

        // Revalida duplicidade na hora de gravar (o preview so' checou no
        // momento em que o arquivo foi lido -- outra importacao pode ter
        // inserido o mesmo lancamento nesse intervalo).
        if (txn.fitid) {
            const exists = db
                .prepare('SELECT id FROM transactions WHERE user_id = ? AND external_fitid = ?')
                .get(req.user.id, txn.fitid);
            if (exists) { skipped += 1; continue; }
        }

        // Lancamento parcelado (ex: "3/10" na fatura): a linha do extrato so
        // mostra a parcela atual, entao geramos aqui as parcelas restantes
        // com a data projetada mes a mes (mesma logica de POST /transactions).
        const isInstallment = Number(txn.installment_total) > 1 && Number(txn.installment_number) >= 1;
        const startNumber = isInstallment ? Number(txn.installment_number) : 1;
        const totalInstallments = isInstallment ? Number(txn.installment_total) : 1;
        const installmentGroup = isInstallment ? crypto.randomUUID() : null;
        const categoryId = txn.category_id || null;

        for (let num = startNumber; num <= totalInstallments; num += 1) {
            const installmentDate = num === startNumber ? txn.date : addMonths(txn.date, num - startNumber);
            const installmentDescription = isInstallment ? `${description} (${num}/${totalInstallments})` : description;
            insertTxn.run(
                req.user.id,
                account_id || null,
                card_id || null,
                categoryId,
                amount,
                installmentDate,
                installmentDescription,
                num === startNumber ? txn.fitid || null : null,
                installmentGroup,
                isInstallment ? num : null,
                isInstallment ? totalInstallments : null
            );
            if (num === startNumber) imported += 1;
            else generatedInstallments += 1;
        }
    }

    db.prepare(
        'INSERT INTO ofx_imports (user_id, account_id, card_id, filename, imported_count, skipped_count) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, account_id || null, card_id || null, filename || 'importacao', imported + generatedInstallments, skipped);

    checkBudgetAlerts(req.user.id);
    res.json({ imported, skipped, generatedInstallments, total: transactions.length });
});

// Aplica o aprendizado por historico (ver categorizationEngine.js) aos
// lancamentos que ficaram sem categoria (ex: importados antes do usuario
// categorizar manualmente a primeira ocorrencia de um estabelecimento).
// Nao mexe em quem ja tem categoria -- so preenche o que estava em branco.
router.post('/recategorize', (req, res) => {
    const uncategorized = db
        .prepare(
            `SELECT id, description FROM transactions
             WHERE user_id = ? AND category_id IS NULL AND description IS NOT NULL`
        )
        .all(req.user.id);

    const learningMap = buildCategoryLearningMap(req.user.id);
    const update = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');

    let updated = 0;
    for (const txn of uncategorized) {
        const categoryId = categorize(req.user.id, txn.description, learningMap);
        if (categoryId != null) {
            update.run(categoryId, txn.id);
            updated += 1;
        }
    }

    checkBudgetAlerts(req.user.id);
    res.json({ updated, remaining: uncategorized.length - updated });
});

export default router;
