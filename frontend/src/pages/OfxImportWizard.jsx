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
    const [file, setFile] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [pdfPasswordError, setPdfPasswordError] = useState('');
    const [needsPdfPassword, setNeedsPdfPassword] = useState(false);

    useEffect(() => {
        api.get('/accounts').then(setAccounts).catch(() => {});
        api.get('/cards').then(setCards).catch(() => {});
    }, []);

    const options = destinationType === 'account' ? accounts : cards;

    const runImport = async (pdfPassword) => {
        setLoading(true);
        setError('');
        if (pdfPassword !== undefined) setPdfPasswordError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            if (destinationType === 'account') formData.append('account_id', destinationId);
            else formData.append('card_id', destinationId);
            if (pdfPassword) formData.append('password', pdfPassword);

            const data = await api.postForm('/transactions/import-statement', formData);
            setNeedsPdfPassword(false);
            setResult(data);
            setStep(4);
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

    return (
        <div className="page">
            <h1>Assistente de Importacao de Extratos</h1>
            <p className="muted">Nao ha sincronizacao automatica com bancos: use este assistente para importar extratos e faturas manualmente. Formatos aceitos: .ofx, .csv, .xlsx e .pdf.</p>

            <div className="wizard-steps">
                <span className={step >= 1 ? 'active' : ''}>1. Destino</span>
                <span className={step >= 2 ? 'active' : ''}>2. Arquivo</span>
                <span className={step >= 3 ? 'active' : ''}>3. Confirmar</span>
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
                        <div className="wizard-actions">
                            <button className="btn-link" onClick={() => setStep(1)}>Voltar</button>
                            <button className="btn-primary" disabled={!file} onClick={() => setStep(3)}>Proximo</button>
                        </div>
                    </>
                )}

                {step === 3 && (
                    <>
                        <h2>Confirmar importacao</h2>
                        <p>Destino: {options.find((o) => String(o.id) === String(destinationId))?.bank_name || options.find((o) => String(o.id) === String(destinationId))?.card_name}</p>
                        <p>Arquivo: {file?.name}</p>
                        <p className="muted">
                            As transacoes serao categorizadas automaticamente pelo historico e palavras-chave cadastradas
                            {file?.name?.toLowerCase().endsWith('.pdf') ? ', com a IA sugerindo uma categoria pela descricao quando nenhuma delas encontrar um resultado' : ''}.
                        </p>
                        {error && <div className="error-msg">{error}</div>}
                        <div className="wizard-actions">
                            <button className="btn-link" onClick={() => setStep(2)}>Voltar</button>
                            <button className="btn-primary" disabled={loading} onClick={() => runImport()}>
                                {loading ? 'Importando...' : 'Importar'}
                            </button>
                        </div>
                    </>
                )}

                {step === 4 && result && (
                    <>
                        <h2>Importacao concluida</h2>
                        <p>{result.imported} transacoes importadas, {result.skipped} ja existiam (duplicadas).</p>
                        {result.generatedInstallments > 0 && (
                            <p className="muted">
                                {result.generatedInstallments} parcela{result.generatedInstallments > 1 ? 's' : ''} futura{result.generatedInstallments > 1 ? 's' : ''} de compras parceladas foram lancadas automaticamente nas datas projetadas.
                            </p>
                        )}
                        <button className="btn-primary" onClick={() => { setStep(1); setFile(null); setResult(null); }}>
                            Importar outro arquivo
                        </button>
                    </>
                )}
            </section>

            {needsPdfPassword && (
                <PdfPasswordModal
                    error={pdfPasswordError}
                    loading={loading}
                    onSubmit={(password) => runImport(password)}
                    onCancel={() => { setNeedsPdfPassword(false); setPdfPasswordError(''); setLoading(false); }}
                />
            )}
        </div>
    );
}
