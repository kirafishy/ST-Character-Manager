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
        .replace(/&/g, '&' + 'amp;')
        .replace(/</g, '&' + 'lt;')
        .replace(/>/g, '&' + 'gt;')
        .replace(/"/g, '&' + 'quot;')
        .replace(/'/g, '&' + '#039;');
}

export function formatRichText(text, charName = '', preserveHtml = false) {
    if (!text) return '';
    
    let processedText = String(text).trim();
    
    // 规范化换行符 (Windows \r\n 和旧 Mac \r 到 Unix \n)
    processedText = processedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // 规范化空白：压缩多个空行为最多2个，移除行尾空格
    processedText = processedText
        .replace(/[ \t]+$/gm, '')           // 移除每行尾部的空格/制表符
        .replace(/\n{4,}/g, '\n\n\n')       // 压缩4+换行为3个
        .replace(/[ \t]{2,}/g, ' ');        // 压缩多个空格/制表符为单个空格
    
    // 获取颜色配置
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
    
    // 获取引号颜色配置
    const quoteColor = state.settings.quoteColorTheme === 'custom'
        ? (state.settings.customQuoteColor || '#8B5CF6')
        : {
            purple: '#8B5CF6',
            blue: '#3B82F6',
            green: '#10B981',
            orange: '#F59E0B',
            pink: '#EC4899'
        }[state.settings.quoteColorTheme] || '#8B5CF6';
    
    // 如果保留 HTML (用于带有自定义样式的创作者注释)，使用混合方法
    if (preserveHtml) {
        // 检测内容类型以进行适当的处理
        // Ultra CSS: <style> 标签在内容开头 (前200字符) = 完全样式化的卡片
        const hasStyleTagAtStart = /^[\s\S]{0,200}<style[^>]*>[\s\S]{50,}<\/style>/i.test(processedText);
        const hasStyleTag = /<style[^>]*>[\s\S]*?<\/style>/i.test(processedText);
        const hasSignificantHtml = /<(div|table|center|font)[^>]*>/i.test(processedText);
        const hasInlineStyles = /style\s*=\s*["'][^"']*(?:display|position|flex|grid)[^"']*["']/i.test(processedText);
        
        // Ultra CSS 模式: <style> 标签在开头且有大量 CSS - 几乎不做处理
        if (hasStyleTagAtStart) {
            // 只转换 markdown 图片 (安全 - 不会在 CSS 中)
            processedText = processedText.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s*=[^)]*)?(?:\s+"[^"]*")?\)/g, (match, alt, src) => {
                if (!src.match(/^(https?:\/\/|\/)/i)) return match;
                const altAttr = alt ? ` alt="${alt.replace(/"/g, '"')}"` : '';
                return `<img src="${src}"${altAttr} class="embedded-image" loading="lazy">`;
            });
            
            // 替换 {{user}} 和 {{char}} 占位符 (安全)
            processedText = processedText.replace(/\{\{user\}\}/gi, `<span class="cm-macro-user" style="font-weight:bold;color:${userColor};">User</span>`);
            processedText = processedText.replace(/\{\{char\}\}/gi, `<span class="cm-macro-char" style="font-weight:bold;color:${charColor};">${escapeHtml(charName) || '{{char}}'}</span>`);
            
            return processedText;
        }
        
        // 对于在末尾有 <style> 的内容 (页脚横幅)，提取并保护它
        let styleBlocks = [];
        if (hasStyleTag) {
            processedText = processedText.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, (match) => {
                const placeholder = `\x00STYLEBLOCK${styleBlocks.length}\x00`;
                styleBlocks.push(match);
                return placeholder;
            });
        }
        
        // Pure CSS 模式: 有带布局属性的内联样式 - 跳过文本格式化
        const isPureCssMode = hasInlineStyles;
        // HTML 模式: 有 HTML 结构标签
        const isHtmlMode = hasSignificantHtml;
        
        // 转换 markdown 图片和链接 (对所有模式安全):
        
        // 转换带链接的图片: [![alt](img-url)](link-url)
        processedText = processedText.replace(/\[\!\[([^\]]*)\]\(([^)\s]+)(?:\s*=[^)]*)?(?:\s+"[^"]*")?\)\]\(([^)]+)\)/g, (match, alt, imgSrc, linkHref) => {
            if (!imgSrc.match(/^(https?:\/\/|\/)/i)) return match;
            const altAttr = alt ? ` alt="${alt.replace(/"/g, '"')}"` : '';
            const safeLink = linkHref.match(/^https?:\/\//i) ? linkHref : '#';
            return `<a href="${safeLink}" target="_blank" rel="noopener"><img src="${imgSrc}"${altAttr} class="embedded-image" loading="lazy"></a>`;
        });
        
        // 转换独立的 markdown 图片: ![alt](url) 或 ![alt](url =WxH) 或 ![alt](url "title")
        processedText = processedText.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s*=[^)]*)?(?:\s+"[^"]*")?\)/g, (match, alt, src) => {
            if (!src.match(/^(https?:\/\/|\/)/i)) return match;
            const altAttr = alt ? ` alt="${alt.replace(/"/g, '"')}"` : '';
            return `<img src="${src}"${altAttr} class="embedded-image" loading="lazy">`;
        });
        
        // 转换 markdown 链接: [text](url)
        processedText = processedText.replace(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, text, href) => {
            return `<a href="${href}" target="_blank" rel="noopener" class="embedded-link">${text}</a>`;
        });
        
        // 应用 markdown 文本格式化 (但在 pure CSS 模式下不应用)
        if (!isPureCssMode) {
            // 粗体: **text** 或 __text__
            processedText = processedText.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            processedText = processedText.replace(/__(.+?)__/g, '<strong>$1</strong>');
            
            // 斜体: *text* 或 _text_ (注意不要匹配 URL、路径或 HTML 属性内的内容)
            processedText = processedText.replace(/(?<![\w*/"=])\*([^*\n]+?)\*(?![\w*])/g, '<em>$1</em>');
            processedText = processedText.replace(/(?<![\w_\/."'=])\s_([^_\n]+?)_(?![\w_])/g, ' <em>$1</em>');
            
            // 删除线: ~~text~~
            processedText = processedText.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
        }
        
        // 替换 {{user}} 和 {{char}} 占位符
        processedText = processedText.replace(/\{\{user\}\}/gi, `<span class="cm-macro-user" style="font-weight:bold;color:${userColor};">User</span>`);
        processedText = processedText.replace(/\{\{char\}\}/gi, `<span class="cm-macro-char" style="font-weight:bold;color:${charColor};">${escapeHtml(charName) || '{{char}}'}</span>`);
        
        // 根据模式处理换行
        const divCount = (processedText.match(/<div/gi) || []).length;
        const isHeavyHtml = divCount > 5 || /<table[^>]*>/i.test(processedText);
        
        if (isPureCssMode || isHeavyHtml) {
            // Pure CSS 或 Heavy HTML 模式: 不转换换行 - 布局会处理
        } else {
            // Mixed/Light HTML / Markdown 模式: 转换换行
            processedText = processedText.replace(/\n\n+/g, '<br><br>');
            processedText = processedText.replace(/([^>])\n([^<])/g, '$1<br>$2');
        }
        
        // 恢复 style 块
        styleBlocks.forEach((block, i) => {
            processedText = processedText.replace(`\x00STYLEBLOCK${i}\x00`, block);
        });
        
        return processedText;
    }
    
    // 标准模式: 转义 HTML 以确保安全
    const placeholders = [];
    
    // 辅助函数：添加占位符
    const addPlaceholder = (html) => {
        const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
        placeholders.push(html);
        return placeholder;
    };
    
    // 1. 保留现有的 HTML img 标签 (允许 http/https 和本地路径)
    processedText = processedText.replace(/<img\s+[^>]*src=["']((?:https?:\/\/|\/)[^"']+)["'][^>]*\/?>/gi, (match, src) => {
        return addPlaceholder(`<img src="${src}" class="embedded-image" loading="lazy">`);
    });
    
    // 1b. 保留现有的 HTML audio 标签
    processedText = processedText.replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, (match) => {
        if (!match.includes('audio-player')) {
            match = match.replace(/<audio/, '<audio class="audio-player embedded-audio"');
        }
        return addPlaceholder(match);
    });
    
    // 1c. 转换 audio source 标签为完整的音频播放器
    processedText = processedText.replace(/<source\s+[^>]*src=["']((?:https?:\/\/|\/)[^"']+\.(?:mp3|wav|ogg|m4a|flac|aac))["'][^>]*\/?>/gi, (match, src) => {
        const ext = src.split('.').pop().toLowerCase();
        return addPlaceholder(`<audio controls class="audio-player embedded-audio" preload="metadata"><source src="${src}" type="audio/${ext}">Your browser does not support audio.</audio>`);
    });
    
    // 2. 转换带链接的图片: [![alt](img-url)](link-url)
    processedText = processedText.replace(/\[\!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g, (match, alt, imgSrc, linkHref) => {
        if (!imgSrc.match(/^(https?:\/\/|\/)/i)) return match;
        const altAttr = alt ? ` alt="${alt.replace(/"/g, '"')}"` : '';
        const safeLink = linkHref.match(/^https?:\/\//i) ? linkHref : '#';
        return addPlaceholder(`<a href="${safeLink}" target="_blank" rel="noopener"><img src="${imgSrc}"${altAttr} class="embedded-image" loading="lazy"></a>`);
    });
    
    // 3. 转换独立的 markdown 图片: ![alt](url) 或 ![alt](url "title")
    processedText = processedText.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, alt, src) => {
        if (!src.match(/^(https?:\/\/|\/)/i)) return match;
        const altAttr = alt ? ` alt="${alt.replace(/"/g, '"')}"` : '';
        return addPlaceholder(`<img src="${src}"${altAttr} class="embedded-image" loading="lazy">`);
    });
    
    // 3b. 转换 markdown 音频链接: [any text](url.mp3)
    processedText = processedText.replace(/\[([^\]]*)\]\(((?:https?:\/\/|\/)[^)\s]+\.(?:mp3|wav|ogg|m4a|flac|aac))(?:\s+"[^"]*)?\)/gi, (match, text, src) => {
        const ext = src.split('.').pop().toLowerCase();
        return addPlaceholder(`<audio controls class="audio-player embedded-audio" preload="metadata" title="${escapeHtml(text || 'Audio')}"><source src="${src}" type="audio/${ext}">Your browser does not support audio.</audio>`);
    });
    
    // 4. 转换 markdown 链接: [text](url)
    processedText = processedText.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (match, text, href) => {
        return addPlaceholder(`<a href="${href}" target="_blank" rel="noopener" class="embedded-link">${escapeHtml(text)}</a>`);
    });
    
    // 5. 保留 HTML 标题标签
    processedText = processedText.replace(/<(h[1-6])>([^<]*)<\/\1>/gi, (match, tag, content) => {
        return addPlaceholder(`<${tag} class="embedded-heading">${escapeHtml(content)}</${tag}>`);
    });
    
    // 6. 替换 {{user}} 和 {{char}} 占位符 (在 escapeHtml 之前，使用占位符保护)
    // 这样插入的 HTML 不会被后续的引号替换破坏
    processedText = processedText.replace(/\{\{user\}\}/gi, () => {
        return addPlaceholder(`<span class="cm-macro-user" style="font-weight:bold;color:${userColor};">User</span>`);
    });
    processedText = processedText.replace(/\{\{char\}\}/gi, () => {
        return addPlaceholder(`<span class="cm-macro-char" style="font-weight:bold;color:${charColor};">${escapeHtml(charName) || '{{char}}'}</span>`);
    });

    // 7. 引号文本染色 (在 escapeHtml 之前，使用占位符保护)
    // 英文双引号 ""
    processedText = processedText.replace(/"([^"]+)"/g, (match, content) => {
        if (content.trim()) {
            return addPlaceholder(`<span class="cm-quote-content" style="color:${quoteColor};">"${escapeHtml(content)}"</span>`);
        }
        return match;
    });

        // 中文全角引号 ""
    processedText = processedText.replace(/"([^"]+)"/g, (match, content) => {
        if (content.trim()) {
            return addPlaceholder(`<span class="cm-quote-content" style="color:${quoteColor};">"${escapeHtml(content)}"</span>`);
        }
        return match;
    });
    // 中文直角引号「」
    processedText = processedText.replace(/「([^」]+)」/g, (match, content) => {
        if (content.trim()) {
            return addPlaceholder(`<span class="cm-quote-content" style="color:${quoteColor};">「${escapeHtml(content)}」</span>`);
        }
        return match;
    });
    // 中文直角双引号『』
    processedText = processedText.replace(/『([^』]+)』/g, (match, content) => {
        if (content.trim()) {
            return addPlaceholder(`<span class="cm-quote-content" style="color:${quoteColor};">『${escapeHtml(content)}』</span>`);
        }
        return match;
    });

    
    // 转义 HTML 以防止 XSS
    let formatted = escapeHtml(processedText);
    
    // 恢复所有占位符
    placeholders.forEach((html, i) => {
        formatted = formatted.replace(`__PLACEHOLDER_${i}__`, html);
    });
    
    // 转换 markdown 格式
    // 粗体: **text** 或 __text__
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/__(.+?)__/g, '<strong>$1</strong>');
    
    // 斜体: *text* 或 _text_ (但不在单词或 URL 内)
    formatted = formatted.replace(/(?<![\w*])\*([^*]+?)\*(?![\w*])/g, '<em>$1</em>');
    formatted = formatted.replace(/(?:^|(?<=\s))_([^_]+?)_(?![\w_])/g, '<em>$1</em>');
    
    // 转换换行 - 双换行使用段落分隔，单换行使用 <br>
    formatted = formatted.replace(/\\n/g, '\n');         // 先转换字面量 \n 为实际换行
    formatted = formatted.replace(/\n\n+/g, '</p><p>');  // 双+换行变成段落分隔
    formatted = formatted.replace(/\n/g, '<br>');        // 单换行变成 <br>
    formatted = '<p>' + formatted + '</p>';              // 包裹在段落中
    formatted = formatted.replace(/<p><\/p>/g, '');      // 移除空段落
    
    return formatted;
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
    // 但作为"粗略估算"是可以接受的。
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
