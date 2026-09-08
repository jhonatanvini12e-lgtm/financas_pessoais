import express from 'express';
import { listAlerts, markAlertRead, deleteAlert } from '../services/notificationEngine.js';

const router = express.Router();

router.get('/', (req, res) => {
    const onlyUnread = req.query.unread === 'true';
    res.json(listAlerts(req.user.id, { onlyUnread }));
});

router.patch('/:id/read', (req, res) => {
    markAlertRead(req.user.id, req.params.id);
    res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
    const deleted = deleteAlert(req.user.id, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Alerta nao encontrado' });
    res.json({ ok: true });
});

export default router;
