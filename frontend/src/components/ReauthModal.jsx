import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ReauthModal() {
    const { reauth, resolveReauth, logout } = useAuth();
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);

    if (!reauth) return null;

    const requestCode = async () => {
        setError('');
        try {
            await api.post('/auth/request-reauth', { userId: reauth.userId });
            setSent(true);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/auth/verify-2fa', { userId: reauth.userId, code });
            resolveReauth();
            setCode('');
            setSent(false);
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="glass-panel reauth-panel">
                <h2>Sessao expirada por inatividade</h2>
                <p>
                    Por seguranca, sua sessao foi bloqueada apos alguns minutos sem uso.
                    {sent ? ' Enviamos um novo codigo para seu e-mail.' : ' Solicite um novo codigo para continuar.'}
                </p>

                {!sent ? (
                    <button className="btn-primary" onClick={requestCode}>
                        Enviar codigo por e-mail
                    </button>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="input-group">
                            <input
                                type="text"
                                placeholder="Codigo de 6 digitos"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                maxLength={6}
                                required
                            />
                        </div>
                        <button type="submit" className="btn-primary">Verificar e continuar</button>
                    </form>
                )}

                {error && <div className="error-msg">{error}</div>}

                <button className="btn-link" onClick={logout}>Sair e voltar ao login</button>
            </div>
        </div>
    );
}
