import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setSessionInvalidHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [token, setToken] = useState(() => localStorage.getItem('token'));
    const [user, setUser] = useState(null);
    const [loadingUser, setLoadingUser] = useState(true);
    const [reauth, setReauth] = useState(null); // { reason, userId }

    const clearSession = useCallback(() => {
        localStorage.removeItem('token');
        setToken(null);
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

    useEffect(() => {
        if (!token) {
            setLoadingUser(false);
            return;
        }
        api
            .get('/auth/me')
            .then(setUser)
            .catch(() => clearSession())
            .finally(() => setLoadingUser(false));
    }, [token, clearSession]);

    const login = useCallback((newToken) => {
        localStorage.setItem('token', newToken);
        setToken(newToken);
    }, []);

    const logout = useCallback(async () => {
        try {
            await api.post('/auth/logout');
        } catch {
            /* ignore */
        }
        clearSession();
    }, [clearSession]);

    const resolveReauth = useCallback(
        (newToken) => {
            localStorage.setItem('token', newToken);
            setToken(newToken);
            setReauth(null);
        },
        []
    );

    return (
        <AuthContext.Provider
            value={{ token, user, loadingUser, login, logout, reauth, resolveReauth, setReauth }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
