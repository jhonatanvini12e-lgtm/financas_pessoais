// Notificacao no nivel do sistema operacional via Web Notifications API --
// e o mecanismo real disponivel para uma aplicacao web local/LAN (sem virar
// um app desktop). Exige permissao do usuario no navegador.
export function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

export function notifyAlert(alert) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification('Financas Pessoais', {
        body: alert.message,
        tag: `alert-${alert.id}`,
    });
}
