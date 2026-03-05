import { doc } from './context.js';
import { state } from './state.js';
import { ICONS, Z_INDEX } from './constants.js';
import { escapeHtml, notify } from './utils.js';

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