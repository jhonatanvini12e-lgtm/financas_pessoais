import express from 'express';
import db from '../db/index.js';
import { isPluggyConfigured } from '../services/pluggyClient.js';
import { listRemoteCreditCards, suggestSyncFrom, syncCardLink } from '../services/pluggySyncService.js';

const router = express.Router();

// Janela maxima de historico que a Pluggy guarda (e que faz sentido pedir
// como inicio da sync).
const MAX_HISTORY_MONTHS = 12;

function isHouseholdMember(userId, householdId) {
    if (userId == null) return false;
    return Boolean(
        db.prepare('SELECT 1 FROM users WHERE id = ? AND (id = ? OR household_id = ?)').get(userId, householdId, householdId)
    );
}

function defaultSyncFrom() {
    const d = new Date();
    d.setMonth(d.getMonth() - MAX_HISTORY_MONTHS);
    return d.toISOString().slice(0, 10);
}

function linkWithCard(link) {
    const card = db.prepare('SELECT id, card_name FROM credit_cards WHERE id = ?').get(link.card_id);
    return { ...link, card_name: card?.card_name ?? null, last_sync_summary: parseSummary(link) };
}

function parseSummary(link) {
    if (link.last_sync_status !== 'OK' || !link.last_sync_message) return null;
    try {
        return JSON.parse(link.last_sync_message);
    } catch {
        return null;
    }
}

// Erros da Pluggy (credencial invalida, fora do ar) viram 502 com a mensagem
// original -- o front mostra para o usuario saber o que corrigir.
async function withPluggyErrors(res, fn) {
    try {
        return await fn();
    } catch (err) {
        console.error('Erro na integracao Pluggy:', err.message);
        return res.status(502).json({ error: err.message });
    }
}

router.get('/accounts', async (req, res) => {
    if (!isPluggyConfigured()) return res.json({ configured: false, accounts: [], cards: [] });

    return withPluggyErrors(res, async () => {
        const accounts = await listRemoteCreditCards(req.user.householdId);
        const cards = db
            .prepare('SELECT id, card_name FROM credit_cards WHERE user_id = ? ORDER BY id')
            .all(req.user.householdId)
            .map((c) => ({ ...c, suggested_sync_from: suggestSyncFrom(req.user.householdId, c.id) }));

        res.json({
            configured: true,
            default_sync_from: defaultSyncFrom(),
            accounts: accounts.map((a) => ({ ...a, link: a.link ? linkWithCard(a.link) : null })),
            cards,
        });
    });
});

// Vincula uma conta de cartao da Pluggy a um cartao existente (card_id) ou
// cria um novo (new_card) e ja roda a primeira sync.
router.post('/links', async (req, res) => {
    if (!isPluggyConfigured()) return res.status(400).json({ error: 'Integracao Pluggy nao configurada no servidor' });

    const { pluggy_account_id, card_id, new_card, created_by, sync_from } = req.body;
    if (!pluggy_account_id) return res.status(400).json({ error: 'pluggy_account_id e obrigatorio' });
    if (!isHouseholdMember(created_by, req.user.householdId)) {
        return res.status(400).json({ error: 'Selecione qual usuario e o titular do cartao' });
    }
    const syncFrom = sync_from || defaultSyncFrom();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(syncFrom) || Number.isNaN(Date.parse(syncFrom))) {
        return res.status(400).json({ error: 'sync_from deve estar no formato AAAA-MM-DD' });
    }
    if (db.prepare('SELECT 1 FROM pluggy_card_links WHERE pluggy_account_id = ?').get(pluggy_account_id)) {
        return res.status(409).json({ error: 'Esta conta da Pluggy ja esta vinculada a um cartao' });
    }

    return withPluggyErrors(res, async () => {
        // Confere que a conta existe e pertence a um dos itens configurados
        // antes de gravar qualquer coisa.
        const remote = (await listRemoteCreditCards(req.user.householdId)).find((a) => a.id === pluggy_account_id);
        if (!remote) return res.status(404).json({ error: 'Conta de cartao nao encontrada na Pluggy' });

        let cardId = card_id;
        if (cardId != null) {
            if (!db.prepare('SELECT 1 FROM credit_cards WHERE id = ? AND user_id = ?').get(cardId, req.user.householdId)) {
                return res.status(400).json({ error: 'Cartao invalido' });
            }
            if (db.prepare('SELECT 1 FROM pluggy_card_links WHERE card_id = ?').get(cardId)) {
                return res.status(409).json({ error: 'Este cartao ja esta vinculado a outra conta da Pluggy' });
            }
        } else {
            const { card_name, credit_limit, closing_day, due_day, provider } = new_card || {};
            const closingDay = Number(closing_day);
            const dueDay = Number(due_day);
            if (!card_name || !(closingDay >= 1 && closingDay <= 31) || !(dueDay >= 1 && dueDay <= 31)) {
                return res.status(400).json({ error: 'Informe nome, dia de fechamento e dia de vencimento do novo cartao' });
            }
            const info = db
                .prepare('INSERT INTO credit_cards (user_id, card_name, credit_limit, closing_day, due_day, provider) VALUES (?, ?, ?, ?, ?, ?)')
                .run(req.user.householdId, card_name, Number(credit_limit) || remote.creditLimit || 0, closingDay, dueDay, provider || null);
            cardId = info.lastInsertRowid;
        }

        const info = db
            .prepare('INSERT INTO pluggy_card_links (user_id, card_id, pluggy_account_id, created_by, sync_from) VALUES (?, ?, ?, ?, ?)')
            .run(req.user.householdId, cardId, pluggy_account_id, created_by, syncFrom);

        let syncError = null;
        try {
            await syncCardLink(info.lastInsertRowid);
        } catch (err) {
            syncError = err.message;
        }
        const link = db.prepare('SELECT * FROM pluggy_card_links WHERE id = ?').get(info.lastInsertRowid);
        res.status(201).json({ link: linkWithCard(link), syncError });
    });
});

router.post('/links/:id/sync', async (req, res) => {
    const link = db.prepare('SELECT * FROM pluggy_card_links WHERE id = ? AND user_id = ?').get(req.params.id, req.user.householdId);
    if (!link) return res.status(404).json({ error: 'Vinculo nao encontrado' });

    return withPluggyErrors(res, async () => {
        const result = await syncCardLink(link.id);
        if (result.skipped) return res.status(409).json({ error: 'Sincronizacao deste cartao ja esta em andamento' });
        res.json({ link: linkWithCard(db.prepare('SELECT * FROM pluggy_card_links WHERE id = ?').get(link.id)), result });
    });
});

// Desvincular nao apaga nada: os lancamentos ja sincronizados continuam no
// cartao, so param de ser atualizados.
router.delete('/links/:id', (req, res) => {
    const result = db.prepare('DELETE FROM pluggy_card_links WHERE id = ? AND user_id = ?').run(req.params.id, req.user.householdId);
    if (result.changes === 0) return res.status(404).json({ error: 'Vinculo nao encontrado' });
    res.json({ ok: true });
});

export default router;
