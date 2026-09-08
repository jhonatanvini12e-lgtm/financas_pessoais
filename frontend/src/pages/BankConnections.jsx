import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

const LABELS = { nubank: 'Nubank', inter: 'Inter', santander: 'Santander', mercadopago: 'Mercado Pago' };

export default function BankConnections() {
    const [connections, setConnections] = useState([]);
    const [syncing, setSyncing] = useState(null);
    const [error, setError] = useState('');

    const load = () => { api.get('/banks/connections').then(setConnections).catch((err) => setError(err.message)); };

    useEffect(load, []);

    const sync = async (provider) => {
        setSyncing(provider);
        setError('');
        try {
            const result = await api.post(`/banks/connections/${provider}/sync`);
            if (result.status === 'ERROR') setError(`Falha ao sincronizar ${LABELS[provider]}: ${result.error}`);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSyncing(null);
        }
    };

    return (
        <div className="page">
            <h1>Conexoes Open Finance</h1>
            <p className="muted">
                Integracao simulada (mock) enquanto nao ha credenciamento com um agregador Open Finance certificado
                (ex: Pluggy/Belvo). A arquitetura ja esta pronta para plugar um provider real.
            </p>
            {error && <div className="error-msg">{error}</div>}

            <div className="stat-grid">
                {connections.map((conn) => (
                    <div key={conn.provider} className="card connection-card">
                        <h3>{LABELS[conn.provider] || conn.provider}</h3>
                        <span className={`badge-status status-${conn.status.toLowerCase()}`}>{conn.status}</span>
                        {conn.last_sync_at && <p className="muted">Ultimo sync: {conn.last_sync_at}</p>}
                        {conn.last_error && <p className="error-msg">{conn.last_error}</p>}
                        <button className="btn-primary" disabled={syncing === conn.provider} onClick={() => sync(conn.provider)}>
                            {syncing === conn.provider ? 'Sincronizando...' : 'Sincronizar agora'}
                        </button>
                    </div>
                ))}
            </div>

            <section className="card">
                <h2>Plano de contingencia</h2>
                <p>Se o Open Finance falhar, use o assistente guiado de importacao manual de extratos (.ofx, .csv ou .xlsx).</p>
                <Link className="btn-primary" to="/ofx-import" style={{ marginTop: 12 }}>Abrir assistente de importacao OFX</Link>
            </section>
        </div>
    );
}
