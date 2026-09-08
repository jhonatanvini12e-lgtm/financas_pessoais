import 'dotenv/config';
import Database from 'better-sqlite3-multiple-ciphers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.DB_PATH || 'finance.db';
const DB_PASSWORD = process.env.DB_PASSWORD || 'super_secret_key_123!';

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

const db = new Database(DB_PATH);

// Criptografia AES-256 local
db.pragma(`cipher='sqlcipher'`);
db.pragma(`legacy=4`);
db.pragma(`key='${DB_PASSWORD}'`);
db.pragma('foreign_keys = ON');

const migrateColumns = () => {
    const existing = new Set(db.prepare('PRAGMA table_info(transactions)').all().map((c) => c.name));
    const columns = {
        installment_group: 'TEXT',
        installment_number: 'INTEGER',
        installment_total: 'INTEGER',
    };
    for (const [name, type] of Object.entries(columns)) {
        if (!existing.has(name)) db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${type}`);
    }
};

export const initDB = async () => {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
    migrateColumns();
    console.log('Banco de dados criptografado sincronizado.');

    const { seedDatabase } = await import('./seed.js');
    await seedDatabase();
};

export default db;
