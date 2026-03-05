# 流式传输改造实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans 来逐步实施此计划。

**Goal:** 将 AI 概览和翻译功能的 API 请求改造为流式传输，支持实时进度显示、取消操作和断点恢复。

**Architecture:** 新增 `utils/streaming-parser.js` 模块提供增量 JSON 解析和 SSE 解析能力，修改 `ai-service.js` 和 `translation-service.js` 添加流式调用方法，修改 UI 层支持实时更新和取消按钮。

**Tech Stack:** JavaScript ES Modules, Fetch API ReadableStream, SSE (Server-Sent Events), AbortController, IndexedDB

---

## 任务清单

### Task 1: 创建流式解析器模块

**Files:**
- Create: `utils/streaming-parser.js`
- Test: 手动测试（浏览器控制台）

**Step 1: 创建基础结构和错误类型定义**

```javascript
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
    }
}
```

**Step 2: 添加 SSE 解析工具函数**

```javascript
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
 * @returns {string|null} - 提取的文本，失败返回 null
 */
export function extractSSEContent(data) {
    try {
        const parsed = JSON.parse(data);
        return parsed.choices?.[0]?.delta?.content || null;
    } catch {
        return null;
    }
}
```

**Step 3: 添加 JSON 清理工具**

```javascript
// ==================== JSON 清理工具 ====================

/**
 * 清理 JSON 文本（移除 markdown 代码块等）
 * @param {string} text - 原始文本
 * @returns {string}
 */
export function cleanJsonText(text) {
    let cleanText = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
    cleanText = cleanText.trim();
    return cleanText;
}
```

**Step 4: 添加 AI 概览增量解析器**

```javascript
// ==================== AI 概览增量解析器 ====================

/**
 * 解析流式 AI 概览 chunk
 * @param {string} chunk - 新增的文本块
 * @param {StreamingParserState} state - 解析器状态
 * @param {boolean} isDone - 是否已完成
 * @returns {{ completeObjects: object[], remainingBuffer: string, errors: string[] }}
 */
export function parseStreamingOverviewChunk(chunk, state, isDone = false) {
    state.buffer += chunk;
    const completeObjects = [];
    const errors = [];
    
    let startIndex = 0;
    
    // 查找完整的对象 {...}
    while (startIndex < state.buffer.length) {
        // 查找对象开始
        const objectStart = state.buffer.indexOf('{', startIndex);
        if (objectStart === -1) break;
        
        // 使用 brace counting 找到匹配的结束
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let objectEnd = -1;
        
        for (let i = objectStart; i < state.buffer.length; i++) {
            const char = state.buffer[i];
            
            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            
            if (char === '\\' && inString) {
                escapeNext = true;
                continue;
            }
            
            if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
            }
            
            if (!inString) {
                if (char === '{') depth++;
                else if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        objectEnd = i;
                        break;
                    }
                }
            }
        }
        
        if (objectEnd !== -1) {
            // 找到完整对象
            const objectStr = state.buffer.slice(objectStart, objectEnd + 1);
            try {
                const obj = JSON.parse(objectStr);
                // 验证必需字段
                if (obj.fileName !== undefined) {
                    completeObjects.push(obj);
                }
            } catch (e) {
                errors.push(`解析失败：${objectStr.slice(0, 50)}...`);
            }
            startIndex = objectEnd + 1;
        } else {
            // 未找到完整对象，保留缓冲区
            break;
        }
    }
    
    // 更新缓冲区
    state.buffer = state.buffer.slice(startIndex);
    
    // 如果已完成且缓冲区非空，尝试强制解析
    if (isDone && state.buffer.trim()) {
        try {
            // 尝试修复并解析
            const fixed = state.buffer.trim();
            if (fixed.startsWith('{') && !fixed.endsWith('}')) {
                // 尝试补全
                const repaired = fixed + '}';
                const obj = JSON.parse(repaired);
                if (obj.fileName !== undefined) {
                    completeObjects.push(obj);
                }
            }
        } catch {
            errors.push(`截断数据无法恢复：${state.buffer.slice(0, 50)}...`);
        }
        state.buffer = '';
    }
    
    return { completeObjects, remainingBuffer: state.buffer, errors };
}
```

**Step 5: 添加翻译增量解析器**

```javascript
// ==================== 翻译增量解析器 ====================

/**
 * 解析流式翻译 chunk
 * @param {string} chunk - 新增的文本块
 * @param {StreamingParserState} state - 解析器状态
 * @param {string[]} expectedKeys - 期望的 key 列表
 * @param {boolean} isDone - 是否已完成
 * @returns {{ completePairs: object, incompleteKeys: string[], remainingBuffer: string, errors: string[] }}
 */
export function parseStreamingTranslationChunk(chunk, state, expectedKeys = null, isDone = false) {
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
    } catch {
        // 完整解析失败，使用增量解析
    }
    
    // 增量解析：查找已闭合的 key-value 对
    // 正则匹配 "key": "value" 模式（value 中的引号已转义）
    const keyValueRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    
    while ((match = keyValueRegex.exec(state.buffer)) !== null) {
        const key = match[1];
        const value = match[2]
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
        
        if (key && !completePairs[key]) {
            completePairs[key] = value;
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
```

**Step 6: 提交**

```bash
git add utils/streaming-parser.js
git commit -m "feat(streaming): 创建流式解析器模块

- 新增 StreamingErrorTypes 错误类型定义
- 新增 StreamingParserState 状态类
- 新增 parseSSELines/parseSSELine/extractSSEContent SSE 解析工具
- 新增 cleanJsonText JSON 清理工具
- 新增 parseStreamingOverviewChunk AI 概览增量解析器
- 新增 parseStreamingTranslationChunk 翻译增量解析器"
```

---

### Task 2: 修改 AI 概览服务 - 添加流式调用方法

**Files:**
- Modify: `ai-overview/ai-service.js:235-293` (callOpenAI 函数后添加)
- Import: 在文件顶部添加 `import { parseSSELines, parseSSELine, extractSSEContent, StreamingParserState } from '../utils/streaming-parser.js';`

**Step 1: 添加导入语句**

在文件顶部第 8 行后添加：
```javascript
import { parseSSELines, parseSSELine, extractSSEContent, StreamingParserState } from '../utils/streaming-parser.js';
```

**Step 2: 添加 callOpenAIStreaming 函数**

在 `callOpenAI` 函数后（第 293 行后）添加：

```javascript
/**
 * 流式调用 OpenAI API（带自动降级）
 * @param {object} config - API 配置
 * @param {string} prompt - 提示词
 * @param {function} onChunk - chunk 回调 (content: string) => void
 * @param {number} maxTokens - 最大 Token 数
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<string>} - 完整响应文本
 */
async function callOpenAIStreaming(config, prompt, onChunk, maxTokens = 4096, signal = null) {
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
        temperature: 1.0,
        max_tokens: maxTokens,
        stream: true,
        // Gemini 安全设置
        safety_settings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
    };
    
    try {
        const res = await authFetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal
        });
        
        if (!res.ok) {
            // 如果流式请求失败，尝试降级到非流式
            if (res.status === 400 || res.status === 501) {
                console.log('[CharManager] 流式请求不支持，降级到非流式模式');
                return await callOpenAI(config, prompt, maxTokens);
            }
            const errorText = await res.text();
            throw new Error(`AI API 请求失败 (${res.status}): ${errorText.slice(0, 200)}`);
        }
        
        // 检查是否为流式响应
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
            // 非流式响应，直接解析 JSON
            const json = await res.json();
            return json.choices?.[0]?.message?.content || '';
        }
        
        // 处理流式响应
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const { lines, remaining } = parseSSELines(buffer);
            buffer = remaining;
            
            for (const line of lines) {
                const parsed = parseSSELine(line);
                if (parsed.type === 'data') {
                    const content = extractSSEContent(parsed.content);
                    if (content) {
                        fullContent += content;
                        if (onChunk) onChunk(content);
                    }
                } else if (parsed.type === 'done') {
                    break;
                }
            }
        }
        
        return fullContent;
        
    } catch (e) {
        // 如果是取消错误，直接抛出
        if (e.name === 'AbortError') {
            throw e;
        }
        // 其他错误尝试降级
        console.warn('[CharManager] 流式请求失败，尝试非流式:', e.message);
        return await callOpenAI(config, prompt, maxTokens);
    }
}
```

**Step 3: 提交**

```bash
git add ai-overview/ai-service.js
git commit -m "feat(ai-overview): 添加 callOpenAIStreaming 流式调用方法

- 新增 callOpenAIStreaming 函数支持 SSE 流式传输
- 支持自动降级到非流式模式（400/501 错误时）
- 支持 AbortSignal 取消信号
- 集成 SSE 解析工具"
```

---

### Task 3: 修改 AI 概览服务 - 改造 generateBatchOverview

**Files:**
- Modify: `ai-overview/ai-service.js:83-221` (generateBatchOverview 函数)

**Step 1: 修改 generateBatchOverview 函数签名**

将原函数签名修改为：
```javascript
export async function generateBatchOverview(characters, tokenLimit, onProgress, forceGenerateTags = false, shouldCancel = null) {
```

**Step 2: 在函数开始处创建 AbortController**

在 `const totalBatches = batches.length;` 后添加：
```javascript
// 创建 AbortController 用于取消
const abortController = new AbortController();
```

**Step 3: 修改批次处理循环**

将原有的批次处理逻辑（第 103-209 行）替换为：

```javascript
for (let i = 0; i < batches.length; i++) {
    // 取消检查点：批次开始前
    if (shouldCancel && shouldCancel()) {
        cancelled = true;
        abortController.abort();
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
            abortController.abort();
            break;
        }
        
        const batchPrompt = buildBatchOverviewPrompt(batch.map(extractCharacterData), state.tags.map(t => t.name), forceGenerateTags);
        
        // 使用流式解析器状态
        const parserState = new StreamingParserState();
        const characterMap = new Map(batch.map(c => [getCharacterFileName(c), c]));
        
        const response = await callOpenAIStreaming(
            config,
            batchPrompt,
            (chunk) => {
                // 每个 chunk 回调中增量解析
                const { completeObjects, errors: parseErrors } = parseStreamingOverviewChunk(chunk, parserState, false);
                
                // 每完成一个角色立即保存并通知
                for (const obj of completeObjects) {
                    const char = characterMap.get(obj.fileName);
                    if (char) {
                        const result = processOverviewResult(obj, char, forceGenerateTags);
                        if (result.success) {
                            success++;
                            batchSuccess++;
                            if (onProgress) {
                                onProgress({
                                    type: 'char_success',
                                    batchIndex,
                                    totalBatches,
                                    charIndex: batch.indexOf(char) + 1,
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
                                    charIndex: batch.indexOf(char) + 1,
                                    charCount: batch.length,
                                    charName: result.charName,
                                    error: result.error
                                });
                            }
                        }
                        results.push(result);
                    }
                }
            },
            4096,
            abortController.signal
        );
        
        // 最终解析（处理剩余缓冲区）
        const { completeObjects: finalObjects, errors: finalErrors } = parseStreamingOverviewChunk('', parserState, true);
        for (const obj of finalObjects) {
            const char = characterMap.get(obj.fileName);
            if (char) {
                const result = processOverviewResult(obj, char, forceGenerateTags);
                if (result.success) {
                    success++;
                    batchSuccess++;
                } else {
                    errors++;
                    batchErrors++;
                }
                results.push(result);
            }
        }
        
    } catch (e) {
        if (e.name === 'AbortError') {
            cancelled = true;
            // 保留已解析的结果
            break;
        }
        
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
```

**Step 4: 添加 processOverviewResult 辅助函数**

在文件末尾添加：

```javascript
/**
 * 处理单个概览结果
 * @param {object} overview - AI 返回的概览对象
 * @param {object} char - 角色对象
 * @param {boolean} forceGenerateTags - 是否强制生成标签
 * @returns {{ fileName: string, charName: string, success: boolean, error?: string }}
 */
function processOverviewResult(overview, char, forceGenerateTags) {
    try {
        const data = char.data || {};
        
        // 更新概览
        if (overview.summary !== undefined) {
            data.creatorcomment = overview.summary;
        }
        
        // 更新标签
        if (overview.tags && Array.isArray(overview.tags)) {
            data.tags = overview.tags;
        }
        
        return {
            fileName: getCharacterFileName(char),
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
```

**Step 5: 提交**

```bash
git add ai-overview/ai-service.js
git commit -m "feat(ai-overview): 改造 generateBatchOverview 支持流式传输

- 集成 callOpenAIStreaming 流式调用
- 使用 StreamingParserState 增量解析
- 每完成一个角色即刻保存并通知 UI
- 支持 AbortController 取消
- 新增 processOverviewResult 辅助函数"
```

---

### Task 4: 修改 AI 概览解析器 - 添加流式解析集成

**Files:**
- Modify: `ai-overview/result-parser.js` (文件末尾添加)

**Step 1: 添加导入语句**

在文件顶部添加：
```javascript
import { parseStreamingOverviewChunk, StreamingParserState } from '../utils/streaming-parser.js';
```

**Step 2: 添加 parseStreamingBatchChunk 函数**

在文件末尾添加：

```javascript
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
export function parseStreamingBatchChunk(chunk, state, isDone, characterMap, forceGenerateTags, onCharComplete) {
    const { completeObjects, errors } = parseStreamingOverviewChunk(chunk, state, isDone);
    let processed = 0;
    
    for (const obj of completeObjects) {
        const char = characterMap.get(obj.fileName);
        if (char) {
            const result = processOverviewResult(obj, char, forceGenerateTags);
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
 * 处理单个概览结果
 * @param {object} overview - AI 返回的概览对象
 * @param {object} char - 角色对象
 * @param {boolean} forceGenerateTags - 是否强制生成标签
 * @returns {{ fileName: string, charName: string, success: boolean, error?: string }}
 */
function processOverviewResult(overview, char, forceGenerateTags) {
    try {
        const data = char.data || {};
        
        // 更新概览
        if (overview.summary !== undefined) {
            data.creatorcomment = overview.summary;
        }
        
        // 更新标签
        if (overview.tags && Array.isArray(overview.tags)) {
            data.tags = overview.tags;
        }
        
        return {
            fileName: char.fileName || char.avatar,
            charName: char.name,
            success: true
        };
    } catch (e) {
        return {
            fileName: char.fileName || char.avatar,
            charName: char.name,
            success: false,
            error: e.message
        };
    }
}
```

**Step 3: 提交**

```bash
git add ai-overview/result-parser.js
git commit -m "feat(ai-overview): 添加 parseStreamingBatchChunk 流式解析函数

- 集成 streaming-parser 模块
- 支持增量解析和角色完成回调
- 添加 processOverviewResult 辅助函数"
```

---

### Task 5: 修改翻译服务 - 添加流式调用方法

**Files:**
- Modify: `translation/translation-service.js:262-340` (_callOpenAI 函数后添加)

**Step 1: 添加导入语句**

在文件顶部添加：
```javascript
import { parseSSELines, parseSSELine, extractSSEContent, StreamingParserState, parseStreamingTranslationChunk } from '../utils/streaming-parser.js';
```

**Step 2: 添加 _callOpenAIStreaming 方法**

在 `_callOpenAI` 方法后（第 310 行左右）添加：

```javascript
/**
 * 流式调用 OpenAI API（带自动降级）
 * @param {object[]} messages - 消息数组
 * @param {function} onChunk - chunk 回调 (content: string) => void
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<string>}
 */
async _callOpenAIStreaming(messages, onChunk, signal) {
    const url = (this.settings.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
    const apiKey = this.settings.openaiApiKey || '';
    const model = this.settings.openaiModel || 'gpt-3.5-turbo';
    
    const body = {
        model,
        messages,
        temperature: 0.7,
        stream: true,
        safety_settings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
    };
    
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            signal
        });
        
        if (!res.ok) {
            // 降级到非流式
            if (res.status === 400 || res.status === 501) {
                return await this._callOpenAI(messages);
            }
            const txt = await res.text();
            throw new Error(`OpenAI API Error: ${res.status} - ${txt}`);
        }
        
        // 检查响应类型
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('text/event-stream')) {
            const json = await res.json();
            return json.choices?.[0]?.message?.content || '';
        }
        
        // 流式读取
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const { lines, remaining } = parseSSELines(buffer);
            buffer = remaining;
            
            for (const line of lines) {
                const parsed = parseSSELine(line);
                if (parsed.type === 'data') {
                    const content = extractSSEContent(parsed.content);
                    if (content) {
                        fullContent += content;
                        if (onChunk) onChunk(content);
                    }
                }
            }
        }
        
        return fullContent;
        
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        // 降级到非流式
        console.warn('[Translation] 流式请求失败，降级:', e.message);
        return await this._callOpenAI(messages);
    }
}
```

**Step 3: 提交**

```bash
git add translation/translation-service.js
git commit -m "feat(translation): 添加 _callOpenAIStreaming 流式调用方法

- 新增 _callOpenAIStreaming 方法支持 SSE 流式传输
- 支持自动降级到非流式模式
- 支持 AbortSignal 取消信号
- 集成 SSE 解析工具"
```

---

### Task 6: 修改翻译服务 - 改造 translate 方法

**Files:**
- Modify: `translation/translation-service.js:145-257` (translate 方法)

**Step 1: 修改 translate 方法签名**

将原签名修改为：
```javascript
async translate(dataToTranslate, charContext, options = {}, onChunk = null) {
```

**Step 2: 在方法开始处创建解析器状态**

在 `const prompt = this.getSystemPrompt(options);` 前添加：
```javascript
// 创建解析器状态
const expectedKeys = Object.keys(dataToTranslate);
const parserState = new StreamingParserState();
const result = {};
```

**Step 3: 修改 API 调用逻辑**

将原有的 API 调用部分（第 209-216 行）替换为：

```javascript
let responseText = '';

if (this.settings.translationApi === 'openai') {
    // 使用流式调用（带 onChunk 回调）
    if (onChunk) {
        responseText = await this._callOpenAIStreaming(
            messages,
            (chunk) => {
                // 增量解析
                const { completePairs } = parseStreamingTranslationChunk(chunk, parserState, expectedKeys, false);
                // 合并到结果
                Object.assign(result, completePairs);
                // 回调通知 UI
                if (onChunk) {
                    onChunk({ 
                        type: 'field_complete', 
                        completedKeys: Object.keys(completePairs), 
                        allKeys: expectedKeys,
                        partialResult: { ...dataToTranslate, ...result }
                    });
                }
            },
            this.abortController.signal
        );
    } else {
        responseText = await this._callOpenAI(messages);
    }
} else {
    // 默认为酒馆原生 API（非流式）
    responseText = await this._callTavernAPI(messages);
}
```

**Step 4: 添加最终解析逻辑**

在 `const result = safeParseJson(responseText);` 前添加：

```javascript
// 如果使用了流式回调，result 已经有部分数据
// 现在处理最终响应
if (onChunk) {
    // 最终解析（处理剩余缓冲区）
    const { completePairs, incompleteKeys, errors } = parseStreamingTranslationChunk('', parserState, expectedKeys, true);
    Object.assign(result, completePairs);
    
    // 处理未完成的字段（标记错误）
    for (const key of incompleteKeys) {
        result[key] = dataToTranslate[key]; // 保留原文
        console.warn(`[Translation] 字段 "${key}" 未完成，保留原文`);
    }
    
    // 验证并填充缺失字段
    for (const key of expectedKeys) {
        if (result[key] === undefined) {
            result[key] = dataToTranslate[key];
        }
    }
    
    // 流式模式已完成，跳过 safeParseJson
} else {
    // 非流式模式，使用原有逻辑
    const parsedResult = safeParseJson(responseText);
    if (!parsedResult) {
        throw new Error('Failed to parse JSON response');
    }
    Object.assign(result, parsedResult);
}
```

**Step 5: 修改错误处理**

在 catch 块中（第 243 行后）添加：

```javascript
// 如果是用户主动中断（关闭翻译界面），直接抛出，不再重试
if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) {
    console.log('[CharManager] [Translation] Request aborted by user');
    // 返回已解析的数据
    return { ...dataToTranslate, ...result, _cancelled: true };
}
```

**Step 6: 提交**

```bash
git add translation/translation-service.js
git commit -m "feat(translation): 改造 translate 方法支持流式传输

- 新增 onChunk 回调参数
- 集成 _callOpenAIStreaming 流式调用
- 使用 parseStreamingTranslationChunk 增量解析
- 支持取消时返回已解析数据
- 自动降级到非流式模式"
```

---

### Task 7: 修改翻译 UI - 添加取消按钮支持

**Files:**
- Modify: `translation/translation-ui.js` (查找 translateGroup 函数)

**Step 1: 查找 translateGroup 函数位置**

先读取文件找到 translateGroup 函数的位置。

**Step 2: 在翻译弹窗中添加取消按钮**

在创建翻译弹窗的代码中，添加取消按钮 HTML 和事件处理。

**Step 3: 修改 translateGroup 调用**

将原有的 `service.translate()` 调用修改为传递 onChunk 回调。

**Step 4: 提交**

```bash
git add translation/translation-ui.js
git commit -m "feat(translation): 添加取消按钮和实时更新支持

- 在翻译弹窗中添加取消按钮
- 修改 translateGroup 支持 onChunk 回调
- 实时更新已完成字段的 UI 状态
- 支持取消时保留已翻译数据"
```

---

### Task 8: 手动测试验证

**Files:**
- 无修改

**Step 1: 启动 SillyTavern 主项目**

```bash
cd O:\Container\silly_tavern\SillyTavernchat-main
npm start
```

**Step 2: 在浏览器中打开 SillyTavern**

访问 `http://localhost:8000`

**Step 3: 测试 AI 概览流式传输**

1. 打开角色管理插件
2. 选择多个角色
3. 点击"生成 AI 概览"
4. 观察进度条实时更新
5. 测试取消按钮

**Step 4: 测试翻译流式传输**

1. 打开角色翻译功能
2. 选择一个角色
3. 点击翻译
4. 观察字段逐个完成
5. 测试取消按钮

**Step 5: 测试网络中断恢复**

1. 开始翻译或生成概览
2. 断开网络
3. 观察已完成数据保留
4. 恢复网络后继续

**Step 6: 记录测试结果**

在 `docs/plans/2026-03-05-streaming-refactor-test-results.md` 中记录测试结果。

---

## 完成标准

- [ ] Task 1: streaming-parser.js 创建完成
- [ ] Task 2: ai-service.js 添加 callOpenAIStreaming
- [ ] Task 3: ai-service.js 改造 generateBatchOverview
- [ ] Task 4: result-parser.js 添加 parseStreamingBatchChunk
- [ ] Task 5: translation-service.js 添加 _callOpenAIStreaming
- [ ] Task 6: translation-service.js 改造 translate
- [ ] Task 7: translation-ui.js 添加取消按钮
- [ ] Task 8: 手动测试验证通过

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| API 不支持流式 | 功能降级 | 自动 fallback 到非流式 |
| SSE 解析异常 | 数据丢失 | 增加重试机制，保留原文 |
| 取消时机问题 | 数据不一致 | 使用 AbortController 确保安全中止 |
| 并发请求问题 | 状态混乱 | 确保 AbortController 与请求生命周期绑定 |