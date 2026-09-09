import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from '../components/Logo.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function Login() {
    const { login } = useAuth();
    const [step, setStep] = useState(1);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [userId, setUserId] = useState(null);
    const [newDevice, setNewDevice] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const data = await api.post('/auth/login', { username, password });
            setUserId(data.userId);
            setNewDevice(data.newDevice);
            setStep(2);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const data = await api.post('/auth/verify-2fa', { userId, code });
            login(data.token);
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="glass-panel">
            <ThemeToggle className="login-theme-toggle" />
            <Logo size={40} wordmark="Financas" />
            <h2>{step === 1 ? 'Acesso Seguro' : 'Verificacao 2FA'}</h2>
            <p>
                {step === 1
                    ? 'Bem-vindo de volta ao seu controle financeiro.'
                    : newDevice
                    ? 'Novo dispositivo detectado. Confirme com o codigo enviado ao seu e-mail de seguranca.'
                    : 'Insira o codigo enviado para seu e-mail.'}
            </p>

            {step === 1 ? (
                <form onSubmit={handleLogin}>
                    <div className="input-group">
                        <input
                            type="text"
                            placeholder="Usuario"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                        <input
                            type="password"
                            placeholder="Senha"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="btn-primary" disabled={loading}>
                        {loading ? 'Enviando codigo...' : 'Entrar'}
                    </button>
                </form>
            ) : (
                <form onSubmit={handleVerify}>
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
                    <button type="submit" className="btn-primary">Verificar e Acessar</button>
                </form>
            )}

            {error && <div className="error-msg">{error}</div>}
        </div>
    );
}
