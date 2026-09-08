import express from 'express';
import {
    getEnvelopes,
    getContributionSuggestions,
    depositToEnvelope,
    withdrawFromEnvelope,
} from '../services/envelopeService.js';
import db from '../db/index.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json(getEnvelopes(req.user.id));
});

router.get('/suggestion', (req, res) => {
    res.json(getContributionSuggestions(req.user.id));
});

router.post('/', (req, res) => {
    const { name, type, target_amount } = req.body;
    if (!name) return res.status(400).json({ error: 'name e obrigatorio' });

    const info = db
        .prepare('INSERT INTO envelopes (user_id, name, type, target_amount) VALUES (?, ?, ?, ?)')
        .run(req.user.id, name, type || 'CUSTOM', target_amount || 0);
    res.status(201).json(db.prepare('SELECT * FROM envelopes WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/:id/deposit', (req, res) => {
    try {
        const envelope = depositToEnvelope(req.user.id, req.params.id, Number(req.body.amount), req.body.note);
        res.json(envelope);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/:id/withdraw', (req, res) => {
    try {
        const envelope = withdrawFromEnvelope(req.user.id, req.params.id, Number(req.body.amount), req.body.note);
        res.json(envelope);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

export default router;
