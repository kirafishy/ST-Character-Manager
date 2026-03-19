/**
 * Prompt 构建器
 * 为 AI 概览生成构建结构化提示词
 */
import { state } from '../state.js';

/**
 * 构建单个角色的概览 Prompt
 * @param {object} cardData - 角色卡数据
 * @param {boolean} hasTags - 是否已有标签
 * @param {string[]} systemTags - 系统标签库
 * @param {string} generateMode - 生成模式：'both' | 'summary' | 'tags'
 * @returns {string}
 */
export function buildOverviewPrompt(cardData, hasTags, systemTags, generateMode = 'both') {
    const baseData = buildCharacterDataSection(cardData);
    const maxTags = state.settings.aiMaxTags || 5;

    // 仅生成概览模式
    if (generateMode === 'summary') {
        return `你是一位专业的角色卡分析师。请分析以下角色卡数据，生成概览摘要。

${baseData}

[任务要求]
1. 概览：300字以内，精炼概括角色核心特征
2. 不需要生成标签，tags 字段返回空数组

[回复格式] 直接返回纯JSON，禁止使用markdown代码块包裹（禁止使用\`\`\`json或\`\`\`），直接输出原始JSON：
{"summary": "...", "tags": []}`;
    }

    // 仅生成标签模式
    if (generateMode === 'tags') {
        if (hasTags) {
            return `你是一位专业的角色卡分析师。请分析以下角色卡数据，但在当前设置下不需要生成新标签。

${baseData}

[任务要求]
1. 不需要生成概览，summary 字段返回空字符串
2. 该角色已有标签，不需要生成标签，tags 字段返回空数组

[回复格式] 直接返回纯JSON，禁止使用markdown代码块包裹（禁止使用\`\`\`json或\`\`\`），直接输出原始JSON：
{"summary": "", "tags": []}`;
        }
        return `你是一位专业的角色卡分析师。请分析以下角色卡数据，生成标签。

${baseData}

[任务要求]
1. 不需要生成概览，summary 字段返回空字符串
2. 标签：最多${maxTags}个，仅从以下[系统标签库]中选择匹配标签

[标签生成顺序]
1. 先判定分级标签：仅在证据充分时输出（如内容分级 SFW/NSFW）
2. 再筛选特征标签：仅从[系统标签库]中选择匹配标签
3. 最后做去重与裁剪：同一语义簇最多保留 1 个标签，按置信度排序后裁剪到上限

[硬性约束]
- 禁止创造新标签，只能从[系统标签库]中选择
- 不确定就不打标签，宁缺毋滥
- 标签数组可以为空或少于上限
- 若存在冲突候选（语义相近），保留区分度更高者
- 分级标签最多 1 个，仅当证据充分时输出

[系统标签库]
${JSON.stringify(systemTags)}

[回复格式] 直接返回纯JSON，禁止使用markdown代码块包裹（禁止使用\`\`\`json或\`\`\`），直接输出原始JSON：
{"summary": "", "tags": ["标签1", "标签2"]}`;
    }

    // 默认：both 模式 (概览 + 标签)
    if (hasTags) {
        return `你是一位专业的角色卡分析师。请分析以下角色卡数据，生成概览摘要。

${baseData}

[任务要求]
1. 概览：300字以内，精炼概括角色核心特征
2. 该角色已有标签，不需要生成标签

[回复格式] 直接返回纯JSON，禁止使用markdown代码块包裹（禁止使用\`\`\`json或\`\`\`），直接输出原始JSON：
{"summary": "...", "tags": ["标签1", "标签2"]}`;
    } else {
        return `你是一位专业的角色卡分析师。请分析以下角色卡数据，生成概览和标签。

${baseData}

[任务要求]
1. 概览：300字以内，精炼概括角色核心特征
2. 标签：最多${maxTags}个，仅从以下[系统标签库]中选择匹配标签

[标签生成顺序]
1. 先判定分级标签：仅在证据充分时输出（如内容分级 SFW/NSFW）
2. 再筛选特征标签：仅从[系统标签库]中选择匹配标签
3. 最后做去重与裁剪：同一语义簇最多保留 1 个标签，按置信度排序后裁剪到上限

[硬性约束]
- 禁止创造新标签，只能从[系统标签库]中选择
- 不确定就不打标签，宁缺毋滥
- 标签数组可以为空或少于上限
- 若存在冲突候选（语义相近），保留区分度更高者
- 分级标签最多 1 个，仅当证据充分时输出

[系统标签库]
${JSON.stringify(systemTags)}

[回复格式] 直接返回纯JSON，禁止使用markdown代码块包裹（禁止使用\`\`\`json或\`\`\`），直接输出原始JSON：
{"summary": "...", "tags": ["标签1", "标签2"]}`;
    }
}

/**
 * 构建批量角色的概览 Prompt
 * @param {object[]} cardDataList - 角色卡数据数组
 * @param {string[]} systemTags - 系统标签库
 * @param {boolean} forceGenerateTags - 是否强制生成标签（忽略现有标签）
 * @param {string} generateMode - 生成模式：'both' | 'summary' | 'tags'
 * @returns {string}
 */
export function buildBatchOverviewPrompt(cardDataList, systemTags, forceGenerateTags = false, generateMode = 'both') {
    const charactersSection = cardDataList.map((card, index) => {
        return `

--- 角色 ${index + 1} (fileName: "${card.fileName}") ---
${buildCharacterDataSection(card)}`;
    }).join('\n');
    
    const maxTags = state.settings.aiMaxTags || 5;

    // 根据 generateMode 构建任务要求
    let taskRequirements;
    if (generateMode === 'summary') {
        taskRequirements = `[任务要求]
1. 为每个角色卡生成概览：300字以内，精炼概括角色卡核心特征
2. 不需要生成标签，tags 字段返回空数组`;
    } else if (generateMode === 'tags') {
        taskRequirements = `[任务要求]
1. 不需要生成概览，summary 字段返回空字符串
2. 为每个角色卡生成标签：最多${maxTags}个，仅从[系统标签库]中选择匹配标签

[标签生成顺序]
1. 先判定分级标签：仅在证据充分时输出（如内容分级 SFW/NSFW）
2. 再筛选特征标签：仅从[系统标签库]中选择匹配标签
3. 最后做去重与裁剪：同一语义簇最多保留 1 个标签，按置信度排序后裁剪到上限

[硬性约束]
- 禁止创造新标签，只能从[系统标签库]中选择
- 不确定就不打标签，宁缺毋滥
- 标签数组可以为空或少于上限
- 若存在冲突候选（语义相近），保留区分度更高者
- 分级标签最多 1 个，仅当证据充分时输出`;
    } else {
        // both 模式
        taskRequirements = `[任务要求]
1. 为每个角色卡生成概览：300字以内，精炼概括角色卡核心特征
2. 为每个角色卡生成标签：最多${maxTags}个，仅从[系统标签库]中选择匹配标签

[标签生成顺序]
1. 先判定分级标签：仅在证据充分时输出（如内容分级 SFW/NSFW）
2. 再筛选特征标签：仅从[系统标签库]中选择匹配标签
3. 最后做去重与裁剪：同一语义簇最多保留 1 个标签，按置信度排序后裁剪到上限

[硬性约束]
- 禁止创造新标签，只能从[系统标签库]中选择
- 不确定就不打标签，宁缺毋滥
- 标签数组可以为空或少于上限
- 若存在冲突候选（语义相近），保留区分度更高者
- 分级标签最多 1 个，仅当证据充分时输出`;
    }

    // 仅在需要生成标签时包含系统标签库
    const tagsSection = generateMode !== 'summary' ? `

[系统标签库]
${JSON.stringify(systemTags)}` : '';
    
    return `你是一位专业的角色卡分析师。请分析以下${cardDataList.length}个角色卡数据，为每个角色生成${generateMode === 'summary' ? '概览' : generateMode === 'tags' ? '标签' : '概览和标签'}。

[角色卡列表]${charactersSection}

${taskRequirements}${tagsSection}

[回复格式] 直接返回纯JSON，禁止使用markdown代码块包裹（禁止使用\`\`\`json或\`\`\`），直接输出原始JSON。主格式为 {"results":[...]}，若无法返回包裹格式则纯数组 [...] 也可接受：
{
  "results": [
    {"fileName": "角色1的fileName", "summary": "...", "tags": ["标签1", "标签2"]},
    {"fileName": "角色2的fileName", "summary": "...", "tags": ["标签1"]}
  ]
}
或回退格式：
[
  {"fileName": "角色1的fileName", "summary": "...", "tags": ["标签1", "标签2"]},
  {"fileName": "角色2的fileName", "summary": "...", "tags": ["标签1"]}
]

[字段约束] 必须使用以下键名：
- fileName: 角色文件名（用于匹配）
- summary: 概览内容（必填）
- tags: 标签数组（可选，可为空）`;
}

/**
 * 构建角色数据部分
 * @param {object} cardData - 角色卡数据
 * @returns {string}
 */
function buildCharacterDataSection(cardData) {
    const sections = [];
    
    sections.push(`[角色数据]`);
    sections.push(`Name: ${cardData.name || '未知'}`);
    
    if (cardData.description) {
        sections.push(`Description: ${truncateText(cardData.description, 1500)}`);
    }
    
    if (cardData.personality) {
        sections.push(`Personality: ${truncateText(cardData.personality, 900)}`);
    }
    
    if (cardData.scenario) {
        sections.push(`Scenario: ${truncateText(cardData.scenario, 900)}`);
    }
    
    if (cardData.first_mes) {
        sections.push(`First Message: ${truncateText(cardData.first_mes, 1500)}`);
    }
    
    if (cardData.mes_example) {
        sections.push(`Example Dialogue: ${truncateText(cardData.mes_example, 1500)}`);
    }
    
    if (cardData.system_prompt) {
        sections.push(`System Prompt: ${truncateText(cardData.system_prompt, 600)}`);
    }
    
    if (cardData.post_history_instructions) {
        sections.push(`Post Instructions: ${truncateText(cardData.post_history_instructions, 600)}`);
    }
    
    if (cardData.creatorcomment) {
        sections.push(`Creator Comment: ${truncateText(cardData.creatorcomment, 900)}`);
    }
    
    if (cardData.note) {
        sections.push(`User Note: ${truncateText(cardData.note, 900)}`);
    }

    // 备用开场白（根据设置决定是否包含）
    if (cardData.alternate_greetings && cardData.alternate_greetings.length > 0) {
        const altTexts = cardData.alternate_greetings.map((g, i) =>
            `Alt Greeting #${i + 1}: ${truncateText(g, 500)}`
        ).join('\n');
        sections.push(altTexts);
    }

    // 角色世界书（根据设置决定是否包含）
    if (cardData.character_book_entries && cardData.character_book_entries.length > 0) {
        const bookTexts = cardData.character_book_entries.map(entry => {
            const keys = (entry.keys || []).join(', ');
            const content = truncateText(entry.content || '', 300);
            return `WI Entry [${keys}]: ${content}`;
        }).join('\n');
        sections.push(`[Character World Info]\n${bookTexts}`);
    }
    
    return sections.join('\n');
}

/**
 * 截断文本（正确处理 emoji 和多字节字符）
 * @param {string} text - 原始文本
 * @param {number} maxLength - 最大字符数（按 Unicode 码点计算）
 * @returns {string}
 */
function truncateText(text, maxLength) {
    if (!text) return '';
    
    // 使用 Array.from 正确处理 emoji 和多字节字符
    const chars = Array.from(text);
    if (chars.length <= maxLength) return text;
    
    return chars.slice(0, maxLength).join('') + '...';
}