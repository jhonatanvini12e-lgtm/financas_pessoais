// Substitui __BUILD_ID__ em dist/sw.js por um valor unico desta build, para
// que o navegador detecte o service worker como alterado a cada deploy
// (veja o comentario em public/sw.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const swPath = join(__dirname, '..', 'dist', 'sw.js');

const buildId = Date.now().toString(36);
const contents = readFileSync(swPath, 'utf8').replaceAll('__BUILD_ID__', buildId);
writeFileSync(swPath, contents);

console.log(`sw.js stampado com build id ${buildId}`);
