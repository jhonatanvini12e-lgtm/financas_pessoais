import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { initDB } from './db/index.js';
import { authMiddleware } from './middleware/auth.js';
import { loginRateLimiter, twoFactorRateLimiter, reauthRateLimiter } from './middleware/rateLimiter.js';
import { csrfProtection } from './middleware/csrf.js';
import { startCronJobs } from './cron/index.js';

import authRoutes from './routes/auth.js';
import accountsRoutes from './routes/accounts.js';
import cardsRoutes from './routes/cards.js';
import transactionsRoutes from './routes/transactions.js';
import categoriesRoutes from './routes/categories.js';
import budgetRoutes from './routes/budget.js';
import envelopesRoutes from './routes/envelopes.js';
import debtsRoutes from './routes/debts.js';
import billsRoutes from './routes/bills.js';
import investmentsRoutes from './routes/investments.js';
import alertsRoutes from './routes/alerts.js';
import backupsRoutes from './routes/backups.js';
import dashboardRoutes from './routes/dashboard.js';

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(csrfProtection);

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Servidor financeiro online e banco de dados montado!' });
});

app.use('/api/auth/login', loginRateLimiter);
app.use('/api/auth/verify-2fa', twoFactorRateLimiter);
app.use('/api/auth/request-reauth', reauthRateLimiter);
app.use('/api/auth', authRoutes);

app.use('/api/accounts', authMiddleware, accountsRoutes);
app.use('/api/cards', authMiddleware, cardsRoutes);
app.use('/api/transactions', authMiddleware, transactionsRoutes);
app.use('/api/categories', authMiddleware, categoriesRoutes);
app.use('/api/budget', authMiddleware, budgetRoutes);
app.use('/api/envelopes', authMiddleware, envelopesRoutes);
app.use('/api/debts', authMiddleware, debtsRoutes);
app.use('/api/bills', authMiddleware, billsRoutes);
app.use('/api/investments', authMiddleware, investmentsRoutes);
app.use('/api/alerts', authMiddleware, alertsRoutes);
app.use('/api/backups', authMiddleware, backupsRoutes);
app.use('/api/dashboard', authMiddleware, dashboardRoutes);

async function start() {
    await initDB();
    startCronJobs();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}

start();
