/**
 * AI 响应解析器
 * 解析 AI 返回的 JSON 结果并保存到角色卡
 */
import { saveCharacterData, applyTagsByNames } from '../data.js';
import { getCmManager } from '../st-tags.js';
import { sanitizeTags } from '../utils.js';

/**
 * 安全解析 JSON，处理可能存在的格式问题
 * @param {string} text - AI 返回的原始文本
 * @returns {any}
 */
function safeParseJson(text) {
    if (!text) return null;
    
    try {
        return JSON.parse(text);
    } catch (e) {
        try {
            let cleanText = text.trim();
            
            cleanText = cleanText
                .replace(/```json\s*/gi, '')
                .replace(/```\s*$/g, '')
                .trim();
            
            const firstBrace = cleanText.indexOf('{');
            const firstBracket = cleanText.indexOf('[');
            
            if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
                const lastBrace = cleanText.lastIndexOf('}');
                if (lastBrace !== -1 && lastBrace > firstBrace) {
                    cleanText = cleanText.substring(firstBrace, lastBrace + 1);
                }
            } else if (firstBracket !== -1) {
                const lastBracket = cleanText.lastIndexOf(']');
                if (lastBracket !== -1 && lastBracket > firstBracket) {
                    cleanText = cleanText.substring(firstBracket, lastBracket + 1);
                }
            }
            
            return JSON.parse(cleanText);
        } catch (e2) {
            console.error('[AI Overview] JSON Parse Error:', e2);
            console.error('[AI Overview] Original text:', text);
            return null;
        }
    }
}

/**
 * 解析单个角色的 AI 响应并保存
 * @param {string} aiResponse - AI 返回的原始文本
 * @param {object} character - 角色对象
 * @param {boolean} hasTags - 是否已有标签
 * @returns {Promise<{summary: string, tags: string[]}>}
 */
export async function parseOverviewResult(aiResponse, character, hasTags) {
    const result = safeParseJson(aiResponse);
    
    if (!result) {
        throw new Error('AI 响应解析失败：无法解析为 JSON');
    }
    
    if (!result.summary) {
        throw new Error('AI 未返回概览内容');
    }
    
    const tagNamesGenerated = [];
    const fileName = character.fileName || character.avatar;
    
    // 1. 先保存 summary（通过 saveCharacterData）
    await saveCharacterData(fileName, (data) => {
        const cm = getCmManager({ data });
        cm.summary = result.summary;
    });
    
    // 2. 如果需要生成标签，使用统一入口应用标签
    if (!hasTags && result.tags && Array.isArray(result.tags)) {
        const sanitizedTags = sanitizeTags(result.tags);
        
        // 使用统一入口应用标签，确保 state.tags/state.tagMap 同步更新
        const applyResult = await applyTagsByNames(fileName, sanitizedTags, { replace: true });
        tagNamesGenerated.push(...sanitizedTags);
        
        console.log(`[AI Overview] Tags applied to ${fileName}: +${applyResult.added} -${applyResult.removed} created:${applyResult.created}`);
    }
    
    return {
        summary: result.summary,
        tags: result.tags || [],
        tagNamesGenerated
    };
}

/**
 * 解析批量角色的 AI 响应并保存
 * @param {string} aiResponse - AI 返回的原始文本
 * @param {object[]} characters - 角色对象数组
 * @returns {Promise<object[]>}
 */
export async function parseBatchOverviewResult(aiResponse, characters) {
    const results = safeParseJson(aiResponse);
    
    if (!results) {
        throw new Error('AI 响应解析失败：无法解析为 JSON');
    }
    
    if (!Array.isArray(results)) {
        throw new Error('AI 响应格式错误：期望数组');
    }
    
    const outputResults = [];
    
    for (const item of results) {
        const char = characters.find(c => (c.fileName || c.avatar) === item.fileName);
        
        if (!char) {
            outputResults.push({
                fileName: item.fileName,
                charName: '未知',
                success: false,
                error: '未找到对应的角色文件'
            });
            continue;
        }
        
        if (!item.summary) {
            outputResults.push({
                fileName: item.fileName,
                charName: char.name,
                success: false,
                error: 'AI 未返回概览内容'
            });
            continue;
        }
        
        const fileName = char.fileName || char.avatar;
        
        try {
            // 1. 先保存 summary
            await saveCharacterData(fileName, (data) => {
                const cm = getCmManager({ data });
                cm.summary = item.summary;
            });
            
            // 2. 使用统一入口应用标签，确保 state.tags/state.tagMap 同步更新
            if (item.tags && Array.isArray(item.tags)) {
                const sanitizedTags = sanitizeTags(item.tags);
                const applyResult = await applyTagsByNames(fileName, sanitizedTags, { replace: true });
                
                console.log(`[AI Batch] ${char.name}: +${applyResult.added} -${applyResult.removed} created:${applyResult.created}`);
            }
            
            outputResults.push({
                fileName: item.fileName,
                charName: char.name,
                success: true,
                summary: item.summary,
                tags: item.tags || []
            });
        } catch (e) {
            console.error(`[AI Batch] Failed for ${char.name}:`, e);
            outputResults.push({
                fileName: item.fileName,
                charName: char.name,
                success: false,
                error: `保存失败：${e.message}`
            });
        }
    }
    
    return outputResults;
}