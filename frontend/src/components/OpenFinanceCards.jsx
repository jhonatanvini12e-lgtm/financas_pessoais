import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { PROVIDERS } from '../constants/providers.js';

// Cartoes vindos do Open Finance (Pluggy / Meu Pluggy): vincula cada cartao
// do banco a um cartao local e sincroniza lancamentos e faturas. A sync
// automatica roda no servidor a cada 6h (ver backend/src/cron); aqui so' ha
// vincular, sincronizar sob demanda e desvincular.

const NEW_CARD = 'new';

function formatSyncDate(value) {
    if (!value) return 'Nunca';
    return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('pt-BR');
}

function summaryText(summary) {
    if (!summary) return '';
    return `${summary.inserted} novos, ${summary.updated} atualizados, ${summary.deleted} removidos`;
}

function LinkForm({ account, cards, members, defaultSyncFrom, onCancel, onLinked }) {
    const [destination, setDestination] = useState(NEW_CARD);
    const [newCard, setNewCard] = useState({
        card_name: account.suggestedCard.card_name,
        credit_limit: account.suggestedCard.credit_limit ?? '',
        closing_day: account.suggestedCard.closing_day ?? '',
        due_day: account.suggestedCard.due_day ?? '',
        provider: 'outro',
    });
    const [createdBy, setCreatedBy] = useState('');
    const [syncFrom, setSyncFrom] = useState(defaultSyncFrom);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Cartao existente: sugere comecar no dia seguinte ao ultimo lancamento
    // que ele ja tem (importado por arquivo ou lancado a mao), para nao duplicar.
    const chooseDestination = (value) => {
        setDestination(value);
        const card = cards.find((c) => String(c.id) === value);
        setSyncFrom(card?.suggested_sync_from || defaultSyncFrom);
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
                ...(destination === NEW_CARD
                    ? {
                        new_card: {
                            ...newCard,
                            credit_limit: Number(newCard.credit_limit) || null,
                            closing_day: Number(newCard.closing_day),
                            due_day: Number(newCard.due_day),
                        },
                    }
                    : { card_id: Number(destination) }),
            };
            const { syncError } = await api.post('/pluggy/links', body);
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
                    <option value={NEW_CARD}>Criar novo cartao</option>
                    {cards.map((c) => <option key={c.id} value={c.id}>{c.card_name}</option>)}
                </select>
                <select value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} required>
                    <option value="">Titular do cartao...</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.username}</option>)}
                </select>
            </div>

            {destination === NEW_CARD && (
                <div className="inline-form">
                    <input placeholder="Nome do cartao" value={newCard.card_name}
                        onChange={(e) => setNewCard({ ...newCard, card_name: e.target.value })} required />
                    <input placeholder="Limite" type="number" step="0.01" value={newCard.credit_limit}
                        onChange={(e) => setNewCard({ ...newCard, credit_limit: e.target.value })} />
                    <input placeholder="Dia fechamento" type="number" min="1" max="31" value={newCard.closing_day}
                        onChange={(e) => setNewCard({ ...newCard, closing_day: e.target.value })} required />
                    <input placeholder="Dia vencimento" type="number" min="1" max="31" value={newCard.due_day}
                        onChange={(e) => setNewCard({ ...newCard, due_day: e.target.value })} required />
                    <select value={newCard.provider} onChange={(e) => setNewCard({ ...newCard, provider: e.target.value })}>
                        {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                </div>
            )}
            {destination === NEW_CARD && account.suggestedCard.closing_day && (
                <p className="muted">
                    Fechamento e vencimento sugeridos a partir das faturas do banco. O dia de fechamento e o ultimo dia
                    de compras que entram na fatura.
                </p>
            )}

            <div className="inline-form">
                <label className="muted" htmlFor={`sync-from-${account.id}`}>Sincronizar lancamentos a partir de</label>
                <input id={`sync-from-${account.id}`} type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} required />
            </div>
            <p className="muted">
                Lancamentos anteriores a essa data nao sao alterados. Se voce ja importou faturas deste cartao por arquivo,
                comece depois da ultima importada para nao duplicar.
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

export default function OpenFinanceCards({ onChange }) {
    const [data, setData] = useState(null);
    const [members, setMembers] = useState([]);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [linkingAccountId, setLinkingAccountId] = useState(null);
    const [syncingLinkId, setSyncingLinkId] = useState(null);

    const load = () => {
        api.get('/pluggy/accounts').then(setData).catch((err) => setError(err.message));
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
        setError(syncError ? `Cartao vinculado, mas a primeira sincronizacao falhou: ${syncError}` : '');
        setMessage(syncError ? '' : 'Cartao vinculado e sincronizado.');
        afterChange();
    };

    const syncNow = async (link) => {
        setError('');
        setMessage('');
        setSyncingLinkId(link.id);
        try {
            const { result } = await api.post(`/pluggy/links/${link.id}/sync`);
            setMessage(`${link.card_name}: ${summaryText(result)}.`);
            afterChange();
        } catch (err) {
            setError(err.message);
            load();
        } finally {
            setSyncingLinkId(null);
        }
    };

    const unlink = async (link) => {
        if (!window.confirm(`Desvincular "${link.card_name}"? Os lancamentos ja sincronizados continuam no cartao, so param de ser atualizados.`)) return;
        setError('');
        try {
            await api.delete(`/pluggy/links/${link.id}`);
            afterChange();
        } catch (err) {
            setError(err.message);
        }
    };

    if (data && !data.configured) return null;

    const linkedCardIds = new Set((data?.accounts || []).filter((a) => a.link).map((a) => a.link.card_id));
    const availableCards = (data?.cards || []).filter((c) => !linkedCardIds.has(c.id));
    const linkingAccount = data?.accounts.find((a) => a.id === linkingAccountId);

    return (
        <section className="card">
            <h2>Cartoes via Open Finance</h2>
            <p className="muted">
                Conectados pelo Meu Pluggy. Lancamentos, parcelas e faturas sao sincronizados automaticamente a cada 6 horas.
            </p>
            {error && <div className="error-msg">{error}</div>}
            {message && <p className="budget-alert-ok">{message}</p>}

            {!data && !error && <p className="muted">Carregando cartoes do banco...</p>}

            {data && (
                <div className="table-scroll">
                    <table className="data-table">
                        <thead>
                            <tr><th>Cartao no banco</th><th>Vinculado a</th><th>Ultima sincronizacao</th><th /></tr>
                        </thead>
                        <tbody>
                            {data.accounts.map((a) => (
                                <tr key={a.id}>
                                    <td>{a.name} final {a.number}</td>
                                    <td>{a.link ? a.link.card_name : <span className="badge-status status-disconnected">Nao vinculado</span>}</td>
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
                    cards={availableCards}
                    members={members}
                    defaultSyncFrom={data.default_sync_from}
                    onCancel={() => setLinkingAccountId(null)}
                    onLinked={onLinked}
                />
            )}
        </section>
    );
}
