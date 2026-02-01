import { doc, parentWin } from './context.js';

export function log(msg) { console.log('[CharManager]', msg); }
export function truncate(t, l) { return !t ? '(无)' : t.length > l ? t.slice(0, l) + '...' : t; }
export function formatSize(b) { if (!b) return '0B'; const k = 1024, s = ['B', 'KB', 'MB']; const i = Math.floor(Math.log(b) / Math.log(k)); return (b / Math.pow(k, i)).toFixed(1) + s[i]; }
export function escapeHtml(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
export function generateId() { return Date.now().toString() + Math.random().toString(36).substr(2, 9); }

export function notify(msg, type = 'info') {
    try {
        if (parentWin.toastr) parentWin.toastr[type](msg);
        else if (typeof toastr !== 'undefined') toastr[type](msg);
        else log(msg);
    } catch (e) { }
}

export async function loadJSZip() {
    if (parentWin.JSZip) return parentWin.JSZip;
    if (window.JSZip) return window.JSZip;
    return new Promise((resolve, reject) => {
        const script = doc.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => resolve(window.JSZip || parentWin.JSZip);
        script.onerror = () => reject(new Error('无法加载 JSZip 库'));
        doc.head.appendChild(script);
    });
}

