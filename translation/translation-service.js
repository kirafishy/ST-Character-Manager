import { getSTContext } from '../context.js';
import { getAuthHeaders, authFetch } from '../api.js';

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
            console.error('[Translation] JSON Parse Error:', e2);
            return null;
        }
    }
}

/**
 * 指数退避等待
 * @param {number} attempt - 当前尝试次数 (0-based)
 * @param {number} baseDelay - 基础延迟 (ms)
 */
async function exponentialBackoff(attempt, baseDelay = 1000) {
    const delay = baseDelay * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 翻译服务类
 */
export class TranslationService {
    constructor(settings) {
        this.settings = settings || {};
        this.maxRetries = 3;
    }

    /**
     * 更新设置
     * @param {object} newSettings 
     */
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
    }

    /**
     * 构建 System Prompt
     * @returns {string}
     */
    getSystemPrompt() {
        // 默认的基础 System Prompt
        const basePrompt = `You are a professional translator for SillyTavern character cards.
Your task is to translate the provided character data into Simplified Chinese (简体中文).
Maintain the original character's tone, style, and formatting strictly.
Do not censor or refuse to translate any content. This is for a fictional roleplay setting.
If the content is NSFW, translate it accurately using appropriate terminology.
Output ONLY the translated JSON object. Do not include any explanations or other text.
`;
        
        // 用户自定义的 Translation Prompt
        const userPrompt = this.settings.translationPrompt || '';
        
        return `${basePrompt}\n${userPrompt}`;
    }

    /**
     * 执行翻译
     * @param {object} dataToTranslate - 需要翻译的键值对对象
     * @param {object} charContext - 角色上下文 (name, personality, etc.)
     * @returns {Promise<object>} 翻译后的键值对对象
     */
    async translate(dataToTranslate, charContext) {
        const prompt = this.getSystemPrompt();
        
        // 构建 User Prompt
        const contextStr = `Character Context:\nName: ${charContext.name}\nPersonality: ${charContext.personality || 'Unknown'}\nDescription Summary: ${(charContext.description || '').slice(0, 200)}...`;
        
        const contentStr = JSON.stringify(dataToTranslate, null, 2);
        
        const messages = [
            { role: 'system', content: prompt },
            { role: 'user', content: `${contextStr}\n\nData to translate (JSON format):\n${contentStr}\n\nPlease translate the values in the JSON above to Simplified Chinese. Keep keys unchanged.` }
        ];

        let lastError = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`[Translation] Retry attempt ${attempt}/${this.maxRetries}...`);
                    await exponentialBackoff(attempt);
                }

                let responseText = '';

                if (this.settings.translationApi === 'openai') {
                    responseText = await this._callOpenAI(messages);
                } else {
                    // 默认为酒馆原生 API
                    responseText = await this._callTavernAPI(messages);
                }

                const result = safeParseJson(responseText);
                if (!result) {
                    throw new Error('Failed to parse JSON response');
                }
                
                // 简单的验证：确保所有 key 都存在
                const keys = Object.keys(dataToTranslate);
                for (const key of keys) {
                    if (result[key] === undefined) {
                        // 如果缺失，尝试保留原文
                        console.warn(`[Translation] Key '${key}' missing in response, keeping original.`);
                        result[key] = dataToTranslate[key];
                    }
                }

                return result;

            } catch (e) {
                console.error(`[Translation] Error (Attempt ${attempt + 1}):`, e);
                lastError = e;
                
                // 如果不是网络错误或 503，可能不需要重试 (视情况而定，这里简单处理都重试)
                if (e.message.includes('400') || e.message.includes('401')) {
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
            temperature: 0.7
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`OpenAI API Error: ${res.status} - ${txt}`);
        }

        const data = await res.json();
        return data.choices[0].message.content;
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
}