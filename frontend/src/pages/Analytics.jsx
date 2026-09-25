import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import StatCard from '../components/StatCard.jsx';
import BarChartCard from '../components/charts/BarChartCard.jsx';
import LineChartCard from '../components/charts/LineChartCard.jsx';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { formatCurrency } from '../utils/currency.js';

const MONTHS_OPTIONS = [
    { value: 3, label: 'Ultimos 3 meses' },
    { value: 6, label: 'Ultimos 6 meses' },
    { value: 12, label: 'Ultimos 12 meses' },
];

function CardUserFilter({ cards, members, cardId, onCardChange, userId, onUserChange }) {
    return (
        <div className="inline-form">
            <select value={cardId} onChange={(e) => onCardChange(e.target.value)}>
                <option value="">Todos os cartoes</option>
                {cards.map((c) => <option key={c.id} value={c.id}>{c.card_name}</option>)}
            </select>
            <select value={userId} onChange={(e) => onUserChange(e.target.value)}>
                <option value="">Todos os usuarios</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.username}</option>)}
            </select>
        </div>
    );
}

export default function Analytics() {
    const { hideValues } = usePrivacy();
    const [cards, setCards] = useState([]);
    const [members, setMembers] = useState([]);
    const [error, setError] = useState('');

    const [spendingMonths, setSpendingMonths] = useState(6);
    const [spendingCard, setSpendingCard] = useState('');
    const [spendingUser, setSpendingUser] = useState('');
    const [spending, setSpending] = useState(null);

    const [cashFlowMonths, setCashFlowMonths] = useState(6);
    const [cashFlow, setCashFlow] = useState(null);

    const [usageCard, setUsageCard] = useState('');
    const [usageUser, setUsageUser] = useState('');
    const [usage, setUsage] = useState(null);

    const [installmentsCard, setInstallmentsCard] = useState('');
    const [installmentsUser, setInstallmentsUser] = useState('');
    const [installments, setInstallments] = useState(null);

    useEffect(() => {
        api.get('/cards').then(setCards).catch(() => {});
        api.get('/auth/household-members').then(setMembers).catch(() => {});
    }, []);

    useEffect(() => {
        const params = new URLSearchParams({ months: spendingMonths });
        if (spendingCard) params.set('card_id', spendingCard);
        if (spendingUser) params.set('created_by', spendingUser);
        api.get(`/analytics/monthly-spending?${params}`).then(setSpending).catch((err) => setError(err.message));
    }, [spendingMonths, spendingCard, spendingUser]);

    useEffect(() => {
        const params = new URLSearchParams({ months: cashFlowMonths });
        api.get(`/analytics/cash-flow?${params}`).then(setCashFlow).catch((err) => setError(err.message));
    }, [cashFlowMonths]);

    useEffect(() => {
        const params = new URLSearchParams();
        if (usageCard) params.set('card_id', usageCard);
        if (usageUser) params.set('created_by', usageUser);
        api.get(`/analytics/credit-usage?${params}`).then(setUsage).catch((err) => setError(err.message));
    }, [usageCard, usageUser]);

    useEffect(() => {
        const params = new URLSearchParams();
        if (installmentsCard) params.set('card_id', installmentsCard);
        if (installmentsUser) params.set('created_by', installmentsUser);
        api.get(`/analytics/installments?${params}`).then(setInstallments).catch((err) => setError(err.message));
    }, [installmentsCard, installmentsUser]);

    if (error) return <div className="error-msg">{error}</div>;

    return (
        <div className="page">
            <h1>Analises</h1>

            <section className="card">
                <div className="page-header-row">
                    <h2>Gasto mensal total</h2>
                    <select value={spendingMonths} onChange={(e) => setSpendingMonths(Number(e.target.value))}>
                        {MONTHS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                <CardUserFilter
                    cards={cards}
                    members={members}
                    cardId={spendingCard}
                    onCardChange={setSpendingCard}
                    userId={spendingUser}
                    onUserChange={setSpendingUser}
                />
                {!spending ? (
                    <p className="muted">Carregando...</p>
                ) : spending.monthly.length === 0 ? (
                    <p className="muted">Nenhum gasto no periodo selecionado.</p>
                ) : (
                    <BarChartCard
                        data={spending.monthly}
                        xKey="month"
                        bars={[{ key: 'total', name: 'Gasto total', color: '#f87171' }]}
                    />
                )}
            </section>

            <section className="card">
                <div className="page-header-row">
                    <h2>Fluxo de caixa</h2>
                    <select value={cashFlowMonths} onChange={(e) => setCashFlowMonths(Number(e.target.value))}>
                        {MONTHS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                {!cashFlow ? (
                    <p className="muted">Carregando...</p>
                ) : cashFlow.monthly.length === 0 ? (
                    <p className="muted">Nenhum lancamento no periodo selecionado.</p>
                ) : (
                    <div className="two-col">
                        <BarChartCard
                            title="Entradas x saidas"
                            data={cashFlow.monthly}
                            xKey="month"
                            bars={[
                                { key: 'income', name: 'Entradas', color: '#34d399' },
                                { key: 'expense', name: 'Saidas', color: '#f87171' },
                            ]}
                        />
                        <LineChartCard
                            title="Saldo acumulado"
                            data={cashFlow.monthly}
                            xKey="month"
                            lines={[{ key: 'cumulative', name: 'Saldo acumulado', color: '#3b82f6' }]}
                        />
                    </div>
                )}
            </section>

            <section className="card">
                <h2>Limite de credito usado</h2>
                <CardUserFilter
                    cards={cards}
                    members={members}
                    cardId={usageCard}
                    onCardChange={setUsageCard}
                    userId={usageUser}
                    onUserChange={setUsageUser}
                />
                {!usage ? (
                    <p className="muted">Carregando...</p>
                ) : usage.byCard.length === 0 ? (
                    <p className="muted">Nenhum cartao cadastrado.</p>
                ) : (
                    <>
                        <div className="stat-grid">
                            <StatCard
                                label="Uso de credito"
                                value={`${(usage.usageRatio * 100).toFixed(0)}%`}
                                tone={usage.usageRatio >= 0.7 ? 'critical' : 'default'}
                                hint={`${formatCurrency(usage.totalUsed, hideValues)} de ${formatCurrency(usage.totalLimit, hideValues)}`}
                            />
                        </div>
                        <BarChartCard
                            data={usage.byCard}
                            xKey="cardName"
                            bars={[
                                { key: 'limit', name: 'Limite', color: '#3b82f6' },
                                { key: 'used', name: 'Usado', color: '#fbbf24' },
                            ]}
                        />
                    </>
                )}
            </section>

            <section className="card">
                <h2>Parcelamentos em aberto</h2>
                <CardUserFilter
                    cards={cards}
                    members={members}
                    cardId={installmentsCard}
                    onCardChange={setInstallmentsCard}
                    userId={installmentsUser}
                    onUserChange={setInstallmentsUser}
                />
                {!installments ? (
                    <p className="muted">Carregando...</p>
                ) : (
                    <>
                        <div className="stat-grid">
                            <StatCard label="Total de parcelamentos" value={installments.total} />
                            <StatCard label="Valor total parcelado" value={formatCurrency(installments.totalValue, hideValues)} />
                        </div>
                        {installments.byCard.length > 0 && (
                            <BarChartCard
                                data={installments.byCard}
                                xKey="cardName"
                                bars={[{ key: 'count', name: 'Parcelamentos', color: '#3b82f6' }]}
                            />
                        )}
                    </>
                )}
            </section>
        </div>
    );
}
