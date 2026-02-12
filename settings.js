import { state, saveSettings, defaultSettings } from './state.js';
import { ICONS } from './constants.js';

export function showSettingsDialog({ createBaseDialog, toggleTheme, renderView, notify, setZoom, showConfirm }) {
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
                    <div class="cm-setting-item">
                        <div class="cm-setting-label">
                            <span>API 协议</span>
                            <small>选择翻译使用的 API 类型</small>
                        </div>
                        <select id="cmSetTransApi" class="cm-select-input">
                            <option value="openai" ${settings.translationApi === 'openai' ? 'selected' : ''}>OpenAI Compatible</option>
                            <option value="tavern" ${settings.translationApi === 'tavern' ? 'selected' : ''}>酒馆原生 (实验性)</option>
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
                            <label style="display:block;font-size:12px;margin-bottom:4px;color:var(--cm-text-sec)">模型</label>
                            <div style="display:flex;gap:6px;align-items:center">
                                <select id="cmSetOpenaiModel" class="cm-select-input" style="flex:1;min-width:0">
                                    ${settings.openaiModel ? '<option value="' + settings.openaiModel + '" selected>' + settings.openaiModel + '</option>' : '<option value="">请先连接获取模型列表</option>'}
                                </select>
                                <button id="cmSetFetchModels" class="cm-btn cm-btn-primary" style="flex-shrink:0;font-size:12px;padding:6px 12px;white-space:nowrap">🔗 连接</button>
                            </div>
                            <div id="cmSetModelStatus" style="font-size:11px;margin-top:4px;color:var(--cm-text-sec)"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 数据管理 -->
            <div class="cm-settings-group">
                <h4 class="cm-settings-title">${ICONS.database || '💾'} 数据与存储</h4>
                
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

        // Translation Settings
        const transCheck = ov.querySelector('#cmSetTrans');
        const transSettings = ov.querySelector('#cmTransSettings');
        if (transCheck && transSettings) {
            transCheck.onchange = (e) => {
                state.settings.translationEnabled = e.target.checked;
                saveSettings();
                transSettings.style.display = e.target.checked ? 'block' : 'none';
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