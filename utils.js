import { doc, parentWin } from './context.js';

export function log(msg) { console.log('[CharManager]', msg); }

export function truncate(t, l) { 
    return !t ? '(无)' : t.length > l ? t.slice(0, l) + '...' : t; 
}

export function formatSize(b) { 
    if (!b || b === 0) return '0B'; 
    const k = 1024, s = ['B', 'KB', 'MB', 'GB']; // 建议加上 GB
    const i = Math.floor(Math.log(b) / Math.log(k)); 
    return (b / Math.pow(k, i)).toFixed(1) + s[i]; 
}

export function escapeHtml(t) { 
    if (!t) return ''; 
    return String(t)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function generateId() { 
    // 使用 slice 代替过时的 substr
    return Date.now().toString() + Math.random().toString(36).slice(2, 11); 
}

export function notify(msg, type = 'info') {
    try {
        // 增加更严谨的判断
        if (parentWin && parentWin.toastr) parentWin.toastr[type](msg);
        else if (typeof toastr !== 'undefined') toastr[type](msg);
        else log(`${type.toUpperCase()}: ${msg}`);
    } catch (e) { 
        console.error('Notify failed', e);
    }
}

export async function loadJSZip() {
    if (parentWin?.JSZip) return parentWin.JSZip;
    if (window.JSZip) return window.JSZip;
    
    return new Promise((resolve, reject) => {
        const script = doc.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => resolve(window.JSZip || parentWin?.JSZip);
        script.onerror = () => reject(new Error('无法加载 JSZip 库'));
        (doc.head || doc.documentElement).appendChild(script);
    });
}

/**
 * 计算 Token 数 (简单估算)
 */
export function calculateTokens(text) {
    if (!text) return 0;
    // 这里的正则在匹配复杂标点或 Emoji 时可能有偏差，
    // 但作为“粗略估算”是可以接受的。
    const words = text.match(/[\w]+|[\u4e00-\u9fa5]/g);
    return words ? words.length : 0;
}

export async function parsePNG(buf) {
    try {
        const v = new DataView(buf);
        let o = 8;
        const latin1 = new TextDecoder('latin1');
        while (o < buf.byteLength) {
            const len = v.getUint32(o); o += 4;
            const type = latin1.decode(new Uint8Array(buf, o, 4)); o += 4;
            if (type === 'tEXt') {
                const ch = new Uint8Array(buf, o, len);
                const ni = Array.prototype.indexOf.call(ch, 0);
                if (ni > 0) {
                    const key = latin1.decode(ch.slice(0, ni));
                    if (key === 'chara' || key === 'ccv3') {
                        const b64 = latin1.decode(ch.slice(ni + 1));
                        try {
                            const binary = atob(b64);
                            const bytes = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                            return JSON.parse(new TextDecoder('utf-8').decode(bytes));
                        } catch (e) { }
                    }
                }
            }
            o += len + 4;
            if (type === 'IEND') break;
        }
    } catch (e) { }
    return null;
}