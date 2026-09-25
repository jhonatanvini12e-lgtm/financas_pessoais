import cron from 'node-cron';
import db from '../db/index.js';
import { runBackup } from '../services/backupService.js';
import { runCardChecks } from '../services/cardService.js';
import { checkBudgetAlerts } from '../services/budgetEngine.js';
import { runBillChecks } from '../services/billsService.js';
import { syncAllLinks } from '../services/pluggySyncService.js';
import { isPluggyConfigured } from '../services/pluggyClient.js';

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

    // Sync dos cartoes vinculados a Pluggy a cada 6h. O Meu Pluggy atualiza
    // os dados com o banco ~1x por dia, em horario que nao controlamos --
    // rodar algumas vezes ao dia pega a atualizacao sem muito atraso, e
    // antes das checagens das 08:00 (07:45) para os alertas ja verem a
    // fatura atualizada. So' le dados ja guardados na Pluggy, nao consome a
    // cota de chamadas do Open Finance.
    if (isPluggyConfigured()) {
        cron.schedule('45 1,7,13,19 * * *', () => {
            syncAllLinks().catch((err) => console.error('Erro na sync Pluggy agendada:', err.message));
        });
    }

    console.log('Jobs agendados: backup diario, checagem de cartoes/orcamento/contas, sync Pluggy.');
}
