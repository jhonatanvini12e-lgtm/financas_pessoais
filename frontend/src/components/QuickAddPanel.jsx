import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import ReauthModal from '../components/ReauthModal.jsx';
import {
    enqueueQuickAddTransaction,
    listQueuedQuickAddTransactions,
    removeQueuedQuickAddTransaction,
} from '../offline/quickAddQueue.js';

const today = () => new Date().toISOString().slice(0, 10);

// fetch falha com TypeError quando nao ha rede (nao quando o servidor
// responde com erro) -- assim distinguimos "sem conexao" (guarda na fila
// local) de um erro real de validacao/servidor (mostra pro usuario).
function isOfflineError(err) {
    return !navigator.onLine || err instanceof TypeError;
}

export default function QuickAdd() {
    const [categories, setCategories] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [cards, setCards] = useState([]);
    const [type, setType] = useState('expense');
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [date, setDate] = useState(today());
    const [categoryId, setCategoryId] = useState('');
    const [destinationType, setDestinationType] = useState('none');
    const [destinationId, setDestinationId] = useState('');
    const [parcelado, setParcelado] = useState(false);
    const [installments, setInstallments] = useState(2);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState('');
    const [saving, setSaving] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);

    useEffect(() => {
        api.get('/categories').then(setCategories).catch(() => {});
        api.get('/accounts').then(setAccounts).catch(() => {});
        api.get('/cards').then(setCards).catch(() => {});
    }, []);

    // Tenta reenviar a fila local (lancamentos feitos offline) sempre que a
    // pagina carrega e sempre que o browser avisa que a conexao voltou. Para
    // no primeiro item que falhar de novo -- se ainda estamos offline nao
    // faz sentido continuar tentando os demais.
    const syncQueue = useCallback(async () => {
        const queued = await listQueuedQuickAddTransactions().catch(() => []);
        let remaining = queued.length;
        for (const item of queued) {
            try {
                await api.post('/transactions', item.payload);
                await removeQueuedQuickAddTransaction(item.localId);
                remaining -= 1;
            } catch (err) {
                if (isOfflineError(err)) break;
                // Payload que o servidor rejeita (ex: validacao) nunca vai
                // conseguir ser reenviado sem edicao -- descarta da fila em
                // vez de tentar pra sempre.
                await removeQueuedQuickAddTransaction(item.localId).catch(() => {});
                remaining -= 1;
            }
        }
        setPendingCount(remaining);
    }, []);

    useEffect(() => {
        syncQueue();
        window.addEventListener('online', syncQueue);
        return () => window.removeEventListener('online', syncQueue);
    }, [syncQueue]);

    const destinationOptions = destinationType === 'account' ? accounts : destinationType === 'card' ? cards : [];

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setSaved('');
        const value = Number(amount);
        if (!value) {
            setError('Informe um valor');
            return;
        }
        const payload = {
            description: description || null,
            amount: type === 'expense' ? -Math.abs(value) : Math.abs(value),
            date,
            category_id: categoryId || null,
            account_id: destinationType === 'account' ? destinationId || null : null,
            card_id: destinationType === 'card' ? destinationId || null : null,
            installments: parcelado ? Number(installments) : 1,
        };
        setSaving(true);
        try {
            await api.post('/transactions', payload);
            setSaved('Lancamento salvo!');
        } catch (err) {
            if (!isOfflineError(err)) {
                setError(err.message);
                setSaving(false);
                return;
            }
            // Sem conexao: guarda na fila local em vez de perder o lancamento.
            // Sincroniza automaticamente quando o app detectar sinal de novo.
            await enqueueQuickAddTransaction(payload);
            setPendingCount((n) => n + 1);
            setSaved('Sem conexao -- lancamento salvo neste dispositivo e sera sincronizado automaticamente.');
        }
        setAmount('');
        setDescription('');
        setDestinationType('none');
        setDestinationId('');
        setParcelado(false);
        setInstallments(2);
        setSaving(false);
    };

    return (
        <div className="quickadd-screen">
            <div className="quickadd-panel">
                <div className="quickadd-header">
                    <h1>Lancamento rapido</h1>
                </div>

                {pendingCount > 0 && (
                    <p className="muted">
                        {pendingCount} lancamento{pendingCount > 1 ? 's' : ''} pendente{pendingCount > 1 ? 's' : ''} de sincronizacao (salvos offline neste dispositivo).
                    </p>
                )}

                <form onSubmit={submit} className="quickadd-form">
                    <div className="quickadd-type-toggle">
                        <button
                            type="button"
                            className={`quickadd-type-btn ${type === 'expense' ? 'active expense' : ''}`}
                            onClick={() => setType('expense')}
                        >
                            Despesa
                        </button>
                        <button
                            type="button"
                            className={`quickadd-type-btn ${type === 'income' ? 'active income' : ''}`}
                            onClick={() => setType('income')}
                        >
                            Receita
                        </button>
                    </div>

                    <input
                        className="quickadd-amount"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="0,00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        autoFocus
                        required
                    />

                    <input
                        className="quickadd-input"
                        placeholder="Descricao (opcional)"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                    />

                    <div className="quickadd-row">
                        <input
                            className="quickadd-input"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            required
                        />
                        <select
                            className="quickadd-input"
                            value={categoryId}
                            onChange={(e) => setCategoryId(e.target.value)}
                        >
                            <option value="">Auto-categorizar</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="quickadd-row">
                        <select
                            className="quickadd-input"
                            value={destinationType}
                            onChange={(e) => { setDestinationType(e.target.value); setDestinationId(''); }}
                        >
                            <option value="none">Sem conta/cartao</option>
                            <option value="account">Conta bancaria</option>
                            <option value="card">Cartao de credito</option>
                        </select>
                        {destinationType !== 'none' && (
                            <select
                                className="quickadd-input"
                                value={destinationId}
                                onChange={(e) => setDestinationId(e.target.value)}
                            >
                                <option value="">Selecione...</option>
                                {destinationOptions.map((opt) => (
                                    <option key={opt.id} value={opt.id}>{opt.bank_name || opt.card_name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div className="quickadd-row">
                        <label className="checkbox-label">
                            <input type="checkbox" checked={parcelado} onChange={(e) => setParcelado(e.target.checked)} />
                            Parcelado
                        </label>
                        {parcelado && (
                            <input
                                className="quickadd-input"
                                type="number"
                                min="2"
                                max="120"
                                placeholder="Numero de parcelas"
                                value={installments}
                                onChange={(e) => setInstallments(e.target.value)}
                                required
                            />
                        )}
                    </div>
                    {parcelado && (
                        <p className="muted">
                            Sera lancado o mesmo valor todo mes, na mesma data, ate completar {installments || 0} parcelas.
                        </p>
                    )}

                    {error && <div className="error-msg">{error}</div>}
                    {saved && <div className="quickadd-success">{saved}</div>}

                    <button type="submit" className="btn-primary quickadd-submit" disabled={saving}>
                        {saving ? 'Salvando...' : 'Salvar lancamento'}
                    </button>
                </form>
            </div>

            <ReauthModal />
        </div>
    );
}
