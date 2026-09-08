const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000/api`;

let onSessionInvalid = null;
export function setSessionInvalidHandler(fn) {
    onSessionInvalid = fn;
}

function getToken() {
    return localStorage.getItem('token');
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (!isForm && body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
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
        throw new Error(data?.error || `Erro na requisicao (${res.status})`);
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
