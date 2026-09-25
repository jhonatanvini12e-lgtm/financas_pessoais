import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import StatCard from '../components/StatCard.jsx';

// Monitoramento das conexoes Open Finance (Pluggy): saude da conexao com o
// banco, dos cartoes sincronizados e historico de execucoes da sync. As
// regras de "ok/atencao/erro" ficam no backend (pluggySyncService), aqui so'
// exibimos.

const POLL_INTERVAL_MS = 60_000;

const LEVEL_LABEL = { ok: 'OK', warning: 'Atencao', error: 'Erro' };
const LEVEL_BADGE = { ok: 'status-connected', warning: 'status-pending', error: 'status-error' };
const TRIGGER_LABEL = { CRON: 'Automatica', MANUAL: 'Manual', LINK: 'Vinculo' };

// SQLite grava CURRENT_TIMESTAMP em UTC sem timezone; a Pluggy manda ISO.
function parseDate(value) {
    if (!value) return null;
    return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

function formatDateTime(value) {
    const d = parseDate(value);
    return d ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function formatRelative(value, now = new Date()) {
    const d = parseDate(value);
    if (!d) return '—';
    const diffMin = Math.round((now - d) / 60_000);
    const future = diffMin < 0;
    const abs = Math.abs(diffMin);
    let text;
    if (abs < 1) text = 'agora';
    else if (abs < 60) text = `${abs} min`;
    else if (abs < 48 * 60) text = `${Math.round(abs / 60)} h`;
    else text = `${Math.round(abs / 1440)} dias`;
    if (text === 'agora') return text;
    return future ? `em ${text}` : `ha ${text}`;
}

function formatDuration(ms) {
    if (ms == null) return '—';
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function LevelBadge({ level }) {
    return <span className={`badge-status ${LEVEL_BADGE[level]}`}>{LEVEL_LABEL[level]}</span>;
}

export default function ConnectionsMonitor() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [checking, setChecking] = useState(false);
    const [syncingLinkId, setSyncingLinkId] = useState(null);

    const load = ({ refresh = false } = {}) =>
        api
            .get(`/pluggy/status${refresh ? '?refresh=1' : ''}`)
            .then((res) => {
                setData(res);
                setError('');
            })
            .catch((err) => setError(err.message));

    useEffect(() => {
        load();
    }, []);
    usePolling(() => load(), [], POLL_INTERVAL_MS);

    const checkNow = async () => {
        setChecking(true);
        setMessage('');
        await load({ refresh: true });
        setChecking(false);
    };

    const syncNow = async (link) => {
        setError('');
        setMessage('');
        setSyncingLinkId(link.id);
        try {
            const { result } = await api.post(`/pluggy/links/${link.id}/sync`);
            setMessage(`${link.card_name}: ${result.inserted} novos, ${result.updated} atualizados, ${result.deleted} removidos.`);
        } catch (err) {
            setError(err.message);
        } finally {
            setSyncingLinkId(null);
            load();
        }
    };

    if (data && !data.configured) {
        return (
            <div className="page">
                <h1>Monitoramento de Conexoes</h1>
                <section className="card">
                    <p className="muted">
                        A integracao com Open Finance (Pluggy) nao esta configurada no servidor. Defina PLUGGY_CLIENT_ID,
                        PLUGGY_CLIENT_SECRET e PLUGGY_ITEM_ID no .env do backend (ver .env.example).
                    </p>
                </section>
            </div>
        );
    }

    const now = new Date();
    const issues = data
        ? [
            ...data.items.flatMap((item) => item.issues.map((i) => ({ ...i, source: `Conexao ${item.connector ?? item.id.slice(0, 8)}` }))),
            ...data.links.flatMap((link) => link.issues.map((i) => ({ ...i, source: link.card_name }))),
        ].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
        : [];
    const runs24h = data?.links.reduce((acc, l) => ({ runs: acc.runs + l.stats24h.runs, errors: acc.errors + l.stats24h.errors }), { runs: 0, errors: 0 });
    const latestBankUpdate = data?.items
        .map((i) => i.lastUpdatedAt)
        .filter(Boolean)
        .sort()
        .at(-1);
    const nextBankUpdate = data?.items
        .map((i) => i.nextAutoSyncAt)
        .filter(Boolean)
        .sort()[0];

    return (
        <div className="page">
            <div className="page-header-row">
                <h1>Monitoramento de Conexoes</h1>
                <button className="btn-primary" onClick={checkNow} disabled={checking}>
                    {checking ? 'Verificando...' : 'Verificar agora'}
                </button>
            </div>
            {error && <div className="error-msg">{error}</div>}
            {message && <p className="budget-alert-ok">{message}</p>}
            {!data && !error && <p className="muted">Carregando...</p>}

            {data && (
                <>
                    <p className="muted">
                        Verificado {formatRelative(data.checkedAt, now)}. Esta pagina se atualiza sozinha a cada minuto.
                    </p>

                    <div className="stat-grid">
                        <StatCard
                            label="Situacao geral"
                            value={LEVEL_LABEL[data.overall]}
                            hint={issues.length ? `${issues.length} ponto(s) de atencao` : 'Tudo funcionando'}
                            tone={data.overall === 'error' ? 'critical' : 'default'}
                        />
                        <StatCard
                            label="Dados do banco atualizados"
                            value={formatRelative(latestBankUpdate, now)}
                            hint={nextBankUpdate ? `Proxima atualizacao pelo Meu Pluggy ${formatRelative(nextBankUpdate, now)}` : undefined}
                        />
                        <StatCard
                            label="Proxima sincronizacao do app"
                            value={data.nextScheduledSyncAt ? formatDateTime(data.nextScheduledSyncAt) : '—'}
                            hint={data.nextScheduledSyncAt ? formatRelative(data.nextScheduledSyncAt, now) : 'Nenhum cartao vinculado'}
                        />
                        <StatCard
                            label="Sincronizacoes nas ultimas 24h"
                            value={`${runs24h.runs - runs24h.errors}/${runs24h.runs}`}
                            hint={runs24h.errors ? `${runs24h.errors} com erro` : 'Nenhuma falha'}
                            tone={runs24h.errors ? 'critical' : 'default'}
                        />
                    </div>

                    <section className="card">
                        <h2>Pontos de atencao</h2>
                        {issues.length === 0 ? (
                            <p className="budget-alert-ok">Nenhum problema encontrado nas conexoes e sincronizacoes.</p>
                        ) : (
                            <ul className="simple-list">
                                {issues.map((issue, idx) => (
                                    <li key={idx} className={`alert-item ${issue.level === 'error' ? 'alert-critical' : 'alert-warning'}`}>
                                        <strong>{issue.source}:</strong> {issue.message}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section className="card">
                        <h2>Conexoes com o banco</h2>
                        <p className="muted">
                            Situacao da conexao do Meu Pluggy com o banco. Problemas aqui (consentimento vencido, erro de
                            login) se resolvem reconectando em meu.pluggy.ai.
                        </p>
                        <div className="table-scroll">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Conexao</th><th>Saude</th><th>Status na Pluggy</th><th>Dados atualizados</th>
                                        <th>Proxima atualizacao</th><th>Consentimento expira</th><th>Resposta da API</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.items.map((item) => (
                                        <tr key={item.id}>
                                            <td>{item.connector ?? '—'}<div className="muted">{item.id.slice(0, 8)}</div></td>
                                            <td><LevelBadge level={item.level} /></td>
                                            <td>{item.status ? `${item.status} / ${item.executionStatus}` : '—'}</td>
                                            <td>{formatDateTime(item.lastUpdatedAt)}<div className="muted">{formatRelative(item.lastUpdatedAt, now)}</div></td>
                                            <td>{formatDateTime(item.nextAutoSyncAt)}</td>
                                            <td>{formatDateTime(item.consentExpiresAt)}</td>
                                            <td>{formatDuration(item.latencyMs)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section className="card">
                        <h2>Cartoes sincronizados</h2>
                        {data.links.length === 0 ? (
                            <p className="muted">
                                Nenhum cartao vinculado. <Link to="/accounts">Vincule em Contas e Cartoes</Link>.
                            </p>
                        ) : (
                            <div className="table-scroll">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Cartao</th><th>Saude</th><th>Ultima sincronizacao</th><th>Resultado</th>
                                            <th>Ultimas 24h</th><th>Sincroniza desde</th><th />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.links.map((link) => (
                                            <tr key={link.id}>
                                                <td>{link.card_name}</td>
                                                <td><LevelBadge level={link.level} /></td>
                                                <td>{formatDateTime(link.last_sync_at)}<div className="muted">{formatRelative(link.last_sync_at, now)}</div></td>
                                                <td>
                                                    {link.last_sync_summary
                                                        ? `${link.last_sync_summary.inserted} novos, ${link.last_sync_summary.updated} atualizados, ${link.last_sync_summary.deleted} removidos`
                                                        : link.last_sync_status === 'ERROR' ? 'Falhou' : '—'}
                                                </td>
                                                <td>
                                                    {link.stats24h.runs} execucoes, {link.stats24h.errors} com erro
                                                    <div className="muted">media {formatDuration(link.stats24h.avgDurationMs)}</div>
                                                </td>
                                                <td>{link.sync_from.split('-').reverse().join('/')}</td>
                                                <td>
                                                    <button className="btn-link" disabled={syncingLinkId === link.id} onClick={() => syncNow(link)}>
                                                        {syncingLinkId === link.id ? 'sincronizando...' : 'sincronizar agora'}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>

                    <section className="card">
                        <h2>Historico de sincronizacoes</h2>
                        {data.runs.length === 0 ? (
                            <p className="muted">Nenhuma sincronizacao registrada ainda.</p>
                        ) : (
                            <div className="table-scroll">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Quando</th><th>Cartao</th><th>Origem</th><th>Status</th><th>Duracao</th>
                                            <th>Lidos no banco</th><th>Novos</th><th>Atualizados</th><th>Removidos</th><th>Faturas</th><th>Detalhe</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.runs.map((run) => (
                                            <tr key={run.id}>
                                                <td>{formatDateTime(run.started_at)}</td>
                                                <td>{run.card_name}</td>
                                                <td>{TRIGGER_LABEL[run.trigger]}</td>
                                                <td><LevelBadge level={run.status === 'OK' ? 'ok' : 'error'} /></td>
                                                <td>{formatDuration(run.duration_ms)}</td>
                                                <td>{run.remote_count ?? '—'}</td>
                                                <td>{run.inserted}</td>
                                                <td>{run.updated}</td>
                                                <td>{run.deleted}</td>
                                                <td>{run.bills_registered}</td>
                                                <td className="muted">{run.message || ''}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </>
            )}
        </div>
    );
}
