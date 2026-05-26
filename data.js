import { state } from './state.js';
import { generateId, notify, loadJSZip, calculateTokens } from './utils.js';
import { getSTContext, doc, parentWin, getSTCharacters, getCurrentChatChar } from './context.js';
import { COLORS } from './constants.js';
import { authFetch } from './api.js';
import { setCache, setCacheBatch } from './db.js';
import { createBaseDialog } from './ui-utils.js';
import { extractCharDataFromPNG, stripCharMetadataFromPNG } from './utils/png-metadata.js';

// 文件写入串行队列 - 防止同一文件的并发写操作互相覆盖
const fileWriteQueues = new Map();

/**
 * 获取指定文件的写入队列（串行化执行）
 * 【修复】添加队列清理逻辑，防止内存泄漏
 * @param {string} fileName - 文件名
 * @returns {{ wait: Promise<void>, done: Function }}
 */
function enqueueFileWrite(fileName) {
    const existing = fileWriteQueues.get(fileName) || Promise.resolve();
    let resolveNext;
    const newQueue = existing.then(() => new Promise(resolve => {
        resolveNext = resolve;
    })).finally(() => {
        // 队列完成后清理，防止内存泄漏
        if (fileWriteQueues.get(fileName) === newQueue) {
            fileWriteQueues.delete(fileName);
        }
    });
    fileWriteQueues.set(fileName, newQueue);
    return { wait: existing, done: () => resolveNext() };
}

/**
 * 统一持久化门面函数
 * 在所有元数据变更成功后调用，确保内存状态同步写入 IndexedDB
 * 【修复】解决防抖模式下 Promise 链断裂问题
 * @param {boolean} immediate - 是否立即写入（跳过 debounce）
 * @returns {Promise<void>}
 */
let persistTimeout = null;
let persistResolveQueue = [];

export async function persistCharacterState(immediate = false) {
    // 防抖：200ms 内的多次调用合并为一次
    if (!immediate) {
        return new Promise(resolve => {
            // 将所有等待的 resolver 加入队列
            persistResolveQueue.push(resolve);
            
            if (persistTimeout) clearTimeout(persistTimeout);
            
            persistTimeout = setTimeout(async () => {
                persistTimeout = null;
                try {
                    await setCache('characters', state.characters);
                } catch (e) {
                    console.error('[CharManager] Failed to persist character state:', e);
                }
                // resolve 所有等待的 Promise
                const queue = persistResolveQueue;
                persistResolveQueue = [];
                queue.forEach(r => r());
            }, 200);
        });
    }
    
    // 立即写入模式
    try {
        await setCache('characters', state.characters);
    } catch (e) {
        console.error('[CharManager] Failed to persist character state:', e);
        throw e;
    }
}

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

export async function deleteTag(tagId, skipSync = false, markUnsynced = true) {
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
                // 使用 Promise.all 等待所有同步操作完成
                await Promise.all(affectedFiles.map(fileName => syncTagsToCard(fileName)));
            } else if (skipSync && markUnsynced) {
                state.hasUnsyncedTags = true;
                // 使用 await 确保状态位写入完成
                await setCache('hasUnsyncedTags', true);
                
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

export async function addTagToChar(fileName, tagId, skipSync = false, markUnsynced = true, skipSaveToFile = false) {
    if (!state.tagMap[fileName]) state.tagMap[fileName] = [];
    if (!state.tagMap[fileName].includes(tagId)) {
        state.tagMap[fileName].push(tagId);
        saveTags();
        
        if (!skipSaveToFile) {
            // 始终保存 cm_manager.tags 到文件
            const tagNames = getCharTags(fileName).map(t => t.name);
            await saveCmManagerTagsToCard(fileName, tagNames);
        }
        
        // 如果开启自动同步到 data.tags，则同步
        if (!skipSync && state.settings.autoSyncTags) {
            await syncTagsToCard(fileName);
        } else if (markUnsynced) {
            state.hasUnsyncedTags = true;
            // 使用 await 确保状态位写入完成
            await setCache('hasUnsyncedTags', true);
            
            // 记录哪些卡片需要同步到 data.tags
            if (!state.unsyncedCards) state.unsyncedCards = new Set();
            state.unsyncedCards.add(fileName);
        }
        return true;
    }
    return false;
}

export async function removeTagFromChar(fileName, tagId, skipSync = false, markUnsynced = true, skipSaveToFile = false) {
    const ids = state.tagMap[fileName];
    if (ids) {
        const idx = ids.indexOf(tagId);
        if (idx > -1) {
            ids.splice(idx, 1);
            saveTags();
            
            if (!skipSaveToFile) {
                // 始终保存 cm_manager.tags 到文件
                const tagNames = getCharTags(fileName).map(t => t.name);
                await saveCmManagerTagsToCard(fileName, tagNames);
            }
            
            // 如果开启自动同步到 data.tags，则同步
            if (!skipSync && state.settings.autoSyncTags) {
                await syncTagsToCard(fileName);
            } else if (markUnsynced) {
                state.hasUnsyncedTags = true;
                // ✅ P2-1 修复: 使用 await 确保状态位写入完成
                await setCache('hasUnsyncedTags', true);
                
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
 * @returns {Promise<boolean>} 是否保存成功
 */
async function saveCmManagerTagsToCard(fileName, tagNames) {
    const result = await saveCharacterData(fileName, (data) => {
        if (!data.extensions) data.extensions = {};
        if (!data.extensions.cm_manager) {
            data.extensions.cm_manager = {};
        }
        data.extensions.cm_manager.tags = tagNames;
    });
    
    if (result) {
        // 同步更新酒馆内存中的角色对象，防止快速刷新时被旧数据覆盖
        syncCmManagerTagsToSTMemory(fileName, tagNames);
    } else {
        console.warn(`[CharManager] saveCmManagerTagsToCard 失败: ${fileName}`);
    }
    
    return result;
}

/**
 * 同步更新酒馆内存中角色对象的 cm_manager.tags
 * @param {string} fileName - 角色文件名
 * @param {string[]} tagNames - 标签名称数组
 */
export function syncCmManagerTagsToSTMemory(fileName, tagNames) {
    // 更新 state.characters 中的角色对象（最重要，因为插件主要使用这个）
    const stateChar = state.characters.find(c => c.fileName === fileName);
    if (stateChar) {
        if (!stateChar.data) stateChar.data = {};
        if (!stateChar.data.extensions) stateChar.data.extensions = {};
        if (!stateChar.data.extensions.cm_manager) stateChar.data.extensions.cm_manager = {};
        stateChar.data.extensions.cm_manager.tags = tagNames;
    }
    
    // 更新 parentWin.characters 中的角色对象
    if (parentWin.characters && Array.isArray(parentWin.characters)) {
        const stChar = parentWin.characters.find(c => c.avatar === fileName);
        if (stChar) {
            if (!stChar.data) stChar.data = {};
            if (!stChar.data.extensions) stChar.data.extensions = {};
            if (!stChar.data.extensions.cm_manager) stChar.data.extensions.cm_manager = {};
            stChar.data.extensions.cm_manager.tags = tagNames;
        }
    }
    
    // 更新 ctx.characters 中的角色对象
    const ctx = getSTContext();
    if (ctx && ctx.characters) {
        const ctxChar = ctx.characters.find(c => c.avatar === fileName);
        if (ctxChar) {
            if (!ctxChar.data) ctxChar.data = {};
            if (!ctxChar.data.extensions) ctxChar.data.extensions = {};
            if (!ctxChar.data.extensions.cm_manager) ctxChar.data.extensions.cm_manager = {};
            ctxChar.data.extensions.cm_manager.tags = tagNames;
        }
    }
}

/**
 * 深度合并辅助函数
 * 递归合并源对象到目标对象，保留目标对象中源对象不存在的属性
 * 【修复】添加循环引用检测，防止恶意数据导致栈溢出
 * @param {object} target - 目标对象
 * @param {object} source - 源对象（新数据）
 * @param {WeakSet} [seen] - 已访问对象集合（用于检测循环引用）
 * @param {number} [depth] - 当前递归深度
 */
const MAX_MERGE_DEPTH = 20;

function deepMerge(target, source, seen = new WeakSet(), depth = 0) {
    if (!source) return target;
    if (!target) return source;
    
    // 防止循环引用和过深递归
    if (depth > MAX_MERGE_DEPTH) {
        console.warn('[CharManager] deepMerge: 达到最大深度限制，停止递归');
        return target;
    }
    if (seen.has(source)) {
        console.warn('[CharManager] deepMerge: 检测到循环引用，跳过');
        return target;
    }
    seen.add(source);
    
    for (const key in source) {
        if (source[key] !== undefined) {
            // 只对纯对象进行递归合并，数组和基本类型直接覆盖
            if (
                source[key] !== null &&
                typeof source[key] === 'object' &&
                !Array.isArray(source[key]) &&
                target[key] !== null &&
                typeof target[key] === 'object' &&
                !Array.isArray(target[key])
            ) {
                deepMerge(target[key], source[key], seen, depth + 1);
            } else {
                target[key] = source[key];
            }
        }
    }
    return target;
}

/**
 * 同步更新酒馆内存中角色对象的完整数据
 *
 * 【重要 2026-03-26】Luker 改版兼容性修复
 * Luker 改版的 SillyTavern 使用 Proxy 拦截对 ctx.characters 的写入操作
 * 直接设置根层级字段（如 charObj.name = xxx）会触发警告：
 * "Deprecated character API write"
 *
 * 正确做法：写入 data.* 路径，Luker 会自动同步到根层级
 * - charObj.data.name = xxx  ✓ 正确
 * - charObj.name = xxx       ✗ 会触发警告
 *
 * @param {string} fileName - 角色文件名
 * @param {object} newCharData - 新的角色数据
 */
function syncCharDataToMemory(fileName, newCharData) {
    // 辅助函数：更新单个角色对象
    const updateCharObject = (charObj) => {
        if (!charObj) return;
        
        // 确保 data 对象存在
        if (!charObj.data) charObj.data = {};
        
        // 【Luker 兼容】写入 data.* 路径，而不是根层级
        // Luker 的 Proxy 会自动同步到根层级（向后兼容）
        // 这样就不会触发 "Deprecated character API write" 警告
        
        // 基础字段：写入 data.* 路径
        if (newCharData.name !== undefined) charObj.data.name = newCharData.name;
        if (newCharData.description !== undefined) charObj.data.description = newCharData.description;
        if (newCharData.personality !== undefined) charObj.data.personality = newCharData.personality;
        if (newCharData.scenario !== undefined) charObj.data.scenario = newCharData.scenario;
        if (newCharData.first_mes !== undefined) charObj.data.first_mes = newCharData.first_mes;
        if (newCharData.mes_example !== undefined) charObj.data.mes_example = newCharData.mes_example;
        if (newCharData.tags !== undefined) charObj.data.tags = newCharData.tags;
        
        // creator_notes 写入 data.* 路径
        if (newCharData.creator_notes !== undefined) {
            charObj.data.creator_notes = newCharData.creator_notes;
        }
        
        // 收藏状态：写入 data.extensions.* 路径
        if (newCharData.fav !== undefined) {
            if (!charObj.data.extensions) charObj.data.extensions = {};
            charObj.data.extensions.fav = newCharData.fav;
        }
        
        // 更新 extensions 字段（包括 system_prompt, post_history_instructions, cm_manager 等）
        if (newCharData.system_prompt !== undefined ||
            newCharData.post_history_instructions !== undefined ||
            newCharData.extensions) {
            if (!charObj.data.extensions) charObj.data.extensions = {};
            
            // system_prompt 和 post_history_instructions 存储在 extensions 中
            if (newCharData.system_prompt !== undefined) {
                charObj.data.extensions.system_prompt = newCharData.system_prompt;
            }
            if (newCharData.post_history_instructions !== undefined) {
                charObj.data.extensions.post_history_instructions = newCharData.post_history_instructions;
            }
            
            // 使用深度合并同步 extensions，避免覆盖现有数据
            if (newCharData.extensions) {
                deepMerge(charObj.data.extensions, newCharData.extensions);
            }
        }
        
        // 同步 character_book（如果有更新）
        if (newCharData.character_book !== undefined) {
            charObj.data.character_book = newCharData.character_book;
        }
        
        // 同步版本号
        if (newCharData.character_version !== undefined) {
            charObj.data.character_version = newCharData.character_version;
        }
        
        // 【注意】以下字段是"元数据字段"，应该保留在根层级
        // 这些字段不在 legacyCharacterRootFieldSpecs 中，所以直接写入根层级不会触发警告
        
        // chat: 当前聊天文件名（如 "2024-01-01.json"）
        if (newCharData.chat !== undefined) {
            charObj.chat = newCharData.chat;
        }
        // create_date: 角色卡创建时间
        if (newCharData.create_date !== undefined) {
            charObj.create_date = newCharData.create_date;
        }
        // date_last_chat: 最后聊天时间戳（毫秒）
        if (newCharData.date_last_chat !== undefined) {
            charObj.date_last_chat = newCharData.date_last_chat;
        }
        // chat_date: 兼容字段，部分版本使用
        if (newCharData.chat_date !== undefined) {
            charObj.chat_date = newCharData.chat_date;
        }
    };
    
    // 更新 parentWin.characters
    if (parentWin.characters && Array.isArray(parentWin.characters)) {
        const stChar = parentWin.characters.find(c => c.avatar === fileName);
        updateCharObject(stChar);
    }
    
    // 更新 ctx.characters
    const ctx = getSTContext();
    if (ctx && ctx.characters) {
        const ctxChar = ctx.characters.find(c => c.avatar === fileName);
        updateCharObject(ctxChar);
    }
}

/**
 * 将当前插件中的 Tag 同步写入到角色卡文件的 data.tags 字段
 * @param {string} fileName - 角色卡文件名
 */
/**
 * 更换角色图片
 * 使用 /api/characters/edit-avatar API，只上传图片，不修改元数据
 *
 * @param {object} char - 角色对象
 * @param {File} file - 图片文件
 * @returns {Promise<boolean>}
 */
export async function replaceCharacterImage(char, file) {
    try {
        // 1. 创建干净的图片（去除元数据）
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await new Promise(r => img.onload = r);

        const canvas = doc.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const cleanBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));

        // 2. 使用 edit-avatar API 上传图片
        // 这个 API 只替换图片，保留原有的元数据
        const fd = new FormData();
        fd.append('avatar', cleanBlob, file.name);
        fd.append('avatar_url', char.fileName);

        const r = await authFetch('/api/characters/edit-avatar', {
            method: 'POST',
            body: fd
        });

        if (!r.ok) throw new Error(await r.text());

        // 3. 更新头像 URL（添加时间戳防止缓存）
        char.avatarUrl = '/characters/' + encodeURIComponent(char.fileName) + '?t=' + Date.now();
        
        // 4. 持久化到 IndexedDB，确保重启后数据一致
        await persistCharacterState(true);
        
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
        
        // 【新增】输出写入内容摘要到 console
        const writeContent = {
            'tags/finalTags': finalTags,
            'extensions.cm_manager.tags': targetObj.extensions.cm_manager.tags
        };
        console.log(`[TagSync] 写入角色卡内容: ${fileName}`, writeContent);

        // 使用 /api/characters/merge-attributes 接口
        const saveRes = await authFetch('/api/characters/merge-attributes', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!saveRes.ok) {
            console.error('[TagSync] Failed to save char data:', saveRes.status);
        } else {
            console.log('[TagSync] Tags synced for', fileName);
            
            // 同步更新内存中的 tags 字段并持久化
            // 【修复】添加防御性检查，确保 stateChar 存在后再更新
            const stateChar = state.characters.find(c => c.fileName === fileName);
            if (stateChar && finalTags) {
                stateChar.tags = finalTags;
            }
            
            // 使用防抖模式持久化，避免批量同步时的频繁 I/O
            await persistCharacterState();
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
    
    // 获取当前聊天角色的文件名
    const currentChar = getCurrentChatChar();
    const currentFileName = currentChar?.fileName;
    
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
            // 当前卡始终排在最前
            if (currentFileName) {
                if (a.fileName === currentFileName) return -1;
                if (b.fileName === currentFileName) return 1;
            }
            const typeA = matchMap.get(a.fileName);
            const typeB = matchMap.get(b.fileName);
            if (typeA !== typeB) return typeA - typeB;
            return compareChars(a, b);
        });
    } else {
        result.sort((a, b) => {
            // 当前卡始终排在最前
            if (currentFileName) {
                if (a.fileName === currentFileName) return -1;
                if (b.fileName === currentFileName) return 1;
            }
            return compareChars(a, b);
        });
    }
    return result;
}

export function compareChars(a, b) {
    let ret = 0;
    switch (state.sortBy) {
        case 'date':
            // Issue 2: 修复时间解析，兼容 Unix 时间戳字符串
            // 仅使用 create_date，无效视为 0 (与酒馆原生逻辑对齐)
            const dateA = parseSTDate(a.create_date);
            const dateB = parseSTDate(b.create_date);
            ret = dateA - dateB;
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
        // 【移除】case 'import' 排序逻辑，改用酒馆原生的 create_date (date 排序)
    }
    // Issue 3: 增加次级排序，确保排序稳定性
    if (ret === 0) {
        return (a.name || '').localeCompare(b.name || '', 'zh-CN', { numeric: true, sensitivity: 'base' });
    }

    return state.sortOrder === 'asc' ? ret : -ret;
}

/**
 * 解析酒馆时间格式，兼容 Unix 时间戳字符串
 * @param {string|number} dateVal
 * @returns {number} 时间戳，无效返回 0
 */
export function parseSTDate(dateVal) {
    if (!dateVal) return 0;
    const strVal = String(dateVal);

    // 兼容酒馆原生的 Unix 时间戳字符串 (纯数字字符串)
    if (typeof dateVal === 'number' || /^\d+$/.test(strVal)) {
        const num = Number(strVal);
        return isNaN(num) ? 0 : num;
    }

    // 尝试 ST "humanized" 格式 (例如: 2024-07-12@01h31m37s123ms, 2024-6-5 @14h 56m 50s 682ms)
    // 移植酒馆原生的时间解析逻辑
    let parsedIso = null;
    const convertFromHumanized = (_, year, month, day, hour, min, sec, ms) => {
        ms = typeof ms !== 'undefined' ? `.${ms.padStart(3, '0')}` : '';
        return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${min.padStart(2, '0')}:${sec.padStart(2, '0')}${ms}Z`;
    };
    
    let rgxMatch;
    if ((rgxMatch = strVal.match(/(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s(\d{1,3})ms/))) {
        parsedIso = convertFromHumanized(...rgxMatch);
    } else if ((rgxMatch = strVal.match(/(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s/))) {
        parsedIso = convertFromHumanized(...rgxMatch);
    } else if ((rgxMatch = strVal.match(/(\d{4})-(\d{1,2})-(\d{1,2}) @(\d{1,2})h (\d{1,2})m (\d{1,2})s (\d{1,3})ms/))) {
        parsedIso = convertFromHumanized(...rgxMatch);
    }

    const valToParse = parsedIso ? parsedIso : strVal;
    
    // 尝试解析 ISO 字符串或其他格式
    const parsed = new Date(valToParse).getTime();
    return isNaN(parsed) ? 0 : parsed;
}

export async function saveCharacterData(fileName, updateCallback) {
    // 使用串行队列防止同一文件的并发写操作互相覆盖
    const { wait, done } = enqueueFileWrite(fileName);
    await wait;
    
    try {
        // 【修复】添加重试机制，解决导入后立即读取可能返回 404 的问题
        // 原因：文件刚上传完成时，后端缓存/文件系统可能未同步
        let getRes;
        let lastError;
        const maxRetries = 3;
        const retryDelay = 500; // 500ms
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            getRes = await authFetch('/api/characters/get', {
                method: 'POST',
                body: JSON.stringify({ avatar_url: fileName })
            });
            
            if (getRes.ok) break;
            
            const errorText = await getRes.text();
            lastError = new Error(`无法读取角色数据: ${getRes.status} - ${errorText}`);
            
            // 只对 404 错误重试，其他错误直接抛出
            if (getRes.status !== 404) {
                throw lastError;
            }
            
            // 最后一次尝试失败，抛出错误
            if (attempt === maxRetries) {
                console.warn(`[CharManager] saveCharacterData: ${fileName} 读取失败，已重试 ${maxRetries} 次`);
                throw lastError;
            }
            
            console.log(`[CharManager] saveCharacterData: ${fileName} 返回 404，等待 ${retryDelay}ms 后重试 (${attempt}/${maxRetries})`);
            await new Promise(r => setTimeout(r, retryDelay));
        }
        
        const fullData = await getRes.json();

        let charData = fullData;
        if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
            charData = fullData.data;
        }

        // 保存 updateCallback 修改前的 extensions.world 值（用于检测是否有意修改）
        const worldBeforeCallback = charData.extensions?.world;
        
        // 检查是否有 create_date 字段
        // 注意：create_date 应该在根层级（与酒馆逻辑一致），所以检查 fullData.create_date
        const hasCreateDateBefore = !!fullData.create_date;
        
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
        
        // --- 修复：防止编辑时 extensions.world 被意外清空 ---
        // 如果 updateCallback 没有明确修改 extensions.world，则从酒馆内存缓存中恢复最新值
        const worldAfterCallback = charData.extensions?.world;
        if (worldAfterCallback === undefined && worldBeforeCallback === undefined) {
            try {
                const stChars = typeof getSTCharacters === 'function' ? getSTCharacters() : [];
                const cached = stChars.find(c => c.avatar === fileName);
                if (cached) {
                    const cachedWorld = cached.data?.extensions?.world;
                    if (cachedWorld) {
                        if (!charData.extensions) charData.extensions = {};
                        charData.extensions.world = cachedWorld;
                        console.log('[CharManager] 已从酒馆缓存恢复 extensions.world:', cachedWorld);
                    }
                }
            } catch (e) { console.warn('尝试恢复 extensions.world 失败', e); }
        }
        // -------------------------------------
        
        // 检查并添加 create_date 字段（如果缺失）
        // 注意：create_date 应该在根层级（与酒馆逻辑一致）
        if (!fullData.create_date) {
            // 优先使用 date_added（酒馆提供的文件创建时间戳，毫秒）
            // fullData 来自 API 响应，包含 date_added 字段
            const createDate = fullData.date_added 
                ? new Date(fullData.date_added).toISOString() 
                : new Date().toISOString();
            fullData.create_date = createDate;
            // 显示 toast 提示
            if (!hasCreateDateBefore) {
                const charName = charData.name || fileName.replace(/\.png$/i, '');
                notify(`已为角色卡「${charName}」添加创建时间`, 'info');
            }
        }

        // ============================================================
        // 【重构 2026-03-26】改用 merge-attributes API
        //
        // 问题：使用 /api/characters/edit API 时，通过 FormData 发送根层级字段
        //       会触发 "Deprecated character API write" 警告
        //
        // 解决方案：改用 /api/characters/merge-attributes API
        // - 发送 JSON 格式数据，后端自动合并
        // - 同时发送根层级和 data.* 字段（双写模式）
        // - 后端 deepMerge 会正确处理，不会触发警告
        //
        // 参考：SillyTavern-CharacterLibrary 插件的实现
        //       SillyTavernchat-main/src/endpoints/characters.js:1317 (merge-attributes)
        //
        // 回滚方法：恢复原来的 FormData + /api/characters/edit 逻辑
        // ============================================================

        // 保留原有的 extensions 数据（如 gallery_id, favorites, chub link 等）
        const existingExtensions = charData.extensions || fullData.data?.extensions || {};
        
        // 保留原有的 data 对象（V3 字段如 assets, nickname, depth_prompt, group_only_greetings 等）
        const existingData = fullData.data || {};
        
        // 保留原有的 spec 信息
        const existingSpec = fullData.spec;
        const existingSpecVersion = fullData.spec_version;
        
        // 构建发送给 merge-attributes API 的数据
        // 参考：SillyTavern-CharacterLibrary 的 showSaveConfirmation 函数
        const payload = {
            avatar: fileName,
            
            // 保留 spec 信息
            ...(existingSpec && { spec: existingSpec }),
            ...(existingSpecVersion && { spec_version: existingSpecVersion }),
            
            // 根层级字段（向后兼容）
            name: charData.name || fileName.replace(/\.png$/i, ''),
            description: charData.description || '',
            first_mes: charData.first_mes || '',
            personality: charData.personality || '',
            scenario: charData.scenario || '',
            mes_example: charData.mes_example || '',
            system_prompt: charData.system_prompt || '',
            post_history_instructions: charData.post_history_instructions || '',
            creator_notes: charData.creator_notes || charData.creatorcomment || '',
            creator: charData.creator || '',
            character_version: charData.character_version || '',
            tags: charData.tags || [],
            alternate_greetings: charData.alternate_greetings || [],
            character_book: charData.character_book,
            
            // 保留 create_date
            create_date: fullData.create_date,
            
            // data 对象（V2/V3 格式）
            data: {
                ...existingData,
                // 覆盖编辑的字段
                name: charData.name || fileName.replace(/\.png$/i, ''),
                description: charData.description || '',
                first_mes: charData.first_mes || '',
                personality: charData.personality || '',
                scenario: charData.scenario || '',
                mes_example: charData.mes_example || '',
                system_prompt: charData.system_prompt || '',
                post_history_instructions: charData.post_history_instructions || '',
                creator_notes: charData.creator_notes || charData.creatorcomment || '',
                creator: charData.creator || '',
                character_version: charData.character_version || '',
                tags: charData.tags || [],
                alternate_greetings: charData.alternate_greetings || [],
                character_book: charData.character_book,
                // 保留 extensions
                extensions: existingExtensions
            }
        };
        
        // 处理 depth_prompt
        if (charData.depth_prompt_prompt !== undefined ||
            charData.depth_prompt_depth !== undefined ||
            charData.depth_prompt_role !== undefined) {
            payload.data.extensions.depth_prompt = {
                prompt: charData.depth_prompt_prompt ?? '',
                depth: charData.depth_prompt_depth ?? 4,
                role: charData.depth_prompt_role ?? 'system'
            };
        }
        
        // 处理 group_only_greetings
        if (charData.group_only_greetings) {
            payload.group_only_greetings = charData.group_only_greetings;
            payload.data.group_only_greetings = charData.group_only_greetings;
        }
        
        // 【新增】输出写入内容摘要到 console（只显示关键字段）
        const writeContent = {
            name: payload.name,
            tags: payload.tags,
            'data.extensions.cm_manager': payload.data?.extensions?.cm_manager
        };
        console.log(`[CharManager] 写入角色卡内容: ${fileName}`, writeContent);

        const r = await authFetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!r.ok) {
            const errorText = await r.text();
            throw new Error(errorText);
        }
        
        console.log('[CharManager] saveCharacterData: merge-attributes 成功');
        
        // 使用本地数据作为最终数据源
        // 注意：需要合并根层级字段（chat、create_date、date_last_chat）到 finalCharData
        const finalCharData = {
            ...charData,
            // 确保根层级的聊天关联字段被包含
            chat: fullData.chat ?? charData.chat,
            create_date: fullData.create_date ?? charData.create_date,
            date_last_chat: fullData.date_last_chat ?? charData.date_last_chat,
            chat_date: fullData.chat_date ?? charData.chat_date
        };
        
        // API 写入成功后，同步更新内存状态
        // 1. 更新 state.characters 中的角色对象
        const stateChar = state.characters.find(c => c.fileName === fileName);
        if (stateChar) {
            // 合并更新后的数据到 state 缓存
            Object.assign(stateChar, {
                name: finalCharData.name || charData.name,
                description: finalCharData.description ?? charData.description,
                personality: finalCharData.personality ?? charData.personality,
                scenario: finalCharData.scenario ?? charData.scenario,
                first_mes: finalCharData.first_mes ?? charData.first_mes,
                mes_example: finalCharData.mes_example ?? charData.mes_example,
                creatorcomment: finalCharData.creator_notes || finalCharData.creatorcomment || charData.creator_notes || charData.creatorcomment,
                version: finalCharData.character_version || charData.character_version,
                fav: finalCharData.extensions?.fav ?? finalCharData.fav ?? charData.extensions?.fav ?? charData.fav ?? stateChar.fav,
                // 【修复】同步聊天关联字段
                chat: finalCharData.chat ?? charData.chat ?? stateChar.chat,
                create_date: finalCharData.create_date ?? charData.create_date ?? stateChar.create_date,
                date_last_chat: finalCharData.date_last_chat ?? charData.date_last_chat ?? stateChar.date_last_chat,
                chat_date: finalCharData.chat_date ?? charData.chat_date ?? stateChar.chat_date
            });
            // 同步 extensions 中的数据
            const extensionsData = finalCharData.extensions || charData.extensions;
            if (extensionsData) {
                if (!stateChar.data) stateChar.data = {};
                if (!stateChar.data.extensions) stateChar.data.extensions = {};
                Object.assign(stateChar.data.extensions, extensionsData);
            }
        }
        
        // 2. 同步更新酒馆内存中的角色数据
        syncCharDataToMemory(fileName, finalCharData);
        
        // 3. 刷新酒馆的角色列表缓存，确保原生操作能读取到最新数据
        // 这是关键：酒馆内部有自己的角色缓存，不刷新的话会被旧数据覆盖
        try {
            const ctx = getSTContext();
            if (ctx && typeof ctx.getCharacters === 'function') {
                await ctx.getCharacters();
            }
        } catch (e) {
            console.warn('[CharManager] 刷新酒馆角色列表失败:', e);
        }
        
        // 持久化到 IndexedDB，确保重启后数据一致
        await persistCharacterState(true);
        
        return true;
    } catch (e) {
        console.error(e);
        notify('保存失败: ' + e.message, 'error');
        return false;
    } finally {
        // 释放串行队列
        done();
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

/**
 * 更新角色数据
 * 使用 merge-attributes API 更新元数据，避免 "Deprecated character API write" 警告
 *
 * @param {string} fileName - 角色文件名
 * @param {object} newCharData - 新的角色数据
 * @param {Blob|null} imageBlob - 可选的新图片
 * @param {object} options - 选项
 */
export async function updateCharacter(fileName, newCharData, imageBlob = null, options = {}) {
    // 使用串行队列防止同一文件的并发写操作互相覆盖
    const { wait, done } = enqueueFileWrite(fileName);
    await wait;
    
    const {
        cleanOldWorldInfo = true,
        preserveSourceLink = true,
        refreshUI = true,
        notifySuccess = true,
        fullCardData = null
    } = options;

    const char = state.characters.find(c => c.fileName === fileName);
    if (!char) {
        done();
        throw new Error('未找到目标角色: ' + fileName);
    }

    try {
        // 1. 清理旧世界书逻辑
        if (cleanOldWorldInfo && char.character_book && newCharData.character_book) {
            const oldWI = char.character_book;
            let oldWIName = typeof oldWI === 'object' ? oldWI.name : oldWI;
            let newWIName = typeof newCharData.character_book === 'object' ? newCharData.character_book.name : newCharData.character_book;

            if (oldWIName && oldWIName !== newWIName) {
                const isUsedByOthers = state.characters.some(c => c.fileName !== fileName && c.character_book === oldWIName);
                if (!isUsedByOthers) {
                    try {
                        console.log('[CharManager] 自动清理旧世界书:', oldWIName);
                        await deleteWorldInfo(oldWIName, true);
                    } catch (e) {
                        console.warn('[CharManager] 清理旧世界书失败:', e);
                    }
                }
            }
        }

        // 2. 保留 Source Link
        if (preserveSourceLink) {
            const savedLink = char.source_link || '';
            if (savedLink) {
                if (!newCharData.extensions) newCharData.extensions = {};
                newCharData.extensions.source_url = savedLink;
                if (newCharData.extensions.source_link) delete newCharData.extensions.source_link;
            }
        }

        // 3. 如果有图片，先上传图片
        if (imageBlob) {
            const fd = new FormData();
            fd.append('avatar', imageBlob);
            fd.append('avatar_url', fileName);

            const imgRes = await authFetch('/api/characters/edit-avatar', {
                method: 'POST',
                body: fd
            });

            if (!imgRes.ok) throw new Error('上传图片失败: ' + await imgRes.text());
        }

        // 4. 获取现有数据以保留 extensions 和 data
        // 【修复 2026-03-31】优先使用 fullCardData（翻译模块传入的新鲜数据），
        // 避免使用 state.characters 中的陈旧缓存导致 character_book 等嵌套对象丢失
        const sourceData = fullCardData || char;
        const existingExtensions = sourceData.data?.extensions || sourceData.extensions || {};
        const existingData = sourceData.data || sourceData || {};
        const existingSpec = sourceData.spec || char.spec;
        const existingSpecVersion = sourceData.spec_version || char.spec_version;

        // 5. 构建 merge-attributes payload
        const payload = {
            avatar: fileName,
            
            // 保留 spec 信息
            ...(existingSpec && { spec: existingSpec }),
            ...(existingSpecVersion && { spec_version: existingSpecVersion }),
            
            // 根层级字段
            name: newCharData.name || char.name,
            description: newCharData.description || '',
            first_mes: newCharData.first_mes || '',
            personality: newCharData.personality || '',
            scenario: newCharData.scenario || '',
            mes_example: newCharData.mes_example || '',
            system_prompt: newCharData.system_prompt || '',
            post_history_instructions: newCharData.post_history_instructions || '',
            creator_notes: newCharData.creator_notes || '',
            creator: newCharData.creator || '',
            character_version: newCharData.character_version || '',
            tags: newCharData.tags || [],
            alternate_greetings: newCharData.alternate_greetings || [],
            character_book: newCharData.character_book,
            
            // 保留 create_date
            create_date: newCharData.create_date || char.create_date,
            
            // data 对象
            data: {
                ...existingData,
                name: newCharData.name || char.name,
                description: newCharData.description || '',
                first_mes: newCharData.first_mes || '',
                personality: newCharData.personality || '',
                scenario: newCharData.scenario || '',
                mes_example: newCharData.mes_example || '',
                system_prompt: newCharData.system_prompt || '',
                post_history_instructions: newCharData.post_history_instructions || '',
                creator_notes: newCharData.creator_notes || '',
                creator: newCharData.creator || '',
                character_version: newCharData.character_version || '',
                tags: newCharData.tags || [],
                alternate_greetings: newCharData.alternate_greetings || [],
                // 【修复 2026-03-31】character_book 放在 extensions 之前，确保翻译后的数据不被 ...existingData 残留覆盖
                ...(newCharData.character_book !== undefined && { character_book: newCharData.character_book }),
                extensions: {
                    ...existingExtensions,
                    ...(newCharData.extensions || {})
                }
            }
        };

        // 6. 处理 depth_prompt
        if (newCharData.depth_prompt_prompt !== undefined ||
            newCharData.depth_prompt_depth !== undefined ||
            newCharData.depth_prompt_role !== undefined) {
            payload.data.extensions.depth_prompt = {
                prompt: newCharData.depth_prompt_prompt ?? '',
                depth: newCharData.depth_prompt_depth ?? 4,
                role: newCharData.depth_prompt_role ?? 'system'
            };
        }

        // 7. 处理 group_only_greetings
        if (newCharData.group_only_greetings) {
            payload.group_only_greetings = newCharData.group_only_greetings;
            payload.data.group_only_greetings = newCharData.group_only_greetings;
        }
        
        // 【新增】输出写入内容摘要到 console（只显示关键字段）
        const writeContent = {
            name: payload.name,
            tags: payload.tags,
            'data.extensions.cm_manager': payload.data?.extensions?.cm_manager
        };
        console.log(`[CharManager] updateCharacter 写入角色卡内容: ${fileName}`, writeContent);

        // 8. 调用 merge-attributes API
        const r = await authFetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!r.ok) {
            const errorText = await r.text();
            throw new Error(errorText);
        }

        console.log('[CharManager] updateCharacter: merge-attributes 成功');

        // 9. 更新本地状态
        const finalCharData = {
            ...newCharData,
            chat: newCharData.chat ?? char.chat,
            create_date: newCharData.create_date ?? char.create_date,
            date_last_chat: newCharData.date_last_chat ?? char.date_last_chat,
            chat_date: newCharData.chat_date ?? char.chat_date
        };

        Object.assign(char, finalCharData);
        char.avatarUrl = '/characters/' + encodeURIComponent(char.fileName) + '?t=' + Date.now();
        
        // 10. 同步更新酒馆内存中的角色数据
        syncCharDataToMemory(fileName, finalCharData);
        
        // 11. 刷新酒馆的角色列表缓存
        try {
            const ctx = getSTContext();
            if (ctx && typeof ctx.getCharacters === 'function') {
                await ctx.getCharacters();
            }
        } catch (e) {
            console.warn('[CharManager] 刷新酒馆角色列表失败:', e);
        }
        
        // 持久化到 IndexedDB
        await persistCharacterState(true);
        
        if (notifySuccess) notify('角色更新成功', 'success');
        return true;
    } finally {
        done();
    }
}

export async function toggleFavorite(fileName, currentFavState) {
    const newState = !currentFavState;
    let isActiveChar = false;
    try {
        const currentChId = parentWin.this_chid;
        if (typeof currentChId !== 'undefined' && parentWin.characters && parentWin.characters[currentChId]) {
            const curName = decodeURIComponent(parentWin.characters[currentChId].avatar.split('/').pop());
            const tarName = decodeURIComponent(fileName.split('/').pop());
            if (curName === tarName) isActiveChar = true;
        }
    } catch (e) { }
    if (isActiveChar) {
        // 当前角色：通过模拟点击 DOM 按钮触发酒馆原生逻辑
        const domBtn = parentWin.document.getElementById('favorite_button');
        if (domBtn) {
            domBtn.click();
            
            // 【修复】等待 DOM 更新完成后再获取实际状态，避免竞态条件
            // 使用 requestAnimationFrame 确保 DOM 更新完成
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            // 从 DOM 按钮获取实际的收藏状态（更可靠）
            const actualFavState = domBtn.classList.contains('fav_on') ||
                                   domBtn.getAttribute('data-fav') === 'true';
            
            const char = state.characters.find(c => c.fileName === fileName);
            if (char) char.fav = actualFavState;
            
            // 持久化收藏状态到 IndexedDB（原生 DOM 操作不触发我们的持久化）
            await setCache('characters', state.characters);
            notify(actualFavState ? '已收藏 (当前角色)' : '取消收藏 (当前角色)', 'success');
            return actualFavState;
        }
    }
    
    // 非当前角色：按酒馆批量收藏逻辑最小化写入，避免重拼 tags 触发 Spec v1/v2 mismatch
    try {
        const stateChar = state.characters.find(c => c.fileName === fileName || c.avatar === fileName);
        const payload = {
            avatar: fileName,
            ...(stateChar?.name && { name: stateChar.name }),
            fav: newState,
            data: {
                extensions: {
                    fav: newState,
                },
            },
        };

        const r = await authFetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!r.ok) {
            const errorText = await r.text();
            throw new Error(errorText);
        }

        if (stateChar) {
            stateChar.fav = newState;
            if (!stateChar.data) stateChar.data = {};
            if (!stateChar.data.extensions) stateChar.data.extensions = {};
            stateChar.data.extensions.fav = newState;
        }

        const stChar = getSTCharacters().find(c => c.avatar === fileName);
        if (stChar) {
            stChar.fav = newState;
            if (!stChar.data) stChar.data = {};
            if (!stChar.data.extensions) stChar.data.extensions = {};
            stChar.data.extensions.fav = newState;
        }

        await setCache('characters', state.characters);
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

        // 同步更新酒馆原生内存中的角色文件名
        // 1. 更新 parentWin.characters
        if (parentWin.characters && Array.isArray(parentWin.characters)) {
            const stChar = parentWin.characters.find(c => c.avatar === oldFileName);
            if (stChar) {
                stChar.avatar = newFileName;
                stChar.name = newName;
            }
        }
        
        // 2. 更新 ctx.characters
        // 【Luker 兼容】avatar 字段不在 legacyCharacterRootFieldSpecs 中，可以直接修改
        // 但 name 字段需要写入 data.name 路径，避免触发警告
        const ctx = getSTContext();
        if (ctx && ctx.characters) {
            const ctxChar = ctx.characters.find(c => c.avatar === oldFileName);
            if (ctxChar) {
                ctxChar.avatar = newFileName;
                // 写入 data.name 路径，Luker 会自动同步到根层级
                if (!ctxChar.data) ctxChar.data = {};
                ctxChar.data.name = newName;
            }
        }

        // 持久化到 IndexedDB，确保重启后数据一致
        await persistCharacterState(true);

        notify('重命名成功', 'success');
        return true;
    } catch (e) {
        notify('重命名失败: ' + e.message, 'error');
        return false;
    }
}

export async function downloadChar(fn) {
    return new Promise(resolve => {
        let html = `<div style="padding:10px 14px">`;
        html += `<div style="font-size:14px;margin-bottom:12px;font-weight:bold;">请选择导出方式：</div>`;
        
        // 组1：标准服务端导出
        html += `<div style="background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.1)); padding:10px; border-radius:6px; margin-bottom:12px; border: 1px solid var(--SmartThemeBorderColor, #555);">`;
        html += `<div style="font-size:12px; opacity:0.8; margin-bottom:8px;">`;
        html += `☁️ <b>标准导出</b>（ 由酒馆服务端生成，使用酒馆原生导出接口）`;
        html += `</div>`;
        html += `<div style="display:flex;flex-direction:column;gap:8px">`;
        html += `<label style="display:flex;align-items:center;cursor:pointer;font-size:13px">`;
        html += `<input type="radio" name="exportFormat" value="png" checked style="width:16px;height:16px;margin-right:8px">`;
        html += `<span>完整角色卡 (PNG)</span>`;
        html += `</label>`;
        html += `<label style="display:flex;align-items:center;cursor:pointer;font-size:13px">`;
        html += `<input type="radio" name="exportFormat" value="json" style="width:16px;height:16px;margin-right:8px">`;
        html += `<span>纯文本数据 (JSON)</span>`;
        html += `</label>`;
        html += `</div></div>`;

        // 组2：纯前端底层提取
        html += `<div style="background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.1)); padding:10px; border-radius:6px; border: 1px solid var(--SmartThemeBorderColor, #555);">`;
        html += `<div style="font-size:12px; opacity:0.8; margin-bottom:8px;">`;
        html += `💻 <b>底层提取</b>（ 不经过服务端过滤，直接读取硬盘里原始图片的数据）`;
        html += `</div>`;
        html += `<div style="display:flex;flex-direction:column;gap:8px">`;
        html += `<label style="display:flex;align-items:center;cursor:pointer;font-size:13px">`;
        html += `<input type="radio" name="exportFormat" value="raw_json" style="width:16px;height:16px;margin-right:8px">`;
        html += `<span>提取原始设定 (Raw JSON)</span>`;
        html += `</label>`;
        html += `<label style="display:flex;align-items:center;cursor:pointer;font-size:13px">`;
        html += `<input type="radio" name="exportFormat" value="clean_png" style="width:16px;height:16px;margin-right:8px">`;
        html += `<span>剥离为纯净封面 (Clean PNG)</span>`;
        html += `</label>`;
        html += `</div></div>`;
        html += `</div>`;

        createBaseDialog('导出角色', html, [
            { text: '取消', id: 'cmExportCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => { close(); resolve(false); } },
            {
                text: '导出', id: 'cmExportOk', cls: 'cm-btn-primary', onClick: async (ov, close) => {
                    const formatInput = ov.querySelector('input[name="exportFormat"]:checked');
                    if (!formatInput) return;
                    const format = formatInput.value;
                    close();
                    
                    try {
                        const charObj = state.characters.find(c => c.fileName === fn);
                        const safeCharName = (charObj?.name || fn.replace(/\.png$/i, '')).replace(/[\/\\?%*:|"<>]/g, '_');

                        if (format === 'raw_json' || format === 'clean_png') {
                            // 高级导出逻辑：前端处理
                            notify('正在处理原始图片...', 'info');
                            const response = await authFetch('/characters/' + encodeURIComponent(fn));
                            if (!response.ok) throw new Error('无法获取原始图片文件');
                            const arrayBuffer = await response.arrayBuffer();
                            
                            let blobUrl, downloadName;
                            if (format === 'raw_json') {
                                const rawJsonStr = extractCharDataFromPNG(arrayBuffer);
                                const blob = new Blob([rawJsonStr], { type: 'application/json' });
                                blobUrl = window.URL.createObjectURL(blob);
                                downloadName = `${safeCharName}_raw.json`;
                            } else if (format === 'clean_png') {
                                const cleanBuffer = stripCharMetadataFromPNG(arrayBuffer);
                                const blob = new Blob([cleanBuffer], { type: 'image/png' });
                                blobUrl = window.URL.createObjectURL(blob);
                                downloadName = `${safeCharName}_clean.png`;
                            }

                            const a = doc.createElement('a');
                            a.href = blobUrl;
                            a.download = downloadName;
                            doc.body.appendChild(a);
                            a.click();
                            a.remove();
                            window.URL.revokeObjectURL(blobUrl);
                            notify('导出成功', 'success');
                            resolve(true);
                            return;
                        }

                        // 原有导出逻辑：服务端处理
                        if (charObj) {
                            // 导出前先强制使用最新数据覆盖服务端，以补全潜在缺失的 create_date 等字段
                            await updateCharacter(fn, charObj, null, {
                                cleanOldWorldInfo: false,
                                preserveSourceLink: true,
                                refreshUI: false,
                                notifySuccess: false
                            });
                        }

                        // 发起原生导出请求
                        const response = await authFetch('/api/characters/export', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ format, avatar_url: fn })
                        });

                        if (response.ok) {
                            const blob = await response.blob();
                            const downloadUrl = window.URL.createObjectURL(blob);
                            const a = doc.createElement('a');
                            a.href = downloadUrl;
                            
                            a.download = `${safeCharName}.${format}`;
                            
                            doc.body.appendChild(a);
                            a.click();
                            a.remove();
                            window.URL.revokeObjectURL(downloadUrl);
                            notify('导出成功', 'success');
                        } else {
                            notify('导出失败', 'error');
                        }
                    } catch (e) {
                        console.error('Export error: ', e);
                        notify('导出过程发生异常: ' + e.message, 'error');
                    }
                    resolve(true);
                }
            }
        ], null, { stack: true });
    });
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

export async function deleteChatFile(chatId, avatarUrl = null) {
    try {
        console.log('尝试删除聊天记录:', chatId, '头像URL:', avatarUrl);
        
        // 准备请求体，使用后端API期望的参数
        const requestBody = {
            chatfile: chatId  // 使用正确的参数名，与SillyTavern原生代码一致
        };
        
        // 如果提供了avatarUrl，也添加到请求体中
        if (avatarUrl) {
            requestBody.avatar_url = avatarUrl;
        }
        
        const r = await authFetch('/api/chats/delete', {
            method: 'POST',
            body: JSON.stringify(requestBody),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('删除请求响应状态:', r.status);
        
        // 检查响应状态并输出详细错误信息
        if (!r.ok) {
            let errorMsg = `HTTP ${r.status}`;
            try {
                // 尝试获取错误响应的文本内容
                errorMsg = await r.text();
            } catch (textErr) {
                console.warn('无法获取错误响应文本:', textErr);
            }
            
            console.error(`删除聊天记录失败: ${r.status} - ${errorMsg}`);
            throw new Error(`删除失败: ${r.status} - ${errorMsg}`);
        }
        
        // 尝试解析响应，如果成功删除通常会返回一些确认信息
        try {
            const response = await r.json();
            console.log('删除聊天记录响应:', response);
        } catch (parseErr) {
            // 如果响应不是JSON格式，也认为是成功的（有些API会返回空响应）
            console.log('删除聊天记录成功（无详细响应）');
        }
        
        // 检查是否删除的是当前聊天，如果是则需要关闭当前聊天
        try {
            const chatName = chatId.replace('.jsonl', '');
            if (avatarUrl && typeof parentWin.this_chid !== 'undefined' && typeof parentWin.characters !== 'undefined') {
                const currentCharId = parentWin.this_chid;
                const currentChar = parentWin.characters[currentCharId];
                
                if (currentChar && currentChar.avatar === avatarUrl && currentChar.chat === chatName) {
                    // 删除的是当前聊天，需要关闭当前聊天
                    if (typeof parentWin.closeCurrentChat !== 'function') {
                        // 如果没有closeCurrentChat函数，手动清理
                        if (typeof parentWin.chat_metadata !== 'undefined') {
                            parentWin.chat_metadata = {};
                        }
                        if (typeof parentWin.chat !== 'undefined') {
                            parentWin.chat.length = 0;
                        }
                    } else {
                        // 使用原生的closeCurrentChat函数来正确关闭当前聊天
                        await parentWin.closeCurrentChat();
                    }
                }
            }
        } catch (switchErr) {
            console.warn('处理当前聊天关闭时出错:', switchErr);
        }
        
        // 刷新欢迎屏幕上的最近聊天列表
        try {
            if (typeof parentWin.refreshWelcomeScreen === 'function') {
                await parentWin.refreshWelcomeScreen();
            }
        } catch (refreshErr) {
            console.warn('刷新欢迎屏幕失败:', refreshErr);
        }
        
        // 触发聊天删除事件，通知SillyTavern UI更新
        try {
            const chatName = chatId.replace('.jsonl', '');
            if (typeof parentWin.eventSource !== 'undefined' && typeof parentWin.event_types !== 'undefined') {
                await parentWin.eventSource.emit(parentWin.event_types.CHAT_DELETED, chatName);
            }
        } catch (eventErr) {
            console.warn('发送聊天删除事件失败:', eventErr);
        }
        
        return true;
    } catch (e) {
        console.error('删除聊天记录时发生错误:', e);
        // 重新抛出错误，让调用者知道具体错误
        throw e;
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

    // 清理角色卡文件中的 cm_manager 扩展数据（防止同名新卡继承旧标签）
    try {
        await saveCharacterData(fileName, (data) => {
            if (data.extensions && data.extensions.cm_manager) {
                delete data.extensions.cm_manager;
                console.log('[CharManager] 已清理 cm_manager 扩展数据:', fileName);
            }
        });
    } catch (e) {
        console.warn('[CharManager] 清理 cm_manager 数据失败:', e);
    }

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
                        try {
                            await deleteChatFile(chat.file_name, fileName);
                        } catch (chatDelErr) {
                            console.error('[CharManager] Failed to delete chat:', chat.file_name, chatDelErr);
                        }
                    }
                }
            } catch (e) {
                console.error('[CharManager] Failed to delete chats:', e);
            }
        }

        await window.deleteCharacter(fileName);
    } else {
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

    // 统一清理插件状态并持久化
    // 无论使用原生删除还是 API 删除，都需要清理插件内部状态
    
    // 1. 从插件状态中移除角色
    state.characters = state.characters.filter(c => c.fileName !== fileName);
    
    // 2. 清理本地标签缓存
    if (state.tagMap[fileName]) {
        delete state.tagMap[fileName];
        saveTags();
    }
    
    // 3. 清理选中状态
    if (state.selectedCards && state.selectedCards.has(fileName)) {
        state.selectedCards.delete(fileName);
    }
    
    // 4. 持久化到 IndexedDB，确保重启后数据一致
    await persistCharacterState(true);
}

/**
 * 统一标签应用入口（按标签名称数组应用到指定角色）
 * 内部处理：规范化标签名 -> 创建缺失标签 -> 计算差异 -> 增删关联 -> 持久化
 *
 * @param {string} fileName - 角色文件名
 * @param {string[]} tagNames - 标签名称数组
 * @param {object} [options] - 选项
 * @param {boolean} [options.replace=true] - 是否替换现有标签（true: 替换; false: 合并）
 * @param {boolean} [options.skipSync=true] - 是否跳过自动同步到 data.tags
 * @returns {Promise<{ added: number, removed: number, created: number }>}
 */
export async function applyTagsByNames(fileName, tagNames, options = {}) {
    const { replace = true, skipSync = true } = options;
    
    // 结果统计
    const result = { added: 0, removed: 0, created: 0 };
    
    // 1. 规范化标签名（去重、去空、trim）
    const normalizedNames = [...new Set(
        tagNames
            .map(t => String(t).trim())
            .filter(t => t && t.length > 0)
    )];
    
    if (normalizedNames.length === 0 && !replace) {
        // 无标签且非替换模式，直接返回
        return result;
    }
    
    // 2. 获取当前角色的标签 ID 列表
    const currentTagIds = state.tagMap[fileName] || [];
    const currentTagNames = currentTagIds
        .map(id => state.tags.find(t => t.id === id)?.name)
        .filter(Boolean);
    
    // 3. 计算目标标签 ID（名称 -> ID，不存在则创建）
    const targetTagIds = [];
    for (const name of normalizedNames) {
        let tag = state.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (!tag) {
            // 创建新标签
            tag = createTag(name);
            if (tag) {
                result.created++;
            } else {
                // 创建失败（可能重名），尝试再次查找
                tag = state.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
            }
        }
        if (tag) {
            targetTagIds.push(tag.id);
        }
    }
    
    // 4. 计算差异
    const toAdd = targetTagIds.filter(id => !currentTagIds.includes(id));
    const toRemove = replace
        ? currentTagIds.filter(id => !targetTagIds.includes(id))
        : [];
    
    // 5. 执行增删（复用现有函数，skipSaveToFile=true 避免逐个写文件）
    for (const tagId of toAdd) {
        if (await addTagToChar(fileName, tagId, skipSync, true, true)) {
            result.added++;
        }
    }
    
    for (const tagId of toRemove) {
        if (await removeTagFromChar(fileName, tagId, skipSync, true, true)) {
            result.removed++;
        }
    }
    
    // 6. 统一保存 cm_manager.tags 到文件（仅一次）
    if (result.added > 0 || result.removed > 0) {
        const finalTagNames = targetTagIds.map(id => {
            const tag = state.tags.find(t => t.id === id);
            return tag ? tag.name : null;
        }).filter(Boolean);
        
        await saveCmManagerTagsToCard(fileName, finalTagNames);
    }
    
    return result;
}
