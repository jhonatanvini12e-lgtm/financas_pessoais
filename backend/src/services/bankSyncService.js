import db from '../db/index.js';
import { activeBankProvider } from './bankProviders/index.js';
import { categorize, buildCategoryLearningMap } from './categorizationEngine.js';
import { raiseAlert } from './notificationEngine.js';
import { sendSyncFailureAlert } from './emailService.js';

export async function syncBankConnection(userId, provider) {
    const connection = db
        .prepare('SELECT * FROM bank_connections WHERE user_id = ? AND provider = ?')
        .get(userId, provider);

    if (!connection) {
        throw new Error(`Conexao com ${provider} nao encontrada para este usuario`);
    }

    try {
        const result = await activeBankProvider.sync(provider);

        const insertTxn = db.prepare(
            `INSERT INTO transactions (user_id, category_id, amount, date, description, status, external_fitid, source)
             VALUES (?, ?, ?, ?, ?, 'CLEARED', ?, 'OPEN_FINANCE')
             ON CONFLICT DO NOTHING`
        );

        const learningMap = buildCategoryLearningMap(userId);
        let importedCount = 0;
        for (const txn of result.transactions) {
            const exists = db
                .prepare('SELECT id FROM transactions WHERE user_id = ? AND external_fitid = ?')
                .get(userId, txn.fitid);
            if (exists) continue;

            const categoryId = categorize(userId, txn.description, learningMap);
            insertTxn.run(userId, categoryId, txn.amount, txn.date, txn.description, txn.fitid);
            importedCount += 1;
        }

        db.prepare(
            `UPDATE bank_connections SET status = 'CONNECTED', last_sync_at = CURRENT_TIMESTAMP, last_error = NULL
             WHERE id = ?`
        ).run(connection.id);

        db.prepare('INSERT INTO sync_logs (connection_id, status, message) VALUES (?, ?, ?)').run(
            connection.id,
            'SUCCESS',
            `${importedCount} transacoes importadas`
        );

        return { status: 'SUCCESS', importedCount, balance: result.balance };
    } catch (error) {
        db.prepare(
            `UPDATE bank_connections SET status = 'ERROR', last_error = ? WHERE id = ?`
        ).run(error.message, connection.id);

        db.prepare('INSERT INTO sync_logs (connection_id, status, message) VALUES (?, ?, ?)').run(
            connection.id,
            'ERROR',
            error.message
        );

        raiseAlert({
            userId,
            type: 'SYNC_FAIL',
            severity: 'CRITICAL',
            message: `Falha ao sincronizar ${provider}: ${error.message}`,
            emailFn: () => sendSyncFailureAlert(provider, error.message),
        });

        return { status: 'ERROR', error: error.message };
    }
}

export function listConnections(userId) {
    return db.prepare('SELECT * FROM bank_connections WHERE user_id = ?').all(userId);
}
