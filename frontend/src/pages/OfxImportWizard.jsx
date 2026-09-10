import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import PdfPasswordModal from '../components/PdfPasswordModal.jsx';

export default function OfxImportWizard() {
    const [step, setStep] = useState(1);
    const [destinationType, setDestinationType] = useState('account');
    const [destinationId, setDestinationId] = useState('');
    const [accounts, setAccounts] = useState([]);
    const [cards, setCards] = useState([]);
    const [categories, setCategories] = useState([]);
    const [file, setFile] = useState(null);
    const [previewFilename, setPreviewFilename] = useState('');
    const [previewWarnings, setPreviewWarnings] = useState([]);
    const [rows, setRows] = useState([]);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [pdfPasswordError, setPdfPasswordError] = useState('');
    const [needsPdfPassword, setNeedsPdfPassword] = useState(false);

    useEffect(() => {
        api.get('/accounts').then(setAccounts).catch(() => {});
        api.get('/cards').then(setCards).catch(() => {});
        api.get('/categories').then(setCategories).catch(() => {});
    }, []);

    const options = destinationType === 'account' ? accounts : cards;

    const runPreview = async (pdfPassword) => {
        setLoading(true);
        setError('');
        if (pdfPassword !== undefined) setPdfPasswordError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            if (pdfPassword) formData.append('password', pdfPassword);

            const data = await api.postForm('/transactions/import-statement/preview', formData);
            setNeedsPdfPassword(false);
            setPreviewFilename(data.filename);
            setPreviewWarnings(data.warnings || []);
            setRows(
                data.transactions.map((t) => ({
                    ...t,
                    category_id: t.category_id != null ? String(t.category_id) : '',
                    included: true,
                }))
            );
            setStep(3);
        } catch (err) {
            if (err.code === 'PDF_PASSWORD_REQUIRED' || err.code === 'PDF_PASSWORD_INCORRECT') {
                setNeedsPdfPassword(true);
                // So mostra a mensagem de erro no popup quando ja houve uma
                // tentativa de senha (o primeiro popup, quando ainda nem se
                // sabia que o PDF tinha senha, deve abrir "limpo").
                setPdfPasswordError(err.code === 'PDF_PASSWORD_INCORRECT' ? err.message : '');
            } else {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const updateRow = (index, changes) => {
        setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...changes } : r)));
    };

    const includedRows = rows.filter((r) => r.included);

    const runCommit = async () => {
        setLoading(true);
        setError('');
        try {
            const payload = {
                filename: previewFilename,
                transactions: includedRows.map((r) => ({
                    fitid: r.fitid,
                    date: r.date,
                    description: r.description,
                    amount: Number(r.amount),
                    category_id: r.category_id ? Number(r.category_id) : null,
                    installment_number: r.installment_number,
                    installment_total: r.installment_total,
                })),
            };
            if (destinationType === 'account') payload.account_id = destinationId;
            else payload.card_id = destinationId;

            const data = await api.post('/transactions/import-statement/commit', payload);
            setResult(data);
            setStep(4);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setStep(1);
        setFile(null);
        setRows([]);
        setPreviewWarnings([]);
        setResult(null);
        setError('');
    };

    return (
        <div className="page">
            <h1>Assistente de Importacao de Extratos</h1>
            <p className="muted">Nao ha sincronizacao automatica com bancos: use este assistente para importar extratos e faturas manualmente. Formatos aceitos: .ofx, .csv, .xlsx e .pdf.</p>

            <div className="wizard-steps">
                <span className={step >= 1 ? 'active' : ''}>1. Destino</span>
                <span className={step >= 2 ? 'active' : ''}>2. Arquivo</span>
                <span className={step >= 3 ? 'active' : ''}>3. Revisar</span>
                <span className={step >= 4 ? 'active' : ''}>4. Resultado</span>
            </div>

            <section className="card">
                {step === 1 && (
                    <>
                        <h2>Escolha o destino dos lancamentos</h2>
                        <div className="input-group">
                            <select value={destinationType} onChange={(e) => { setDestinationType(e.target.value); setDestinationId(''); }}>
                                <option value="account">Conta bancaria</option>
                                <option value="card">Cartao de credito</option>
                            </select>
                            <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} disabled={options.length === 0}>
                                <option value="">Selecione...</option>
                                {options.map((opt) => (
                                    <option key={opt.id} value={opt.id}>{opt.bank_name || opt.card_name}</option>
                                ))}
                            </select>
                        </div>

                        {options.length === 0 ? (
                            <p className="budget-alert-warning">
                                Voce ainda nao cadastrou {destinationType === 'account' ? 'nenhuma conta bancaria' : 'nenhum cartao de credito'}.{' '}
                                <Link to="/accounts">Cadastre em Contas e Cartoes</Link> antes de importar um extrato.
                            </p>
                        ) : (
                            <button className="btn-primary" disabled={!destinationId} onClick={() => setStep(2)}>Proximo</button>
                        )}
                    </>
                )}

                {step === 2 && (
                    <>
                        <h2>Selecione o arquivo do extrato</h2>
                        <p className="muted">Aceita .ofx, .csv, .xlsx ou .pdf exportado do app/site do seu banco ou cartao.</p>
                        <p className="muted">Extratos em PDF sao lidos por IA: pode levar alguns segundos a mais que os outros formatos.</p>
                        <input type="file" accept=".ofx,.csv,.xlsx,.xls,.pdf" onChange={(e) => setFile(e.target.files[0])} />
                        {error && <div className="error-msg">{error}</div>}
                        <div className="wizard-actions">
                            <button className="btn-link" onClick={() => setStep(1)}>Voltar</button>
                            <button className="btn-primary" disabled={!file || loading} onClick={() => runPreview()}>
                                {loading ? 'Lendo arquivo...' : 'Proximo'}
                            </button>
                        </div>
                    </>
                )}

                {step === 3 && (
                    <>
                        <h2>Revisar lancamentos antes de importar</h2>
                        <p className="muted">
                            Confira e ajuste data, descricao, valor e categoria de cada lancamento. Desmarque os que voce nao quer importar.
                        </p>

                        {previewWarnings.length > 0 && (
                            <div className="budget-alert-warning">
                                {previewWarnings.map((w, i) => <p key={i}>{w}</p>)}
                            </div>
                        )}

                        {rows.length === 0 ? (
                            <p className="muted">Nenhum lancamento foi encontrado nesse arquivo.</p>
                        ) : (
                            <div className="table-scroll">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th />
                                            <th>Data</th>
                                            <th>Descricao</th>
                                            <th>Valor</th>
                                            <th>Categoria</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row, index) => (
                                            <tr key={index} className={!row.included ? 'muted' : ''}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={row.included}
                                                        onChange={(e) => updateRow(index, { included: e.target.checked })}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="date"
                                                        value={row.date || ''}
                                                        disabled={!row.included}
                                                        onChange={(e) => updateRow(index, { date: e.target.value })}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        value={row.description || ''}
                                                        disabled={!row.included}
                                                        onChange={(e) => updateRow(index, { description: e.target.value })}
                                                    />
                                                    {row.duplicate && <span className="muted"> (ja importado antes)</span>}
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={row.amount}
                                                        disabled={!row.included}
                                                        onChange={(e) => updateRow(index, { amount: e.target.value })}
                                                    />
                                                </td>
                                                <td>
                                                    <select
                                                        value={row.category_id}
                                                        disabled={!row.included}
                                                        onChange={(e) => updateRow(index, { category_id: e.target.value })}
                                                    >
                                                        <option value="">Sem categoria</option>
                                                        {categories.map((c) => (
                                                            <option key={c.id} value={c.id}>{c.name}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <p className="muted">{includedRows.length} de {rows.length} lancamento(s) selecionado(s) para importar.</p>

                        {error && <div className="error-msg">{error}</div>}
                        <div className="wizard-actions">
                            <button className="btn-link" onClick={() => setStep(2)}>Voltar</button>
                            <button className="btn-primary" disabled={loading || includedRows.length === 0} onClick={runCommit}>
                                {loading ? 'Importando...' : `Importar ${includedRows.length} lancamento(s)`}
                            </button>
                        </div>
                    </>
                )}

                {step === 4 && result && (
                    <>
                        <h2>Importacao concluida</h2>
                        <p>{result.imported} transacoes importadas, {result.skipped} ja existiam (duplicadas) ou foram descartadas.</p>
                        {result.generatedInstallments > 0 && (
                            <p className="muted">
                                {result.generatedInstallments} parcela{result.generatedInstallments > 1 ? 's' : ''} futura{result.generatedInstallments > 1 ? 's' : ''} de compras parceladas foram lancadas automaticamente nas datas projetadas.
                            </p>
                        )}
                        {result.registeredBillId && (
                            <p className="muted">
                                A fatura e o vencimento foram registrados automaticamente em <Link to="/bills">Contas a Pagar</Link>.
                            </p>
                        )}
                        <button className="btn-primary" onClick={reset}>
                            Importar outro arquivo
                        </button>
                    </>
                )}
            </section>

            {needsPdfPassword && (
                <PdfPasswordModal
                    error={pdfPasswordError}
                    loading={loading}
                    onSubmit={(password) => runPreview(password)}
                    onCancel={() => { setNeedsPdfPassword(false); setPdfPasswordError(''); setLoading(false); }}
                />
            )}
        </div>
    );
}
