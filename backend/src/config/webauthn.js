// RP ID precisa ser o hostname exato usado no navegador (sem protocolo/porta)
// e ORIGIN precisa ser a URL completa (protocolo+host+porta) que aparece na
// barra de enderecos -- caso contrario o navegador rejeita o WebAuthn.
// Em producao atras de nginx/docker, defina WEBAUTHN_RP_ID e WEBAUTHN_ORIGIN
// explicitamente no .env em vez de confiar no fallback abaixo.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

function hostnameFrom(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return 'localhost';
    }
}

export const RP_NAME = 'Financas Pessoais';
export const RP_ID = process.env.WEBAUTHN_RP_ID || hostnameFrom(FRONTEND_URL);
export const ORIGIN = process.env.WEBAUTHN_ORIGIN || FRONTEND_URL;
