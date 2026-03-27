import { parentWin, getSTContext } from './context.js';

export function getAuthHeaders() {
    try {
        if (parentWin && typeof parentWin.getRequestHeaders === 'function') {
            return parentWin.getRequestHeaders();
        }
    } catch (e) { }
    try {
        if (typeof getRequestHeaders === 'function') {
            return getRequestHeaders();
        }
    } catch (e) { }
    try {
        const ctx = getSTContext();
        if (ctx && ctx.getRequestHeaders) {
            return ctx.getRequestHeaders();
        }
    } catch (e) { }
    return { 'Content-Type': 'application/json' };
}

export async function authFetch(url, opt = {}) {
    const headers = getAuthHeaders();
    if (opt.body instanceof FormData) {
        if (headers['Content-Type']) delete headers['Content-Type'];
    }
    opt.headers = Object.assign({}, headers, opt.headers || {});
    opt.credentials = 'same-origin';
    const fetchFn = parentWin.fetch || window.fetch;
    return fetchFn.call(parentWin, url, opt);
}
