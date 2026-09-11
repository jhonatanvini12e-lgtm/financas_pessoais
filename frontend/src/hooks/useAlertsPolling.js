import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { notifyAlert } from '../utils/notifications.js';

const POLL_INTERVAL_MS = 30000;

export function useAlertsPolling(enabled) {
    const [unreadAlerts, setUnreadAlerts] = useState([]);
    const seenIds = useRef(new Set());

    useEffect(() => {
        if (!enabled) return undefined;

        let cancelled = false;

        const poll = async () => {
            try {
                const alerts = await api.get('/alerts?unread=true');
                if (cancelled) return;
                setUnreadAlerts(alerts);
                for (const alert of alerts) {
                    if (!seenIds.current.has(alert.id)) {
                        seenIds.current.add(alert.id);
                        if (alert.severity === 'CRITICAL' || alert.severity === 'WARNING') {
                            notifyAlert(alert);
                        }
                    }
                }
            } catch {
                /* rede instavel ou sessao expirada -- proxima tentativa resolve */
            }
        };

        poll();
        const interval = setInterval(() => {
            if (document.hidden) return;
            poll();
        }, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [enabled]);

    return unreadAlerts;
}
