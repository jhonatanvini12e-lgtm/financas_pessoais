// Fila local (IndexedDB) de lancamentos criados no QuickAdd enquanto o
// dispositivo esta offline. Cada item guarda o payload exato que seria
// enviado para POST /transactions -- ao voltar o sinal, o proprio QuickAdd
// (ver syncQueue em pages/QuickAdd.jsx) reenvia cada um e remove da fila
// conforme confirma sucesso.
const DB_NAME = 'financas-quickadd';
const DB_VERSION = 1;
const STORE_NAME = 'pending-transactions';

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'localId', autoIncrement: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function withStore(mode, run) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        run(store);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function enqueueQuickAddTransaction(payload) {
    await withStore('readwrite', (store) => {
        store.add({ payload, createdAt: Date.now() });
    });
}

export async function listQueuedQuickAddTransactions() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function removeQueuedQuickAddTransaction(localId) {
    await withStore('readwrite', (store) => {
        store.delete(localId);
    });
}

// Limpa toda a fila local -- usado no logout para nao deixar lancamentos
// pendentes (valor, descricao, categoria) em texto puro no IndexedDB de um
// dispositivo compartilhado/perdido apos o usuario sair da conta.
export async function clearQuickAddQueue() {
    await withStore('readwrite', (store) => {
        store.clear();
    });
}
