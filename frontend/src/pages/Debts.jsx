import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import LineChartCard from '../components/charts/LineChartCard.jsx';

export default function Debts() {
    const [debts, setDebts] = useState([]);
    const [summary, setSummary] = useState(null);
    const [plan, setPlan] = useState(null);
    const [error, setError] = useState('');
    const [form, setForm] = useState({ name: '', creditor: '', principal: '', current_balance: '', interest_rate_monthly: '', minimum_payment: '' });

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [extraBudget, setExtraBudget] = useState('0');
    const [simulation, setSimulation] = useState(null);

    const [renegForm, setRenegForm] = useState({ currentBalance: '', interestRateMonthly: '', minimumPayment: '', discountPercent: '0.2', installments: '', newMonthlyRate: '' });
    const [renegResult, setRenegResult] = useState(null);

    const load = () => {
        api.get('/debts').then(setDebts).catch((err) => setError(err.message));
        api.get('/debts/summary').then(setSummary).catch(() => {});
        api.get('/debts/payoff-plan').then(setPlan).catch(() => {});
    };
    useEffect(load, []);

    const addDebt = async (e) => {
        e.preventDefault();
        try {
            await api.post('/debts', {
                ...form,
                principal: Number(form.principal),
                current_balance: Number(form.current_balance),
                interest_rate_monthly: Number(form.interest_rate_monthly),
                minimum_payment: Number(form.minimum_payment),
            });
            setForm({ name: '', creditor: '', principal: '', current_balance: '', interest_rate_monthly: '', minimum_payment: '' });
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const remove = async (id) => {
        await api.delete(`/debts/${id}`);
        load();
    };

    const simulate = async () => {
        try {
            const data = await api.get(`/debts/simulate?extra_budget=${Number(extraBudget) || 0}`);
            setSimulation(data);
        } catch (err) {
            setError(err.message);
        }
    };

    const simulateReneg = async (e) => {
        e.preventDefault();
        try {
            const data = await api.post('/debts/simulate-renegotiation', {
                currentBalance: Number(renegForm.currentBalance),
                interestRateMonthly: Number(renegForm.interestRateMonthly),
                minimumPayment: Number(renegForm.minimumPayment),
                discountPercent: Number(renegForm.discountPercent),
                installments: renegForm.installments ? Number(renegForm.installments) : null,
                newMonthlyRate: renegForm.newMonthlyRate ? Number(renegForm.newMonthlyRate) : null,
            });
            setRenegResult(data);
        } catch (err) {
            setError(err.message);
        }
    };

    const chartData = simulation?.avalanche?.schedule.map((row, i) => ({
        month: row.month,
        Avalanche: row.totalRemaining,
        BolaDeNeve: simulation.snowball.schedule[i]?.totalRemaining,
    }));

    return (
        <div className="page">
            <h1>Dividas</h1>
            {error && <div className="error-msg">{error}</div>}

            {summary && (
                <div className="stat-grid">
                    <div className="card"><h3>Total em dividas</h3><p>R$ {summary.totalBalance.toFixed(2)}</p></div>
                    <div className="card"><h3>Taxa media ponderada</h3><p>{(summary.weightedAverageRateMonthly * 100).toFixed(2)}% a.m.</p></div>
                </div>
            )}

            {plan && plan.hasDebts && (
                <section className="card">
                    <h2>Plano para sair das dividas</h2>
                    <div className="stat-grid">
                        <div className="card">
                            <h3>Sobra mensal media</h3>
                            <p>R$ {plan.monthlySurplus.toFixed(2)}</p>
                        </div>
                        <div className="card">
                            <h3>Extra sugerido para dividas</h3>
                            <p>R$ {plan.suggestedExtraPayment.toFixed(2)}/mes</p>
                        </div>
                        <div className="card">
                            <h3>Tempo estimado de quitacao</h3>
                            <p>{plan.projection.withExtra.monthsToPayoff ? `${plan.projection.withExtra.monthsToPayoff} meses` : '50+ anos'}</p>
                        </div>
                        <div className="card">
                            <h3>Economia em juros</h3>
                            <p>{plan.projection.interestSaved != null ? `R$ ${plan.projection.interestSaved.toFixed(2)}` : 'Divida cresce sem o extra'}</p>
                        </div>
                    </div>

                    <h3>Ordem de prioridade (avalanche)</h3>
                    <ol>
                        {plan.priorityOrder.map((d) => (
                            <li key={d.id}>{d.name} — R$ {d.balance.toFixed(2)} a {(d.rateMonthly * 100).toFixed(2)}% a.m.</li>
                        ))}
                    </ol>

                    <h3>Propostas</h3>
                    <ul>
                        {plan.recommendations.map((r, i) => (
                            <li key={i}>{r}</li>
                        ))}
                    </ul>
                </section>
            )}

            {plan && !plan.hasDebts && (
                <section className="card">
                    <p>Nenhuma divida em aberto no momento.</p>
                </section>
            )}

            <section className="card">
                <h2>Nova divida</h2>
                <form onSubmit={addDebt} className="inline-form">
                    <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                    <input placeholder="Credor" value={form.creditor} onChange={(e) => setForm({ ...form, creditor: e.target.value })} />
                    <input placeholder="Principal" type="number" step="0.01" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} required />
                    <input placeholder="Saldo atual" type="number" step="0.01" value={form.current_balance} onChange={(e) => setForm({ ...form, current_balance: e.target.value })} required />
                    <input placeholder="Juros mensal (ex: 0.05)" type="number" step="0.0001" value={form.interest_rate_monthly} onChange={(e) => setForm({ ...form, interest_rate_monthly: e.target.value })} required />
                    <input placeholder="Pagamento minimo" type="number" step="0.01" value={form.minimum_payment} onChange={(e) => setForm({ ...form, minimum_payment: e.target.value })} required />
                    <button type="submit" className="btn-primary">Adicionar</button>
                </form>
            </section>

            <section className="card">
                <div className="table-scroll">
                <table className="data-table">
                    <thead><tr><th>Nome</th><th>Credor</th><th>Saldo</th><th>Juros a.m.</th><th>Minimo</th><th /></tr></thead>
                    <tbody>
                        {debts.map((d) => (
                            <tr key={d.id}>
                                <td>{d.name}</td><td>{d.creditor}</td>
                                <td>R$ {d.current_balance.toFixed(2)}</td>
                                <td>{(d.interest_rate_monthly * 100).toFixed(2)}%</td>
                                <td>R$ {d.minimum_payment.toFixed(2)}</td>
                                <td><button className="btn-link" onClick={() => remove(d.id)}>remover</button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </section>

            <section className="card">
                <button type="button" className="btn-link" onClick={() => setShowAdvanced((v) => !v)}>
                    {showAdvanced ? 'Ocultar simuladores manuais (avancado)' : 'Mostrar simuladores manuais (avancado)'}
                </button>
            </section>

            {showAdvanced && (
            <>
            <section className="card">
                <h2>Simulador: Avalanche vs Bola de Neve</h2>
                <div className="inline-form">
                    <input placeholder="Orcamento extra mensal" type="number" step="0.01" value={extraBudget} onChange={(e) => setExtraBudget(e.target.value)} />
                    <button className="btn-primary" onClick={simulate}>Simular</button>
                </div>

                {simulation && simulation.avalanche && (
                    <>
                        <div className="stat-grid">
                            <div className="card">
                                <h3>Avalanche</h3>
                                <p>{simulation.avalanche.monthsToPayoff ? `${simulation.avalanche.monthsToPayoff} meses para quitar` : '50+ anos para quitar'}</p>
                                <p>Juros totais: {simulation.avalanche.neverPaysOff ? 'divida nunca para de crescer' : `R$ ${simulation.avalanche.totalInterestPaid.toFixed(2)}`}</p>
                            </div>
                            <div className="card">
                                <h3>Bola de Neve</h3>
                                <p>{simulation.snowball.monthsToPayoff ? `${simulation.snowball.monthsToPayoff} meses para quitar` : '50+ anos para quitar'}</p>
                                <p>Juros totais: {simulation.snowball.neverPaysOff ? 'divida nunca para de crescer' : `R$ ${simulation.snowball.totalInterestPaid.toFixed(2)}`}</p>
                            </div>
                        </div>
                        <LineChartCard
                            title="Saldo devedor ao longo do tempo"
                            data={chartData}
                            xKey="month"
                            lines={[
                                { key: 'Avalanche', color: '#06b6d4' },
                                { key: 'BolaDeNeve', name: 'Bola de Neve', color: '#8b5cf6' },
                            ]}
                        />
                    </>
                )}
            </section>

            <section className="card">
                <h2>Simulador de renegociacao</h2>
                <form onSubmit={simulateReneg} className="inline-form">
                    <input placeholder="Saldo atual" type="number" step="0.01" value={renegForm.currentBalance} onChange={(e) => setRenegForm({ ...renegForm, currentBalance: e.target.value })} required />
                    <input placeholder="Juros mensal atual" type="number" step="0.0001" value={renegForm.interestRateMonthly} onChange={(e) => setRenegForm({ ...renegForm, interestRateMonthly: e.target.value })} required />
                    <input placeholder="Pagamento minimo atual" type="number" step="0.01" value={renegForm.minimumPayment} onChange={(e) => setRenegForm({ ...renegForm, minimumPayment: e.target.value })} required />
                    <input placeholder="Desconto a vista (ex: 0.2)" type="number" step="0.01" value={renegForm.discountPercent} onChange={(e) => setRenegForm({ ...renegForm, discountPercent: e.target.value })} required />
                    <input placeholder="Parcelas (opcional)" type="number" value={renegForm.installments} onChange={(e) => setRenegForm({ ...renegForm, installments: e.target.value })} />
                    <input placeholder="Nova taxa mensal (opcional)" type="number" step="0.0001" value={renegForm.newMonthlyRate} onChange={(e) => setRenegForm({ ...renegForm, newMonthlyRate: e.target.value })} />
                    <button type="submit" className="btn-primary">Comparar propostas</button>
                </form>

                {renegResult && (
                    <div className="stat-grid">
                        <div className="card"><h3>Caminho atual</h3><p>Total: R$ {renegResult.currentPath.totalPaid.toFixed(2)}</p></div>
                        <div className="card"><h3>A vista com desconto</h3><p>Valor: R$ {renegResult.lumpSumOption.amount.toFixed(2)}</p><p>Economia: R$ {renegResult.lumpSumOption.savings.toFixed(2)}</p></div>
                        {renegResult.installmentOption && (
                            <div className="card"><h3>Novo parcelamento</h3><p>{renegResult.installmentOption.installments}x de R$ {renegResult.installmentOption.monthlyPayment.toFixed(2)}</p><p>Total: R$ {renegResult.installmentOption.totalPaid.toFixed(2)}</p></div>
                        )}
                    </div>
                )}
            </section>
            </>
            )}
        </div>
    );
}
