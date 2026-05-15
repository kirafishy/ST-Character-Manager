import { getSTContext, doc } from './context.js';
import { state } from './state.js';
import { createTag, addTagToChar, saveTags, saveCharacterData, syncCmManagerTagsToSTMemory, syncTagsToCard } from './data.js';
import { log, escapeHtml, parsePNG, notify } from './utils.js';
import { Z_INDEX } from './constants.js';
import { authFetch } from './api.js';
import { setCache } from './db.js';

const IMPORT_EXLCUDED_TAGS = ['ROOT', 'TAVERN'];
const ANTI_TROLL_MAX_TAGS = 50;

// cm_manager 扩展配置的 key
export const CM_MANAGER_KEY = 'cm_manager';

// 批量写入队列（用于收集需要批量写入的角色卡）
export const pendingApiWrites = [];

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
 * @returns {Promise<boolean>} 是否进行了迁移（注意：即使迁移成功，保存也可能失败）
 */
export async function migrateAndSaveCmManager(character) {
    const migrated = migrateToCmManager(character);
    if (migrated && character.avatar) {
        // 保存整个 cm_manager 对象到文件
        const cm = getCmManager(character);
        const saveResult = await saveCharacterData(character.avatar, (data) => {
            if (!data.extensions) data.extensions = {};
            data.extensions.cm_manager = cm;
            // 清理旧字段
            if (data.extensions.st_character_manager_note !== undefined) {
                delete data.extensions.st_character_manager_note;
            }
        });
        
        // 【修复】检查保存结果，失败时记录日志
        if (!saveResult) {
            console.warn(`[ST-Tags] migrateAndSaveCmManager: ${character.avatar} 保存失败，迁移未持久化`);
        }
    }
    return migrated;
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
    
    // 同步更新内存中角色对象的所有 tags 相关字段（避免下次扫描重复触发）
    const char = state.characters.find(c => c.fileName === avatar || c.avatar === avatar);
    if (char) {
        // 更新根层级 tags
        char.tags = [];
        // 更新 data.tags
        if (char.data) {
            char.data.tags = [];
        }
        // 更新 data.extensions.cm_manager.tags
        if (char.data?.extensions?.cm_manager) {
            char.data.extensions.cm_manager.tags = [];
        } else {
            if (!char.data) char.data = {};
            if (!char.data.extensions) char.data.extensions = {};
            if (!char.data.extensions.cm_manager) char.data.extensions.cm_manager = {};
            char.data.extensions.cm_manager.tags = [];
        }
    }
}

/**
 * 根据 avatar 文件名获取角色名称
 * @param {string} avatar - 角色头像文件名
 * @returns {string} 角色名称
 */
function getCharNameByAvatar(avatar) {
    const char = state.characters.find(c => c.fileName === avatar || c.avatar === avatar);
    return char ? char.name : avatar.replace(/\.png$/i, '');
}
/**
 * 应用标签到角色
 * @param {string} avatar - 角色头像文件名
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
    const addedTagNames = [];
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
                    if (await addTagToChar(avatar, tag.id, true, false, true)) {
                        addedCount++;
                        addedTagNames.push(tag.name);
                    }
                }
            } else {
                // 已存在的标签对象
                if (await addTagToChar(avatar, item.id, true, false, true)) {
                    addedCount++;
                    addedTagNames.push(item.name);
                }
            }
        }
    }
    
    if (addedCount > 0) {
        if (!skipSave) saveTags();
        // 获取角色名称
        const charName = getCharNameByAvatar(avatar);
        log(`Applied ${addedCount} tags to "${charName}": [${addedTagNames.join(', ')}]`);
    }
    
    // 同步更新内存中角色对象的所有 tags 相关字段（避免下次扫描重复触发）
    // 注意：无论 addedCount 是否 > 0，都要更新内存中的字段（replace 模式下清空标签时 addedCount=0）
    const char = state.characters.find(c => c.fileName === avatar || c.avatar === avatar);
    if (char) {
        // 更新根层级 tags
        char.tags = addedTagNames;
        // 更新 data.tags
        if (char.data) {
            char.data.tags = addedTagNames;
        }
        // 更新 data.extensions.cm_manager.tags
        if (char.data?.extensions?.cm_manager) {
            char.data.extensions.cm_manager.tags = addedTagNames;
        } else {
            if (!char.data) char.data = {};
            if (!char.data.extensions) char.data.extensions = {};
            if (!char.data.extensions.cm_manager) char.data.extensions.cm_manager = {};
            char.data.extensions.cm_manager.tags = addedTagNames;
        }
    }
    
    return addedCount;
}

/**
 * Handles the import of tags for a given character
 * @param {object} character - The character object
 * @param {object} [options] - Options
 * @param {number} [options.importSetting=null] - Force a tag import setting
 * @param {boolean} [options.skipSave=false] - Whether to skip saving tags.json
 * @param {boolean} [options.checkCmManager=true] - Whether to check cm_manager.tags first
 * @param {boolean} [options.skipApiCall=false] - Whether to skip API calls (collect to pending queue)
 */
export async function importTags(character, { importSetting = null, skipSave = false, checkCmManager = true, skipApiCall = false, isManualImport = false } = {}) {
    const ctx = getSTContext();
    if (!ctx) return;

    const avatar = character.fileName || character.avatar;
    const cm = getCmManager(character);
    
    // 【修复】选项B：如果手动导入，且记忆为拒绝标签(空数组)，但卡片自带标签，则忽略记忆
    let useCmManager = checkCmManager;
    if (isManualImport && useCmManager && cm.tags !== undefined && cm.tags.length === 0) {
        const rawTags = getRawTags(character);
        const importTagsList = filterTags(rawTags, avatar);
        if (importTagsList.length > 0) {
            console.log(`[ST-Tags] 手动导入：发现卡片自带标签，忽略无标签记忆，强制进入判断流程`);
            useCmManager = false;
        }
    }
    
    // 如果启用 cm_manager 检查，且 cm_manager.tags 存在（即使是空数组）
    if (useCmManager && cm.tags !== undefined) {
        // 使用 cm_manager.tags 作为标签来源
        const savedTagNames = cm.tags;
        
        // 检查 state.tagMap 是否有更新的数据（用于检测保存失败的情况）
        const currentTagIds = state.tagMap[avatar] || [];
        const currentTagNames = currentTagIds.map(id => {
            const tag = state.tags.find(t => t.id === id);
            return tag ? tag.name : null;
        }).filter(Boolean);
        
        // 如果 state.tagMap 有数据但 cm.tags 为空，说明可能是保存失败
        // 使用 state.tagMap 的数据作为更可靠的数据源
        // 【注意】这段逻辑在 cm.tags 已存在的情况下执行，说明用户之前已经做出过选择
        // 如果 cm.tags 为空且 state.tagMap 有数据，很可能是保存失败导致的
        if (currentTagNames.length > 0 && (!savedTagNames || savedTagNames.length === 0)) {
            console.warn(`[ST-Tags] 检测到数据不一致（cm.tags 为空但 state.tagMap 有数据），使用 state.tagMap 的数据: ${avatar}`);
            
            // 数据恢复，不改变用户选择（cm.tags 应该保持为空，表示用户选择"不导入")
            // 但不清空 state.tagMap 的数据，保持用户手动添加的标签
            // 注意：这里不写入角色卡，因为 cm.tags 已经记录了用户的选择
            return;
        }
        
        if (!savedTagNames || savedTagNames.length === 0) {
            // 用户之前选择不导入任何标签，清除现有标签关联
            clearCharTags(avatar);
            return;
        }
        
        // 检查是否需要更新
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

    // 检查是否需要更新
    const currentTagIds = state.tagMap[avatar] || [];
    const currentTagNames = currentTagIds.map(id => {
        const tag = state.tags.find(t => t.id === id);
        return tag ? tag.name : null;
    }).filter(Boolean);
    
    // 如果角色卡内置标签和插件标签一致，无需处理
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
            // 【修复】传入上下文信息，显示当前不同字段的标签
            const contextInfo = {
                stateTagMapTags: currentTagNames,
                dataTags: importTagsList
            };
            const popupResult = await showTagImportPopup(character, existingTags, newTags, contextInfo);
            tagsToApply = popupResult.tags;
            // 注意：applyToAll 逻辑在 batchImportTags() 中处理，这里只使用 tags
            break;
        case tag_import_setting.NONE:
            tagsToApply = [];
            break;
    }

    // Save cm_manager.tags to character card file
    // 关键逻辑：
    // 1. cm.tags 原本是 undefined（首次导入标签），必须保存到文件
    // 2. 用户明确决策（ASK/NONE），即使 skipSave=true 也要保存
    // 3. 其他情况（自动导入），遵循 skipSave 参数
    const isFirstImport = cm.tags === undefined;  // 首次导入标签
    const isExplicitDecision = setting === tag_import_setting.ASK || setting === tag_import_setting.NONE;
    let saveSuccess = true;
    
    // Save user selection to cm_manager.tags
    // 【修复】合并 state.tagMap 中已有的标签，避免丢失用户手动添加的标签
    // 但 NONE 模式下不合并，因为用户明确选择不导入任何标签
    const currentTagIdsForSave = state.tagMap[avatar] || [];
    const currentTagNamesForSave = currentTagIdsForSave.map(id => {
        const tag = state.tags.find(t => t.id === id);
        return tag ? tag.name : null;
    }).filter(Boolean);
    
    // NONE 模式下不合并 state.tagMap，保持空数组
    const selectedTagNames = setting === tag_import_setting.NONE
        ? []
        : [...new Set([
            ...currentTagNamesForSave,
            ...tagsToApply.map(t => t.name)
        ])];
    
    if (!skipSave || isExplicitDecision || isFirstImport) {
        // 首次导入或明确决策，强制持久化
        if (skipApiCall) {
            // 只更新内存，收集到批量写入队列
            cm.tags = selectedTagNames;
            const needsSync = state.settings.autoSyncTags;
            pendingApiWrites.push({
                fileName: avatar,
                cmTags: selectedTagNames,
                needsSync
            });
            saveSuccess = true;
        } else {
            saveSuccess = await saveCmManagerTags(avatar, selectedTagNames);
            // 只有保存成功才更新内存中的 cm.tags
            if (saveSuccess) {
                cm.tags = selectedTagNames;
            }
        }
    } else {
        // 非首次导入/非明确决策，直接更新内存
        cm.tags = selectedTagNames;
    }
    
    // 【修复】如果 skipApiCall=false 且保存失败，记录日志但不直接 return
    // 因为批量写入模式下失败会统一处理
    if (!skipApiCall && !saveSuccess) {
        console.warn(`[ST-Tags] importTags 保存失败: ${avatar}`);
        // 保存失败时不更新 cm.tags，保持 undefined 状态
        return;
    }

    // Apply tags (清空标签关联当用户选择不导入时)
    // 【修复】显示操作进行中的提示
    const charName = character.name || avatar.replace(/\.png$/i, '');
    notify(`正在处理「${charName}」的标签...`, 'info');
    
    if (tagsToApply && tagsToApply.length > 0) {
        // 【修复】在替换模式下，先获取 state.tagMap 中已有的标签，然后合并到 tagsToApply 中
        // 避免清空用户之前手动添加但未被 cm_manager.tags 记录的标签
        const currentTagIds = state.tagMap[avatar] || [];
        const currentTags = currentTagIds.map(id => {
            const tag = state.tags.find(t => t.id === id);
            return tag;
        }).filter(Boolean);
        
        // 合并当前已有的标签和要应用的标签（去重）
        const mergedTags = [...currentTags, ...tagsToApply.filter(t =>
            !currentTags.some(ct => ct.name.toLowerCase() === t.name.toLowerCase())
        )];
        
        if (mergedTags.length > 0) {
            await applyTags(avatar, mergedTags, skipSave, true);
            // 【修复】显示操作完成的提示
            if (!skipSave) {
                notify(`已为「${charName}」导入 ${mergedTags.length} 个标签`, 'success');
            }
        } else {
            clearCharTags(avatar);
        }
    } else if (tagsToApply.length === 0 && (setting === tag_import_setting.ASK || setting === tag_import_setting.NONE)) {
        // 用户明确选择"不导入"（ASK 或 NONE 模式）
        // 【修复】当 cm.tags 是 undefined（首次导入）时，使用 state.tagMap 的数据作为 cm.tags
        // 避免清空用户之前手动添加但保存失败的标签
        if (isFirstImport) {
            const currentTagNames = (state.tagMap[avatar] || []).map(id => {
                const tag = state.tags.find(t => t.id === id);
                return tag ? tag.name : null;
            }).filter(Boolean);
            
            if (currentTagNames.length > 0) {
                // state.tagMap 有数据，使用它作为 cm.tags
                console.log(`[ST-Tags] 首次导入用户选择不导入，保留 state.tagMap 的数据: ${avatar} -> ${currentTagNames.join(', ')}`);
                cm.tags = currentTagNames;
                
                if (skipApiCall) {
                    // 只更新内存，收集到批量写入队列
                    const needsSync = state.settings.autoSyncTags;
                    pendingApiWrites.push({
                        fileName: avatar,
                        cmTags: currentTagNames,
                        needsSync
                    });
                } else {
                    // 保存到文件
                    await saveCmManagerTags(avatar, currentTagNames);
                    // 【修复】如果开启了自动同步，同步到 data.tags
                    if (state.settings.autoSyncTags) {
                        await syncTagsToCard(avatar);
                    }
                }
                return;
            }
        }
        // 其他情况：清空内存中的标签关联
        clearCharTags(avatar);
    }
    
    // 【修复】如果开启了自动同步，在标签导入完成后同步到 data.tags
    if (!skipApiCall && state.settings.autoSyncTags) {
        await syncTagsToCard(avatar);
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
    
    // 【修复】如果 state.tagMap 已经有数据，说明用户之前已经处理过
    // 不需要再次弹窗，而是应该在 importTags 中自动恢复
    const avatar = character.fileName || character.avatar;
    if (state.tagMap[avatar] && state.tagMap[avatar].length > 0) {
        return false;
    }
    
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
 * @param {boolean} [options.skipApiCall=false] - 是否跳过 API 调用（收集到 pending 队列）
 * @param {number} [options.concurrency] - 并发数，默认使用设置中的 scanBatchSize
 * @returns {Promise<{success: number, errors: number}>} 处理结果统计
 */
export async function batchImportTags(characters, { skipSave = false, skipApiCall = false, concurrency } = {}) {
    // 如果未指定并发数，使用设置中的批次大小
    if (concurrency === undefined) {
        concurrency = state.settings?.scanBatchSize || 15;
    }
    if (!characters || characters.length === 0) return { success: 0, errors: 0 };
    
    // 少量角色：逐个弹窗询问
    if (characters.length <= 3) {
        let success = 0;
        for (const char of characters) {
            await importTags(char, { importSetting: tag_import_setting.ASK, skipSave, skipApiCall });
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
                
                if (skipApiCall) {
                    // 只更新内存，收集到批量写入队列
                    cm.tags = importTagsList;
                    const needsSync = state.settings.autoSyncTags;
                    pendingApiWrites.push({
                        fileName,
                        cmTags: importTagsList,
                        needsSync
                    });
                } else {
                    // 保存到文件，检查返回值
                    const saveResult = await saveCmManagerTags(fileName, importTagsList);
                    
                    if (!saveResult) {
                        // 保存失败，不更新内存中的 cm.tags，抛出错误让调用方知道
                        throw new Error(`保存 cm_manager.tags 失败: ${fileName}`);
                    }
                    
                    // 保存成功才更新内存
                    cm.tags = importTagsList;
                }
                
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
                const cm = getCmManager(char);
                
                if (skipApiCall) {
                    // 只更新内存，收集到批量写入队列
                    cm.tags = [];
                    const needsSync = state.settings.autoSyncTags;
                    pendingApiWrites.push({
                        fileName,
                        cmTags: [],
                        needsSync
                    });
                } else {
                    // 保存空数组到文件，检查返回值
                    const saveResult = await saveCmManagerTags(fileName, []);
                    
                    if (!saveResult) {
                        // 保存失败，抛出错误让调用方知道
                        throw new Error(`保存 cm_manager.tags 失败: ${fileName}`);
                    }
                    
                    // 保存成功才更新内存
                    cm.tags = [];
                }
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
            // 【修复】实现"应用于本次所有弹窗"逻辑
            let globalChoice = null;  // 用户选择的策略（来自第一个弹窗）
            let applyToAllFlag = false;  // 是否应用于所有弹窗
            
            for (let i = 0; i < characters.length; i++) {
                const char = characters[i];
                const remaining = characters.length - i - 1;
                const avatar = char.fileName || char.avatar;
                
                // 获取角色的标签信息
                const rawTags = getRawTags(char);
                const importTagsList = filterTags(rawTags, avatar);
                const currentTagIds = state.tagMap[avatar] || [];
                const currentTagNames = currentTagIds.map(id => {
                    const tag = state.tags.find(t => t.id === id);
                    return tag ? tag.name : null;
                }).filter(Boolean);
                
                const { existingTags, newTags } = categorizeTags(importTagsList, avatar);
                const contextInfo = {
                    stateTagMapTags: currentTagNames,
                    dataTags: importTagsList
                };
                
                let chosenTags;
                
                if (globalChoice !== null && applyToAllFlag) {
                    // 应用之前的策略，跳过弹窗
                    if (globalChoice === 'none') {
                        chosenTags = [];
                    } else if (globalChoice === 'existing') {
                        chosenTags = existingTags;
                    } else if (globalChoice === 'all') {
                        chosenTags = [...existingTags, ...newTags];
                    }
                    
                    // 直接应用选择的标签
                    const cm = getCmManager(char);
                    const selectedTagNames = globalChoice === 'none' ? [] : chosenTags.map(t => t.name);
                    cm.tags = selectedTagNames;
                    
                    if (skipApiCall) {
                        // 收集到批量写入队列
                        const needsSync = state.settings.autoSyncTags;
                        pendingApiWrites.push({
                            fileName: avatar,
                            cmTags: selectedTagNames,
                            needsSync
                        });
                    }
                    
                    if (chosenTags && chosenTags.length > 0) {
                        await applyTags(avatar, chosenTags, skipSave, true);
                    } else {
                        clearCharTags(avatar);
                    }
                } else {
                    // 显示弹窗（传入剩余数量）
                    const popupResult = await showTagImportPopup(char, existingTags, newTags, contextInfo, remaining);
                    chosenTags = popupResult.tags;
                    applyToAllFlag = popupResult.applyToAll;
                    
                    // 根据用户选择确定全局策略
                    if (chosenTags.length === 0) {
                        globalChoice = 'none';
                    } else if (chosenTags.every(t => existingTags.some(et => et.id === t.id))) {
                        globalChoice = 'existing';
                    } else {
                        globalChoice = 'all';
                    }
                    
                    // 应用选择的标签
                    const cm = getCmManager(char);
                    const selectedTagNames = chosenTags.map(t => t.name);
                    cm.tags = selectedTagNames;
                    
                    if (skipApiCall) {
                        // 收集到批量写入队列
                        const needsSync = state.settings.autoSyncTags;
                        pendingApiWrites.push({
                            fileName: avatar,
                            cmTags: selectedTagNames,
                            needsSync
                        });
                    }
                    
                    if (chosenTags.length > 0) {
                        await applyTags(avatar, chosenTags, skipSave, true);
                    } else {
                        clearCharTags(avatar);
                    }
                }
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
 * @param {object} [contextInfo] - 上下文信息
 * @param {string[]} [contextInfo.stateTagMapTags] - state.tagMap 中的标签名称
 * @param {string[]} [contextInfo.dataTags] - data.tags 中的标签名称
 * @param {number} [remainingCount=0] - 剩余需要处理的卡片数量
 * @returns {Promise<{tags: Array, applyToAll: boolean}>} - 返回要导入的标签数组 + 是否应用于所有弹窗
 */
async function showTagImportPopup(character, existingTags, newTags, contextInfo = {}, remainingCount = 0) {
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
        
        // 【新增】显示当前不同字段的标签信息
        if (contextInfo.stateTagMapTags || contextInfo.dataTags) {
            bodyHtml += `
                <div class="cm-tag-import-section" style="background: var(--cm-bg-sec); padding: 8px 12px; border-radius: 4px; margin-bottom: 12px;">
                    <h4 style="margin-bottom: 8px; font-size: 12px;">当前标签状态</h4>
                    <div style="font-size: 11px; color: var(--cm-text-sec);">
                        ${contextInfo.stateTagMapTags && contextInfo.stateTagMapTags.length > 0
                            ? `<div style="margin-bottom: 4px;"><span style="color: var(--cm-text);">插件已记录:</span> ${contextInfo.stateTagMapTags.map(t => `<span style="background: #4b5563; padding: 2px 6px; border-radius: 3px; margin: 2px;">${escapeHtml(t)}</span>`).join('')}</div>`
                            : '<div style="margin-bottom: 4px; color: #9ca3af;">插件未记录任何标签</div>'}
                        ${contextInfo.dataTags && contextInfo.dataTags.length > 0
                            ? `<div><span style="color: var(--cm-text);">角色卡内置:</span> ${contextInfo.dataTags.map(t => `<span style="background: #6b7280; padding: 2px 6px; border-radius: 3px; margin: 2px;">${escapeHtml(t)}</span>`).join('')}</div>`
                            : '<div style="color: #9ca3af;">角色卡无内置标签</div>'}
                    </div>
                </div>
            `;
        }

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
                <div class="cm-tag-editor-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <h3>导入标签 - ${escapeHtml(character.name)}</h3>
                    ${remainingCount > 0 ? `<span style="font-size: 12px; color: var(--cm-text-sec);">剩余 ${remainingCount} 张</span>` : ''}
                </div>
                <div class="cm-tag-editor-body">
                    ${bodyHtml}
                </div>
                <div class="cm-tag-editor-footer" style="display: flex; align-items: center; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--cm-text-sec); margin-right: 12px;">
                        <input type="checkbox" id="cm-apply-to-all" />
                        <span>应用于本次所有弹窗</span>
                    </label>
                    <div style="flex-grow: 1;"></div>
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
            const applyToAllCheckbox = overlay.querySelector('#cm-apply-to-all');
            const applyToAll = applyToAllCheckbox ? applyToAllCheckbox.checked : false;
            overlay.remove();
            resolve({ tags: result, applyToAll });
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

        // 标签移除/恢复功能（可切换）
        overlay.querySelectorAll('.cm-tag-import-remove').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const badge = btn.closest('.cm-tag-import-badge');
                const type = badge.dataset.type;
                const idx = parseInt(badge.dataset.idx);
                const isRemoved = badge.dataset.removed === 'true';

                if (type === 'existing') {
                    const tag = existingTags[idx];
                    if (isRemoved) {
                        // 恢复选中
                        selectedExisting.push(tag);
                        badge.dataset.removed = 'false';
                        badge.style.opacity = '1';
                        badge.style.textDecoration = 'none';
                        btn.textContent = '×';
                        btn.title = '移除';
                    } else {
                        // 取消选中
                        selectedExisting = selectedExisting.filter(t => t.id !== tag.id);
                        badge.dataset.removed = 'true';
                        badge.style.opacity = '0.3';
                        badge.style.textDecoration = 'line-through';
                        btn.textContent = '✓';
                        btn.title = '已移除';
                    }
                } else {
                    const tag = newTags[idx];
                    if (isRemoved) {
                        // 恢复选中
                        selectedNew.push(tag);
                        badge.dataset.removed = 'false';
                        badge.style.opacity = '1';
                        badge.style.textDecoration = 'none';
                        btn.textContent = '×';
                        btn.title = '移除';
                    } else {
                        // 取消选中
                        selectedNew = selectedNew.filter(t => t.name !== tag.name);
                        badge.dataset.removed = 'true';
                        badge.style.opacity = '0.3';
                        badge.style.textDecoration = 'line-through';
                        btn.textContent = '✓';
                        btn.title = '已移除';
                    }
                }
            };
        });
    });
}

/**
 * 批量写入标签到角色卡（带进度显示）
 * @param {Array<{fileName: string, cmTags: string[], needsSync: boolean}>} writes - 待写入列表
 * @param {Function} onProgress - 进度回调 (current, total)
 * @returns {Promise<{success: number, failed: Array<{fileName: string, reason: string}>}>}
 */
export async function batchWriteTagsToCards(writes, onProgress) {
    const results = { success: 0, failed: [] };
    
    if (!writes || writes.length === 0) {
        return results;
    }
    
    for (let i = 0; i < writes.length; i++) {
        const { fileName, cmTags, needsSync } = writes[i];
        
        if (onProgress) {
            onProgress(i + 1, writes.length);
        }
        
        try {
            // 构建一次性写入 cm_manager.tags 和 data.tags 的 payload
            const payload = {
                avatar: fileName,
                data: {
                    tags: cmTags,
                    extensions: {
                        cm_manager: {
                            tags: cmTags
                        }
                    }
                }
            };
            
            // 【新增】输出写入内容到 console
            console.log(`[ST-Tags] 批量写入角色卡: ${fileName}`, {
                'data.tags': cmTags,
                'data.extensions.cm_manager.tags': cmTags
            });
            
            const res = await authFetch('/api/characters/merge-attributes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            if (!res.ok) {
                const errorText = await res.text();
                results.failed.push({
                    fileName,
                    reason: `HTTP ${res.status}: ${errorText.substring(0, 100)}`
                });
            } else {
                results.success++;
                
                // 更新内存中的 tags 字段
                const stateChar = state.characters.find(c => c.fileName === fileName);
                if (stateChar) {
                    if (needsSync) {
                        stateChar.tags = cmTags;
                    }
                    if (stateChar.data) {
                        stateChar.data.tags = cmTags;
                    }
                    if (stateChar.data?.extensions?.cm_manager) {
                        stateChar.data.extensions.cm_manager.tags = cmTags;
                    }
                }
                
                console.log(`[ST-Tags] 批量写入成功: ${fileName} -> ${cmTags.join(', ')}`);
            }
        } catch (e) {
            results.failed.push({
                fileName,
                reason: e.message || String(e)
            });
            console.warn(`[ST-Tags] 批量写入失败: ${fileName}`, e);
        }
    }
    
    return results;
}

/**
 * 清空批量写入队列
 */
export function clearPendingApiWrites() {
    pendingApiWrites.length = 0;
}
