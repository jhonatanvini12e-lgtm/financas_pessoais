import express from 'express';
import { getBudgetStatus, checkBudgetAlerts, getBudgetParams } from '../services/budgetEngine.js';

const router = express.Router();

router.get('/status', (req, res) => {
    res.json(getBudgetStatus(req.user.id));
});

router.post('/check', (req, res) => {
    res.json(checkBudgetAlerts(req.user.id));
});

router.get('/params', (req, res) => {
    res.json(getBudgetParams());
});

export default router;
