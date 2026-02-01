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

