import { useState, useCallback } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from '../components/Logo.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function Login() {
    const { login } = useAuth();
    const [step, setStep] = useState(1); // 1: credenciais, 2: codigo por e-mail, 3: biometria
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [userId, setUserId] = useState(null);
    const [newDevice, setNewDevice] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [biometricPending, setBiometricPending] = useState(false);

    const tryBiometricLogin = useCallback(
        async (id) => {
            setBiometricPending(true);
            setError('');
            try {
                const optionsJSON = await api.post('/auth/webauthn/login-options', { userId: id });
                const assertion = await startAuthentication({ optionsJSON });
                await api.post('/auth/webauthn/login-verify', { userId: id, ...assertion });
                await login();
            } catch {
                setError('Nao foi possivel confirmar a biometria. Tente novamente ou use o codigo por e-mail.');
            } finally {
                setBiometricPending(false);
            }
        },
        [login]
    );

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const data = await api.post('/auth/login', { username, password });
            setUserId(data.userId);
            setNewDevice(data.newDevice);
            if (data.method === 'webauthn') {
                setStep(3);
                tryBiometricLogin(data.userId);
            } else {
                setStep(2);
            }
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
            await api.post('/auth/verify-2fa', { userId, code });
            await login();
        } catch (err) {
            setError(err.message);
        }
    };

    const useEmailInstead = async () => {
        setError('');
        try {
            await api.post('/auth/send-email-code', { userId });
        } catch {
            /* resposta do endpoint e sempre generica, seguimos mesmo assim */
        }
        setStep(2);
    };

    return (
        <div className="glass-panel">
            <ThemeToggle className="login-theme-toggle" />
            <Logo size={40} wordmark="Financas" />
            <h2>{step === 1 ? 'Acesso Seguro' : step === 3 ? 'Verificacao por biometria' : 'Verificacao 2FA'}</h2>
            <p>
                {step === 1
                    ? 'Bem-vindo de volta ao seu controle financeiro.'
                    : step === 3
                    ? 'Use a digital ou o reconhecimento facial deste aparelho para confirmar o acesso.'
                    : newDevice
                    ? 'Novo dispositivo detectado. Confirme com o codigo enviado ao seu e-mail de seguranca.'
                    : 'Insira o codigo enviado para seu e-mail.'}
            </p>

            {step === 1 && (
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
            )}

            {step === 3 && (
                <div className="input-group">
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={() => tryBiometricLogin(userId)}
                        disabled={biometricPending}
                    >
                        {biometricPending ? 'Aguardando biometria...' : 'Tentar novamente'}
                    </button>
                    <button type="button" className="btn-link" onClick={useEmailInstead}>
                        Usar codigo por e-mail
                    </button>
                </div>
            )}

            {step === 2 && (
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
