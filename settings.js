import { state, saveSettings, defaultSettings } from './state.js';
import { ICONS } from './constants.js';
import { escapeHtml } from './utils.js';
import { syncAllTags } from './data.js';
import { clearAllCache } from './db.js';
import { galleryCountCache } from './gallery.js';
import manifest from './manifest.json' with { type: 'json' };

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
                        <span>显示悬浮按钮</span>
                        <small>鼠标悬停在卡片上时显示操作按钮</small>
                    </div>
                    <label class="cm-switch">
                        <input type="checkbox" id="cmSetHoverBtns" ${settings.showCardHoverButtons ? 'checked' : ''}>
                        <span class="cm-slider"></span>
                    </label>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>显示卡片注释</span>
                        <small>在卡片列表中显示角色注释</small>
                    </div>
                    <label class="cm-switch">
                        <input type="checkbox" id="cmSetCardNote" ${settings.showCardNote ? 'checked' : ''}>
                        <span class="cm-slider"></span>
                    </label>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>详情页内容显示</span>
                        <small>选择长文本内容的显示方式</small>
                    </div>
                    <select id="cmSetDetailMode" class="cm-select-input">
                        <option value="scroll" ${settings.detailContentMode === 'scroll' ? 'selected' : ''}>↕️ 滚动 (默认)</option>
                        <option value="expand" ${settings.detailContentMode === 'expand' ? 'selected' : ''}>📜 展开全部</option>
                    </select>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>宏替换颜色主题</span>
                        <small>\u8bbe\u7f6e {{user}} \u548c {{char}} \u7684\u9ad8\u4eae\u989c\u8272</small>
                    </div>
                    <select id="cmSetMacroTheme" class="cm-select-input">
                        <option value="dark1" ${settings.macroColorTheme === 'dark1' ? 'selected' : ''}>\u6697\u82721 (\u6696\u6a59 vs \u51b7\u9752)</option>
                        <option value="dark2" ${settings.macroColorTheme === 'dark2' ? 'selected' : ''}>\u6697\u82722 (\u7c89\u8272 vs \u84dd\u8272)</option>
                        <option value="dark3" ${settings.macroColorTheme === 'dark3' ? 'selected' : ''}>\u6697\u82723 (\u84dd\u8272 vs \u7c89\u8272)</option>
                        <option value="dark4" ${settings.macroColorTheme === 'dark4' ? 'selected' : ''}>\u6697\u82724 (\u91d1\u8272 vs \u7d2b\u8272)</option>
                        <option value="dark5" ${settings.macroColorTheme === 'dark5' ? 'selected' : ''}>\u6697\u82725 (\u5929\u84dd vs \u8584\u8377\u7eff)</option>
                        <option value="dark6" ${settings.macroColorTheme === 'dark6' ? 'selected' : ''}>\u6697\u82726 (\u7c89\u7ea2 vs \u9752\u7eff)</option>
                        <option value="light1" ${settings.macroColorTheme === 'light1' ? 'selected' : ''}>\u4eae\u82721 (\u6df1\u6a59 vs \u6df1\u9752)</option>
                        <option value="light2" ${settings.macroColorTheme === 'light2' ? 'selected' : ''}>\u4eae\u82722 (\u6df1\u84dd vs \u6df1\u7d2b)</option>
                        <option value="custom" ${settings.macroColorTheme === 'custom' ? 'selected' : ''}>自定义</option>
                    </select>
                </div>
                
                <div id="cmCustomMacroColorWrap" style="display:${settings.macroColorTheme === 'custom' ? 'block' : 'none'};padding:10px;background:var(--cm-bg-ter);border-radius:8px;margin-bottom:12px;">
                    <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
                        <label style="font-size:12px;color:var(--cm-text-sec);width:60px;">{{user}}</label>
                        <input type="color" id="cmSetCustomUserColor" value="${settings.customUserColor || '#FB923C'}" style="cursor:pointer;background:none;border:none;padding:0;width:30px;height:30px;">
                    </div>
                    <div style="display:flex;gap:10px;align-items:center;">
                        <label style="font-size:12px;color:var(--cm-text-sec);width:60px;">{{char}}</label>
                        <input type="color" id="cmSetCustomCharColor" value="${settings.customCharColor || '#22D3EE'}" style="cursor:pointer;background:none;border:none;padding:0;width:30px;height:30px;">
                    </div>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>引号内容颜色主题</span>
                        <small>设置中文和英文引号内内容的高亮颜色</small>
                    </div>
                    <select id="cmSetQuoteTheme" class="cm-select-input">
                        <option value="moonMist" ${settings.quoteColorTheme === 'moonMist' ? 'selected' : ''}>月雾灰蓝 (默认)</option>
                        <option value="seaSalt" ${settings.quoteColorTheme === 'seaSalt' ? 'selected' : ''}>海盐青灰</option>
                        <option value="lavender" ${settings.quoteColorTheme === 'lavender' ? 'selected' : ''}>薰衣草影</option>
                        <option value="amber" ${settings.quoteColorTheme === 'amber' ? 'selected' : ''}>琥珀微光</option>
                        <option value="mint" ${settings.quoteColorTheme === 'mint' ? 'selected' : ''}>薄荷苔绿</option>
                        <option value="wisteria" ${settings.quoteColorTheme === 'wisteria' ? 'selected' : ''}>紫藤轻语</option>
                        <option value="iceLake" ${settings.quoteColorTheme === 'iceLake' ? 'selected' : ''}>冰湖浅青</option>
                        <option value="morningStar" ${settings.quoteColorTheme === 'morningStar' ? 'selected' : ''}>晨星银</option>
                        <option value="custom" ${settings.quoteColorTheme === 'custom' ? 'selected' : ''}>自定义</option>
                    </select>
                </div>
                
                <div id="cmCustomQuoteColorWrap" style="display:${settings.quoteColorTheme === 'custom' ? 'block' : 'none'};padding:10px;background:var(--cm-bg-ter);border-radius:8px;margin-bottom:12px;">
                    <div style="display:flex;gap:10px;align-items:center;">
                        <label style="font-size:12px;color:var(--cm-text-sec);width:60px;">引号</label>
                        <input type="color" id="cmSetCustomQuoteColor" value="${settings.customQuoteColor || '#94A3B8'}" style="cursor:pointer;background:none;border:none;padding:0;width:30px;height:30px;">
                    </div>
                </div>

                <div id="cmMacroPreviewCard" style="padding:12px;border:1px solid var(--cm-border);border-radius:10px;background:var(--cm-bg-sec);margin-bottom:12px;">
                    <h3 style="margin:0 0 10px 0;font-size:13px;color:var(--cm-text);font-weight:600;">染色预览</h3>
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--cm-border);">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span id="cmPreviewUserSwatch" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#FB923C;"></span>
                            <span style="font-size:12px;color:var(--cm-text);">{{user}}</span>
                        </div>
                        <span id="cmPreviewUserHex" style="font-size:12px;color:var(--cm-text-sec);">#FB923C</span>
                    </div>
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--cm-border);">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span id="cmPreviewCharSwatch" style="display:inline-block;width:12px;height:12px;border-radius:50%;background:#22D3EE;"></span>
                            <span style="font-size:12px;color:var(--cm-text);">{{char}}</span>
                        </div>
                        <span id="cmPreviewCharHex" style="font-size:12px;color:var(--cm-text-sec);">#22D3EE</span>
                    </div>
                    <div style="margin-top:10px;font-size:12px;line-height:1.7;color:var(--cm-text);">
                        对话示例：<br>
                        <span id="cmPreviewCharToken" style="font-weight:700;color:#22D3EE;">{{char}}</span>：<span id="cmPreviewQuoteToken" style="color:#94A3B8;">"你好，今天想聊什么？"</span><br>
                        <span id="cmPreviewUserToken2" style="font-weight:700;color:#FB923C;">{{user}}</span>：<span id="cmPreviewQuoteToken2" style="color:#94A3B8;">「嗯……让我想想」</span>你陷入了沉思。
                    </div>
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
                        <span>扫描/导入批次大小</span>
                        <small>全量刷新和批量导入标签时的并发数量 (${settings.scanBatchSize || 15})<br><span style="color:var(--cm-text-sec);font-size:11px;">⚠️ 过高可能导致卡顿或请求失败</span></small>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px">
                        <input type="range" id="cmSetScanBatchSize" min="5" max="50" step="5" value="${settings.scanBatchSize || 15}" style="width:100px">
                        <span id="cmSetScanBatchSizeVal" style="font-size:12px;width:30px;text-align:right">${settings.scanBatchSize || 15}</span>
                    </div>
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
            </div>

            <!-- 标签设置 -->
            <div class="cm-settings-group">
                <h4 class="cm-settings-title">${ICONS.tag || '🏷️'} 标签设置</h4>
                
                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>同步插件标签到原生标签</span>
                        <small>修改标签时同步写入角色卡的原生标签字段，影响酒馆原生和其他插件的标签读取</small>
                    </div>
                    <label class="cm-switch">
                        <input type="checkbox" id="cmSetAutoSyncTags" ${settings.autoSyncTags ? 'checked' : ''}>
                        <span class="cm-slider"></span>
                    </label>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>全量同步插件标签到原生标签</span>
                        <small>将插件标签写入所有角色卡的原生标签字段</small>
                    </div>
                    <button id="cmSyncAllTagsBtn" class="cm-btn cm-btn-secondary">立即同步</button>
                </div>

                <div class="cm-setting-item">
                    <div class="cm-setting-label">
                        <span>从原生标签批量导入到插件标签</span>
                        <small>将所有角色卡原生标签字段中的标签导入到插件管理中</small>
                    </div>
                    <button id="cmBatchImportTagsBtn" class="cm-btn cm-btn-secondary">批量导入</button>
                </div>
            </div>

            <!-- 翻译设置 -->
            <div class="cm-settings-group">
                <h4 class="cm-settings-title">${ICONS.translate || '🌐'} 翻译设置</h4>
                
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
                     ${getTranslationSettingsHTML(settings)}
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
                        <small class="cm-about-note">角色卡管理器 小鱼改版 v${manifest.version}</small>
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
                    if (key === 'showCardHoverButtons') {
                         document.getElementById('charManagerModal')?.classList.toggle('cm-hide-hover-btns', !e.target.checked);
                    }
                    if (key === 'showCardNote') {
                         document.getElementById('charManagerModal')?.classList.toggle('cm-hide-card-note', !e.target.checked);
                    }
                };
            }
        };

        bindCheck('cmSetGallery', 'showGalleryBadge');
        bindCheck('cmSetToken', 'showTokenBadge');
        bindCheck('cmSetAuthor', 'showAuthor');
        bindCheck('cmSetHoverBtns', 'showCardHoverButtons');
        bindCheck('cmSetCardNote', 'showCardNote');
        bindCheck('cmSetAutoScan', 'autoScan');
        bindCheck('cmSetAutoSyncTags', 'autoSyncTags');
        bindCheck('cmSetDebugMode', 'debugMode');

        // 扫描批次大小滑块
        const scanBatchSizeSlider = ov.querySelector('#cmSetScanBatchSize');
        const scanBatchSizeVal = ov.querySelector('#cmSetScanBatchSizeVal');
        if (scanBatchSizeSlider && scanBatchSizeVal) {
            scanBatchSizeSlider.oninput = (e) => {
                scanBatchSizeVal.textContent = e.target.value;
            };
            scanBatchSizeSlider.onchange = async (e) => {
                const newValue = parseInt(e.target.value, 10);
                // 当批次大小超过 25 时显示风险警告
                if (newValue > 25) {
                    const confirmed = await showConfirm(
                        `批次大小设置为 ${newValue} 可能导致：\n\n` +
                        `• 服务器压力过大，触发限流\n` +
                        `• 内存占用过高，页面卡顿\n` +
                        `• 网络请求失败率增加\n\n` +
                        `确定要使用此设置吗？`
                    );
                    if (!confirmed) {
                        // 用户取消，恢复到建议值 25
                        e.target.value = 25;
                        scanBatchSizeVal.textContent = '25';
                        state.settings.scanBatchSize = 25;
                        saveSettings();
                        return;
                    }
                }
                state.settings.scanBatchSize = newValue;
                saveSettings();
            };
        }
        
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

        // 绑定翻译设置事件
        bindTranslationSettingsEvents(ov, () => {
            // 重新打开设置界面以刷新翻译设置区域的语言
            ov.remove();
            showSettingsDialog({ createBaseDialog, toggleTheme, renderView, notify, setZoom, showConfirm });
        }, notify);

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
        bindSelect('cmSetDefSort', 'defaultSort');
        bindSelect('cmSetDetailMode', 'detailContentMode');

        // Macro Color Theme
        const macroThemeSelect = ov.querySelector('#cmSetMacroTheme');
        const customMacroWrap = ov.querySelector('#cmCustomMacroColorWrap');

        const getMacroPreviewColors = (theme, customChar, customUser) => {
            if (theme === 'custom') return { char: customChar || '#22D3EE', user: customUser || '#FB923C' };
            const map = {
                dark1: { char: '#22D3EE', user: '#FB923C' },
                dark2: { char: '#60A5FA', user: '#F472B6' },
                dark3: { char: '#F472B6', user: '#60A5FA' },
                dark4: { char: '#A855F7', user: '#F59E0B' },
                dark5: { char: '#34D399', user: '#60A5FA' },
                dark6: { char: '#14B8A6', user: '#FB7185' },
                light1: { char: '#0F766E', user: '#C2410C' },
                light2: { char: '#6D28D9', user: '#1D4ED8' },
            };
            return map[theme] || map.dark1;
        };

        const getQuotePreviewColor = (quoteTheme, customQuote) => {
            if (quoteTheme === 'custom') return customQuote || '#94A3B8';
            // 新版预设颜色映射
            const map = {
                moonMist: '#94A3B8',    // 月雾灰蓝 (默认)
                seaSalt: '#67B7C2',     // 海盐青灰
                lavender: '#A3A1D6',    // 薰衣草影
                amber: '#E5C07B',       // 琥珀微光
                mint: '#7BDCB5',        // 薄荷苔绿
                wisteria: '#C4B5FD',    // 紫藤轻语
                iceLake: '#A5F3FC',     // 冰湖浅青
                morningStar: '#CBD5E1', // 晨星银
                // 兼容旧版设置的颜色映射
                purple: '#A3A1D6',      // 紫色 -> 薰衣草影
                blue: '#67B7C2',        // 蓝色 -> 海盐青灰
                green: '#7BDCB5',       // 绿色 -> 薄荷苔绿
                orange: '#E5C07B',      // 橙色 -> 琥珀微光
                pink: '#C4B5FD'         // 粉色 -> 紫藤轻语
            };
            return map[quoteTheme] || map.moonMist;
        };

        const updateMacroPreview = () => {
            const colors = getMacroPreviewColors(state.settings.macroColorTheme || 'dark1', state.settings.customCharColor, state.settings.customUserColor);
            const quoteColor = getQuotePreviewColor(state.settings.quoteColorTheme || 'moonMist', state.settings.customQuoteColor);
            const userSwatch = ov.querySelector('#cmPreviewUserSwatch');
            const charSwatch = ov.querySelector('#cmPreviewCharSwatch');
            const userHex = ov.querySelector('#cmPreviewUserHex');
            const charHex = ov.querySelector('#cmPreviewCharHex');
            const userToken = ov.querySelector('#cmPreviewUserToken');
            const charToken = ov.querySelector('#cmPreviewCharToken');
            const quoteToken = ov.querySelector('#cmPreviewQuoteToken');
            const quoteToken2 = ov.querySelector('#cmPreviewQuoteToken2');
            const userToken2 = ov.querySelector('#cmPreviewUserToken2');
            if (userSwatch) userSwatch.style.background = colors.user;
            if (charSwatch) charSwatch.style.background = colors.char;
            if (userHex) userHex.textContent = (colors.user || '').toUpperCase();
            if (charHex) charHex.textContent = (colors.char || '').toUpperCase();
            if (userToken) userToken.style.color = colors.user;
            if (charToken) charToken.style.color = colors.char;
            if (userToken2) userToken2.style.color = colors.user;
            if (quoteToken) quoteToken.style.color = quoteColor;
            if (quoteToken2) quoteToken2.style.color = quoteColor;
        };

        if (macroThemeSelect) {
            macroThemeSelect.onchange = (e) => {
                state.settings.macroColorTheme = e.target.value;
                saveSettings();
                if (customMacroWrap) {
                    customMacroWrap.style.display = e.target.value === 'custom' ? 'block' : 'none';
                }
                updateMacroPreview();
                renderView();
            };
        }
        
        // 引号主题选择事件处理
        const quoteThemeSelect = ov.querySelector('#cmSetQuoteTheme');
        const customQuoteWrap = ov.querySelector('#cmCustomQuoteColorWrap');
        
        if (quoteThemeSelect) {
            quoteThemeSelect.onchange = (e) => {
                state.settings.quoteColorTheme = e.target.value;
                saveSettings();
                if (customQuoteWrap) {
                    customQuoteWrap.style.display = e.target.value === 'custom' ? 'block' : 'none';
                }
                updateMacroPreview();
                renderView();
            };
        }
        
        const bindColor = (id, key) => {
            const el = ov.querySelector('#' + id);
            if (el) {
                const handler = (e) => {
                    state.settings[key] = e.target.value;
                    saveSettings();
                    updateMacroPreview();
                    renderView();
                };
                el.onchange = handler;
                el.oninput = handler;
            }
        };
        bindColor('cmSetCustomUserColor', 'customUserColor');
        bindColor('cmSetCustomCharColor', 'customCharColor');
        bindColor('cmSetCustomQuoteColor', 'customQuoteColor');
        updateMacroPreview();

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

        // Batch Import Tags
        const batchImportTagsBtn = ov.querySelector('#cmBatchImportTagsBtn');
        if (batchImportTagsBtn) {
            batchImportTagsBtn.onclick = async () => {
                const strategyHtml = `
                    <div style="margin-bottom: 10px;">请选择导入策略：</div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label><input type="radio" name="importStrategy" value="merge" checked> <b>合并</b> (保留现有插件标签，追加原生标签)</label>
                        <label><input type="radio" name="importStrategy" value="overwrite"> <b>覆盖</b> (清除现有插件标签，完全使用原生标签)</label>
                        <label><input type="radio" name="importStrategy" value="skip"> <b>跳过</b> (仅为没有插件标签的角色导入)</label>
                    </div>
                `;
                
                createBaseDialog('批量导入标签', strategyHtml, [
                    { text: '取消', id: 'cmBatchImportCancel', cls: 'cm-btn-secondary', onClick: (dlg, close) => close() },
                    { text: '开始导入', id: 'cmBatchImportConfirm', cls: 'cm-btn-primary', onClick: async (dlg, close) => {
                        const strategy = dlg.querySelector('input[name="importStrategy"]:checked').value;
                        close();
                        
                        batchImportTagsBtn.disabled = true;
                        // batchImportTagsBtn.textContent = '导入中...';
                        if (showProgressBar) showProgressBar('准备导入标签...');
                        
                        try {
                            const { batchImportDataTags } = await import('./st-tags.js');
                            const stats = await batchImportDataTags(strategy, (current, total, statsObj) => {
                                // batchImportTagsBtn.textContent = `导入中... ${current}/${total}`;
                                if (updateProgressBar) {
                                    const progress = Math.round((current / total) * 100);
                                    const subText = statsObj
                                        ? `更新: ${statsObj.updated} | 跳过: ${statsObj.skipped} | 回源: ${statsObj.fetched} | 新建: ${statsObj.created}`
                                        : `当前进度: ${progress}%`;
                                    updateProgressBar(progress, `正在导入标签... ${current}/${total}`, subText);
                                }
                            });
                            if (updateProgressBar) updateProgressBar(100, '导入完成！', '正在刷新界面...');
                            await new Promise(r => setTimeout(r, 800));
                            
                            // 显示详细统计结果
                            const resultMsg = `导入完成：更新 ${stats.updated} | 跳过 ${stats.skipped} | 回源 ${stats.fetched} | 新建标签 ${stats.created}${stats.errors > 0 ? ` | 错误 ${stats.errors}` : ''}`;
                            notify(resultMsg, stats.errors > 0 ? 'warning' : 'success');
                            
                            // 刷新界面
                            renderView();
                            // renderTagSidebar(); // renderView 内部可能已经调用了，或者需要单独调用
                            // 重新加载侧边栏需要获取最新的 tagMap
                            const { renderTagSidebar } = await import('./index.js');
                            renderTagSidebar();
                        } catch (e) {
                            console.error(e);
                            notify('导入失败: ' + e.message, 'error');
                        } finally {
                            if (hideProgressBar) hideProgressBar();
                            batchImportTagsBtn.disabled = false;
                            // batchImportTagsBtn.textContent = '批量导入';
                        }
                    }}
                ]);
            };
        }

        // Clear Cache
        const clearCacheBtn = ov.querySelector('#cmClearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.onclick = async () => {
                if (await showConfirm('确定要清除所有缓存数据吗？\n下次打开时将重新构建索引。')) {
                    // 清除 IndexedDB 中的所有缓存 (characters, cm_char_cache, hasUnsyncedTags 等)
                    const clearedKeys = await clearAllCache();
                    
                    // 清除 LocalStorage 中的遗留键
                    const localStorageKeys = [
                        'cm_char_cache',
                        'cm_gallery_count_cache',
                        'cm_hasUnsyncedTags'
                    ];
                    localStorageKeys.forEach(key => localStorage.removeItem(key));
                    
                    // 重置状态
                    state.characters = [];
                    state.renderedCount = 0;
                    state.hasUnsyncedTags = false;
                    if (state.unsyncedCards) state.unsyncedCards.clear();
                    
                    // 重置画廊计数缓存（使用顶部静态导入）
                    Object.keys(galleryCountCache).forEach(key => delete galleryCountCache[key]);
                    
                    renderView();
                    notify(`缓存已清除 (IndexedDB: ${clearedKeys.length} 项, LocalStorage: ${localStorageKeys.length} 项)`, 'success');
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

// ========== 翻译设置独立模块 ==========

/**
 * 获取翻译设置的 HTML 内容
 * @param {object} settings - 当前设置对象
 * @returns {string} HTML 字符串
 */
function getTranslationSettingsHTML(settings) {
    return `
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

            <!-- Debug Mode Switch -->
            <div class="cm-setting-item" style="margin:0;margin-bottom:8px">
                <div class="cm-setting-label">
                    <span style="font-size:12px">Debug Mode</span>
                    <small>${settings.translationUILanguage === 'en' ? 'Output raw API requests/responses to console' : '在控制台输出原始 API 请求和响应信息'}</small>
                </div>
                <label class="cm-switch" style="transform:scale(0.8);margin-right:-5px">
                    <input type="checkbox" id="cmSetDebugMode" ${settings.debugMode ? 'checked' : ''}>
                    <span class="cm-slider"></span>
                </label>
            </div>

            <!-- Retry Count -->
            <div class="cm-setting-item" style="margin:0;margin-bottom:8px">
                <div class="cm-setting-label">
                    <span style="font-size:12px" data-tl-key="settingRetryCount">${settings.translationUILanguage === 'en' ? 'Retry Count on Failure' : '失败重试次数'}</span>
                    <small>${settings.translationUILanguage === 'en' ? 'Number of times to retry when translation fails (e.g. 429 errors)' : '翻译失败时（如 429 错误）自动重试的次数'}</small>
                </div>
                <input type="number" id="cmSetRetryCount" class="cm-input" value="${settings.retryCount || 0}" min="0" max="10" style="width:60px;box-sizing:border-box;text-align:center">
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
    `;
}

/**
 * 绑定翻译设置的事件
 * @param {HTMLElement} ov - 包含设置元素的容器
 * @param {Function} onUILangChange - UI 语言改变时的回调
 * @param {Function} notify - 通知函数
 */
function bindTranslationSettingsEvents(ov, onUILangChange, notify) {
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

    // UI 语言切换
    const transUILangSelect = ov.querySelector('#cmSetTransUILang');
    if (transUILangSelect) {
        transUILangSelect.onchange = (e) => {
            state.settings.translationUILanguage = e.target.value;
            saveSettings();
            if (onUILangChange) onUILangChange();
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
            if (notify) notify('System Prompt 已恢复默认', 'success');
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

    // 重试次数
    const retryCountInput = ov.querySelector('#cmSetRetryCount');
    if (retryCountInput) {
        retryCountInput.onchange = (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < 0) val = 0;
            if (val > 10) val = 10;
            e.target.value = val;
            state.settings.retryCount = val;
            saveSettings();
        };
    }

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
}

/**
 * 独立显示翻译设置弹窗
 * @param {Function} createBaseDialog - 创建弹窗的函数
 * @param {Function} notify - 通知函数
 * @param {Function} onSettingsChanged - 设置改变时的回调（可选）
 */
export function showTranslationSettingsDialog(createBaseDialog, notify, onSettingsChanged) {
    const settings = state.settings;
    
    const content = `
        <div class="cm-settings-container" style="padding: 10px 0;">
            <div id="cmTransSettings" style="padding:10px;background:var(--cm-bg-ter);border-radius:8px;">
                ${getTranslationSettingsHTML(settings)}
            </div>
        </div>
    `;

    createBaseDialog('⚙️ 翻译设置', content, [
        {
            text: '关闭',
            cls: 'cm-btn-primary',
            onClick: (ov, close) => {
                saveSettings();
                if (onSettingsChanged) onSettingsChanged();
                close();
            }
        }
    ], (ov) => {
        bindTranslationSettingsEvents(ov, () => {
            // UI 语言改变时，重新打开弹窗以刷新文本
            ov.remove();
            showTranslationSettingsDialog(createBaseDialog, notify, onSettingsChanged);
            if (onSettingsChanged) onSettingsChanged();
        }, notify);
    }, { stack: true });
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
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;min-height:100dvh;background:rgba(0,0,0,0.7);z-index:' + Z_INDEX.MODAL_LOADING + ';display:flex;align-items:center;justify-content:center;padding:calc(20px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right)) calc(20px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));box-sizing:border-box'; /* 阻断级: 免责声明弹窗 */

    ov.innerHTML = `
        <div style="background:var(--cm-bg-sec);border-radius:16px;max-width:560px;width:100%;max-height:calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 40px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.3)">
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