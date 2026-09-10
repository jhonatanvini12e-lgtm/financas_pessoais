import bcrypt from 'bcryptjs';
import db from './index.js';

const DEFAULT_CATEGORIES = [
    { name: 'Salario', type: 'INCOME', keywords: 'salario,pagamento,provento', budget_limit: 0 },
    { name: 'Moradia', type: 'EXPENSE', keywords: 'aluguel,condominio,iptu,luz,energia,agua,internet', budget_limit: 1500 },
    { name: 'Alimentacao', type: 'EXPENSE', keywords: 'ifood,restaurante,mercado,supermercado,padaria,lanchonete', budget_limit: 900 },
    { name: 'Transporte', type: 'EXPENSE', keywords: 'uber,99,posto,combustivel,gasolina,estacionamento', budget_limit: 400 },
    { name: 'Saude', type: 'EXPENSE', keywords: 'farmacia,drogaria,hospital,clinica,plano de saude', budget_limit: 400 },
    { name: 'Lazer', type: 'EXPENSE', keywords: 'netflix,spotify,cinema,ingresso,streaming,bar', budget_limit: 300 },
    { name: 'Educacao', type: 'EXPENSE', keywords: 'curso,faculdade,mensalidade,livro', budget_limit: 300 },
    { name: 'Assinaturas', type: 'EXPENSE', keywords: 'assinatura,mensalidade app,plano', budget_limit: 150 },
    { name: 'Gastos Imprevistos', type: 'EXPENSE', keywords: '', budget_limit: 0 },
];

async function ensureUser(username, email, plainPassword) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return existing.id;

    const hash = await bcrypt.hash(plainPassword, 10);
    const info = db
        .prepare('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)')
        .run(username, hash, email);
    console.log(`Usuario criado: ${username} / senha temporaria: ${plainPassword}`);
    return info.lastInsertRowid;
}

function ensureCategoriesForUser(userId) {
    const count = db.prepare('SELECT count(*) as count FROM categories WHERE user_id = ?').get(userId).count;
    if (count > 0) return;

    const insert = db.prepare(
        'INSERT INTO categories (user_id, name, type, keywords, budget_limit) VALUES (?, ?, ?, ?, ?)'
    );
    for (const cat of DEFAULT_CATEGORIES) {
        insert.run(userId, cat.name, cat.type, cat.keywords, cat.budget_limit);
    }
}

function ensureEnvelopesForUser(userId) {
    const count = db.prepare('SELECT count(*) as count FROM envelopes WHERE user_id = ?').get(userId).count;
    if (count > 0) return;

    const insert = db.prepare(
        'INSERT INTO envelopes (user_id, name, type, target_amount, current_amount) VALUES (?, ?, ?, 0, 0)'
    );
    insert.run(userId, 'Fundo de Emergencia', 'EMERGENCY_FUND');
    insert.run(userId, 'Gastos Imprevistos', 'UNEXPECTED_EXPENSES');
}

export const seedDatabase = async () => {
    const user1Id = await ensureUser(
        process.env.SEED_USER1_USERNAME || 'usuario1',
        process.env.SEED_USER1_EMAIL || 'usuario1@example.com',
        process.env.SEED_USER1_PASSWORD || 'troque_esta_senha'
    );
    const user2Id = await ensureUser(
        process.env.SEED_USER2_USERNAME || 'usuario2',
        process.env.SEED_USER2_EMAIL || 'usuario2@example.com',
        process.env.SEED_USER2_PASSWORD || 'troque_esta_senha'
    );

    for (const userId of [user1Id, user2Id]) {
        // Conta vinculada a outra (household_id) usa os dados de quem ela
        // aponta -- nao faz sentido criar categorias/envelopes padrao pra ela.
        const { household_id: householdId } = db.prepare('SELECT household_id FROM users WHERE id = ?').get(userId);
        if (householdId) continue;

        ensureCategoriesForUser(userId);
        ensureEnvelopesForUser(userId);
    }
};
