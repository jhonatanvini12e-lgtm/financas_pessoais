import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const PrivacyContext = createContext(null);

// Mascarado por padrao (como apps de banco costumam fazer em local publico)
// -- o usuario revela quando quiser, e a escolha fica salva no navegador.
function getInitialHideValues() {
    const stored = localStorage.getItem('hideValues');
    return stored === null ? true : stored === 'true';
}

export function PrivacyProvider({ children }) {
    const [hideValues, setHideValues] = useState(getInitialHideValues);

    useEffect(() => {
        localStorage.setItem('hideValues', String(hideValues));
    }, [hideValues]);

    const toggleHideValues = useCallback(() => {
        setHideValues((current) => !current);
    }, []);

    return (
        <PrivacyContext.Provider value={{ hideValues, toggleHideValues }}>
            {children}
        </PrivacyContext.Provider>
    );
}

export function usePrivacy() {
    return useContext(PrivacyContext);
}
