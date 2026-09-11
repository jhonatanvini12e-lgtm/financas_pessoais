import express from 'express';
import { runBackup, listBackups } from '../services/backupService.js';

const router = express.Router();

router.get('/', (req, res) => {
    res.json(listBackups());
});

router.post('/run', async (req, res) => {
    try {
        const result = await runBackup();
        res.json(result);
    } catch (err) {
        console.error('Erro ao gerar/listar backup:', err);
        res.status(500).json({ error: 'Falha ao processar backup' });
    }
});

export default router;
