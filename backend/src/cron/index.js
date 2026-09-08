import cron from 'node-cron';
import db from '../db/index.js';
import { runBackup } from '../services/backupService.js';
import { runCardChecks } from '../services/cardService.js';
import { checkBudgetAlerts } from '../services/budgetEngine.js';
import { syncBankConnection } from '../services/bankSyncService.js';
import { SUPPORTED_PROVIDERS } from '../services/bankProviders/index.js';

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

    // Sincronizacao mock periodica com os bancos (a cada 6 horas).
    cron.schedule('0 */6 * * *', async () => {
        for (const userId of allUserIds()) {
            for (const provider of SUPPORTED_PROVIDERS) {
                try {
                    await syncBankConnection(userId, provider);
                } catch (err) {
                    console.error(`Erro ao sincronizar ${provider} do usuario ${userId}:`, err.message);
                }
            }
        }
    });

    console.log('Jobs agendados: backup diario, checagem de cartoes/orcamento, sync bancario mock.');
}
