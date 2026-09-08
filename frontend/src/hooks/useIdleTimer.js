import { useEffect, useRef } from 'react';

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // deve casar com inactivityTimeoutMinutes no backend
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];

export function useIdleTimer(enabled, onIdle) {
    const timerRef = useRef(null);

    useEffect(() => {
        if (!enabled) return undefined;

        const resetTimer = () => {
            clearTimeout(timerRef.current);
            timerRef.current = setTimeout(onIdle, IDLE_TIMEOUT_MS);
        };

        ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, resetTimer));
        resetTimer();

        return () => {
            clearTimeout(timerRef.current);
            ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, resetTimer));
        };
    }, [enabled, onIdle]);
}
