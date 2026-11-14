import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function Alerts() {
    const [alerts, setAlerts] = useState([]);
    const [selected, setSelected] = useState(new Set());
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');

    const load = () => {
        api.get('/alerts')
            .then((data) => {
                setAlerts(data);
                // Descarta selecoes de alertas que nao existem mais
                setSelected((prev) => new Set(data.filter((a) => prev.has(a.id)).map((a) => a.id)));
            })
            .catch((err) => setError(err.message));
    };
    useEffect(load, []);

    const markRead = async (id) => {
        await api.patch(`/alerts/${id}/read`);
        load();
    };

    const remove = async (id) => {
        await api.delete(`/alerts/${id}`);
        load();
    };

    const allSelected = alerts.length > 0 && selected.size === alerts.length;

    const toggleOne = (id) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleAll = () => {
        setSelected(allSelected ? new Set() : new Set(alerts.map((a) => a.id)));
    };

    const removeSelected = async () => {
        if (selected.size === 0) return;
        if (!window.confirm(`Excluir ${selected.size} alerta(s) selecionado(s)?`)) return;
        setDeleting(true);
        setError('');
        try {
            await api.post('/alerts/bulk-delete', { ids: [...selected] });
            setSelected(new Set());
        } catch (err) {
            setError(err.message);
        } finally {
            setDeleting(false);
            load();
        }
    };

    return (
        <div className="page">
            <h1>Alertas</h1>
            {error && <div className="error-msg">{error}</div>}

            <section className="card">
                {alerts.length > 0 && (
                    <div className="alerts-toolbar">
                        <label>
                            <input
                                type="checkbox"
                                checked={allSelected}
                                ref={(el) => { if (el) el.indeterminate = selected.size > 0 && !allSelected; }}
                                onChange={toggleAll}
                            />
                            {selected.size > 0 ? `${selected.size} selecionado(s)` : 'Selecionar todos'}
                        </label>
                        <button
                            className="btn-link btn-danger-link"
                            onClick={removeSelected}
                            disabled={selected.size === 0 || deleting}
                        >
                            {deleting ? 'excluindo...' : 'excluir selecionados'}
                        </button>
                    </div>
                )}
                <ul className="simple-list">
                    {alerts.map((alert) => (
                        <li key={alert.id} className={`alert-item alert-${alert.severity?.toLowerCase()}`}>
                            <input
                                type="checkbox"
                                checked={selected.has(alert.id)}
                                onChange={() => toggleOne(alert.id)}
                                aria-label="Selecionar alerta"
                            />
                            <span className="alert-message">{alert.message}</span>
                            <span className="muted"> — {alert.created_at}</span>
                            {!alert.read && (
                                <button className="btn-link" onClick={() => markRead(alert.id)}>marcar como lido</button>
                            )}
                            <button className="btn-link" onClick={() => remove(alert.id)}>excluir</button>
                        </li>
                    ))}
                    {alerts.length === 0 && <p className="muted">Nenhum alerta registrado.</p>}
                </ul>
            </section>
        </div>
    );
}
