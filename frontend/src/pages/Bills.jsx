import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';

const STATUS_LABEL = { PAID: 'Paga', PENDING: 'Pendente', LATE: 'Atrasada' };
const STATUS_CLASS = { PAID: 'status-paid', PENDING: 'status-pending', LATE: 'status-late' };
const TYPE_LABEL = { BILL_FIXED: 'Fixa', BILL_ONE_TIME: 'Avulsa', CARD_INVOICE: 'Fatura' };

function typeKeyFor(item) {
    if (item.kind === 'CARD_INVOICE' || item.cardId) return 'CARD_INVOICE';
    return item.recurring ? 'BILL_FIXED' : 'BILL_ONE_TIME';
}

const EMPTY_FORM = { name: '', category_id: '', expected_amount: '', due_day: '', due_date: '', recurring: true };

export default function Bills() {
    const [data, setData] = useState(null);
    const [categories, setCategories] = useState([]);
    const [error, setError] = useState('');
    const [form, setForm] = useState(EMPTY_FORM);

    const load = ({ silent = false } = {}) => {
        api.get('/bills').then(setData).catch((err) => {
            if (!silent) setError(err.message);
        });
        api.get('/categories').then((cats) => setCategories(cats.filter((c) => c.type === 'EXPENSE'))).catch(() => {});
    };
    useEffect(load, []);
    usePolling(() => load({ silent: true }), []);

    const addBill = async (e) => {
        e.preventDefault();
        try {
            await api.post('/bills', {
                name: form.name,
                category_id: form.category_id ? Number(form.category_id) : null,
                expected_amount: Number(form.expected_amount) || 0,
                recurring: form.recurring,
                due_day: form.recurring ? Number(form.due_day) : null,
                due_date: form.recurring ? null : form.due_date,
            });
            setForm(EMPTY_FORM);
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const removeBill = async (id) => {
        try {
            await api.delete(`/bills/${id}`);
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const togglePaid = async (item) => {
        try {
            const base = item.kind === 'CARD_INVOICE' ? `/bills/card-invoices/${item.id}` : `/bills/${item.id}`;
            await api.post(`${base}/${item.paid ? 'unpay' : 'pay'}`, { period: item.period });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    if (!data) return <div className="page"><h1>Contas a Pagar</h1>{error && <div className="error-msg">{error}</div>}</div>;

    return (
        <div className="page">
            <h1>Contas a Pagar</h1>
            {error && <div className="error-msg">{error}</div>}

            <div className="stat-grid">
                <div className="card"><h3>Pendente este mes</h3><p>R$ {data.totalPending.toFixed(2)}</p></div>
                <div className="card"><h3>Atrasado</h3><p>R$ {data.totalLate.toFixed(2)}</p></div>
                <div className="card"><h3>Contas atrasadas</h3><p>{data.lateCount}</p></div>
            </div>

            <section className="card">
                <h2>Nova conta</h2>
                <form onSubmit={addBill} className="inline-form">
                    <input placeholder="Nome (ex: Aluguel)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                    <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                        <option value="">Sem categoria</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <input placeholder="Valor esperado" type="number" step="0.01" value={form.expected_amount} onChange={(e) => setForm({ ...form, expected_amount: e.target.value })} />
                    <label className="checkbox-label">
                        <input type="checkbox" checked={form.recurring} onChange={(e) => setForm({ ...form, recurring: e.target.checked })} />
                        Conta fixa (repete todo mes)
                    </label>
                    {form.recurring ? (
                        <input placeholder="Dia de vencimento (1-31)" type="number" min="1" max="31" value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} required />
                    ) : (
                        <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} required />
                    )}
                    <button type="submit" className="btn-primary">Adicionar</button>
                </form>
            </section>

            <section className="card">
                <div className="table-scroll">
                    <table className="data-table">
                        <thead>
                            <tr><th>Nome</th><th>Categoria</th><th>Tipo</th><th>Valor</th><th>Vencimento</th><th>Status</th><th /></tr>
                        </thead>
                        <tbody>
                            {data.items.map((item) => (
                                <tr key={`${item.kind}-${item.id}`}>
                                    <td>{item.name}</td>
                                    <td>{item.categoryName || '-'}</td>
                                    <td>{TYPE_LABEL[typeKeyFor(item)]}</td>
                                    <td>R$ {item.expectedAmount.toFixed(2)}</td>
                                    <td>{item.dueDate}</td>
                                    <td><span className={`badge-status ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span></td>
                                    <td>
                                        <button className="btn-link" onClick={() => togglePaid(item)}>
                                            {item.paid ? 'desfazer' : 'marcar como paga'}
                                        </button>
                                        {item.kind === 'BILL' && (
                                            <button className="btn-link" style={{ marginLeft: 12 }} onClick={() => removeBill(item.id)}>remover</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {data.items.length === 0 && (
                                <tr><td colSpan={7}>Nenhuma conta cadastrada ainda.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
