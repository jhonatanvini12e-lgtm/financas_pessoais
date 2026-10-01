import express from 'express';
import multer from 'multer';
import db from '../db/index.js';
import { parseNfeXml } from '../services/fiscalNotes/xmlParser.js';
import { validateAccessKey } from '../services/fiscalNotes/accessKey.js';

const router = express.Router();

// Upload de XML de nota: arquivos pequenos (uma NF-e tem alguns KB), mantidos
// em memoria porque so' lemos e gravamos no banco -- nunca tocam o disco.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const name = (file.originalname || '').toLowerCase();
        if (name.endsWith('.xml') || file.mimetype?.includes('xml')) return cb(null, true);
        cb(new Error('Envie o XML da nota fiscal (.xml).'));
    },
});

function uploadXml(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}

// Projecao enviada ao front -- xml_raw fica de fora de proposito (pesado e
// desnecessario para a listagem).
const LIST_COLUMNS =
    'id, access_key, model, number, series, issuer_name, issuer_cnpj, recipient_name, recipient_cpf, issue_date, total_amount, source, created_at';

router.get('/', (req, res) => {
    const notes = db
        .prepare(`SELECT ${LIST_COLUMNS} FROM fiscal_notes WHERE user_id = ? ORDER BY issue_date DESC, created_at DESC`)
        .all(req.user.householdId);
    res.json(notes);
});

router.post('/upload', uploadXml, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Arquivo XML e obrigatorio' });

    let parsed;
    try {
        parsed = parseNfeXml(req.file.buffer.toString('utf8'));
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    if (parsed.accessKey && db.prepare('SELECT 1 FROM fiscal_notes WHERE access_key = ?').get(parsed.accessKey)) {
        return res.status(409).json({ error: 'Esta nota ja foi importada (mesma chave de acesso).' });
    }

    const info = db
        .prepare(
            `INSERT INTO fiscal_notes
                (user_id, access_key, model, number, series, issuer_name, issuer_cnpj,
                 recipient_name, recipient_cpf, issue_date, total_amount, xml_raw, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'xml')`
        )
        .run(
            req.user.householdId,
            parsed.accessKey,
            parsed.model,
            parsed.number,
            parsed.series,
            parsed.issuerName,
            parsed.issuerCnpj,
            parsed.recipientName,
            parsed.recipientCpf || parsed.recipientCnpj,
            parsed.issueDate,
            parsed.totalAmount,
            req.file.buffer.toString('utf8')
        );

    res.status(201).json(db.prepare(`SELECT ${LIST_COLUMNS} FROM fiscal_notes WHERE id = ?`).get(info.lastInsertRowid));
});

// Cadastro so' pela chave de acesso (44 digitos), quando a pessoa ainda nao
// tem o XML. Guardamos a chave validada e o modelo deduzido dela; os demais
// campos ficam em NULL ate alguem anexar o XML correspondente.
router.post('/by-key', (req, res) => {
    const check = validateAccessKey(req.body?.access_key);
    if (!check.valid) return res.status(400).json({ error: check.error });

    if (db.prepare('SELECT 1 FROM fiscal_notes WHERE access_key = ?').get(check.key)) {
        return res.status(409).json({ error: 'Esta nota ja esta cadastrada (mesma chave de acesso).' });
    }

    const info = db
        .prepare(`INSERT INTO fiscal_notes (user_id, access_key, model, source) VALUES (?, ?, ?, 'key')`)
        .run(req.user.householdId, check.key, check.model);

    res.status(201).json(db.prepare(`SELECT ${LIST_COLUMNS} FROM fiscal_notes WHERE id = ?`).get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
    const result = db.prepare('DELETE FROM fiscal_notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.householdId);
    if (result.changes === 0) return res.status(404).json({ error: 'Nota nao encontrada' });
    res.json({ ok: true });
});

export default router;
