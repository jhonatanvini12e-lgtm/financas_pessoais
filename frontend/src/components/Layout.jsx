import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useIdleTimer } from '../hooks/useIdleTimer.js';
import { useAlertsPolling } from '../hooks/useAlertsPolling.js';
import { requestNotificationPermission } from '../utils/notifications.js';
import ReauthModal from './ReauthModal.jsx';
import Logo from './Logo.jsx';
import ThemeToggle from './ThemeToggle.jsx';

function Icon({ children }) {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {children}
        </svg>
    );
}

const NAV_ITEMS = [
    {
        to: '/', label: 'Dashboard', end: true, icon: (
            <Icon><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></Icon>
        ),
    },
    {
        to: '/transactions', label: 'Lancamentos', icon: (
            <Icon><path d="M6 3h9l3 3v15H6z" /><path d="M9 9h6M9 13h6M9 17h3" /></Icon>
        ),
    },
    {
        to: '/quick-add', label: 'Lancamento Rapido', icon: (
            <Icon><path d="M13 2 3 14h7l-1 8 11-14h-7z" /></Icon>
        ),
    },
    {
        to: '/categories', label: 'Categorias', icon: (
            <Icon><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.17L4 3a1 1 0 0 0-1 1l.17 5.59a2 2 0 0 0 .66 1.41l9.58 9.59a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.83Z" /><circle cx="7.5" cy="7.5" r="1.2" /></Icon>
        ),
    },
    {
        to: '/budget', label: 'Orcamento', icon: (
            <Icon><circle cx="12" cy="12" r="9" /><path d="M12 3v9l7 4" /></Icon>
        ),
    },
    {
        to: '/accounts', label: 'Contas e Cartoes', icon: (
            <Icon><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /></Icon>
        ),
    },
    {
        to: '/connections', label: 'Conexoes Open Finance', icon: (
            <Icon><path d="M7 7h7a4 4 0 0 1 0 8H8" /><path d="m10 4-3 3 3 3" /><path d="m14 20 3-3-3-3" /></Icon>
        ),
    },
    {
        to: '/invoice-export', label: 'Exportacao de Fatura', icon: (
            <Icon><path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" /></Icon>
        ),
    },
    {
        to: '/bills', label: 'Contas a Pagar', icon: (
            <Icon><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" /></Icon>
        ),
    },
    {
        to: '/notas-faturas', label: 'Notas e Faturas', icon: (
            <Icon><path d="M7 3h7l4 4v14H7z" /><path d="M10 10h6M10 14h6M10 18h4" /></Icon>
        ),
    },
    {
        to: '/debts', label: 'Dividas', icon: (
            <Icon><path d="M3 7h5l4 13 4-17 4 11h1" /></Icon>
        ),
    },
    {
        to: '/caixinhas-investimentos', label: 'Caixinhas e Investimentos', icon: (
            <Icon><path d="M3 17l6-7 4 4 7-9" /><path d="M14 5h6v6" /></Icon>
        ),
    },
    {
        to: '/turning-point', label: 'Ponto de Virada', icon: (
            <Icon><path d="M5 21V4" /><path d="M5 4h12l-3 4 3 4H5" /></Icon>
        ),
    },
    {
        to: '/intelligence', label: 'Inteligencia Financeira', icon: (
            <Icon><path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4Z" /></Icon>
        ),
    },
    {
        to: '/analytics', label: 'Analises', icon: (
            <Icon><path d="M4 20V10M12 20V4M20 20v-7" /></Icon>
        ),
    },
    {
        to: '/alerts', label: 'Alertas', icon: (
            <Icon><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></Icon>
        ),
    },
    {
        to: '/settings', label: 'Configuracoes', icon: (
            <Icon><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5L10 22h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z" /></Icon>
        ),
    },
];

// Itens de maior uso no dia a dia ficam fixos na barra inferior do mobile;
// o resto mora na folha "Mais" para nao espremer a barra.
const BOTTOM_NAV_PATHS = ['/', '/bills', '/quick-add', '/debts'];
const bottomNavItem = (path) => NAV_ITEMS.find((item) => item.to === path);
const sheetItems = NAV_ITEMS.filter((item) => !BOTTOM_NAV_PATHS.includes(item.to));

export default function Layout() {
    const { user, logout, reauth, setReauth } = useAuth();
    const unreadAlerts = useAlertsPolling(!reauth);
    const [moreOpen, setMoreOpen] = useState(false);
    const location = useLocation();

    useEffect(() => {
        requestNotificationPermission();
    }, []);

    useEffect(() => {
        setMoreOpen(false);
    }, [location.pathname]);

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
                            {item.icon}
                            {item.label}
                        </NavLink>
                    ))}
                </nav>
            </aside>

            <div className="app-main">
                <header className="topbar">
                    <Logo size={26} wordmark="" className="topbar-brand" />
                    <div className="topbar-alerts">
                        <NavLink to="/alerts" className="bell">
                            Alertas {unreadAlerts.length > 0 && <span className="badge">{unreadAlerts.length}</span>}
                        </NavLink>
                    </div>
                    <div className="topbar-user">
                        <ThemeToggle />
                        <span>{user?.username}</span>
                        <button className="btn-link" onClick={logout}>Sair</button>
                    </div>
                </header>

                <main className="page-content">
                    <Outlet />
                </main>

                <nav className="bottom-nav">
                    {BOTTOM_NAV_PATHS.map((path) => {
                        const item = bottomNavItem(path);
                        if (path === '/quick-add') {
                            return (
                                <NavLink key={path} to={path} className="bn-add" aria-label={item.label}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                                </NavLink>
                            );
                        }
                        return (
                            <NavLink key={path} to={path} end={item.end} className="bn-item">
                                {item.icon}
                                {item.label.split(' ')[0]}
                            </NavLink>
                        );
                    })}
                    <button type="button" className="bn-item" onClick={() => setMoreOpen(true)}>
                        <Icon><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></Icon>
                        Mais
                    </button>
                </nav>

                {moreOpen && (
                    <div className="nav-sheet-overlay" onClick={() => setMoreOpen(false)}>
                        <div className="nav-sheet" onClick={(event) => event.stopPropagation()}>
                            <div className="nav-sheet-handle" />
                            {sheetItems.map((item) => (
                                <NavLink key={item.to} to={item.to} end={item.end} className="nav-sheet-link" onClick={() => setMoreOpen(false)}>
                                    {item.icon}
                                    {item.label}
                                </NavLink>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <ReauthModal />
        </div>
    );
}
