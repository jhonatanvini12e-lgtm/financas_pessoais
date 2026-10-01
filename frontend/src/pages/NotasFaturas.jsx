import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { usePolling } from '../hooks/usePolling.js';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { formatCurrency } from '../utils/currency.js';

const BILL_STATUS_LABEL = { OPEN: 'A vencer', LATE: 'Vencida' };
const BILL_STATUS_CLASS = { OPEN: 'status-pending', LATE: 'status-late' };
const SOURCE_LABEL = { xml: 'XML', key: 'Chave', pdf: 'PDF' };

function formatDate(iso) {
    if (!iso) return '-';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
}

export default function NotasFaturas() {
    const [tab, setTab] = useState('faturas');
    const { hideValues } = usePrivacy();

    return (
        <div className="page">
            <h1>Notas e Faturas</h1>

            <div className="segmented-tabs">
                <button className={tab === 'faturas' ? 'active' : ''} onClick={() => setTab('faturas')}>Faturas</button>
                <button className={tab === 'notas' ? 'active' : ''} onClick={() => setTab('notas')}>Notas fiscais</button>
            </div>

            {tab === 'faturas' ? <FaturasTab hideValues={hideValues} /> : <NotasTab hideValues={hideValues} />}
        </div>
    );
}

// Faturas de cartao fechadas vindas da Pluggy (Open Finance). Leitura em tempo
// real -- nenhum cadastro aqui, so o que o banco ja informou.
function FaturasTab({ hideValues }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const load = ({ silent = false } = {}) => {
        api.get('/pluggy/bills')
            .then(setData)
            .catch((err) => { if (!silent) setError(err.message); });
    };
    useEffect(load, []);
    usePolling(() => load({ silent: true }), []);

    if (!data) return <>{error && <div className="error-msg">{error}</div>}<p className="muted">Carregando faturas...</p></>;

    if (!data.configured) {
        return (
            <section className="card">
                <p className="muted">
                    O Open Finance (Pluggy) nao esta configurado no servidor. Conecte seus cartoes em{' '}
                    <strong>Conexoes Open Finance</strong> para que as faturas apareçam aqui automaticamente.
                </p>
            </section>
        );
    }

    return (
        <>
            {error && <div className="error-msg">{error}</div>}
            <div className="stat-grid">
                <div className="card"><h3>Faturas encontradas</h3><p>{data.bills.length}</p></div>
                <div className="card"><h3>Vencidas</h3><p>{data.bills.filter((b) => b.status === 'LATE').length}</p></div>
            </div>

            <section className="card">
                <div className="table-scroll">
                    <table className="data-table">
                        <thead>
                            <tr><th>Cartao</th><th>Vencimento</th><th>Valor total</th><th>Pagamento minimo</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                            {data.bills.map((bill) => (
                                <tr key={bill.id}>
                                    <td>{bill.accountName}</td>
                                    <td>{formatDate(bill.dueDate)}</td>
                                    <td>{formatCurrency(bill.totalAmount, hideValues)}</td>
                                    <td>{bill.minimumPayment != null ? formatCurrency(bill.minimumPayment, hideValues) : '-'}</td>
                                    <td><span className={`badge-status ${BILL_STATUS_CLASS[bill.status]}`}>{BILL_STATUS_LABEL[bill.status]}</span></td>
                                </tr>
                            ))}
                            {data.bills.length === 0 && (
                                <tr><td colSpan={5}>Nenhuma fatura encontrada nas conexoes Open Finance.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </>
    );
}

// Notas fiscais que o usuario importa (upload de XML ou cadastro da chave).
function NotasTab({ hideValues }) {
    const [notes, setNotes] = useState(null);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [accessKey, setAccessKey] = useState('');
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef(null);

    const load = ({ silent = false } = {}) => {
        api.get('/fiscal-notes')
            .then(setNotes)
            .catch((err) => { if (!silent) setError(err.message); });
    };
    useEffect(load, []);
    usePolling(() => load({ silent: true }), []);

    const feedback = (msg) => { setInfo(msg); setError(''); };

    const uploadXml = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setError('');
        setInfo('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const note = await api.postForm('/fiscal-notes/upload', formData);
            feedback(`Nota de ${note.issuer_name || 'emissor desconhecido'} importada.`);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const addByKey = async (e) => {
        e.preventDefault();
        setError('');
        setInfo('');
        try {
            await api.post('/fiscal-notes/by-key', { access_key: accessKey });
            setAccessKey('');
            feedback('Chave cadastrada. Anexe o XML depois para preencher os detalhes.');
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    const remove = async (id) => {
        try {
            await api.delete(`/fiscal-notes/${id}`);
            load();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <>
            {error && <div className="error-msg">{error}</div>}
            {info && <div className="info-msg">{info}</div>}

            <p className="muted">
                Nao existe uma API que puxe todas as notas fiscais de um CPF automaticamente -- cada nota fica na SEFAZ do
                estado. Aqui voce importa o <strong>XML</strong> da nota (o arquivo que chega por e-mail) ou cadastra a{' '}
                <strong>chave de acesso</strong> de 44 digitos que fica no rodape / QR Code do cupom.
            </p>

            <div className="form-grid-2">
                <section className="card">
                    <h2>Importar XML</h2>
                    <input ref={fileRef} type="file" accept=".xml,text/xml,application/xml" onChange={uploadXml} disabled={uploading} />
                    {uploading && <p className="muted">Lendo nota...</p>}
                </section>

                <section className="card">
                    <h2>Cadastrar por chave de acesso</h2>
                    <form onSubmit={addByKey} className="inline-form">
                        <input
                            placeholder="44 digitos da chave de acesso"
                            value={accessKey}
                            onChange={(e) => setAccessKey(e.target.value)}
                            inputMode="numeric"
                            required
                        />
                        <button type="submit" className="btn-primary">Cadastrar</button>
                    </form>
                </section>
            </div>

            <section className="card">
                <div className="table-scroll">
                    <table className="data-table">
                        <thead>
                            <tr><th>Emissor</th><th>Numero</th><th>Emissao</th><th>Valor</th><th>Destinatario (CPF)</th><th>Origem</th><th /></tr>
                        </thead>
                        <tbody>
                            {(notes || []).map((note) => (
                                <tr key={note.id}>
                                    <td>{note.issuer_name || <span className="muted">(so chave)</span>}</td>
                                    <td>{note.number ? `${note.number}${note.series ? `/${note.series}` : ''}` : '-'}</td>
                                    <td>{formatDate(note.issue_date)}</td>
                                    <td>{note.total_amount != null ? formatCurrency(note.total_amount, hideValues) : '-'}</td>
                                    <td>{note.recipient_cpf || '-'}</td>
                                    <td>{SOURCE_LABEL[note.source] || note.source}</td>
                                    <td><button className="btn-link" onClick={() => remove(note.id)}>remover</button></td>
                                </tr>
                            ))}
                            {notes && notes.length === 0 && (
                                <tr><td colSpan={7}>Nenhuma nota importada ainda.</td></tr>
                            )}
                            {!notes && (
                                <tr><td colSpan={7}>Carregando...</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </>
    );
}
