import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function Transactions() {
    const [transactions, setTransactions] = useState([]);
    const [categories, setCategories] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [cards, setCards] = useState([]);
    const [error, setError] = useState('');
    const [filters, setFilters] = useState({ start: '', end: '', category_id: '' });
    const [form, setForm] = useState({ description: '', amount: '', date: '', category_id: '', destination_type: 'none', destination_id: '', parcelado: false, installments: 2 });
    const [editingTxn, setEditingTxn] = useState(null);
    const [editForm, setEditForm] = useState({ description: '', amount: '', date: '', category_id: '', destination_type: 'none', destination_id: '' });
    const [editError, setEditError] = useState('');
    const [recategorizing, setRecategorizing] = useState(false);
    const [recategorizeMsg, setRecategorizeMsg] = useState('');

    const load = () => {
        const params = new URLSearchParams();
        if (filters.start) params.set('start', filters.start);
        if (filters.end) params.set('end', filters.end);
        if (filters.category_id) params.set('category_id', filters.category_id);
        api.get(`/transactions?${params}`).then(setTransactions).catch((err) => setError(err.message));
    };

    useEffect(() => {
        api.get('/categories').then(setCategories).catch(() => {});
        api.get('/accounts').then(setAccounts).catch(() => {});
        api.get('/cards').then(setCards).catch(() => {});
    }, []);

    const destinationOptions = (type) => (type === 'account' ? accounts : type === 'card' ? cards : []);

    useEffect(load, [filters]);

    const addTransaction = async (e) => {
        e.preventDefault();
        try {
            await api.post('/transactions', {
                description: form.description,
                date: form.date,
                amount: Number(form.amount),
                category_id: form.category_id || null,
                account_id: form.destination_type === 'account' ? form.destination_id || null : null,
                card_id: form.destination_type === 'card' ? form.destination_id || null : null,
                installments: form.parcelado ? Number(form.installments) : 1,
            });
            setForm({ description: '', amount: '', date: '', category_id: '', destination_type: 'none', destination_id: '', parcelado: false, installments: 2 });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const remove = async (id) => {
        await api.delete(`/transactions/${id}`);
        load();
    };

    const categoryName = (id) => categories.find((c) => c.id === id)?.name || '-';

    const openEdit = (t) => {
        setEditingTxn(t);
        setEditForm({
            description: t.description || '',
            amount: t.amount,
            date: t.date?.slice(0, 10) || '',
            category_id: t.category_id || '',
            destination_type: t.account_id ? 'account' : t.card_id ? 'card' : 'none',
            destination_id: t.account_id || t.card_id || '',
        });
        setEditError('');
    };

    const closeEdit = () => {
        setEditingTxn(null);
        setEditError('');
    };

    const recategorize = async () => {
        setRecategorizing(true);
        setRecategorizeMsg('');
        try {
            const data = await api.post('/transactions/recategorize', {});
            setRecategorizeMsg(
                data.updated > 0
                    ? `${data.updated} lancamento(s) categorizado(s) a partir do historico. ${data.remaining} continuam sem categoria conhecida.`
                    : 'Nenhum lancamento sem categoria bateu com o historico ou com as palavras-chave cadastradas.'
            );
            load();
        } catch (err) {
            setRecategorizeMsg(err.message);
        } finally {
            setRecategorizing(false);
        }
    };

    const saveEdit = async (e) => {
        e.preventDefault();
        try {
            await api.put(`/transactions/${editingTxn.id}`, {
                description: editForm.description,
                date: editForm.date,
                amount: Number(editForm.amount),
                category_id: editForm.category_id || null,
                account_id: editForm.destination_type === 'account' ? editForm.destination_id || null : null,
                card_id: editForm.destination_type === 'card' ? editForm.destination_id || null : null,
            });
            closeEdit();
            load();
        } catch (err) {
            setEditError(err.message);
        }
    };

    return (
        <div className="page">
            <h1>Lancamentos</h1>
            {error && <div className="error-msg">{error}</div>}

            <section className="card">
                <h2>Novo lancamento manual</h2>
                <form onSubmit={addTransaction} className="inline-form">
                    <input placeholder="Descricao" value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })} required />
                    <input placeholder="Valor (negativo = despesa)" type="number" step="0.01" value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
                    <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
                    <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                        <option value="">Auto-categorizar</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select value={form.destination_type}
                        onChange={(e) => setForm({ ...form, destination_type: e.target.value, destination_id: '' })}>
                        <option value="none">Sem conta/cartao</option>
                        <option value="account">Conta bancaria</option>
                        <option value="card">Cartao de credito</option>
                    </select>
                    {form.destination_type !== 'none' && (
                        <select value={form.destination_id} onChange={(e) => setForm({ ...form, destination_id: e.target.value })}>
                            <option value="">Selecione...</option>
                            {destinationOptions(form.destination_type).map((opt) => (
                                <option key={opt.id} value={opt.id}>{opt.bank_name || opt.card_name}</option>
                            ))}
                        </select>
                    )}
                    <label className="checkbox-label">
                        <input type="checkbox" checked={form.parcelado}
                            onChange={(e) => setForm({ ...form, parcelado: e.target.checked })} />
                        Parcelado
                    </label>
                    {form.parcelado && (
                        <input type="number" min="2" max="120" placeholder="Numero de parcelas"
                            value={form.installments}
                            onChange={(e) => setForm({ ...form, installments: e.target.value })} required />
                    )}
                    <button type="submit" className="btn-primary">Adicionar</button>
                </form>
                {form.parcelado && (
                    <p className="muted">
                        Sera lancado o mesmo valor todo mes, na mesma data, ate completar {form.installments || 0} parcelas.
                    </p>
                )}
            </section>

            <section className="card">
                <div className="inline-form">
                    <input type="date" value={filters.start} onChange={(e) => setFilters({ ...filters, start: e.target.value })} />
                    <input type="date" value={filters.end} onChange={(e) => setFilters({ ...filters, end: e.target.value })} />
                    <select value={filters.category_id} onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}>
                        <option value="">Todas categorias</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="button" className="btn-link" disabled={recategorizing} onClick={recategorize}>
                        {recategorizing ? 'Recategorizando...' : 'Recategorizar sem categoria a partir do historico'}
                    </button>
                </div>
                {recategorizeMsg && <p className="muted">{recategorizeMsg}</p>}

                <table className="data-table">
                    <thead>
                        <tr><th>Data</th><th>Descricao</th><th>Categoria</th><th>Valor</th><th /></tr>
                    </thead>
                    <tbody>
                        {transactions.map((t) => (
                            <tr key={t.id}>
                                <td>{t.date}</td>
                                <td>{t.description}</td>
                                <td>{categoryName(t.category_id)}</td>
                                <td className={t.amount < 0 ? 'text-negative' : 'text-positive'}>R$ {t.amount.toFixed(2)}</td>
                                <td className="row-actions">
                                    <button className="btn-icon" title="Editar lancamento" aria-label="Editar lancamento" onClick={() => openEdit(t)}>
                                        ✎
                                    </button>
                                    <button className="btn-link" onClick={() => remove(t.id)}>remover</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>

            {editingTxn && (
                <div className="modal-overlay">
                    <div className="glass-panel edit-txn-panel">
                        <h2>Editar lancamento</h2>
                        <form onSubmit={saveEdit} className="input-group">
                            <input placeholder="Descricao" value={editForm.description}
                                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} required />
                            <input placeholder="Valor (negativo = despesa)" type="number" step="0.01" value={editForm.amount}
                                onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} required />
                            <input type="date" value={editForm.date}
                                onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} required />
                            <select value={editForm.category_id}
                                onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}>
                                <option value="">Sem categoria</option>
                                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <select value={editForm.destination_type}
                                onChange={(e) => setEditForm({ ...editForm, destination_type: e.target.value, destination_id: '' })}>
                                <option value="none">Sem conta/cartao</option>
                                <option value="account">Conta bancaria</option>
                                <option value="card">Cartao de credito</option>
                            </select>
                            {editForm.destination_type !== 'none' && (
                                <select value={editForm.destination_id}
                                    onChange={(e) => setEditForm({ ...editForm, destination_id: e.target.value })}>
                                    <option value="">Selecione...</option>
                                    {destinationOptions(editForm.destination_type).map((opt) => (
                                        <option key={opt.id} value={opt.id}>{opt.bank_name || opt.card_name}</option>
                                    ))}
                                </select>
                            )}

                            {editError && <div className="error-msg">{editError}</div>}

                            <div className="wizard-actions">
                                <button type="button" className="btn-link" onClick={closeEdit}>Cancelar</button>
                                <button type="submit" className="btn-primary">Salvar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
