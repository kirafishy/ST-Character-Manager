import { getSTContext, doc } from './context.js';
import { state } from './state.js';
import { createTag, addTagToChar, saveTags, saveCharacterData, syncCmManagerTagsToSTMemory } from './data.js';
import { log, escapeHtml, parsePNG } from './utils.js';
import { Z_INDEX } from './constants.js';
import { authFetch } from './api.js';
import { setCache } from './db.js';

const IMPORT_EXLCUDED_TAGS = ['ROOT', 'TAVERN'];
const ANTI_TROLL_MAX_TAGS = 50;

// cm_manager 扩展配置的 key
export const CM_MANAGER_KEY = 'cm_manager';

export const tag_import_setting = {
    ASK: 1,
    NONE: 2,
    ALL: 3,
    ONLY_EXISTING: 4,
};

// 批量标签导入策略
export const batch_tag_strategy = {
    ASK_EACH: 0,      // 逐个询问
    IMPORT_ALL: 1,    // 全部导入
    SKIP_ALL: 2,      // 全部跳过
    CANCEL: 3,        // 取消
};

/**
 * 获取角色的 cm_manager 扩展配置对象
 * @param {object} character - 角色对象（包含 data 字段）
 * @returns {object} cm_manager 对象（如不存在则返回空对象）
 */
export function getCmManager(character) {
    const data = character.data || character;
    if (!data.extensions) data.extensions = {};
    if (!data.extensions[CM_MANAGER_KEY]) {
        data.extensions[CM_MANAGER_KEY] = {};
    }
    return data.extensions[CM_MANAGER_KEY];
}

/**
 * 迁移旧的扩展配置到 cm_manager（仅内存操作）
 * @param {object} character - 角色对象
 * @returns {boolean} 是否进行了迁移
 */
export function migrateToCmManager(character) {
    const data = character.data || character;
    if (!data.extensions) data.extensions = {};
    
    const cm = getCmManager(character);
    let migrated = false;
    
    // 迁移 st_character_manager_note -> cm_manager.note
    if (data.extensions.st_character_manager_note !== undefined && cm.note === undefined) {
        cm.note = data.extensions.st_character_manager_note;
        delete data.extensions.st_character_manager_note;
        migrated = true;
    }
    
    return migrated;
}

/**
 * 迁移旧的扩展配置到 cm_manager 并保存到文件
 * @param {object} character - 角色对象
 * @returns {Promise<boolean>} 是否进行了迁移
 */
export async function migrateAndSaveCmManager(character) {
    const migrated = migrateToCmManager(character);
    if (migrated && character.avatar) {
        // 保存整个 cm_manager 对象到文件
        const cm = getCmManager(character);
        await saveCharacterData(character.avatar, (data) => {
            if (!data.extensions) data.extensions = {};
            data.extensions.cm_manager = cm;
            // 清理旧字段
            if (data.extensions.st_character_manager_note !== undefined) {
                delete data.extensions.st_character_manager_note;
            }
        });
    }
    return migrated;
}

/**
 * 确保角色对象内存中存在导入时间
 * 仅补齐内存字段，不执行持久化写入
 * @param {object} character - 角色对象
 * @param {number} dateAdded - SillyTavern 提供的 date_added 时间戳
 * @returns {{changed: boolean, importTime: number}} 是否发生变更与最终导入时间
 */
export function ensureImportTime(character, dateAdded) {
    const cm = getCmManager(character);

    if (cm.import_time !== undefined) {
        return { changed: false, importTime: cm.import_time };
    }

    const importTime = dateAdded ?? Date.now();
    cm.import_time = importTime;
    return { changed: true, importTime };
}

/**
 * 初始化角色卡的导入时间
 * 如果 cm_manager.import_time 不存在，则使用 date_added 填充
 * @param {object} character - 角色对象
 * @param {number} dateAdded - SillyTavern 提供的 date_added 时间戳
 * @returns {Promise<boolean>} 是否进行了初始化写入
 */
export async function initImportTime(character, dateAdded) {
    const { changed, importTime } = ensureImportTime(character, dateAdded);

    if (!changed) {
        return false;
    }

    // import_time 的持久化必须走 saveCharacterData，确保同步 state、酒馆缓存与 IndexedDB
    if (character.avatar) {
        try {
            await saveCharacterData(character.avatar, (data) => {
                if (!data.extensions) data.extensions = {};
                if (!data.extensions.cm_manager) {
                    data.extensions.cm_manager = {};
                }
                data.extensions.cm_manager.import_time = importTime;
            });
            console.log('[ST-Tags] initImportTime 已设置:', character.avatar, importTime);
            return true;
        } catch (e) {
            console.error('[ST-Tags] initImportTime 保存失败:', e);
            return false;
        }
    }
    
    return false;
}

/**
 * 清除角色卡的导入时间（用于重新导入时重置）
 * 保留 tags 和 note，仅清除 import_time
 * @param {string} fileName - 角色文件名
 * @returns {Promise<void>}
 */
export async function clearImportTime(fileName) {
    await saveCharacterData(fileName, (data) => {
        if (data.extensions?.cm_manager?.import_time !== undefined) {
            delete data.extensions.cm_manager.import_time;
            console.log('[ST-Tags] 已清除 import_time:', fileName);
        }
    });
}

/**
 * 保存 cm_manager.tags 到角色卡元数据
 * @param {string} fileName - 角色文件名
 * @param {string[]} tagNames - 标签名称数组
 * @returns {Promise<boolean>} 是否保存成功
 */
export async function saveCmManagerTags(fileName, tagNames) {
    const result = await saveCharacterData(fileName, (data) => {
        if (!data.extensions) data.extensions = {};
        if (!data.extensions[CM_MANAGER_KEY]) {
            data.extensions[CM_MANAGER_KEY] = {};
        }
        data.extensions[CM_MANAGER_KEY].tags = tagNames;
    });
    
    if (!result) {
        console.warn(`[ST-Tags] saveCmManagerTags 失败: ${fileName}`);
    }
    
    return result;
}

/**
 * Gets a tag from the tags array based on the provided tag name (insensitive soft matching)
 * @param {string} tagName - The name of the tag to search for
 * @returns {object?} The tag object that matches the provided tag name
 */
function getTag(tagName) {
    if (!tagName) return undefined;
    const lowerName = tagName.toLowerCase();
    return state.tags.find(t => t.name.toLowerCase() === lowerName);
}

/**
 * 从角色对象获取原始标签列表
 * @param {object} character - 角色对象
 * @returns {string[]} 标签名称数组
 */
function getRawTags(character) {
    // 诊断信息收集
    const diagnostics = {
        fileName: character.fileName || character.name || 'unknown',
        tagsFieldType: typeof character.tags,
        tagsFieldValue: null,
        dataTagsFieldType: null,
        dataTagsFieldValue: null,
        finalType: null,
        parseAttempt: null,
        // 原始 JSON 结构（用于调试，敏感字段值会被脱敏）
        rawJsonStructure: null,
    };
    
    // 收集原始 JSON 结构（只保留键名和类型，不保留敏感值）
    const getStructure = (obj, depth = 0) => {
        if (depth > 5) return '[max depth]';
        if (obj === null || obj === undefined) return obj === null ? 'null' : 'undefined';
        if (typeof obj !== 'object') return typeof obj;
        if (Array.isArray(obj)) {
            if (obj.length === 0) return '[]';
            return [`Array(${obj.length})`, getStructure(obj[0], depth + 1)];
        }
        const result = {};
        for (const key of Object.keys(obj)) {
            result[key] = getStructure(obj[key], depth + 1);
        }
        return result;
    };
    
    // 构建简化的角色结构
    diagnostics.rawJsonStructure = {
        hasTags: character.tags !== undefined,
        tagsType: character.tags !== undefined ? (Array.isArray(character.tags) ? 'array' : typeof character.tags) : 'undefined',
        hasData: !!character.data,
        dataTagsType: character.data?.tags !== undefined ? (Array.isArray(character.data.tags) ? 'array' : typeof character.data.tags) : 'undefined',
        dataExtensionsKeys: character.data?.extensions ? Object.keys(character.data.extensions).slice(0, 20) : null,
        cmManagerTags: character.data?.extensions?.cm_manager?.tags !== undefined
            ? (Array.isArray(character.data.extensions.cm_manager.tags) ? `array[${character.data.extensions.cm_manager.tags.length}]` : typeof character.data.extensions.cm_manager.tags)
            : 'undefined',
    };
    
    // Get tags from character metadata
    // Check both root level tags (V3/Internal) and data.tags (V2)
    let rawTags = character.tags;
    
    // 记录原始 tags 字段信息
    if (rawTags !== undefined) {
        diagnostics.tagsFieldType = typeof rawTags;
        diagnostics.tagsFieldValue = typeof rawTags === 'object'
            ? (Array.isArray(rawTags) ? `[Array(${rawTags.length})]` : JSON.stringify(rawTags).substring(0, 200))
            : String(rawTags).substring(0, 200);
    }
    
    // 如果 tags 不存在，尝试 data.tags
    if (rawTags === undefined && character.data && character.data.tags) {
        rawTags = character.data.tags;
        diagnostics.dataTagsFieldType = typeof rawTags;
        diagnostics.dataTagsFieldValue = typeof rawTags === 'object'
            ? (Array.isArray(rawTags) ? `[Array(${rawTags.length})]` : JSON.stringify(rawTags).substring(0, 200))
            : String(rawTags).substring(0, 200);
    }
    
    // 默认为空数组
    if (rawTags === undefined || rawTags === null) {
        rawTags = [];
        diagnostics.finalType = 'array[0] (default empty)';
        // 将诊断信息附加到返回数组上
        rawTags._diagnostics = diagnostics;
        return rawTags;
    }
    
    // Ensure it's an array
    if (!Array.isArray(rawTags)) {
        // Try to parse string if it's a string
        if (typeof rawTags === 'string') {
            diagnostics.parseAttempt = 'string';
            diagnostics.rawTagsStringPreview = rawTags.substring(0, 500);
            try {
                const parsed = JSON.parse(rawTags);
                diagnostics.parseAttempt = `string->json_parse_success:${typeof parsed}`;
                
                // 检查解析结果是否为数组
                if (Array.isArray(parsed)) {
                    rawTags = parsed;
                } else {
                    // 解析结果不是数组！这是问题的关键
                    diagnostics.parseAttempt = `string->json_parse_non_array:${Object.prototype.toString.call(parsed).slice(8, -1)}`;
                    diagnostics.parsedValuePreview = JSON.stringify(parsed).substring(0, 300);
                    diagnostics.parsedKeys = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).slice(0, 20) : null;
                    // 创建空数组但保留诊断信息
                    rawTags = [];
                }
            } catch {
                diagnostics.parseAttempt = 'string->split_by_comma';
                rawTags = rawTags.split(',').map(t => t.trim());
            }
        } else {
            // 非字符串非数组的其他类型（如对象）
            diagnostics.parseAttempt = `non_string_non_array:${typeof rawTags}`;
            diagnostics.valuePreview = JSON.stringify(rawTags).substring(0, 300);
            diagnostics.objectKeys = typeof rawTags === 'object' && rawTags !== null ? Object.keys(rawTags).slice(0, 20) : null;
            rawTags = [];
        }
    }
    
    diagnostics.finalType = Array.isArray(rawTags) ? `array[${rawTags.length}]` : `NOT_ARRAY:${typeof rawTags}`;
    
    // 将诊断信息附加到返回数组上（用于错误报告）
    if (Array.isArray(rawTags)) {
        rawTags._diagnostics = diagnostics;
    }
    
    return rawTags;
}

/**
 * 过滤和处理标签列表
 * @param {string[]} rawTags - 原始标签数组
 * @param {string} [fileName] - 角色文件名（用于错误报告）
 * @returns {string[]} 处理后的标签名称数组
 */
function filterTags(rawTags, fileName) {
    // 类型检查：确保 rawTags 是数组
    if (!Array.isArray(rawTags)) {
        // 构建详细的诊断错误信息
        const diagnostics = rawTags?._diagnostics || {};
        const errorInfo = {
            fileName: fileName || diagnostics.fileName || 'unknown',
            actualType: typeof rawTags,
            diagnostics: diagnostics,
        };
        
        const error = new TypeError(`rawTags.map is not a function`);
        error.diagnostics = errorInfo;
        throw error;
    }
    
    return rawTags
        .map(t => String(t).trim())
        .filter(t => t)
        .filter(t => !IMPORT_EXLCUDED_TAGS.includes(t))
        .slice(0, ANTI_TROLL_MAX_TAGS);
}

/**
 * 将标签名称转换为标签对象（已存在或新建临时对象）
 * @param {string[]} tagNames - 标签名称数组
 * @param {string} avatar - 角色头像文件名（用于检查是否已分配）
 * @param {boolean} filterAssigned - 是否过滤掉已经分配给该角色的标签
 * @returns {{ existingTags: object[], newTags: object[] }}
 */
function categorizeTags(tagNames, avatar, filterAssigned = true) {
    const existingTags = [];
    const newTags = [];
    
    tagNames.forEach(tagName => {
        const existing = getTag(tagName);
        if (existing) {
            // Check if already assigned to char
            const charTags = state.tagMap[avatar] || [];
            if (!filterAssigned || !charTags.includes(existing.id)) {
                existingTags.push(existing);
            }
        } else {
            // New tag - 转换为临时标签对象
            if (!newTags.some(t => t.name.toLowerCase() === tagName.toLowerCase())) {
                newTags.push({
                    id: `new_${tagName}`,
                    name: tagName,
                    color: '',
                    isTemp: true
                });
            }
        }
    });
    
    return { existingTags, newTags };
}

/**
 * 清除角色的所有标签关联
 * @param {string} avatar - 角色头像文件名
 */
function clearCharTags(avatar) {
    if (state.tagMap[avatar]) {
        delete state.tagMap[avatar];
    }
}

/**
 * 应用标签到角色
 * @param {string} avatar - 角色头像文件名
 * @param {object[]} tagsToApply - 要应用的标签数组
 * @param {boolean} skipSave - 是否跳过保存
 * @param {boolean} replace - 是否替换现有标签（先清除再添加）
 * @returns {Promise<number>} 添加的标签数量
 */
async function applyTags(avatar, tagsToApply, skipSave = false, replace = false) {
    // 如果是替换模式，先清除旧标签
    if (replace) {
        clearCharTags(avatar);
    }
    
    let addedCount = 0;
    for (const item of tagsToApply) {
        if (typeof item === 'object' && item.id) {
            if (item.isTemp) {
                // 临时标签对象 -> 需要先创建真正的标签
                // 再次检查标签是否已存在（可能在前面的循环中已创建）
                let tag = getTag(item.name);
                if (!tag) {
                    tag = createTag(item.name);
                }
                if (tag) {
                    if (await addTagToChar(avatar, tag.id, true, false, true)) addedCount++;
                }
            } else {
                // 已存在的标签对象
                if (await addTagToChar(avatar, item.id, true, false, true)) addedCount++;
            }
        }
    }
    
    if (addedCount > 0) {
        if (!skipSave) saveTags();
        log(`Applied ${addedCount} tags`);
    }
    
    return addedCount;
}

/**
 * Handles the import of tags for a given character
 * @param {object} character - The character object
 * @param {object} [options] - Options
 * @param {number} [options.importSetting=null] - Force a tag import setting
 * @param {boolean} [options.checkCmManager=true] - Whether to check cm_manager.tags first
 */
export async function importTags(character, { importSetting = null, skipSave = false, checkCmManager = true } = {}) {
    const ctx = getSTContext();
    if (!ctx) return;

    const avatar = character.fileName || character.avatar;
    const cm = getCmManager(character);
    
    // 如果启用 cm_manager 检查，且 cm_manager.tags 存在（即使是空数组）
    if (checkCmManager && cm.tags !== undefined) {
        // 使用 cm_manager.tags 作为标签来源
        const savedTagNames = cm.tags;
        if (!savedTagNames || savedTagNames.length === 0) {
            // 用户之前选择不导入任何标签，清除现有标签关联
            clearCharTags(avatar);
            return;
        }
        
        // 检查是否需要更新
        // 修复：getCharTags 需要从 data.js 导入，或者在这里使用 state.tagMap
        const currentTagIds = state.tagMap[avatar] || [];
        const currentTagNames = currentTagIds.map(id => {
            const tag = state.tags.find(t => t.id === id);
            return tag ? tag.name : null;
        }).filter(Boolean);
        
        const sortedSaved = [...savedTagNames].sort();
        const sortedCurrent = [...currentTagNames].sort();
        if (JSON.stringify(sortedSaved) === JSON.stringify(sortedCurrent)) {
            return; // 标签没有变化，无需处理
        }
        
        // 将保存的标签名称转换为标签对象并应用（替换模式）
        // replace=true 时，不需要过滤已分配的标签，因为我们要完全替换
        const { existingTags, newTags } = categorizeTags(savedTagNames, avatar, false);
        const tagsToApply = [...existingTags, ...newTags];
        
        if (tagsToApply.length > 0) {
            await applyTags(avatar, tagsToApply, skipSave, true); // replace=true，替换现有标签
        } else {
            clearCharTags(avatar);
        }
        return;
    }
    
    // cm_manager.tags 不存在，检查 data.tags
    const rawTags = getRawTags(character);
    if (!rawTags.length) {
        console.debug('[ST-Tags] No tags to import for', character.name);
        return;
    }

    const importTagsList = filterTags(rawTags, avatar);
    if (!importTagsList.length) return;

    // 检查是否需要更新 (即使 cm_manager.tags 不存在，如果当前插件标签与 data.tags 一致，也无需操作)
    // 修复：getCharTags 需要从 data.js 导入，或者在这里使用 state.tagMap
    const currentTagIds = state.tagMap[avatar] || [];
    const currentTagNames = currentTagIds.map(id => {
        const tag = state.tags.find(t => t.id === id);
        return tag ? tag.name : null;
    }).filter(Boolean);
    
    const sortedImport = [...importTagsList].sort();
    const sortedCurrent = [...currentTagNames].sort();
    if (JSON.stringify(sortedImport) === JSON.stringify(sortedCurrent)) {
        return; // 标签一致，无需处理
    }

    const { existingTags, newTags } = categorizeTags(importTagsList, avatar);
    if (existingTags.length === 0 && newTags.length === 0) {
        return;
    }
    
    // 使用设置中的策略
    let setting;
    const strategy = state.settings.importTagStrategy;
    
    // 策略映射配置
    const strategyMap = {
        'auto': tag_import_setting.ALL,
        'existing': tag_import_setting.ONLY_EXISTING,
        'none': tag_import_setting.NONE,
        'ask': tag_import_setting.ASK
    };
    
    setting = strategyMap[strategy] || tag_import_setting.ASK;

    let tagsToApply = [];

    switch (setting) {
        case tag_import_setting.ALL:
            tagsToApply = [...existingTags, ...newTags];
            break;
        case tag_import_setting.ONLY_EXISTING:
            tagsToApply = [...existingTags];
            break;
        case tag_import_setting.ASK:
            tagsToApply = await showTagImportPopup(character, existingTags, newTags);
            break;
        case tag_import_setting.NONE:
            tagsToApply = [];
            break;
    }

    // Save user selection to cm_manager.tags
    const selectedTagNames = tagsToApply.map(t => t.name);

    // Save cm_manager.tags to character card file
    // 关键逻辑：
    // 1. cm.tags 原本是 undefined（首次导入标签），必须保存到文件
    // 2. 用户明确决策（ASK/NONE），即使 skipSave=true 也要保存
    // 3. 其他情况（自动导入），遵循 skipSave 参数
    const isExplicitDecision = setting === tag_import_setting.ASK || setting === tag_import_setting.NONE;
    const isFirstImport = cm.tags === undefined;  // 首次导入标签
    let saveSuccess = true;
    
    if (!skipSave || isExplicitDecision || isFirstImport) {
        // 首次导入或明确决策，强制持久化
        saveSuccess = await saveCmManagerTags(avatar, selectedTagNames);
    }
    
    // 只有保存成功才更新内存中的 cm.tags
    if (saveSuccess) {
        cm.tags = selectedTagNames;
    } else {
        console.warn(`[ST-Tags] importTags 保存失败，不更新内存: ${avatar}`);
    }

    // Apply tags (清空标签关联当用户选择不导入时)
    if (tagsToApply && tagsToApply.length > 0) {
        await applyTags(avatar, tagsToApply, skipSave, true);
    } else if (tagsToApply.length === 0 && setting === tag_import_setting.ASK) {
        // 用户明确选择"不导入"，清空内存中的标签关联
        clearCharTags(avatar);
    }
}

/**
 * 检查角色是否需要导入标签（cm_manager.tags 不存在但有 data.tags）
 * @param {object} character - 角色对象
 * @returns {boolean}
 */
export function needsTagImport(character) {
    const cm = getCmManager(character);
    if (cm.tags !== undefined) return false;
    
    const rawTags = getRawTags(character);
    const fileName = character.fileName || character.avatar || character.name || 'unknown';
    const importTagsList = filterTags(rawTags, fileName);
    return importTagsList.length > 0;
}

/**
 * 批量导入标签（用于 scan 函数）
 * @param {object[]} characters - 需要导入标签的角色数组
 * @param {object} options - 选项
 * @param {boolean} [options.skipSave=false] - 是否跳过保存
 * @param {number} [options.concurrency] - 并发数，默认使用设置中的 scanBatchSize
 * @returns {Promise<{success: number, errors: number}>} 处理结果统计
 */
export async function batchImportTags(characters, { skipSave = false, concurrency } = {}) {
    // 如果未指定并发数，使用设置中的批次大小
    if (concurrency === undefined) {
        concurrency = state.settings?.scanBatchSize || 15;
    }
    if (!characters || characters.length === 0) return { success: 0, errors: 0 };
    
    // 少量角色：逐个弹窗询问
    if (characters.length <= 3) {
        let success = 0;
        for (const char of characters) {
            await importTags(char, { importSetting: tag_import_setting.ASK, skipSave });
            success++;
        }
        return { success, errors: 0 };
    }
    
    // 大量角色：弹出统一策略选择
    const strategy = await showBatchTagStrategyPopup(characters.length);
    
    switch (strategy) {
        case batch_tag_strategy.IMPORT_ALL: {
            // 全部导入 - 使用并发处理
            const tasks = characters.map(char => async () => {
                const fileName = char.fileName || char.avatar;
                const rawTags = getRawTags(char);
                const importTagsList = filterTags(rawTags, fileName);
                const cm = getCmManager(char);
                
                // 保存到文件，检查返回值
                const saveResult = await saveCmManagerTags(fileName, importTagsList);
                
                if (!saveResult) {
                    // 保存失败，不更新内存中的 cm.tags，抛出错误让调用方知道
                    throw new Error(`保存 cm_manager.tags 失败: ${fileName}`);
                }
                
                // 保存成功才更新内存
                cm.tags = importTagsList;
                
                const { existingTags, newTags } = categorizeTags(importTagsList, fileName);
                await applyTags(fileName, [...existingTags, ...newTags], skipSave);
            });
            const results = await runWithConcurrency(tasks, concurrency);
            // 检查并记录错误
            const errors = results.filter(r => r.status === 'rejected').length;
            if (errors > 0) {
                log(`[ST-Tags] 批量导入完成，但有 ${errors} 个角色处理失败`);
            }
            return { success: results.length - errors, errors };
        }
            
        case batch_tag_strategy.SKIP_ALL: {
            // 全部跳过，设置空数组 - 使用并发处理
            const tasks = characters.map(char => async () => {
                const fileName = char.fileName || char.avatar;
                
                // 保存空数组到文件，检查返回值
                const saveResult = await saveCmManagerTags(fileName, []);
                
                if (!saveResult) {
                    // 保存失败，抛出错误让调用方知道
                    throw new Error(`保存 cm_manager.tags 失败: ${fileName}`);
                }
                
                // 保存成功才更新内存
                const cm = getCmManager(char);
                cm.tags = [];
            });
            const results = await runWithConcurrency(tasks, concurrency);
            const errors = results.filter(r => r.status === 'rejected').length;
            if (errors > 0) {
                log(`[ST-Tags] 批量跳过完成，但有 ${errors} 个角色处理失败`);
            }
            return { success: results.length - errors, errors };
        }
            
        case batch_tag_strategy.ASK_EACH:
            // 逐个询问（需要用户交互，无法并行）
            for (const char of characters) {
                await importTags(char, { importSetting: tag_import_setting.ASK, skipSave });
            }
            return { success: characters.length, errors: 0 };
            
        case batch_tag_strategy.CANCEL:
        default:
            // 取消，不做任何处理
            return { success: 0, errors: 0 };
    }
}

/**
 * 从服务器获取角色的真实标签数据（回源读取）
 * @param {string} fileName - 角色文件名
 * @returns {Promise<string[]>} 标签名称数组
 */
async function fetchRealTagsFromServer(fileName) {
    try {
        // 使用模板字符串提高 URL 构造可读性
        const url = `/characters/${encodeURIComponent(fileName)}?t=${Date.now()}`;
        const r = await authFetch(url);
        if (!r.ok) return [];
        const buf = await r.arrayBuffer();
        const p = await parsePNG(buf);
        if (!p) return [];
        
        const data = p.data || p;
        // 优先检查 cm_manager.tags（仅接受数组）
        if (Array.isArray(data.extensions?.cm_manager?.tags)) {
            return data.extensions.cm_manager.tags;
        }
        // 否则返回 data.tags
        return Array.isArray(data.tags) ? data.tags : [];
    } catch (e) {
        console.warn(`[ST-Tags] 回源读取标签失败 ${fileName}:`, e);
        return [];
    }
}

/**
 * 检查两个标签数组内容是否相同（忽略顺序，正确处理重复元素）
 * @param {string[]} arr1 - 第一个数组
 * @param {string[]} arr2 - 第二个数组
 * @returns {boolean} 是否相同
 */
function areTagsEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    // 排序后逐项比较，确保重复元素语义正确
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    for (let i = 0; i < sorted1.length; i++) {
        if (sorted1[i] !== sorted2[i]) return false;
    }
    return true;
}

/**
 * 原子计数器类 - 用于并发环境下的安全计数
 */
class AtomicCounter {
    #value = 0;
    increment() { return ++this.#value; }
    get() { return this.#value; }
}

/**
 * 并发控制器 - 限制同时执行的 Promise 数量
 * @param {Array<() => Promise<T>>} tasks - 任务函数数组
 * @param {number} concurrency - 最大并发数
 * @param {Function} [onProgress] - 可选的进度回调 (completed, total)
 * @returns {Promise<Array<{status: string, value?: T, reason?: Error}>>}
 * @template T
 */
async function runWithConcurrency(tasks, concurrency = 5, onProgress) {
    const results = new Array(tasks.length);
    let currentIndex = 0;
    const completedCounter = new AtomicCounter();
    const total = tasks.length;
    
    async function runTask() {
        while (currentIndex < tasks.length) {
            const index = currentIndex++;
            try {
                results[index] = { status: 'fulfilled', value: await tasks[index]() };
            } catch (error) {
                results[index] = { status: 'rejected', reason: error };
                log(`[ST-Tags] 任务 ${index} 执行失败:`, error);
            }
            // 进度回调在任务完成后触发
            if (onProgress) {
                // 优化：只传递当前完成的结果，避免创建整个数组的切片
                onProgress(completedCounter.increment(), total, results[index]);
            }
        }
    }
    
    // 启动 concurrency 个并发任务
    const workers = Array(Math.min(concurrency, tasks.length))
        .fill(null)
        .map(() => runTask());
    
    await Promise.all(workers);
    return results;
}

/**
 * 汇总任务结果数组为统计对象
 * @param {Array<{status: string, value?: object}>} results - 任务结果数组
 * @returns {{updated: number, skipped: number, fetched: number, created: number, errors: number}}
 */
function aggregateResults(results) {
    const stats = { updated: 0, skipped: 0, fetched: 0, created: 0, errors: 0 };
    let rejectedCount = 0;
    
    for (const result of results) {
        if (result.status === 'rejected') {
            rejectedCount++;
            continue;
        }
        const value = result.value;
        if (value && typeof value === 'object') {
            stats.updated += value.updated || 0;
            stats.skipped += value.skipped || 0;
            stats.fetched += value.fetched || 0;
            stats.created += value.created || 0;
            stats.errors += value.errors || 0;
        }
    }
    
    // rejected 任务也计入 errors
    stats.errors += rejectedCount;
    
    return stats;
}

/**
 * 批量从 data.tags 导入标签到插件管理 (手动触发)
 * @param {string} strategy - 导入策略 ('merge' | 'overwrite' | 'skip')
 * @param {Function} onProgress - 进度回调 (current, total, stats)
 * @param {number} [concurrency] - 并发数，默认使用设置中的 scanBatchSize
 * @returns {Promise<{updated: number, skipped: number, fetched: number, created: number, errors: number}>} 详细统计结果
 */
export async function batchImportDataTags(strategy, onProgress, concurrency) {
    // 如果未指定并发数，使用设置中的批次大小
    if (concurrency === undefined) {
        concurrency = state.settings?.scanBatchSize || 15;
    }
    const characters = state.characters;
    const total = characters.length;
    
    // 创建所有角色的处理任务
    // 每个任务返回独立的统计结果，避免共享状态导致的竞态条件
    const tasks = characters.map((char) => async () => {
        // 每个任务的独立统计
        const localStats = { updated: 0, skipped: 0, fetched: 0, created: 0, errors: 0 };
        
        const fileName = char.fileName || char.avatar;
        let rawTags = getRawTags(char);
        let importTagsList = filterTags(rawTags, fileName);
        
        // 【回源兜底】如果缓存中 tags 为空，尝试从服务器获取真实数据
        const cmManagerTags = char.data?.extensions?.cm_manager?.tags;
        if (importTagsList.length === 0 && !Array.isArray(cmManagerTags)) {
            const realTags = await fetchRealTagsFromServer(fileName);
            if (realTags.length > 0) {
                importTagsList = filterTags(realTags, fileName);
                localStats.fetched = 1;
                log(`[ST-Tags] 回源获取到标签: ${fileName} -> ${importTagsList.join(', ')}`);
            }
        }
        
        if (importTagsList.length === 0) {
            localStats.skipped = 1;
            return localStats;
        }

        const cm = getCmManager(char);
        const currentPluginTags = cm.tags || [];
        
        let newPluginTags = [];
        let shouldUpdate = false;

        if (strategy === 'skip') {
            if (currentPluginTags.length === 0) {
                newPluginTags = importTagsList;
                shouldUpdate = true;
            } else {
                localStats.skipped = 1;
            }
        } else if (strategy === 'overwrite') {
            newPluginTags = importTagsList;
            shouldUpdate = true;
        } else {
            newPluginTags = [...new Set([...currentPluginTags, ...importTagsList])];
            shouldUpdate = !areTagsEqual(currentPluginTags, newPluginTags);
            if (!shouldUpdate) {
                localStats.skipped = 1;
            }
        }

        if (shouldUpdate) {
            if (fileName) {
                try {
                    const saveResult = await saveCmManagerTags(fileName, newPluginTags);
                    if (!saveResult) {
                        console.warn(`[ST-Tags] Failed to save tags for ${fileName}`);
                        localStats.errors = 1;
                        return localStats;
                    }
                } catch (e) {
                    console.warn(`[ST-Tags] Failed to save tags for ${fileName}:`, e);
                    localStats.errors = 1;
                    return localStats;
                }
            }
            
            // 保存成功才更新内存
            cm.tags = newPluginTags;
            syncCmManagerTagsToSTMemory(fileName, newPluginTags);
            
            const { existingTags, newTags } = categorizeTags(newPluginTags, fileName, false);
            localStats.created = newTags.length;
            await applyTags(fileName, [...existingTags, ...newTags], true, true);
            localStats.updated = 1;
        }

        return localStats;
    });
    
    // 用于实时统计的累加器（仅在进度回调时使用）
    let accumulatedStats = { updated: 0, skipped: 0, fetched: 0, created: 0, errors: 0 };
    
    // 使用并发控制执行所有任务
    const results = await runWithConcurrency(tasks, concurrency, (completed, totalTasks, latestResult) => {
        if (onProgress) {
            // 从最新完成的结果中累加统计
            if (latestResult && latestResult.status === 'fulfilled' && latestResult.value) {
                accumulatedStats.updated += latestResult.value.updated || 0;
                accumulatedStats.skipped += latestResult.value.skipped || 0;
                accumulatedStats.fetched += latestResult.value.fetched || 0;
                accumulatedStats.created += latestResult.value.created || 0;
                accumulatedStats.errors += latestResult.value.errors || 0;
            }
            onProgress(completed, totalTasks, { ...accumulatedStats });
        }
    });
    
    // 汇总最终结果
    const stats = aggregateResults(results);
    
    // 最后统一保存一次 tags.json
    saveTags();
    
    // 同步更新 IndexedDB 缓存，确保重启后数据不丢失
    await setCache('characters', state.characters);
    
    log(`[ST-Tags] 批量导入完成: 更新 ${stats.updated}, 跳过 ${stats.skipped}, 回源 ${stats.fetched}, 新建标签 ${stats.created}, 错误 ${stats.errors}`);
    return stats;
}

/**
 * 从数组中移除元素
 * @param {Array} arr - 数组
 * @param {*} item - 要移除的元素
 */
function removeFromArray(arr, item) {
    const index = arr.indexOf(item);
    if (index > -1) {
        arr.splice(index, 1);
    }
}

/**
 * 显示批量标签导入策略选择弹窗
 * @param {number} count - 需要处理的角色数量
 * @returns {Promise<number>} 用户选择的策略
 */
async function showBatchTagStrategyPopup(count) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = state.isDarkMode ? 'cm-tag-editor-overlay cm-theme-dark' : 'cm-tag-editor-overlay cm-theme-light';
        overlay.style.zIndex = String(Z_INDEX.DYNAMIC_OVERLAY_MAX);

        overlay.innerHTML = `
            <div class="cm-tag-editor" style="max-width: 420px;">
                <div class="cm-tag-editor-header">
                    <h3>标签导入策略</h3>
                    <button class="cm-tag-editor-close">×</button>
                </div>
                <div class="cm-tag-editor-body">
                    <div class="cm-batch-strategy-content">
                        <div class="cm-batch-strategy-hint">
                            发现 <strong>${count}</strong> 张角色卡包含标签但未设置导入策略。<br>
                            请选择如何处理这些标签：
                        </div>
                        <div class="cm-batch-strategy-options">
                            <button class="cm-btn cm-btn-primary cm-batch-strategy-btn" data-strategy="${batch_tag_strategy.IMPORT_ALL}">
                                ✅ 全部导入
                            </button>
                            <button class="cm-btn cm-btn-secondary cm-batch-strategy-btn" data-strategy="${batch_tag_strategy.SKIP_ALL}">
                                ❌ 全部跳过
                            </button>
                            <button class="cm-btn cm-btn-secondary cm-batch-strategy-btn" data-strategy="${batch_tag_strategy.ASK_EACH}">
                                🔍 逐个选择
                            </button>
                            <button class="cm-btn cm-btn-secondary cm-batch-strategy-btn" data-strategy="${batch_tag_strategy.CANCEL}">
                                ⏹️ 取消
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const closePopup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.onclick = (e) => {
            if (e.target === overlay) closePopup(batch_tag_strategy.CANCEL);
        };

        overlay.querySelector('.cm-tag-editor-close').onclick = () => closePopup(batch_tag_strategy.CANCEL);

        overlay.querySelectorAll('.cm-batch-strategy-btn').forEach(btn => {
            btn.onclick = () => {
                const strategy = parseInt(btn.dataset.strategy);
                closePopup(strategy);
            };
        });
    });
}

/**
 * 显示标签导入弹窗（自定义实现，不依赖 ST 原生弹窗）
 * @param {object} character - 角色对象
 * @param {Array} existingTags - 已存在的标签列表
 * @param {Array} newTags - 新标签列表
 * @returns {Promise<Array>} - 返回要导入的标签数组
 */
async function showTagImportPopup(character, existingTags, newTags) {
    return new Promise(resolve => {
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = state.isDarkMode ? 'cm-tag-editor-overlay cm-theme-dark' : 'cm-tag-editor-overlay cm-theme-light';
        overlay.style.zIndex = String(Z_INDEX.IMPORT_TAG_OVERLAY);

        // 构建弹窗内容
        let bodyHtml = `
            <div class="cm-tag-import-content">
                <div class="cm-tag-import-hint">
                    点击标签上的 × 可以移除不想导入的标签。<br>
                    选择下方的导入选项完成标签导入。
                </div>
        `;

        // 已存在的标签区域
        if (existingTags.length > 0) {
            bodyHtml += `
                <div class="cm-tag-import-section">
                    <h4>已存在的标签 <small>(${existingTags.length})</small></h4>
                    <div class="cm-tag-import-list" id="cm-import-existing-list">
                        ${existingTags.map((tag, idx) => `
                            <span class="cm-tag-import-badge" data-type="existing" data-idx="${idx}">
                                <span class="cm-tag-import-color" style="background: ${tag.color || '#6b7280'}"></span>
                                <span class="cm-tag-import-name">${escapeHtml(tag.name)}</span>
                                <button class="cm-tag-import-remove" title="移除">×</button>
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // 新标签区域
        if (newTags.length > 0) {
            bodyHtml += `
                <div class="cm-tag-import-section">
                    <h4>新标签 <small>(${newTags.length})</small></h4>
                    <div class="cm-tag-import-list" id="cm-import-new-list">
                        ${newTags.map((tag, idx) => `
                            <span class="cm-tag-import-badge cm-tag-import-new" data-type="new" data-idx="${idx}">
                                <span class="cm-tag-import-color" style="background: #6b7280"></span>
                                <span class="cm-tag-import-name">${escapeHtml(tag.name)}</span>
                                <button class="cm-tag-import-remove" title="移除">×</button>
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        bodyHtml += `</div>`;

        // 构建完整的弹窗 HTML
        overlay.innerHTML = `
            <div class="cm-tag-editor">
                <div class="cm-tag-editor-header">
                    <h3>导入标签 - ${escapeHtml(character.name)}</h3>
                </div>
                <div class="cm-tag-editor-body">
                    ${bodyHtml}
                </div>
                <div class="cm-tag-editor-footer">
                    <button class="cm-btn cm-btn-secondary" id="cm-tag-import-none">不导入</button>
                    ${existingTags.length > 0 ? '<button class="cm-btn cm-btn-secondary" id="cm-tag-import-existing">仅导入已存在</button>' : ''}
                    <button class="cm-btn cm-btn-primary" id="cm-tag-import-all">导入选中</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // 当前选中的标签列表（可被移除）
        let selectedExisting = [...existingTags];
        let selectedNew = [...newTags];

        // 关闭弹窗的函数（用户必须通过底部按钮明确选择）
        const closePopup = (result) => {
            overlay.remove();
            resolve(result);
        };

        // 不导入按钮
        overlay.querySelector('#cm-tag-import-none').onclick = () => closePopup([]);

        // 仅导入已存在按钮
        const existingBtn = overlay.querySelector('#cm-tag-import-existing');
        if (existingBtn) {
            existingBtn.onclick = () => closePopup(selectedExisting);
        }

        // 导入选中按钮
        overlay.querySelector('#cm-tag-import-all').onclick = () => {
            closePopup([...selectedExisting, ...selectedNew]);
        };

        // 标签移除功能
        overlay.querySelectorAll('.cm-tag-import-remove').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const badge = btn.closest('.cm-tag-import-badge');
                const type = badge.dataset.type;
                const idx = parseInt(badge.dataset.idx);

                if (type === 'existing') {
                    const tag = existingTags[idx];
                    selectedExisting = selectedExisting.filter(t => t.id !== tag.id);
                } else {
                    const tag = newTags[idx];
                    selectedNew = selectedNew.filter(t => t.name !== tag.name);
                }

                badge.style.opacity = '0.3';
                badge.style.textDecoration = 'line-through';
                btn.disabled = true;
                btn.textContent = '✓';
                btn.title = '已移除';
            };
        });
    });
}
