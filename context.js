let doc = document;
let parentWin = window;

try {
    if (window.parent && window.parent.document !== document) {
        doc = window.parent.document;
        parentWin = window.parent;
    }
} catch (e) { }

export { doc, parentWin };

export function getSTContext() {
    const st = parentWin.SillyTavern || window.SillyTavern;
    return st ? st.getContext() : null;
}

export function getSTCharacters() {
    if (parentWin.characters && Array.isArray(parentWin.characters)) return parentWin.characters;
    const ctx = getSTContext();
    if (ctx && ctx.characters) return ctx.characters;
    return [];
}

/**
 * 获取当前正在聊天的角色信息
 * @returns {{ fileName: string, name: string } | null} 当前角色信息，无则返回 null
 */
export function getCurrentChatChar() {
    try {
        // 方法1: 尝试从 parentWin 直接获取 (适用于插件在 iframe 中运行)
        const currentChId = parentWin.this_chid;
        if (typeof currentChId !== 'undefined' && currentChId !== null && 
            parentWin.characters && parentWin.characters[currentChId]) {
            const char = parentWin.characters[currentChId];
            return {
                fileName: char.avatar,
                name: char.name
            };
        }

        // 方法2: 尝试从 SillyTavern Context API 获取
        const ctx = getSTContext();
        if (ctx) {
            // 尝试从 context 获取当前角色 ID
            const ctxCharId = ctx.characterId ?? ctx.this_chid;
            if (typeof ctxCharId !== 'undefined' && ctxCharId !== null && 
                ctx.characters && ctx.characters[ctxCharId]) {
                const char = ctx.characters[ctxCharId];
                return {
                    fileName: char.avatar,
                    name: char.name
                };
            }
        }
    } catch (e) {
        console.warn('[CharManager] 获取当前聊天角色失败:', e);
    }
    return null;
}
