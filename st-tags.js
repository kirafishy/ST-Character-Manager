import { getSTContext } from './context.js';
import { state } from './state.js';
import { createTag, addTagToChar, saveTags, saveCharacterData } from './data.js';
import { log, escapeHtml } from './utils.js';

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
 * 保存 cm_manager.tags 到角色卡元数据
 * @param {string} fileName - 角色文件名
 * @param {string[]} tagNames - 标签名称数组
 */
export async function saveCmManagerTags(fileName, tagNames) {
    await saveCharacterData(fileName, (data) => {
        if (!data.extensions) data.extensions = {};
        if (!data.extensions[CM_MANAGER_KEY]) {
            data.extensions[CM_MANAGER_KEY] = {};
        }
        data.extensions[CM_MANAGER_KEY].tags = tagNames;
    });
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
    // Get tags from character metadata
    // Check both root level tags (V3/Internal) and data.tags (V2)
    let rawTags = character.tags || (character.data && character.data.tags) || [];
    
    // Ensure it's an array
    if (!Array.isArray(rawTags)) {
        // Try to parse string if it's a string
        if (typeof rawTags === 'string') {
            try {
                rawTags = JSON.parse(rawTags);
            } catch {
                rawTags = rawTags.split(',').map(t => t.trim());
            }
        } else {
            rawTags = [];
        }
    }
    
    return rawTags;
}

/**
 * 过滤和处理标签列表
 * @param {string[]} rawTags - 原始标签数组
 * @returns {string[]} 处理后的标签名称数组
 */
function filterTags(rawTags) {
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
 * @returns {{ existingTags: object[], newTags: object[] }}
 */
function categorizeTags(tagNames, avatar) {
    const existingTags = [];
    const newTags = [];
    
    tagNames.forEach(tagName => {
        const existing = getTag(tagName);
        if (existing) {
            // Check if already assigned to char
            const charTags = state.tagMap[avatar] || [];
            if (!charTags.includes(existing.id)) {
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
 * 应用标签到角色
 * @param {string} avatar - 角色头像文件名
 * @param {object[]} tagsToApply - 要应用的标签数组
 * @param {boolean} skipSave - 是否跳过保存
 * @returns {Promise<number>} 添加的标签数量
 */
async function applyTags(avatar, tagsToApply, skipSave = false) {
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
                    if (await addTagToChar(avatar, tag.id, true, false)) addedCount++;
                }
            } else {
                // 已存在的标签对象
                if (await addTagToChar(avatar, item.id, true, false)) addedCount++;
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

    const avatar = character.avatar;
    const cm = getCmManager(character);
    
    // 如果启用 cm_manager 检查，且 cm_manager.tags 存在（即使是空数组）
    if (checkCmManager && cm.tags !== undefined) {
        // 使用 cm_manager.tags 作为标签来源
        const savedTagNames = cm.tags;
        if (!savedTagNames || savedTagNames.length === 0) {
            // 用户之前选择不导入任何标签
            return;
        }
        
        // 将保存的标签名称转换为标签对象并应用
        const { existingTags, newTags } = categorizeTags(savedTagNames, avatar);
        const tagsToApply = [...existingTags, ...newTags];
        
        if (tagsToApply.length > 0) {
            applyTags(avatar, tagsToApply, skipSave);
        }
        return;
    }
    
    // cm_manager.tags 不存在，检查 data.tags
    const rawTags = getRawTags(character);
    if (!rawTags.length) {
        console.debug('[ST-Tags] No tags to import for', character.name);
        return;
    }

    const importTagsList = filterTags(rawTags);
    if (!importTagsList.length) return;

    const { existingTags, newTags } = categorizeTags(importTagsList, avatar);
    if (existingTags.length === 0 && newTags.length === 0) {
        return;
    }

    // Determine import setting
    let setting = importSetting;
    if (!setting) {
        // Try to get from power_user
        if (ctx.powerUserSettings && ctx.powerUserSettings.tag_import_setting !== undefined) {
            setting = ctx.powerUserSettings.tag_import_setting;
        } else {
            setting = tag_import_setting.ASK;
        }
    }

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

    // 保存用户选择到 cm_manager.tags
    const selectedTagNames = tagsToApply.map(t => t.name);
    cm.tags = selectedTagNames;
    
    // 将 cm_manager.tags 保存到角色卡文件
    await saveCmManagerTags(avatar, selectedTagNames);
    
    // 应用标签
    if (tagsToApply && tagsToApply.length > 0) {
        applyTags(avatar, tagsToApply, skipSave);
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
    const importTagsList = filterTags(rawTags);
    return importTagsList.length > 0;
}

/**
 * 批量导入标签（用于 scan 函数）
 * @param {object[]} characters - 需要导入标签的角色数组
 * @param {object} options - 选项
 * @param {boolean} [options.skipSave=false] - 是否跳过保存
 * @returns {Promise<void>}
 */
export async function batchImportTags(characters, { skipSave = false } = {}) {
    if (!characters || characters.length === 0) return;
    
    // 少量角色：逐个弹窗询问
    if (characters.length <= 3) {
        for (const char of characters) {
            await importTags(char, { importSetting: tag_import_setting.ASK, skipSave });
        }
        return;
    }
    
    // 大量角色：弹出统一策略选择
    const strategy = await showBatchTagStrategyPopup(characters.length);
    
    switch (strategy) {
        case batch_tag_strategy.IMPORT_ALL:
            // 全部导入
            for (const char of characters) {
                const rawTags = getRawTags(char);
                const importTagsList = filterTags(rawTags);
                const cm = getCmManager(char);
                cm.tags = importTagsList;
                
                // 保存到文件
                await saveCmManagerTags(char.avatar, importTagsList);
                
                const { existingTags, newTags } = categorizeTags(importTagsList, char.avatar);
                applyTags(char.avatar, [...existingTags, ...newTags], skipSave);
            }
            break;
            
        case batch_tag_strategy.SKIP_ALL:
            // 全部跳过，设置空数组
            for (const char of characters) {
                const cm = getCmManager(char);
                cm.tags = [];
                // 保存空数组到文件
                await saveCmManagerTags(char.avatar, []);
            }
            break;
            
        case batch_tag_strategy.ASK_EACH:
            // 逐个询问
            for (const char of characters) {
                await importTags(char, { importSetting: tag_import_setting.ASK, skipSave });
            }
            break;
            
        case batch_tag_strategy.CANCEL:
        default:
            // 取消，不做任何处理
            break;
    }
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
        overlay.style.zIndex = '2147483000';

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
        overlay.style.zIndex = '2147483000';

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
                    <button class="cm-tag-editor-close">×</button>
                </div>
                <div class="cm-tag-editor-body">
                    ${bodyHtml}
                </div>
                <div class="cm-tag-editor-footer">
                    <button class="cm-btn cm-btn-secondary" id="cm-tag-import-cancel">取消</button>
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

        // 关闭弹窗的函数
        const closePopup = (result) => {
            overlay.remove();
            resolve(result);
        };

        // 点击遮罩层关闭
        overlay.onclick = (e) => {
            if (e.target === overlay) closePopup([]);
        };

        // 关闭按钮
        overlay.querySelector('.cm-tag-editor-close').onclick = () => closePopup([]);

        // 取消按钮
        overlay.querySelector('#cm-tag-import-cancel').onclick = () => closePopup([]);

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