/**
 * AI 智能概览服务
 * 复用翻译模块的 OpenAI 配置，为角色卡生成概览和标签
 */
import { state } from '../state.js';
import { authFetch } from '../api.js';
import { buildOverviewPrompt, buildBatchOverviewPrompt } from './prompt-builder.js';
import { parseOverviewResult, parseBatchOverviewResult } from './result-parser.js';
import { saveCharacterData } from '../data.js';
import { checkCharHasTags, getCharacterFileName } from '../utils.js';

/**
 * @typedef {Object} ProgressEvent
 * @property {'batch_start'|'batch_end'|'char_success'|'char_error'} type - 事件类型
 * @property {number} batchIndex - 当前批次索引（从1开始）
 * @property {number} totalBatches - 总批次数
 * @property {number} [charIndex] - 角色在批次中的索引（从1开始）
 * @property {number} [charCount] - 批次内角色总数
 * @property {string} [charName] - 角色名
 * @property {string} [error] - 错误信息
 * @property {number} [successCount] - 批次成功数（batch_end 时）
 * @property {number} [errorCount] - 批次失败数（batch_end 时）
 */


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
    
    const hasTags = !forceGenerateTags && checkCharHasTags(character);
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
 * @param {function} onProgress - 进度回调 (event: ProgressEvent) => void
 * @param {boolean} forceGenerateTags - 是否强制生成标签（覆盖已有标签）
 * @param {function} [shouldCancel] - 取消检查回调，返回 true 时中断执行
 * @returns {Promise<{success: number, errors: number, results: object[], batchInfo: {total: number, failed: number}, cancelled: boolean}>}
 */
export async function generateBatchOverview(characters, tokenLimit, onProgress, forceGenerateTags = false, shouldCancel = null) {
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
    let failedBatches = 0;
    
    const batches = groupCharactersByTokenLimit(characters, tokenLimit);
    const totalBatches = batches.length;
    let cancelled = false;
    
    for (let i = 0; i < batches.length; i++) {
        // 取消检查点：批次开始前
        if (shouldCancel && shouldCancel()) {
            cancelled = true;
            break;
        }
        
        const batch = batches[i];
        const batchIndex = i + 1;
        
        // 批次开始事件
        if (onProgress) {
            onProgress({
                type: 'batch_start',
                batchIndex,
                totalBatches,
                charCount: batch.length
            });
        }
        
        let batchSuccess = 0;
        let batchErrors = 0;
        
        try {
            // 取消检查点：API 调用前
            if (shouldCancel && shouldCancel()) {
                cancelled = true;
                break;
            }
            
            const batchPrompt = buildBatchOverviewPrompt(batch.map(extractCharacterData), state.tags.map(t => t.name), forceGenerateTags);
            const response = await callOpenAI(config, batchPrompt, 4096);
            // 注：解析结果是本地同步操作，通常很快完成，无需取消检查点
            
            const batchResults = await parseBatchOverviewResult(response, batch, forceGenerateTags);
            
            for (let j = 0; j < batchResults.length; j++) {
                const result = batchResults[j];
                if (result.success) {
                    success++;
                    batchSuccess++;
                    if (onProgress) {
                        onProgress({
                            type: 'char_success',
                            batchIndex,
                            totalBatches,
                            charIndex: j + 1,
                            charCount: batch.length,
                            charName: result.charName
                        });
                    }
                } else {
                    errors++;
                    batchErrors++;
                    if (onProgress) {
                        onProgress({
                            type: 'char_error',
                            batchIndex,
                            totalBatches,
                            charIndex: j + 1,
                            charCount: batch.length,
                            charName: result.charName,
                            error: result.error
                        });
                    }
                }
                results.push(result);
            }
        } catch (e) {
            // 批次级失败：整个批次 API 调用失败
            failedBatches++;
            batchErrors = batch.length;
            errors += batch.length;
            
            for (let j = 0; j < batch.length; j++) {
                const char = batch[j];
                if (onProgress) {
                    onProgress({
                        type: 'char_error',
                        batchIndex,
                        totalBatches,
                        charIndex: j + 1,
                        charCount: batch.length,
                        charName: char.name,
                        error: e.message
                    });
                }
                results.push({
                    fileName: getCharacterFileName(char),
                    charName: char.name,
                    success: false,
                    error: e.message
                });
            }
        }
        
        // 批次结束事件
        if (onProgress) {
            onProgress({
                type: 'batch_end',
                batchIndex,
                totalBatches,
                successCount: batchSuccess,
                errorCount: batchErrors
            });
        }
    }
    
    return {
        success,
        errors,
        results,
        batchInfo: {
            total: totalBatches,
            failed: failedBatches
        },
        cancelled
    };
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
        console.log('[CharManager] [AI Overview] Request:', JSON.stringify(body, null, 2));
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
    
    // 输出 Token 使用情况（仅在 debugMode 下）
    if (state.settings.debugMode && json.usage) {
        console.log(`[CharManager] [AI Overview] Token 使用: prompt=${json.usage.prompt_tokens}, completion=${json.usage.completion_tokens}, total=${json.usage.total_tokens}`);
        console.log('[CharManager] [AI Overview] Response:', content);
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
 * 增加安全系数和输出预留空间
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
    
    // 应用安全系数 1.4（防止估算偏低，增加安全边际）
    const safeEstimate = Math.ceil(estimatedTokens * 1.4);
    
    // 为输出预留空间（概览150字 + 标签约100字 ≈ 500 tokens）
    const outputReserve = 500;
    
    // Prompt 模板基础开销
    const promptOverhead = 200;
    
    return Math.max(safeEstimate + outputReserve + promptOverhead, 100);
}
