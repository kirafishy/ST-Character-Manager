/**
 * AI 智能概览服务
 * 复用翻译模块的 OpenAI 配置，为角色卡生成概览和标签
 */
import { state } from '../state.js';
import { authFetch } from '../api.js';
import { buildOverviewPrompt, buildBatchOverviewPrompt } from './prompt-builder.js';
import { parseOverviewResult, parseBatchOverviewResult } from './result-parser.js';
import { getCmManager } from '../st-tags.js';
import { saveCharacterData } from '../data.js';

/**
 * 检查角色是否有标签
 * @param {object} character - 角色对象
 * @returns {boolean}
 */
function checkHasTags(character) {
    const cm = getCmManager(character);
    return cm.tags && cm.tags.length > 0;
}

/**
 * 提取角色卡数据用于 Prompt 构建
 * @param {object} char - 角色对象
 * @returns {object}
 */
export function extractCharacterData(char) {
    const data = char.data || {};
    return {
        fileName: char.fileName || char.avatar,
        name: char.name || (data.name || '未知角色'),
        description: data.description || '',
        personality: data.personality || '',
        scenario: data.scenario || '',
        first_mes: data.first_mes || '',
        mes_example: data.mes_example || '',
        system_prompt: data.system_prompt || (data.extensions && data.extensions.system_prompt) || '',
        post_history_instructions: data.post_history_instructions || (data.extensions && data.extensions.post_history_instructions) || '',
        creatorcomment: data.creator_notes || data.creatorcomment || ''
    };
}

/**
 * 生成单个角色的 AI 概览
 * @param {object} character - 角色对象
 * @param {boolean} forceGenerateTags - 是否强制生成标签（忽略现有标签）
 * @returns {Promise<{summary: string, tags: string[]}>}
 */
export async function generateAIOverview(character, forceGenerateTags = false) {
    const config = getAIConfig();
    
    if (!config.apiKey || !config.apiKey.trim()) {
        throw new Error('未配置 AI API Key，请在设置中配置 OpenAI 渠道');
    }
    
    if (!config.baseUrl || !config.baseUrl.trim()) {
        throw new Error('未配置 AI API Base URL，请在设置中配置 OpenAI 渠道');
    }
    
    const hasTags = !forceGenerateTags && checkHasTags(character);
    const cardData = extractCharacterData(character);
    const systemTags = hasTags ? [] : state.tags.map(t => t.name);
    
    const prompt = buildOverviewPrompt(cardData, hasTags, systemTags);
    const response = await callOpenAI(config, prompt);
    
    return await parseOverviewResult(response, character, hasTags);
}

/**
 * 批量生成角色概览（打包模式）
 * @param {object[]} characters - 角色对象数组
 * @param {number} tokenLimit - Token 上限
 * @param {function} onProgress - 进度回调 (charName, success, error)
 * @param {boolean} forceGenerateTags - 是否强制生成标签（覆盖已有标签）
 * @returns {Promise<{success: number, errors: number, results: object[]}>}
 */
export async function generateBatchOverview(characters, tokenLimit, onProgress, forceGenerateTags = false) {
    const config = getAIConfig();
    
    if (!config.apiKey || !config.apiKey.trim()) {
        throw new Error('未配置 AI API Key，请在设置中配置 OpenAI 渠道');
    }
    
    if (!config.baseUrl || !config.baseUrl.trim()) {
        throw new Error('未配置 AI API Base URL，请在设置中配置 OpenAI 渠道');
    }
    
    const results = [];
    let success = 0;
    let errors = 0;
    
    const batches = groupCharactersByTokenLimit(characters, tokenLimit);
    
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        try {
            const batchPrompt = buildBatchOverviewPrompt(batch.map(extractCharacterData), state.tags.map(t => t.name), forceGenerateTags);
            const response = await callOpenAI(config, batchPrompt, 4096);
            const batchResults = await parseBatchOverviewResult(response, batch, forceGenerateTags);
            
            for (const result of batchResults) {
                if (result.success) {
                    success++;
                    if (onProgress) onProgress(result.charName, true, null);
                } else {
                    errors++;
                    if (onProgress) onProgress(result.charName, false, result.error);
                }
                results.push(result);
            }
        } catch (e) {
            errors += batch.length;
            for (const char of batch) {
                if (onProgress) onProgress(char.name, false, e.message);
                results.push({
                    fileName: char.fileName,
                    charName: char.name,
                    success: false,
                    error: e.message
                });
            }
        }
    }
    
    return { success, errors, results };
}

/**
 * 获取 AI 配置（复用翻译模块）
 * @returns {{baseUrl: string, apiKey: string, model: string}}
 */
export function getAIConfig() {
    return {
        baseUrl: state.settings.openaiBaseUrl || 'https://api.openai.com/v1',
        apiKey: state.settings.openaiApiKey || '',
        model: state.settings.openaiModel || 'gpt-3.5-turbo'
    };
}

/**
 * 调用 OpenAI API
 * @param {object} config - API 配置
 * @param {string} prompt - 用户提示词
 * @param {number} maxTokens - 最大 Token 数
 * @returns {Promise<string>}
 */
async function callOpenAI(config, prompt, maxTokens = 2048) {
    const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions';
    
    const body = {
        model: config.model,
        messages: [
            {
                role: 'system',
                content: '你是一位专业的角色卡分析师。请分析角色设定，返回纯 JSON 格式结果，不要包含 markdown 标记。'
            },
            { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: maxTokens
    };
    
    if (state.settings.debugMode) {
        console.log('[AI Overview] Request:', JSON.stringify(body, null, 2));
    }
    
    const res = await authFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`AI API 请求失败 (${res.status}): ${errorText.slice(0, 200)}`);
    }
    
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content || '';
    
    if (state.settings.debugMode) {
        console.log('[AI Overview] Response:', content);
    }
    
    return content;
}

/**
 * 按 Token 上限对角色进行分组
 * @param {object[]} characters - 角色数组
 * @param {number} tokenLimit - Token 上限
 * @returns {object[][]}
 */
function groupCharactersByTokenLimit(characters, tokenLimit) {
    const batches = [];
    let currentBatch = [];
    let currentTokens = 0;
    
    for (const char of characters) {
        const charTokens = estimateCharTokens(char);
        
        if (currentTokens + charTokens > tokenLimit && currentBatch.length > 0) {
            batches.push(currentBatch);
            currentBatch = [];
            currentTokens = 0;
        }
        
        currentBatch.push(char);
        currentTokens += charTokens;
    }
    
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }
    
    return batches;
}

/**
 * 估算角色卡的 Token 数
 * 使用启发式方法：中文按 1.5 字符/token，英文按 4 字符/token
 * @param {object} char - 角色对象
 * @returns {number} 估算的 token 数
 */
function estimateCharTokens(char) {
    const data = char.data || {};
    const text = [
        data.description || '',
        data.personality || '',
        data.scenario || '',
        data.first_mes || '',
        data.mes_example || ''
    ].join('');
    
    if (!text) return 100; // 空内容给一个基础值
    
    // 统计中文字符数（CJK 范围）
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const nonChineseChars = text.length - chineseChars;
    
    // 中文约 1.5 字符/token，英文约 4 字符/token
    const estimatedTokens = Math.ceil(chineseChars / 1.5 + nonChineseChars / 4);
    
    // 加上 prompt 模板的基础开销（约 200 token）
    return Math.max(estimatedTokens + 200, 100);
}