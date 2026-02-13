import { state, saveSettings, defaultSettings } from './state.js';
import { ICONS } from './constants.js';
import { escapeHtml } from './utils.js';
import { syncAllTags } from './data.js';

export function showSettingsDialog({ createBaseDialog, toggleTheme, renderView, notify, setZoom, showConfirm, showProgressBar, updateProgressBar, hideProgressBar }) {
    const settings = state.settings;

    const content = `
        <div class="cm-settings-container">
            
            <!-- 界面与显示 -->
            <div class="cm-settings-group">
                <h4 class="cm-settings-title">${ICONS.image || '🎨'} 界面与显示</h4>
                
                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>主题模式</span>
                        <small>切换深色/浅色外观</small>
                    </div>
                    <button id="cmSetThemeBtn" class="cm-btn cm-btn-secondary" style="min-width:80px">
                        ${state.isDarkMode ? '🌙 深色' : '☀️ 浅色'}
                    </button>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>卡片缩放</span>
                        <small>调整卡片显示的尺寸 (${state.zoomLevel}px)</small>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <input type="range" id="cmSetZoomRange" min="60" max="300" step="20" value="${state.zoomLevel}" style="width:100px">
                        <span id="cmSetZoomVal" style="font-size:12px;width:40px;text-align:right">${state.zoomLevel}</span>
                    </div>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>画廊计数徽章</span>
                        <small>显示右上角的图片数量 (关闭可提升加载速度)</small>
                    </div>
                    <label class="cm-switch">
                        <input type="checkbox" id="cmSetGallery" ${settings.showGalleryBadge ? 'checked' : ''}>
                        <span class="cm-slider"></span>
                    </label>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>Token 计数徽章</span>
                        <small>显示左上角的 Token 估算值</small>
                    </div>
                    <label class="cm-switch">
                        <input type="checkbox" id="cmSetToken" ${settings.showTokenBadge ? 'checked' : ''}>
                        <span class="cm-slider"></span>
                    </label>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>显示作者名</span>
                        <small>在卡片下方显示作者信息</small>
                    </div>
                    <label class="cm-switch">
                        <input type="checkbox" id="cmSetAuthor" ${settings.showAuthor ? 'checked' : ''}>
                        <span class="cm-slider"></span>
                    </label>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>侧边栏宽度</span>
                        <small>恢复侧边栏到默认宽度</small>
                    </div>
                    <button id="cmResetSidebarBtn" class="cm-btn cm-btn-secondary">重置</button>
                </div>
            </div>

            <!-- 行为与功能 -->
            <div class="cm-settings-group">
                <h4 class="cm-settings-title">${ICONS.settings || '⚙️'} 行为与功能</h4>
                
                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>启动时自动扫描</span>
                        <small>打开扩展时自动刷新列表 (关闭需手动点击刷新)</small>
                    </div>
                    <label class="cm-switch">
                        <input type="checkbox" id="cmSetAutoScan" ${settings.autoScan ? 'checked' : ''}>
                        <span class="cm-slider"></span>
                    </label>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>双击卡片动作</span>
                        <small>鼠标左键双击卡片时的行为</small>
                    </div>
                    <select id="cmSetDbClick" class="cm-select-input">
                        <option value="detail" ${settings.doubleClickAction === 'detail' ? 'selected' : ''}>查看详情 (默认)</option>
                        <option value="chat" ${settings.doubleClickAction === 'chat' ? 'selected' : ''}>启动聊天</option>
                    </select>
                </div>
                
                 <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>默认排序方式</span>
                        <small>每次打开时的默认排序</small>
                    </div>
                    <select id="cmSetDefSort" class="cm-select-input" style="max-width:140px">
                        <option value="date_desc" ${settings.defaultSort === 'date_desc' ? 'selected' : ''}>📅 最新 (默认)</option>
                        <option value="access_desc" ${settings.defaultSort === 'access_desc' ? 'selected' : ''}>🕒 最近互动</option>
                        <option value="name_asc" ${settings.defaultSort === 'name_asc' ? 'selected' : ''}>🔤 名称 (A-Z)</option>
                    </select>
                </div>

                 <div class="cm-setting-item">
                     <div class="cm-setting-label">
                         <span>角色卡翻译</span>
                         <small>启用实验性的翻译功能</small>
                     </div>
                     <label class="cm-switch">
                         <input type="checkbox" id="cmSetTrans" ${settings.translationEnabled ? 'checked' : ''}>
                         <span class="cm-slider"></span>
                     </label>
                 </div>
 
                 <!-- 翻译详细设置 (仅在启用时显示) -->
                 <div id="cmTransSettings" style="display:${settings.translationEnabled ? 'block' : 'none'};padding:10px;background:var(--cm-bg-ter);border-radius:8px;margin-top:10px">
                     
                     <!-- 语言设置 -->
                     <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--cm-border)">
                         <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--cm-text)" data-tl-key="langSettings">🌐 ${settings.translationUILanguage === 'en' ? 'Language Settings' : '语言设置'}</div>
                         <div class="cm-settings-lang-row">
                             <div class="cm-settings-lang-col">
                                 <label style="display:block;font-size:11px;margin-bottom:4px;color:var(--cm-text-sec)" data-tl-key="sourceLang">${settings.translationUILanguage === 'en' ? 'Source Language' : '源语言'}</label>
                                 <select id="cmSetSourceLang" class="cm-select-input" style="width:100%;height:30px;box-sizing:border-box">
                                     <option value="auto" ${settings.sourceLanguage === 'auto' ? 'selected' : ''}>${settings.translationUILanguage === 'en' ? 'Auto Detect' : '自动检测 (Auto)'}</option>
                                     <option value="en" ${settings.sourceLanguage === 'en' ? 'selected' : ''}>English</option>
                                     <option value="ja" ${settings.sourceLanguage === 'ja' ? 'selected' : ''}>日本語</option>
                                     <option value="ko" ${settings.sourceLanguage === 'ko' ? 'selected' : ''}>한국어</option>
                                     <option value="zh-CN" ${settings.sourceLanguage === 'zh-CN' ? 'selected' : ''}>简体中文</option>
                                     <option value="zh-TW" ${settings.sourceLanguage === 'zh-TW' ? 'selected' : ''}>繁體中文</option>
                                 </select>
                             </div>
                             <div class="cm-settings-lang-col">
                                 <label style="display:block;font-size:11px;margin-bottom:4px;color:var(--cm-text-sec)" data-tl-key="targetLang">${settings.translationUILanguage === 'en' ? 'Target Language' : '目标语言'}</label>
                                 <select id="cmSetTargetLang" class="cm-select-input" style="width:100%;height:30px;box-sizing:border-box">
                                     <option value="zh-CN" ${settings.targetLanguage === 'zh-CN' ? 'selected' : ''}>简体中文</option>
                                     <option value="zh-TW" ${settings.targetLanguage === 'zh-TW' ? 'selected' : ''}>繁體中文</option>
                                     <option value="en" ${settings.targetLanguage === 'en' ? 'selected' : ''}>English</option>
                                     <option value="ja" ${settings.targetLanguage === 'ja' ? 'selected' : ''}>日本語</option>
                                     <option value="ko" ${settings.targetLanguage === 'ko' ? 'selected' : ''}>한국어</option>
                                     <option value="custom" ${settings.targetLanguage === 'custom' ? 'selected' : ''}>${settings.translationUILanguage === 'en' ? '✏️ Custom...' : '✏️ 自定义...'}</option>
                                 </select>
                             </div>
                             <div id="cmCustomTargetLangWrap" class="cm-settings-lang-custom" style="display:${settings.targetLanguage === 'custom' ? 'flex' : 'none'}">
                                 <div style="width:100%">
                                     <label style="display:block;font-size:11px;margin-bottom:4px;color:var(--cm-text-sec)">${settings.translationUILanguage === 'en' ? 'Custom Language' : '自定义语言'}</label>
                                     <input type="text" id="cmSetCustomTargetLang" class="cm-input" value="${escapeHtml(settings.customTargetLanguage || '')}"
                                         placeholder="${settings.translationUILanguage === 'en' ? 'e.g. Thai' : '如：泰语'}"
                                         style="width:100%;box-sizing:border-box;font-size:12px;height:30px">
                                 </div>
                             </div>
                         </div>
                     </div>
 
                     <!-- 界面语言 -->
                     <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--cm-border)">
                         <div class="cm-setting-item" style="margin:0">
                             <div class="cm-setting-label">
                                 <span style="font-size:12px" data-tl-key="uiLang">${settings.translationUILanguage === 'en' ? 'UI Language' : '翻译界面语言'}</span>
                                 <small data-tl-key="uiLangDesc">${settings.translationUILanguage === 'en' ? 'Only affects the translation module UI' : '仅影响翻译模块的界面显示'}</small>
                             </div>
                             <select id="cmSetTransUILang" class="cm-select-input" style="max-width:120px">
                                 <option value="zh-CN" ${settings.translationUILanguage === 'zh-CN' ? 'selected' : ''}>中文</option>
                                 <option value="en" ${settings.translationUILanguage === 'en' ? 'selected' : ''}>English</option>
                             </select>
                         </div>
                     </div>
 
                     <!-- API 设置 -->
                     <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--cm-border)">
                         <div class="cm-setting-item" style="margin:0;margin-bottom:8px">
                             <div class="cm-setting-label">
                                 <span style="font-size:12px" data-tl-key="apiProtocol">${settings.translationUILanguage === 'en' ? 'API Protocol' : 'API 协议'}</span>
                                 <small data-tl-key="apiProtocolDesc">${settings.translationUILanguage === 'en' ? 'Select the API type for translation' : '选择翻译使用的 API 类型'}</small>
                             </div>
                             <select id="cmSetTransApi" class="cm-select-input">
                                 <option value="openai" ${settings.translationApi === 'openai' ? 'selected' : ''}>OpenAI Compatible</option>
                                 <option value="tavern" ${settings.translationApi === 'tavern' ? 'selected' : ''}>${settings.translationUILanguage === 'en' ? 'Tavern Native (Experimental)' : '酒馆原生 (实验性)'}</option>
                             </select>
                         </div>
 
                         <div id="cmSetOpenaiConfig" style="display:${settings.translationApi === 'openai' ? 'block' : 'none'}">
                             <div style="margin-bottom:8px">
                                 <label style="display:block;font-size:12px;margin-bottom:4px;color:var(--cm-text-sec)">API Base URL</label>
                                 <input type="text" id="cmSetOpenaiUrl" class="cm-input" value="${settings.openaiBaseUrl || ''}" placeholder="https://api.openai.com/v1" style="width:100%;box-sizing:border-box">
                             </div>
                             <div style="margin-bottom:8px">
                                 <label style="display:block;font-size:12px;margin-bottom:4px;color:var(--cm-text-sec)">API Key</label>
                                 <input type="password" id="cmSetOpenaiKey" class="cm-input" value="${settings.openaiApiKey || ''}" placeholder="sk-..." style="width:100%;box-sizing:border-box">
                             </div>
                             <div style="margin-bottom:8px">
                                 <label style="display:block;font-size:12px;margin-bottom:4px;color:var(--cm-text-sec)" data-tl-key="model">${settings.translationUILanguage === 'en' ? 'Model' : '模型'}</label>
                                 <div style="display:flex;gap:6px;align-items:center">
                                     <select id="cmSetOpenaiModel" class="cm-select-input" style="flex:1;min-width:0">
                                         ${settings.openaiModel ? '<option value="' + settings.openaiModel + '" selected>' + settings.openaiModel + '</option>' : '<option value="">' + (settings.translationUILanguage === 'en' ? 'Connect first to get model list' : '请先连接获取模型列表') + '</option>'}
                                     </select>
                                     <button id="cmSetFetchModels" class="cm-btn cm-btn-primary" style="flex-shrink:0;font-size:12px;padding:6px 12px;white-space:nowrap">${settings.translationUILanguage === 'en' ? '🔗 Connect' : '🔗 连接'}</button>
                                 </div>
                                 <div id="cmSetModelStatus" style="font-size:11px;margin-top:4px;color:var(--cm-text-sec)"></div>
                             </div>
                         </div>
                     </div>
 
                     <!-- 前置 System Prompt -->
                     <div>
                         <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--cm-text)" data-tl-key="sysPromptTitle">📝 ${settings.translationUILanguage === 'en' ? 'Translation System Prompt' : '翻译 System Prompt'}</div>
                         <div style="font-size:11px;color:var(--cm-text-sec);margin-bottom:6px" data-tl-key="sysPromptDesc">${settings.translationUILanguage === 'en' ? 'System prompt sent to AI during translation, guiding translation behavior and style' : '翻译时发送给 AI 的系统提示词，指导翻译行为和风格'}</div>
                         <textarea id="cmSetTransSysPrompt" style="width:100%;box-sizing:border-box;min-height:120px;resize:vertical;
                             background:var(--cm-input-bg);color:var(--cm-text);border:1px solid var(--cm-border);
                             border-radius:6px;padding:8px;font-size:12px;line-height:1.5;font-family:inherit"
                             placeholder="${settings.translationUILanguage === 'en' ? 'Enter translation system prompt...' : '输入翻译系统提示词...'}">${escapeHtml(settings.translationSystemPrompt || '')}</textarea>
                         <div style="display:flex;justify-content:flex-end;margin-top:4px">
                             <button id="cmSetResetSysPrompt" class="cm-btn cm-btn-secondary" style="font-size:11px;padding:3px 8px">${settings.translationUILanguage === 'en' ? 'Reset Default' : '恢复默认'}</button>
                         </div>
                     </div>
                 </div>
            </div>

            <!-- 数据管理 -->
            <div class="cm-settings-group">
                <h4 class="cm-settings-title">${ICONS.database || '💾'} 数据与存储</h4>
                
                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>自动同步标签</span>
                        <small>修改标签时自动写入角色卡文件</small>
                    </div>
                    <label class="cm-switch">
                        <input type="checkbox" id="cmSetAutoSyncTags" ${settings.autoSyncTags ? 'checked' : ''}>
                        <span class="cm-slider"></span>
                    </label>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>全量同步标签</span>
                        <small>将插件标签写入所有角色卡文件</small>
                    </div>
                    <button id="cmSyncAllTagsBtn" class="cm-btn cm-btn-secondary">立即同步</button>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>清除索引缓存</span>
                        <small>修复列表显示滞后或数据错误</small>
                    </div>
                    <button id="cmClearCacheBtn" class="cm-btn cm-btn-danger">清除缓存</button>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>重置所有设置</span>
                        <small>恢复到初始状态</small>
                    </div>
                    <button id="cmResetAllBtn" class="cm-btn cm-btn-danger">重置</button>
                </div>
            </div>

            <!-- 关于 -->
            <div class="cm-settings-group cm-about-section">
                <h4 class="cm-settings-title">📝 关于</h4>
                <div class="cm-about-credits">
                    <div class="cm-about-item">
                        <span class="cm-about-role">原作者</span>
                        <span class="cm-about-name">别截断我了行吗（lina051644）</span>
                        <a href="https://discord.com/channels/1291925535324110879/1460890397910892606" target="_blank" class="cm-about-link" title="Discord 频道">🔗 Discord</a>
                    </div>
                    <div class="cm-about-item">
                        <span class="cm-about-role">二改作者</span>
                        <span class="cm-about-name">南北绿豆（zheokbu）</span>
                        <small class="cm-about-note">本插件基于其 v89.2 版本修改</small>
                    </div>
                    <div class="cm-about-item">
                        <span class="cm-about-role">三改作者</span>
                        <span class="cm-about-name">Kirafishy</span>
                        <small class="cm-about-note">角色卡管理器 小鱼改版 v1.0</small>
                    </div>
                </div>
            </div>

        </div>
    `;

    createBaseDialog('⚙️ 设置', content, [
        { text: '关闭', cls: 'cm-btn-primary', onClick: (ov, close) => close() }
    ], (ov) => {
        // --- Bind Events ---

        // Helper to bind checkbox settings
        const bindCheck = (id, key) => {
            const el = ov.querySelector('#' + id);
            if (el) {
                el.onchange = (e) => {
                    state.settings[key] = e.target.checked;
                    saveSettings();
                    // Some settings require re-rendering
                    if (['showGalleryBadge', 'showTokenBadge', 'showAuthor'].includes(key)) {
                        renderView();
                    }
                };
            }
        };

        bindCheck('cmSetGallery', 'showGalleryBadge');
        bindCheck('cmSetToken', 'showTokenBadge');
        bindCheck('cmSetAuthor', 'showAuthor');
        bindCheck('cmSetAutoScan', 'autoScan');
        bindCheck('cmSetAutoSyncTags', 'autoSyncTags');

        // Translation Settings — 版权声明弹窗逻辑
        const transCheck = ov.querySelector('#cmSetTrans');
        const transSettings = ov.querySelector('#cmTransSettings');
        if (transCheck && transSettings) {
            transCheck.onchange = (e) => {
                if (e.target.checked) {
                    // 检查是否已接受过版权声明
                    const accepted = localStorage.getItem('cm_translation_disclaimer_accepted');
                    if (accepted === 'true') {
                        // 已接受，直接启用
                        state.settings.translationEnabled = true;
                        saveSettings();
                        transSettings.style.display = 'block';
                    } else {
                        // 未接受，弹出版权声明
                        e.target.checked = false; // 先恢复为未选中
                        showTranslationDisclaimer(createBaseDialog, () => {
                            // 接受回调
                            localStorage.setItem('cm_translation_disclaimer_accepted', 'true');
                            state.settings.translationEnabled = true;
                            saveSettings();
                            transCheck.checked = true;
                            transSettings.style.display = 'block';
                            notify('翻译功能已启用', 'success');
                        }, () => {
                            // 拒绝回调
                            notify('已拒绝，翻译功能未启用', 'info');
                        });
                    }
                } else {
                    state.settings.translationEnabled = false;
                    saveSettings();
                    transSettings.style.display = 'none';
                }
            };
        }

        // 语言设置绑定
        const bindLangSelect = (id, key) => {
            const el = ov.querySelector('#' + id);
            if (el) {
                el.onchange = (e) => {
                    state.settings[key] = e.target.value;
                    saveSettings();
                };
            }
        };
        bindLangSelect('cmSetSourceLang', 'sourceLanguage');

        // 目标语言 — 包含自定义选项逻辑
        const targetLangSelect = ov.querySelector('#cmSetTargetLang');
        const customTargetWrap = ov.querySelector('#cmCustomTargetLangWrap');
        const customTargetInput = ov.querySelector('#cmSetCustomTargetLang');
        if (targetLangSelect) {
            targetLangSelect.onchange = (e) => {
                state.settings.targetLanguage = e.target.value;
                saveSettings();
                if (customTargetWrap) {
                    customTargetWrap.style.display = e.target.value === 'custom' ? 'flex' : 'none';
                }
            };
        }
        if (customTargetInput) {
            customTargetInput.onchange = (e) => {
                state.settings.customTargetLanguage = e.target.value.trim();
                saveSettings();
            };
        }

        // UI 语言切换 — 切换后重新打开设置界面以刷新标签
        const transUILangSelect = ov.querySelector('#cmSetTransUILang');
        if (transUILangSelect) {
            transUILangSelect.onchange = (e) => {
                state.settings.translationUILanguage = e.target.value;
                saveSettings();
                // 重新打开设置界面以刷新翻译设置区域的语言
                ov.remove();
                showSettingsDialog({ createBaseDialog, toggleTheme, renderView, notify, setZoom, showConfirm });
            };
        }

        // System Prompt 绑定
        const sysPromptInput = ov.querySelector('#cmSetTransSysPrompt');
        if (sysPromptInput) {
            sysPromptInput.onchange = () => {
                state.settings.translationSystemPrompt = sysPromptInput.value;
                saveSettings();
            };
        }

        // 恢复默认 System Prompt
        const resetSysPromptBtn = ov.querySelector('#cmSetResetSysPrompt');
        if (resetSysPromptBtn) {
            resetSysPromptBtn.onclick = () => {
                state.settings.translationSystemPrompt = defaultSettings.translationSystemPrompt;
                saveSettings();
                if (sysPromptInput) sysPromptInput.value = defaultSettings.translationSystemPrompt;
                notify('System Prompt 已恢复默认', 'success');
            };
        }

        const transApiSelect = ov.querySelector('#cmSetTransApi');
        const openaiConfig = ov.querySelector('#cmSetOpenaiConfig');
        if (transApiSelect && openaiConfig) {
            transApiSelect.onchange = (e) => {
                state.settings.translationApi = e.target.value;
                saveSettings();
                openaiConfig.style.display = e.target.value === 'openai' ? 'block' : 'none';
            };
        }

        const bindInput = (id, key) => {
            const el = ov.querySelector('#' + id);
            if (el) {
                el.onchange = (e) => {
                    state.settings[key] = e.target.value;
                    saveSettings();
                };
            }
        };

        bindInput('cmSetOpenaiUrl', 'openaiBaseUrl');
        bindInput('cmSetOpenaiKey', 'openaiApiKey');

        // 模型下拉列表变化
        const modelSelect = ov.querySelector('#cmSetOpenaiModel');
        if (modelSelect) {
            modelSelect.onchange = (e) => {
                state.settings.openaiModel = e.target.value;
                saveSettings();
            };
        }

        // 连接按钮 - 获取模型列表
        const fetchModelsBtn = ov.querySelector('#cmSetFetchModels');
        if (fetchModelsBtn) {
            fetchModelsBtn.onclick = async () => {
                const urlInput = ov.querySelector('#cmSetOpenaiUrl');
                const keyInput = ov.querySelector('#cmSetOpenaiKey');
                const statusEl = ov.querySelector('#cmSetModelStatus');
                const modelSel = ov.querySelector('#cmSetOpenaiModel');
                
                const baseUrl = (urlInput?.value || 'https://api.openai.com/v1').replace(/\/$/, '');
                const apiKey = keyInput?.value || '';

                if (!apiKey) {
                    if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444">❌ 请先填写 API Key</span>';
                    return;
                }

                fetchModelsBtn.disabled = true;
                fetchModelsBtn.textContent = '⏳ 连接中...';
                if (statusEl) statusEl.textContent = '正在获取模型列表...';

                try {
                    const res = await fetch(baseUrl + '/models', {
                        headers: { 'Authorization': 'Bearer ' + apiKey }
                    });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    const data = await res.json();
                    
                    let models = [];
                    if (data.data && Array.isArray(data.data)) {
                        models = data.data.map(m => m.id).sort();
                    } else if (Array.isArray(data)) {
                        models = data.map(m => m.id || m).sort();
                    }

                    if (models.length === 0) throw new Error('未获取到模型列表');

                    // 填充下拉列表
                    if (modelSel) {
                        modelSel.innerHTML = models.map(m =>
                            '<option value="' + m + '"' + (m === state.settings.openaiModel ? ' selected' : '') + '>' + m + '</option>'
                        ).join('');
                        
                        // 如果当前选中的模型不在列表中，选择第一个
                        if (!models.includes(state.settings.openaiModel) && models.length > 0) {
                            state.settings.openaiModel = models[0];
                            modelSel.value = models[0];
                            saveSettings();
                        }
                    }

                    if (statusEl) statusEl.innerHTML = '<span style="color:#10b981">✅ 已获取 ' + models.length + ' 个模型</span>';
                } catch (e) {
                    console.error('[Settings] Fetch models error:', e);
                    if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444">❌ 连接失败: ' + e.message + '</span>';
                } finally {
                    fetchModelsBtn.disabled = false;
                    fetchModelsBtn.textContent = '🔗 连接';
                }
            };
        }

        // Theme Toggle
        const themeBtn = ov.querySelector('#cmSetThemeBtn');
        if (themeBtn) {
            themeBtn.onclick = () => {
                toggleTheme();
                themeBtn.textContent = state.isDarkMode ? '🌙 深色' : '☀️ 浅色';
            };
        }

        // Zoom Control
        const zoomRange = ov.querySelector('#cmSetZoomRange');
        const zoomVal = ov.querySelector('#cmSetZoomVal');
        if (zoomRange && zoomVal) {
            zoomRange.oninput = function() {
                const val = parseInt(this.value);
                zoomVal.textContent = val;
                setZoom(val);
                // Also update the small text in label
                const labelSmall = this.closest('.cm-setting-item').querySelector('small');
                if(labelSmall) labelSmall.textContent = `调整卡片显示的尺寸 (${val}px)`;
            };
        }

        // Sidebar Reset
        const resetSidebarBtn = ov.querySelector('#cmResetSidebarBtn');
        if (resetSidebarBtn) {
            resetSidebarBtn.onclick = () => {
                state.sidebarWidth = 160; // Default
                localStorage.setItem('cm_sidebar_width', 160);
                document.documentElement.style.setProperty('--cm-sidebar-width', '160px');
                notify('侧边栏宽度已重置', 'success');
            };
        }

        // Dropdowns
        const bindSelect = (id, key) => {
            const el = ov.querySelector('#' + id);
            if (el) {
                el.onchange = (e) => {
                    state.settings[key] = e.target.value;
                    saveSettings();
                };
            }
        };
        bindSelect('cmSetDbClick', 'doubleClickAction');
        bindSelect('cmSetDefSort', 'defaultSort');

        // Sync All Tags
        const syncAllTagsBtn = ov.querySelector('#cmSyncAllTagsBtn');
        if (syncAllTagsBtn) {
            syncAllTagsBtn.onclick = async () => {
                if (await showConfirm('确定要将所有插件标签写入角色卡文件吗？\n\n这可能需要一些时间，期间请勿关闭页面。\n建议在网络良好时进行。')) {
                    syncAllTagsBtn.disabled = true;
                    // const originalText = syncAllTagsBtn.textContent;
                    // syncAllTagsBtn.textContent = '准备中...';
                    if (showProgressBar) showProgressBar('准备同步标签...');
                    
                    try {
                        const count = await syncAllTags((current, total) => {
                            // syncAllTagsBtn.textContent = `同步中 (${current}/${total})`;
                            if (updateProgressBar) {
                                const progress = Math.round((current / total) * 100);
                                updateProgressBar(progress, `正在同步标签... ${current}/${total}`, `当前进度: ${progress}%`);
                            }
                        });
                        if (updateProgressBar) updateProgressBar(100, '同步完成！', '正在收尾...');
                        await new Promise(r => setTimeout(r, 800)); // 稍作停顿展示完成状态
                        notify(`已成功同步 ${count} 个角色的标签`, 'success');
                    } catch (e) {
                        console.error(e);
                        notify('同步过程中发生错误，请查看控制台', 'error');
                    } finally {
                        if (hideProgressBar) hideProgressBar();
                        syncAllTagsBtn.disabled = false;
                        // syncAllTagsBtn.textContent = originalText;
                    }
                }
            };
        }

        // Clear Cache
        const clearCacheBtn = ov.querySelector('#cmClearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.onclick = async () => {
                if (await showConfirm('确定要清除所有缓存数据吗？\n下次打开时将重新构建索引。')) {
                    localStorage.removeItem('cm_char_cache');
                    localStorage.removeItem('cm_gallery_count_cache');
                    state.characters = [];
                    state.renderedCount = 0;
                    renderView();
                    notify('缓存已清除', 'success');
                }
            };
        }

        // Reset All
        const resetAllBtn = ov.querySelector('#cmResetAllBtn');
        if (resetAllBtn) {
            resetAllBtn.onclick = async () => {
                if (await showConfirm('确定要恢复所有默认设置吗？')) {
                    state.settings = { ...defaultSettings };
                    saveSettings();
                    
                    // Apply resets
                    if (state.isDarkMode) toggleTheme(); // Reset to light? No, keep current or default?
                    // Let's just reload settings UI
                    ov.remove();
                    showSettingsDialog({ createBaseDialog, toggleTheme, renderView, notify, setZoom, showConfirm });
                    renderView();
                    notify('设置已重置', 'success');
                }
            };
        }
    });
}

// ========== 版权提示与免责声明弹窗 ==========

/**
 * 显示翻译功能的版权提示和免责声明
 * 使用独立 overlay，不会影响底层的设置界面
 * @param {Function} _unused - 保留参数（兼容旧调用）
 * @param {Function} onAccept - 接受回调
 * @param {Function} onReject - 拒绝回调
 */
function showTranslationDisclaimer(_unused, onAccept, onReject) {
    // 移除已有的免责声明弹窗（防止重复）
    const existingDisclaimer = document.querySelector('.cm-disclaimer-overlay');
    if (existingDisclaimer) existingDisclaimer.remove();

    const ov = document.createElement('div');
    ov.className = 'cm-disclaimer-overlay ' + (state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light');
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.7);z-index:200000;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';

    ov.innerHTML = `
        <div style="background:var(--cm-bg-sec);border-radius:16px;max-width:560px;width:100%;max-height:85vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.3)">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--cm-border);flex-shrink:0">
                <h3 style="margin:0;font-size:16px;color:var(--cm-text)">⚠️ 重要提示 / Important Notice</h3>
            </div>
            <div style="padding:16px 20px;overflow-y:auto;flex:1;min-height:0">
                <!-- 中文部分 -->
                <div style="margin-bottom:20px">
                    <h3 style="margin:0 0 12px 0;font-size:16px;color:var(--cm-text);display:flex;align-items:center;gap:8px">
                        ⚠️ 版权提示与免责声明
                    </h3>
                    <div style="font-size:13px;line-height:1.8;color:var(--cm-text);background:var(--cm-bg-ter);padding:14px;border-radius:8px;border-left:3px solid #f59e0b">
                        <p style="margin:0 0 8px 0"><strong>请在使用翻译功能前仔细阅读以下条款：</strong></p>
                        <ol style="margin:0;padding-left:20px">
                            <li style="margin-bottom:6px">翻译功能仅供<strong>个人学习和研究</strong>使用。</li>
                            <li style="margin-bottom:6px">翻译后的角色卡<strong>仅限您个人使用</strong>，严禁以任何形式二次发布、分享、传播。</li>
                            <li style="margin-bottom:6px"><strong>严禁</strong>将翻译后的内容用于任何商业目的，包括但不限于售卖、付费分享、商业展示等。</li>
                            <li style="margin-bottom:6px">请<strong>尊重原作者的创作版权</strong>，翻译行为不代表对原作品的所有权转移。</li>
                            <li style="margin-bottom:6px">使用翻译功能产生的一切后果由用户自行承担，本插件不承担任何法律责任。</li>
                            <li style="margin-bottom:6px">翻译质量受 AI 模型能力限制，可能存在误译、漏译等情况，请自行校对。</li>
                        </ol>
                    </div>
                </div>

                <!-- 英文部分 -->
                <div style="margin-bottom:16px">
                    <h3 style="margin:0 0 12px 0;font-size:16px;color:var(--cm-text);display:flex;align-items:center;gap:8px">
                        ⚠️ Copyright Notice & Disclaimer
                    </h3>
                    <div style="font-size:13px;line-height:1.8;color:var(--cm-text);background:var(--cm-bg-ter);padding:14px;border-radius:8px;border-left:3px solid #3b82f6">
                        <p style="margin:0 0 8px 0"><strong>Please read the following terms carefully before using the translation feature:</strong></p>
                        <ol style="margin:0;padding-left:20px">
                            <li style="margin-bottom:6px">The translation feature is for <strong>personal learning and research purposes only</strong>.</li>
                            <li style="margin-bottom:6px">Translated character cards are <strong>strictly for your personal use</strong>. Any form of redistribution, sharing, or dissemination is <strong>prohibited</strong>.</li>
                            <li style="margin-bottom:6px">It is <strong>strictly forbidden</strong> to use translated content for any commercial purpose, including but not limited to selling, paid sharing, or commercial display.</li>
                            <li style="margin-bottom:6px">Please <strong>respect the original creator's copyright</strong>. Translation does not transfer ownership of the original work.</li>
                            <li style="margin-bottom:6px">Users assume all responsibility for any consequences arising from the use of the translation feature. This plugin bears no legal liability.</li>
                            <li style="margin-bottom:6px">Translation quality is limited by AI model capabilities and may contain errors or omissions. Please proofread the results.</li>
                        </ol>
                    </div>
                </div>

                <!-- 倒计时提示 -->
                <div style="text-align:center;font-size:12px;color:var(--cm-text-sec);margin-top:8px">
                    <span id="cmDisclaimerCountdown">请阅读以上条款，接受按钮将在 <strong>5</strong> 秒后可用</span>
                </div>
            </div>
            <div style="padding:12px 20px;border-top:1px solid var(--cm-border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0">
                <button id="cmDisclaimerReject" class="cm-btn cm-btn-secondary">拒绝 / Decline</button>
                <button id="cmDisclaimerAccept" class="cm-btn cm-btn-primary">接受 (5s) / Accept (5s)</button>
            </div>
        </div>
    `;

    document.body.appendChild(ov);

    const closeDisclaimer = () => ov.remove();

    // 拒绝按钮
    const rejectBtn = ov.querySelector('#cmDisclaimerReject');
    if (rejectBtn) {
        rejectBtn.onclick = () => {
            closeDisclaimer();
            if (onReject) onReject();
        };
    }

    // 接受按钮
    const acceptBtn = ov.querySelector('#cmDisclaimerAccept');
    const countdownEl = ov.querySelector('#cmDisclaimerCountdown');

    if (acceptBtn) {
        acceptBtn.disabled = true;
        acceptBtn.style.opacity = '0.5';
        acceptBtn.style.cursor = 'not-allowed';

        acceptBtn.onclick = () => {
            closeDisclaimer();
            if (onAccept) onAccept();
        };
    }

    let remaining = 5;
    const timer = setInterval(() => {
        remaining--;
        if (countdownEl) {
            if (remaining > 0) {
                countdownEl.innerHTML = `请阅读以上条款，接受按钮将在 <strong>${remaining}</strong> 秒后可用`;
            } else {
                countdownEl.innerHTML = '✅ 您现在可以点击接受按钮 / You may now click Accept';
            }
        }
        if (remaining <= 0) {
            clearInterval(timer);
            if (acceptBtn) {
                acceptBtn.disabled = false;
                acceptBtn.style.opacity = '1';
                acceptBtn.style.cursor = 'pointer';
                acceptBtn.textContent = '接受 / Accept';
            }
        }
    }, 1000);
}