import { state } from './state.js';
import { generateId, notify } from './utils.js';
import { getSTContext } from './context.js';
import { COLORS } from './constants.js';
import { authFetch } from './api.js';

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
        if (state.settings.autoSyncTags) {
            syncTagsToCard(fileName);
        }
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
            if (state.settings.autoSyncTags) {
                syncTagsToCard(fileName);
            }
            return true;
        }
    }
    return false;
}

/**
 * 将当前插件中的 Tag 同步写入到角色卡文件的 data.tags 字段
 * @param {string} fileName - 角色卡文件名
 */
export async function syncTagsToCard(fileName) {
    try {
        // 1. 获取当前插件为该角色设置的 Tag 名称列表
        const currentPluginTags = getCharTags(fileName).map(t => t.name);

        // 2. 获取角色完整数据
        const getRes = await authFetch('/api/characters/get', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: fileName })
        });
        
        if (!getRes.ok) {
            console.error('[TagSync] Failed to get char data:', getRes.status);
            return;
        }
        
        const fullData = await getRes.json();
        
        // 3. 定位 tags 字段并合并
        let targetObj = fullData;
        if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
            targetObj = fullData.data;
        }
        
        const existingCardTags = Array.isArray(targetObj.tags) ? targetObj.tags : [];
        
        // 获取所有插件已知 Tag 名称 (用于识别哪些是“受管”的)
        // 逻辑：如果卡片里的 Tag 在插件已知列表中，说明它受插件管理 -> 使用插件当前设置覆盖 (即如果插件里没选，就删掉)
        // 如果卡片里的 Tag 不在插件已知列表中，说明是外部 Tag -> 保留
        const allPluginTagNames = state.tags.map(t => t.name.toLowerCase());
        
        const preservedTags = existingCardTags.filter(t =>
            !allPluginTagNames.includes(String(t).toLowerCase())
        );
        
        // 合并：保留的外部 Tag + 插件当前的 Tag
        // 使用 Set 去重
        const finalTags = [...new Set([...preservedTags, ...currentPluginTags])];
        
        targetObj.tags = finalTags;

        // 4. 保存回文件
        // 使用 merge-attributes 接口进行局部更新，避免全量覆盖导致的数据丢失或 400 错误
        const payload = { avatar: fileName };
        
        if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
            // V2/V3: 更新 data.tags
            payload.data = { tags: finalTags };
        } else {
            // V1: 更新 tags
            payload.tags = finalTags;
        }

        console.log('[TagSync] Sending merge payload for', fileName, payload);

        // 使用 /api/characters/merge-attributes 接口
        const saveRes = await authFetch('/api/characters/merge-attributes', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!saveRes.ok) {
            console.error('[TagSync] Failed to save char data:', saveRes.status);
        } else {
            console.log('[TagSync] Tags synced for', fileName);
        }
    } catch (e) {
        console.error('[TagSync] Error:', e);
    }
}

/**
 * 同步所有角色的 Tag 到文件
 * @param {Function} onProgress - 进度回调 (current, total)
 */
export async function syncAllTags(onProgress) {
    const chars = state.characters;
    let count = 0;
    const total = chars.length;
    
    for (let i = 0; i < total; i++) {
        const char = chars[i];
        await syncTagsToCard(char.fileName);
        count++;
        if (onProgress) onProgress(i + 1, total);
    }
    return count;
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
        case 'gallery':
            ret = (a.galleryCount || 0) - (b.galleryCount || 0);
            break;
    }
    return state.sortOrder === 'asc' ? ret : -ret;
}
