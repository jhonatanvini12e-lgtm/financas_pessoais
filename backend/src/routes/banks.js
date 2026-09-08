import express from 'express';
import { listConnections, syncBankConnection } from '../services/bankSyncService.js';
import { SUPPORTED_PROVIDERS } from '../services/bankProviders/index.js';

const router = express.Router();

router.get('/connections', (req, res) => {
    res.json(listConnections(req.user.id));
});

router.post('/connections/:provider/sync', async (req, res) => {
    const { provider } = req.params;
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        return res.status(400).json({ error: `Provider desconhecido. Suportados: ${SUPPORTED_PROVIDERS.join(', ')}` });
    }
    const result = await syncBankConnection(req.user.id, provider);
    res.json(result);
});

export default router;
