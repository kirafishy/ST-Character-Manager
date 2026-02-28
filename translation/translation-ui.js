import { state, saveSettings } from '../state.js';
import { authFetch } from '../api.js';
import { doc, parentWin, getSTContext, getSTCharacters } from '../context.js';
import { escapeHtml } from '../utils.js';
import { TranslationService } from './translation-service.js';
import { extractTranslatableData, applyTranslation } from './data-extractor.js';
import { writePngText } from './png-writer.js';
import { t } from './i18n.js';
import { scanAndFilterGlossary } from './glossary-scanner.js';
import { detectMVU, analyzeMVUStructure, generateMVUProtectionPrompt, preprocessMVUContent, postprocessMVUContent } from './mvu-handler.js';
import { showTranslationSettingsDialog } from '../settings.js';
import { Z_INDEX } from '../constants.js';

// 注入的外部依赖
let _createBaseDialog = null;
let _notify = null;
let _showConfirm = null;
let _scan = null;
let _importFiles = null;
let _updateCharacter = null;
let _refreshSingleCard = null;

/**
 * 初始化翻译 UI 模块（注入外部依赖）
 */
export function initTranslationUI({ createBaseDialog, notify, showConfirm, scan, importFiles, updateCharacter, refreshSingleCard }) {
    _createBaseDialog = createBaseDialog;
    _notify = notify;
    _showConfirm = showConfirm;
    _scan = scan;
    _importFiles = importFiles;
    _updateCharacter = updateCharacter;
    _refreshSingleCard = refreshSingleCard;
}

// 模块内部状态
let currentTranslationData = null; // 分组的翻译数据
let originalCharData = null;       // 原始角色卡 JSON
let originalPngBuffer = null;      // 原始 PNG ArrayBuffer (用于 PNG 导出)
let service = null;                // TranslationService 实例
let currentChar = null;            // 当前角色对象
let glossaryData = [];             // 术语表数据
let isGlossaryEditing = false;     // 术语表是否处于编辑模式
let mvuAnalysis = null;            // MVU 框架分析结果（如果检测到）
let isDirty = false;               // 是否有未保存的翻译进度

// 视图控制状态
let hideEmpty = false;
let showUnfinished = false;
let selectedItems = new Set();

const STATUS = { IDLE: 'idle', LOADING: 'loading', SUCCESS: 'success', ERROR: 'error' };
const STATUS_ICONS = { idle: '⚪', loading: '⏳', success: '✅', error: '❌' };

const GROUP_LABELS = {
    basic: '📋 基础信息',
    system: '⚙️ 系统设定',
    greetings: '👋 候补开场白',
    tags: '🏷️ 角色标签',
    lorebook: '📖 世界书',
    regex: '🔧 正则脚本',
    scripts: '📜 酒馆助手脚本'
};

// 获取本地化的分组标签
function getGroupLabel(key) {
    const lang = state.settings.translationUILanguage || 'zh-CN';
    if (lang === 'en') {
        const enLabels = {
            basic: '📋 Basic Info',
            system: '⚙️ System Prompt',
            greetings: '👋 Alternate Greetings',
            tags: '🏷️ Tags',
            lorebook: '📖 Lorebook',
            regex: '🔧 Regex Scripts',
            script: '📜 Helper Scripts'
        };
        return enLabels[key] || GROUP_LABELS[key] || key;
    }
    return GROUP_LABELS[key] || key;
}

/**
 * 打开翻译界面（外部入口）
 * @param {object} char - 角色对象
 */
export async function openTranslationDialog(char) {
    if (!state.settings.translationEnabled) {
        _notify(t('emptySelectCard'), 'warning');
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
        console.log('[Translation Debug] source post_history_instructions', {
            file: char.fileName,
            root: originalCharData?.post_history_instructions,
            data: originalCharData?.data?.post_history_instructions,
            extensions: originalCharData?.data?.extensions?.post_history_instructions
                || originalCharData?.extensions?.post_history_instructions
        });

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
        console.log('[Translation Debug] extracted system fields', {
            system_keys: rawData?.system ? Object.keys(rawData.system) : [],
            system_prompt: rawData?.system?.system_prompt,
            post_history_instructions: rawData?.system?.post_history_instructions
        });
        currentTranslationData = {};

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
        glossaryData = [];
        isDirty = false;

        // 6. 检查 tags 翻译提示
        const hasTags = rawData.tags && Object.keys(rawData.tags).length > 0;
        const syncDisabled = !state.settings.autoSyncTags; // 同步开关关闭
        if (hasTags && syncDisabled) {
            const lang = state.settings.translationUILanguage || 'zh-CN';
            const warningMsg = lang === 'en'
                ? 'Tag translations will not appear in ST native card. Enable "Sync plugin tags to native tags" in settings.'
                : '"同步插件标签到原生标签"设置未开启，当前标签翻译结果无法在酒馆原生角色卡中生效';
            _notify(warningMsg, 'warning');
        }

        // 7. 渲染对话框
        renderMainDialog();

    } catch (e) {
        console.error('[Translation]', e);
        _notify(t('notifyTranslationError', { error: e.message }), 'error');
    }
}

// ========== 渲染主对话框 ==========

function handleClose(ov, originalClose) {
    if (!isDirty) {
        originalClose();
        return;
    }

    const confirmHtml = `
        <div class="cm-trans-confirm-body" style="padding: 10px;">
            <p style="margin-bottom: 8px;">${t('confirmCloseUnsaved')}</p>
            <p style="font-size: 0.9em; opacity: 0.8;">${t('confirmCloseTip')}</p>
        </div>
    `;

    _createBaseDialog(`⚠️ ${t('dialogTitle')}`, confirmHtml, [
        {
            text: t('btnSaveProgressAndClose'),
            id: 'cmTransConfirmSave',
            cls: 'cm-btn-primary',
            onClick: (dlg, closeDlg) => {
                doExportProgress();
                isDirty = false;
                closeDlg();
                originalClose();
            }
        },
        {
            text: t('btnDiscardAndClose'),
            id: 'cmTransConfirmDiscard',
            cls: 'cm-btn-danger',
            onClick: (dlg, closeDlg) => {
                isDirty = false;
                closeDlg();
                originalClose();
            }
        },
        {
            text: t('cancel'),
            id: 'cmTransConfirmCancel',
            cls: 'cm-btn-secondary',
            onClick: (dlg, closeDlg) => closeDlg()
        }
    ], null, { stack: true });
}

function renderMainDialog() {
    const content = buildDialogHTML();

    _createBaseDialog(`🌍 ${t('dialogTitle')}`, content, [
        { text: t('close'), id: 'cmTransClose', cls: 'cm-btn-secondary', onClick: (ov, close) => handleClose(ov, close) }
    ], (ov, close) => {
        // 将对话框标记为翻译全宽模式
        ov.classList.add('cm-trans-fullwidth');

        // 拦截点击外侧关闭
        ov.onclick = (e) => {
            if (e.target === ov) handleClose(ov, close);
        };

        // 拦截右上角关闭按钮
        const topClose = ov.querySelector('.cm-tag-editor-close');
        if (topClose) {
            topClose.onclick = (e) => {
                e.stopPropagation();
                handleClose(ov, close);
            };
        }

        const body = ov.querySelector('.cm-tag-editor-body');
        if (body) {
            body.style.padding = '0';
            body.style.overflow = 'hidden';
            body.style.display = 'flex';
            body.style.flexDirection = 'column';
            body.style.minHeight = '0';
        }
        bindAllEvents(ov);
    });
}

function buildDialogHTML() {
    const totalCount = countItems('all');
    const selectedCount = selectedItems.size;
    const doneCount = countItems('done');
    const failedCount = countItems('failed');
    const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    return `
        <div class="cm-trans-container">
            <!-- 顶部工具栏（紧凑布局） -->
            <div class="cm-trans-toolbar">
                <!-- 第一行：角色信息 + 统计 + 选择 + 筛选 -->
                <div class="cm-trans-toolbar-row" style="flex-wrap:wrap">
                    <div class="cm-trans-char-info">
                        <span class="cm-trans-char-name">${escapeHtml(currentChar.name)}</span>
                        <div class="cm-trans-stats">
                            <span class="cm-trans-stat-badge cm-trans-stat-total">${totalCount}</span>
                            <span class="cm-trans-stat-badge cm-trans-stat-done">✅${doneCount}</span>
                            ${failedCount > 0 ? `<span class="cm-trans-stat-badge cm-trans-stat-failed">❌${failedCount}</span>` : ''}
                        </div>
                    </div>
                    <div class="cm-trans-filter-group">
                        <label class="cm-trans-filter-label">
                            <input type="checkbox" id="cmTransHideEmpty" ${hideEmpty ? 'checked' : ''}>
                            ${t('close') === 'Close' ? 'Hide Empty' : '隐藏空'}
                        </label>
                        <label class="cm-trans-filter-label">
                            <input type="checkbox" id="cmTransShowUnfinished" ${showUnfinished ? 'checked' : ''}>
                            ${t('close') === 'Close' ? 'Pending Only' : '仅未译'}
                        </label>
                        <label class="cm-trans-filter-label" title="${t('close') === 'Close' ? 'Force single-field API calls to prevent truncation' : '强制将每个字段拆分为独立 API 请求，防止长文本被截断'}">
                            <input type="checkbox" id="cmTransSingleMode" ${state.settings.singleGroupMode ? 'checked' : ''}>
                            ${t('close') === 'Close' ? 'Anti-trunc' : '防截断'}
                        </label>
                    </div>
                    <div style="display:flex;gap:4px">
                        <button id="cmTransSelectAll" class="cm-trans-btn">☑ ${t('close') === 'Close' ? 'All' : '全选'}</button>
                        <button id="cmTransInvertSel" class="cm-trans-btn">🔄 ${t('close') === 'Close' ? 'Inv' : '反选'}</button>
                    </div>
                </div>

                <!-- 第二行：操作按钮 + 翻译指导 -->
                <div class="cm-trans-actions">
                    <button id="cmTransRunSelected" class="cm-trans-btn cm-trans-btn-primary">
                        🌍 ${t('close') === 'Close' ? `Translate Selected (${selectedCount})` : `翻译选中 (${selectedCount})`}
                    </button>
                    <button id="cmTransRunAll" class="cm-trans-btn cm-trans-btn-primary">
                        🚀 ${t('close') === 'Close' ? 'Translate All Pending' : '翻译全部未完成'}
                    </button>

                    <button id="cmTransScanGlossary" class="cm-trans-btn cm-trans-btn-warning">
                        🔍 ${t('btnScanGlossary')}
                    </button>

                    <button id="cmTransSettingsBtn" class="cm-trans-btn cm-trans-btn-secondary">
                        ⚙️ ${t('btnSettings')}
                    </button>

                    <!-- 进度管理下拉菜单 -->
                    <div class="cm-trans-dropdown">
                        <button class="cm-trans-btn cm-trans-btn-warning">
                            ♻️ ${t('btnProgressMenu')} ▾
                        </button>
                        <div class="cm-trans-dropdown-menu">
                            <div class="cm-trans-dropdown-menu-inner">
                                <button class="cm-trans-dropdown-item" id="cmTransExportProgress">
                                    ${t('menuExportProgress')}
                                </button>
                                <button class="cm-trans-dropdown-item" id="cmTransImportProgress">
                                    ${t('menuImportProgress')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- 保存卡片下拉菜单 -->
                    <div class="cm-trans-dropdown cm-trans-dropdown-right">
                        <button class="cm-trans-btn cm-trans-btn-success">
                            💾 ${t('btnSaveMenu')} ▾
                        </button>
                        <div class="cm-trans-dropdown-menu">
                            <div class="cm-trans-dropdown-menu-inner">
                                <button class="cm-trans-dropdown-item" id="cmTransOverwrite">
                                    ${t('menuOverwriteOriginal')}
                                </button>
                                <button class="cm-trans-dropdown-item" id="cmTransImportNew">
                                    ${t('menuImportAsNew')}
                                </button>
                                <button class="cm-trans-dropdown-item" id="cmTransExportPng" ${originalPngBuffer ? '' : 'disabled'}>
                                    ${t('menuExportPNG')}
                                </button>
                                <button class="cm-trans-dropdown-item" id="cmTransExportJson">
                                    ${t('menuExportJSON')}
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- 翻译指导（内联折叠） -->
                    <details class="cm-trans-prompt-panel" style="flex-basis:100%;margin-top:2px" open>
                        <summary>📝 ${t('close') === 'Close' ? 'Translation Guidance' : '翻译指导'}</summary>
                        <textarea id="cmTransPromptInput" class="cm-trans-prompt-textarea"
                            placeholder="${t('close') === 'Close' ? 'e.g.: Keep archaic tone, do not translate names...' : '例如：请保留古风语气，不要翻译人名，使用中文标点...'}">${escapeHtml(state.settings.translationPrompt || '')}</textarea>
                    </details>
                </div>
            </div>

            <!-- 术语表面板 -->
            <div id="cmTransGlossaryPanel" class="cm-trans-glossary-panel" style="display:none;margin:0 12px">
                <div class="cm-trans-glossary-header" id="cmTransGlossaryToggle">
                    <span class="cm-trans-glossary-title">📖 ${t('glossaryTitle')} (<span id="cmTransGlossaryCount">0</span>)</span>
                    <div style="display:flex;gap:4px" id="cmTransGlossaryControls">
                        <!-- 动态渲染按钮 -->
                    </div>
                </div>
                <div class="cm-trans-glossary-body" id="cmTransGlossaryBody">
                    <p style="font-size:10px;color:var(--cm-text-sec);margin:2px 0 6px 0">${t('glossaryDescription')}</p>
                    <div class="cm-trans-glossary-grid" id="cmTransGlossaryGrid"></div>
                </div>
            </div>

            <!-- 进度条 -->
            <div class="cm-trans-progress">
                <div class="cm-trans-progress-bar" style="width:${percent}%"></div>
            </div>

            <!-- 分隔线 -->
            <div class="cm-trans-divider"></div>

            <!-- 内容区域 -->
            <div id="cmTransBody" class="cm-trans-body">
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

        const filteredKeys = keys.filter(k => {
            const item = groupData[k];
            if (showUnfinished && item.status === STATUS.SUCCESS) return false;
            return true;
        });

        if (filteredKeys.length === 0) return;

        const groupDone = filteredKeys.filter(k => groupData[k].status === STATUS.SUCCESS).length;

        html += `
            <div class="cm-trans-group">
                <div class="cm-trans-group-header">
                    <span class="cm-trans-group-title">
                        ${getGroupLabel(groupKey)}
                        <span class="cm-trans-group-count">${groupDone}/${filteredKeys.length}</span>
                    </span>
                    <button class="cm-trans-btn cm-trans-group-btn" data-group="${groupKey}" style="font-size:11px;padding:3px 8px">
                        ${t('close') === 'Close' ? 'Translate Group' : '翻译此组'}
                    </button>
                </div>
                ${filteredKeys.map(k => buildItemHTML(groupKey, k, groupData[k])).join('')}
            </div>
        `;
    });

    if (!html) {
        html = `
            <div class="cm-trans-empty">
                <div class="cm-trans-empty-icon">📭</div>
                <div>${t('emptyNoData')}</div>
            </div>
        `;
    }

    return html;
}

function buildItemHTML(group, key, item) {
    const itemId = `${group}::${key}`;
    const isSelected = selectedItems.has(itemId);
    const statusIcon = STATUS_ICONS[item.status] || STATUS_ICONS.idle;

    // 美化 label
    let label = key;
    const isEn = (state.settings.translationUILanguage === 'en');
    
    if (group === 'basic') {
        const labelMap = isEn
            ? { name: 'Name', description: 'Description', personality: 'Personality', scenario: 'Scenario', first_mes: 'First Message', mes_example: 'Example Dialogue', creator_notes: 'Creator Notes' }
            : { name: '角色名', description: '描述', personality: '性格', scenario: '场景', first_mes: '开场白', mes_example: '示例对话', creator_notes: '作者注释' };
        label = labelMap[key] || key;
    } else if (group === 'system') {
        const labelMap = isEn
            ? { system_prompt: 'System Prompt', post_history_instructions: 'Post-History Instructions' }
            : { system_prompt: 'System Prompt', post_history_instructions: '历史后指令' };
        label = labelMap[key] || key;
    } else if (group === 'greetings') {
        label = isEn ? `Greeting #${parseInt(key.split('_')[1]) + 1}` : `开场白 #${parseInt(key.split('_')[1]) + 1}`;
    } else if (group === 'tags') {
        label = key === 'tags_all' ? (isEn ? 'All Tags' : '全部标签') : (isEn ? `Tag #${parseInt(key.split('_')[1]) + 1}` : `标签 #${parseInt(key.split('_')[1]) + 1}`);
    } else if (group === 'lorebook') {
        const parts = key.split('_');
        const field = parts[parts.length - 1];
        const uid = parts.slice(1, -1).join('_');
        const fieldLabel = isEn ? (field === 'content' ? 'Content' : 'Comment') : (field === 'content' ? '内容' : '备注');
        label = isEn ? `Entry ${uid} [${fieldLabel}]` : `世界书条目 ${uid} [${fieldLabel}]`;
    } else if (group === 'scripts') {
        // script_{uid}_{field} or script_{uid}_btn_{idx}_name
        const parts = key.split('_');
        if (parts.length >= 4 && parts[parts.length - 2] === 'btn') {
            // Button name
            const uid = parts.slice(1, -3).join('_');
            label = isEn ? `Script ${uid} [Button]` : `脚本 ${uid} [按钮]`;
        } else {
            const field = parts[parts.length - 1];
            const uid = parts.slice(1, -1).join('_');
            const fieldMap = isEn
                ? { name: 'Name', content: 'Content', info: 'Info' }
                : { name: '名称', content: '内容', info: '说明' };
            label = isEn ? `Script ${uid} [${fieldMap[field]||field}]` : `脚本 ${uid} [${fieldMap[field]||field}]`;
        }
    } else if (group === 'regex') {
        const parts = key.split('_');
        const field = parts[parts.length - 1];
        const uid = parts.slice(1, -1).join('_');
        const fieldMap = isEn
            ? { scriptName: 'Script Name', replaceString: 'Replacement Pattern' }
            : { scriptName: '脚本名称', replaceString: '替换内容' };
        label = isEn ? `Regex ${uid} [${fieldMap[field]||field}]` : `正则 ${uid} [${fieldMap[field]||field}]`;
    }

    const origLen = (item.original || '').length;
    const rows = Math.max(2, Math.min(8, Math.ceil(origLen / 80)));
    const statusClass = item.status === 'success' ? 'cm-trans-item-success' : item.status === 'error' ? 'cm-trans-item-error' : item.status === 'loading' ? 'cm-trans-item-loading' : '';

    return `
        <div class="cm-trans-item ${statusClass}" data-group="${group}" data-key="${key}">
            <div class="cm-trans-item-header">
                <input type="checkbox" class="cm-trans-item-checkbox cm-trans-checkbox" data-id="${itemId}" ${isSelected ? 'checked' : ''}>
                <span class="cm-trans-item-label">${escapeHtml(label)}</span>
                <span class="cm-trans-status-icon cm-trans-status" data-group="${group}" data-key="${key}"
                      title="${t('close') === 'Close' ? 'Click to toggle status' : '点击切换翻译状态'}">${statusIcon}</span>
            </div>
            <div class="cm-trans-row">
                <div class="cm-trans-col">
                    <textarea readonly class="cm-trans-textarea cm-trans-textarea-original"
                        rows="${rows}">${escapeHtml(item.original)}</textarea>
                </div>
                <div class="cm-trans-arrow">➔</div>
                <div class="cm-trans-col">
                    <textarea class="cm-trans-textarea cm-trans-textarea-translated cm-trans-result" 
                        data-group="${group}" data-key="${key}" 
                        rows="${rows}" placeholder="${t('close') === 'Close' ? 'Translation result...' : '翻译结果...'}">${escapeHtml(item.translated)}</textarea>
                </div>
            </div>
            ${item.error ? `<div class="cm-trans-error-msg">❌ ${escapeHtml(item.error)}</div>` : ''}
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
        singleModeCb.onchange = async () => {
            // 如果是开启防截断模式，需要确认
            if (singleModeCb.checked) {
                const confirmed = await _showConfirm(t('confirmAntiTruncation'));
                if (!confirmed) {
                    singleModeCb.checked = false;
                    return;
                }
            }
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

    // === 进度下拉菜单 ===
    const exportProgressBtn = ov.querySelector('#cmTransExportProgress');
    if (exportProgressBtn) {
        exportProgressBtn.onclick = () => doExportProgress();
    }

    const importProgressBtn = ov.querySelector('#cmTransImportProgress');
    if (importProgressBtn) {
        importProgressBtn.onclick = () => doImportProgress(ov);
    }

    // === 术语表扫描 ===
    const scanGlossaryBtn = ov.querySelector('#cmTransScanGlossary');
    if (scanGlossaryBtn) {
        scanGlossaryBtn.onclick = () => doScanGlossary(ov);
    }

    // === 翻译设置 ===
    const settingsBtn = ov.querySelector('#cmTransSettingsBtn');
    if (settingsBtn) {
        settingsBtn.onclick = () => {
            showTranslationSettingsDialog(_createBaseDialog, _notify, () => {
                service = new TranslationService(state.settings);
            });
        };
    }

    const glossaryToggle = ov.querySelector('#cmTransGlossaryToggle');
    if (glossaryToggle) {
        glossaryToggle.onclick = (e) => {
            if (e.target.closest('button') || e.target.closest('input')) return;
            const body = ov.querySelector('#cmTransGlossaryBody');
            if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
        };
    }

    // === 保存卡片下拉菜单 ===
    const overwriteBtn = ov.querySelector('#cmTransOverwrite');
    if (overwriteBtn) {
        overwriteBtn.onclick = () => doOverwriteOriginal(ov);
    }

    const importNewBtn = ov.querySelector('#cmTransImportNew');
    if (importNewBtn) {
        importNewBtn.onclick = () => doImportAsNew(ov);
    }

    const exportPngBtn = ov.querySelector('#cmTransExportPng');
    if (exportPngBtn) {
        exportPngBtn.onclick = () => doExportPng();
    }

    const exportJsonBtn = ov.querySelector('#cmTransExportJson');
    if (exportJsonBtn) {
        exportJsonBtn.onclick = () => doExportJson();
    }

    // 组翻译按钮
    ov.querySelectorAll('.cm-trans-group-btn').forEach(btn => {
        btn.onclick = () => {
            const group = btn.dataset.group;
            runTranslation(ov, 'group', group);
        };
    });

    // 绑定动态事件
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

    // 状态图标点击（切换已翻译/未翻译状态）
    ov.querySelectorAll('.cm-trans-status').forEach(icon => {
        icon.onclick = () => {
            const group = icon.dataset.group;
            const key = icon.dataset.key;
            if (currentTranslationData[group] && currentTranslationData[group][key]) {
                const item = currentTranslationData[group][key];
                
                // 根据当前状态切换
                if (item.status === STATUS.SUCCESS) {
                    // 已翻译 → 未翻译
                    item.status = STATUS.IDLE;
                    item.error = null;
                } else if (item.status === STATUS.ERROR) {
                    // 错误 → 未翻译
                    item.status = STATUS.IDLE;
                    item.error = null;
                } else if (item.status === STATUS.IDLE && item.translated && item.translated.trim()) {
                    // 未翻译但有翻译内容 → 已翻译
                    item.status = STATUS.SUCCESS;
                    item.error = null;
                    isDirty = true;
                } else if (item.status === STATUS.LOADING) {
                    // 加载中不处理
                    return;
                }
                
                // 更新UI
                icon.textContent = STATUS_ICONS[item.status];
                icon.title = item.error || (item.status === STATUS.SUCCESS ? (t('close') === 'Close' ? 'Translated' : '已翻译') : (t('close') === 'Close' ? 'Pending' : '未翻译'));
                
                const itemEl = ov.querySelector(`.cm-trans-item[data-group="${group}"][data-key="${key}"]`);
                if (itemEl) {
                    itemEl.className = `cm-trans-item ${item.status === 'success' ? 'cm-trans-item-success' : item.status === 'error' ? 'cm-trans-item-error' : item.status === 'loading' ? 'cm-trans-item-loading' : ''}`;
                    
                    // 移除错误信息
                    const existingErr = itemEl.querySelector('.cm-trans-error-msg');
                    if (existingErr) existingErr.remove();
                }
                
                const textarea = ov.querySelector(`.cm-trans-result[data-group="${group}"][data-key="${key}"]`);
                if (textarea) textarea.style.borderColor = '';
                
                updateProgressBar(ov);
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
                    isDirty = true;
                    const itemEl = ov.querySelector(`.cm-trans-item[data-group="${group}"][data-key="${key}"]`);
                    if (itemEl) itemEl.className = 'cm-trans-item cm-trans-item-success';
                    const icon = ov.querySelector(`.cm-trans-status[data-group="${group}"][data-key="${key}"]`);
                    if (icon) icon.textContent = STATUS_ICONS.success;
                    // 更新进度条和组计数
                    updateProgressBar(ov);
                    updateGroupCount(ov, group);
                }
            }
        };
    });
}

/**
 * 更新指定组的计数显示
 */
function updateGroupCount(ov, group) {
    const groupData = currentTranslationData[group];
    if (!groupData) return;
    
    const keys = Object.keys(groupData);
    const doneCount = keys.filter(k => groupData[k].status === STATUS.SUCCESS).length;
    
    // 更新组标题中的计数
    const groupHeader = ov.querySelector(`.cm-trans-group-btn[data-group="${group}"]`)?.closest('.cm-trans-group-header');
    if (groupHeader) {
        const countSpan = groupHeader.querySelector('.cm-trans-group-count');
        if (countSpan) {
            countSpan.textContent = `${doneCount}/${keys.length}`;
        }
    }
}

function updateSelectedCount(ov) {
    const btn = ov.querySelector('#cmTransRunSelected');
    if (btn) {
        const isEn = (state.settings.translationUILanguage === 'en');
        btn.textContent = isEn ? `🌍 Translate Selected (${selectedItems.size})` : `🌍 翻译选中 (${selectedItems.size})`;
    }
}

function refreshBody(ov) {
    const body = ov.querySelector('#cmTransBody');
    if (body) {
        body.innerHTML = buildGroupsHTML();
        bindDynamicEvents(ov);
    }
    updateProgressBar(ov);
}

function updateProgressBar(ov) {
    const totalCount = countItems('all');
    const doneCount = countItems('done');
    const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const bar = ov.querySelector('.cm-trans-progress-bar');
    if (bar) bar.style.width = percent + '%';
}

// ========== 翻译逻辑 ==========

async function runTranslation(ov, mode, groupFilter) {
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
                if (item.status === STATUS.SUCCESS) return;
            }

            tasks.push({ group, key });
        });
    });

    if (tasks.length === 0) {
        _notify(t('emptyNoData'), 'info');
        return;
    }

    // 确保服务使用最新设置
    service.updateSettings(state.settings);

    const charContext = {
        name: currentChar.name,
        description: currentTranslationData.basic?.description?.original || '',
        personality: currentTranslationData.basic?.personality?.original || ''
    };

    // 确保术语表数据最新
    collectGlossaryFromTable(ov);
    
    // 构建术语表文本
    const glossaryText = buildGlossaryText();
    const translateOptions = glossaryText ? { glossaryText } : {};
    
    // MVU 框架保护：检测并注入变量保护提示
    if (!mvuAnalysis && detectMVU(originalCharData)) {
        mvuAnalysis = analyzeMVUStructure(originalCharData);
        console.log('[Translation] 检测到 MVU 框架，锁定变量路径:', [...mvuAnalysis.lockedPaths]);
    }
    if (mvuAnalysis && mvuAnalysis.lockedPaths.size > 0) {
        const mvuPrompt = generateMVUProtectionPrompt(mvuAnalysis);
        translateOptions.mvuProtectionPrompt = mvuPrompt;
    }

    const isSingleMode = state.settings.singleGroupMode;

    _notify(t('notifyTranslationStarted'), 'info');

    if (isSingleMode) {
        for (const task of tasks) {
            await translateSingleItem(ov, task.group, task.key, charContext, translateOptions);
            await new Promise(r => setTimeout(r, 300));
        }
    } else {
        const grouped = {};
        tasks.forEach(t => {
            if (!grouped[t.group]) grouped[t.group] = [];
            grouped[t.group].push(t.key);
        });

        for (const group of Object.keys(grouped)) {
            // 针对每个组进行分批处理，避免单次请求过大
            const keys = grouped[group];
            const BATCH_SIZE = 15; // 限制每批次翻译的字段数量
            
            for (let i = 0; i < keys.length; i += BATCH_SIZE) {
                const batchKeys = keys.slice(i, i + BATCH_SIZE);
                await translateGroup(ov, group, batchKeys, charContext, translateOptions);
                // 批次间短暂延迟
                if (i + BATCH_SIZE < keys.length) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }
        }
    }

    _notify(t('notifyTranslationCompleted', { count: countItems('done') }), 'success');
    updateProgressBar(ov);
}

async function translateSingleItem(ov, group, key, charContext, options = {}) {
    const item = currentTranslationData[group][key];
    setItemStatus(ov, group, key, STATUS.LOADING);

    try {
        // MVU 预处理：标记保护变量名
        let originalText = item.original;
        let mvuMarkers = null;
        const isMVUContent = mvuAnalysis && (group === 'regex' || group === 'scripts') &&
                             (key.includes('replaceString') || key.includes('content'));
        
        if (isMVUContent) {
            const { processed, markers } = preprocessMVUContent(originalText, mvuAnalysis.lockedPaths);
            originalText = processed;
            mvuMarkers = markers;
        }
        
        const dataToTranslate = { [key]: originalText };
        const result = await service.translate(dataToTranslate, charContext, options);

        if (result[key]) {
            // MVU 后处理：恢复被保护的变量名
            let translated = result[key];
            if (isMVUContent && mvuMarkers && mvuMarkers.size > 0) {
                translated = postprocessMVUContent(translated, mvuMarkers);
            }
            
            item.translated = translated;
            item.status = STATUS.SUCCESS;
            item.error = null;
            isDirty = true;
            isDirty = true;
            updateItemUI(ov, group, key);
        } else {
            throw new Error('翻译结果缺失');
        }
    } catch (e) {
        item.status = STATUS.ERROR;
        item.error = e.message;
        updateItemUI(ov, group, key);
    }
    updateProgressBar(ov);
}

async function translateGroup(ov, group, keys, charContext, options = {}) {
    keys.forEach(k => setItemStatus(ov, group, k, STATUS.LOADING));

    const dataToTranslate = {};
    const mvuMarkersMap = {}; // key -> markers
    
    keys.forEach(k => {
        let text = currentTranslationData[group][k].original;
        
        // MVU 预处理
        const isMVUContent = mvuAnalysis && (group === 'regex' || group === 'scripts') &&
                             (k.includes('replaceString') || k.includes('content'));
        if (isMVUContent) {
            const { processed, markers } = preprocessMVUContent(text, mvuAnalysis.lockedPaths);
            text = processed;
            if (markers.size > 0) mvuMarkersMap[k] = markers;
        }
        
        dataToTranslate[k] = text;
    });

    try {
        const result = await service.translate(dataToTranslate, charContext, options);

        keys.forEach(k => {
            const item = currentTranslationData[group][k];
            if (result[k]) {
                // MVU 后处理
                let translated = result[k];
                if (mvuMarkersMap[k]) {
                    translated = postprocessMVUContent(translated, mvuMarkersMap[k]);
                }
                
                item.translated = translated;
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
    updateProgressBar(ov);
}

function setItemStatus(ov, group, key, status) {
    const item = currentTranslationData[group][key];
    item.status = status;
    const icon = ov.querySelector(`.cm-trans-status[data-group="${group}"][data-key="${key}"]`);
    if (icon) icon.textContent = STATUS_ICONS[status];
    
    const itemEl = ov.querySelector(`.cm-trans-item[data-group="${group}"][data-key="${key}"]`);
    if (itemEl) {
        itemEl.className = `cm-trans-item ${status === 'loading' ? 'cm-trans-item-loading' : status === 'success' ? 'cm-trans-item-success' : status === 'error' ? 'cm-trans-item-error' : ''}`;
    }
}

function updateItemUI(ov, group, key) {
    const item = currentTranslationData[group][key];

    const icon = ov.querySelector(`.cm-trans-status[data-group="${group}"][data-key="${key}"]`);
    if (icon) {
        icon.textContent = STATUS_ICONS[item.status];
        icon.title = item.error || item.status;
    }

    const textarea = ov.querySelector(`.cm-trans-result[data-group="${group}"][data-key="${key}"]`);
    if (textarea) {
        textarea.value = item.translated || '';
    }

    const itemEl = ov.querySelector(`.cm-trans-item[data-group="${group}"][data-key="${key}"]`);
    if (itemEl) {
        itemEl.className = `cm-trans-item ${item.status === 'success' ? 'cm-trans-item-success' : item.status === 'error' ? 'cm-trans-item-error' : item.status === 'loading' ? 'cm-trans-item-loading' : ''}`;
        
        const existingErr = itemEl.querySelector('.cm-trans-error-msg');
        if (existingErr) existingErr.remove();
        if (item.error) {
            const errDiv = doc.createElement('div');
            errDiv.className = 'cm-trans-error-msg';
            errDiv.textContent = '❌ ' + item.error;
            itemEl.appendChild(errDiv);
        }
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
    // 传递同步设置，控制是否将标签同步写入 data.tags
    return applyTranslation(originalCharData, flatTranslated, {
        syncToDataTags: state.settings.autoSyncTags
    });
}

/**
 * 获取翻译后的角色名称（用于文件名等场景）
 * 如果角色名已被翻译则返回翻译后的名称，否则返回原始名称
 */
function getTranslatedName() {
    if (currentTranslationData && currentTranslationData.basic && currentTranslationData.basic.name) {
        return currentTranslationData.basic.name.translated || currentTranslationData.basic.name.original || currentChar.name;
    }
    return currentChar.name;
}

function doExportJson() {
    try {
        const newCharData = buildTranslatedCharData();
        const jsonStr = JSON.stringify(newCharData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const translatedName = getTranslatedName();
        downloadBlob(blob, `${translatedName}_translated.json`);
        _notify(t('notifyExportJSONSuccess'), 'success');
    } catch (e) {
        _notify(t('notifySaveFailed', { error: e.message }), 'error');
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
        const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));
        const key = (newCharData.spec === 'chara_card_v3') ? 'ccv3' : 'chara';
        const pngBlob = writePngText(originalPngBuffer, key, base64Data);
        const translatedName = getTranslatedName();
        downloadBlob(pngBlob, `${translatedName}_translated.png`);
        _notify(t('notifyExportPNGSuccess'), 'success');
    } catch (e) {
        console.error('[Translation] PNG Export Error:', e);
        _notify(t('notifySaveFailed', { error: e.message }), 'error');
    }
}

async function doOverwriteOriginal(ov) {
    const confirmed = await _showConfirm(t('confirmOverwrite'));
    if (!confirmed) return;

    // 显示加载遮罩
    showOperationLoading(ov, t('notifyOverwriting') || '正在覆盖原卡...');

    try {
        // 解包 V2 数据结构，获取实际的数据字段
        const translatedV2 = buildTranslatedCharData();
        const newCharData = translatedV2.data || translatedV2;

        // 获取完整原数据以支持 partial update
        const getRes = await authFetch('/api/characters/get', {
            method: 'POST',
            body: JSON.stringify({ avatar_url: currentChar.fileName })
        });
        if (!getRes.ok) throw new Error(`无法读取原角色数据: ${getRes.status}`);
        const fullData = await getRes.json();

        // 合并数据
        let charData = fullData;
        if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
            charData = fullData.data;
        }
        
        // 将翻译后的数据合并
        const mergeFields = [
            'name', 'description', 'first_mes', 'personality', 'scenario',
            'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions',
            'character_version', 'creator'
        ];
        mergeFields.forEach(k => {
            if (newCharData[k] !== undefined) charData[k] = newCharData[k];
        });
        if (newCharData.alternate_greetings) charData.alternate_greetings = newCharData.alternate_greetings;
        if (newCharData.tags) charData.tags = newCharData.tags;
        if (newCharData.extensions) {
            charData.extensions = charData.extensions || {};
            Object.assign(charData.extensions, newCharData.extensions);
        }
        if (newCharData.character_book) charData.character_book = newCharData.character_book;

        // 使用通用更新函数
        await _updateCharacter(currentChar.fileName, charData, null, {
            cleanOldWorldInfo: true,
            preserveSourceLink: true,
            refreshUI: false, // 翻译界面无需刷新主列表UI，最后统一刷新
            notifySuccess: false,
            fullCardData: fullData
        });
        
        // 使用单卡刷新，只刷新当前角色（高效）
        if (_refreshSingleCard) {
            await _refreshSingleCard(currentChar.fileName);
        }

        isDirty = false;
        _notify(t('notifyOverwriteSuccess'), 'success');
    } catch (e) {
        console.error('[Translation] Overwrite Error:', e);
        _notify(t('notifySaveFailed', { error: e.message }), 'error');
    } finally {
        hideOperationLoading(ov);
    }
}

async function doImportAsNew(ov) {
    if (!_importFiles) {
        _notify('Import function not available', 'error');
        return;
    }

    try {
        // 显示加载遮罩
        showOperationLoading(ov, t('notifyImporting') || '正在导入新卡...');

        const fullCardData = buildTranslatedCharData();
        const jsonStr = JSON.stringify(fullCardData);
        
        const rawName = getTranslatedName();
        // 简单清理文件名
        const safeName = rawName.replace(/[\\/:*?"<>|]/g, '_');
        
        let importFile;

        if (originalPngBuffer) {
            // 如果有原图，直接写入 PNG 块并导入 PNG
            // 这样酒馆后端会自动识别并处理图片和元数据
            try {
                // 写入 tEXt 块
                const base64Data = btoa(unescape(encodeURIComponent(jsonStr)));
                const key = (fullCardData.spec === 'chara_card_v3') ? 'ccv3' : 'chara';
                const pngBlob = writePngText(originalPngBuffer, key, base64Data);
                importFile = new File([pngBlob], `${safeName}.png`, { type: 'image/png' });
            } catch (pngErr) {
                console.warn('[Translation] PNG 写入失败，降级为 JSON 导入:', pngErr);
                const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
                importFile = new File([jsonBlob], `${safeName}.json`, { type: 'application/json' });
            }
        } else {
            // 没有原图，直接导入 JSON
            const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
            importFile = new File([jsonBlob], `${safeName}.json`, { type: 'application/json' });
        }

        // 调用 index.js 中提供的 importFiles 函数
        // 该函数已经包含了：调用原生导入接口 -> 轮询检测 -> 触发扫描 -> 刷新 UI 的完整流程
        if (importFile) {
            await _importFiles([importFile]);
            isDirty = false;
        }
        
    } catch (e) {
        console.error('[Translation] Import New Error:', e);
        _notify(t('notifySaveFailed', { error: e.message }), 'error');
    } finally {
        hideOperationLoading(ov);
    }
}

// ========== 操作加载遮罩 ==========

function showOperationLoading(ov, message) {
    // 移除已有的遮罩
    hideOperationLoading();
    
    const overlay = doc.createElement('div');
    overlay.className = 'cm-trans-operation-loading';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.zIndex = String(Z_INDEX.TRANSLATION_OVERLAY); // 确保在所有层级之上
    overlay.innerHTML = `
        <div class="cm-trans-operation-loading-content">
            <div class="cm-trans-operation-spinner"></div>
            <div class="cm-trans-operation-loading-text">${escapeHtml(message)}</div>
        </div>
    `;
    doc.body.appendChild(overlay);
}

function hideOperationLoading(ov) {
    const existing = doc.body.querySelector('.cm-trans-operation-loading');
    if (existing) existing.remove();
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

// ========== 进度导入/导出 (JSON) ==========

function doExportProgress() {
    try {
        const progressData = {
            version: 1,
            charName: currentChar.name,
            charFile: currentChar.fileName,
            timestamp: new Date().toISOString(),
            glossary: glossaryData,
            data: {}
        };

        Object.keys(currentTranslationData).forEach(group => {
            progressData.data[group] = {};
            Object.keys(currentTranslationData[group]).forEach(key => {
                const item = currentTranslationData[group][key];
                progressData.data[group][key] = {
                    original: item.original,
                    translated: item.translated,
                    status: item.status
                };
            });
        });

        const jsonStr = JSON.stringify(progressData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        downloadBlob(blob, `${currentChar.name}_translation_progress.json`);
        isDirty = false;
        _notify(t('notifyProgressExported'), 'success');
    } catch (e) {
        _notify(t('notifySaveFailed', { error: e.message }), 'error');
    }
}

function doImportProgress(ov) {
    // 创建隐藏的 file input
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    doc.body.appendChild(fileInput);

    fileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const progressData = JSON.parse(text);

            if (!progressData.data || typeof progressData.data !== 'object') {
                throw new Error('无效的进度文件格式');
            }

            let recoveredCount = 0;
            Object.keys(progressData.data).forEach(group => {
                if (!currentTranslationData[group]) return;
                Object.keys(progressData.data[group]).forEach(key => {
                    if (!currentTranslationData[group][key]) return;
                    const saved = progressData.data[group][key];
                    if (saved.translated && saved.translated.trim()) {
                        currentTranslationData[group][key].translated = saved.translated;
                        currentTranslationData[group][key].status = saved.status || STATUS.SUCCESS;
                        recoveredCount++;
                    }
                });
            });

            // 恢复术语表
            if (progressData.glossary && Array.isArray(progressData.glossary)) {
                glossaryData = progressData.glossary;
            }

            refreshBody(ov);
            if (recoveredCount > 0) isDirty = true;
            _notify(t('notifyProgressImported', { count: recoveredCount }), 'success');
        } catch (err) {
            _notify(t('notifyProgressImportFailed', { error: err.message }), 'error');
        } finally {
            doc.body.removeChild(fileInput);
        }
    };

    fileInput.click();
}

// ========== 术语表 ==========

function buildGlossaryText() {
    if (!glossaryData || glossaryData.length === 0) return '';
    
    let text = '';
    glossaryData.forEach(entry => {
        if (entry.original && entry.translation) {
            text += `${entry.original} → ${entry.translation}\n`;
        }
    });
    return text.trim();
}

// ========== 术语表扫描 ==========

async function doScanGlossary(ov) {
    const scanBtn = ov.querySelector('#cmTransScanGlossary');
    if (scanBtn) {
        scanBtn.disabled = true;
        scanBtn.textContent = `⏳ ${t('scanningGlossary')}`;
    }

    try {
        // 使用新的 AI 筛选流程：代码粗提取 → AI 判断 + 翻译
        service.updateSettings(state.settings);
        const results = await scanAndFilterGlossary(originalCharData, state.settings);
        
        if (!results || results.length === 0) {
            _notify(t('noProperNouns'), 'info');
            if (scanBtn) {
                scanBtn.disabled = false;
                scanBtn.textContent = `🔍 ${t('btnScanGlossary')}`;
            }
            return;
        }

        glossaryData = results.map(n => ({
            original: n.original,
            translation: n.translation || '',
            type: n.type || 'other',
            sources: '' // AI 筛选模式不追踪来源
        }));

        renderGlossaryTable(ov);
        _notify(t('scanComplete', { count: glossaryData.length }), 'success');
    } catch (e) {
        _notify(t('notifyTranslationError', { error: e.message }), 'error');
    } finally {
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.textContent = `🔍 ${t('btnScanGlossary')}`;
        }
    }
}

function renderGlossaryTable(ov) {
    const panel = ov.querySelector('#cmTransGlossaryPanel');
    const grid = ov.querySelector('#cmTransGlossaryGrid');
    const countEl = ov.querySelector('#cmTransGlossaryCount');
    const controls = ov.querySelector('#cmTransGlossaryControls');

    if (!panel || !grid) return;

    panel.style.display = 'block';
    if (countEl) countEl.textContent = glossaryData.length;

    // 渲染控制按钮
    if (controls) {
        if (isGlossaryEditing) {
            controls.innerHTML = `
                <button id="cmTransGlossaryDone" class="cm-trans-btn cm-trans-btn-success" style="font-size:12px;padding:2px 6px" title="完成编辑">✓</button>
            `;
            const doneBtn = controls.querySelector('#cmTransGlossaryDone');
            if (doneBtn) {
                doneBtn.onclick = (e) => {
                    e.stopPropagation();
                    isGlossaryEditing = false;
                    renderGlossaryTable(ov);
                };
            }
        } else {
            controls.innerHTML = `
                <button id="cmTransGlossaryAdd" class="cm-trans-btn" style="font-size:12px;padding:2px 6px" title="添加术语">➕</button>
                <button id="cmTransGlossaryEdit" class="cm-trans-btn" style="font-size:12px;padding:2px 6px" title="编辑/删除">➖</button>
                <button id="cmTransClearGlossary" class="cm-trans-btn" style="font-size:10px;padding:2px 6px" title="清空">🗑️</button>
            `;
            
            const addBtn = controls.querySelector('#cmTransGlossaryAdd');
            if (addBtn) {
                addBtn.onclick = (e) => {
                    e.stopPropagation();
                    glossaryData.unshift({ original: '', translation: '', type: 'term' });
                    renderGlossaryTable(ov);
                };
            }
            
            const editBtn = controls.querySelector('#cmTransGlossaryEdit');
            if (editBtn) {
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    isGlossaryEditing = true;
                    renderGlossaryTable(ov);
                };
            }

            const clearBtn = controls.querySelector('#cmTransClearGlossary');
            if (clearBtn) {
                clearBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (confirm(t('confirmClearGlossary') || '确定要清空术语表吗？')) {
                        glossaryData = [];
                        panel.style.display = 'none';
                        _notify(t('btnClearGlossary') + ' ✅', 'info');
                    }
                };
            }
        }
    }

    const typeLabels = {
        name: '👤 角色',
        place: '📍 地点',
        skill: '⚔️ 技能',
        term: '📝 专名',
        other: '❓ 其他'
    };

    // 紧凑网格布局
    grid.innerHTML = glossaryData.map((entry, i) => `
        <div class="cm-trans-glossary-item ${isGlossaryEditing ? 'cm-glossary-editing' : ''}" title="${escapeHtml(entry.sources || '')}">
            ${isGlossaryEditing ?
                `<button class="cm-glossary-delete-btn" data-index="${i}">×</button>` : ''
            }
            ${isGlossaryEditing || !entry.original ?
                `<input class="cm-glossary-original-input" data-index="${i}" value="${escapeHtml(entry.original)}" placeholder="原文">` :
                `<span class="cm-glossary-original-text" title="${escapeHtml(entry.original)}">${escapeHtml(entry.original)}</span>`
            }
            <span class="cm-glossary-arrow">→</span>
            <input class="cm-glossary-translation" data-index="${i}" value="${escapeHtml(entry.translation)}" placeholder="译文">
            <select class="cm-glossary-type" data-index="${i}" title="类型">
                ${Object.entries(typeLabels).map(([val, label]) =>
                    `<option value="${val}" ${entry.type === val ? 'selected' : ''}>${label}</option>`
                ).join('')}
            </select>
        </div>
    `).join('');

    // 绑定事件
    grid.querySelectorAll('.cm-glossary-translation').forEach(input => {
        input.onchange = () => {
            const idx = parseInt(input.dataset.index);
            if (glossaryData[idx]) glossaryData[idx].translation = input.value;
        };
    });

    grid.querySelectorAll('.cm-glossary-original-input').forEach(input => {
        input.onchange = () => {
            const idx = parseInt(input.dataset.index);
            if (glossaryData[idx]) glossaryData[idx].original = input.value;
        };
    });

    grid.querySelectorAll('.cm-glossary-type').forEach(select => {
        select.onchange = () => {
            const idx = parseInt(select.dataset.index);
            if (glossaryData[idx]) glossaryData[idx].type = select.value;
        };
    });

    if (isGlossaryEditing) {
        grid.querySelectorAll('.cm-glossary-delete-btn').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.index);
                glossaryData.splice(idx, 1);
                renderGlossaryTable(ov);
            };
        });
    }
}

function collectGlossaryFromTable(ov) {
    const grid = ov.querySelector('#cmTransGlossaryGrid');
    if (!grid) return;

    grid.querySelectorAll('.cm-glossary-translation').forEach(input => {
        const idx = parseInt(input.dataset.index);
        if (glossaryData[idx]) glossaryData[idx].translation = input.value;
    });

    grid.querySelectorAll('.cm-glossary-type').forEach(select => {
        const idx = parseInt(select.dataset.index);
        if (glossaryData[idx]) glossaryData[idx].type = select.value;
    });
}

// ========== 辅助函数 ==========

function countItems(mode) {
    let count = 0;
    Object.keys(currentTranslationData).forEach(group => {
        Object.keys(currentTranslationData[group]).forEach(key => {
            const item = currentTranslationData[group][key];
            if (mode === 'all') count++;
            else if (mode === 'done' && item.status === STATUS.SUCCESS) count++;
            else if (mode === 'failed' && item.status === STATUS.ERROR) count++;
        });
    });
    return count;
}
