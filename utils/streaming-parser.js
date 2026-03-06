/**
 * 流式传输解析工具模块
 * 提供 SSE 解析、增量 JSON 解析、错误类型定义
 */

// ==================== 错误类型定义 ====================

export const StreamingErrorTypes = {
    PARSE_INCOMPLETE: 'parse_incomplete',    // JSON 未闭合
    SSE_PARSE_ERROR: 'sse_parse_error',       // SSE 行解析失败
    NETWORK_ERROR: 'network_error',           // 网络中断
    CANCELLED: 'cancelled'                    // 用户取消
};

// ==================== 解析器状态类 ====================

/**
 * 流式解析器状态
 * 用于跨 chunk 累积数据
 */
export class StreamingParserState {
    constructor() {
        this.buffer = '';           // 未处理的文本缓冲
        this.braceDepth = 0;         // 当前花括号深度
        this.inString = false;       // 是否在字符串内
        this.escapeNext = false;     // 下一个字符是否转义
        this.completeObjects = [];   // 已完成的对象
        this.incompleteKeys = [];    // 未完成的 key
        this.markdownCleaned = false; // 是否已清理开头的 markdown 标记
        this.hasMarkdownBlock = false; // 响应是否包含 markdown 代码块
    }
}

// ==================== SSE 解析工具 ====================

/**
 * 解析 SSE 数据行
 * @param {string} buffer - 原始缓冲区
 * @returns {{ lines: string[], remaining: string }}
 */
export function parseSSELines(buffer) {
    const lines = [];
    let remaining = buffer;
    
    while (true) {
        const lineEnd = remaining.indexOf('\n');
        if (lineEnd === -1) break;
        
        const line = remaining.slice(0, lineEnd).trim();
        remaining = remaining.slice(lineEnd + 1);
        
        if (line) lines.push(line);
    }
    
    return { lines, remaining };
}

/**
 * 解析单个 SSE 行
 * @param {string} line - SSE 行
 * @returns {{ type: 'data'|'done'|'ignore', content?: string }}
 */
export function parseSSELine(line) {
    if (line === 'data: [DONE]') {
        return { type: 'done' };
    }
    if (line.startsWith('data: ')) {
        return { type: 'data', content: line.slice(6) };
    }
    return { type: 'ignore' };
}

/**
 * 提取 SSE 内容中的文本
 * @param {string} data - SSE data 内容
 * @param {boolean} debugMode - 是否启用调试模式
 * @returns {string|null} - 提取的文本，失败返回 null
 */
export function extractSSEContent(data, debugMode = false) {
    try {
        const parsed = JSON.parse(data);
        return parsed.choices?.[0]?.delta?.content || null;
    } catch (e) {
        if (debugMode) {
            console.warn('[CharManager] [StreamingParser] SSE 内容解析失败:', data.slice(0, 100), e.message);
        }
        return null;
    }
}

// ==================== JSON 清理工具 ====================

/**
 * 清理 JSON 文本（移除 markdown 代码块等）
 * 仅移除文本开头和结尾的 markdown 标记，避免破坏 JSON 内容
 * @param {string} text - 原始文本
 * @returns {string}
 */
export function cleanJsonText(text) {
    let cleanText = text.trim();
    
    // 仅移除开头的 ```json 或 ``` 标记
    if (cleanText.startsWith('```json')) {
        cleanText = cleanText.slice(7).trimStart();
    } else if (cleanText.startsWith('```')) {
        cleanText = cleanText.slice(3).trimStart();
    }
    
    // 仅移除结尾的 ``` 标记
    if (cleanText.endsWith('```')) {
        cleanText = cleanText.slice(0, -3).trimEnd();
    }
    
    return cleanText;
}

// ==================== AI 概览增量解析器 ====================

/**
 * 解析流式 AI 概览 chunk
 * 使用单次遍历算法优化性能，避免嵌套循环
 * @param {string} chunk - 新增的文本块
 * @param {StreamingParserState} state - 解析器状态
 * @param {boolean} isDone - 是否已完成
 * @param {boolean} debugMode - 是否启用调试模式
 * @returns {{ completeObjects: object[], remainingBuffer: string, errors: string[] }}
 */
export function parseStreamingOverviewChunk(chunk, state, isDone = false, debugMode = false) {
    state.buffer += chunk;
    const completeObjects = [];
    const errors = [];
    
    // 预处理：仅在首次调用时移除开头的 markdown 代码块标记
    // 避免在流式传输中错误地移除 JSON 内容中的 markdown 字符
    if (!state.markdownCleaned) {
        const trimmed = state.buffer.trimStart();
        if (trimmed.startsWith('```json')) {
            state.buffer = trimmed.slice(7).trimStart();
            state.hasMarkdownBlock = true;
        } else if (trimmed.startsWith('```')) {
            state.buffer = trimmed.slice(3).trimStart();
            state.hasMarkdownBlock = true;
        }
        state.markdownCleaned = true;
    }
    
    // 仅在流结束时移除结尾的 markdown 标记
    if (isDone && state.hasMarkdownBlock && state.buffer.trimEnd().endsWith('```')) {
        state.buffer = state.buffer.trimEnd().slice(0, -3).trimEnd();
    }
    
    // 单次遍历查找所有完整对象
    let i = 0;
    let objectStart = -1;
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let lastObjectEnd = -1;
    
    while (i < state.buffer.length) {
        const char = state.buffer[i];
        
        // 处理转义字符
        if (escapeNext) {
            escapeNext = false;
            i++;
            continue;
        }
        
        if (char === '\\' && inString) {
            escapeNext = true;
            i++;
            continue;
        }
        
        // 处理字符串边界
        if (char === '"') {
            inString = !inString;
            i++;
            continue;
        }
        
        // 处理对象层级
        if (!inString) {
            if (char === '{') {
                if (depth === 0) {
                    objectStart = i;
                }
                depth++;
            } else if (char === '}') {
                // 防御性编程：防止 depth 下溢（噪声字符保护）
                if (depth > 0) {
                    depth--;
                    if (depth === 0 && objectStart !== -1) {
                        // 找到完整对象
                        const objectStr = state.buffer.slice(objectStart, i + 1);
                        try {
                            const obj = JSON.parse(objectStr);
                            // 验证必需字段
                            if (obj.fileName !== undefined) {
                                completeObjects.push(obj);
                            }
                        } catch (e) {
                            const errorMsg = `解析失败：${objectStr.slice(0, 50)}...`;
                            errors.push(errorMsg);
                            if (debugMode) {
                                console.warn('[CharManager] [StreamingParser] 对象解析失败:', e.message);
                            }
                        }
                        lastObjectEnd = i;
                        objectStart = -1;
                    }
                } else {
                    // depth 为 0 时遇到 '}'，可能是噪声字符，记录警告
                    if (debugMode) {
                        console.warn('[CharManager] [StreamingParser] 检测到噪声字符 }，已忽略');
                    }
                }
            }
        }
        
        i++;
    }
    
    // 更新缓冲区：保留未完成的部分
    if (lastObjectEnd !== -1) {
        state.buffer = state.buffer.slice(lastObjectEnd + 1);
    }
    
    // 如果已完成且缓冲区非空，尝试强制解析
    if (isDone && state.buffer.trim()) {
        try {
            // 尝试修复并解析截断的 JSON
            const fixed = state.buffer.trim();
            if (fixed.startsWith('{')) {
                // 计算需要补全的花括号数量
                let openBraces = 0;
                let inStr = false;
                let escape = false;
                
                for (let j = 0; j < fixed.length; j++) {
                    const c = fixed[j];
                    if (escape) {
                        escape = false;
                        continue;
                    }
                    if (c === '\\' && inStr) {
                        escape = true;
                        continue;
                    }
                    if (c === '"') {
                        inStr = !inStr;
                        continue;
                    }
                    if (!inStr) {
                        if (c === '{') openBraces++;
                        else if (c === '}') openBraces--;
                    }
                }
                
                // 如果有未闭合的花括号，尝试补全
                if (openBraces > 0) {
                    const repaired = fixed + '}'.repeat(openBraces);
                    if (debugMode) {
                        console.log('[CharManager] [StreamingParser] 尝试修复截断 JSON，补全', openBraces, '个花括号');
                    }
                    const obj = JSON.parse(repaired);
                    if (obj.fileName !== undefined) {
                        completeObjects.push(obj);
                    }
                } else {
                    // 花括号已平衡，尝试直接解析
                    const obj = JSON.parse(fixed);
                    if (obj.fileName !== undefined) {
                        completeObjects.push(obj);
                    }
                }
            }
        } catch (e) {
            errors.push(`截断数据无法恢复：${state.buffer.slice(0, 50)}...`);
            if (debugMode) {
                console.warn('[CharManager] [StreamingParser] 截断数据修复失败:', e.message);
            }
        }
        state.buffer = '';
    }
    
    return { completeObjects, remainingBuffer: state.buffer, errors };
}

// ==================== 翻译增量解析器 ====================

/**
 * 解析流式翻译 chunk
 * @param {string} chunk - 新增的文本块
 * @param {StreamingParserState} state - 解析器状态
 * @param {string[]} expectedKeys - 期望的 key 列表
 * @param {boolean} isDone - 是否已完成
 * @param {boolean} debugMode - 是否启用调试模式
 * @returns {{ completePairs: object, incompleteKeys: string[], remainingBuffer: string, errors: string[] }}
 */
export function parseStreamingTranslationChunk(chunk, state, expectedKeys = null, isDone = false, debugMode = false) {
    state.buffer += chunk;
    const completePairs = {};
    const errors = [];
    
    // 尝试完整解析
    try {
        const cleaned = cleanJsonText(state.buffer);
        const parsed = JSON.parse(cleaned);
        
        // 成功解析，返回所有 key-value
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') {
                completePairs[key] = value;
            }
        }
        state.buffer = '';
        return { completePairs, incompleteKeys: [], remainingBuffer: '', errors: [] };
    } catch (e) {
        // 完整解析失败，使用增量解析
        if (debugMode) {
            console.log('[CharManager] [StreamingParser] 完整 JSON 解析失败，切换到增量解析:', e.message);
        }
    }
    
    // 增量解析：查找已闭合的 key-value 对
    // 正则匹配 "key": "value" 模式（value 中的引号已转义）
    const keyValueRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    const matchedKeys = new Set();

    while ((match = keyValueRegex.exec(state.buffer)) !== null) {
        const key = match[1];
        const rawValue = match[2];
        
        // 关键修复：验证 value 是否是完整闭合的
        // 如果 rawValue 以奇数个反斜杠结尾，说明最后一个引号被转义了，字符串未闭合
        let isComplete = true;
        if (rawValue) {
            let backslashCount = 0;
            for (let i = rawValue.length - 1; i >= 0 && rawValue[i] === '\\'; i--) {
                backslashCount++;
            }
            // 如果反斜杠数量为奇数，说明最后一个引号被转义，字符串未闭合
            if (backslashCount % 2 === 1) {
                isComplete = false;
                if (debugMode) {
                    console.log('[CharManager] [StreamingParser] 检测到未闭合的 value，跳过:', key);
                }
                continue;
            }
        }

        const value = rawValue
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');

        if (key && !completePairs[key] && !matchedKeys.has(key)) {
            completePairs[key] = value;
            matchedKeys.add(key);
        }
    }
    
    // 计算未完成的 keys
    let incompleteKeys = [];
    if (expectedKeys) {
        incompleteKeys = expectedKeys.filter(k => !completePairs[k]);
    }
    
    // 如果已完成，处理剩余缓冲区
    if (isDone) {
        if (state.buffer.trim()) {
            errors.push(`翻译数据截断，已恢复 ${Object.keys(completePairs).length} 个字段`);
        }
        state.buffer = '';
    }
    
    return { completePairs, incompleteKeys, remainingBuffer: state.buffer, errors };
}
