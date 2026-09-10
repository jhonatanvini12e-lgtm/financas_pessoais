import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 30000;

/**
 * Repete `callback` a cada `intervalMs`, sem disparar uma chamada imediata
 * (a carga inicial já é feita pelo useEffect de cada tela). Útil para manter
 * os dados atualizados quando o mesmo usuário acessa por dois dispositivos
 * ao mesmo tempo (ex: celular + computador).
 */
export function usePolling(callback, deps, intervalMs = DEFAULT_INTERVAL_MS) {
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        const interval = setInterval(() => callbackRef.current(), intervalMs);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
