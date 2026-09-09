import cron from 'node-cron';
import db from '../db/index.js';
import { runBackup } from '../services/backupService.js';
import { runCardChecks } from '../services/cardService.js';
import { checkBudgetAlerts } from '../services/budgetEngine.js';
import { runBillChecks } from '../services/billsService.js';

function allUserIds() {
    return db.prepare('SELECT id FROM users').all().map((u) => u.id);
}

export function startCronJobs() {
    const backupCronExpr = process.env.BACKUP_CRON || '0 3 * * *';

    // Backup diario as 03:00 (configuravel via BACKUP_CRON).
    cron.schedule(backupCronExpr, () => {
        runBackup().catch((err) => console.error('Erro no backup agendado:', err.message));
    });

    // Verificacao diaria de faturas a vencer e uso global de credito, as 08:00.
    cron.schedule('0 8 * * *', () => {
        for (const userId of allUserIds()) {
            try {
                runCardChecks(userId);
            } catch (err) {
                console.error(`Erro ao checar cartoes do usuario ${userId}:`, err.message);
            }
        }
    });

    // Verificacao diaria de orcamento, as 08:05.
    cron.schedule('5 8 * * *', () => {
        for (const userId of allUserIds()) {
            try {
                checkBudgetAlerts(userId);
            } catch (err) {
                console.error(`Erro ao checar orcamento do usuario ${userId}:`, err.message);
            }
        }
    });

    // Verificacao diaria de contas a pagar, as 08:10.
    cron.schedule('10 8 * * *', () => {
        for (const userId of allUserIds()) {
            try {
                runBillChecks(userId);
            } catch (err) {
                console.error(`Erro ao checar contas do usuario ${userId}:`, err.message);
            }
        }
    });

    console.log('Jobs agendados: backup diario, checagem de cartoes/orcamento/contas.');
}
