/**
 * AI 响应解析器
 * 解析 AI 返回的 JSON 结果并保存到角色卡
 */
import { saveCharacterData, applyTagsByNames } from '../data.js';
import { sanitizeTags, checkCharHasTags } from '../utils.js';
import { state } from '../state.js';
import { getCmManager } from '../st-tags.js';

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
            console.error('[CharManager] [AI Overview] JSON Parse Error:', e2);
            console.error('[CharManager] [AI Overview] Original text:', text);
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
        
        console.log(`[CharManager] [AI Overview] Tags applied to ${fileName}: +${applyResult.added} -${applyResult.removed} created:${applyResult.created}`);
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
 * @param {boolean} forceGenerateTags - 是否强制生成标签（覆盖已有标签）
 * @returns {Promise<object[]>}
 */
export async function parseBatchOverviewResult(aiResponse, characters, forceGenerateTags = false) {
    const parsed = safeParseJson(aiResponse);
    
    if (!parsed) {
        throw new Error('AI 响应解析失败：无法解析为 JSON');
    }
    
    // 两阶段解析：优先取 results 字段，回退为数组
    let results;
    if (parsed.results && Array.isArray(parsed.results)) {
        results = parsed.results;
    } else if (Array.isArray(parsed)) {
        results = parsed;
    } else {
        throw new Error('AI 响应格式错误：期望 {"results":[...]} 或 [...]');
    }
    
    const outputResults = [];
    const processedFileNames = new Set(); // 记录已处理的角色文件名
    
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
        
        // 记录已处理的角色
        processedFileNames.add(char.fileName || char.avatar);
        
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
        
        // 角色级错误隔离：每个角色的保存操作独立 try-catch
        try {
            // 1. 先保存 summary
            await saveCharacterData(fileName, (data) => {
                const cm = getCmManager({ data });
                cm.summary = item.summary;
            });
            
            // 2. 使用统一入口应用标签，确保 state.tags/state.tagMap 同步更新
            // forceGenerateTags=true 时总是应用标签（replace=true），否则检查是否已有标签
            const shouldApplyTags = forceGenerateTags || !checkCharHasTags(char);
            
            // tags 字段标准化：非数组时置为空数组
            const normalizedTags = (item.tags && Array.isArray(item.tags)) ? item.tags : [];
            
            if (normalizedTags.length > 0 && shouldApplyTags) {
                const sanitizedTags = sanitizeTags(normalizedTags);
                // forceGenerateTags=true 时使用 replace:true 覆盖现有标签，否则使用 replace:false 合并
                const applyResult = await applyTagsByNames(fileName, sanitizedTags, { replace: forceGenerateTags });
                
                console.log(`[CharManager] [AI Batch] ${char.name}: +${applyResult.added} -${applyResult.removed} created:${applyResult.created}`);
                console.log(`[CharManager] [AI Batch] ${char.name} tagMap:`, state.tagMap[fileName]);
            }
            
            outputResults.push({
                fileName: item.fileName,
                charName: char.name,
                success: true,
                summary: item.summary,
                tags: item.tags || []
            });
        } catch (e) {
            console.error(`[CharManager] [AI Batch] Failed for ${char.name}:`, e);
            outputResults.push({
                fileName: item.fileName,
                charName: char.name,
                success: false,
                error: `保存失败：${e.message}`
            });
        }
    }
    
    // 覆盖率校验：检查是否有角色被 AI 遗漏
    for (const char of characters) {
        const charFileName = char.fileName || char.avatar;
        if (!processedFileNames.has(charFileName)) {
            console.warn(`[CharManager] [AI Batch] AI 响应缺失角色: ${char.name} (${charFileName})`);
            outputResults.push({
                fileName: charFileName,
                charName: char.name,
                success: false,
                error: 'AI 响应缺失该角色的处理结果'
            });
        }
    }
    
    return outputResults;
}
