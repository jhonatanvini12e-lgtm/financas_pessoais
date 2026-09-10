import express from 'express';
import db from '../db/index.js';

const router = express.Router();

// `balance` e o saldo inicial informado na criacao da conta; o saldo atual
// soma os lancamentos (manuais ou import de extrato/fatura) feitos depois,
// entao calculamos aqui em vez de depender de algo escrever de volta em
// accounts.balance a cada lancamento.
router.get('/', (req, res) => {
    res.json(
        db
            .prepare(
                `SELECT a.id, a.user_id, a.bank_name, a.provider, a.created_at,
                        a.balance + COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.account_id = a.id), 0) as balance
                 FROM accounts a
                 WHERE a.user_id = ?
                 ORDER BY a.id`
            )
            .all(req.user.householdId)
    );
});

router.post('/', (req, res) => {
    const { bank_name, provider, balance } = req.body;
    if (!bank_name) return res.status(400).json({ error: 'bank_name e obrigatorio' });

    const info = db
        .prepare('INSERT INTO accounts (user_id, bank_name, provider, balance) VALUES (?, ?, ?, ?)')
        .run(req.user.householdId, bank_name, provider || null, balance || 0);
    res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
    const { bank_name, provider, balance } = req.body;
    const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.householdId);
    if (!account) return res.status(404).json({ error: 'Conta nao encontrada' });

    db.prepare('UPDATE accounts SET bank_name = ?, provider = ?, balance = ? WHERE id = ?').run(
        bank_name ?? account.bank_name,
        provider ?? account.provider,
        balance ?? account.balance,
        account.id
    );
    res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id));
});

router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.householdId);
    if (result.changes === 0) return res.status(404).json({ error: 'Conta nao encontrada' });
    res.json({ ok: true });
});

export default router;
