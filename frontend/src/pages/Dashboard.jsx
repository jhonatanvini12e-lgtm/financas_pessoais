import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import HideValuesToggle from '../components/HideValuesToggle.jsx';
import { usePrivacy } from '../context/PrivacyContext.jsx';

export default function Dashboard() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const { hideValues } = usePrivacy();
    const currency = (v) => (hideValues ? '••••••' : `R$ ${Number(v || 0).toFixed(2)}`);

    useEffect(() => {
        api.get('/dashboard').then(setData).catch((err) => setError(err.message));
    }, []);

    if (error) return <div className="error-msg">{error}</div>;
    if (!data) return <p>Carregando...</p>;

    return (
        <div className="page">
            <div className="page-header-row">
                <h1>Dashboard</h1>
                <HideValuesToggle />
            </div>

            <div className="stat-grid">
                <StatCard label="Saldo em contas" value={currency(data.totalBalance)} tone="hero" />
                <StatCard
                    label="Uso de credito"
                    value={`${(data.creditUsage.usageRatio * 100).toFixed(0)}%`}
                    tone={data.creditUsage.usageRatio >= 0.7 ? 'critical' : 'default'}
                    hint={`${currency(data.creditUsage.totalUsage)} de ${currency(data.creditUsage.totalLimit)}`}
                />
                <StatCard
                    label="Dividas em aberto"
                    value={currency(data.debtSummary.totalBalance)}
                    hint={`${data.debtSummary.count} divida(s)`}
                />
                <StatCard
                    label="Reserva de emergencia"
                    value={currency(data.envelopeSuggestions.emergencyFund.current)}
                    hint={`Meta: ${currency(data.envelopeSuggestions.emergencyFund.target)}`}
                />
            </div>

            <section className="card">
                <h2>Orcamento do mes</h2>
                <ProgressBar ratio={data.budget.fixed.ratio} label="Custos fixos" />
                <ProgressBar ratio={data.budget.variable.ratio} label="Custos variaveis" />
                {data.budget.categories.map((cat) => (
                    <ProgressBar key={cat.categoryId ?? 'sem-categoria'} ratio={cat.ratio} label={cat.name} />
                ))}
            </section>

            <div className="two-col">
                <section className="card">
                    <h2>Faturas proximas</h2>
                    {data.upcomingInvoices.length === 0 && <p className="muted">Nenhuma fatura em aberto.</p>}
                    <ul className="simple-list">
                        {data.upcomingInvoices.map((inv) => (
                            <li key={inv.cardId}>
                                Vencimento {inv.dueDate} — {currency(inv.total)}
                            </li>
                        ))}
                    </ul>
                </section>

                <section className="card">
                    <h2>Alertas recentes</h2>
                    {data.recentAlerts.length === 0 && <p className="muted">Nenhum alerta recente.</p>}
                    <ul className="simple-list">
                        {data.recentAlerts.map((alert) => (
                            <li key={alert.id} className={`alert-item alert-${alert.severity?.toLowerCase()}`}>
                                {alert.message}
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
        </div>
    );
}
