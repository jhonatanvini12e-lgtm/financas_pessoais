import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import HideValuesToggle from '../components/HideValuesToggle.jsx';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { formatCurrency } from '../utils/currency.js';
import { PROVIDERS } from '../constants/providers.js';

export default function Accounts() {
    const [accounts, setAccounts] = useState([]);
    const [cards, setCards] = useState([]);
    const [error, setError] = useState('');
    const { hideValues } = usePrivacy();

    const [accountForm, setAccountForm] = useState({ bank_name: '', provider: 'nubank', balance: '' });
    const [cardForm, setCardForm] = useState({ card_name: '', credit_limit: '', closing_day: '', due_day: '', provider: 'nubank' });

    const load = () => {
        api.get('/accounts').then(setAccounts).catch((err) => setError(err.message));
        api.get('/cards').then(setCards).catch((err) => setError(err.message));
    };

    useEffect(load, []);

    usePolling(() => {
        api.get('/accounts').then(setAccounts).catch(() => {});
        api.get('/cards').then(setCards).catch(() => {});
    }, []);

    const addAccount = async (e) => {
        e.preventDefault();
        try {
            await api.post('/accounts', { ...accountForm, balance: Number(accountForm.balance) || 0 });
            setAccountForm({ bank_name: '', provider: 'nubank', balance: '' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const addCard = async (e) => {
        e.preventDefault();
        try {
            await api.post('/cards', {
                ...cardForm,
                credit_limit: Number(cardForm.credit_limit),
                closing_day: Number(cardForm.closing_day),
                due_day: Number(cardForm.due_day),
            });
            setCardForm({ card_name: '', credit_limit: '', closing_day: '', due_day: '', provider: 'nubank' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const removeAccount = async (id) => {
        await api.delete(`/accounts/${id}`);
        load();
    };

    const removeCard = async (id) => {
        await api.delete(`/cards/${id}`);
        load();
    };

    return (
        <div className="page">
            <div className="page-header-row">
                <h1>Contas e Cartoes</h1>
                <HideValuesToggle />
            </div>
            {error && <div className="error-msg">{error}</div>}

            <div className="two-col">
                <section className="card">
                    <h2>Contas bancarias</h2>
                    <div className="table-scroll">
                    <table className="data-table">
                        <thead>
                            <tr><th>Banco</th><th>Provider</th><th>Saldo</th><th /></tr>
                        </thead>
                        <tbody>
                            {accounts.map((a) => (
                                <tr key={a.id}>
                                    <td>{a.bank_name}</td>
                                    <td>{a.provider}</td>
                                    <td>{formatCurrency(a.balance, hideValues)}</td>
                                    <td><button className="btn-link" onClick={() => removeAccount(a.id)}>remover</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>

                    <form onSubmit={addAccount} className="inline-form">
                        <input placeholder="Nome do banco" value={accountForm.bank_name}
                            onChange={(e) => setAccountForm({ ...accountForm, bank_name: e.target.value })} required />
                        <select value={accountForm.provider} onChange={(e) => setAccountForm({ ...accountForm, provider: e.target.value })}>
                            {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                        <input placeholder="Saldo inicial" type="number" step="0.01" value={accountForm.balance}
                            onChange={(e) => setAccountForm({ ...accountForm, balance: e.target.value })} />
                        <button type="submit" className="btn-primary">Adicionar conta</button>
                    </form>
                </section>

                <section className="card">
                    <h2>Cartoes de credito</h2>
                    <div className="table-scroll">
                    <table className="data-table">
                        <thead>
                            <tr><th>Cartao</th><th>Limite</th><th>Fecha</th><th>Vence</th><th /></tr>
                        </thead>
                        <tbody>
                            {cards.map((c) => (
                                <tr key={c.id}>
                                    <td>{c.card_name}</td>
                                    <td>{formatCurrency(c.credit_limit, hideValues)}</td>
                                    <td>dia {c.closing_day}</td>
                                    <td>dia {c.due_day}</td>
                                    <td><button className="btn-link" onClick={() => removeCard(c.id)}>remover</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>

                    <form onSubmit={addCard} className="inline-form">
                        <input placeholder="Nome do cartao" value={cardForm.card_name}
                            onChange={(e) => setCardForm({ ...cardForm, card_name: e.target.value })} required />
                        <input placeholder="Limite" type="number" step="0.01" value={cardForm.credit_limit}
                            onChange={(e) => setCardForm({ ...cardForm, credit_limit: e.target.value })} required />
                        <input placeholder="Dia fechamento" type="number" min="1" max="31" value={cardForm.closing_day}
                            onChange={(e) => setCardForm({ ...cardForm, closing_day: e.target.value })} required />
                        <input placeholder="Dia vencimento" type="number" min="1" max="31" value={cardForm.due_day}
                            onChange={(e) => setCardForm({ ...cardForm, due_day: e.target.value })} required />
                        <select value={cardForm.provider} onChange={(e) => setCardForm({ ...cardForm, provider: e.target.value })}>
                            {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                        <button type="submit" className="btn-primary">Adicionar cartao</button>
                    </form>
                </section>
            </div>
        </div>
    );
}
