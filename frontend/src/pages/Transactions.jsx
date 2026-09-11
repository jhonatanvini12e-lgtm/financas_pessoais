import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { formatCurrency } from '../utils/currency.js';
import { PROVIDER_LABELS } from '../constants/providers.js';

// A API ja devolve os lancamentos ordenados por data DESC (ver GET
// /transactions), entao agrupar por mes so precisa observar quando o "YYYY-MM"
// muda entre um lancamento e o proximo, sem precisar reordenar nada aqui.
function monthLabel(dateStr) {
    const [year, month] = dateStr.split('-');
    const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('pt-BR', {
        month: 'long',
        year: 'numeric',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
}

// Contas ja tem um "bank_name" livre (ver Accounts.jsx), mas cartoes nao --
// so tem "provider" (selecionado manualmente no cadastro do cartao) e
// "card_name" (apelido livre que o usuario escolhe, nem sempre o nome do
// banco). Por isso, pra cartao, preferimos o provider traduzido e so caimos
// pro card_name quando o provider e "outro"/desconhecido.
function bankNameForTxn(t, accountsById, cardsById) {
    if (t.account_id) return accountsById.get(t.account_id)?.bank_name || '-';
    if (t.card_id) {
        const card = cardsById.get(t.card_id);
        if (!card) return '-';
        return PROVIDER_LABELS[card.provider] || card.card_name || '-';
    }
    return '-';
}

export default function Transactions() {
    const [transactions, setTransactions] = useState([]);
    const [categories, setCategories] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [cards, setCards] = useState([]);
    const [error, setError] = useState('');
    const [filters, setFilters] = useState({ start: '', end: '', category_id: '' });
    const [bankFilter, setBankFilter] = useState('');
    const [search, setSearch] = useState('');
    const [form, setForm] = useState({ description: '', amount: '', date: '', category_id: '', destination_type: 'none', destination_id: '', parcelado: false, installments: 2 });
    const [editingTxn, setEditingTxn] = useState(null);
    const [editForm, setEditForm] = useState({ description: '', amount: '', date: '', category_id: '', destination_type: 'none', destination_id: '' });
    const [editError, setEditError] = useState('');
    const [recategorizing, setRecategorizing] = useState(false);
    const [recategorizeMsg, setRecategorizeMsg] = useState('');
    const { hideValues } = usePrivacy();

    const load = ({ silent = false } = {}) => {
        const params = new URLSearchParams();
        if (filters.start) params.set('start', filters.start);
        if (filters.end) params.set('end', filters.end);
        if (filters.category_id) params.set('category_id', filters.category_id);
        api.get(`/transactions?${params}`).then(setTransactions).catch((err) => {
            if (!silent) setError(err.message);
        });
    };

    useEffect(() => {
        api.get('/categories').then(setCategories).catch(() => {});
        api.get('/accounts').then(setAccounts).catch(() => {});
        api.get('/cards').then(setCards).catch(() => {});
    }, []);

    const destinationOptions = (type) => (type === 'account' ? accounts : type === 'card' ? cards : []);

    useEffect(load, [filters]);
    usePolling(() => load({ silent: true }), [filters]);

    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    const cardsById = new Map(cards.map((c) => [c.id, c]));

    const bankOptions = Array.from(
        new Set([
            ...accounts.map((a) => a.bank_name).filter(Boolean),
            ...cards.map((c) => PROVIDER_LABELS[c.provider] || c.card_name).filter(Boolean),
        ])
    ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

    // Banco e busca por texto sao aplicados no cliente: "banco" e um conceito
    // derivado (vem de conta ou cartao, sem uma coluna propria em
    // transactions), e a lista ja inteira em memoria (max 500 linhas, ver GET
    // /transactions) entao nao ha necessidade de ida ao servidor pra isso.
    const visibleTransactions = transactions.filter((t) => {
        if (bankFilter && bankNameForTxn(t, accountsById, cardsById) !== bankFilter) return false;
        if (search.trim() && !t.description?.toLowerCase().includes(search.trim().toLowerCase())) return false;
        return true;
    });

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
                    <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}>
                        <option value="">Todos os bancos</option>
                        {bankOptions.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <input type="text" placeholder="Buscar por descricao..." value={search} onChange={(e) => setSearch(e.target.value)} />
                    <button type="button" className="btn-link" disabled={recategorizing} onClick={recategorize}>
                        {recategorizing ? 'Recategorizando...' : 'Recategorizar sem categoria a partir do historico'}
                    </button>
                </div>
                {recategorizeMsg && <p className="muted">{recategorizeMsg}</p>}

                <div className="table-scroll">
                <table className="data-table">
                    <thead>
                        <tr><th>Data</th><th>Descricao</th><th>Categoria</th><th>Banco</th><th>Valor</th><th /></tr>
                    </thead>
                    <tbody>
                        {(() => {
                            let lastMonth = null;
                            return visibleTransactions.map((t) => {
                                const monthKey = t.date.slice(0, 7);
                                const isNewMonth = monthKey !== lastMonth;
                                lastMonth = monthKey;
                                return (
                                    <Fragment key={t.id}>
                                        {isNewMonth && (
                                            <tr className="month-divider-row">
                                                <td colSpan={6}>{monthLabel(t.date)}</td>
                                            </tr>
                                        )}
                                        <tr>
                                            <td>{t.date}</td>
                                            <td>{t.description}</td>
                                            <td>{categoryName(t.category_id)}</td>
                                            <td>{bankNameForTxn(t, accountsById, cardsById)}</td>
                                            <td className={t.amount < 0 ? 'text-negative' : 'text-positive'}>{formatCurrency(t.amount, hideValues)}</td>
                                            <td className="row-actions">
                                                <button className="btn-icon" title="Editar lancamento" aria-label="Editar lancamento" onClick={() => openEdit(t)}>
                                                    ✎
                                                </button>
                                                <button className="btn-link" onClick={() => remove(t.id)}>remover</button>
                                            </td>
                                        </tr>
                                    </Fragment>
                                );
                            });
                        })()}
                    </tbody>
                </table>
                </div>
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
