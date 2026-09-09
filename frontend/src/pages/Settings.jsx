import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Settings() {
    const { user } = useAuth();
    const [backups, setBackups] = useState([]);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });

    const loadBackups = () => { api.get('/backups').then(setBackups).catch((err) => setError(err.message)); };
    useEffect(loadBackups, []);

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
                <h2>Trocar senha</h2>
                <form onSubmit={changePassword} className="inline-form">
                    <input type="password" placeholder="Senha atual" value={passwordForm.currentPassword}
                        onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} required />
                    <input type="password" placeholder="Nova senha" value={passwordForm.newPassword}
                        onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} required minLength={6} />
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
