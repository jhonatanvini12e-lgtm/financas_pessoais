import { useState } from 'react';

export default function PdfPasswordModal({ error, loading, onSubmit, onCancel }) {
    const [password, setPassword] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(password);
    };

    return (
        <div className="modal-overlay">
            <div className="glass-panel reauth-panel">
                <h2>Fatura protegida por senha</h2>
                <p>Este PDF esta protegido por senha. Digite a senha para continuar a importacao.</p>

                <form onSubmit={handleSubmit}>
                    <div className="input-group">
                        <input
                            type="password"
                            placeholder="Senha do PDF"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoFocus
                            required
                        />
                    </div>
                    <button type="submit" className="btn-primary" disabled={loading || !password}>
                        {loading ? 'Verificando...' : 'Continuar'}
                    </button>
                </form>

                {error && <div className="error-msg">{error}</div>}

                <button className="btn-link" onClick={onCancel}>Cancelar</button>
            </div>
        </div>
    );
}
