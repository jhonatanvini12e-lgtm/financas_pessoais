import { useCallback, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useIdleTimer } from '../hooks/useIdleTimer.js';
import { useAlertsPolling } from '../hooks/useAlertsPolling.js';
import { requestNotificationPermission } from '../utils/notifications.js';
import ReauthModal from './ReauthModal.jsx';
import Logo from './Logo.jsx';

const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', end: true },
    { to: '/transactions', label: 'Lancamentos' },
    { to: '/quick-add', label: 'Lancamento Rapido' },
    { to: '/categories', label: 'Categorias' },
    { to: '/budget', label: 'Orcamento' },
    { to: '/accounts', label: 'Contas e Cartoes' },
    { to: '/banks', label: 'Open Finance' },
    { to: '/debts', label: 'Dividas' },
    { to: '/caixinhas-investimentos', label: 'Caixinhas e Investimentos' },
    { to: '/turning-point', label: 'Ponto de Virada' },
    { to: '/intelligence', label: 'Inteligencia Financeira' },
    { to: '/alerts', label: 'Alertas' },
    { to: '/settings', label: 'Configuracoes' },
];

export default function Layout() {
    const { user, logout, reauth, setReauth } = useAuth();
    const unreadAlerts = useAlertsPolling(!reauth);

    useEffect(() => {
        requestNotificationPermission();
    }, []);

    const handleIdle = useCallback(() => {
        if (user) setReauth({ reason: 'INACTIVE', userId: user.id });
    }, [user, setReauth]);

    useIdleTimer(!reauth, handleIdle);

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <Logo size={32} wordmark="Financas" className="sidebar-brand" />
                <nav>
                    {NAV_ITEMS.map((item) => (
                        <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                            {item.label}
                        </NavLink>
                    ))}
                </nav>
            </aside>

            <div className="app-main">
                <header className="topbar">
                    <div className="topbar-alerts">
                        <NavLink to="/alerts" className="bell">
                            Alertas {unreadAlerts.length > 0 && <span className="badge">{unreadAlerts.length}</span>}
                        </NavLink>
                    </div>
                    <div className="topbar-user">
                        <span>{user?.username}</span>
                        <button className="btn-link" onClick={logout}>Sair</button>
                    </div>
                </header>

                <main className="page-content">
                    <Outlet />
                </main>
            </div>

            <ReauthModal />
        </div>
    );
}
