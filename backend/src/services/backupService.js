import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';

const BACKUP_DIR = process.env.BACKUP_DIR || './backups';
const DB_PATH = process.env.DB_PATH || 'finance.db';

fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function snapshotDatabaseFile(tmpPath) {
    // Usa a API de backup do SQLite quando disponivel para uma copia consistente
    // mesmo com o banco em uso; cai para copia direta do arquivo se indisponivel.
    if (typeof db.backup === 'function') {
        await db.backup(tmpPath);
    } else {
        fs.copyFileSync(DB_PATH, tmpPath);
    }
}

function pruneOldBackups() {
    const files = fs
        .readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith('.gz'))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    const stale = files.slice(budgetParams.backupRetentionCount);
    for (const file of stale) {
        fs.unlinkSync(path.join(BACKUP_DIR, file.name));
    }
}

export async function runBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tmpPath = path.join(BACKUP_DIR, `finance-${timestamp}.db`);
    const gzPath = `${tmpPath}.gz`;

    await snapshotDatabaseFile(tmpPath);

    const input = fs.createReadStream(tmpPath);
    const output = fs.createWriteStream(gzPath);
    await new Promise((resolve, reject) => {
        input.pipe(zlib.createGzip()).pipe(output).on('finish', resolve).on('error', reject);
    });
    fs.unlinkSync(tmpPath);

    pruneOldBackups();

    const size = fs.statSync(gzPath).size;
    db.prepare('INSERT INTO backups (filename, size_bytes) VALUES (?, ?)').run(path.basename(gzPath), size);

    console.log(`Backup criado: ${gzPath} (${size} bytes)`);
    return { filename: path.basename(gzPath), size };
}

export function listBackups() {
    return db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 10').all();
}
