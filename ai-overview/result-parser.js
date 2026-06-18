/**
 * AI 响应解析器
 * 解析 AI 返回的 JSON 结果并保存到角色卡
 */
import { saveCharacterData, applyAIOverviewToCard, applyTagsByNames, getCharTags, createTag, saveTags } from '../data.js';
import { sanitizeTags, checkCharHasTags, getCharacterFileName } from '../utils.js';
import { state } from '../state.js';
import { getCmManager } from '../st-tags.js';
import { parseStreamingOverviewChunk, StreamingParserState } from '../utils/streaming-parser.js';

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
 * @param {string} generateMode - 生成模式：'both' | 'summary' | 'tags'
 * @param {boolean} forceGenerateTags - 是否强制生成标签（覆盖已有标签）
 * @param {boolean} forceGenerateSummary - 是否强制生成概览（覆盖已有概览）
 * @returns {Promise<{summary: string, tags: string[]}>}
 */
export async function parseOverviewResult(aiResponse, character, hasTags, generateMode = 'both', forceGenerateTags = false, forceGenerateSummary = false) {
    const result = safeParseJson(aiResponse);
    
    if (!result) {
        throw new Error('AI 响应解析失败：无法解析为 JSON');
    }
    
    // tags 模式不要求 summary 非空
    if (generateMode !== 'tags' && !result.summary) {
        throw new Error('AI 未返回概览内容');
    }
    
    const fileName = character.fileName || character.avatar;

    // 计算待持久化的载荷
    const persistPayload = {};

    // 1. summary
    let finalSummary;
    if (generateMode !== 'tags' && result.summary) {
        const cm = getCmManager(character);
        if (forceGenerateSummary || !cm.summary) {
            finalSummary = result.summary;
            persistPayload.summary = finalSummary;
            // 同步内存缓存
            cm.summary = finalSummary;
        }
    }

    // 2. tags
    const shouldApplyTags = generateMode !== 'summary' && (forceGenerateTags || !hasTags) && Array.isArray(result.tags);
    let appliedTagNames = [];
    if (shouldApplyTags) {
        const sanitizedTags = sanitizeTags(result.tags);
        const applyResult = await applyTagsByNames(fileName, sanitizedTags, { 
            replace: forceGenerateTags,
            skipSaveToFile: true
        });
        appliedTagNames = applyResult.finalTagNames;
        persistPayload.tagNames = appliedTagNames;
    }

    // 3. 单次 merge-attributes 持久化（仅在确实有写入需要时调用）
    if (Object.keys(persistPayload).length > 0) {
        await applyAIOverviewToCard(fileName, persistPayload);
    }

    if (shouldApplyTags) {
        console.log(`[CharManager] [AI Overview] Tags applied to ${fileName}: ${appliedTagNames.join(', ')}`);
    }
    
    return {
        summary: result.summary || '',
        tags: result.tags || [],
        tagNamesGenerated: appliedTagNames
    };
}

/**
 * 解析批量角色的 AI 响应并保存
 * @param {string} aiResponse - AI 返回的原始文本
 * @param {object[]} characters - 角色对象数组
 * @param {boolean} forceGenerateTags - 是否强制生成标签（覆盖已有标签）
 * @param {boolean} forceGenerateSummary - 是否强制生成概览（覆盖已有概览）
 * @param {string} generateMode - 生成模式：'both' | 'summary' | 'tags'
 * @returns {Promise<object[]>}
 */
export async function parseBatchOverviewResult(aiResponse, characters, forceGenerateTags = false, forceGenerateSummary = false, generateMode = 'both') {
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
        
        if (generateMode !== 'tags' && !item.summary) {
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
            const persistPayload = {};

            // 1. 计算 summary（仅在覆盖或原本无概览时写入）
            if (generateMode !== 'tags' && item.summary !== undefined) {
                const cm = getCmManager(char);
                if (forceGenerateSummary || !cm.summary) {
                    persistPayload.summary = item.summary;
                    cm.summary = item.summary;
                }
            }
            
            // 2. 应用标签（仅当 forceGenerateTags=true 或角色原本没有标签时）
            const shouldApplyTags = forceGenerateTags || !checkCharHasTags(char);
            const normalizedTags = (item.tags && Array.isArray(item.tags)) ? item.tags : [];
            let appliedTagNames = [];
            if (normalizedTags.length > 0 && shouldApplyTags) {
                const sanitizedTags = sanitizeTags(normalizedTags);
                const applyResult = await applyTagsByNames(fileName, sanitizedTags, { 
                    replace: forceGenerateTags,
                    skipSaveToFile: true
                });
                appliedTagNames = applyResult.finalTagNames;
                persistPayload.tagNames = appliedTagNames;
                console.log(`[CharManager] [AI Batch] ${char.name}: ${appliedTagNames.join(', ')}`);
            }

            // 3. 单次 merge-attributes 持久化
            if (Object.keys(persistPayload).length > 0) {
                await applyAIOverviewToCard(fileName, persistPayload);
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

/**
 * 流式解析批量概览结果（集成 streaming-parser）
 * @param {string} chunk - 新增文本块
 * @param {StreamingParserState} state - 解析器状态
 * @param {boolean} isDone - 是否完成
 * @param {Map<string, object>} characterMap - fileName -> 角色对象映射
 * @param {boolean} forceGenerateTags - 是否强制生成标签
 * @param {function} onCharComplete - 角色完成回调 (result) => void
 * @returns {{ processed: number, errors: string[] }}
 */
export async function parseStreamingBatchChunk(chunk, state, isDone, characterMap, forceGenerateTags, onCharComplete, generateMode = 'both') {
    const { completeObjects, errors } = parseStreamingOverviewChunk(chunk, state, isDone);
    let processed = 0;
    
    for (const obj of completeObjects) {
        const char = characterMap.get(obj.fileName);
        if (char) {
            const result = await processOverviewResult(obj, char, forceGenerateTags, generateMode);
            if (onCharComplete) {
                onCharComplete(result);
            }
            processed++;
        } else {
            errors.push(`未找到角色：${obj.fileName}`);
        }
    }
    
    return { processed, errors };
}

/**
 * 处理单个概览结果（同步版本，用于流式处理）
 * 注意：此函数仅更新 char.data 对象，不进行持久化操作
 * @param {object} overview - AI 返回的概览对象
 * @param {object} char - 角色对象
 * @param {boolean} forceGenerateTags - 是否强制生成标签
 * @returns {{ fileName: string, charName: string, success: boolean, error?: string }}
 */
export async function processOverviewResult(overview, char, forceGenerateTags = false, generateMode = 'both') {
    try {
        const fileName = getCharacterFileName(char);
        const hasExistingTags = checkCharHasTags(char);
        const persistPayload = {};

        // 1. 计算 summary
        if (generateMode !== 'tags' && overview.summary !== undefined) {
            persistPayload.summary = overview.summary;
            const cm = getCmManager(char);
            cm.summary = overview.summary;
        }
        
        // 2. 计算 tags
        if (generateMode !== 'summary' && overview.tags && Array.isArray(overview.tags)) {
            if (forceGenerateTags || !hasExistingTags) {
                const sanitizedTags = sanitizeTags(overview.tags);
                const applyResult = await applyTagsByNames(fileName, sanitizedTags, { 
                    replace: forceGenerateTags,
                    skipSaveToFile: true
                });
                const appliedTagNames = applyResult.finalTagNames;
                persistPayload.tagNames = appliedTagNames;
                console.log(`[CharManager] [AI Stream] ${char.name} tags: ${appliedTagNames.join(', ')}`);
            }
        }

        // 3. 单次 merge-attributes 持久化
        if (Object.keys(persistPayload).length > 0) {
            await applyAIOverviewToCard(fileName, persistPayload);
        }
        
        return {
            fileName,
            charName: char.name,
            success: true
        };
    } catch (e) {
        return {
            fileName: getCharacterFileName(char),
            charName: char.name,
            success: false,
            error: e.message
        };
    }
}

