import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function Alerts() {
    const [alerts, setAlerts] = useState([]);
    const [error, setError] = useState('');

    const load = () => { api.get('/alerts').then(setAlerts).catch((err) => setError(err.message)); };
    useEffect(load, []);

    const markRead = async (id) => {
        await api.patch(`/alerts/${id}/read`);
        load();
    };

    const remove = async (id) => {
        await api.delete(`/alerts/${id}`);
        load();
    };

    return (
        <div className="page">
            <h1>Alertas</h1>
            {error && <div className="error-msg">{error}</div>}

            <section className="card">
                <ul className="simple-list">
                    {alerts.map((alert) => (
                        <li key={alert.id} className={`alert-item alert-${alert.severity?.toLowerCase()}`}>
                            <span>{alert.message}</span>
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
