import { doc } from './context.js';
import { state } from './state.js';
import { ICONS, Z_INDEX } from './constants.js';
import { escapeHtml, notify } from './utils.js';
import manifest from './manifest.json' with { type: 'json' };

export function createBaseDialog(title, bodyContent, footerButtons = [], onOpen = null, options = {}) {
    const { stack = false } = options;
    if (!stack) {
        const existing = doc.querySelector('.cm-tag-editor-overlay');
        if (existing) existing.remove();
    }

    const ov = doc.createElement('div');
    ov.className = state.isDarkMode ? 'cm-tag-editor-overlay cm-theme-dark' : 'cm-tag-editor-overlay cm-theme-light';

    let footerHtml = '';
    if (footerButtons.length > 0) {
        footerHtml = '<div class="cm-tag-editor-footer">';
        footerButtons.forEach(btn => {
            footerHtml += '<button class="cm-btn ' + (btn.cls || 'cm-btn-secondary') + '" id="' + btn.id + '">' + btn.text + '</button>';
        });
        footerHtml += '</div>';
    }

    ov.innerHTML =
        '<div class="cm-tag-editor">' +
        '<div class="cm-tag-editor-header"><h3>' + escapeHtml(title) + '</h3><button class="cm-tag-editor-close">' + ICONS.close + '</button></div>' +
        '<div class="cm-tag-editor-body">' + bodyContent + '</div>' +
        footerHtml +
        '</div>';

    doc.body.appendChild(ov);

    const close = () => ov.remove();
    ov.querySelector('.cm-tag-editor-close').onclick = close;
    ov.onclick = (e) => { if (e.target === ov) close(); };

    footerButtons.forEach(btn => {
        const el = ov.querySelector('#' + btn.id);
        if (el && btn.onClick) {
            el.onclick = () => btn.onClick(ov, close);
        }
    });

    if (onOpen) onOpen(ov, close);
    return ov;
}

export function showAlert(msg) {
    return new Promise(resolve => {
        createBaseDialog('提示', '<div style="padding:10px;text-align:center">' + escapeHtml(msg) + '</div>', [
            { text: '确定', id: 'cmAlertOk', cls: 'cm-btn-primary', onClick: (ov, close) => { close(); resolve(); } }
        ], null, { stack: true });
    });
}

export function showConfirm(msg) {
    return new Promise(resolve => {
        createBaseDialog('确认', '<div style="padding:10px;text-align:left;white-space:pre-wrap;line-height:1.5">' + escapeHtml(msg) + '</div>', [
            { text: '取消', id: 'cmConfirmCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => { close(); resolve(false); } },
            { text: '确定', id: 'cmConfirmOk', cls: 'cm-btn-primary', onClick: (ov, close) => { close(); resolve(true); } }
        ], null, { stack: true });
    });
}

export function showDeleteConfirm(count, wiCount) {
    return new Promise(resolve => {
        let html = `<div style="padding:10px 14px">`;
        html += `<div style="font-size:14px;margin-bottom:12px">确定要删除选中的 <b>${count}</b> 个角色吗？</div>`;
        
        html += `<div style="display:flex;flex-direction:column;gap:8px">`;
        
        // 聊天记录选项
        html += `<div style="padding:10px;background:var(--cm-bg-ter);border-radius:6px;border:1px solid var(--cm-border)">`;
        html += `<label style="display:flex;align-items:center;cursor:pointer;font-size:13px">`;
        html += `<input type="checkbox" id="cmDelChatCb" style="width:16px;height:16px;margin-right:8px">`;
        html += `<span>同时删除聊天记录</span>`;
        html += `</label>`;
        html += `</div>`;

        // 世界书选项
        if (wiCount > 0) {
            html += `<div style="padding:10px;background:var(--cm-bg-ter);border-radius:6px;border:1px solid var(--cm-border)">`;
            html += `<label style="display:flex;align-items:center;cursor:pointer;font-size:13px">`;
            html += `<input type="checkbox" id="cmDelWiCb" checked style="width:16px;height:16px;margin-right:8px">`;
            html += `<span>同时删除 <b>${wiCount}</b> 个关联世界书</span>`;
            html += `</label>`;
            html += `<div style="font-size:11px;color:var(--cm-text-sec);margin-top:4px;margin-left:24px;opacity:0.8">智能检测：仅删除未被其他角色使用的世界书</div>`;
            html += `</div>`;
        }
        
        html += `</div>`; // end flex col
        html += `</div>`; // end padding container

        createBaseDialog('删除确认', html, [
            { text: '取消', id: 'cmDelCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => { close(); resolve({ ok: false }); } },
            {
                text: '确定删除', id: 'cmDelOk', cls: 'cm-btn-danger', onClick: (ov, close) => {
                    const wiCb = ov.querySelector('#cmDelWiCb');
                    const chatCb = ov.querySelector('#cmDelChatCb');
                    const delWi = wiCb ? wiCb.checked : false;
                    const delChats = chatCb ? chatCb.checked : false;
                    close();
                    resolve({ ok: true, delWi, delChats });
                }
            }
        ], null, { stack: true });
    });
}

/**
 * 显示批量 AI 标签结果弹窗
 * @param {object} result - 处理结果对象
 * @param {number} result.success - 成功数量
 * @param {number} result.errors - 失败数量
 * @param {Array<{name: string, success: boolean, error?: string}>} result.details - 详细信息数组
 * @returns {Promise<void>}
 */
/**
 * 显示批量 AI 标签结果弹窗
 * @param {object} result - 处理结果对象
 * @param {number} result.success - 成功数量
 * @param {number} result.errors - 失败数量
 * @param {Array<{name: string, success: boolean, error?: string}>} [result.details] - 详细信息数组
 * @returns {Promise<void>}
 */
export function showBatchResultModal(result) {
    return new Promise(resolve => {
        const total = result.success + result.errors;
        const hasErrors = result.errors > 0;
        // P2: 增加 details 默认化处理，增强健壮性
        const details = Array.isArray(result.details) ? result.details : [];
        
        const ov = doc.createElement('div');
        ov.className = state.isDarkMode
            ? 'cm-tag-editor-overlay cm-theme-dark'
            : 'cm-tag-editor-overlay cm-theme-light';
        ov.style.zIndex = String(Z_INDEX.DYNAMIC_OVERLAY_MAX);
        
        ov.innerHTML = `
            <div class="cm-tag-editor cm-batch-result-modal">
                <div class="cm-tag-editor-header">
                    <h3>📊 批量 AI 标签完成</h3>
                    <button class="cm-tag-editor-close">×</button>
                </div>
                
                <div class="cm-tag-editor-body">
                    <!-- 摘要统计 -->
                    <div class="cm-batch-summary">
                        <div class="cm-batch-stat success">
                            <span class="cm-stat-icon">✅</span>
                            <span class="cm-stat-label">成功</span>
                            <span class="cm-stat-value">${result.success}</span>
                        </div>
                        <div class="cm-batch-stat error">
                            <span class="cm-stat-icon">❌</span>
                            <span class="cm-stat-label">失败</span>
                            <span class="cm-stat-value">${result.errors}</span>
                        </div>
                        <div class="cm-batch-stat total">
                            <span class="cm-stat-icon">📁</span>
                            <span class="cm-stat-label">总计</span>
                            <span class="cm-stat-value">${total}</span>
                        </div>
                    </div>
                    
                    <!-- 折叠详情 -->
                    <div class="cm-batch-details-section">
                        <button class="cm-batch-toggle-btn" aria-expanded="false">
                            <span class="cm-toggle-icon">▼</span>
                            <span class="cm-toggle-text">查看详情</span>
                            <span class="cm-toggle-count">(${total} 个角色)</span>
                        </button>
                        
                        <div class="cm-batch-details-content" hidden>
                            ${result.success > 0 ? `
                            <div class="cm-batch-list-section">
                                <h4 class="cm-batch-list-title success">
                                    ✅ 成功列表 <small>(${result.success})</small>
                                </h4>
                                <div class="cm-batch-list" id="cm-batch-success-list">
                                    ${details
                                        .filter(d => d.success)
                                        .map(d => `
                                            <div class="cm-batch-item success">
                                                <span class="cm-batch-item-icon">✅</span>
                                                <span class="cm-batch-item-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
                                            </div>
                                        `).join('')}
                                </div>
                            </div>
                            ` : ''}
                            
                            ${hasErrors ? `
                            <div class="cm-batch-list-section">
                                <h4 class="cm-batch-list-title error">
                                    ❌ 失败列表 <small>(${result.errors})</small>
                                </h4>
                                <div class="cm-batch-list" id="cm-batch-error-list">
                                    ${details
                                        .filter(d => !d.success)
                                        .map(d => `
                                            <div class="cm-batch-item error">
                                                <span class="cm-batch-item-icon">❌</span>
                                                <span class="cm-batch-item-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
                                                <span class="cm-batch-item-error" title="${escapeHtml(d.error || '未知错误')}">${escapeHtml(d.error || '未知错误')}</span>
                                            </div>
                                        `).join('')}
                                </div>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
                
                <div class="cm-tag-editor-footer">
                    ${hasErrors ? `
                    <button class="cm-btn cm-btn-secondary" id="cm-batch-copy-fail">复制失败列表</button>
                    ` : ''}
                    <button class="cm-btn cm-btn-secondary" id="cm-batch-export">导出结果</button>
                    <button class="cm-btn cm-btn-primary" id="cm-batch-ok">确定</button>
                </div>
            </div>
        `;
        
        doc.body.appendChild(ov);
        
        const closePopup = () => {
            ov.remove();
            resolve();
        };
        
        // 关闭按钮
        ov.querySelector('.cm-tag-editor-close').onclick = closePopup;
        ov.onclick = (e) => { if (e.target === ov) closePopup(); };
        
        // 确定按钮
        ov.querySelector('#cm-batch-ok').onclick = closePopup;
        
        // 折叠/展开按钮
        const toggleBtn = ov.querySelector('.cm-batch-toggle-btn');
        const detailsContent = ov.querySelector('.cm-batch-details-content');
        
        toggleBtn.onclick = () => {
            const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
            toggleBtn.setAttribute('aria-expanded', String(!isExpanded));
            detailsContent.hidden = isExpanded;
        };
        
        // 复制失败列表 - P1: 增加剪贴板 API 能力探测
        const copyFailBtn = ov.querySelector('#cm-batch-copy-fail');
        if (copyFailBtn) {
            copyFailBtn.onclick = () => {
                const failedNames = details
                    .filter(d => !d.success)
                    .map(d => `${d.name}: ${d.error || '未知错误'}`)
                    .join('\n');
                
                // P1: 检查剪贴板 API 是否可用
                if (navigator?.clipboard?.writeText) {
                    navigator.clipboard.writeText(failedNames).then(() => {
                        notify('失败列表已复制到剪贴板', 'success');
                    }).catch((e) => {
                        console.error('[CharManager] 复制失败:', e);
                        notify('复制失败，请手动选择复制', 'error');
                    });
                } else {
                    // 降级方案：提示用户
                    notify('当前环境不支持剪贴板 API，请手动复制', 'warning');
                }
            };
        }
        
        // 导出结果
        const exportBtn = ov.querySelector('#cm-batch-export');
        exportBtn.onclick = () => {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const content = [
                `批量 AI 标签结果 - ${timestamp}`,
                `========================`,
                `总计：${total} 个角色`,
                `成功：${result.success} 个`,
                `失败：${result.errors} 个`,
                ``,
                `--- 成功列表 ---`,
                ...details.filter(d => d.success).map(d => `✅ ${d.name}`),
                ``,
                `--- 失败列表 ---`,
                ...details.filter(d => !d.success).map(d => `❌ ${d.name} - ${d.error || '未知错误'}`)
            ].join('\n');
            
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = doc.createElement('a');
            a.href = url;
            a.download = `批量 AI 标签结果-${timestamp}.txt`;
            a.click();
            URL.revokeObjectURL(url);
            
            notify('结果已导出', 'success');
        };
    });
}

/**
 * 敏感字段列表 - 这些字段的内容会在错误报告中被脱敏处理
 * 遵循中文社区创作者的保护要求
 */
const SENSITIVE_FIELDS = [
    // 角色卡核心内容
    'desc', 'description', 'personality',
    'first_mes', 'first_message', 'firstMes',
    'scenario', 'system_prompt', 'systemPrompt',
    'post_history_instructions', 'postHistoryInstructions',
    'creator_notes', 'creatorNotes', 'creatorcomment',
    // 开场白
    'alternate_greetings', 'alternateGreetings', 'alt_greetings',
    'greetings', 'greeting',
    // 世界书
    'character_book', 'characterBook', 'world_info',
    'entries', 'keys', 'secondary_keys', 'content',
    // 扩展字段
    'extensions', 'data', 'mes_example', 'mesExample',
    // 其他可能的敏感内容
    'tags', 'tag_list'
];

/**
 * 脱敏处理上下文对象
 * 递归遍历对象，将敏感字段的值替换为占位符
 * @param {any} obj - 要处理的对象
 * @param {number} depth - 当前递归深度
 * @returns {any} - 脱敏后的对象
 */
function sanitizeContext(obj, depth = 0) {
    // 防止无限递归
    if (depth > 10) return '[最大深度限制]';
    
    // 处理 null 和 undefined
    if (obj === null) return null;
    if (obj === undefined) return undefined;
    
    // 处理基本类型
    if (typeof obj !== 'object') {
        // 字符串脱敏：超过 50 字符只显示前后各 10 字符
        if (typeof obj === 'string' && obj.length > 50) {
            return `[字符串已脱敏，长度: ${obj.length}]`;
        }
        return obj;
    }
    
    // 处理数组
    if (Array.isArray(obj)) {
        // 数组超过 20 个元素只显示前 3 个
        if (obj.length > 20) {
            return {
                _sanitized: true,
                _type: 'array',
                _length: obj.length,
                _preview: obj.slice(0, 3).map(item => sanitizeContext(item, depth + 1))
            };
        }
        return obj.map(item => sanitizeContext(item, depth + 1));
    }
    
    // 处理对象
    const result = {};
    for (const key of Object.keys(obj)) {
        const lowerKey = key.toLowerCase().replace(/_/g, '');
        
        // 检查是否是敏感字段
        // 匹配策略：精确匹配 > 后缀匹配 > 前缀匹配，避免过于宽泛的包含匹配
        const isSensitive = SENSITIVE_FIELDS.some(field => {
            const lowerField = field.toLowerCase().replace(/_/g, '');
            // 1. 精确匹配
            if (lowerKey === lowerField) return true;
            // 2. 后缀匹配：如 first_mes, my_first_mes 等
            if (lowerKey.endsWith('_' + lowerField)) return true;
            // 3. 前缀匹配：如 desc_v2, description_short 等（限定前缀场景）
            if (lowerKey.startsWith(lowerField + '_')) return true;
            return false;
        });
        
        if (isSensitive) {
            const value = obj[key];
            if (value === null || value === undefined) {
                result[key] = value;
            } else if (typeof value === 'string') {
                // 字符串：显示长度和类型
                result[key] = `[已脱敏，长度: ${value.length} 字符]`;
            } else if (Array.isArray(value)) {
                // 数组：显示长度
                result[key] = `[已脱敏，数组，${value.length} 个元素]`;
            } else if (typeof value === 'object') {
                // 对象：显示键名
                result[key] = `[已脱敏，对象，包含: ${Object.keys(value).slice(0, 5).join(', ')}${Object.keys(value).length > 5 ? '...' : ''}]`;
            } else {
                result[key] = `[已脱敏，类型: ${typeof value}]`;
            }
        } else {
            // 非敏感字段：递归处理
            result[key] = sanitizeContext(obj[key], depth + 1);
        }
    }
    return result;
}

/**
 * 显示详细错误报告弹窗（支持一键复制）
 * 用于移动端用户无法查看 console 时获取详细错误信息
 * @param {object} options - 配置选项
 * @param {string} options.title - 弹窗标题
 * @param {string} options.message - 简短错误消息
 * @param {Error|string} options.error - 错误对象或详细错误信息
 * @param {object} [options.context] - 附加上下文信息（如出错的 JSON 片段）
 * @returns {Promise<void>}
 */
export function showErrorReport(options) {
    return new Promise(resolve => {
        const { title = '错误报告', message, error, context } = options;
        
        // 构建完整错误报告文本
        const timestamp = new Date().toISOString();
        const errorStack = error instanceof Error
            ? `${error.message}\n${error.stack || ''}`
            : String(error || '');
        
        const reportLines = [
            `=== 错误报告 ===`,
            `时间: ${timestamp}`,
            `插件版本: ${manifest.version || 'unknown'}`,
            ``,
            `=== 错误消息 ===`,
            message,
            ``,
            `=== 详细错误 ===`,
            errorStack,
        ];
        
        if (context) {
            reportLines.push(``, `=== 上下文信息 ===`);
            reportLines.push(`（敏感数据已脱敏处理，保护创作者版权）`);
            if (typeof context === 'object') {
                try {
                    // 对上下文对象进行脱敏处理
                    const sanitizedContext = sanitizeContext(context);
                    reportLines.push(JSON.stringify(sanitizedContext, null, 2));
                } catch (e) {
                    reportLines.push(String(context));
                }
            } else {
                reportLines.push(String(context));
            }
        }
        
        const fullReport = reportLines.join('\n');
        
        // 构建 HTML
        const bodyHtml = `
            <div style="padding:12px">
                <div style="margin-bottom:12px;padding:10px;background:var(--cm-bg-ter);border-radius:6px;border-left:3px solid #e74c3c">
                    <div style="font-weight:600;color:#e74c3c;margin-bottom:4px">错误消息</div>
                    <div style="font-size:13px;color:var(--cm-text)">${escapeHtml(message)}</div>
                </div>
                
                <div style="margin-bottom:12px">
                    <div style="font-weight:600;margin-bottom:6px;font-size:13px">详细错误信息</div>
                    <textarea id="cmErrorReportText" readonly style="width:100%;height:180px;padding:8px;font-family:monospace;font-size:12px;background:var(--cm-bg-ter);color:var(--cm-text);border:1px solid var(--cm-border);border-radius:6px;resize:vertical">${escapeHtml(fullReport)}</textarea>
                </div>
                
                <div style="font-size:12px;color:var(--cm-text-sec);margin-bottom:12px">
                    💡 请点击下方按钮复制错误信息，然后发送给开发者以便排查问题
                </div>
            </div>
        `;
        
        const ov = doc.createElement('div');
        ov.className = state.isDarkMode
            ? 'cm-tag-editor-overlay cm-theme-dark'
            : 'cm-tag-editor-overlay cm-theme-light';
        ov.style.zIndex = String(Z_INDEX.DYNAMIC_OVERLAY_MAX);
        
        ov.innerHTML = `
            <div class="cm-tag-editor" style="max-width:500px">
                <div class="cm-tag-editor-header">
                    <h3>❌ ${escapeHtml(title)}</h3>
                    <button class="cm-tag-editor-close">×</button>
                </div>
                <div class="cm-tag-editor-body">${bodyHtml}</div>
                <div class="cm-tag-editor-footer">
                    <button class="cm-btn cm-btn-secondary" id="cmErrorClose">关闭</button>
                    <button class="cm-btn cm-btn-primary" id="cmErrorCopy">📋 一键复制</button>
                </div>
            </div>
        `;
        
        doc.body.appendChild(ov);
        
        const close = () => {
            ov.remove();
            resolve();
        };
        
        ov.querySelector('.cm-tag-editor-close').onclick = close;
        ov.querySelector('#cmErrorClose').onclick = close;
        ov.onclick = (e) => { if (e.target === ov) close(); };
        
        // 一键复制功能
        ov.querySelector('#cmErrorCopy').onclick = async () => {
            try {
                await navigator.clipboard.writeText(fullReport);
                notify('错误信息已复制到剪贴板', 'success');
            } catch (e) {
                // 降级方案：选中文本
                const textarea = ov.querySelector('#cmErrorReportText');
                textarea.select();
                textarea.setSelectionRange(0, 99999);
                try {
                    doc.execCommand('copy');
                    notify('错误信息已复制到剪贴板', 'success');
                } catch (e2) {
                    notify('复制失败，请手动选择文本复制', 'error');
                }
            }
        };
    });
}