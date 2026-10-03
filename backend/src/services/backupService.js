import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import db from '../db/index.js';
import budgetParams from '../config/budgetParams.js';

const BACKUP_DIR = process.env.BACKUP_DIR || './backups';

fs.mkdirSync(BACKUP_DIR, { recursive: true });

async function snapshotDatabaseFile(tmpPath) {
    // `db.backup()` usa a API nativa de backup pagina-a-pagina do SQLite, que
    // falha com "incompatible source and target databases" neste banco
    // cifrado (SQLCipher/multiple-ciphers): o arquivo de destino comeca sem a
    // mesma config de cifra do source, e os tamanhos de pagina (reserved
    // bytes do HMAC) nao batem. `VACUUM INTO` roda no nivel SQL, pela conexao
    // ja autenticada com a chave, entao o arquivo gerado sai cifrado com a
    // mesma chave/config e pode ser reaberto normalmente.
    fs.rmSync(tmpPath, { force: true });
    db.prepare('VACUUM INTO ?').run(tmpPath);
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
