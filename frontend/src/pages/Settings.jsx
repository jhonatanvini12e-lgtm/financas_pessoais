import { useEffect, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Settings() {
    const { user } = useAuth();
    const [backups, setBackups] = useState([]);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });
    const [webauthnDevices, setWebauthnDevices] = useState([]);
    const [registeringDevice, setRegisteringDevice] = useState(false);
    const [biometricPassword, setBiometricPassword] = useState('');

    const loadBackups = () => { api.get('/backups').then(setBackups).catch((err) => setError(err.message)); };
    useEffect(loadBackups, []);

    const loadWebauthnDevices = () => { api.get('/auth/webauthn/devices').then(setWebauthnDevices).catch(() => {}); };
    useEffect(loadWebauthnDevices, []);

    const registerThisDevice = async () => {
        setError('');
        setMessage('');
        setRegisteringDevice(true);
        try {
            const optionsJSON = await api.post('/auth/webauthn/register-options', { password: biometricPassword });
            const attestation = await startRegistration({ optionsJSON });
            await api.post('/auth/webauthn/register-verify', attestation);
            setMessage('Biometria ativada neste dispositivo. Da proxima vez, o login vai pedir a digital em vez do codigo por e-mail.');
            setBiometricPassword('');
            loadWebauthnDevices();
        } catch (err) {
            setError(err.message || 'Nao foi possivel registrar a biometria neste dispositivo.');
        } finally {
            setRegisteringDevice(false);
        }
    };

    const removeWebauthnDevice = async (id) => {
        setError('');
        try {
            await api.delete(`/auth/webauthn/devices/${id}`);
            loadWebauthnDevices();
        } catch (err) {
            setError(err.message);
        }
    };

    const changePassword = async (e) => {
        e.preventDefault();
        setError('');
        setMessage('');
        try {
            await api.patch('/auth/change-password', passwordForm);
            setMessage('Senha atualizada com sucesso.');
            setPasswordForm({ currentPassword: '', newPassword: '' });
        } catch (err) {
            setError(err.message);
        }
    };

    const runBackup = async () => {
        setError('');
        try {
            await api.post('/backups/run');
            loadBackups();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="page">
            <h1>Configuracoes</h1>
            {error && <div className="error-msg">{error}</div>}
            {message && <p className="budget-alert-ok">{message}</p>}

            <section className="card">
                <h2>Perfil</h2>
                <p>Usuario: {user?.username}</p>
                <p>E-mail: {user?.email}</p>
            </section>

            <section className="card">
                <h2>Biometria (login sem e-mail)</h2>
                <p className="muted">
                    Registre este aparelho para entrar com digital ou reconhecimento facial em vez de esperar o
                    codigo por e-mail. Funciona apenas neste navegador/dispositivo especifico.
                </p>
                <div className="inline-form">
                    <input type="password" placeholder="Confirme sua senha atual" value={biometricPassword}
                        onChange={(e) => setBiometricPassword(e.target.value)} />
                    <button className="btn-primary" onClick={registerThisDevice} disabled={registeringDevice || !biometricPassword}>
                        {registeringDevice ? 'Aguardando biometria...' : 'Ativar biometria neste dispositivo'}
                    </button>
                </div>
                {webauthnDevices.length > 0 && (
                    <div className="table-scroll">
                        <table className="data-table">
                            <thead><tr><th>Registrado em</th><th>Ultimo uso</th><th></th></tr></thead>
                            <tbody>
                                {webauthnDevices.map((d) => (
                                    <tr key={d.id}>
                                        <td>{d.created_at}</td>
                                        <td>{d.last_used_at || 'Nunca usado'}</td>
                                        <td><button className="btn-link" onClick={() => removeWebauthnDevice(d.id)}>Remover</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="card">
                <h2>Trocar senha</h2>
                <form onSubmit={changePassword} className="inline-form">
                    <input type="password" placeholder="Senha atual" value={passwordForm.currentPassword}
                        onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} required />
                    <input type="password" placeholder="Nova senha" value={passwordForm.newPassword}
                        onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} required minLength={8} />
                    <button type="submit" className="btn-primary">Atualizar</button>
                </form>
            </section>

            <section className="card">
                <h2>Backup do banco de dados</h2>
                <p className="muted">Rotina diaria automatica mantem apenas os 2 backups mais recentes.</p>
                <button className="btn-primary" onClick={runBackup}>Fazer backup agora</button>
                <div className="table-scroll">
                <table className="data-table">
                    <thead><tr><th>Arquivo</th><th>Tamanho</th><th>Data</th></tr></thead>
                    <tbody>
                        {backups.map((b) => (
                            <tr key={b.id}>
                                <td>{b.filename}</td>
                                <td>{(b.size_bytes / 1024).toFixed(1)} KB</td>
                                <td>{b.created_at}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            </section>
        </div>
    );
}
