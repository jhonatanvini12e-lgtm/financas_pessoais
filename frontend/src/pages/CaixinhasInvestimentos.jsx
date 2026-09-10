import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import ProgressBar from '../components/ProgressBar.jsx';
import StatCard from '../components/StatCard.jsx';

const TYPES = ['RESERVA_EMERGENCIA', 'RENDA_FIXA', 'TESOURO_DIRETO', 'FII', 'ACOES'];

const ACTION_LABELS = {
    PAY_DEBT: 'Quitar divida primeiro',
    REDUCE_CARD_USAGE: 'Reduzir uso do cartao',
    BUILD_EMERGENCY_FUND: 'Completar reserva de emergencia',
    INVEST: 'Investir a sobra',
};

export default function CaixinhasInvestimentos() {
    const [recommendation, setRecommendation] = useState(null);
    const [track, setTrack] = useState(null);
    const [envelopes, setEnvelopes] = useState([]);
    const [suggestion, setSuggestion] = useState(null);
    const [investments, setInvestments] = useState([]);
    const [goals, setGoals] = useState([]);
    const [error, setError] = useState('');
    const [amounts, setAmounts] = useState({});

    const [invForm, setInvForm] = useState({ type: 'RESERVA_EMERGENCIA', name: '', amount_invested: '', current_value: '' });
    const [goalForm, setGoalForm] = useState({ name: '', target_amount: '', target_date: '' });

    const load = ({ silent = false } = {}) => {
        api.get('/investments/recommendation').then(setRecommendation).catch((err) => {
            if (!silent) setError(err.message);
        });
        api.get('/investments/track-status').then(setTrack).catch((err) => {
            if (!silent) setError(err.message);
        });
        api.get('/envelopes').then(setEnvelopes).catch((err) => {
            if (!silent) setError(err.message);
        });
        api.get('/envelopes/suggestion').then(setSuggestion).catch(() => {});
        api.get('/investments').then(setInvestments).catch(() => {});
        api.get('/investments/goals').then(setGoals).catch(() => {});
    };
    useEffect(load, []);
    usePolling(() => load({ silent: true }), []);

    const deposit = async (id) => {
        try {
            await api.post(`/envelopes/${id}/deposit`, { amount: Number(amounts[id] || 0) });
            setAmounts({ ...amounts, [id]: '' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const withdraw = async (id) => {
        try {
            await api.post(`/envelopes/${id}/withdraw`, { amount: Number(amounts[id] || 0) });
            setAmounts({ ...amounts, [id]: '' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const addInvestment = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/investments', {
                ...invForm,
                amount_invested: Number(invForm.amount_invested),
                current_value: Number(invForm.current_value),
            });
            setInvForm({ type: 'RESERVA_EMERGENCIA', name: '', amount_invested: '', current_value: '' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const addGoal = async (e) => {
        e.preventDefault();
        try {
            await api.post('/investments/goals', { ...goalForm, target_amount: Number(goalForm.target_amount) });
            setGoalForm({ name: '', target_amount: '', target_date: '' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    if (!track) return <p>Carregando...</p>;

    return (
        <div className="page">
            <h1>Caixinhas e Investimentos — Trilha Moderada</h1>
            {error && <div className="error-msg">{error}</div>}

            {recommendation && (
                <section className="card">
                    <h2>Recomendacao do mes</h2>
                    <p><strong>{ACTION_LABELS[recommendation.action]}</strong> — {recommendation.reasoning}</p>
                    <div className="stat-grid">
                        <StatCard label="Sobra mensal (renda - despesas)" value={`R$ ${recommendation.monthlyAmountAvailable.toFixed(2)}`} />
                        <StatCard
                            label="Selic atual"
                            value={`${(recommendation.marketRate.selicAnnual * 100).toFixed(2)}% a.a.`}
                            hint={recommendation.marketRate.source === 'bcb' ? 'Fonte: Banco Central' : 'Fonte: valor de referencia local (API indisponivel)'}
                        />
                        <StatCard label="CDI aproximado" value={`${(recommendation.marketRate.cdiApprox * 100).toFixed(2)}% a.a.`} />
                    </div>

                    {recommendation.allocation.length > 0 && (
                        <>
                            <h3>Onde alocar</h3>
                            <div className="stat-grid">
                                {recommendation.allocation.map((a) => (
                                    <StatCard
                                        key={a.type}
                                        label={a.type}
                                        value={`R$ ${a.amount.toFixed(2)}`}
                                        hint={`${(a.percent * 100).toFixed(0)}% da sobra alocavel`}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </section>
            )}

            <section className="card">
                <h2>Reserva de Emergencia</h2>
                <p>Prioridade absoluta: nenhum outro ativo e sugerido antes de completar a reserva.</p>
                <ProgressBar
                    ratio={track.emergencyFund.target > 0 ? track.emergencyFund.current / track.emergencyFund.target : 0}
                    label={`R$ ${track.emergencyFund.current.toFixed(2)} de R$ ${track.emergencyFund.target.toFixed(2)}`}
                />
                {!track.canSuggestOtherAssets && (
                    <p className="budget-alert-warning">
                        Complete a Reserva de Emergencia antes de investir em outros ativos.
                    </p>
                )}
            </section>

            <section className="card">
                <h2>Caixinhas Automaticas</h2>
                {suggestion && (
                    <>
                        <p>Media de renda: R$ {suggestion.avgIncome.toFixed(2)} — Media de despesas: R$ {suggestion.avgExpense.toFixed(2)}</p>
                        <ul className="simple-list">
                            <li>Fundo de Emergencia: R$ {suggestion.emergencyFund.suggestedMonthlyContribution.toFixed(2)}/mes {suggestion.emergencyFund.complete && '(meta concluida)'}</li>
                            <li>Gastos Imprevistos: R$ {suggestion.unexpectedExpenses.suggestedMonthlyContribution.toFixed(2)}/mes</li>
                        </ul>
                    </>
                )}

                <div className="stat-grid">
                    {envelopes.map((env) => {
                        const ratio = env.target_amount > 0 ? env.current_amount / env.target_amount : 0;
                        return (
                            <div key={env.id} className="card">
                                <h3>{env.name}</h3>
                                <p>R$ {env.current_amount.toFixed(2)} {env.target_amount > 0 && `de R$ ${env.target_amount.toFixed(2)}`}</p>
                                {env.target_amount > 0 && <ProgressBar ratio={ratio} />}
                                <div className="inline-form">
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="Valor"
                                        value={amounts[env.id] || ''}
                                        onChange={(e) => setAmounts({ ...amounts, [env.id]: e.target.value })}
                                    />
                                    <button className="btn-primary" onClick={() => deposit(env.id)}>Depositar</button>
                                    <button className="btn-link" onClick={() => withdraw(env.id)}>Retirar</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <div className="two-col">
                <section className="card">
                    <h2>Meus investimentos</h2>
                    <div className="table-scroll">
                    <table className="data-table">
                        <thead><tr><th>Nome</th><th>Tipo</th><th>Investido</th><th>Valor atual</th></tr></thead>
                        <tbody>
                            {investments.map((i) => (
                                <tr key={i.id}>
                                    <td>{i.name}</td><td>{i.type}</td>
                                    <td>R$ {i.amount_invested.toFixed(2)}</td>
                                    <td>R$ {i.current_value.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>

                    <form onSubmit={addInvestment} className="inline-form">
                        <select value={invForm.type} onChange={(e) => setInvForm({ ...invForm, type: e.target.value })}
                            disabled={!track.canSuggestOtherAssets}>
                            {TYPES.filter((t) => track.canSuggestOtherAssets || t === 'RESERVA_EMERGENCIA').map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                        <input placeholder="Nome" value={invForm.name} onChange={(e) => setInvForm({ ...invForm, name: e.target.value })} required />
                        <input placeholder="Valor investido" type="number" step="0.01" value={invForm.amount_invested}
                            onChange={(e) => setInvForm({ ...invForm, amount_invested: e.target.value })} required />
                        <input placeholder="Valor atual" type="number" step="0.01" value={invForm.current_value}
                            onChange={(e) => setInvForm({ ...invForm, current_value: e.target.value })} required />
                        <button type="submit" className="btn-primary">Adicionar</button>
                    </form>
                </section>

                <section className="card">
                    <h2>Metas financeiras</h2>
                    <div className="table-scroll">
                    <table className="data-table">
                        <thead><tr><th>Meta</th><th>Meses</th><th>Aporte mensal necessario</th></tr></thead>
                        <tbody>
                            {goals.map((g) => (
                                <tr key={g.goalId}>
                                    <td>{g.name}</td><td>{g.months}</td>
                                    <td>R$ {g.monthlyContributionRequired.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>

                    <form onSubmit={addGoal} className="inline-form">
                        <input placeholder="Nome da meta" value={goalForm.name} onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })} required />
                        <input placeholder="Valor alvo" type="number" step="0.01" value={goalForm.target_amount}
                            onChange={(e) => setGoalForm({ ...goalForm, target_amount: e.target.value })} required />
                        <input type="date" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} required />
                        <button type="submit" className="btn-primary">Adicionar meta</button>
                    </form>
                </section>
            </div>
        </div>
    );
}
