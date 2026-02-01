import { state } from './state.js';
import { generateId, notify } from './utils.js';
import { getSTContext } from './context.js';
import { COLORS } from './constants.js';

export function loadTags() {
    const ctx = getSTContext();
    if (ctx) {
        state.tags = ctx.tags || [];
        state.tagMap = ctx.tagMap || {};
    }
}

export function saveTags() {
    const ctx = getSTContext();
    if (ctx) {
        ctx.tags = state.tags;
        ctx.tagMap = state.tagMap;
        if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
    }
}

export function createTag(name, color) {
    if (!name) return null;
    if (state.tags.some(t => t.name === name)) {
        notify('标签已存在', 'warning');
        return null;
    }
    const tag = { id: generateId(), name: name, color: color || COLORS[0].value, pinned: false };
    state.tags.push(tag);
    saveTags();
    return tag;
}

export function updateTag(tagId, name, color) {
    const tag = state.tags.find(t => t.id === tagId);
    if (tag) { tag.name = name; tag.color = color; saveTags(); return true; }
    return false;
}

export function deleteTag(tagId) {
    const idx = state.tags.findIndex(t => t.id === tagId);
    if (idx > -1) {
        state.tags.splice(idx, 1);
        for (const fileName in state.tagMap) {
            const tagIdx = state.tagMap[fileName].indexOf(tagId);
            if (tagIdx > -1) state.tagMap[fileName].splice(tagIdx, 1);
        }
        saveTags();
        return true;
    }
    return false;
}

export function getCharTags(fileName) {
    const ids = state.tagMap[fileName];
    if (!ids) return [];
    return ids.map(id => state.tags.find(t => t.id === id)).filter(Boolean);
}

export function addTagToChar(fileName, tagId) {
    if (!state.tagMap[fileName]) state.tagMap[fileName] = [];
    if (!state.tagMap[fileName].includes(tagId)) {
        state.tagMap[fileName].push(tagId);
        saveTags();
        return true;
    }
    return false;
}

export function removeTagFromChar(fileName, tagId) {
    const ids = state.tagMap[fileName];
    if (ids) {
        const idx = ids.indexOf(tagId);
        if (idx > -1) {
            ids.splice(idx, 1);
            saveTags();
            return true;
        }
    }
    return false;
}

export function getUntaggedChars() {
    return state.characters.filter(c => {
        const tags = state.tagMap[c.fileName];
        return !tags || tags.length === 0;
    });
}

export function getCharsByTag(tagId) {
    return state.characters.filter(c => {
        const tags = state.tagMap[c.fileName];
        return tags && tags.includes(tagId);
    });
}

export function getFavChars() {
    return state.characters.filter(c => c.fav);
}

export function getTagCharCount(tagId) {
    let count = 0;
    for (const fileName in state.tagMap) {
        if (state.tagMap[fileName].includes(tagId)) count++;
    }
    return count;
}

export function filterAndSortChars(chars) {
    let result = chars;
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const matchMap = new Map();
        result = result.filter(c => {
            let matchType = -1;
            if (c.name.toLowerCase().includes(q)) matchType = 0;
            else {
                const cTags = getCharTags(c.fileName);
                if (cTags.some(t => t.name.toLowerCase().includes(q))) matchType = 1;
                else if ((c.creatorcomment || '').toLowerCase().includes(q)) matchType = 2;
                else if ((c.desc || '').toLowerCase().includes(q)) matchType = 3;
                else if ((c.firstMes || '').toLowerCase().includes(q)) matchType = 4;
            }
            if (matchType > -1) {
                matchMap.set(c.fileName, matchType);
                return true;
            }
            return false;
        });
        result.sort((a, b) => {
            const typeA = matchMap.get(a.fileName);
            const typeB = matchMap.get(b.fileName);
            if (typeA !== typeB) return typeA - typeB;
            return compareChars(a, b);
        });
    } else {
        result.sort(compareChars);
    }
    return result;
}

export function compareChars(a, b) {
    let ret = 0;
    switch (state.sortBy) {
        case 'date':
            ret = (a.date_added || 0) - (b.date_added || 0);
            break;
        case 'access':
            const lastA = a.date_last_chat || a.chat_date || a.last_mes || 0;
            const lastB = b.date_last_chat || b.chat_date || b.last_mes || 0;
            ret = lastA - lastB;
            break;
        case 'name':
            ret = (a.name || '').localeCompare(b.name || '', 'zh-CN', { numeric: true, sensitivity: 'base' });
            break;
        case 'token':
            ret = (a.tokens || 0) - (b.tokens || 0);
            break;
    }
    return state.sortOrder === 'asc' ? ret : -ret;
}
