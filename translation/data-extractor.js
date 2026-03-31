/**
 * 从角色卡数据中提取可翻译的字段
 * @param {object} charData - 角色卡原始 JSON 数据 (V2 spec)
 * @returns {object} 分组后的翻译数据
 */
export function extractTranslatableData(charData) {
    // 混合根对象和 data 对象，确保能读取到所有字段 (兼容各种非标准结构)
    const data = { ...charData, ...(charData.data || {}) };
    const result = {
        basic: {},
        system: {},
        greetings: {}, // Alternate Greetings
        tags: {},
        lorebook: {},
        regex: {},      // 正则脚本可翻译文本
        scripts: {}     // 酒馆助手脚本可翻译文本
    };

    // 1. 基础信息
    const basicFields = [
        'name',
        'description',
        'personality',
        'scenario',
        'first_mes',
        'mes_example',
        'creator_notes'
    ];

    basicFields.forEach(field => {
        if (data[field] && typeof data[field] === 'string' && data[field].trim()) {
            result.basic[field] = data[field];
        }
    });

    // 2. 系统设定
    const systemFields = [
        'system_prompt',
        'post_history_instructions'
    ];

    systemFields.forEach(field => {
        let val = data[field];
        // Fallback to extensions if not found in root (for some V1/V2 variants)
        if (!val && data.extensions && data.extensions[field]) {
            val = data.extensions[field];
        }

        if (val && typeof val === 'string' && val.trim()) {
            result.system[field] = val;
        }
    });

    // 3. 候补开场白 (Array of strings)
    if (Array.isArray(data.alternate_greetings)) {
        data.alternate_greetings.forEach((greeting, index) => {
            if (typeof greeting === 'string' && greeting.trim()) {
                result.greetings[`greeting_${index}`] = greeting;
            }
        });
    }

    // 4. Tags — 优先读取 extensions.cm_manager.tags，为空则读取 data.tags
    // extensions.cm_manager.tags 是插件管理的标签，data.tags 是角色卡原生标签
    let tagsSource = null;

    // 优先检查 extensions.cm_manager.tags
    const cmManager = data.extensions?.cm_manager;
    if (cmManager && Array.isArray(cmManager.tags)) {
        tagsSource = cmManager.tags;
    }
    // 降级到 data.tags
    else if (Array.isArray(data.tags)) {
        tagsSource = data.tags;
    }

    if (tagsSource && tagsSource.length > 0) {
        const validTags = tagsSource.filter(tag => typeof tag === 'string' && tag.trim());
        if (validTags.length > 0) {
            result.tags['tags_all'] = validTags.join(', ');
        }
    }

    // 5. 世界书 (Lorebook / Character Book)
    // 可能是对象 (embedded) 或文件名 (external，暂不处理外部文件，除非已加载)
    // 这里假设我们处理的是内嵌的世界书数据
    let book = data.character_book;
    if (book && typeof book === 'object' && Array.isArray(book.entries)) {
        book.entries.forEach((entry, index) => {
            const uid = entry.id || index;
            
            // 世界书条目标题/备忘名
            if (entry.name && entry.name.trim()) {
                result.lorebook[`entry_${uid}_name`] = entry.name;
            }
            
            // 触发词 (keys) — 合并为逗号分隔字符串供翻译
            if (entry.keys && Array.isArray(entry.keys)) {
                const validKeys = entry.keys.filter(k => typeof k === 'string' && k.trim());
                if (validKeys.length > 0) {
                    result.lorebook[`entry_${uid}_keys`] = validKeys.join(', ');
                }
            }
            
            // 世界书条目内容
            if (entry.content && entry.content.trim()) {
                result.lorebook[`entry_${uid}_content`] = entry.content;
            }
            
            // 世界书条目备注
            if (entry.comment && typeof entry.comment === 'string' && entry.comment.trim()) {
                result.lorebook[`entry_${uid}_comment`] = entry.comment;
            }
        });
    }

    // 6. 正则脚本 (extensions.regex_scripts)
    const ext = data.extensions || {};
    if (Array.isArray(ext.regex_scripts)) {
        ext.regex_scripts.forEach((script, index) => {
            const uid = script.id || index;
            
            // 脚本名称 — 可翻译
            if (script.scriptName && script.scriptName.trim()) {
                result.regex[`regex_${uid}_scriptName`] = script.scriptName;
            }
            
            // 替换字符串 — 提取其中的自然语言文本
            // replaceString 中可能包含 HTML/CSS/JS 混合内容
            // 我们提取整个 replaceString 供翻译，但翻译时需要 AI 仅翻译文本部分
            if (script.replaceString && script.replaceString.trim()) {
                // 检查是否包含自然语言文本（而不是纯代码/空替换）
                const hasText = hasNaturalLanguageText(script.replaceString);
                if (hasText) {
                    result.regex[`regex_${uid}_replaceString`] = script.replaceString;
                }
            }
        });
    }

    // 7. 酒馆助手脚本 (extensions.tavern_helper.scripts)
    const tavernHelper = ext.tavern_helper;
    if (tavernHelper && typeof tavernHelper === 'object' && Array.isArray(tavernHelper.scripts)) {
        tavernHelper.scripts.forEach((script, index) => {
            const uid = script.id || index;
            
            // 脚本名称 — 可翻译
            if (script.name && script.name.trim()) {
                result.scripts[`script_${uid}_name`] = script.name;
            }
            
            // 脚本内容 — 整体提取，翻译时需要 AI 识别可翻译部分
            // content 中包含 JS 代码、.describe() 描述、.prefault() 默认值、HTML 文本等
            if (script.content && script.content.trim()) {
                const hasText = hasNaturalLanguageText(script.content);
                if (hasText) {
                    result.scripts[`script_${uid}_content`] = script.content;
                }
            }
            
            // 脚本信息说明 — 可翻译
            if (script.info && script.info.trim()) {
                result.scripts[`script_${uid}_info`] = script.info;
            }
            
            // 按钮名称 — 可翻译
            if (script.button && script.button.enabled && Array.isArray(script.button.buttons)) {
                script.button.buttons.forEach((btn, btnIdx) => {
                    if (btn.name && btn.name.trim()) {
                        result.scripts[`script_${uid}_btn_${btnIdx}_name`] = btn.name;
                    }
                });
            }
        });
    }

    return result;
}

/**
 * 检查文本是否包含自然语言内容（而非纯代码/正则/空白）
 * @param {string} text - 待检查文本
 * @returns {boolean} 是否包含可翻译的自然语言
 */
function hasNaturalLanguageText(text) {
    if (!text || !text.trim()) return false;
    
    // 去除 HTML 标签、CSS 样式块、JS 代码块后检查是否还有文本
    let stripped = text;
    
    // 去除 <style>...</style> 块
    stripped = stripped.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // 去除 <script>...</script> 块（但保留 script 标签内的字符串）
    // 注意：不能简单去除 script，因为酒馆助手的 content 本身就是脚本
    // 这里只检查是否有中文/日文/韩文字符，或者连续的英文单词
    
    // 检查是否包含 CJK 字符
    if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(stripped)) {
        return true;
    }
    
    // 检查是否包含连续英文单词（至少两个单词相连，排除纯代码标识符）
    // 匹配类似 "Variable Update", "Click to view" 等自然语言
    if (/[A-Z][a-z]+\s+[a-z]+/i.test(stripped)) {
        return true;
    }
    
    // 检查 .describe('...') 中的内容
    if (/\.describe\s*\(\s*['"`]/.test(stripped)) {
        return true;
    }
    
    // 检查 data-open/data-close 等属性中的文本
    if (/data-(?:open|close|title|label|text)\s*=\s*["']/.test(stripped)) {
        return true;
    }
    
    return false;
}

/**
 * 将翻译后的数据应用回角色卡结构
 * @param {object} charData - 原始角色卡数据
 * @param {object} translatedData - 翻译后的数据 (扁平化或分层结构)
 * @param {object} [options] - 可选配置
 * @param {boolean} [options.syncToDataTags=true] - 是否同步标签到 data.tags 字段
 * @returns {object} 更新后的角色卡数据
 */
export function applyTranslation(charData, translatedData, options = {}) {
    const { syncToDataTags = true } = options;
    
    // 深拷贝以避免副作用
    const newData = JSON.parse(JSON.stringify(charData));
    const target = newData.data || newData;

    // Helper: 尝试从 translatedData 中查找
    // translatedData 可能是 { basic: {...}, system: {...} } 或者是扁平化的 (取决于 UI 如何传回)
    // 这里假设传回的是与 extractTranslatableData 结构一致的分组对象
    
    // 1. 基础信息 & 系统设定
    ['basic', 'system'].forEach(group => {
        if (translatedData[group]) {
            Object.keys(translatedData[group]).forEach(key => {
                if (translatedData[group][key] !== undefined) {
                    target[key] = translatedData[group][key];
                }
            });
        }
    });

    // 2. 候补开场白
    if (translatedData.greetings && Array.isArray(target.alternate_greetings)) {
        Object.keys(translatedData.greetings).forEach(key => {
            // key 格式: greeting_0, greeting_1...
            const index = parseInt(key.split('_')[1]);
            if (!isNaN(index) && target.alternate_greetings[index] !== undefined) {
                target.alternate_greetings[index] = translatedData.greetings[key];
            }
        });
    }

    // 3. Tags — 根据同步设置决定写入位置
    // 始终写入 extensions.cm_manager.tags，根据 syncToDataTags 决定是否写入 data.tags
    if (translatedData.tags) {
        let translatedTags = null;
        
        if (translatedData.tags['tags_all'] !== undefined) {
            // 新格式：合并的逗号分隔字符串
            translatedTags = translatedData.tags['tags_all']
                .split(/[,，]/)
                .map(t => t.trim())
                .filter(t => t.length > 0);
        } else {
            // 兼容旧格式 tag_0, tag_1...
            translatedTags = [];
            Object.keys(translatedData.tags).forEach(key => {
                const index = parseInt(key.split('_')[1]);
                if (!isNaN(index)) {
                    translatedTags[index] = translatedData.tags[key];
                }
            });
            translatedTags = translatedTags.filter(t => t);
        }
        
        if (translatedTags && translatedTags.length > 0) {
            // 始终写入 extensions.cm_manager.tags
            if (!target.extensions) target.extensions = {};
            if (!target.extensions.cm_manager) target.extensions.cm_manager = {};
            target.extensions.cm_manager.tags = translatedTags;
            
            // 根据同步设置决定是否写入 data.tags
            if (syncToDataTags) {
                target.tags = [...translatedTags];
            }
        }
    }

    // 4. 世界书
    if (translatedData.lorebook && target.character_book && Array.isArray(target.character_book.entries)) {
        Object.keys(translatedData.lorebook).forEach(key => {
            // key 格式: entry_{uid}_{field}
            // field: name | keys | content | comment
            const parts = key.split('_');
            const field = parts.pop(); // name, keys, content or comment
            const uidStr = parts.slice(1).join('_');
            
            let entry = null;
            
            // 尝试通过 ID 查找
            const foundById = target.character_book.entries.find(e => e.id == uidStr);
            if (foundById) {
                entry = foundById;
            } else {
                const idx = parseInt(uidStr);
                if (!isNaN(idx) && target.character_book.entries[idx]) {
                    entry = target.character_book.entries[idx];
                }
            }

            if (entry) {
                if (field === 'keys') {
                    // keys 从逗号分隔字符串拆回数组
                    entry.keys = translatedData.lorebook[key]
                        .split(/[,，]/)
                        .map(k => k.trim())
                        .filter(k => k.length > 0);
                } else {
                    entry[field] = translatedData.lorebook[key];
                }
            }
        });
    }

    // 5. 正则脚本
    if (translatedData.regex) {
        const ext = target.extensions || (target.extensions = {});
        if (Array.isArray(ext.regex_scripts)) {
            Object.keys(translatedData.regex).forEach(key => {
                // key 格式: regex_{uid}_{field}
                // field: scriptName | replaceString
                const match = key.match(/^regex_(.+)_(scriptName|replaceString)$/);
                if (!match) return;
                
                const uidStr = match[1];
                const field = match[2];
                
                // 查找对应的正则脚本
                let script = ext.regex_scripts.find(s => s.id === uidStr);
                if (!script) {
                    const idx = parseInt(uidStr);
                    if (!isNaN(idx) && ext.regex_scripts[idx]) {
                        script = ext.regex_scripts[idx];
                    }
                }
                
                if (script && translatedData.regex[key] !== undefined) {
                    script[field] = translatedData.regex[key];
                }
            });
        }
    }

    // 6. 酒馆助手脚本
    if (translatedData.scripts) {
        const ext = target.extensions || (target.extensions = {});
        const tavernHelper = ext.tavern_helper;
        if (tavernHelper && Array.isArray(tavernHelper.scripts)) {
            Object.keys(translatedData.scripts).forEach(key => {
                // 按钮名称: script_{uid}_btn_{btnIdx}_name
                const btnMatch = key.match(/^script_(.+)_btn_(\d+)_name$/);
                if (btnMatch) {
                    const uidStr = btnMatch[1];
                    const btnIdx = parseInt(btnMatch[2]);
                    
                    let script = tavernHelper.scripts.find(s => s.id === uidStr);
                    if (!script) {
                        const idx = parseInt(uidStr);
                        if (!isNaN(idx) && tavernHelper.scripts[idx]) {
                            script = tavernHelper.scripts[idx];
                        }
                    }
                    
                    if (script && script.button && Array.isArray(script.button.buttons) && script.button.buttons[btnIdx]) {
                        script.button.buttons[btnIdx].name = translatedData.scripts[key];
                    }
                    return;
                }
                
                // 脚本字段: script_{uid}_{field}
                const fieldMatch = key.match(/^script_(.+)_(name|content|info)$/);
                if (!fieldMatch) return;
                
                const uidStr = fieldMatch[1];
                const field = fieldMatch[2];
                
                let script = tavernHelper.scripts.find(s => s.id === uidStr);
                if (!script) {
                    const idx = parseInt(uidStr);
                    if (!isNaN(idx) && tavernHelper.scripts[idx]) {
                        script = tavernHelper.scripts[idx];
                    }
                }
                
                if (script && translatedData.scripts[key] !== undefined) {
                    script[field] = translatedData.scripts[key];
                }
            });
        }
    }

    return newData;
}

/**
 * 导出专用双写同步函数
 * 将核心字段同时写入根层与 data 层，确保导出后回导的一致性
 * 仅对导出对象操作，不影响 UI 内部状态
 *
 * @param {object} exportObj - 待同步的导出对象（已翻译并规范化）
 * @returns {object} 同步后的导出对象（原地修改并返回）
 */
export function syncExportMirrorFields(exportObj) {
    if (!exportObj || typeof exportObj !== 'object') return exportObj;

    // 确保 data 层存在
    if (!exportObj.data || typeof exportObj.data !== 'object') {
        exportObj.data = {};
    }

    const root = exportObj;
    const data = exportObj.data;

    // 1. 核心双写字段：根层与 data 层保持一致
    const mirrorFields = [
        'name',
        'description',
        'personality',
        'scenario',
        'first_mes',
        'mes_example'
    ];

    mirrorFields.forEach(field => {
        // 优先取 data 层（翻译结果主要落在 data 层）
        const dataVal = data[field];
        const rootVal = root[field];

        if (dataVal !== undefined) {
            // data 层有值，同步到根层
            root[field] = dataVal;
        } else if (rootVal !== undefined) {
            // data 层为空，用根层值补齐 data 层
            data[field] = rootVal;
        }
    });

    // 2. tags 同步：根层 tags 与 data.tags 保持一致
    // 优先取 data.tags（翻译后的标签），其次取根层 tags
    const dataTags = data.tags;
    const rootTags = root.tags;

    if (Array.isArray(dataTags)) {
        root.tags = [...dataTags];
    } else if (Array.isArray(rootTags)) {
        data.tags = [...rootTags];
    }

    // 3. alternate_greetings 保持数组结构，不做错误字符串化
    if (Array.isArray(data.alternate_greetings)) {
        root.alternate_greetings = [...data.alternate_greetings];
    } else if (Array.isArray(root.alternate_greetings)) {
        data.alternate_greetings = [...root.alternate_greetings];
    }

    // 4. character_book 保持对象结构
    if (data.character_book && typeof data.character_book === 'object') {
        root.character_book = JSON.parse(JSON.stringify(data.character_book));
    } else if (root.character_book && typeof root.character_book === 'object') {
        data.character_book = JSON.parse(JSON.stringify(root.character_book));
    }

    // 5. 兼容字段保守补齐
    // creator_notes -> creatorcomment 兼容位
    if (data.creator_notes && typeof data.creator_notes === 'string') {
        if (!root.creatorcomment || !root.creatorcomment.trim()) {
            root.creatorcomment = data.creator_notes;
        }
    } else if (root.creatorcomment && typeof root.creatorcomment === 'string') {
        if (!data.creator_notes || !data.creator_notes.trim()) {
            data.creator_notes = root.creatorcomment;
        }
    }

    // system_prompt 兼容补齐
    if (data.system_prompt !== undefined) {
        if (root.system_prompt === undefined) {
            root.system_prompt = data.system_prompt;
        }
    } else if (root.system_prompt !== undefined) {
        data.system_prompt = root.system_prompt;
    }

    // post_history_instructions 兼容补齐
    if (data.post_history_instructions !== undefined) {
        if (root.post_history_instructions === undefined) {
            root.post_history_instructions = data.post_history_instructions;
        }
    } else if (root.post_history_instructions !== undefined) {
        data.post_history_instructions = root.post_history_instructions;
    }

    return exportObj;
}