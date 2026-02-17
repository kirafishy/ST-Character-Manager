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

    // 4. Tags — 合并为一条统一翻译（用逗号分隔）
    if (Array.isArray(data.tags)) {
        const validTags = data.tags.filter(tag => typeof tag === 'string' && tag.trim());
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
            if (entry.comment && entry.comment.trim()) {
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
 * @returns {object} 更新后的角色卡数据
 */
export function applyTranslation(charData, translatedData) {
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

    // 3. Tags — 从合并字符串拆分回数组
    if (translatedData.tags && Array.isArray(target.tags)) {
        if (translatedData.tags['tags_all'] !== undefined) {
            // 新格式：合并的逗号分隔字符串
            const translatedTags = translatedData.tags['tags_all']
                .split(/[,，]/)
                .map(t => t.trim())
                .filter(t => t.length > 0);
            // 按原始标签数量对齐
            for (let i = 0; i < target.tags.length && i < translatedTags.length; i++) {
                target.tags[i] = translatedTags[i];
            }
        } else {
            // 兼容旧格式 tag_0, tag_1...
            Object.keys(translatedData.tags).forEach(key => {
                const index = parseInt(key.split('_')[1]);
                if (!isNaN(index) && target.tags[index] !== undefined) {
                    target.tags[index] = translatedData.tags[key];
                }
            });
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