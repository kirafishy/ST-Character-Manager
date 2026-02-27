import { state } from './state.js';
import { generateId, notify, loadJSZip, calculateTokens } from './utils.js';
import { getSTContext, doc, parentWin, getSTCharacters } from './context.js';
import { COLORS } from './constants.js';
import { authFetch } from './api.js';
import { setCache } from './db.js';

/**
 * 比较两个数组是否相等（浅比较）
 * @param {Array} a - 数组 a
 * @param {Array} b - 数组 b
 * @returns {boolean}
 */
function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

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

export function deleteTag(tagId, skipSync = false, markUnsynced = true) {
    const idx = state.tags.findIndex(t => t.id === tagId);
    if (idx > -1) {
        state.tags.splice(idx, 1);
        const affectedFiles = [];
        for (const fileName in state.tagMap) {
            const tagIdx = state.tagMap[fileName].indexOf(tagId);
            if (tagIdx > -1) {
                state.tagMap[fileName].splice(tagIdx, 1);
                affectedFiles.push(fileName);
            }
        }
        saveTags();
        
        if (affectedFiles.length > 0) {
            if (!skipSync && state.settings.autoSyncTags) {
                affectedFiles.forEach(fileName => syncTagsToCard(fileName));
            } else if (skipSync && markUnsynced) {
                state.hasUnsyncedTags = true;
                setCache('hasUnsyncedTags', true);
                
                // 记录哪些卡片需要同步
                if (!state.unsyncedCards) state.unsyncedCards = new Set();
                affectedFiles.forEach(fileName => state.unsyncedCards.add(fileName));
            }
        }
        
        return true;
    }
    return false;
}

export function getCharTags(fileName) {
    const ids = state.tagMap[fileName];
    if (!ids) return [];
    return ids.map(id => state.tags.find(t => t.id === id)).filter(Boolean);
}

export async function addTagToChar(fileName, tagId, skipSync = false, markUnsynced = true) {
    if (!state.tagMap[fileName]) state.tagMap[fileName] = [];
    if (!state.tagMap[fileName].includes(tagId)) {
        state.tagMap[fileName].push(tagId);
        saveTags();
        
        // 始终保存 cm_manager.tags 到文件
        const tagNames = getCharTags(fileName).map(t => t.name);
        await saveCmManagerTagsToCard(fileName, tagNames);
        
        // 如果开启自动同步到 data.tags，则同步
        if (!skipSync && state.settings.autoSyncTags) {
            await syncTagsToCard(fileName);
        } else if (markUnsynced) {
            state.hasUnsyncedTags = true;
            setCache('hasUnsyncedTags', true);
            
            // 记录哪些卡片需要同步到 data.tags
            if (!state.unsyncedCards) state.unsyncedCards = new Set();
            state.unsyncedCards.add(fileName);
        }
        return true;
    }
    return false;
}

export async function removeTagFromChar(fileName, tagId, skipSync = false, markUnsynced = true) {
    const ids = state.tagMap[fileName];
    if (ids) {
        const idx = ids.indexOf(tagId);
        if (idx > -1) {
            ids.splice(idx, 1);
            saveTags();
            
            // 始终保存 cm_manager.tags 到文件
            const tagNames = getCharTags(fileName).map(t => t.name);
            await saveCmManagerTagsToCard(fileName, tagNames);
            
            // 如果开启自动同步到 data.tags，则同步
            if (!skipSync && state.settings.autoSyncTags) {
                await syncTagsToCard(fileName);
            } else if (markUnsynced) {
                state.hasUnsyncedTags = true;
                setCache('hasUnsyncedTags', true);
                
                // 记录哪些卡片需要同步到 data.tags
                if (!state.unsyncedCards) state.unsyncedCards = new Set();
                state.unsyncedCards.add(fileName);
            }
            return true;
        }
    }
    return false;
}

/**
 * 保存 cm_manager.tags 到角色卡文件
 * @param {string} fileName - 角色文件名
 * @param {string[]} tagNames - 标签名称数组
 */
async function saveCmManagerTagsToCard(fileName, tagNames) {
    await saveCharacterData(fileName, (data) => {
        if (!data.extensions) data.extensions = {};
        if (!data.extensions.cm_manager) {
            data.extensions.cm_manager = {};
        }
        data.extensions.cm_manager.tags = tagNames;
    });
}

/**
 * 将当前插件中的 Tag 同步写入到角色卡文件的 data.tags 字段
 * @param {string} fileName - 角色卡文件名
 */
export async function replaceCharacterImage(char, file) {
    try {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise(r => img.onload = r);

        const canvas = doc.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const cleanBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));

        const getRes = await authFetch('/api/characters/get', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: char.fileName })
        });
        if (!getRes.ok) throw new Error('无法读取角色数据');
        const fullData = await getRes.json();

        const dataBlock = fullData.data || fullData;

        const fd = new FormData();
        fd.append('ch_name', dataBlock.name || char.name);
        fd.append('avatar', cleanBlob, file.name);
        fd.append('avatar_url', char.fileName);
        fd.append('json_data', JSON.stringify(fullData));

        const explicitFields = [
            'description', 'first_mes', 'personality', 'scenario',
            'mes_example', 'creator_notes', 'system_prompt',
            'post_history_instructions', 'creator', 'character_version',
            'talkativeness'
        ];

        explicitFields.forEach(k => {
            if (dataBlock[k] !== undefined && dataBlock[k] !== null) {
                fd.append(k, dataBlock[k]);
            }
        });

        if (Array.isArray(dataBlock.alternate_greetings)) {
            dataBlock.alternate_greetings.forEach(g => fd.append('alternate_greetings', g));
        }
        if (Array.isArray(dataBlock.tags)) {
            dataBlock.tags.forEach(t => fd.append('tags', t));
        }

        const isFav = dataBlock.extensions?.fav || dataBlock.fav;
        fd.append('fav', isFav ? 'true' : 'false');

        // 显式处理 character_book 以防止世界书解绑
        if (dataBlock.character_book) {
            if (typeof dataBlock.character_book === 'string') {
                fd.append('character_book', dataBlock.character_book);
            } else if (typeof dataBlock.character_book === 'object') {
                fd.append('character_book', JSON.stringify(dataBlock.character_book));
            }
        }

        const r = await authFetch('/api/characters/edit', {
            method: 'POST',
            body: fd
        });

        if (!r.ok) throw new Error(await r.text());

        char.avatarUrl = '/characters/' + encodeURIComponent(char.fileName) + '?t=' + Date.now();
        return true;
    } catch (e) {
        console.error(e);
        throw new Error('更换图片失败: ' + e.message);
    }
}

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
        
        // 获取所有插件已知 Tag 名称 (用于识别哪些是"受管"的)
        // 逻辑：如果卡片里的 Tag 在插件已知列表中，说明它受插件管理 -> 使用插件当前设置覆盖 (即如果插件里没选，就删掉)
        // 如果卡片里的 Tag 不在插件已知列表中，说明是外部 Tag -> 保留
        const allPluginTagNames = state.tags.map(t => t.name.toLowerCase());
        
        const preservedTags = existingCardTags.filter(t =>
            !allPluginTagNames.includes(String(t).toLowerCase())
        );
        
        // 合并：保留的外部 Tag + 插件当前的 Tag
        // 使用 Set 去重
        const finalTags = [...new Set([...preservedTags, ...currentPluginTags])];
        
        // 获取现有的 cm_manager.tags
        const existingCmManagerTags = targetObj.extensions?.cm_manager?.tags || null;
        
        // 检查是否有变化（tags 或 cm_manager.tags）
        const tagsChanged = !arraysEqual(existingCardTags.sort(), finalTags.sort());
        const cmTagsChanged = !arraysEqual(existingCmManagerTags?.sort() || [], currentPluginTags.sort());
        
        // 如果没有任何变化，跳过写入以避免修改文件时间
        if (!tagsChanged && !cmTagsChanged) {
            console.log('[TagSync] No changes for', fileName, '- skipping write');
            return;
        }

        targetObj.tags = finalTags;

        // 4. 同步 cm_manager.tags 到角色卡
        // 确保 extensions 结构存在
        if (!targetObj.extensions) targetObj.extensions = {};
        if (!targetObj.extensions.cm_manager) {
            targetObj.extensions.cm_manager = {};
        }
        // 更新 cm_manager.tags 为当前插件的标签
        targetObj.extensions.cm_manager.tags = currentPluginTags;

        // 5. 保存回文件
        // 使用 merge-attributes 接口进行局部更新，避免全量覆盖导致的数据丢失或 400 错误
        const payload = { avatar: fileName };
        
        if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
            // V2/V3: 更新 data.tags 和 data.extensions
            payload.data = {
                tags: finalTags,
                extensions: targetObj.extensions
            };
        } else {
            // V1: 更新 tags 和 extensions
            payload.tags = finalTags;
            payload.extensions = targetObj.extensions;
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
    // 如果有记录未同步的卡片，则只同步这些卡片
    const targetFiles = (state.unsyncedCards && state.unsyncedCards.size > 0)
        ? Array.from(state.unsyncedCards)
        : state.characters.map(c => c.fileName);
        
    let count = 0;
    const total = targetFiles.length;
    
    if (total === 0) {
        state.hasUnsyncedTags = false;
        setCache('hasUnsyncedTags', false);
        if (state.unsyncedCards) state.unsyncedCards.clear();
        return 0;
    }
    
    const concurrency = 50;
    let currentIndex = 0;

    const worker = async () => {
        while (currentIndex < total) {
            const i = currentIndex++;
            const fileName = targetFiles[i];
            await syncTagsToCard(fileName);
            count++;
            if (onProgress) onProgress(count, total);
        }
    };

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(worker());
    }

    await Promise.all(workers);
    
    state.hasUnsyncedTags = false;
    setCache('hasUnsyncedTags', false);
    if (state.unsyncedCards) state.unsyncedCards.clear();
    
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

export async function saveCharacterData(fileName, updateCallback) {
    try {
        const getRes = await authFetch('/api/characters/get', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: fileName })
        });
        if (!getRes.ok) throw new Error('无法读取角色数据');
        const fullData = await getRes.json();

        let charData = fullData;
        if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
            charData = fullData.data;
        }

        updateCallback(charData);

        // --- 修复：防止收藏操作导致世界书解绑 ---
        // 如果 API 返回的数据中丢失了 world book 信息（可能为空或 undefined），尝试从酒馆内存缓存中恢复
        // 只有当 updateCallback 没有明确设置（即非有意删除）时才恢复
        if (!charData.character_book) {
            try {
                const stChars = typeof getSTCharacters === 'function' ? getSTCharacters() : [];
                const cached = stChars.find(c => c.avatar === fileName);
                if (cached) {
                    // V3数据在data里，V2/Internal直接在对象上
                    const cachedBook = (cached.data && cached.data.character_book) || cached.character_book;
                    if (cachedBook) {
                        // 再次确认 cachedBook 不是空字符串
                        console.log('[CharManager] 检测到 API 数据丢失 character_book，已从缓存恢复:', cachedBook);
                        charData.character_book = cachedBook;
                    }
                }
            } catch (e) { console.warn('尝试恢复 character_book 失败', e); }
        }
        // -------------------------------------

        const fd = new FormData();

        fd.append('ch_name', charData.name || fileName.replace(/\.png$/i, ''));
        fd.append('avatar_url', fileName);
        fd.append('avatar', new Blob([''], { type: 'application/octet-stream' }), '');

        // Removed 'tags' from this list to handle it explicitly
        const fields = [
            'fav', 'description', 'first_mes', 'personality', 'scenario',
            'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions',
            'character_version', 'creator', 'talkativeness', 'alternate_names'
        ];

        fields.forEach(k => {
            if (charData[k] !== undefined && charData[k] !== null) {
                fd.append(k, charData[k]);
            }
            if (k === 'fav') {
                if (charData.extensions && charData.extensions.fav !== undefined) {
                    fd.set('fav', charData.extensions.fav.toString());
                } else if (charData.fav !== undefined) {
                    fd.set('fav', charData.fav.toString());
                }
            }
        });

        // Explicitly handle array fields to prevent data loss
        if (charData.alternate_greetings && Array.isArray(charData.alternate_greetings)) {
            charData.alternate_greetings.forEach(g => fd.append('alternate_greetings', g));
        }

        if (charData.tags && Array.isArray(charData.tags)) {
            charData.tags.forEach(t => fd.append('tags', t));
        }

        // 显式处理 character_book 以防止世界书解绑
        if (charData.character_book) {
            if (typeof charData.character_book === 'string') {
                fd.append('character_book', charData.character_book);
            } else if (typeof charData.character_book === 'object') {
                // 如果是对象形式，保留完整结构
                fd.append('character_book', JSON.stringify(charData.character_book));
            }
        }

        if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
            fullData.data = charData;
        }
        fd.append('json_data', JSON.stringify(fullData));

        const r = await authFetch('/api/characters/edit', {
            method: 'POST',
            body: fd
        });

        if (!r.ok) throw new Error(await r.text());
        return true;
    } catch (e) {
        console.error(e);
        notify('保存失败: ' + e.message, 'error');
        return false;
    }
}

export async function deleteWorldInfo(wiName, skipRefresh = false) {
    // 兼容传入对象的情况
    if (typeof wiName === 'object' && wiName !== null) {
        wiName = wiName.name;
    }

    if (!wiName || typeof wiName !== 'string') {
        console.warn('[CharManager] 删除世界书失败: 无效的名称参数', wiName);
        return false;
    }

    try {
        let r = await authFetch('/api/worldinfo/delete', {
            method: 'POST',
            body: JSON.stringify({ name: wiName })
        });

        // 兼容性尝试：如果失败且没有后缀，加上 .json 再试一次
        if (!r.ok && !wiName.toLowerCase().endsWith('.json')) {
            // console.log('[CharManager] 删除WI失败，尝试追加.json后缀重试...');
            r = await authFetch('/api/worldinfo/delete', {
                method: 'POST',
                body: JSON.stringify({ name: wiName + '.json' })
            });
        }

        if (!r.ok) {
            console.warn('[CharManager] 删除世界书失败:', wiName, r.status);
            // 这里返回 false 但不抛出异常，防止阻塞主流程
            return false;
        }

        if (skipRefresh) return true;

        try {
            if (parentWin.SillyTavern && parentWin.SillyTavern.getContext) {
                const context = parentWin.SillyTavern.getContext();
                if (typeof context.updateWorldInfoList === 'function') {
                    await context.updateWorldInfoList();
                }
            }
        } catch (e) { }
        return true;
    } catch (err) {
        console.error('[CharManager] 删除世界书时发生异常:', err);
        return false;
    }
}

export async function updateCharacter(fileName, newCharData, imageBlob = null, options = {}) {
    const {
        cleanOldWorldInfo = true,
        preserveSourceLink = true,
        refreshUI = true,
        notifySuccess = true,
        fullCardData = null
    } = options;

    const char = state.characters.find(c => c.fileName === fileName);
    if (!char) throw new Error('未找到目标角色: ' + fileName);

    // 1. 清理旧世界书逻辑
    // 如果新数据指定了新的 WB，且旧 WB 不再被使用，则尝试删除旧 WB
    if (cleanOldWorldInfo && char.character_book && newCharData.character_book) {
        const oldWI = char.character_book;
        // 如果新旧 WB 不同（且旧的不为空）
        // 注意：这里简单比较名称，如果是对象则比较 name
        let oldWIName = typeof oldWI === 'object' ? oldWI.name : oldWI;
        let newWIName = typeof newCharData.character_book === 'object' ? newCharData.character_book.name : newCharData.character_book;

        if (oldWIName && oldWIName !== newWIName) {
            const isUsedByOthers = state.characters.some(c => c.fileName !== fileName && c.character_book === oldWIName);
            if (!isUsedByOthers) {
                try {
                    console.log('[CharManager] 自动清理旧世界书:', oldWIName);
                    await deleteWorldInfo(oldWIName, true); // skipRefresh=true
                } catch (e) {
                    console.warn('[CharManager] 清理旧世界书失败:', e);
                }
            }
        }
    }

    // 2. 构建 FormData
    const fd = new FormData();
    fd.append('ch_name', newCharData.name || char.name);
    fd.append('avatar_url', fileName);
    
    if (imageBlob) {
        fd.append('avatar', imageBlob);
    } else {
        fd.append('avatar', new Blob([''], { type: 'application/octet-stream' }), '');
    }

    // 3. 保留 Source Link
    if (preserveSourceLink) {
        const savedLink = char.source_link || '';
        if (savedLink) {
            if (!newCharData.extensions) newCharData.extensions = {};
            newCharData.extensions.source_url = savedLink;
            // 删除旧字段以保持整洁（可选）
            if (newCharData.extensions.source_link) delete newCharData.extensions.source_link;
        }
    }

    // 4. 添加字段
    const fields = [
        'description', 'first_mes', 'personality', 'scenario',
        'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions',
        'character_version', 'creator', 'talkativeness'
    ];

    fields.forEach(k => {
        if (newCharData[k] !== undefined && newCharData[k] !== null) {
            fd.append(k, newCharData[k]);
        }
    });

    if (newCharData.alternate_greetings && Array.isArray(newCharData.alternate_greetings)) {
        newCharData.alternate_greetings.forEach(g => fd.append('alternate_greetings', g));
    }

    if (newCharData.tags && Array.isArray(newCharData.tags)) {
        newCharData.tags.forEach(t => fd.append('tags', t));
    }

    // 5. 处理收藏状态
    const isFav = newCharData.extensions?.fav || newCharData.fav;
    fd.append('fav', isFav ? 'true' : 'false');

    // 6. 处理世界书
    if (newCharData.character_book) {
        if (typeof newCharData.character_book === 'string') {
            fd.append('character_book', newCharData.character_book);
        } else if (typeof newCharData.character_book === 'object') {
            fd.append('character_book', JSON.stringify(newCharData.character_book));
        }
    }

    // 7. 附加完整 JSON 数据 (如果提供)
    if (fullCardData) {
        fd.append('json_data', JSON.stringify(fullCardData));
    }

    const r = await authFetch('/api/characters/edit', {
        method: 'POST',
        body: fd
    });

    if (!r.ok) throw new Error(await r.text());

    // 8. 更新本地状态
    Object.assign(char, newCharData);
    char.avatarUrl = '/characters/' + encodeURIComponent(char.fileName) + '?t=' + Date.now();
    
    if (notifySuccess) notify('角色更新成功', 'success');
    return true;
}

export async function toggleFavorite(fileName, currentFavState) {
    const newState = !currentFavState;
    let isActiveChar = false;
    try {
        const currentChId = parentWin.this_chid;
        if (typeof currentChId !== 'undefined' && parentWin.characters && parentWin.characters[currentChId]) {
            const curName = parentWin.characters[currentChId].avatar.split('/').pop();
            const tarName = fileName.split('/').pop();
            if (curName === tarName) isActiveChar = true;
        }
    } catch (e) { }
    if (isActiveChar) {
        const domBtn = parentWin.document.getElementById('favorite_button');
        if (domBtn) {
            domBtn.click();
            const char = state.characters.find(c => c.fileName === fileName);
            if (char) char.fav = newState;
            notify(newState ? '已收藏 (当前角色)' : '取消收藏 (当前角色)', 'success');
            return newState;
        }
    }
    const char = state.characters.find(c => c.fileName === fileName);
    
    // 如果不是当前角色，手动调用 API
    try {
        await saveCharacterData(fileName, (data) => {
            if (!data.extensions) data.extensions = {};
            data.extensions.fav = newState;
            data.fav = newState;
        });
        if (char) char.fav = newState;
        notify(newState ? '已收藏' : '取消收藏', 'success');
        return newState;
    } catch (e) {
        notify('操作失败: ' + e.message, 'error');
        return currentFavState;
    }
}

export async function updateCharacterVersion(char, newVersion) {
    try {
        await saveCharacterData(char.fileName, (data) => {
            data.character_version = newVersion;
        });
        char.version = newVersion;
        notify('版本号已更新', 'success');
        return true;
    } catch (e) {
        notify('版本号更新失败: ' + e.message, 'error');
        return false;
    }
}

export async function renameCharacterFile(char, newName) {
    if (!newName || newName === char.name) return null;
    try {
        const r = await authFetch('/api/characters/rename', {
            method: 'POST',
            body: JSON.stringify({
                avatar_url: char.fileName,
                new_name: newName
            })
        });
        if (!r.ok) throw new Error('重命名失败');

        const data = await r.json();
        const newFileName = (data && data.avatar) ? data.avatar : (newName + '.png');

        const oldFileName = char.fileName;
        if (state.tagMap[oldFileName]) {
            state.tagMap[newFileName] = state.tagMap[oldFileName];
            delete state.tagMap[oldFileName];
            saveTags();
        }
        if (state.selectedCards.has(oldFileName)) {
            state.selectedCards.delete(oldFileName);
            state.selectedCards.add(newFileName);
        }

        char.fileName = newFileName;
        char.name = newName;
        char.avatarUrl = '/characters/' + encodeURIComponent(newFileName);

        notify('重命名成功', 'success');
        return true;
    } catch (e) {
        notify('重命名失败: ' + e.message, 'error');
        return false;
    }
}

export async function downloadChar(fn) {
    const r = await authFetch('/characters/' + encodeURIComponent(fn));
    const b = await r.blob();
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = fn;
    doc.body.appendChild(a);
    a.click();
    a.remove();
}

export async function downloadAsZip(files) {
    try {
        const JSZip = await loadJSZip();
        const zip = new JSZip();
        let count = 0;
        const total = files.length;
        notify('正在准备打包 ' + total + ' 个角色...', 'info');
        for (const fn of files) {
            try {
                const r = await authFetch('/characters/' + encodeURIComponent(fn));
                const blob = await r.blob();
                zip.file(fn, blob);
                count++;
            } catch (e) {
                console.error('Download failed for ' + fn, e);
            }
        }
        const content = await zip.generateAsync({ type: 'blob' });
        const a = doc.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'characters_backup_' + new Date().toISOString().slice(0, 10) + '.zip';
        doc.body.appendChild(a);
        a.click();
        a.remove();
        notify('打包下载完成', 'success');
    } catch (e) {
        console.error(e);
        notify('打包下载失败: ' + e.message, 'error');
    }
}

export async function getCharChatHistory(char) {
    try {
        const response = await authFetch('/api/characters/chats', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: char.fileName })
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (typeof data === 'object' && data.error === true) return [];

        // 返回聊天记录数组，包含 file_name, last_mes, file_size 等信息
        const chats = Object.values(data);
        return chats.sort((a, b) => (b.last_mes || 0) - (a.last_mes || 0));
    } catch (e) {
        console.warn('[CharManager] getCharChatHistory error:', e);
        return [];
    }
}

export async function getCharHistoryCount(char) {
    const history = await getCharChatHistory(char);
    return history.length;
}

export async function deleteChatFile(chatId) {
    try {
        const r = await authFetch('/api/chats/delete', {
            method: 'POST',
            body: JSON.stringify({ chat_file: chatId })
        });
        if (!r.ok) throw new Error('删除失败');
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

export async function deleteWiEntry(wiName, uid) {
    if (!wiName || !uid) return false;
    try {
        const res = await authFetch('/api/worldinfo/get', {
            method: 'POST',
            body: JSON.stringify({ name: wiName })
        });
        if (!res.ok) return false;
        
        const data = await res.json();
        if (!data || !data.entries) return false;

        let ok = false;
        // Check for dictionary style entries
        if (data.entries[uid]) {
            delete data.entries[uid];
            ok = true;
        }
        // Check for array style entries
        else if (Array.isArray(data.entries)) {
            const idx = data.entries.findIndex(e => e.uid == uid || e.id == uid);
            if (idx > -1) {
                data.entries.splice(idx, 1);
                ok = true;
            }
        }

        if (ok) {
            await authFetch('/api/worldinfo/edit', {
                method: 'POST',
                body: JSON.stringify({ name: wiName, data: data })
            });
            
            // Refresh WI list if possible
            if (parentWin.SillyTavern && parentWin.SillyTavern.getContext) {
                const ctx = parentWin.SillyTavern.getContext();
                if (ctx.updateWorldInfoList) await ctx.updateWorldInfoList();
            }
        }
        return ok;
    } catch (e) {
        console.warn('[CharManager] deleteWiEntry error', e);
        return false;
    }
}

export async function deleteChar(char, { deleteChats = false, deleteWi = false } = {}) {
    const fileName = char.fileName || char.avatar;

    if (deleteWi && char.character_book) {
        try {
            // Try to delete the specific entry first (cleanup)
            await deleteWiEntry(char.character_book, char.name);
            // Then delete the book
            await deleteWorldInfo(char.character_book);
        } catch (e) {
            console.error('[CharManager] Failed to delete World Info:', e);
        }
    }

    // 优先尝试调用酒馆原生的删除逻辑
    if (typeof window.deleteCharacter === 'function') {
        if (deleteChats) {
            try {
                // 确保传入正确的 fileName
                const charObj = { ...char, fileName: fileName };
                const chats = await getCharChatHistory(charObj);
                for (const chat of chats) {
                    if (chat.file_name) {
                        await deleteChatFile(chat.file_name);
                    }
                }
            } catch (e) {
                console.error('[CharManager] Failed to delete chats:', e);
            }
        }

        await window.deleteCharacter(fileName);
        return;
    }

    // Fallback: 使用 API 删除
    const r = await authFetch('/api/characters/delete', {
        method: 'POST',
        body: JSON.stringify({
            avatar_url: fileName,
            delete_chats: deleteChats
        })
    });
    
    if (!r.ok) throw new Error('删除失败');

    // 同步移除酒馆内存中的角色，防止快速刷新时误判为新角色
    if (parentWin.characters && Array.isArray(parentWin.characters)) {
        const idx = parentWin.characters.findIndex(c => c.avatar === fileName);
        if (idx !== -1) parentWin.characters.splice(idx, 1);
    }

    // 刷新酒馆原生的角色列表
    try {
        if (parentWin.SillyTavern && parentWin.SillyTavern.getContext) {
            const context = parentWin.SillyTavern.getContext();
            if (typeof context.getCharacters === 'function') {
                await context.getCharacters();
            }
        } else if (typeof parentWin.getCharacters === 'function') {
            // Fallback for older versions
            await parentWin.getCharacters();
        }
    } catch (e) {
        console.warn('[CharManager] Failed to refresh character list:', e);
    }
}
