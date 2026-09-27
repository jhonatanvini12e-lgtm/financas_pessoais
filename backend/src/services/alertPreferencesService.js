import db from '../db/index.js';

const DEFAULTS = {
    cat_spending_enabled: 0,
    cat_spending_threshold: 500,
    monthly_ceiling_enabled: 0,
    monthly_ceiling_amount: 5000,
    large_purchase_enabled: 0,
    large_purchase_amount: 200,
    card_due_enabled: 1,
    card_due_days: 2,
    card_invoice_limit_enabled: 0,
    card_invoice_limit_amount: 1000,
    low_balance_enabled: 0,
    low_balance_amount: 500,
    relevant_tx_enabled: 0,
    relevant_tx_amount: 100,
    daily_summary_enabled: 0,
    weekly_summary_enabled: 0,
    weekly_summary_day: 1,
    monthly_summary_enabled: 0,
    monthly_summary_day: 1,
    period_comparison_enabled: 0,
};

export function getPreferences(userId) {
    const row = db.prepare('SELECT * FROM alert_preferences WHERE user_id = ?').get(userId);
    if (!row) return { user_id: userId, ...DEFAULTS };
    const { id, updated_at, ...prefs } = row;
    return prefs;
}

export function upsertPreferences(userId, data) {
    const allowed = Object.keys(DEFAULTS);
    const updates = {};
    for (const key of allowed) {
        if (data[key] !== undefined) updates[key] = data[key];
    }

    const existing = db.prepare('SELECT id FROM alert_preferences WHERE user_id = ?').get(userId);
    if (!existing) {
        const cols = ['user_id', ...Object.keys(updates)].join(', ');
        const placeholders = ['?', ...Object.keys(updates).map(() => '?')].join(', ');
        db.prepare(`INSERT INTO alert_preferences (${cols}, updated_at) VALUES (${placeholders}, CURRENT_TIMESTAMP)`)
            .run(userId, ...Object.values(updates));
    } else {
        if (Object.keys(updates).length === 0) return;
        const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
        db.prepare(`UPDATE alert_preferences SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`)
            .run(...Object.values(updates), userId);
    }

    return getPreferences(userId);
}
