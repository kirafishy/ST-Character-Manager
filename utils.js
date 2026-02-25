import { doc, parentWin } from './context.js';
import { state } from './state.js';

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
        .replace(/&/g, "&" + "amp;")
        .replace(/</g, "&" + "lt;")
        .replace(/>/g, "&" + "gt;")
        .replace(/"/g, "&" + "quot;")
        .replace(/'/g, "&" + "#039;");
}

export function formatRichText(text, charName = '', preserveHtml = false) {
    if (!text) return '';

    let html = String(text);

    // 1. 智能模式推断 (如果 preserveHtml 为 true)
    let isHeavyHtml = false;
    if (preserveHtml) {
        const htmlTagCount = (html.match(/<\/?(div|table|p|br|span|style|b|i|strong|em|a|img|audio|video|source)[^>]*>/gi) || []).length;
        const hasStyle = /<style[^>]*>[\s\S]*?<\/style>/i.test(html);
        isHeavyHtml = hasStyle || htmlTagCount > 5;
    }

    // 2. 安全转义 (如果 preserveHtml 为 false)
    if (!preserveHtml) {
        // 提取白名单标签 (img, audio, source)
        const placeholders = [];
        // 修复: 包含 audio 的闭合标签，防止被转义导致内容隐藏
        html = html.replace(/<\/?(img|audio|source)[^>]*>/gi, (match) => {
            placeholders.push(match);
            return `__HTML_PLACEHOLDER_${placeholders.length - 1}__`;
        });

        // 转义剩余内容
        html = escapeHtml(html);

        // 恢复白名单标签
        html = html.replace(/__HTML_PLACEHOLDER_(\d+)__/g, (match, index) => {
            return placeholders[index];
        });
    }

    // 3. 宏替换 {{char}} 和 {{user}}
    const theme = state.settings.macroColorTheme || 'dark1';
    let charColor = '#22D3EE';
    let userColor = '#FB923C';

    if (theme === 'custom') {
        charColor = state.settings.customCharColor || '#22D3EE';
        userColor = state.settings.customUserColor || '#FB923C';
    } else {
        const MACRO_COLORS = {
            dark1: { char: '#22D3EE', user: '#FB923C' },
            dark2: { char: '#60A5FA', user: '#F472B6' },
            dark3: { char: '#F472B6', user: '#60A5FA' },
            dark4: { char: '#A855F7', user: '#F59E0B' },
            dark5: { char: '#34D399', user: '#60A5FA' },
            dark6: { char: '#14B8A6', user: '#FB7185' },
            light1: { char: '#0F766E', user: '#C2410C' },
            light2: { char: '#6D28D9', user: '#1D4ED8' }
        };
        if (MACRO_COLORS[theme]) {
            charColor = MACRO_COLORS[theme].char;
            userColor = MACRO_COLORS[theme].user;
        }
    }

    // 替换 {{char}}
    html = html.replace(/\{\{char\}\}/gi, `<span class="cm-macro-char" style="font-weight:bold;color:${charColor};">${escapeHtml(charName) || '{{char}}'}</span>`);
    // 替换 {{user}}
    html = html.replace(/\{\{user\}\}/gi, `<span class="cm-macro-user" style="font-weight:bold;color:${userColor};">User</span>`);

    // 4. Markdown 解析
    // 图片 ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;height:auto;border-radius:4px;">');
    // 音频 [text](url.mp3) 或 [text](url.wav) 等
    html = html.replace(/\[([^\]]*)\]\(([^)]+\.(mp3|wav|ogg|flac|m4a|aac))([^)]*)\)/gi, '<audio controls src="$2" style="max-width:100%;"></audio>');
    // 普通链接 [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--cm-accent-text);">$1</a>');
    
    // 加粗 **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // 斜体 *text*
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // 删除线 ~~text~~
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 5. 换行处理
    if (!isHeavyHtml) {
        html = html.replace(/\n\n/g, '</p><p>');
        html = html.replace(/\n/g, '<br>');
        html = `<p>${html}</p>`;
        // 清理空段落
        html = html.replace(/<p><\/p>/g, '');
    }

    return html;
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

export function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const len = bytes.length;
    const GROUP = 3072;
    const parts = [];
    for (let i = 0; i < len; i += GROUP) {
        const chunk = bytes.subarray(i, Math.min(i + GROUP, len));
        parts.push(btoa(String.fromCharCode.apply(null, chunk)));
    }
    return parts.join('');
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