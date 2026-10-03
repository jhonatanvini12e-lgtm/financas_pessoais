import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import StatCard from '../components/StatCard.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import HideValuesToggle from '../components/HideValuesToggle.jsx';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { formatCurrency } from '../utils/currency.js';

function Icon({ children }) {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {children}
        </svg>
    );
}

const ICON_WALLET = (
    <Icon>
        <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <path d="M17 12h.01" />
    </Icon>
);

const ICON_CARD = (
    <Icon>
        <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
        <path d="M2.5 10h19" />
    </Icon>
);

const ICON_TRENDING_DOWN = (
    <Icon>
        <path d="M3 7h5l4 13 4-17 4 11h1" />
    </Icon>
);

const ICON_SHIELD = (
    <Icon>
        <path d="M12 2 4 5v6c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5z" />
    </Icon>
);

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
                <StatCard label="Saldo em contas" value={formatCurrency(data.totalBalance, hideValues)} tone="hero" icon={ICON_WALLET} />
                <StatCard
                    label="Uso de credito"
                    value={`${(data.creditUsage.usageRatio * 100).toFixed(0)}%`}
                    tone={data.creditUsage.usageRatio >= 0.7 ? 'critical' : 'default'}
                    hint={`${formatCurrency(data.creditUsage.totalUsage, hideValues)} de ${formatCurrency(data.creditUsage.totalLimit, hideValues)}`}
                    icon={ICON_CARD}
                />
                <StatCard
                    label="Dividas em aberto"
                    value={formatCurrency(data.debtSummary.totalBalance, hideValues)}
                    hint={`${data.debtSummary.count} divida(s)`}
                    icon={ICON_TRENDING_DOWN}
                />
                <StatCard
                    label="Reserva de emergencia"
                    value={formatCurrency(data.envelopeSuggestions.emergencyFund.current, hideValues)}
                    hint={`Meta: ${formatCurrency(data.envelopeSuggestions.emergencyFund.target, hideValues)}`}
                    icon={ICON_SHIELD}
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
