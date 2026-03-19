import { getSTContext } from '../context.js';
import { getAuthHeaders, authFetch } from '../api.js';
import { parseSSELines, parseSSELine, extractSSEContent, StreamingParserState, parseStreamingTranslationChunk } from '../utils/streaming-parser.js';

/**
 * 安全解析 JSON，处理可能存在的 Markdown 代码块或非标准格式
 * @param {string} text - AI 返回的原始文本
 * @returns {any} 解析后的 JSON 对象，失败返回 null
 */
export function safeParseJson(text) {
    if (!text) return null;
    try {
        // 尝试直接解析
        return JSON.parse(text);
    } catch (e) {
        try {
            // 尝试去除 Markdown 代码块 ```json ... ```
            let cleanText = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
            // 尝试去除首尾空白
            cleanText = cleanText.trim();
            // 尝试去除可能存在的非 JSON 字符（例如开头的一些文字说明）
            const firstBrace = cleanText.indexOf('{');
            const lastBrace = cleanText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanText = cleanText.substring(firstBrace, lastBrace + 1);
            }
            return JSON.parse(cleanText);
        } catch (e2) {
            console.error('[CharManager] [Translation] JSON Parse Error:', e2);
            return null;
        }
    }
}

/**
 * 指数退避等待
 * @param {number} attempt - 当前尝试次数 (0-based)
 * @param {number} baseDelay - 基础延迟 (ms)，默认 1000ms
 * @param {boolean} isRateLimit - 是否为 429 错误
 */
async function exponentialBackoff(attempt, baseDelay = 1000, isRateLimit = false) {
    // 如果是 429 错误，增加基础延迟时间
    const actualBaseDelay = isRateLimit ? Math.max(baseDelay, 3000) : baseDelay;
    // 增加随机抖动 (Jitter) 避免并发请求同时重试，抖动范围为 基础延迟的 20%
    const jitter = actualBaseDelay * 0.2 * Math.random();
    const delay = actualBaseDelay * Math.pow(2, attempt) + jitter;
    await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 翻译服务类
 */
export class TranslationService {
    constructor(settings) {
        this.settings = settings || {};
        this.abortController = null;
    }

    /**
     * 更新设置
     * @param {object} newSettings
     */
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
    }

    /**
     * 中断当前正在进行的 API 请求
     */
    cancelOngoingRequest() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    /**
     * 语言名称映射
     */
    static LANGUAGE_NAMES = {
        'auto': 'Auto-detected',
        'en': 'English',
        'ja': 'Japanese (日本語)',
        'ko': 'Korean (한국어)',
        'zh-CN': 'Simplified Chinese (简体中文)',
        'zh-TW': 'Traditional Chinese (繁體中文)'
    };

    /**
     * 获取目标语言的显示名称（支持 custom 自定义语言）
     * @param {object} settings - 设置对象
     * @returns {string}
     */
    static getTargetLangName(settings) {
        const targetLang = settings.targetLanguage || 'zh-CN';
        if (targetLang === 'custom') {
            return settings.customTargetLanguage || 'Custom Language';
        }
        return TranslationService.LANGUAGE_NAMES[targetLang] || targetLang;
    }

    /**
     * 构建 System Prompt
     * @param {object} [options] - 可选参数
     * @param {string} [options.glossaryText] - 术语表文本（如有）
     * @param {string} [options.mvuProtectionPrompt] - MVU 框架变量保护提示（如有）
     * @returns {string}
     */
    getSystemPrompt(options = {}) {
        // 用户配置的 System Prompt（优先使用设置中的 translationSystemPrompt）
        const systemPrompt = this.settings.translationSystemPrompt || this.settings.translationPrompt || '';
        
        // 构建语言指令
        const sourceLang = this.settings.sourceLanguage || 'auto';
        const targetLangName = TranslationService.getTargetLangName(this.settings);
        const sourceLangName = sourceLang === 'auto' ? 'the source language (auto-detect)' : (TranslationService.LANGUAGE_NAMES[sourceLang] || sourceLang);
        
        let langInstruction = `\n\nTranslation Direction: Translate from ${sourceLangName} to ${targetLangName}.`;
        if (sourceLang === 'auto') {
            langInstruction += ` Auto-detect the source language. If the content is already in ${targetLangName}, keep it unchanged.`;
        }
        langInstruction += `\nIMPORTANT: Do NOT translate SillyTavern macros such as {{user}} and {{char}}. Keep them exactly as they are.`;
        
        // 术语表注入
        let glossarySection = '';
        if (options.glossaryText) {
            glossarySection = `\n\nTranslation Glossary (must follow strictly):\n${options.glossaryText}`;
        }
        
        // MVU 框架变量保护提示注入
        let mvuSection = '';
        if (options.mvuProtectionPrompt) {
            mvuSection = options.mvuProtectionPrompt;
        }
        
        return `${systemPrompt}${langInstruction}${glossarySection}${mvuSection}`;
    }

    /**
     * 执行翻译
     * @param {object} dataToTranslate - 需要翻译的键值对对象
     * @param {object} charContext - 角色上下文 (name, personality, etc.)
     * @param {object} [options] - 可选参数
     * @param {string} [options.glossaryText] - 术语表文本
     * @param {function} [onChunk] - chunk 回调 (progress: { type: 'field_complete', completedKeys: string[], allKeys: string[], partialResult: object }) => void
     * @returns {Promise<{ data: object, cancelled: boolean }>} 翻译结果对象，包含 data（翻译后的键值对）和 cancelled（是否被取消）字段
     */
    async translate(dataToTranslate, charContext, options = {}, onChunk = null) {
        // API 配置验证
        if (this.settings.translationApi === 'openai') {
            if (!this.settings.openaiApiKey || !this.settings.openaiApiKey.trim()) {
                throw new Error('未配置 API Key，请在设置中配置 OpenAI 渠道');
            }
            if (!this.settings.openaiBaseUrl || !this.settings.openaiBaseUrl.trim()) {
                throw new Error('未配置 API Base URL，请在设置中配置 OpenAI 渠道');
            }
        }
        
        // 清理上一次请求残留的 controller（防止内存泄漏）
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        // 创建解析器状态
        const expectedKeys = Object.keys(dataToTranslate);
        const parserState = new StreamingParserState();
        const result = {};

        const prompt = this.getSystemPrompt(options);
        
        // 获取目标语言名称用于 User Prompt
        const targetLangName = TranslationService.getTargetLangName(this.settings);
        
        // 构建 User Prompt
        const contextStr = `Character Context:\nName: ${charContext.name}\nPersonality: ${charContext.personality || 'Unknown'}\nDescription Summary: ${(charContext.description || '').slice(0, 200)}...`;
        
        const contentStr = JSON.stringify(dataToTranslate, null, 2);
        
        // 根据数据内容检测是否包含代码混合内容（正则脚本 replaceString、酒馆助手 content）
        const keys = Object.keys(dataToTranslate);
        const { hasRegexReplace, hasScriptContent } = this.detectMixedCodeContent(keys);
        let extraInstructions = '';
        
        if (hasRegexReplace || hasScriptContent) {
            extraInstructions = `\n\nIMPORTANT - Code-mixed content rules:
- The values contain HTML/CSS/JavaScript mixed with natural language text.
- ONLY translate the natural language text (UI labels, tooltips, descriptions, comments visible to users).
- DO NOT modify: HTML tags, CSS properties/values, JavaScript code, variable names, function names, regex patterns, URLs, class names, id attributes.
- For .describe('...') calls in Zod schemas: translate ONLY the string inside .describe(), keep the code structure intact.
- For .prefault('...') calls: translate the default value string if it's natural language.
- For HTML data-* attributes (data-open, data-close, etc.): translate the attribute values.
- For button names in script objects: translate them.
- Keep all code indentation and formatting exactly as-is.`;
        }
        
        const messages = [
            { role: 'system', content: prompt },
            { role: 'user', content: `${contextStr}\n\nData to translate (JSON format):\n${contentStr}\n\nPlease translate the values in the JSON above to ${targetLangName}. Keep keys unchanged. Output ONLY the JSON object.${extraInstructions}` }
        ];

        if (this.settings.debugMode) {
            console.log('[CharManager] [Translation] Request Messages:', JSON.parse(JSON.stringify(messages)));
        }

        let lastError = null;
        const maxRetries = this.settings.retryCount !== undefined ? this.settings.retryCount : 0;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[CharManager] [Translation] Retry attempt ${attempt}/${maxRetries}...`);
                    const isRateLimit = lastError && lastError.message && lastError.message.includes('429');
                    await exponentialBackoff(attempt, 1000, isRateLimit);
                }

                let responseText = '';

                if (this.settings.translationApi === 'openai') {
                    // 使用流式调用（带 onChunk 回调）
                    if (onChunk) {
                        // 确保清理可能残留的 controller（双重保护）
                        if (this.abortController) {
                            this.abortController.abort();
                        }
                        // 创建 AbortController 用于流式调用
                        this.abortController = new AbortController();
                        responseText = await this._callOpenAIStreaming(
                            messages,
                            (chunk) => {
                                // 增量解析
                                const { completePairs } = parseStreamingTranslationChunk(chunk, parserState, expectedKeys, false);
                                
                                // 只在有新完成的字段时才处理
                                const newKeys = Object.keys(completePairs).filter(k => !result[k]);
                                if (newKeys.length === 0) return;
                                
                                // 调试日志：只打印新完成的字段
                                if (this.settings.debugMode) {
                                    const newPairs = {};
                                    newKeys.forEach(k => newPairs[k] = completePairs[k]);
                                    console.log('[CharManager] [Translation] 新完成字段:', newKeys.join(', '));
                                }
                                
                                // 合并到结果
                                Object.assign(result, completePairs);
                                // 回调通知 UI
                                if (onChunk) {
                                    onChunk({
                                        type: 'field_complete',
                                        completedKeys: newKeys,
                                        allKeys: expectedKeys,
                                        partialResult: { ...result }
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

                if (this.settings.debugMode) {
                    console.log('[CharManager] [Translation] Raw Response:', responseText);
                }

                // 如果使用了流式回调，result 已经有部分数据
                // 现在处理最终响应
                let incompleteKeys = [];
                if (onChunk) {
                    // 最终解析（处理剩余缓冲区）
                    const parseResult = parseStreamingTranslationChunk('', parserState, expectedKeys, true);
                    const { completePairs, incompleteKeys: truncatedKeys, errors } = parseResult;
                    incompleteKeys = truncatedKeys;
                    Object.assign(result, completePairs);

                    // 处理未完成的字段（截断时保留 undefined，不填充原文）
                    // 这样 UI 层可以标记为错误状态，用户可以重新翻译
                    for (const key of incompleteKeys) {
                        console.warn(`[Translation] 字段 "${key}" 翻译截断，未返回结果`);
                        // 不填充原文，保持 undefined，让 UI 层标记为错误
                    }

                    // 验证并填充缺失字段：只有当字段确实缺失时才填充原文
                    // 但如果是因为截断导致的缺失（incompleteKeys），不应填充原文
                    for (const key of expectedKeys) {
                        if (result[key] === undefined && !incompleteKeys.includes(key)) {
                            // 只有在 AI 返回中完全缺失该字段时才填充原文
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

                // 简单的验证：确保所有 key 都存在
                // 关键修复：截断的字段不应填充原文
                const keys = Object.keys(dataToTranslate);
                for (const key of keys) {
                    if (result[key] === undefined) {
                        // 如果是流式模式且该字段在 incompleteKeys 中，不填充原文
                        if (onChunk && incompleteKeys.includes(key)) {
                            console.warn(`[CharManager] [Translation] Key '${key}' 因截断无翻译结果，保持空值`);
                            // 保持 undefined，让 UI 层标记为错误
                        } else {
                            // 非流式模式或非截断字段，填充原文
                            console.warn(`[CharManager] [Translation] Key '${key}' missing in response, keeping original.`);
                            result[key] = dataToTranslate[key];
                        }
                    }
                }

                return { data: result, cancelled: false };

            } catch (e) {
                console.error(`[CharManager] [Translation] Error (Attempt ${attempt + 1}):`, e);
                lastError = e;

                // 如果是用户主动中断（关闭翻译界面），直接抛出，不再重试
                if (e.name === 'AbortError' || (e.message && e.message.includes('aborted'))) {
                    console.log('[CharManager] [Translation] Request aborted by user');
                    // 返回已解析的数据，使用明确的结构
                    return { data: { ...dataToTranslate, ...result }, cancelled: true };
                }

                // 如果不是网络错误或 503，可能不需要重试 (视情况而定，这里简单处理都重试)
                if (e.message && (e.message.includes('400') || e.message.includes('401'))) {
                    throw e; // 认证或请求错误不重试
                }
            }
        }

        throw lastError;
    }

    /**
     * 调用 OpenAI Compatible API
     */
    async _callOpenAI(messages) {
        const url = (this.settings.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
        const apiKey = this.settings.openaiApiKey || '';
        const model = this.settings.openaiModel || 'gpt-3.5-turbo';

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };

        const body = {
            model: model,
            messages: messages,
            temperature: 0.7,
            // Gemini 安全设置：禁用所有内容过滤，避免翻译内容被拦截
            safety_settings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
            ]
        };

        // 创建新的 AbortController
        this.abortController = new AbortController();

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body),
                signal: this.abortController.signal
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`OpenAI API Error: ${res.status} - ${txt}`);
            }

            const data = await res.json();
            // 防御性编程：检查 choices 是否存在
            if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                console.error('[CharManager] [Translation] Invalid API response:', JSON.stringify(data).slice(0, 500));
                throw new Error('API 返回数据格式异常：缺少 choices 字段');
            }
            return data.choices[0].message.content;
        } catch (e) {
            // 重新抛出错误，让上层处理
            throw e;
        } finally {
            // 请求完成后（无论成功、失败或中断）清除 controller
            this.abortController = null;
        }
    }

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

    /**
     * 调用酒馆原生 API (通过 /api/chat/completion 或类似接口，这里假设使用 proxy 或直接调用当前后端的 text generation)
     * 注意：SillyTavern 的 API 比较复杂，通常插件会复用现有的连接。
     * 这里为了简化，我们尝试使用 ST 的 generate_chat_completion 接口或者模拟前端发送消息。
     * 但作为插件，最好的方式是复用 window.SillyTavern.getContext().generateText (如果有暴露)
     * 或者调用 /api/generate (Text Completion) / /api/chat/completions (如果后端支持转发)
     * 
     * 由于 ST 插件环境限制，最稳妥的方式是调用 /api/chat/completions (如果连接的是 OAI) 
     * 或者使用 ST 内部的 `generateQuiet` 方法 (如果暴露了)。
     * 
     * 暂时实现为一个通用的 fetch wrapper，尝试调用 ST 的主要生成端点。
     * 如果 ST 连接的是 text completion 模型，prompt 格式需要调整。
     * 为了兼容性，我们假设用户在“翻译设置”里配置了专门的 OpenAI 兼容端点是首选。
     * 
     * 如果必须用“当前酒馆模型”，我们需要 access `SillyTavern.getContext().generateText`.
     */
    async _callTavernAPI(messages) {
        // 尝试获取 ST 上下文中的生成函数
        const ctx = getSTContext();
        
        // 方案 A: 如果是新版 ST，可能暴露了 LLM 交互接口
        // 方案 B: 使用 /api/generate 并手动格式化 prompt (复杂)
        // 方案 C: 强制要求用户配置 OpenAI 兼容端点 (最稳妥)
        
        // 这里暂时实现为调用 /api/chat/completions (假设 ST 后端转发或本地服务支持)
        // 许多 ST 用户使用 OAI 插件或兼容接口。
        
        // 如果 ctx.generateText 存在 (这通常是 text completion)
        if (ctx && typeof ctx.generateText === 'function') {
            // 需要将 messages 转换为 string prompt
            let prompt = '';
            for (const m of messages) {
                prompt += `${m.role.toUpperCase()}: ${m.content}\n`;
            }
            prompt += 'ASSISTANT: ';
            return await ctx.generateText(prompt);
        }

        // Fallback: 尝试调用 extension API 或提示用户配置 OpenAI
        // 实际开发中，酒馆原生协议比较难以在插件中完美复用，除非 hack 内部 API。
        // 为了稳定性，建议 UI 上引导用户填写 "API URL" 和 "Key"。
        // 但为了满足需求 "酒馆原生协议"，我们尝试使用 document.querySelector 发送隐藏消息? 不，太脏了。
        
        // 尝试调用 /api/v1/chat/completions (如果是 text-generation-webui 等后端)
        try {
            return await this._callOpenAI(messages); // 尝试复用，用户可能配置了本地地址
        } catch (e) {
            throw new Error('无法调用酒馆原生 API，请在设置中配置 OpenAI 兼容服务信息。');
        }
    }

    /**
     * 检测是否包含代码混合内容（正则脚本 replaceString、酒馆助手 content）
     * @param {string[]} keys - 需要翻译的键名数组
     * @returns {{ hasRegexReplace: boolean, hasScriptContent: boolean }}
     */
    detectMixedCodeContent(keys) {
        const hasRegexReplace = keys.some(k => k.includes('replaceString'));
        const hasScriptContent = keys.some(k => k.match(/script_.*_content$/));
        return { hasRegexReplace, hasScriptContent };
    }

    /**
     * 公开的 API 调用方法，供外部模块（如术语表扫描器）使用
     * @param {Array<{role: string, content: string}>} messages - 消息数组
     * @returns {Promise<object>} 解析后的 JSON 对象
     */
    async callAPI(messages) {
        // API 配置验证
        if (this.settings.translationApi === 'openai') {
            if (!this.settings.openaiApiKey || !this.settings.openaiApiKey.trim()) {
                throw new Error('未配置 API Key，请在设置中配置 OpenAI 渠道');
            }
            if (!this.settings.openaiBaseUrl || !this.settings.openaiBaseUrl.trim()) {
                throw new Error('未配置 API Base URL，请在设置中配置 OpenAI 渠道');
            }
        }
        
        // 清理上一次请求残留的 controller（防止内存泄漏）
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        if (this.settings.debugMode) {
            console.log('[CharManager] [Translation] API Request:', JSON.parse(JSON.stringify(messages)));
        }

        let lastError = null;
        const maxRetries = this.settings.retryCount !== undefined ? this.settings.retryCount : 0;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[CharManager] [Translation] API Retry attempt ${attempt}/${maxRetries}...`);
                    const isRateLimit = lastError && lastError.message && lastError.message.includes('429');
                    await exponentialBackoff(attempt, 1000, isRateLimit);
                }

                let responseText = '';

                if (this.settings.translationApi === 'openai') {
                    responseText = await this._callOpenAI(messages);
                } else {
                    responseText = await this._callTavernAPI(messages);
                }

                if (this.settings.debugMode) {
                    console.log('[CharManager] [Translation] API Response:', responseText);
                }

                const result = safeParseJson(responseText);
                if (!result) {
                    throw new Error('Failed to parse JSON response from API');
                }
                return result;
            } catch (e) {
                console.error(`[CharManager] [Translation] API Error (Attempt ${attempt + 1}):`, e);
                lastError = e;
                
                if (e.message.includes('400') || e.message.includes('401')) {
                    throw e;
                }
            }
        }

        throw lastError;
    }
}