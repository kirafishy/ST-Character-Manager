# 流式传输改造设计文档

## 一、项目背景

### 1.1 需求目标

将 AI 功能的 API 请求改为流式传输，实现以下能力：

- **中途截断恢复**：网络中断或用户取消时仍能获取已完成的数据
- **实时进度显示**：每个角色/字段完成时即刻更新 UI
- **取消操作支持**：支持取消操作并保留已解析数据

### 1.2 涉及模块

| 模块 | 当前状态 | 改造后 |
|------|----------|--------|
| AI 概览 | 批量请求 → 一次性返回 JSON | 批量请求 → 流式解析 → 每个角色完成即刻保存 |
| 翻译 | 批量请求（15字段/批）→ 一次性返回 JSON | 批量请求 → 流式解析 → 每个字段完成即刻更新 UI |

---

## 二、核心设计

### 2.1 增量 JSON 解析器

#### AI 概览响应格式

```json
{
  "results": [
    {"fileName": "char1.json", "summary": "概览内容", "tags": ["标签1"]},
    {"fileName": "char2.json", "summary": "概览内容", "tags": ["标签2", "标签3"]}
  ]
}
```

或回退格式：

```json
[
    {"fileName": "char1.json", "summary": "概览内容", "tags": ["标签1"]},
    {"fileName": "char2.json", "summary": "概览内容", "tags": ["标签2"]}
]
```

#### 翻译响应格式

```json
{
  "description": "翻译后的描述",
  "personality": "翻译后的性格",
  "first_mes": "翻译后的开场白"
}
```

#### 解析策略

- **AI 概览**：使用 brace counting 监听每个 `{...}` 闭合
- **翻译**：尝试完整解析，失败则正则匹配已闭合的 key-value 对
- **截断处理**：已闭合的保留使用，未闭合的标记错误状态（标记模式）

### 2.2 流式传输协议（SSE）

```
data: {"choices":[{"delta":{"content":"..."}}]}
data: {"choices":[{"delta":{"content":"..."}}]}
data: [DONE]
```

### 2.3 取消行为

- 用户点击取消 → 立即调用 `AbortController.abort()`
- 已解析的数据保留使用
- 未完成的请求被中止

### 2.4 错误类型定义

```javascript
export const StreamingErrorTypes = {
    PARSE_INCOMPLETE: 'parse_incomplete',    // JSON 未闭合
    SSE_PARSE_ERROR: 'sse_parse_error',       // SSE 行解析失败
    NETWORK_ERROR: 'network_error',           // 网络中断
    CANCELLED: 'cancelled'                    // 用户取消
};
```

### 2.5 API 降级策略

- **自动降级**：检测到不支持流式时自动回退到非流式模式
- **检测方式**：
  1. 请求发送 `stream: true`
  2. 如果返回 HTTP 错误（如 400），捕获后使用非流式重试
  3. 如果返回非流式响应（无 `data:` 前缀），按非流式处理
- **用户感知**：无，静默降级

---

## 三、文件修改清单

### 3.1 新增文件

| 文件路径 | 职责 | 状态 |
|----------|------|------|
| `utils/streaming-parser.js` | 增量 JSON 解析器 + SSE 解析工具 | ⏳ 待实施 |

### 3.2 需修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `ai-overview/ai-service.js` | 新增 `callOpenAIStreaming()` + 修改 `generateBatchOverview()` |
| `ai-overview/result-parser.js` | 新增 `parseStreamingBatchChunk()` 集成 |
| `translation/translation-service.js` | 新增 `_callOpenAIStreaming()` + 修改 `translate()` |
| `translation/translation-ui.js` | 修改 `translateGroup()` 实时更新 + 取消按钮 |

**总计：约 350 行代码变更**

---

## 四、新增文件详情

### 4.1 utils/streaming-parser.js

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
                errors.push(`解析失败: ${objectStr.slice(0, 50)}...`);
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
            errors.push(`截断数据无法恢复: ${state.buffer.slice(0, 50)}...`);
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

---

## 五、待实施文件详情

### 5.1 ai-overview/ai-service.js

#### 新增函数：callOpenAIStreaming()

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

#### 修改函数：generateBatchOverview()

```javascript
export async function generateBatchOverview(characters, tokenLimit, onProgress, forceGenerateTags = false, shouldCancel = null) {
    const config = getAIConfig();
    // ... 现有验证代码 ...
    
    const results = [];
    let success = 0;
    let errors = 0;
    let failedBatches = 0;
    let cancelled = false;
    
    const batches = groupCharactersByTokenLimit(characters, tokenLimit);
    const totalBatches = batches.length;
    
    // 创建 AbortController 用于取消
    const abortController = new AbortController();
    
    for (let i = 0; i < batches.length; i++) {
        // 取消检查点
        if (shouldCancel && shouldCancel()) {
            cancelled = true;
            abortController.abort();
            break;
        }
        
        const batch = batches[i];
        const batchIndex = i + 1;
        
        // ... 现有进度回调代码 ...
        
        try {
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
                                if (onProgress) {
                                    onProgress({
                                        type: 'char_success',
                                        batchIndex,
                                        totalBatches,
                                        charName: result.charName
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
            const { completeObjects, errors: finalErrors } = parseStreamingOverviewChunk('', parserState, true);
            // ... 处理最终对象 ...
            
        } catch (e) {
            if (e.name === 'AbortError') {
                cancelled = true;
                // 保留已解析的结果
                break;
            }
            // ... 现有错误处理 ...
        }
    }
    
    return { success, errors, results, batchInfo: { total: totalBatches, failed: failedBatches }, cancelled };
}
```

### 5.2 ai-overview/result-parser.js

#### 新增函数

```javascript
import { parseStreamingOverviewChunk, StreamingParserState } from '../utils/streaming-parser.js';

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
            errors.push(`未找到角色: ${obj.fileName}`);
        }
    }
    
    return { processed, errors };
}
```

### 5.3 translation/translation-service.js

#### 新增方法：_callOpenAIStreaming()

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

#### 修改方法：translate()

```javascript
async translate(dataToTranslate, charContext, options = {}, onChunk = null) {
    // ... 现有验证和准备代码 ...
    
    // 创建 AbortController
    this.abortController = new AbortController();
    
    const expectedKeys = Object.keys(dataToTranslate);
    const parserState = new StreamingParserState();
    const result = {};
    
    try {
        const responseText = await this._callOpenAIStreaming(
            messages,
            (chunk) => {
                // 增量解析
                const { completePairs } = parseStreamingTranslationChunk(chunk, parserState, expectedKeys, false);
                // 合并到结果
                Object.assign(result, completePairs);
                // 回调通知 UI
                if (onChunk) {
                    onChunk({ type: 'field_complete', completedKeys: Object.keys(completePairs), allKeys: expectedKeys });
                }
            },
            this.abortController.signal
        );
        
        // 最终解析
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
        
        return result;
        
    } catch (e) {
        if (e.name === 'AbortError') {
            // 用户取消，返回已解析的数据
            return { ...dataToTranslate, ...result, _cancelled: true };
        }
        throw e;
    }
}
```

### 5.4 translation/translation-ui.js

#### 修改函数：translateGroup()

```javascript
async function translateGroup(ov, group, keys, charContext, options) {
    // ... 现有准备代码 ...
    
    // 添加取消按钮（如果还没有）
    const cancelBtn = dialog.querySelector('#cm-translate-cancel');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            service.cancelOngoingRequest();
            // 标记为取消状态
            isCancelled = true;
        };
    }
    
    let isCancelled = false;
    
    try {
        const result = await service.translate(
            dataToTranslate,
            charContext,
            options,
            (progress) => {
                if (isCancelled) return;
                
                // 实时更新 UI
                const { completedKeys, allKeys } = progress;
                const percent = Math.round((completedKeys.length / allKeys.length) * 100);
                
                // 更新进度条
                updateProgressBar(`正在翻译 ${group} 组...`, percent);
                
                // 更新已完成字段的状态
                for (const key of completedKeys) {
                    const item = items.find(i => i.key === key);
                    if (item && result[key]) {
                        item.translated = result[key];
                        item.status = STATUS.SUCCESS;
                        // 更新 UI 显示
                        updateItemUI(item);
                    }
                }
            }
        );
        
        // ... 处理最终结果 ...
        
    } catch (e) {
        if (e.name === 'AbortError' || result?._cancelled) {
            // 用户取消，保留已翻译的数据
            console.log('[Translation] 用户取消翻译，保留已完成数据');
        } else {
            throw e;
        }
    }
}
```

---

## 六、进度显示方案

### 6.1 AI 概览进度条

复用现有 `showProgressBar` / `updateProgressBar` 函数：

```
┌─────────────────────────────────────────┐
│  正在生成 AI 概览                        │
│  第 1/3 批                               │
│  ████████████░░░░░░░░░░  45%            │
│  正在生成：角色名称 A... 字数：128       │
│  ✓ 角色 B 已完成                         │
│  [取消]                                  │
└─────────────────────────────────────────┘
```

### 6.2 翻译进度条

```
┌─────────────────────────────────────────┐
│  正在翻译 basic 组                       │
│  ████████████████░░░░  67%              │
│  已完成 10/15 字段                       │
│  当前字数：256                           │
│  [取消]                                  │
└─────────────────────────────────────────┘
```

---

## 七、测试计划

### 7.1 单元测试场景

| 场景 | 输入 | 预期输出 |
|------|------|----------|
| AI 概览 - 正常解析 | `{"fileName":"a.json","summary":"test","tags":[]}` | `completeObjects.length = 1` |
| AI 概览 - 截断处理 | `{"fileName":"a.json","summary":"te` + `st","tags":[]}` | 分两块输入后解析成功 |
| AI 概览 - 多角色 | `[{"fileName":"a"...},{"fileName":"b"...}]` | `completeObjects.length = 2` |
| 翻译 - 完整解析 | `{"a":"1","b":"2"}` | `completePairs = {a:"1",b:"2"}` |
| 翻译 - 部分字段 | `{"a":"1","b":"正在` | `completePairs.a = "1", incompleteKeys = ["b"]` |

### 7.2 手动测试场景

| 场景 | 验证点 |
|------|--------|
| 正常完成 | 所有角色/字段正确解析并保存 |
| 网络中断 | 已完成的数据保留，未完成的标记错误 |
| 用户取消 | 立即中止请求，已解析数据保留 |
| 非 SSE 响应 | 自动降级到普通模式，正常完成 |
| JSON 格式异常 | 容错处理，不崩溃 |

---

## 八、风险与备选方案

### 8.1 已识别风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 部分 API 不支持流式 | 功能降级 | 自动 fallback 到非流式模式 |
| SSE 解析异常 | 数据丢失 | 增加重试机制，保留原文 |
| 取消时机问题 | 数据不一致 | 使用 AbortController 确保安全中止 |
| 并发请求问题 | 状态混乱 | 确保 AbortController 与请求生命周期绑定 |

### 8.2 回退方案

如果流式模式出现严重问题，可通过以下方式回退：

1. 设置 `stream: false` 禁用流式
2. 直接调用非流式版本函数
3. 保留原有逻辑不变

---

## 九、实施进度

| 步骤 | 内容 | 状态 |
|------|------|------|
| Step 1 | 创建 `utils/streaming-parser.js` | ⏳ 待实施 |
| Step 2 | 修改 `ai-overview/ai-service.js` | ⏳ 待实施 |
| Step 3 | 修改 `ai-overview/result-parser.js` | ⏳ 待实施 |
| Step 4 | 修改 `translation/translation-service.js` | ⏳ 待实施 |
| Step 5 | 修改 `translation/translation-ui.js` | ⏳ 待实施 |
| Step 6 | 手动测试验证 | ⏳ 待实施 |