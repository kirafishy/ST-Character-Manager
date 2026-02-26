import { getSTContext } from './context.js';
import { state } from './state.js';
import { createTag, addTagToChar, saveTags } from './data.js';
import { log, escapeHtml } from './utils.js';

const IMPORT_EXLCUDED_TAGS = ['ROOT', 'TAVERN'];
const ANTI_TROLL_MAX_TAGS = 50;

export const tag_import_setting = {
    ASK: 1,
    NONE: 2,
    ALL: 3,
    ONLY_EXISTING: 4,
};

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
 * Handles the import of tags for a given character
 * @param {object} character - The character object
 * @param {object} [options] - Options
 * @param {number} [options.importSetting=null] - Force a tag import setting
 */
export async function importTags(character, { importSetting = null, skipSave = false } = {}) {
    const ctx = getSTContext();
    if (!ctx) return;

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

    if (!rawTags.length) {
        console.debug('[ST-Tags] No tags to import for', character.name);
        return;
    }

    // Filter and process tags
    const importTagsList = rawTags
        .map(t => String(t).trim())
        .filter(t => t)
        .filter(t => !IMPORT_EXLCUDED_TAGS.includes(t))
        .slice(0, ANTI_TROLL_MAX_TAGS);

    if (!importTagsList.length) return;

    // Separate into existing and new
    const existingTags = [];
    const newTags = [];

    importTagsList.forEach(tagName => {
        const existing = getTag(tagName);
        if (existing) {
            // Check if already assigned to char
            const charTags = state.tagMap[character.avatar] || [];
            if (!charTags.includes(existing.id)) {
                existingTags.push(existing);
            }
        } else {
            // New tag
            // Check if we already have it in newTags list to avoid duplicates
            if (!newTags.includes(tagName)) {
                newTags.push(tagName);
            }
        }
    });

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
            return;
    }

    if (!tagsToApply || tagsToApply.length === 0) return;

    // Apply tags
    let addedCount = 0;
    for (const item of tagsToApply) {
        if (typeof item === 'object' && item.id) {
            // Existing tag object
            // 关键修复：从文件导入的标签，不需要标记为“未同步”，因为它们本来就是从文件里读出来的
            if (addTagToChar(character.avatar, item.id, true, false)) addedCount++;
        } else if (typeof item === 'string') {
            // New tag name -> Create then add
            const newTag = createTag(item);
            if (newTag) {
                if (addTagToChar(character.avatar, newTag.id, true, false)) addedCount++;
            }
        }
    }

    if (addedCount > 0) {
        if (!skipSave) saveTags(); // Persist changes
        log(`Imported ${addedCount} tags for ${character.name}`);
        // Refresh UI via callback or event if necessary, but caller (index.js) usually handles refresh
    }
}

async function showTagImportPopup(character, existingTags, newTags) {
    const ctx = getSTContext();
    
    // 构建可交互的标签列表 HTML
    // 使用 checkbox 让用户可以单独选择
    const createTagHtml = (tag, isNew) => {
        const id = isNew ? `new_${tag}` : `exist_${tag.id}`;
        const name = isNew ? tag : tag.name;
        const color = isNew ? 'var(--cm-bg-ter)' : (tag.color || '#666');
        const border = isNew ? '1px dashed var(--cm-border)' : 'none';
        
        return `
            <label class="cm-tag-import-item" style="display:inline-flex;align-items:center;margin:2px;cursor:pointer;user-select:none">
                <input type="checkbox" class="cm-tag-cb" data-type="${isNew ? 'new' : 'exist'}" data-val="${isNew ? escapeHtml(tag) : tag.id}" checked style="margin-right:4px">
                <span class="cm-card-tag" style="background:${color};border:${border};padding:2px 6px;border-radius:4px;font-size:0.9em">${escapeHtml(name)}</span>
            </label>
        `;
    };

    const existingHtml = existingTags.length > 0
        ? `<div style="margin-bottom:10px">
            <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between">
                <span>已存在的标签 (Existing):</span>
                <small><a href="#" id="cmToggleExist" style="color:var(--cm-text-blue)">全选/反选</a></small>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
                ${existingTags.map(t => createTagHtml(t, false)).join('')}
            </div>
           </div>`
        : '';

    const newHtml = newTags.length > 0
        ? `<div style="margin-bottom:10px">
            <div style="font-weight:bold;margin-bottom:5px;display:flex;justify-content:space-between">
                <span>新标签 (New):</span>
                <small><a href="#" id="cmToggleNew" style="color:var(--cm-text-blue)">全选/反选</a></small>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
                ${newTags.map(t => createTagHtml(t, true)).join('')}
            </div>
           </div>`
        : '';

    const html = `
        <div style="padding:10px;max-height:60vh;overflow-y:auto">
            <div style="margin-bottom:15px">
                检测到角色 <b>${escapeHtml(character.name)}</b> 包含以下标签。<br>
                请选择需要导入的标签：
            </div>
            ${existingHtml}
            ${newHtml}
        </div>
    `;

    // 使用 callGenericPopup，但我们需要注入 JS 来处理全选/反选
    // 由于 callGenericPopup 只是显示 HTML，我们无法直接绑定事件到 DOM 元素上（除非它返回 DOM）
    // 但 ST 的 callGenericPopup 通常是阻塞的或者基于 Swal/jQuery UI
    // 如果是 Swal，我们可以利用 didOpen 回调，但这里无法传递函数
    // 替代方案：使用 extension 自己的 createBaseDialog (如果可用) 或者简单的 confirm
    // 鉴于 index.js 里有 createBaseDialog，但这里无法直接访问
    // 我们尝试使用 ctx.callGenericPopup 的自定义按钮来返回结果，但无法处理细粒度的选择
    
    // 既然用户要求“单独选择”，我们需要一个真正的自定义弹窗
    // 我们可以动态创建一个临时的 DOM 弹窗
    
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
        
        const dialog = document.createElement('div');
        dialog.className = 'bg1'; // ST theme class
        dialog.style.cssText = 'width:500px;max-width:90%;padding:20px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;flex-direction:column;max-height:80vh';
        
        dialog.innerHTML = `
            <h3 style="margin-top:0;margin-bottom:15px;text-align:center">导入标签</h3>
            ${html}
            <div style="margin-top:20px;display:flex;justify-content:flex-end;gap:10px">
                <button id="cmTagImportCancel" class="menu_button">取消</button>
                <button id="cmTagImportOk" class="menu_button menu_button_icon">确认导入</button>
            </div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        // Bind events
        const toggleGroup = (type) => {
            const cbs = dialog.querySelectorAll(`.cm-tag-cb[data-type="${type}"]`);
            if (cbs.length === 0) return;
            const allChecked = Array.from(cbs).every(cb => cb.checked);
            cbs.forEach(cb => cb.checked = !allChecked);
        };
        
        const toggleExistBtn = dialog.querySelector('#cmToggleExist');
        if (toggleExistBtn) toggleExistBtn.onclick = (e) => { e.preventDefault(); toggleGroup('exist'); };
        
        const toggleNewBtn = dialog.querySelector('#cmToggleNew');
        if (toggleNewBtn) toggleNewBtn.onclick = (e) => { e.preventDefault(); toggleGroup('new'); };
        
        dialog.querySelector('#cmTagImportCancel').onclick = () => {
            document.body.removeChild(overlay);
            resolve([]);
        };
        
        dialog.querySelector('#cmTagImportOk').onclick = () => {
            const selected = [];
            
            // Collect existing
            const existCbs = dialog.querySelectorAll('.cm-tag-cb[data-type="exist"]:checked');
            existCbs.forEach(cb => {
                const tag = existingTags.find(t => t.id === cb.dataset.val);
                if (tag) selected.push(tag);
            });
            
            // Collect new
            const newCbs = dialog.querySelectorAll('.cm-tag-cb[data-type="new"]:checked');
            newCbs.forEach(cb => {
                selected.push(cb.dataset.val); // string name
            });
            
            document.body.removeChild(overlay);
            resolve(selected);
        };
    });
}