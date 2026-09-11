import 'dotenv/config';
// Faz o Express 4 encaminhar rejeicoes de Promise de rotas `async` para o
// error handler (via `next(err)`) em vez de deixa-las sem tratamento -- sem
// isso, uma unica excecao dentro de um handler async (ex: input inesperado
// quebrando uma query) derruba o processo inteiro (Node >=15 encerra o
// processo em unhandledRejection). Precisa ser importado antes de qualquer
// `router.get/post/...` ser registrado.
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { initDB } from './db/index.js';
import { authMiddleware } from './middleware/auth.js';
import {
    loginRateLimiter,
    twoFactorRateLimiter,
    reauthRateLimiter,
    changePasswordRateLimiter,
    importStatementRateLimiter,
    backupsRateLimiter,
} from './middleware/rateLimiter.js';
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

// A stack sempre roda atras de um proxy reverso (nginx no docker-compose).
// Sem isso, req.ip e o IP do proxy para todo mundo, e o rate limiting por IP
// (login, 2FA, etc.) e o fingerprint de dispositivo (IP+UA) ficam inuteis --
// um unico "IP" compartilhado por todos os usuarios. `1` = confia em exatamente
// um hop (o proxy imediato), nunca usar `true` (confiaria em X-Forwarded-For
// vindo direto do cliente, falsificavel).
app.set('trust proxy', 1);

// Ordem importa: csrfProtection le o token do cookie (precisa de cookieParser
// antes) e compara com o header enviado pelo front a partir do body/cookie ja
// parseados (precisa de express.json/cookieParser antes). Reordenar isso
// quebra a validacao de CSRF silenciosamente.
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
app.use('/api/auth/send-email-code', twoFactorRateLimiter);
app.use('/api/auth/change-password', changePasswordRateLimiter);
app.use('/api/auth/webauthn/login-options', twoFactorRateLimiter);
app.use('/api/auth/webauthn/login-verify', twoFactorRateLimiter);
app.use('/api/auth', authRoutes);

app.use('/api/transactions/import-statement', authMiddleware, importStatementRateLimiter);
app.use('/api/backups/run', authMiddleware, backupsRateLimiter);

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

// Handler de erro global: precisa vir depois de todas as rotas. Sem ele, uma
// excecao/rejeicao propagada por `express-async-errors` cairia no handler
// default do Express, que em alguns casos vaza stack trace no corpo da
// resposta. Loga o erro completo no servidor e devolve so uma mensagem
// generica ao cliente.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('Erro nao tratado na requisicao:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection fora do ciclo de request:', err);
});

async function start() {
    await initDB();
    startCronJobs();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}

start();
