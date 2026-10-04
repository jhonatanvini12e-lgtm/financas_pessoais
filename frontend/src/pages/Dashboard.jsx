import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { useAuth } from '../context/AuthContext.jsx';
import RingProgress from '../components/RingProgress.jsx';
import Sparkline from '../components/Sparkline.jsx';
import HideValuesToggle from '../components/HideValuesToggle.jsx';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { formatCurrency } from '../utils/currency.js';

function Icon({ children }) {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {children}
        </svg>
    );
}

const SHORTCUTS = [
    { to: '/quick-add', label: 'Nova despesa', icon: <Icon><path d="M13 2 3 14h7l-1 8 11-14h-7z" /></Icon> },
    { to: '/accounts', label: 'Contas e cartões', icon: <Icon><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /></Icon> },
    { to: '/analytics', label: 'Relatórios', icon: <Icon><path d="M4 20V10M12 20V4M20 20v-7" /></Icon> },
    { to: '/caixinhas-investimentos', label: 'Caixinhas', icon: <Icon><path d="M3 17l6-7 4 4 7-9" /><path d="M14 5h6v6" /></Icon> },
    { to: '/categories', label: 'Categorias', icon: <Icon><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.17L4 3a1 1 0 0 0-1 1l.17 5.59a2 2 0 0 0 .66 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.83Z" /><circle cx="7.5" cy="7.5" r="1.2" /></Icon> },
    { to: '/connections', label: 'Sincronizar', icon: <Icon><path d="M7 7h7a4 4 0 0 1 0 8H8" /><path d="m10 4-3 3 3 3" /><path d="m14 20 3-3-3-3" /></Icon> },
];

const MONTH_ABBR = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

function greetingWord() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
}

function formatDueBadge(isoDate) {
    const [, month, day] = isoDate.split('-');
    return { day, month: MONTH_ABBR[Number(month) - 1] };
}

function formatDueShort(isoDate) {
    const [, month, day] = isoDate.split('-');
    return `${day}/${month}`;
}

// "soon" = vence nos proximos 5 dias e ainda nao foi pago -- so' afeta a cor
// do indicador, nao o status real (que vem do backend: PAID/LATE/PENDING).
function billTone(item) {
    if (item.paid) return 'paid';
    if (item.status === 'LATE') return 'late';
    const daysUntilDue = Math.ceil((new Date(item.dueDate) - new Date()) / 86400000);
    return daysUntilDue <= 5 ? 'soon' : 'ok';
}

// Indicador composto (0-100) a partir de 3 sinais que ja existem no app:
// reserva de emergencia (quanto mais perto da meta, melhor), uso de credito
// (quanto menos do limite usado, melhor) e orcamento do mes (quanto mais
// longe do teto, melhor). Cada um pesa 1/3 -- nao e' um calculo oficial do
// dominio financeiro, e' so' uma forma de resumir os 3 numeros num unico
// "termometro" visual.
function financialHealth({ reserveRatio, creditUsageRatio, budgetRatio }) {
    const reserveHealth = Math.min(Math.max(reserveRatio, 0), 1);
    const creditHeadroom = 1 - Math.min(Math.max(creditUsageRatio, 0), 1);
    const budgetHeadroom = 1 - Math.min(Math.max(budgetRatio, 0), 1);
    const score = Math.round(((reserveHealth + creditHeadroom + budgetHeadroom) / 3) * 100);
    const label = score >= 80 ? 'Ótimo' : score >= 60 ? 'Bom' : score >= 40 ? 'Atenção' : 'Crítico';
    return { score, label, reserveHealth, creditHeadroom, budgetHeadroom };
}

export default function Dashboard() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const { hideValues } = usePrivacy();
    const { user } = useAuth();

    useEffect(() => {
        api.get('/dashboard').then(setData).catch((err) => setError(err.message));
    }, []);

    usePolling(() => {
        api.get('/dashboard').then(setData).catch(() => {});
    }, []);

    if (error) return <div className="error-msg">{error}</div>;
    if (!data) return <p>Carregando...</p>;

    const budgetSpent = data.budget.fixed.spent + data.budget.variable.spent;
    const budgetCeiling = data.budget.fixed.ceiling + data.budget.variable.ceiling;
    const budgetRatio = budgetCeiling > 0 ? budgetSpent / budgetCeiling : 0;

    const reserve = data.envelopeSuggestions.emergencyFund;
    const reserveRatio = reserve.target > 0 ? reserve.current / reserve.target : 0;

    const health = financialHealth({
        reserveRatio,
        creditUsageRatio: data.creditUsage.usageRatio,
        budgetRatio,
    });

    const billItems = data.bills.items;
    const upcoming = billItems.filter((item) => !item.paid).slice(0, 3);

    const weekTotal = data.weeklySpending.reduce((sum, d) => sum + d.total, 0);
    const weekMax = Math.max(...data.weeklySpending.map((d) => d.total), 1);
    const peakIndex = weekTotal > 0 ? data.weeklySpending.reduce((best, d, i, arr) => (d.total > arr[best].total ? i : best), 0) : -1;

    const cashFlowValues = data.cashFlow.map((m) => m.net);
    const lastMonth = data.cashFlow[data.cashFlow.length - 1];

    return (
        <div className="page">
            <div className="page-header-row">
                <h1>Dashboard</h1>
                <HideValuesToggle />
            </div>

            <div className="two-col">
                <section className="card dash-card greeting-card">
                    <div>
                        <div className="greeting-eyebrow">{greetingWord()},</div>
                        <div className="greeting-name">{user?.username || 'por aqui'}</div>
                        <div className="greeting-sub">
                            {data.bills.lateCount > 0
                                ? `${data.bills.lateCount} conta(s) em atraso precisam de atenção.`
                                : 'Tudo em dia com suas contas. Continue assim.'}
                        </div>
                    </div>
                    {cashFlowValues.length >= 2 && <Sparkline values={cashFlowValues} color="var(--accent-blue)" />}
                </section>

                <section className="card dash-card balance-card">
                    <div className="balance-top-row">
                        <span className="greeting-eyebrow">Saldo disponível</span>
                    </div>
                    <div className="balance-amount">{formatCurrency(data.totalBalance, hideValues)}</div>
                    <div className="greeting-sub">
                        {data.accountsCount} conta{data.accountsCount === 1 ? '' : 's'} conectada{data.accountsCount === 1 ? '' : 's'}
                    </div>
                </section>
            </div>

            <div className="two-col">
                <section className="card dash-card ring-card">
                    <RingProgress ratio={budgetRatio} label={`${Math.round(budgetRatio * 100)}%`} sublabel="usado" />
                    <div>
                        <div className="ring-info-title">Orçamento mensal</div>
                        <div className="ring-info-main">{budgetRatio < 0.8 ? 'No caminho certo' : budgetRatio < 1 ? 'Perto do limite' : 'Acima do limite'}</div>
                        <div className="ring-info-row">
                            <div>
                                <div className="ring-info-stat-label">Gasto</div>
                                <div className="ring-info-stat-value">{formatCurrency(budgetSpent, hideValues)}</div>
                            </div>
                            <div>
                                <div className="ring-info-stat-label">Limite</div>
                                <div className="ring-info-stat-value">{formatCurrency(budgetCeiling, hideValues)}</div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="card dash-card ring-card">
                    <RingProgress
                        ratio={reserveRatio}
                        tone={reserve.complete ? 'positive' : 'warning'}
                        label={`${Math.round(reserveRatio * 100)}%`}
                        sublabel="concluído"
                    />
                    <div>
                        <div className="ring-info-title">Reserva de emergência</div>
                        <div className="ring-info-main">
                            {formatCurrency(reserve.current, hideValues)} de {formatCurrency(reserve.target, hideValues)}
                        </div>
                        <div className="greeting-sub" style={{ marginTop: 12 }}>
                            {reserve.complete
                                ? 'Meta atingida.'
                                : `Falta ${formatCurrency(Math.max(reserve.target - reserve.current, 0), hideValues)}`}
                        </div>
                    </div>
                </section>
            </div>

            <div className="two-col">
                <section className="card dash-card">
                    <div className="card-head">
                        <h2>Contas a pagar</h2>
                        <Link to="/bills" className="card-head-link">Ver todas</Link>
                    </div>
                    {billItems.length === 0 && <p className="muted">Nenhuma conta cadastrada.</p>}
                    <div className="bill-list">
                        {billItems.slice(0, 5).map((item) => {
                            const tone = billTone(item);
                            return (
                                <div className="bill-row" key={`${item.kind}-${item.id}`}>
                                    <span className={`bill-dot bill-dot--${tone}`} />
                                    <span className={`bill-name ${item.paid ? 'bill-name--paid' : ''}`}>{item.name}</span>
                                    <span className="bill-due">{item.paid ? `pago ${formatDueShort(item.paidDate || item.dueDate)}` : `venc. ${formatDueShort(item.dueDate)}`}</span>
                                    <span className="bill-amount">{formatCurrency(item.expectedAmount, hideValues)}</span>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="card dash-card">
                    <h2>Fluxo de caixa</h2>
                    {cashFlowValues.length >= 2 ? (
                        <>
                            <span style={{ color: lastMonth.net >= 0 ? 'var(--positive)' : 'var(--negative)', fontWeight: 600, fontSize: 13 }}>
                                {lastMonth.net >= 0 ? 'Positivo' : 'Negativo'}
                            </span>
                            <Sparkline values={cashFlowValues} color={lastMonth.net >= 0 ? 'var(--positive)' : 'var(--negative)'} />
                            <p className="greeting-sub">
                                {lastMonth.net >= 0
                                    ? `Entradas superam saídas em ${formatCurrency(lastMonth.net, hideValues)} este mês`
                                    : `Saídas superam entradas em ${formatCurrency(Math.abs(lastMonth.net), hideValues)} este mês`}
                            </p>
                        </>
                    ) : (
                        <p className="muted">Sem dados suficientes ainda.</p>
                    )}
                </section>
            </div>

            <div className="two-col">
                <section className="card dash-card">
                    <div className="card-head">
                        <h2>Gastos da semana</h2>
                        <span className="balance-delta" style={{ color: 'var(--accent-blue)', background: 'var(--accent-blue-soft)' }}>
                            {formatCurrency(weekTotal, hideValues)} total
                        </span>
                    </div>
                    <div className="weekly-bars">
                        {data.weeklySpending.map((day, i) => (
                            <div className="weekly-bar-col" key={day.date}>
                                <div
                                    className={`weekly-bar ${i === peakIndex ? 'weekly-bar--peak' : ''}`}
                                    style={{ height: `${Math.max((day.total / weekMax) * 100, 4)}%` }}
                                />
                                <span className={`weekly-bar-label ${i === peakIndex ? 'weekly-bar-label--peak' : ''}`}>{day.label}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="card dash-card">
                    <h2>Atalhos</h2>
                    <div className="shortcut-grid">
                        {SHORTCUTS.map((shortcut) => (
                            <Link to={shortcut.to} className="shortcut-item" key={shortcut.to}>
                                {shortcut.icon}
                                <span className="shortcut-label">{shortcut.label}</span>
                            </Link>
                        ))}
                    </div>
                </section>
            </div>

            <div className="two-col">
                <section className="card dash-card">
                    <div className="card-head">
                        <h2>Próximos vencimentos</h2>
                        <Link to="/bills" className="card-head-link">Ver tudo</Link>
                    </div>
                    {upcoming.length === 0 && <p className="muted">Nenhum vencimento pendente.</p>}
                    <div className="bill-list">
                        {upcoming.map((item) => {
                            const tone = billTone(item);
                            const badge = formatDueBadge(item.dueDate);
                            return (
                                <div className="bill-row" key={`${item.kind}-${item.id}`}>
                                    <span className={`due-badge due-badge--${tone === 'late' ? 'late' : tone === 'soon' ? 'soon' : 'ok'}`}>
                                        {badge.day}
                                        <span>{badge.month}</span>
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="bill-name">{item.name}</div>
                                        <div className="bill-due">{item.categoryName || 'Conta avulsa'}</div>
                                    </div>
                                    <span className={`bill-dot bill-dot--${tone}`} />
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className="card dash-card health-card">
                    <div className="card-head">
                        <h2>Saúde financeira</h2>
                    </div>
                    <RingProgress
                        ratio={health.score / 100}
                        size={128}
                        tone={health.score >= 80 ? 'positive' : health.score >= 60 ? 'brand' : health.score >= 40 ? 'warning' : 'critical'}
                        label={`${health.score}%`}
                        sublabel={health.label}
                    />
                    <div className="health-subbars">
                        <div className="health-subbar-row">
                            <span className="health-subbar-label">Reserva</span>
                            <div className="health-subbar-track">
                                <div className="health-subbar-fill" style={{ width: `${Math.round(health.reserveHealth * 100)}%`, background: 'var(--positive)' }} />
                            </div>
                        </div>
                        <div className="health-subbar-row">
                            <span className="health-subbar-label">Cartões</span>
                            <div className="health-subbar-track">
                                <div className="health-subbar-fill" style={{ width: `${Math.round(health.creditHeadroom * 100)}%`, background: 'var(--accent-blue)' }} />
                            </div>
                        </div>
                        <div className="health-subbar-row">
                            <span className="health-subbar-label">Orçamento</span>
                            <div className="health-subbar-track">
                                <div className="health-subbar-fill" style={{ width: `${Math.round(health.budgetHeadroom * 100)}%`, background: 'var(--warning)' }} />
                            </div>
                        </div>
                    </div>
                    <p className="greeting-sub">
                        {data.debtSummary.count > 0
                            ? `Dívidas em aberto: ${formatCurrency(data.debtSummary.totalBalance, hideValues)} · ${data.debtSummary.count} dívida(s)`
                            : 'Nenhuma dívida em aberto.'}
                    </p>
                </section>
            </div>
        </div>
    );
}
