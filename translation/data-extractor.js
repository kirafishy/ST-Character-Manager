/**
 * 从角色卡数据中提取可翻译的字段
 * @param {object} charData - 角色卡原始 JSON 数据 (V2 spec)
 * @returns {object} 分组后的翻译数据
 */
export function extractTranslatableData(charData) {
    const data = charData.data || charData; // 兼容 V2/V3 结构
    const result = {
        basic: {},
        system: {},
        greetings: {}, // Alternate Greetings
        tags: {},
        lorebook: {}
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
        if (data[field] && typeof data[field] === 'string' && data[field].trim()) {
            result.system[field] = data[field];
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

    // 4. Tags (Array of strings)
    if (Array.isArray(data.tags)) {
        data.tags.forEach((tag, index) => {
            if (typeof tag === 'string' && tag.trim()) {
                result.tags[`tag_${index}`] = tag;
            }
        });
    }

    // 5. 世界书 (Lorebook / Character Book)
    // 可能是对象 (embedded) 或文件名 (external，暂不处理外部文件，除非已加载)
    // 这里假设我们处理的是内嵌的世界书数据
    let book = data.character_book;
    if (book && typeof book === 'object' && Array.isArray(book.entries)) {
        book.entries.forEach((entry, index) => {
            // 提取 Key, Content, Comment, Selective (Name 暂时不翻，或者看情况)
            // 实际上 Key 通常不翻译，因为是触发词。但如果用户想翻也可以。
            // 这里我们只翻译 Content 和 Comment (备注)，以及显示名(Name) 如果有的话。
            // 触发词 Keys 一般保留原文以免失效，除非是中文触发。
            
            // 为了区分，使用 `entry_{id}_{field}`
            const uid = entry.id || index;
            
            if (entry.content && entry.content.trim()) {
                result.lorebook[`entry_${uid}_content`] = entry.content;
            }
            if (entry.comment && entry.comment.trim()) {
                result.lorebook[`entry_${uid}_comment`] = entry.comment;
            }
            // 很多时候 entry 还有 keys (secondary_keys), name (memo)
            // 如果用户需要翻译 keys，风险较大。这里保守起见，暂不自动提取 keys。
        });
    }

    return result;
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

    // 3. Tags
    if (translatedData.tags && Array.isArray(target.tags)) {
        Object.keys(translatedData.tags).forEach(key => {
            const index = parseInt(key.split('_')[1]);
            if (!isNaN(index) && target.tags[index] !== undefined) {
                target.tags[index] = translatedData.tags[key];
            }
        });
    }

    // 4. 世界书
    if (translatedData.lorebook && target.character_book && Array.isArray(target.character_book.entries)) {
        Object.keys(translatedData.lorebook).forEach(key => {
            // key 格式: entry_{uid}_{field}
            // field: content | comment
            const parts = key.split('_');
            const field = parts.pop(); // content or comment
            const uidStr = parts.slice(1).join('_'); // uid might contain underscores? actually we used entry.id or index
            
            // 我们需要找到对应的 entry
            // 如果 uid 是数字索引
            let entry = null;
            
            // 尝试通过 ID 查找
            const foundById = target.character_book.entries.find(e => e.id == uidStr);
            if (foundById) {
                entry = foundById;
            } else {
                // 尝试作为索引
                const idx = parseInt(uidStr);
                if (!isNaN(idx) && target.character_book.entries[idx]) {
                    // 只有当 ID 不存在时才认为是索引
                    // 但 extract 时优先用了 id。
                    // 如果 extract 时用了 index，那这里 uidStr 就是 index
                    entry = target.character_book.entries[idx];
                }
            }

            if (entry) {
                entry[field] = translatedData.lorebook[key];
            }
        });
    }

    return newData;
}