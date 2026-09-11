import 'dotenv/config';
import Database from 'better-sqlite3-multiple-ciphers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || 'finance.db';

// Valor de exemplo do .env.example: esta no historico git deste repositorio,
// entao um deploy que esqueca de troca-lo fica com a criptografia do banco
// inteiro (todos os dados financeiros) protegida por uma senha publica.
const KNOWN_PLACEHOLDER_DB_PASSWORDS = new Set(['troque_esta_senha_do_banco']);

if (!process.env.DB_PASSWORD) {
    console.error('Erro fatal: variavel de ambiente DB_PASSWORD nao definida. Defina-a antes de iniciar o servidor.');
    process.exit(1);
}
if (KNOWN_PLACEHOLDER_DB_PASSWORDS.has(process.env.DB_PASSWORD) || process.env.DB_PASSWORD.length < 16) {
    console.error(
        'Erro fatal: DB_PASSWORD esta com o valor de exemplo ou e curta demais (minimo 16 caracteres). ' +
        'Gere uma senha forte antes de subir em producao.'
    );
    process.exit(1);
}
if (process.env.DB_PASSWORD.includes("'")) {
    console.error("Erro fatal: DB_PASSWORD nao pode conter aspas simples (quebra o pragma 'key=...' do SQLCipher).");
    process.exit(1);
}
const DB_PASSWORD = process.env.DB_PASSWORD;

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = new Database(DB_PATH);

// Criptografia AES-256 local
db.pragma(`cipher='sqlcipher'`);
db.pragma(`legacy=4`);
db.pragma(`key='${DB_PASSWORD}'`);
db.pragma('foreign_keys = ON');

// bills.due_day nasceu NOT NULL (so existiam contas fixas). Contas avulsas
// usam due_date no lugar, entao due_day precisa aceitar NULL -- e SQLite nao
// permite relaxar um NOT NULL com ALTER TABLE, so reconstruindo a tabela.
const migrateBillsDueDayNullable = () => {
    const dueDayCol = db.prepare('PRAGMA table_info(bills)').all().find((c) => c.name === 'due_day');
    if (!dueDayCol || dueDayCol.notnull === 0) return;

    db.pragma('foreign_keys = OFF');
    db.exec(`
        CREATE TABLE bills_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            category_id INTEGER,
            expected_amount REAL DEFAULT 0,
            due_day INTEGER,
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(category_id) REFERENCES categories(id)
        );
        INSERT INTO bills_new (id, user_id, name, category_id, expected_amount, due_day, active, created_at)
            SELECT id, user_id, name, category_id, expected_amount, due_day, active, created_at FROM bills;
        DROP TABLE bills;
        ALTER TABLE bills_new RENAME TO bills;
    `);
    db.pragma('foreign_keys = ON');
};

// household_id liga o login de uma pessoa aos dados financeiros de outra
// (ex: casal que quer ver as mesmas contas/transacoes com senhas separadas).
// NULL significa "usa os proprios dados" -- e o padrao pra quem nao tem vinculo.
const migrateHouseholdId = () => {
    const existing = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
    if (!existing.has('household_id')) {
        db.exec('ALTER TABLE users ADD COLUMN household_id INTEGER REFERENCES users(id)');
    }
};

const migrateColumns = () => {
    migrateHouseholdId();

    const existing = new Set(db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name));
    const columns = {
        installment_group: 'TEXT',
        installment_number: 'INTEGER',
        installment_total: 'INTEGER',
    };
    for (const [name, type] of Object.entries(columns)) {
        if (!existing.has(name)) db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${type}`);
    }

    migrateBillsDueDayNullable();

    // recurring=1 (default) mantem o comportamento original: conta fixa que
    // repete todo mes no dia due_day. recurring=0 usa due_date (data unica).
    // card_id marca uma linha gerada automaticamente pela importacao de fatura.
    const existingBillColumns = new Set(db.prepare('PRAGMA table_info(bills)').all().map((c) => c.name));
    const billColumns = { recurring: 'INTEGER DEFAULT 1', due_date: 'TEXT', card_id: 'INTEGER' };
    for (const [name, type] of Object.entries(billColumns)) {
        if (!existingBillColumns.has(name)) db.exec(`ALTER TABLE bills ADD COLUMN ${name} ${type}`);
    }
};

// Recurso de Open Finance removido (pessoa fisica nao consegue se
// credenciar como participante junto ao Banco Central para usa-lo de
// verdade -- era so uma simulacao). "CREATE TABLE IF NOT EXISTS" no
// schema.sql nao apaga tabelas ja existentes num banco antigo, entao
// derrubamos aqui as tabelas orfas que o recurso deixou pra tras.
const dropLegacyTables = () => {
    db.exec('DROP TABLE IF EXISTS sync_logs');
    db.exec('DROP TABLE IF EXISTS bank_connections');
};

export const initDB = async () => {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    migrateColumns();
    dropLegacyTables();
    console.log('Banco de dados criptografado sincronizado.');

    const { seedDatabase } = await import('./seed.js');
    await seedDatabase();
};

export default db;
