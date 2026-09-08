import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import ProgressBar from '../components/ProgressBar.jsx';

export default function Budget() {
    const [status, setStatus] = useState(null);
    const [params, setParams] = useState(null);
    const [error, setError] = useState('');
    const [detail, setDetail] = useState(null);

    useEffect(() => {
        api.get('/budget/status').then(setStatus).catch((err) => setError(err.message));
        api.get('/budget/params').then(setParams).catch(() => {});
    }, []);

    const categoryNameById = useMemo(() => {
        const map = new Map();
        (status?.categories || []).forEach((cat) => {
            if (cat.categoryId != null) map.set(cat.categoryId, cat.name);
        });
        return map;
    }, [status]);

    const openDetail = async (title, { categoryId, uncategorized, group } = {}) => {
        setDetail({ title, loading: true, error: '', items: [] });
        try {
            const query = new URLSearchParams({ start: status.period.start, end: status.period.end });
            if (categoryId != null) query.set('category_id', categoryId);
            const transactions = await api.get(`/transactions?${query}`);
            const fixedNames = new Set(params?.fixedCostCategoryNames || []);

            const items = transactions
                .filter((t) => t.amount < 0)
                .filter((t) => (uncategorized ? t.category_id == null : true))
                .filter((t) => {
                    if (group == null) return true;
                    const isFixed = fixedNames.has(categoryNameById.get(t.category_id));
                    return group === 'fixed' ? isFixed : !isFixed;
                })
                .sort((a, b) => (a.date < b.date ? 1 : -1));

            setDetail({ title, loading: false, error: '', items });
        } catch (err) {
            setDetail({ title, loading: false, error: err.message, items: [] });
        }
    };

    const openCategoryDetail = (cat) => {
        openDetail(cat.name, cat.categoryId == null ? { uncategorized: true } : { categoryId: cat.categoryId });
    };

    const closeDetail = () => setDetail(null);

    if (error) return <div className="error-msg">{error}</div>;
    if (!status) return <p>Carregando...</p>;

    return (
        <div className="page">
            <h1>Orcamento</h1>
            <p className="muted">Periodo: {status.period.start} a {status.period.end}</p>

            <div className="two-col">
                <section className="card">
                    <div className="budget-row-header">
                        <h2>Custos fixos</h2>
                        <button type="button" className="btn-icon" title="Ver gastos" aria-label="Ver gastos de custos fixos"
                            onClick={() => openDetail('Custos fixos', { group: 'fixed' })}>
                            🔍
                        </button>
                    </div>
                    <ProgressBar ratio={status.fixed.ratio} label={`R$ ${status.fixed.spent.toFixed(2)} de R$ ${status.fixed.ceiling.toFixed(2)}`} />
                </section>
                <section className="card">
                    <div className="budget-row-header">
                        <h2>Custos variaveis</h2>
                        <button type="button" className="btn-icon" title="Ver gastos" aria-label="Ver gastos de custos variaveis"
                            onClick={() => openDetail('Custos variaveis', { group: 'variable' })}>
                            🔍
                        </button>
                    </div>
                    <ProgressBar ratio={status.variable.ratio} label={`R$ ${status.variable.spent.toFixed(2)} de R$ ${status.variable.ceiling.toFixed(2)}`} />
                </section>
            </div>

            <section className="card">
                <h2>Por categoria</h2>
                {status.categories.map((cat) => (
                    <div key={cat.categoryId ?? 'none'} className={`budget-category-row ${cat.level !== 'OK' ? `budget-alert-${cat.level.toLowerCase()}` : ''}`}>
                        <ProgressBar ratio={cat.ratio} label={`${cat.name} — R$ ${cat.spent.toFixed(2)} de R$ ${cat.limit.toFixed(2)}`} />
                        <button type="button" className="btn-icon" title="Ver gastos" aria-label={`Ver gastos de ${cat.name}`}
                            onClick={() => openCategoryDetail(cat)}>
                            🔍
                        </button>
                    </div>
                ))}
            </section>

            {params && (
                <section className="card">
                    <h2>Parametros configurados (arquivo de parametros do backend)</h2>
                    <ul className="simple-list">
                        <li>Alerta de orcamento: {(params.budgetWarningThreshold * 100).toFixed(0)}% / {(params.budgetCriticalThreshold * 100).toFixed(0)}%</li>
                        <li>Alerta de uso de credito global: {(params.cardGlobalUsageAlertThreshold * 100).toFixed(0)}%</li>
                        <li>Antecedencia de alerta de fatura: {params.cardDueDateWarningDays} dias</li>
                        <li>Meta de Fundo de Emergencia: {params.emergencyFundTargetMonths}x despesas mensais</li>
                    </ul>
                </section>
            )}

            {detail && (
                <div className="modal-overlay" onClick={closeDetail}>
                    <div className="glass-panel budget-detail-panel" onClick={(e) => e.stopPropagation()}>
                        <div className="budget-detail-header">
                            <h2>{detail.title}</h2>
                            <button type="button" className="btn-icon" title="Fechar" aria-label="Fechar" onClick={closeDetail}>✕</button>
                        </div>

                        {detail.loading && <p className="muted">Carregando...</p>}
                        {detail.error && <div className="error-msg">{detail.error}</div>}

                        {!detail.loading && !detail.error && (
                            detail.items.length === 0 ? (
                                <p className="muted">Nenhum gasto encontrado neste periodo.</p>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr><th>Data</th><th>Descricao</th><th>Valor</th></tr>
                                    </thead>
                                    <tbody>
                                        {detail.items.map((t) => (
                                            <tr key={t.id}>
                                                <td>{t.date}</td>
                                                <td>{t.description || '-'}</td>
                                                <td className="text-negative">R$ {Math.abs(t.amount).toFixed(2)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
