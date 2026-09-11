import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setSessionInvalidHandler } from '../api/client.js';
import { clearQuickAddQueue } from '../offline/quickAddQueue.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loadingUser, setLoadingUser] = useState(true);
    const [reauth, setReauth] = useState(null); // { reason, userId }

    const clearSession = useCallback(() => {
        setUser(null);
    }, []);

    useEffect(() => {
        setSessionInvalidHandler((reason, userId) => {
            if (reason === 'INACTIVE') {
                setReauth({ reason, userId: userId ?? user?.id });
            } else {
                clearSession();
            }
        });
    }, [clearSession, user]);

    // O token fica em cookie httpOnly (nao acessivel via JS), entao a unica forma
    // de saber se ha sessao valida e' perguntar ao backend.
    const refreshUser = useCallback(() => {
        return api
            .get('/auth/me')
            .then(setUser)
            .catch(() => setUser(null));
    }, []);

    useEffect(() => {
        refreshUser().finally(() => setLoadingUser(false));
    }, [refreshUser]);

    const login = useCallback(() => refreshUser(), [refreshUser]);

    const logout = useCallback(async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            /* ignore */
        } finally {
            await clearQuickAddQueue().catch(() => {});
            clearSession();
        }
    }, [clearSession]);

    const resolveReauth = useCallback(() => {
        setReauth(null);
    }, []);

    return (
        <AuthContext.Provider
            value={{ user, loadingUser, login, logout, reauth, resolveReauth, setReauth }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
