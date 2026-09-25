import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { formatCurrency } from '../utils/currency.js';

export default function Categories() {
    const [categories, setCategories] = useState([]);
    const [error, setError] = useState('');
    const [form, setForm] = useState({ name: '', type: 'EXPENSE', keywords: '', budget_limit: '' });
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ name: '', type: 'EXPENSE', keywords: '', budget_limit: '' });
    const { hideValues } = usePrivacy();

    const load = () => { api.get('/categories').then(setCategories).catch((err) => setError(err.message)); };
    useEffect(load, []);

    const add = async (e) => {
        e.preventDefault();
        try {
            await api.post('/categories', { ...form, budget_limit: Number(form.budget_limit) || 0 });
            setForm({ name: '', type: 'EXPENSE', keywords: '', budget_limit: '' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const remove = async (id) => {
        try {
            await api.delete(`/categories/${id}`);
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const startEdit = (c) => {
        setEditingId(c.id);
        setEditForm({ name: c.name, type: c.type, keywords: c.keywords || '', budget_limit: String(c.budget_limit ?? '') });
        setError('');
    };

    const cancelEdit = () => {
        setEditingId(null);
    };

    const saveEdit = async (id) => {
        try {
            await api.put(`/categories/${id}`, { ...editForm, budget_limit: Number(editForm.budget_limit) || 0 });
            setEditingId(null);
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="page">
            <h1>Categorias e Regras de Categorizacao</h1>
            {error && <div className="error-msg">{error}</div>}

            <section className="card">
                <h2>Nova categoria</h2>
                <form onSubmit={add} className="inline-form">
                    <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                    <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                        <option value="EXPENSE">Despesa</option>
                        <option value="INCOME">Receita</option>
                    </select>
                    <input placeholder="Palavras-chave (separadas por virgula)" value={form.keywords}
                        onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
                    <input placeholder="Teto mensal" type="number" step="0.01" value={form.budget_limit}
                        onChange={(e) => setForm({ ...form, budget_limit: e.target.value })} />
                    <button type="submit" className="btn-primary">Adicionar</button>
                </form>
            </section>

            <section className="card">
                <div className="table-scroll">
                <table className="data-table">
                    <thead>
                        <tr><th>Nome</th><th>Tipo</th><th>Palavras-chave</th><th>Teto</th><th /></tr>
                    </thead>
                    <tbody>
                        {categories.map((c) => (
                            <tr key={c.id}>
                                {editingId === c.id ? (
                                    <>
                                        <td><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                                        <td>
                                            <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                                                <option value="EXPENSE">Despesa</option>
                                                <option value="INCOME">Receita</option>
                                            </select>
                                        </td>
                                        <td><input value={editForm.keywords} onChange={(e) => setEditForm({ ...editForm, keywords: e.target.value })} /></td>
                                        <td><input type="number" step="0.01" value={editForm.budget_limit}
                                            onChange={(e) => setEditForm({ ...editForm, budget_limit: e.target.value })} /></td>
                                        <td className="row-actions">
                                            <button className="btn-link" onClick={() => saveEdit(c.id)}>salvar</button>
                                            <button className="btn-link" onClick={cancelEdit}>cancelar</button>
                                        </td>
                                    </>
                                ) : (
                                    <>
                                        <td>{c.name}</td>
                                        <td>{c.type === 'EXPENSE' ? 'Despesa' : 'Receita'}</td>
                                        <td>{c.keywords}</td>
                                        <td>{formatCurrency(c.budget_limit, hideValues)}</td>
                                        <td className="row-actions">
                                            <button className="btn-icon" title="Editar categoria" aria-label="Editar categoria" onClick={() => startEdit(c)}>✎</button>
                                            <button className="btn-link" onClick={() => remove(c.id)}>remover</button>
                                        </td>
                                    </>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </section>
        </div>
    );
}
