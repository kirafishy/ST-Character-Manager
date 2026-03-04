/**
 * Prompt 构建器
 * 为 AI 概览生成构建结构化提示词
 */

/**
 * 构建单个角色的概览 Prompt
 * @param {object} cardData - 角色卡数据
 * @param {boolean} hasTags - 是否已有标签
 * @param {string[]} systemTags - 系统标签库
 * @returns {string}
 */
export function buildOverviewPrompt(cardData, hasTags, systemTags) {
    const baseData = buildCharacterDataSection(cardData);
    
    if (hasTags) {
        return `你是一位专业的角色卡分析师。请分析以下角色卡数据，生成概览摘要。

${baseData}

[任务要求]
1. 概览：150字以内，精炼概括角色核心特征
2. 该角色已有标签，不需要生成标签

[回复格式] 严格仅返回JSON，不要markdown标记：
{"summary": "..."}`;
    } else {
        return `你是一位专业的角色卡分析师。请分析以下角色卡数据，生成概览和标签。

${baseData}

[任务要求]
1. 概览：150字以内，精炼概括角色核心特征
2. 标签：最多5个，优先从以下[系统标签库]中选择匹配标签，仅当无匹配时才创建新标签

[系统标签库]
${JSON.stringify(systemTags)}

[回复格式] 严格仅返回JSON，不要markdown标记：
{"summary": "...", "tags": ["标签1", "标签2"]}`;
    }
}

/**
 * 构建批量角色的概览 Prompt
 * @param {object[]} cardDataList - 角色卡数据数组
 * @param {string[]} systemTags - 系统标签库
 * @param {boolean} forceGenerateTags - 是否强制生成标签（忽略现有标签）
 * @returns {string}
 */
export function buildBatchOverviewPrompt(cardDataList, systemTags, forceGenerateTags = false) {
    const charactersSection = cardDataList.map((card, index) => {
        return `

--- 角色 ${index + 1} (fileName: "${card.fileName}") ---
${buildCharacterDataSection(card)}`;
    }).join('\n');
    
    const tagRequirement = forceGenerateTags
        ? '2. 为每个角色生成标签：最多5个，优先从[系统标签库]中选择匹配标签，仅当无匹配时才创建新标签'
        : '2. 为每个角色生成标签：最多5个，优先从[系统标签库]中选择匹配标签，仅当无匹配时才创建新标签';
    
    return `你是一位专业的角色卡分析师。请分析以下${cardDataList.length}个角色卡数据，为每个角色生成概览和标签。

[角色卡列表]${charactersSection}

[任务要求]
1. 为每个角色生成概览：150字以内，精炼概括角色核心特征
${tagRequirement}

[系统标签库]
${JSON.stringify(systemTags)}

[回复格式] 严格仅返回JSON数组，不要markdown标记：
[
  {"fileName": "角色1的fileName", "summary": "...", "tags": ["标签1", "标签2"]},
  {"fileName": "角色2的fileName", "summary": "...", "tags": ["标签1"]}
]`;
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
        sections.push(`Description: ${truncateText(cardData.description, 500)}`);
    }
    
    if (cardData.personality) {
        sections.push(`Personality: ${truncateText(cardData.personality, 300)}`);
    }
    
    if (cardData.scenario) {
        sections.push(`Scenario: ${truncateText(cardData.scenario, 300)}`);
    }
    
    if (cardData.first_mes) {
        sections.push(`First Message: ${truncateText(cardData.first_mes, 500)}`);
    }
    
    if (cardData.mes_example) {
        sections.push(`Example Dialogue: ${truncateText(cardData.mes_example, 500)}`);
    }
    
    if (cardData.system_prompt) {
        sections.push(`System Prompt: ${truncateText(cardData.system_prompt, 200)}`);
    }
    
    if (cardData.post_history_instructions) {
        sections.push(`Post Instructions: ${truncateText(cardData.post_history_instructions, 200)}`);
    }
    
    if (cardData.creatorcomment) {
        sections.push(`Creator Comment: ${truncateText(cardData.creatorcomment, 300)}`);
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