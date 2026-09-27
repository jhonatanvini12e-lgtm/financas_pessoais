import express from 'express';
import { listAlerts, markAlertRead, deleteAlert } from '../services/notificationEngine.js';
import { getPreferences, upsertPreferences } from '../services/alertPreferencesService.js';

const router = express.Router();

router.get('/', (req, res) => {
    const onlyUnread = req.query.unread === 'true';
    res.json(listAlerts(req.user.householdId, { onlyUnread }));
});

router.get('/preferences', (req, res) => {
    res.json(getPreferences(req.user.householdId));
});

router.put('/preferences', (req, res) => {
    const updated = upsertPreferences(req.user.householdId, req.body);
    res.json(updated);
});

router.patch('/:id/read', (req, res) => {
    markAlertRead(req.user.householdId, req.params.id);
    res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
    const deleted = deleteAlert(req.user.householdId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Alerta nao encontrado' });
    res.json({ ok: true });
});

export default router;
