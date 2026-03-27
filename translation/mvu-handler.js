/**
 * MVU (MagVarUpdate) 框架翻译处理器
 * 
 * MVU 框架在角色卡中的结构：
 * - tavern_helper.scripts 中包含 Schema 定义（z.object({...})）
 * - regex_scripts 的 replaceString 中包含 _.get(vars, 'path') 变量引用
 * - 世界书词条中可能包含变量引用
 * 
 * 翻译时必须保证：
 * 1. Schema 中的变量 key（字段名）不被翻译
 * 2. 所有通过 _.get(vars, 'path') 引用的变量路径不被翻译
 * 3. .describe('...') 中的描述文本可以翻译
 * 4. .prefault('...') 中的默认值可以翻译（自然语言部分）
 * 5. UI 渲染脚本中的显示文本可以翻译，但变量引用路径保持一致
 */

/**
 * 检测角色卡是否使用了 MVU 框架
 * @param {object} charData - 角色卡数据
 * @returns {boolean} 是否使用 MVU
 */
export function detectMVU(charData) {
    const data = charData.data || charData;
    const ext = data.extensions || {};
    
    // 检查酒馆助手脚本中是否有 MVU 相关导入
    if (ext.tavern_helper && Array.isArray(ext.tavern_helper.scripts)) {
        for (const script of ext.tavern_helper.scripts) {
            if (!script.content) continue;
            
            // 检测 MVU 导入语句
            if (/MagVarUpdate|registerMvuSchema|mvu_zod/i.test(script.content)) {
                return true;
            }
            
            // 检测 z.object 定义（Zod schema）
            if (/z\.object\s*\(\s*\{/.test(script.content) && /\.describe\s*\(/.test(script.content)) {
                return true;
            }
        }
    }
    
    // 检查正则脚本中是否引用了 getAllVariables / stat_data
    if (Array.isArray(ext.regex_scripts)) {
        for (const script of ext.regex_scripts) {
            const content = script.replaceString || '';
            if (/getAllVariables|stat_data|waitGlobalInitialized\s*\(\s*['"]Mvu['"]\s*\)/.test(content)) {
                return true;
            }
        }
    }
    
    return false;
}

/**
 * 从 MVU Schema 脚本中提取变量路径映射
 * 解析 z.object({...}) 结构，提取所有嵌套的变量 key
 * 
 * @param {object} charData - 角色卡数据
 * @returns {object} MVU 分析结果
 *   - varPaths: string[] — 所有变量路径（如 ['时间', '时间.朝代', '时间.金庸小说', ...]）
 *   - schemaScriptIds: string[] — 包含 Schema 定义的脚本 ID
 *   - renderScriptIds: string[] — 包含变量渲染的正则脚本 ID
 *   - lockedPaths: Set<string> — 被 _.get() 引用的路径（必须锁定）
 */
export function analyzeMVUStructure(charData) {
    const data = charData.data || charData;
    const ext = data.extensions || {};
    
    const result = {
        varPaths: [],
        schemaScriptIds: [],
        renderScriptIds: [],
        lockedPaths: new Set()
    };
    
    // 1. 从酒馆助手脚本中提取 Schema 变量路径
    if (ext.tavern_helper && Array.isArray(ext.tavern_helper.scripts)) {
        for (const script of ext.tavern_helper.scripts) {
            if (!script.content) continue;
            
            // 检测是否是 Schema 定义脚本
            if (/z\.object\s*\(\s*\{/.test(script.content) && /\.describe\s*\(/.test(script.content)) {
                result.schemaScriptIds.push(script.id || script.name);
                
                // 提取变量路径
                const paths = extractZodPaths(script.content);
                result.varPaths.push(...paths);
            }
        }
    }
    
    // 2. 从正则脚本中提取 _.get() 引用的变量路径
    if (Array.isArray(ext.regex_scripts)) {
        for (const script of ext.regex_scripts) {
            const content = script.replaceString || '';
            
            // 检测 _.get(vars, 'path') 或 _.get(getAllVariables(), 'stat_data') 等
            if (/_.get\s*\(/.test(content)) {
                result.renderScriptIds.push(script.id || script.scriptName);
                
                // 提取所有 _.get 引用路径
                const getMatches = content.matchAll(/_.get\s*\(\s*(?:vars|[^,]+)\s*,\s*['"]([^'"]+)['"]/g);
                for (const m of getMatches) {
                    let path = m[1];
                    // 去除 stat_data. 前缀（如果有）
                    path = path.replace(/^stat_data\./, '');
                    result.lockedPaths.add(path);
                    
                    // 也锁定路径中的每一层
                    const parts = path.split('.');
                    let current = '';
                    for (const part of parts) {
                        current = current ? `${current}.${part}` : part;
                        result.lockedPaths.add(current);
                    }
                }
            }
            
            // 检测 jQuery 选择器中的 ID 引用（如 $('#wx-time')）
            // 这些 ID 不需要锁定，但可作为参考
        }
    }
    
    // 合并 Schema 路径到 lockedPaths
    for (const path of result.varPaths) {
        result.lockedPaths.add(path);
    }
    
    return result;
}

/**
 * 从 Zod Schema 代码中提取嵌套的变量 key 路径
 * 解析类似 z.object({ 时间: z.object({ 朝代: z.string()... }) }) 的结构
 * 
 * @param {string} code - 包含 z.object({...}) 的 JS 代码
 * @returns {string[]} 变量路径列表
 */
function extractZodPaths(code) {
    const paths = [];
    
    // 使用简化的解析：提取所有被 z.object/z.string/z.number 等定义的 key
    // 匹配模式：key名: z.xxx (包括中文 key)
    // 注意：这不是一个完整的 JS 解析器，但足以处理典型的 MVU Schema
    
    // 策略：逐级提取 z.object 的 key
    // 先找到最外层 Schema = z.object({...})
    const schemaMatch = code.match(/(?:const|let|var|export\s+const)\s+\w+\s*=\s*z\.object\s*\(\s*\{/);
    if (!schemaMatch) {
        // 尝试匹配没有变量声明的 z.object
        if (!/z\.object\s*\(\s*\{/.test(code)) return paths;
    }
    
    // 提取所有 "key: z." 模式的 key 名
    // 支持中文 key、英文 key、带引号的 key
    const keyPattern = /(?:^|\n)\s*(?:['"]?)([\w\u4e00-\u9fff\u3040-\u30ff]+)(?:['"]?)\s*:\s*z\./gm;
    const allKeys = [];
    let m;
    while ((m = keyPattern.exec(code)) !== null) {
        allKeys.push(m[1]);
    }
    
    // 构建嵌套路径
    // 分析代码的嵌套结构来确定路径
    try {
        buildNestedPaths(code, '', paths);
    } catch (e) {
        // 如果嵌套解析失败，至少返回顶层 key
        console.warn('[MVU Handler] 嵌套路径解析失败，使用平面 key:', e);
        paths.push(...allKeys);
    }
    
    return [...new Set(paths)]; // 去重
}

/**
 * 递归构建嵌套变量路径
 * @param {string} code - 代码片段
 * @param {string} prefix - 当前路径前缀
 * @param {string[]} paths - 结果路径列表
 */
function buildNestedPaths(code, prefix, paths) {
    // 查找 z.object({ 的位置
    const objectPattern = /(?:['"]?)([\w\u4e00-\u9fff\u3040-\u30ff]+)(?:['"]?)\s*:\s*z\.object\s*\(\s*\{/g;
    const simplePattern = /(?:['"]?)([\w\u4e00-\u9fff\u3040-\u30ff]+)(?:['"]?)\s*:\s*z\.(?:string|number|coerce\.number|boolean|enum|record|array)/g;
    
    let m;
    
    // 提取简单类型的 key
    while ((m = simplePattern.exec(code)) !== null) {
        const key = m[1];
        const fullPath = prefix ? `${prefix}.${key}` : key;
        paths.push(fullPath);
    }
    
    // 提取嵌套对象的 key，并递归
    const objRegex = /(?:['"]?)([\w\u4e00-\u9fff\u3040-\u30ff]+)(?:['"]?)\s*:\s*z\.object\s*\(\s*\{/g;
    while ((m = objRegex.exec(code)) !== null) {
        const key = m[1];
        const fullPath = prefix ? `${prefix}.${key}` : key;
        paths.push(fullPath);
        
        // 提取这个 z.object({...}) 的内部内容
        const startIdx = m.index + m[0].length;
        const innerContent = extractBalancedBraces(code, startIdx);
        if (innerContent) {
            buildNestedPaths(innerContent, fullPath, paths);
        }
    }
}

/**
 * 从给定位置提取平衡花括号内的内容
 * @param {string} code - 完整代码
 * @param {number} startIdx - 开始搜索的位置（{ 之后）
 * @returns {string|null} 花括号内的内容
 */
function extractBalancedBraces(code, startIdx) {
    let depth = 1;
    let i = startIdx;
    
    while (i < code.length && depth > 0) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
        
        // 跳过字符串
        if (code[i] === "'" || code[i] === '"' || code[i] === '`') {
            const quote = code[i];
            i++;
            while (i < code.length && code[i] !== quote) {
                if (code[i] === '\\') i++; // 跳过转义字符
                i++;
            }
        }
        
        i++;
    }
    
    if (depth === 0) {
        return code.substring(startIdx, i - 1);
    }
    return null;
}

/**
 * 为 MVU 框架内容生成翻译保护指令
 * 生成附加到翻译 prompt 中的变量保护规则
 * 
 * @param {object} mvuAnalysis - analyzeMVUStructure 的返回结果
 * @returns {string} 翻译保护指令文本
 */
export function generateMVUProtectionPrompt(mvuAnalysis) {
    if (!mvuAnalysis || mvuAnalysis.lockedPaths.size === 0) return '';
    
    const lockedList = [...mvuAnalysis.lockedPaths].sort();
    
    return `

⚠️ MVU FRAMEWORK VARIABLE PROTECTION ⚠️
This character card uses the MVU (MagVarUpdate) variable framework.
The following variable paths are referenced by the rendering system and MUST NOT be translated:

Locked variable paths (DO NOT translate these as keys in z.object({})):
${lockedList.map(p => `  - "${p}"`).join('\n')}

Rules for MVU content:
1. In z.object({...}) Schema definitions:
   - DO NOT translate the object KEYS (variable names like 时间, 地理, 武学, etc.)
   - DO translate .describe('...') string contents
   - DO translate .prefault('...') string contents (if natural language)
   - DO NOT translate .prefault({}) empty objects or technical defaults
2. In _.get(vars, 'path') calls:
   - DO NOT translate the path string
   - DO translate surrounding UI text labels
3. In HTML templates:
   - DO translate visible text (labels, headers, descriptions)
   - DO NOT translate element IDs, CSS classes, JavaScript variable names
4. The variable key names in Schema MUST exactly match the paths used in _.get() calls.
   Any mismatch will break the variable system.`;
}

/**
 * 预处理 MVU 脚本内容，标记不可翻译的部分
 * 在发送给翻译 AI 之前，用特殊标记包裹变量名，防止被翻译
 * 
 * @param {string} content - 原始脚本内容
 * @param {Set<string>} lockedPaths - 被锁定的变量路径集合
 * @returns {object} { processed: string, markers: Map } 处理后的内容和标记映射
 */
export function preprocessMVUContent(content, lockedPaths) {
    if (!content || !lockedPaths || lockedPaths.size === 0) {
        return { processed: content, markers: new Map() };
    }
    
    let processed = content;
    const markers = new Map();
    let markerIndex = 0;
    
    // 1. 保护 _.get(vars, 'path') 中的路径
    processed = processed.replace(
        /(_.get\s*\(\s*(?:vars|[^,]+)\s*,\s*['"])([^'"]+)(['"])/g,
        (match, prefix, path, suffix) => {
            const marker = `__MVU_PATH_${markerIndex++}__`;
            markers.set(marker, path);
            return `${prefix}${marker}${suffix}`;
        }
    );
    
    // 2. 保护 z.object({...}) 中的 key 名
    // 匹配 "keyName: z." 模式的 key
    processed = processed.replace(
        /((?:^|\n)\s*)([\w\u4e00-\u9fff\u3040-\u30ff]+)(\s*:\s*z\.)/gm,
        (match, leading, key, trailing) => {
            if (lockedPaths.has(key)) {
                const marker = `__MVU_KEY_${markerIndex++}__`;
                markers.set(marker, key);
                return `${leading}${marker}${trailing}`;
            }
            return match;
        }
    );
    
    return { processed, markers };
}

/**
 * 后处理翻译结果，恢复被标记保护的变量名
 * 
 * @param {string} translated - 翻译后的内容
 * @param {Map} markers - preprocessMVUContent 返回的标记映射
 * @returns {string} 恢复后的内容
 */
export function postprocessMVUContent(translated, markers) {
    if (!translated || !markers || markers.size === 0) {
        return translated;
    }
    
    let result = translated;
    for (const [marker, original] of markers) {
        // 使用全局替换，以防 AI 复制了多个标记
        result = result.replaceAll(marker, original);
    }
    
    return result;
}