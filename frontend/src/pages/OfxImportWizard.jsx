import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

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

    useEffect(() => {
        api.get('/accounts').then(setAccounts).catch(() => {});
        api.get('/cards').then(setCards).catch(() => {});
    }, []);

    const options = destinationType === 'account' ? accounts : cards;

    const runImport = async () => {
        setLoading(true);
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            if (destinationType === 'account') formData.append('account_id', destinationId);
            else formData.append('card_id', destinationId);

            const data = await api.postForm('/transactions/import-statement', formData);
            setResult(data);
            setStep(4);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page">
            <h1>Assistente de Importacao de Extratos</h1>
            <p className="muted">Use este assistente quando a sincronizacao via Open Finance falhar. Formatos aceitos: .ofx, .csv, .xlsx e .pdf.</p>

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
                            <button className="btn-primary" disabled={loading} onClick={runImport}>
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
        </div>
    );
}
