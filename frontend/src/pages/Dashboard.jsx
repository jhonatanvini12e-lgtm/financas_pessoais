import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import StatCard from '../components/StatCard.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import HideValuesToggle from '../components/HideValuesToggle.jsx';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { formatCurrency } from '../utils/currency.js';

export default function Dashboard() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const { hideValues } = usePrivacy();

    useEffect(() => {
        api.get('/dashboard').then(setData).catch((err) => setError(err.message));
    }, []);

    usePolling(() => {
        api.get('/dashboard').then(setData).catch(() => {});
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
                <StatCard label="Saldo em contas" value={formatCurrency(data.totalBalance, hideValues)} tone="hero" />
                <StatCard
                    label="Uso de credito"
                    value={`${(data.creditUsage.usageRatio * 100).toFixed(0)}%`}
                    tone={data.creditUsage.usageRatio >= 0.7 ? 'critical' : 'default'}
                    hint={`${formatCurrency(data.creditUsage.totalUsage, hideValues)} de ${formatCurrency(data.creditUsage.totalLimit, hideValues)}`}
                />
                <StatCard
                    label="Dividas em aberto"
                    value={formatCurrency(data.debtSummary.totalBalance, hideValues)}
                    hint={`${data.debtSummary.count} divida(s)`}
                />
                <StatCard
                    label="Reserva de emergencia"
                    value={formatCurrency(data.envelopeSuggestions.emergencyFund.current, hideValues)}
                    hint={`Meta: ${formatCurrency(data.envelopeSuggestions.emergencyFund.target, hideValues)}`}
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
                                Vencimento {inv.dueDate} — {formatCurrency(inv.total, hideValues)}
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
