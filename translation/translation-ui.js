
import { state, saveSettings } from '../state.js';
import { authFetch } from '../api.js';
import { doc, parentWin } from '../context.js';
import { escapeHtml } from '../utils.js';
import { TranslationService } from './translation-service.js';
import { extractTranslatableData, applyTranslation } from './data-extractor.js';
import { writePngText } from './png-writer.js';

// 注入的外部依赖
let _createBaseDialog = null;
let _notify = null;
let _showConfirm = null;

/**
 * 初始化翻译 UI 模块（注入外部依赖）
 */
export function initTranslationUI({ createBaseDialog, notify, showConfirm }) {
    _createBaseDialog = createBaseDialog;
    _notify = notify;
    _showConfirm = showConfirm;
}

// 模块内部状态
let currentTranslationData = null; // 分组的翻译数据
let originalCharData = null;       // 原始角色卡 JSON
let originalPngBuffer = null;      // 原始 PNG ArrayBuffer (用于 PNG 导出)
let service = null;                // TranslationService 实例
let currentChar = null;            // 当前角色对象

// 视图控制状态
let hideEmpty = false;     // 隐藏空字段
let showUnfinished = false; // 仅显示未翻译
let selectedItems = new Set(); // 选中的条目 (格式: "group::key")

const STATUS = { IDLE: 'idle', LOADING: 'loading', SUCCESS: 'success', ERROR: 'error' };
const STATUS_ICONS = { idle: '⚪', loading: '⏳', success: '✅', error: '❌' };

const GROUP_LABELS = {
    basic: '📋 基础信息',
    system: '⚙️ 系统设定',
    greetings: '👋 候补开场白',
    tags: '🏷️ 角色标签',
    lorebook: '📖 世界书'
};

/**
 * 打开翻译界面（外部入口）
 * @param {object} char - 角色对象
 */
export async function openTranslationDialog(char) {
    if (!state.settings.translationEnabled) {
        _notify('请先在设置中启用翻译功能', 'warning');
        return;
    }

    if (!_createBaseDialog) {
        console.error('[Translation] UI 未初始化，请先调用 initTranslationUI');
        return;
    }

    currentChar = char;

    try {
        // 1. 获取完整角色数据
        const getRes = await authFetch('/api/characters/get', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: char.fileName })
        });
        if (!getRes.ok) throw new Error('无法读取角色数据');
        originalCharData = await getRes.json();

        // 2. 尝试获取原始 PNG (用于 PNG 导出)
        try {
            const imgRes = await fetch('/characters/' + encodeURIComponent(char.fileName));
            if (imgRes.ok) {
                originalPngBuffer = await imgRes.arrayBuffer();
            }
        } catch (e) {
            console.warn('[Translation] 无法获取原始 PNG:', e);
            originalPngBuffer = null;
        }

        // 3. 提取可翻译数据
        const rawData = extractTranslatableData(originalCharData);
        currentTranslationData = {};

        // 将纯文本值转换为状态对象
        Object.keys(rawData).forEach(group => {
            currentTranslationData[group] = {};
            Object.keys(rawData[group]).forEach(key => {
                currentTranslationData[group][key] = {
                    original: rawData[group][key],
                    translated: '',
                    status: STATUS.IDLE,
                    error: null
                };
            });
        });

        // 4. 初始化翻译服务
        service = new TranslationService(state.settings);

        // 5. 重置视图控制
        hideEmpty = false;
        showUnfinished = false;
        selectedItems = new Set();

        // 6. 渲染对话框
        renderMainDialog();

    } catch (e) {
        console.error('[Translation]', e);
        _notify('打开翻译界面失败: ' + e.message, 'error');
    }
}

// ========== 渲染主对话框 ==========

function renderMainDialog() {
    const content = buildDialogHTML();

    _createBaseDialog('🌍 角色卡翻译', content, [
        { text: '关闭', id: 'cmTransClose', cls: 'cm-btn-secondary', onClick: (ov, close) => close() }
    ], (ov, close) => {
        // 对话框打开后绑定事件
        const body = ov.querySelector('.cm-tag-editor-body');
        if (body) {
            body.style.padding = '0';
            body.style.overflow = 'hidden';
            body.style.display = 'flex';
            body.style.flexDirection = 'column';
            body.style.height = 'calc(80vh - 120px)';
        }
        bindAllEvents(ov);
    });
}

function buildDialogHTML() {
    const totalCount = countItems('all');
    const selectedCount = selectedItems.size;
    const doneCount = countItems('done');

    return `
        <div class="cm-trans-container" style="display:flex;flex-direction:column;height:100%;overflow:hidden">
            <!-- 顶部工具栏 -->
            <div style="padding:10px 14px;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);flex-shrink:0">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div>
                        <strong style="font-size:14px">${escapeHtml(currentChar.name)}</strong>
                        <span style="font-size:12px;color:var(--cm-text-sec);margin-left:8px">
                            共 ${totalCount} 项 | 已完成 ${doneCount} 项
                        </span>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button id="cmTransSelectAll" class="cm-btn cm-btn-secondary" style="font-size:12px;padding:4px 8px">☑ 全选</button>
                        <button id="cmTransInvertSel" class="cm-btn cm-btn-secondary" style="font-size:12px;padding:4px 8px">🔄 反选</button>
                    </div>
                </div>

                <!-- 筛选控制 -->
                <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
                    <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer">
                        <input type="checkbox" id="cmTransHideEmpty" ${hideEmpty ? 'checked' : ''}> 隐藏空字段
                    </label>
                    <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer">
                        <input type="checkbox" id="cmTransShowUnfinished" ${showUnfinished ? 'checked' : ''}> 仅显示未翻译
                    </label>
                    <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer" title="强制将每个字段拆分为独立 API 请求，防止长文本被截断">
                        <input type="checkbox" id="cmTransSingleMode" ${state.settings.singleGroupMode ? 'checked' : ''}> 防截断模式
                    </label>
                </div>

                <!-- 自定义翻译指导 -->
                <div style="margin-bottom:8px">
                    <details style="font-size:12px">
                        <summary style="cursor:pointer;color:var(--cm-text-sec);user-select:none">📝 自定义翻译指导 (点击展开)</summary>
                        <textarea id="cmTransPromptInput" style="width:100%;box-sizing:border-box;min-height:50px;resize:vertical;
                            background:var(--cm-input-bg);color:var(--cm-text);border:1px solid var(--cm-border);
                            border-radius:4px;padding:6px;font-size:12px;line-height:1.4;font-family:inherit;margin-top:6px"
                            placeholder="例如：请保留古风语气，不要翻译人名，使用中文标点...">${escapeHtml(state.settings.translationPrompt || '')}</textarea>
                    </details>
                </div>

                <!-- 操作按钮 -->
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button id="cmTransRunSelected" class="cm-btn cm-btn-primary" style="font-size:12px">
                        🌍 翻译选中 (${selectedCount})
                    </button>
                    <button id="cmTransRunAll" class="cm-btn cm-btn-secondary" style="font-size:12px">
                        🚀 翻译全部未完成
                    </button>
                    <button id="cmTransExportJson" class="cm-btn cm-btn-success" style="font-size:12px">
                        💾 导出 JSON
                    </button>
                    <button id="cmTransExportPng" class="cm-btn cm-btn-success" style="font-size:12px" ${originalPngBuffer ? '' : 'disabled title="无法获取原始PNG"'}>
                        🖼️ 导出 PNG
                    </button>
                    <button id="cmTransRecover" class="cm-btn cm-btn-secondary" style="font-size:12px">
                        ♻️ 恢复进度
                    </button>
                </div>
            </div>

            <!-- 内容区域 -->
            <div id="cmTransBody" style="flex:1;overflow-y:auto;padding:10px">
                ${buildGroupsHTML()}
            </div>
        </div>
    `;
}

function buildGroupsHTML() {
    let html = '';

    Object.keys(GROUP_LABELS).forEach(groupKey => {
        const groupData = currentTranslationData[groupKey];
        if (!groupData) return;

        const keys = Object.keys(groupData);
        if (keys.length === 0) return;

        // 根据筛选过滤
        const filteredKeys = keys.filter(k => {
            const item = groupData[k];
            if (showUnfinished && item.status === STATUS.SUCCESS) return false;
            return true;
        });

        if (filteredKeys.length === 0) return;

        html += `
            <div class="cm-trans-group" style="margin-bottom:14px;border:1px solid var(--cm-border);border-radius:8px;overflow:hidden">
                <div style="padding:8px 12px;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);display:flex;justify-content:space-between;align-items:center">
                    <span style="font-weight:600;font-size:13px">${GROUP_LABELS[groupKey]} (${filteredKeys.length})</span>
                    <button class="cm-btn cm-btn-secondary cm-trans-group-btn" data-group="${groupKey}" style="font-size:11px;padding:2px 8px">翻译此组</button>
                </div>
                ${filteredKeys.map(k => buildItemHTML(groupKey, k, groupData[k])).join('')}
            </div>
        `;
    });

    if (!html) {
        html = '<div style="text-align:center;padding:40px;color:var(--cm-text-sec)">没有匹配的条目</div>';
    }

    return html;
}

function buildItemHTML(group, key, item) {
    const itemId = `${group}::${key}`;
    const isSelected = selectedItems.has(itemId);
    const statusIcon = STATUS_ICONS[item.status] || STATUS_ICONS.idle;

    // 美化 label
    let label = key;
    if (group === 'basic') {
        const labelMap = {
            name: '角色名', description: '描述', personality: '性格',
            scenario: '场景', first_mes: '开场白', mes_example: '示例对话',
            creator_notes: '作者注释'
        };
        label = labelMap[key] || key;
    } else if (group === 'system') {
        const labelMap = { system_prompt: 'System Prompt', post_history_instructions: '历史后指令' };
        label = labelMap[key] || key;
    } else if (group === 'greetings') {
        label = `开场白 #${parseInt(key.split('_')[1]) + 1}`;
    } else if (group === 'tags') {
        label = `标签 #${parseInt(key.split('_')[1]) + 1}`;
    } else if (group === 'lorebook') {
        const parts = key.split('_');
        const field = parts[parts.length - 1];
        const uid = parts.slice(1, -1).join('_');
        const fieldLabel = field === 'content' ? '内容' : '备注';
        label = `世界书条目 ${uid} [${fieldLabel}]`;
    }

    // 计算 textarea 行数（基于内容长度）
    const origLen = (item.original || '').length;
    const rows = Math.max(2, Math.min(8, Math.ceil(origLen / 80)));

    return `
        <div class="cm-trans-item" data-group="${group}" data-key="${key}" 
             style="padding:8px 12px;border-bottom:1px solid var(--cm-border);${item.status === 'error' ? 'background:rgba(239,68,68,0.05)' : ''}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <input type="checkbox" class="cm-trans-checkbox" data-id="${itemId}" ${isSelected ? 'checked' : ''} 
                       style="width:14px;height:14px;cursor:pointer">
                <span style="font-size:12px;font-weight:500;flex:1">${escapeHtml(label)}</span>
                <span class="cm-trans-status" data-group="${group}" data-key="${key}" 
                      style="cursor:pointer;font-size:14px" title="点击重置状态">${statusIcon}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:stretch">
                <div style="flex:1">
                    <textarea readonly style="width:100%;box-sizing:border-box;min-height:40px;resize:vertical;
                        background:var(--cm-bg-sec);color:var(--cm-text-sec);border:1px solid var(--cm-border);
                        border-radius:4px;padding:6px;font-size:12px;line-height:1.4;font-family:inherit"
                        rows="${rows}">${escapeHtml(item.original)}</textarea>
                </div>
                <div style="display:flex;align-items:center;color:var(--cm-text-sec);font-size:14px;flex-shrink:0">➔</div>
                <div style="flex:1">
                    <textarea class="cm-trans-result" data-group="${group}" data-key="${key}" 
                        style="width:100%;box-sizing:border-box;min-height:40px;resize:vertical;
                        background:var(--cm-input-bg);color:var(--cm-text);
                        border:1px solid ${item.status === 'success' ? '#10b981' : item.status === 'error' ? '#ef4444' : 'var(--cm-border)'};
                        border-radius:4px;padding:6px;font-size:12px;line-height:1.4;font-family:inherit"
                        rows="${rows}" placeholder="翻译结果...">${escapeHtml(item.translated)}</textarea>
                </div>
            </div>
            ${item.error ? `<div style="color:#ef4444;font-size:11px;margin-top:4px">❌ ${escapeHtml(item.error)}</div>` : ''}
        </div>
    `;
}

// ========== 事件绑定 ==========

function bindAllEvents(ov) {
    // 全选
    const selectAllBtn = ov.querySelector('#cmTransSelectAll');
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            const checkboxes = ov.querySelectorAll('.cm-trans-checkbox');
            checkboxes.forEach(cb => {
                selectedItems.add(cb.dataset.id);
                cb.checked = true;
            });
            updateSelectedCount(ov);
        };
    }

    // 反选
    const invertBtn = ov.querySelector('#cmTransInvertSel');
    if (invertBtn) {
        invertBtn.onclick = () => {
            const checkboxes = ov.querySelectorAll('.cm-trans-checkbox');
            checkboxes.forEach(cb => {
                if (selectedItems.has(cb.dataset.id)) {
                    selectedItems.delete(cb.dataset.id);
                    cb.checked = false;
                } else {
                    selectedItems.add(cb.dataset.id);
                    cb.checked = true;
                }
            });
            updateSelectedCount(ov);
        };
    }

    // 筛选
    const hideEmptyCb = ov.querySelector('#cmTransHideEmpty');
    if (hideEmptyCb) {
        hideEmptyCb.onchange = () => {
            hideEmpty = hideEmptyCb.checked;
            refreshBody(ov);
        };
    }
    const showUnfinishedCb = ov.querySelector('#cmTransShowUnfinished');
    if (showUnfinishedCb) {
        showUnfinishedCb.onchange = () => {
            showUnfinished = showUnfinishedCb.checked;
            refreshBody(ov);
        };
    }

    // 防截断模式
    const singleModeCb = ov.querySelector('#cmTransSingleMode');
    if (singleModeCb) {
        singleModeCb.onchange = () => {
            state.settings.singleGroupMode = singleModeCb.checked;
            saveSettings();
        };
    }

    // 自定义翻译指导
    const promptInput = ov.querySelector('#cmTransPromptInput');
    if (promptInput) {
        promptInput.onchange = () => {
            state.settings.translationPrompt = promptInput.value;
            saveSettings();
        };
    }

    // 翻译选中
    const runSelectedBtn = ov.querySelector('#cmTransRunSelected');
    if (runSelectedBtn) {
        runSelectedBtn.onclick = () => runTranslation(ov, 'selected');
    }

    // 翻译全部未完成
    const runAllBtn = ov.querySelector('#cmTransRunAll');
    if (runAllBtn) {
        runAllBtn.onclick = () => runTranslation(ov, 'all');
    }

    // 导出 JSON
    const exportJsonBtn = ov.querySelector('#cmTransExportJson');
    if (exportJsonBtn) {
        exportJsonBtn.onclick = () => doExportJson();
    }

    // 导出 PNG
    const exportPngBtn = ov.querySelector('#cmTransExportPng');
    if (exportPngBtn) {
        exportPngBtn.onclick = () => doExportPng();
    }

    // 恢复进度
    const recoverBtn = ov.querySelector('#cmTransRecover');
    if (recoverBtn) {
        recoverBtn.onclick = () => showRecoverDialog(ov);
    }

    // 组翻译按钮
    ov.querySelectorAll('.cm-trans-group-btn').forEach(btn => {
        btn.onclick = () => {
            const group = btn.dataset.group;
            runTranslation(ov, 'group', group);
        };
    });

    // 绑定动态事件（checkbox、状态图标、翻译结果输入）
    bindDynamicEvents(ov);
}

function bindDynamicEvents(ov) {
    // Checkbox 变化
    ov.querySelectorAll('.cm-trans-checkbox').forEach(cb => {
        cb.onchange = () => {
            if (cb.checked) selectedItems.add(cb.dataset.id);
            else selectedItems.delete(cb.dataset.id);
            updateSelectedCount(ov);
        };
    });

    // 状态图标点击（重置）
    ov.querySelectorAll('.cm-trans-status').forEach(icon => {
        icon.onclick = () => {
            const group = icon.dataset.group;
            const key = icon.dataset.key;
            if (currentTranslationData[group] && currentTranslationData[group][key]) {
                currentTranslationData[group][key].status = STATUS.IDLE;
                currentTranslationData[group][key].error = null;
                icon.textContent = STATUS_ICONS.idle;
                // 更新边框色
                const textarea = ov.querySelector(`.cm-trans-result[data-group="${group}"][data-key="${key}"]`);
                if (textarea) textarea.style.borderColor = 'var(--cm-border)';
            }
        };
    });

    // 翻译结果手动编辑
    ov.querySelectorAll('.cm-trans-result').forEach(ta => {
        ta.onchange = () => {
            const group = ta.dataset.group;
            const key = ta.dataset.key;
            if (currentTranslationData[group] && currentTranslationData[group][key]) {
                currentTranslationData[group][key].translated = ta.value;
                if (ta.value.trim()) {
                    currentTranslationData[group][key].status = STATUS.SUCCESS;
                    ta.style.borderColor = '#10b981';
                    const icon = ov.querySelector(`.cm-trans-status[data-group="${group}"][data-key="${key}"]`);
                    if (icon) icon.textContent = STATUS_ICONS.success;
                }
            }
        };
    });
}

function updateSelectedCount(ov) {
    const btn = ov.querySelector('#cmTransRunSelected');
    if (btn) btn.textContent = `🌍 翻译选中 (${selectedItems.size})`;
}

function refreshBody(ov) {
    const body = ov.querySelector('#cmTransBody');
    if (body) {
        body.innerHTML = buildGroupsHTML();
        bindDynamicEvents(ov);
    }
}

// ========== 翻译逻辑 ==========

async function runTranslation(ov, mode, groupFilter) {
    // 收集任务
    const tasks = [];

    Object.keys(currentTranslationData).forEach(group => {
        if (mode === 'group' && group !== groupFilter) return;

        const groupData = currentTranslationData[group];
        Object.keys(groupData).forEach(key => {
            const item = groupData[key];
            const itemId = `${group}::${key}`;

            if (mode === 'selected') {
                if (!selectedItems.has(itemId)) return;
            }
            if (mode === 'all' || mode === 'group') {
                if (item.status === STATUS.SUCCESS) return; // 跳过已完成
            }

            tasks.push({ group, key });
        });
    });

    if (tasks.length === 0) {
        _notify('没有需要翻译的条目', 'info');
        return;
    }

    // 确保服务使用最新设置
    service.updateSettings(state.settings);

    const charContext = {
        name: currentChar.name,
        description: currentTranslationData.basic?.description?.original || '',
        personality: currentTranslationData.basic?.personality?.original || ''
    };

    const isSingleMode = state.settings.singleGroupMode;

    if (isSingleMode) {
        // 防截断模式：逐个翻译
        for (const task of tasks) {
            await translateSingleItem(ov, task.group, task.key, charContext);
            await new Promise(r => setTimeout(r, 300)); // 防速率限制
        }
    } else {
        // 按组合并翻译
        const grouped = {};
        tasks.forEach(t => {
            if (!grouped[t.group]) grouped[t.group] = [];
            grouped[t.group].push(t.key);
        });

        for (const group of Object.keys(grouped)) {
            await translateGroup(ov, group, grouped[group], charContext);
        }
    }

    _notify('翻译完成', 'success');
}

async function translateSingleItem(ov, group, key, charContext) {
    const item = currentTranslationData[group][key];
    setItemStatus(ov, group, key, STATUS.LOADING);

    try {
        const dataToTranslate = { [key]: item.original };
        const result = await service.translate(dataToTranslate, charContext);

        if (result[key]) {
            item.translated = result[key];
            item.status = STATUS.SUCCESS;
            item.error = null;
            updateItemUI(ov, group, key);
        } else {
            throw new Error('翻译结果缺失');
        }
    } catch (e) {
        item.status = STATUS.ERROR;
        item.error = e.message;
        updateItemUI(ov, group, key);
    }
}

async function translateGroup(ov, group, keys, charContext) {
    // 更新所有状态为 loading
    keys.forEach(k => setItemStatus(ov, group, k, STATUS.LOADING));

    const dataToTranslate = {};
    keys.forEach(k => {
        dataToTranslate[k] = currentTranslationData[group][k].original;
    });

    try {
        const result = await service.translate(dataToTranslate, charContext);

        keys.forEach(k => {
            const item = currentTranslationData[group][k];
            if (result[k]) {
                item.translated = result[k];
                item.status = STATUS.SUCCESS;
                item.error = null;
            } else {
                item.status = STATUS.ERROR;
                item.error = '翻译结果缺失';
            }
            updateItemUI(ov, group, k);
        });
    } catch (e) {
        keys.forEach(k => {
            currentTranslationData[group][k].status = STATUS.ERROR;
            currentTranslationData[group][k].error = e.message;
            updateItemUI(ov, group, k);
        });
    }
}

function setItemStatus(ov, group, key, status) {
    const item = currentTranslationData[group][key];
    item.status = status;
    const icon = ov.querySelector(`.cm-trans-status[data-group="${group}"][data-key="${key}"]`);
    if (icon) icon.textContent = STATUS_ICONS[status];
}

function updateItemUI(ov, group, key) {
    const item = currentTranslationData[group][key];

    // 更新状态图标
    const icon = ov.querySelector(`.cm-trans-status[data-group="${group}"][data-key="${key}"]`);
    if (icon) {
        icon.textContent = STATUS_ICONS[item.status];
        icon.title = item.error || item.status;
    }

    // 更新翻译结果
    const textarea = ov.querySelector(`.cm-trans-result[data-group="${group}"][data-key="${key}"]`);
    if (textarea) {
        textarea.value = item.translated || '';
        if (item.status === STATUS.SUCCESS) textarea.style.borderColor = '#10b981';
        else if (item.status === STATUS.ERROR) textarea.style.borderColor = '#ef4444';
        else textarea.style.borderColor = 'var(--cm-border)';
    }

    // 更新错误提示
    const itemEl = ov.querySelector(`.cm-trans-item[data-group="${group}"][data-key="${key}"]`);
    if (itemEl) {
        const existingErr = itemEl.querySelector('.cm-trans-err-msg');
        if (existingErr) existingErr.remove();
        if (item.error) {
            const errDiv = doc.createElement('div');
            errDiv.className = 'cm-trans-err-msg';
            errDiv.style.cssText = 'color:#ef4444;font-size:11px;margin-top:4px';
            errDiv.textContent = '❌ ' + item.error;
            itemEl.appendChild(errDiv);
        }
        itemEl.style.background = item.status === 'error' ? 'rgba(239,68,68,0.05)' : '';
    }
}

// ========== 导出逻辑 ==========

function buildTranslatedCharData() {
    const flatTranslated = {};
    Object.keys(currentTranslationData).forEach(group => {
        flatTranslated[group] = {};
        Object.keys(currentTranslationData[group]).forEach(key => {
            const item = currentTranslationData[group][key];
            flatTranslated[group][key] = item.translated || item.original;
        });
    });
    return applyTranslation(originalCharData, flatTranslated);
}

function doExportJson() {
    try {
        const newCharData = buildTranslatedCharData();
        const jsonStr = JSON.stringify(newCharData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        downloadBlob(blob, `${currentChar.name}_translated.json`);
        _notify('JSON 已导出', 'success');
    } catch (e) {
        _notify('导出失败: ' + e.message, 'error');
    }
}

function doExportPng() {
    if (!originalPngBuffer) {
        _notify('无法获取原始 PNG 数据', 'error');
        return;
    }

    try {
        const newCharData = buildTranslatedCharData();
        const jsonStr = JSON.stringify(newCharData);
        // SillyTavern 使用 Base64 编码的 JSON 存储在 tEXt 块中
        const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));
        const pngBlob = writePngText(originalPngBuffer, 'chara', base64Data);
        downloadBlob(pngBlob, `${currentChar.name}_translated.png`);
        _notify('PNG 已导出（含角色数据）', 'success');
    } catch (e) {
        console.error('[Translation] PNG Export Error:', e);
        _notify('PNG 导出失败: ' + e.message, 'error');
    }
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    setTimeout(() => {
        doc.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// ========== 进度恢复 ==========

function showRecoverDialog(ov) {
    const recoverContent = `
        <div style="padding:10px">
            <p style="font-size:13px;margin-bottom:10px;color:var(--cm-text)">
                粘贴之前翻译界面的 HTML 源代码以恢复进度。<br>
                <small style="color:var(--cm-text-sec)">提示：在翻译表格中右键 → 检查元素 → 复制外层 HTML</small>
            </p>
            <textarea id="cmRecoverInput" style="width:100%;height:200px;box-sizing:border-box;
                background:var(--cm-input-bg);color:var(--cm-text);border:1px solid var(--cm-border);
                border-radius:4px;padding:8px;font-family:monospace;font-size:11px;resize:vertical"
                placeholder="在此粘贴 HTML 源代码..."></textarea>
        </div>
    `;

    _createBaseDialog('♻️ 恢复翻译进度', recoverContent, [
        { text: '取消', id: 'cmRecoverCancel', cls: 'cm-btn-secondary', onClick: (rovl, close) => close() },
        { text: '恢复', id: 'cmRecoverOk', cls: 'cm-btn-primary', onClick: (rovl, close) => {
            const input = rovl.querySelector('#cmRecoverInput');
            if (!input || !input.value.trim()) {
                _notify('请粘贴 HTML 内容', 'warning');
                return;
            }
            try {
                recoverFromHTML(input.value, ov);
                close();
                _notify('进度已恢复', 'success');
            } catch (e) {
                _notify('恢复失败: ' + e.message, 'error');
            }
        }}
    ]);
}

function recoverFromHTML(htmlStr, mainOv) {
    // 解析 HTML 字符串
    const parser = new DOMParser();
    const parsed = parser.parseFromString(htmlStr, 'text/html');

    // 查找所有翻译结果 textarea
    const textareas = parsed.querySelectorAll('.cm-trans-result, textarea[data-group][data-key]');
    let recoveredCount = 0;

    textareas.forEach(ta => {
        const group = ta.getAttribute('data-group') || ta.dataset.group;
        const key = ta.getAttribute('data-key') || ta.dataset.key;
        const value = ta.value || ta.textContent || '';

        if (group && key && value.trim() && currentTranslationData[group] && currentTranslationData[group][key]) {
            currentTranslationData[group][key].translated = value.trim();
            currentTranslationData[group][key].status = STATUS.SUCCESS;
            recoveredCount++;
        }
    });

    // 同时尝试解析 checkbox 状态
    const checkboxes = parsed.querySelectorAll('.cm-trans-checkbox');
    checkboxes.forEach(cb => {
        const id = cb.getAttribute('data-id') || cb.dataset.id;
        if (id && cb.checked) {
            selectedItems.add(id);
        }
    });

    if (recoveredCount === 0) {
        throw new Error('未能从 HTML 中恢复任何翻译数据');
    }

    // 刷新主界面
    refreshBody(mainOv);
    console.log(`[Translation] 已恢复 ${recoveredCount} 条翻译`);
}

// ========== 辅助函数 ==========

function countItems(mode) {
    let count = 0;
    Object.keys(currentTranslationData).forEach(group => {
        Object.keys(currentTranslationData[group]).forEach(key => {
            const item = currentTranslationData[group][key];
            if (mode === 'all') count++;
            else if (mode === 'done' && item.status === STATUS.SUCCESS) count++;
        });
    });
    return count;
}