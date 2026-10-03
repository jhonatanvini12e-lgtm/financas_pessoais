import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { PROVIDERS } from '../constants/providers.js';

// Contas correntes/poupanca vindas do Open Finance (Pluggy / Meu Pluggy):
// vincula cada conta do banco a uma conta local e sincroniza os lancamentos
// (dinheiro entrando e saindo). A sync automatica roda no servidor a cada 6h
// (ver backend/src/cron), junto com a dos cartoes.

const NEW_ACCOUNT = 'new';

function formatSyncDate(value) {
    if (!value) return 'Nunca';
    return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('pt-BR');
}

function summaryText(summary) {
    if (!summary) return '';
    return `${summary.inserted} novos, ${summary.updated} atualizados, ${summary.deleted} removidos`;
}

function LinkForm({ account, accounts, members, defaultSyncFrom, onCancel, onLinked }) {
    const [destination, setDestination] = useState(NEW_ACCOUNT);
    const [newAccount, setNewAccount] = useState({ bank_name: account.suggestedAccount.bank_name, provider: 'outro' });
    const [createdBy, setCreatedBy] = useState('');
    const [syncFrom, setSyncFrom] = useState(defaultSyncFrom);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Conta existente: sugere comecar no dia seguinte ao ultimo lancamento
    // que ela ja tem (importado por arquivo ou lancado a mao), para nao duplicar.
    const chooseDestination = (value) => {
        setDestination(value);
        const acc = accounts.find((a) => String(a.id) === value);
        setSyncFrom(acc?.suggested_sync_from || defaultSyncFrom);
    };

    const submit = async (e) => {
        e.preventDefault();
        setError('');
        setSaving(true);
        try {
            const body = {
                pluggy_account_id: account.id,
                created_by: Number(createdBy),
                sync_from: syncFrom,
                ...(destination === NEW_ACCOUNT ? { new_account: newAccount } : { account_id: Number(destination) }),
            };
            const { syncError } = await api.post('/pluggy/bank-links', body);
            onLinked(syncError);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={submit} className="connection-card">
            <h3>Vincular {account.name} final {account.number}</h3>
            {error && <div className="error-msg">{error}</div>}

            <div className="inline-form">
                <select value={destination} onChange={(e) => chooseDestination(e.target.value)}>
                    <option value={NEW_ACCOUNT}>Criar nova conta</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.bank_name}</option>)}
                </select>
                <select value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} required>
                    <option value="">Titular da conta...</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.username}</option>)}
                </select>
            </div>

            {destination === NEW_ACCOUNT && (
                <div className="inline-form">
                    <input placeholder="Nome do banco" value={newAccount.bank_name}
                        onChange={(e) => setNewAccount({ ...newAccount, bank_name: e.target.value })} required />
                    <select value={newAccount.provider} onChange={(e) => setNewAccount({ ...newAccount, provider: e.target.value })}>
                        {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                </div>
            )}

            <div className="inline-form">
                <label className="muted" htmlFor={`sync-from-${account.id}`}>Sincronizar lancamentos a partir de</label>
                <input id={`sync-from-${account.id}`} type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} required />
            </div>
            <p className="muted">
                Lancamentos anteriores a essa data nao sao alterados. Se voce ja importou extratos desta conta por arquivo,
                comece depois do ultimo importado para nao duplicar.
            </p>

            <div className="wizard-actions">
                <button type="button" className="btn-link" onClick={onCancel}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving || !createdBy}>
                    {saving ? 'Vinculando e sincronizando...' : 'Vincular e sincronizar'}
                </button>
            </div>
        </form>
    );
}

export default function OpenFinanceAccounts({ onChange }) {
    const [data, setData] = useState(null);
    const [members, setMembers] = useState([]);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [linkingAccountId, setLinkingAccountId] = useState(null);
    const [syncingLinkId, setSyncingLinkId] = useState(null);

    const load = () => {
        api.get('/pluggy/bank-accounts').then(setData).catch((err) => setError(err.message));
    };

    useEffect(load, []);
    useEffect(() => {
        api.get('/auth/household-members').then(setMembers).catch(() => {});
    }, []);

    const afterChange = () => {
        load();
        onChange?.();
    };

    const onLinked = (syncError) => {
        setLinkingAccountId(null);
        setError(syncError ? `Conta vinculada, mas a primeira sincronizacao falhou: ${syncError}` : '');
        setMessage(syncError ? '' : 'Conta vinculada e sincronizada.');
        afterChange();
    };

    const syncNow = async (link) => {
        setError('');
        setMessage('');
        setSyncingLinkId(link.id);
        try {
            const { result } = await api.post(`/pluggy/bank-links/${link.id}/sync`);
            setMessage(`${link.bank_name}: ${summaryText(result)}.`);
            afterChange();
        } catch (err) {
            setError(err.message);
            load();
        } finally {
            setSyncingLinkId(null);
        }
    };

    const unlink = async (link) => {
        if (!window.confirm(`Desvincular "${link.bank_name}"? Os lancamentos ja sincronizados continuam na conta, so param de ser atualizados.`)) return;
        setError('');
        try {
            await api.delete(`/pluggy/bank-links/${link.id}`);
            afterChange();
        } catch (err) {
            setError(err.message);
        }
    };

    if (data && !data.configured) return null;

    const linkedAccountIds = new Set((data?.accounts || []).filter((a) => a.link).map((a) => a.link.account_id));
    const availableAccounts = (data?.localAccounts || []).filter((a) => !linkedAccountIds.has(a.id));
    const linkingAccount = data?.accounts.find((a) => a.id === linkingAccountId);

    return (
        <section className="card">
            <h2>Contas bancarias via Open Finance</h2>
            <p className="muted">
                Conectadas pelo Meu Pluggy. Lancamentos (entradas e saidas) sao sincronizados automaticamente a cada 6 horas.{' '}
                <Link to="/connections">Ver monitoramento das conexoes</Link>.
            </p>
            {error && <div className="error-msg">{error}</div>}
            {message && <p className="budget-alert-ok">{message}</p>}

            {!data && !error && <p className="muted">Carregando contas do banco...</p>}

            {data && (
                <div className="table-scroll">
                    <table className="data-table">
                        <thead>
                            <tr><th>Conta no banco</th><th>Vinculada a</th><th>Ultima sincronizacao</th><th /></tr>
                        </thead>
                        <tbody>
                            {data.accounts.map((a) => (
                                <tr key={a.id}>
                                    <td>{a.name} final {a.number}</td>
                                    <td>{a.link ? a.link.bank_name : <span className="badge-status status-disconnected">Nao vinculada</span>}</td>
                                    <td>
                                        {a.link && (
                                            <>
                                                <span className={`badge-status ${a.link.last_sync_status === 'ERROR' ? 'status-error' : 'status-connected'}`}>
                                                    {a.link.last_sync_status === 'ERROR' ? 'Erro' : 'OK'}
                                                </span>{' '}
                                                {formatSyncDate(a.link.last_sync_at)}
                                                {a.link.last_sync_status === 'ERROR' && <div className="muted">{a.link.last_sync_message}</div>}
                                                {a.link.last_sync_summary && <div className="muted">{summaryText(a.link.last_sync_summary)}</div>}
                                            </>
                                        )}
                                    </td>
                                    <td>
                                        <div className="row-actions">
                                            {a.link ? (
                                                <>
                                                    <button className="btn-link" disabled={syncingLinkId === a.link.id} onClick={() => syncNow(a.link)}>
                                                        {syncingLinkId === a.link.id ? 'sincronizando...' : 'sincronizar agora'}
                                                    </button>
                                                    <button className="btn-link" onClick={() => unlink(a.link)}>desvincular</button>
                                                </>
                                            ) : (
                                                <button className="btn-link" onClick={() => setLinkingAccountId(a.id)}>vincular</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {linkingAccount && (
                <LinkForm
                    key={linkingAccount.id}
                    account={linkingAccount}
                    accounts={availableAccounts}
                    members={members}
                    defaultSyncFrom={data.default_sync_from}
                    onCancel={() => setLinkingAccountId(null)}
                    onLinked={onLinked}
                />
            )}
        </section>
    );
}
