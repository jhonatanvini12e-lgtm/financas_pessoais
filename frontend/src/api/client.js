const API_BASE = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;

let onSessionInvalid = null;
export function setSessionInvalidHandler(fn) {
    onSessionInvalid = fn;
}

function getCsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrfToken=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
    const headers = {};
    if (!isForm && body) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
        const csrfToken = getCsrfToken();
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }

    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }

    if (res.status === 401 && data?.reason && onSessionInvalid) {
        onSessionInvalid(data.reason, data.userId);
    }

    if (!res.ok) {
        const message = res.status >= 500 ? 'Erro interno do servidor. Tente novamente mais tarde.' : (data?.error || `Erro na requisicao (${res.status})`);
        const error = new Error(message);
        if (data?.code) error.code = data.code;
        throw error;
    }

    return data;
}

export const api = {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    delete: (path) => request(path, { method: 'DELETE' }),
    postForm: (path, formData) => request(path, { method: 'POST', body: formData, isForm: true }),
};
