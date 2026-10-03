import cron from 'node-cron';
import db from '../db/index.js';
import { runBackup } from '../services/backupService.js';
import { runCardChecks } from '../services/cardService.js';
import { checkBudgetAlerts } from '../services/budgetEngine.js';
import { runBillChecks } from '../services/billsService.js';
import { syncAllLinks, syncAllAccountLinks, checkConnectionsHealth, SYNC_CRON_EXPRESSION } from '../services/pluggySyncService.js';
import { isPluggyConfigured } from '../services/pluggyClient.js';
import { getPreferences } from '../services/alertPreferencesService.js';
import {
    checkCategorySpendingWeekly,
    checkMonthlyCeiling,
    checkCardInvoiceLimits,
    checkLowBalance,
    sendDailySummary,
    sendWeeklySummary,
    sendMonthlySummary,
    checkPeriodComparison,
} from '../services/advancedAlertService.js';

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

    // Verificacoes avancadas diarias as 08:20
    cron.schedule('20 8 * * *', () => {
        for (const userId of allUserIds()) {
            try { checkMonthlyCeiling(userId); } catch (err) { console.error(`monthly_ceiling user ${userId}:`, err.message); }
            try { checkCardInvoiceLimits(userId); } catch (err) { console.error(`card_invoice_limit user ${userId}:`, err.message); }
            try { checkLowBalance(userId); } catch (err) { console.error(`low_balance user ${userId}:`, err.message); }
        }
    });

    // Gasto por categoria: semanal, toda segunda-feira as 08:30
    cron.schedule('30 8 * * 1', () => {
        for (const userId of allUserIds()) {
            try { checkCategorySpendingWeekly(userId); } catch (err) { console.error(`cat_spending user ${userId}:`, err.message); }
        }
    });

    // Resumo diario as 20:00 (para usuarios que o habilitaram)
    cron.schedule('0 20 * * *', () => {
        for (const userId of allUserIds()) {
            try { sendDailySummary(userId); } catch (err) { console.error(`daily_summary user ${userId}:`, err.message); }
        }
    });

    // Resumo semanal: verificado todo dia as 08:35, mas so dispara no dia configurado pelo usuario
    cron.schedule('35 8 * * *', () => {
        const todayDow = new Date().getDay(); // 0=dom...6=sab
        for (const userId of allUserIds()) {
            try {
                const prefs = getPreferences(userId);
                if (prefs.weekly_summary_enabled && prefs.weekly_summary_day === todayDow) {
                    sendWeeklySummary(userId);
                }
            } catch (err) { console.error(`weekly_summary user ${userId}:`, err.message); }
        }
    });

    // Resumo mensal e comparativo: verificado todo dia as 08:40, dispara no dia configurado
    cron.schedule('40 8 * * *', () => {
        const todayDay = new Date().getDate();
        for (const userId of allUserIds()) {
            try {
                const prefs = getPreferences(userId);
                if (prefs.monthly_summary_enabled && prefs.monthly_summary_day === todayDay) {
                    sendMonthlySummary(userId);
                }
                if (prefs.period_comparison_enabled && todayDay === 1) {
                    checkPeriodComparison(userId);
                }
            } catch (err) { console.error(`monthly_summary user ${userId}:`, err.message); }
        }
    });

    // Sync dos cartoes vinculados a Pluggy a cada 6h (horarios em
    // pluggySyncService.SYNC_SCHEDULE), uma delas antes das checagens das
    // 08:00 para os alertas ja verem a fatura atualizada. So' le dados ja
    // guardados na Pluggy, nao consome a cota de chamadas do Open Finance.
    // Depois confere a saude das conexoes (consentimento, Meu Pluggy sem
    // atualizar) e gera alertas.
    if (isPluggyConfigured()) {
        cron.schedule(SYNC_CRON_EXPRESSION, () => {
            Promise.all([syncAllLinks(), syncAllAccountLinks()])
                .then(() => checkConnectionsHealth())
                .catch((err) => console.error('Erro na sync Pluggy agendada:', err.message));
        });
    }

    console.log('Jobs agendados: backup diario, checagem de cartoes/orcamento/contas/avancados, resumos, sync Pluggy.');
}
