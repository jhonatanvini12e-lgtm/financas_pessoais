import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import db from '../db/index.js';
import { categorize, buildCategoryLearningMap } from '../services/categorizationEngine.js';
import { parseStatementFile } from '../services/statementImport/index.js';
import { addMonths } from '../services/statementImport/columnMapper.js';
import { checkBudgetAlerts } from '../services/budgetEngine.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

router.post('/', (req, res) => {
    const { account_id, card_id, category_id, amount, date, description, installments } = req.body;
    if (amount == null || !date) return res.status(400).json({ error: 'amount e date sao obrigatorios' });

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
            amount,
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
    res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(txn.id));
});

router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Transacao nao encontrada' });
    res.json({ ok: true });
});

// Plano de contingencia / exportacao de fatura: importacao manual de
// extrato (.ofx, .csv, .xlsx ou .pdf), ja que nao ha sync automatico com
// banco. PDF e interpretado por IA (ver services/statementImport/pdfParser.js),
// os demais formatos por parsers proprios.
router.post('/import-statement', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Arquivo e obrigatorio' });
    const { account_id, card_id, password } = req.body;

    const categories = db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(req.user.id);

    let parsed;
    try {
        // Passa os nomes das categorias do usuario para que, no caso de PDF, a
        // mesma IA que le a fatura ja sugira uma categoria por lancamento com
        // base na descricao (ex: "LONDRISUL TRANSPORTE C" -> "Transporte").
        // `password` so e usado no caminho do PDF, para faturas protegidas.
        parsed = await parseStatementFile(req.file.originalname, req.file.buffer, categories.map((c) => c.name), password);
    } catch (err) {
        // PDF_PASSWORD_REQUIRED/PDF_PASSWORD_INCORRECT (ver pdfParser.js) usam
        // 422 em vez de 400 para o front distinguir "precisa de senha" de um
        // erro comum de importacao e mostrar o popup de senha em vez do banner
        // de erro generico.
        const status = err.code === 'PDF_PASSWORD_REQUIRED' || err.code === 'PDF_PASSWORD_INCORRECT' ? 422 : 400;
        return res.status(status).json({ error: err.message, code: err.code });
    }

    const categoryIdByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));

    const insertTxn = db.prepare(
        `INSERT INTO transactions (user_id, account_id, card_id, category_id, amount, date, description, status, external_fitid, source, installment_group, installment_number, installment_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'CLEARED', ?, 'STATEMENT_IMPORT', ?, ?, ?)`
    );

    // Construido uma vez para o lote inteiro: aprende com o historico ja
    // categorizado do usuario em vez de re-escanear a tabela a cada linha.
    const learningMap = buildCategoryLearningMap(req.user.id);

    let imported = 0;
    let skipped = 0;
    let generatedInstallments = 0;
    for (const txn of parsed) {
        if (txn.fitid) {
            const exists = db
                .prepare('SELECT id FROM transactions WHERE user_id = ? AND external_fitid = ?')
                .get(req.user.id, txn.fitid);
            if (exists) { skipped += 1; continue; }
        }

        // Lancamento parcelado (ex: "3/10" na fatura): a linha do extrato so
        // mostra a parcela atual, entao geramos aqui as parcelas restantes
        // com a data projetada mes a mes (mesma logica de POST /transactions).
        const isInstallment = Number(txn.installmentTotal) > 1 && Number(txn.installmentNumber) >= 1;
        const startNumber = isInstallment ? Number(txn.installmentNumber) : 1;
        const totalInstallments = isInstallment ? Number(txn.installmentTotal) : 1;
        const installmentGroup = isInstallment ? crypto.randomUUID() : null;

        // Prioridade: (1) historico ja categorizado pelo usuario, (2) keywords
        // cadastradas manualmente, (3) sugestao da IA que leu o PDF a partir
        // da descricao -- fallback usado sobretudo quando a descricao crua do
        // extrato nao bate com nenhuma keyword.
        let categoryId = categorize(req.user.id, txn.description, learningMap);
        if (categoryId == null && txn.categoryNameSuggestion) {
            categoryId = categoryIdByName.get(txn.categoryNameSuggestion.trim().toLowerCase()) ?? null;
        }

        for (let num = startNumber; num <= totalInstallments; num += 1) {
            const installmentDate = num === startNumber ? txn.date : addMonths(txn.date, num - startNumber);
            const installmentDescription = isInstallment ? `${txn.description} (${num}/${totalInstallments})` : txn.description;
            insertTxn.run(
                req.user.id,
                account_id || null,
                card_id || null,
                categoryId,
                txn.amount,
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
    ).run(req.user.id, account_id || null, card_id || null, req.file.originalname, imported + generatedInstallments, skipped);

    checkBudgetAlerts(req.user.id);
    res.json({ imported, skipped, generatedInstallments, total: parsed.length });
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
