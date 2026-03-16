/**
 * 角色详情页模块 (UI Details)
 * 负责渲染角色详情弹窗，采用固定头部 + 标签页布局
 */
import { doc, parentWin, getSTContext, getSTCharacters } from './context.js';
import { state } from './state.js';
import { ICONS, Z_INDEX } from './constants.js';
import { escapeHtml, formatSize, notify, parsePNG, formatRichText } from './utils.js';
import { createBaseDialog, showConfirm, showDeleteConfirm } from './ui-utils.js';
import { getCharHistoryCount, getCharChatHistory, saveCharacterData, renameCharacterFile, replaceCharacterImage, downloadChar, updateCharacter, toggleFavorite, getCharTags, removeTagFromChar, addTagToChar, createTag, deleteChar, deleteWorldInfo, updateCharacterVersion, deleteChatFile, persistCharacterState } from './data.js';
import { getCmManager, migrateToCmManager } from './st-tags.js';
import { authFetch } from './api.js';
import { renderView, renderTagSidebar, updateCreatorComment, closeModal } from './index.js';
import { getGalleryItems, showGallery, renderGallery } from './gallery.js';
import { openTranslationDialog } from './translation/translation-ui.js';
import { calculateTokens } from './utils.js';
import { resolveDetailPageCoverDisplay } from './utils/cover-display.js';

/**
 * 从 SillyTavern 上下文获取指定函数
 * @param {string} name - 函数名称
 * @returns {Function|null}
 */
function getSTFunction(name) {
    const ctx = getSTContext();
    if (ctx && typeof ctx[name] === 'function') {
        return ctx[name];
    }
    if (parentWin && typeof parentWin[name] === 'function') {
        return parentWin[name];
    }
    return null;
}

/**
 * 获取 SillyTavern 的 selectCharacterById 函数用于切换角色
 * @returns {Function|null}
 */
function getSelectCharacterById() {
    return getSTFunction('selectCharacterById');
}

/**
 * 获取 SillyTavern 的 openCharacterChat 函数用于打开或创建聊天
 * @returns {Function|null}
 */
function getOpenCharacterChat() {
    return getSTFunction('openCharacterChat');
}

/**
 * 获取 humanizedDateTime 函数用于生成聊天文件名
 * @returns {Function|null}
 */
function getHumanizedDateTime() {
    const ctx = getSTContext();
    if (ctx && typeof ctx.humanizedDateTime === 'function') {
        return ctx.humanizedDateTime;
    }
    if (parentWin && typeof parentWin.humanizedDateTime === 'function') {
        return parentWin.humanizedDateTime;
    }
    return null;
}

// 标签页定义
const TABS = [
    { id: 'details', label: '详情', icon: ICONS.menu },
    { id: 'greetings', label: '开场白', icon: ICONS.chat },
    { id: 'history', label: '聊天记录', icon: ICONS.time },
    { id: 'extended', label: '扩展', icon: ICONS.settings },
    { id: 'edit', label: '编辑', icon: ICONS.pencil }
];

export class CharacterDetails {
    constructor(char) {
        this.char = char;
        this.overlay = null;
        this.container = null;
        this.currentTab = 'details';
        this.tabContents = {};
        this.viewMode = localStorage.getItem('cm_detail_view_mode') || 'tabs'; // 'tabs' | 'legacy'
    }

    show() {
        state.currentDetailChar = this.char;
        
        // 移除旧的详情页
        const existing = doc.querySelector('.cm-detail-overlay');
        if (existing) existing.remove();

        // 创建遮罩层
        this.overlay = doc.createElement('div');
        this.overlay.className = state.isDarkMode ? 'cm-detail-overlay cm-theme-dark' : 'cm-detail-overlay cm-theme-light';
        
        // 防止误触关闭
        let isMouseDownOnOverlay = false;
        this.overlay.onmousedown = (e) => {
            isMouseDownOnOverlay = (e.target === this.overlay);
        };
        this.overlay.onclick = (e) => {
            if (e.target === this.overlay && isMouseDownOnOverlay) {
                this.close();
            }
            isMouseDownOnOverlay = false;
        };

        // 创建主容器
        this.container = doc.createElement('div');
        this.container.className = 'cm-detail';
        if (this.viewMode === 'legacy') {
            this.container.classList.add('cm-detail-legacy');
        }

        // 渲染内容区域容器（先创建滚动容器）
        const contentBody = doc.createElement('div');
        contentBody.className = 'cm-detail-body';
        this.container.appendChild(contentBody);
        
        // 渲染固定头部（移到滚动容器内部）
        this.renderHeader();
        contentBody.appendChild(this.container.querySelector('.cm-detail-header'));

        // 关键修复：先将 overlay 添加到 DOM，确保 getComputedStyle 能正确获取 CSS 变量
        this.overlay.appendChild(this.container);
        // 保存实例引用，用于外部刷新
        this.overlay.__detailInstance = this;
        doc.body.appendChild(this.overlay);

        // 创建回顶按钮
        const backToTopBtn = doc.createElement('div');
        backToTopBtn.className = 'cm-back-to-top';
        backToTopBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
        backToTopBtn.onclick = () => {
            contentBody.scrollTo({ top: 0, behavior: 'smooth' });
        };
        this.container.appendChild(backToTopBtn);

        // 滚动监听
        contentBody.addEventListener('scroll', () => {
            const scrollTop = contentBody.scrollTop;
            const scrollHeight = contentBody.scrollHeight;
            const clientHeight = contentBody.clientHeight;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
            
            // 显示/隐藏回顶按钮
            if (scrollTop > 50) {
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
            }
            
            // 只有滚动到底部且存在备选开场白时才抬高按钮
            if (isNearBottom && this.checkAltGreetingsAtBottom()) {
                this.container.classList.add('has-alt-greetings-at-bottom');
            } else {
                this.container.classList.remove('has-alt-greetings-at-bottom');
            }
        }, { passive: true });

        if (this.viewMode === 'legacy') {
            // 旧版视图渲染
            this.renderLegacyView(contentBody);
        } else {
            // 新版标签页视图
            this.renderTabs();
            
            // 初始化各标签页容器
            TABS.forEach(tab => {
                const tabContent = doc.createElement('div');
                tabContent.className = `cm-tab-content cm-tab-${tab.id}`;
                tabContent.style.display = 'none';
                contentBody.appendChild(tabContent);
                this.tabContents[tab.id] = tabContent;
            });

// 渲染各标签页内容
            this.renderDetailsTab();
            this.renderGreetingsTab();
            this.renderHistoryTab();
            this.renderExtendedTab();
            this.renderEditTab();

            // 激活默认标签页
            this.switchTab(this.currentTab);
            
            // 左右滑动切换支持
            this.bindSwipeEvents(contentBody);
        }

        // Android 返回键支持
        this.pushHistoryState();

        // 异步加载完整数据
        this.loadFullData();
    }

    async loadFullData() {
        try {
            const response = await authFetch('/api/characters/get', {
                method: 'POST',
                body: JSON.stringify({ avatar_url: this.char.fileName })
            });
            if (response.ok) {
                const fullData = await response.json();
                
                let charData = fullData;
                if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
                    charData = fullData.data;
                }
                
                // 合并数据
                Object.assign(this.char, charData);
                
                // 刷新视图
                if (this.viewMode === 'legacy') {
                    const body = this.container.querySelector('.cm-detail-body');
                    if (body) {
                        body.innerHTML = '';
                        // 先重新渲染 header（经典视图也需要顶部栏）
                        this.renderHeader();
                        body.appendChild(this.container.querySelector('.cm-detail-header'));
                        this.renderLegacyView(body);
                    }
                } else {
                    this.renderDetailsTab();
                    this.renderGreetingsTab();
                    this.renderHistoryTab();
                    this.renderExtendedTab();
                    this.renderEditTab();
                }
            }
        } catch (e) {
            console.warn('Failed to load full character data', e);
        }
    }

    toggleViewMode() {
        this.viewMode = this.viewMode === 'tabs' ? 'legacy' : 'tabs';
        localStorage.setItem('cm_detail_view_mode', this.viewMode);
        this.show(); // 重新渲染
    }

    async launchChat(chatFile = null) {
        if (chatFile === null) {
            // 检查历史记录
            const history = await getCharChatHistory(this.char);
            if (history && history.length > 0) {
                // 显示选择对话框
                let html = '<div class="cm-chat-history-list" style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">';
                
                // 新对话选项
                html += `<div class="cm-history-item new-chat" style="padding:12px;border:1px dashed var(--cm-accent);border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:10px;color:var(--cm-accent-text);background:var(--cm-accent-bg)">
                    <div style="font-size:20px;font-weight:bold">+</div>
                    <div style="font-weight:bold">开始新对话</div>
                </div>`;

                history.forEach(h => {
                    const dateStr = h.last_mes ? new Date(h.last_mes).toLocaleString() : '未知时间';
                    const base = this.char.fileName.replace(/\.[^/.]+$/, "");
                    let chatName = h.file_name.replace(base + ' - ', '').replace(/\.jsonl$/i, '');
                    if (chatName === h.file_name) chatName = h.file_name;

                    html += `<div class="cm-history-item" data-file="${escapeHtml(h.file_name)}" style="padding:10px;border:1px solid var(--cm-border);border-radius:8px;cursor:pointer;background:var(--cm-bg-ter);transition:all 0.2s">
                        <div style="font-weight:bold;margin-bottom:4px">${escapeHtml(chatName)}</div>
                        <div style="font-size:12px;color:var(--cm-text-sec)">${dateStr} · ${h.chat_items}条 · ${h.file_size}</div>
                    </div>`;
                });
                html += '</div>';

                createBaseDialog('选择聊天存档', html, [
                    { text: '取消', cls: 'cm-btn-secondary', onClick: (ov, close) => close() }
                ], (ov, close) => {
                    // 绑定点击事件
                    ov.querySelector('.new-chat').onclick = () => {
                        close();
                        this.launchChat('');
                    };
                    ov.querySelectorAll('.cm-history-item[data-file]').forEach(el => {
                        el.onclick = () => {
                            close();
                            this.launchChat(el.dataset.file);
                        };
                    });
                });
                return;
            } else {
                // 无历史记录，直接开始新对话
                // 【修复】只调用 selectCharacterById，它会自动创建聊天，避免重复创建
                this.close();
                closeModal();

                // 获取角色索引
                const targetFileName = this.char.fileName;
                const stChars = getSTCharacters();
                const chIndex = stChars.findIndex(c => c.avatar === targetFileName);

                if (chIndex === -1) {
                    console.error('[CharManager] 角色未找到:', targetFileName);
                    notify('启动失败：内存中未找到该角色', 'error');
                    return;
                }

                // 切换到该角色，SillyTavern 会自动创建新聊天
                const selectChar = getSelectCharacterById();
                if (selectChar) {
                    await selectChar(chIndex);
                    notify('已启动角色', 'success');
                } else {
                    console.error('[CharManager] selectCharacterById not found');
                    notify('启动失败：无法切换角色', 'error');
                }
                return;
            }
        }

        // 开始新对话 vs 加载存档
        if (!chatFile) {
            // 有历史记录，但用户选择开始新对话
            // 这种情况需要 openCharacterChat 来创建额外的聊天
            this.close();
            closeModal();

            // 获取角色索引
            const targetFileName = this.char.fileName;
            const stChars = getSTCharacters();
            const chIndex = stChars.findIndex(c => c.avatar === targetFileName);

            if (chIndex === -1) {
                console.error('[CharManager] 角色未找到:', targetFileName);
                notify('启动失败：内存中未找到该角色', 'error');
                return;
            }

            // 先切换到该角色（设置 this_chid）
            const selectChar = getSelectCharacterById();
            if (selectChar) {
                await selectChar(chIndex);
            }

            // 创建新聊天
            const openChat = getOpenCharacterChat();
            if (openChat) {
                // 生成新聊天文件名：角色名 - 时间戳
                const humanizedDateTime = getHumanizedDateTime();
                const baseName = this.char.fileName.replace(/\.[^/.]+$/, '');
                const newChatFile = `${baseName} - ${humanizedDateTime ? humanizedDateTime() : new Date().toISOString()}`;
                await openChat(newChatFile);
                notify('已创建新对话', 'success');
            } else {
                console.error('[CharManager] openCharacterChat not found');
                notify('启动失败：无法创建新对话', 'error');
            }
            return;
        }

        // 加载存档
        this.close();
        closeModal();

        // 获取角色索引
        const targetFileName = this.char.fileName;
        const stChars = getSTCharacters();
        const chIndex = stChars.findIndex(c => c.avatar === targetFileName);

        if (chIndex === -1) {
            console.error('[CharManager] 角色未找到:', targetFileName);
            notify('启动失败：内存中未找到该角色', 'error');
            return;
        }

        // 先切换到该角色（设置 this_chid）
        const selectChar = getSelectCharacterById();
        if (selectChar) {
            await selectChar(chIndex);
        }

        // 使用 openCharacterChat 加载存档
        const openChat = getOpenCharacterChat();
        if (openChat) {
            // chatFile 需要去掉 .jsonl 后缀
            const chatFileWithoutExt = chatFile.replace(/\.jsonl$/i, '');
            await openChat(chatFileWithoutExt);
            notify('已加载存档: ' + chatFile, 'success');
        } else {
            console.error('[CharManager] openCharacterChat not found');
            notify('启动失败：无法加载存档', 'error');
        }
    }

    renderLegacyView(body) {
        const char = this.char;
        
        // 1. 作者注释 (原备注/注释)
        const commentSection = doc.createElement('div');
        commentSection.className = 'cm-section';
        commentSection.style.borderColor = '#ca8a04';
        
        const commentHeader = doc.createElement('div');
        commentHeader.className = 'cm-section-header';
        commentHeader.style.cssText = 'padding:10px 14px;font-size:13px;color:#ca8a04;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);display:flex;align-items:center;gap:8px';
        
        const commentTitle = doc.createElement('span');
        commentTitle.textContent = '作者注释';
        commentHeader.appendChild(commentTitle);
        
        const commentContentResult = this.createToggleableContent(char.creator_notes || char.creatorcomment || '(无)', 'author-comment');
        const commentContent = commentContentResult.container;
        const commentToggleBtn = commentContentResult.toggleBtn;
        
        // 将按钮放在标题旁边
        commentHeader.appendChild(commentToggleBtn);
        
        commentSection.appendChild(commentHeader);
        commentSection.appendChild(commentContent);
        body.appendChild(commentSection);

        // 1.5 用户备注 (新增)
        const noteSection = doc.createElement('div');
        noteSection.className = 'cm-section';
        noteSection.style.borderColor = '#2563eb';
        
        const noteHeader = doc.createElement('div');
        noteHeader.className = 'cm-section-header';
        noteHeader.style.cssText = 'padding:10px 14px;font-size:13px;color:#2563eb;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);display:flex;align-items:center;gap:8px';
        
        const noteTitle = doc.createElement('span');
        noteTitle.textContent = '备注';
        noteHeader.appendChild(noteTitle);
        
        // 获取备注（优先使用 cm_manager.note，兼容旧字段）
        const cm = getCmManager(char);
        const userNote = cm.note !== undefined ? cm.note : (char.extensions && char.extensions.st_character_manager_note) || '';
        const noteContentResult = this.createToggleableContent(userNote || '(无)', 'user-note');
        const noteContent = noteContentResult.container;
        const noteToggleBtn = noteContentResult.toggleBtn;
        noteContent.id = 'cmNoteContent';
        
        // 将伸缩按钮放在标题旁边
        noteHeader.appendChild(noteToggleBtn);
        
        // 添加编辑按钮到最右边
        const noteEditBtn = doc.createElement('button');
        noteEditBtn.className = 'cm-edit-btn';
        noteEditBtn.id = 'cmEditNoteBtn';
        noteEditBtn.innerHTML = ICONS.pencil;
        noteHeader.appendChild(noteEditBtn);
        
        noteSection.appendChild(noteHeader);
        noteSection.appendChild(noteContent);
        body.appendChild(noteSection);
        
        // 备注编辑逻辑
        noteHeader.querySelector('#cmEditNoteBtn').onclick = () => {
            if (noteContent.tagName === 'DIV') {
                const contentDiv = noteContent.querySelector('.cm-markdown-body');
                if (contentDiv) {
                    const textarea = doc.createElement('textarea');
                    textarea.className = 'cm-input';
                    textarea.style.height = '100px';
                    textarea.style.resize = 'vertical';
                    textarea.value = userNote;
                    contentDiv.replaceWith(textarea);
                    const btn = noteHeader.querySelector('#cmEditNoteBtn');
                    btn.innerHTML = '💾';
                    btn.onclick = async () => {
                        const val = textarea.value.trim();
                        // 保存备注到 cm_manager.note
                        await saveCharacterData(char.fileName, (data) => {
                            const dataCm = getCmManager({ data });
                            dataCm.note = val;
                            // 清理旧字段
                            if (data.extensions && data.extensions.st_character_manager_note !== undefined) {
                                delete data.extensions.st_character_manager_note;
                            }
                        });
                        
                        // 刷新显示
                        this.renderLegacyView(body);
                    };
                }
            }
        };

        // 3. 描述
        const descSection = doc.createElement('div');
        descSection.className = 'cm-section cm-section-desc';
        const desc = this.getCharProp('description');
        const descHeader = doc.createElement('h4');
        descHeader.className = 'cm-section-header';
        descHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
        descHeader.innerHTML = '<span>📋 描述</span>';
        const descContentResult = this.createToggleableContent(desc || '(无)', 'description');
        const descContent = descContentResult.container;
        const descToggleBtn = descContentResult.toggleBtn;
        
        // 将按钮放在标题旁边
        descHeader.appendChild(descToggleBtn);
        
        descSection.appendChild(descHeader);
        descSection.appendChild(descContent);
        body.appendChild(descSection);

        // 4. 开场白
        const firstSection = doc.createElement('div');
        firstSection.className = 'cm-section cm-section-first';
        const firstMes = this.getCharProp('first_mes') || this.getCharProp('first_message');
        const firstHeader = doc.createElement('h4');
        firstHeader.className = 'cm-section-header';
        firstHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
        firstHeader.innerHTML = `<span>${ICONS.chat} 主开场白</span>`;
        const firstContentResult = this.createToggleableContent(firstMes || '(无)', 'first-message');
        const firstContent = firstContentResult.container;
        const firstToggleBtn = firstContentResult.toggleBtn;
        
        // 将按钮放在标题旁边
        firstHeader.appendChild(firstToggleBtn);
        
        firstSection.appendChild(firstHeader);
        firstSection.appendChild(firstContent);
        body.appendChild(firstSection);

        // 5. 备选开场白
        if (char.alternate_greetings && char.alternate_greetings.length > 0) {
            const altSection = doc.createElement('div');
            altSection.className = 'cm-section';
            
            const altHeader = doc.createElement('h4');
            altHeader.setAttribute('data-section-type', 'alt-greetings');
            altHeader.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:8px;';
            
            const altTitleDiv = doc.createElement('div');
            altTitleDiv.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1';
            altTitleDiv.innerHTML = `<span class="cm-alt-arrow" style="display:inline-block;width:16px;transition:transform 0.2s">▶</span><span>📝 备选开场白 (${char.alternate_greetings.length})</span>`;
            altHeader.appendChild(altTitleDiv);

            const maxBtn = doc.createElement('button');
            maxBtn.innerHTML = ICONS.maximize || '⛶';
            maxBtn.title = '全屏查看';
            maxBtn.style.cssText = 'background:transparent;border:none;color:var(--cm-text-sec);cursor:pointer;padding:0 8px;margin-left:auto;';
            maxBtn.onclick = (e) => {
                e.stopPropagation();
                this.openAltGreetingsModal(char.alternate_greetings);
            };
            altHeader.appendChild(maxBtn);
            
            const contentDiv = doc.createElement('div');
            contentDiv.className = 'cm-greetings-list';
            contentDiv.style.display = 'none'; // 默认折叠
            
            let altItems = [];
            char.alternate_greetings.forEach((g, i) => {
                const greetingTokens = calculateTokens(g);
                const item = doc.createElement('div');
                item.className = 'cm-greeting-item';
                item.style.position = 'relative';
                const greetingHeader = doc.createElement('div');
                greetingHeader.className = 'cm-greeting-header';
                greetingHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
                greetingHeader.innerHTML = `<span>#${i + 1} 🪙 ${greetingTokens}</span>`;
                const greetingContentResult = this.createToggleableContent(g, `alt-greeting-${i}`, true, 200);
                const greetingContent = greetingContentResult.container;
                const greetingToggleBtn = greetingContentResult.toggleBtn;
                
                // 将按钮放在标题旁边
                greetingHeader.appendChild(greetingToggleBtn);
                
                item.appendChild(greetingHeader);
                item.appendChild(greetingContent);
                altItems.push(item);
            });
            
            altItems.forEach(item => contentDiv.appendChild(item));

            // Toggle logic
            altHeader.onclick = () => {
                const icon = altHeader.querySelector('.cm-alt-arrow');
                if (contentDiv.style.display === 'none') {
                    contentDiv.style.display = 'flex';
                    if (icon) icon.style.transform = 'rotate(90deg)';
                } else {
                    contentDiv.style.display = 'none';
                    if (icon) icon.style.transform = 'rotate(0deg)';
                }
            };

            altSection.appendChild(altHeader);
            altSection.appendChild(contentDiv);
            body.appendChild(altSection);
        }

        // 6. 扩展数据区域
        const advancedSection = doc.createElement('div');
        advancedSection.className = 'cm-section cm-section-advanced';
        advancedSection.innerHTML = '<h4>📦 角色卡扩展数据</h4>' +
            '<div id="cmAdvancedContent" class="cm-advanced-content"></div>';
        body.appendChild(advancedSection);

        const advContent = advancedSection.querySelector('#cmAdvancedContent');
        
        let html = '';
        html += buildCharacterBookHTML(char);
        html += buildRegexScriptsHTML(char);
        html += buildTavernHelperHTML(char);

        if (!html) {
            html = '<div style="padding:16px;text-align:center;color:var(--cm-text-sec);opacity:0.6">该角色卡无扩展数据</div>';
        }
        advContent.innerHTML = html;
        
        // 绑定折叠事件
        this.bindExtendedEvents(advContent);
        
        // 7. 聊天历史记录 (异步加载)
        const historySection = doc.createElement('div');
        historySection.className = 'cm-section';
        historySection.innerHTML = '<h4>💬 聊天记录 <span id="cmHistoryLoading" style="font-size:11px;font-weight:normal;color:var(--cm-text-sec);margin-left:8px">加载中...</span></h4><div id="cmHistoryList" style="max-height:300px;overflow-y:auto"></div>';
        body.appendChild(historySection);
        
        getCharChatHistory(char).then(history => {
            const list = historySection.querySelector('#cmHistoryList');
            const loading = historySection.querySelector('#cmHistoryLoading');
            if (loading) loading.remove();
            
            if (!history || history.length === 0) {
                list.innerHTML = '<div style="padding:20px;text-align:center;opacity:0.6">无历史记录</div>';
                return;
            }
            
            history.forEach(h => {
                const item = doc.createElement('div');
                item.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--cm-border);cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:background 0.2s';
                item.onmouseover = () => item.style.background = 'var(--cm-hover)';
                item.onmouseout = () => item.style.background = 'transparent';
                
                const base = char.fileName.replace(/\.[^/.]+$/, "");
                let chatName = h.file_name.replace(base + ' - ', '').replace(/\.jsonl$/i, '');
                if (chatName === h.file_name) chatName = h.file_name;

                const dateStr = h.last_mes ? new Date(h.last_mes).toLocaleString() : '未知时间';

                const info = doc.createElement('div');
                info.style.cssText = 'flex:1;overflow:hidden';
                info.innerHTML = '<div style="font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + escapeHtml(chatName) + '">' + escapeHtml(chatName) + '</div><div style="font-size:11px;opacity:0.6;margin-top:2px">' + dateStr + ' · ' + (h.chat_items || 0) + '条对话 (' + (h.file_size || '0 KB') + ')</div>';
                
                info.onclick = () => this.launchChat(h.file_name);
                
                item.appendChild(info);
                list.appendChild(item);
            });
        });
    }

    close(byHistory = false) {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
            
            // 清理事件监听
            if (this.popstateHandler) {
                window.removeEventListener('popstate', this.popstateHandler);
                this.popstateHandler = null;
            }

            // 如果不是通过返回键关闭的，且当前历史状态是我们推入的，则回退
            if (!byHistory && history.state && history.state.cmDetailOpen) {
                history.back();
            }
        }
    }

    pushHistoryState() {
        // 防止重复 push
        if (history.state && history.state.cmDetailOpen) return;

        history.pushState({ cmDetailOpen: true }, '');
        
        this.popstateHandler = (e) => {
            // 当用户按返回键时触发
            if (this.overlay) {
                this.close(true); // 标记为由历史记录触发
            }
        };
        window.addEventListener('popstate', this.popstateHandler);
    }

    bindSwipeEvents(element) {
        let touchStartX = 0;
        let touchStartY = 0;

        element.addEventListener('touchstart', (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        element.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const dx = touchEndX - touchStartX;
            const dy = touchEndY - touchStartY;

            // 水平滑动判定：位移 > 60px 且 水平位移 > 垂直位移的2倍
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
                if (dx > 0) {
                    this.prevTab(); // 向右滑 -> 上一个 Tab
                } else {
                    this.nextTab(); // 向左滑 -> 下一个 Tab
                }
            }
        }, { passive: true });
    }

    prevTab() {
        const idx = TABS.findIndex(t => t.id === this.currentTab);
        if (idx > 0) {
            this.switchTab(TABS[idx - 1].id);
        }
    }

    nextTab() {
        const idx = TABS.findIndex(t => t.id === this.currentTab);
        if (idx < TABS.length - 1) {
            this.switchTab(TABS[idx + 1].id);
        }
    }

    openAltGreetingsModal(greetings) {
        let currentIndex = 0;
        let currentGreetings = [...greetings]; // Copy for sorting
        let total = currentGreetings.length;
        let isSortMode = false;

        const content = doc.createElement('div');
        content.className = 'cm-alt-modal-content';
        content.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden;background:var(--cm-bg);';

        // 顶部工具栏
        const toolbar = doc.createElement('div');
        toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--cm-border);background:var(--cm-bg-sec);flex-shrink:0;gap:10px;';

        // 1. 浏览模式控件组
        const viewControls = doc.createElement('div');
        viewControls.style.cssText = 'display:flex;align-items:center;flex:1;gap:10px;justify-content:space-between;';

        // 上一条
        const prevBtn = doc.createElement('button');
        prevBtn.className = 'cm-btn cm-btn-secondary';
        prevBtn.style.minWidth = '40px';
        prevBtn.innerHTML = '◀';
        prevBtn.title = '上一条 (Left Arrow)';
        prevBtn.onclick = () => showIndex(currentIndex - 1);

        // 指示器 (居中)
        const centerContainer = doc.createElement('div');
        centerContainer.style.cssText = 'flex:1;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:12px;';

        const pagination = doc.createElement('div');
        pagination.className = 'cm-alt-pagination';
        pagination.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;justify-content:center;max-width:400px;';
        centerContainer.appendChild(pagination);

        // Token 计数显示
        const tokenBadge = doc.createElement('div');
        tokenBadge.className = 'cm-token-badge';
        tokenBadge.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--cm-bg-ter);border:1px solid var(--cm-border);border-radius:4px;font-size:12px;color:var(--cm-text-sec);white-space:nowrap;';
        tokenBadge.innerHTML = '🪙 <span class="cm-token-count">-</span>';
        centerContainer.appendChild(tokenBadge);

        const tokenCountEl = tokenBadge.querySelector('.cm-token-count');

        // 下一条
        const nextBtn = doc.createElement('button');
        nextBtn.className = 'cm-btn cm-btn-secondary';
        nextBtn.style.minWidth = '40px';
        nextBtn.innerHTML = '▶';
        nextBtn.title = '下一条 (Right Arrow)';
        nextBtn.onclick = () => showIndex(currentIndex + 1);

        viewControls.appendChild(prevBtn);
        viewControls.appendChild(centerContainer);
        viewControls.appendChild(nextBtn);

        // 2. 排序模式控件组 (默认隐藏)
        const sortControls = doc.createElement('div');
        sortControls.style.cssText = 'display:none;align-items:center;flex:1;justify-content:flex-end;gap:10px;';

        const cancelSortBtn = doc.createElement('button');
        cancelSortBtn.className = 'cm-btn cm-btn-secondary';
        cancelSortBtn.textContent = '取消';
        
        const saveSortBtn = doc.createElement('button');
        saveSortBtn.className = 'cm-btn cm-btn-primary';
        saveSortBtn.innerHTML = '💾 保存顺序';

        sortControls.appendChild(cancelSortBtn);
        sortControls.appendChild(saveSortBtn);

        // 3. 模式切换按钮
        const toggleSortBtn = doc.createElement('button');
        toggleSortBtn.className = 'cm-btn cm-btn-secondary';
        toggleSortBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15l5 5 5-5"/><path d="M7 9l5-5 5 5"/></svg>';
        toggleSortBtn.title = '开启排序模式';
        
        toolbar.appendChild(viewControls);
        toolbar.appendChild(sortControls);
        toolbar.appendChild(toggleSortBtn);

        // 内容区域容器
        const bodyContainer = doc.createElement('div');
        bodyContainer.style.cssText = 'flex:1;position:relative;overflow:hidden;background:var(--cm-bg);';

        // 1. 浏览视图
        const cardContainer = doc.createElement('div');
        cardContainer.style.cssText = 'height:100%;overflow-y:auto;padding:20px;position:relative;';

        // Markdown 内容
        const markdownBody = doc.createElement('div');
        markdownBody.className = 'cm-markdown-body';
        markdownBody.style.cssText = 'font-size:15px;line-height:1.6;max-width:100%;';
        cardContainer.appendChild(markdownBody);

        // 2. 排序视图 (默认隐藏)
        const sortListContainer = doc.createElement('div');
        sortListContainer.style.cssText = 'display:none;height:100%;overflow-y:auto;padding:20px;flex-direction:column;gap:10px;';

        bodyContainer.appendChild(cardContainer);
        bodyContainer.appendChild(sortListContainer);

        content.appendChild(toolbar);
        content.appendChild(bodyContainer);

        // --- 逻辑函数 ---

        const renderPagination = () => {
            pagination.innerHTML = '';
            for (let i = 0; i < total; i++) {
                const pageBtn = doc.createElement('div');
                pageBtn.textContent = (i + 1).toString();
                const isActive = i === currentIndex;
                pageBtn.style.cssText = `
                    cursor: pointer;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 12px;
                    background: ${isActive ? 'var(--cm-accent-bg)' : 'transparent'};
                    color: ${isActive ? 'var(--cm-accent-text)' : 'var(--cm-text-sec)'};
                    border: 1px solid ${isActive ? 'var(--cm-accent)' : 'transparent'};
                    transition: all 0.2s;
                `;
                pageBtn.onmouseover = () => {
                    if (!isActive) pageBtn.style.background = 'var(--cm-hover)';
                };
                pageBtn.onmouseout = () => {
                    if (!isActive) pageBtn.style.background = 'transparent';
                };
                pageBtn.onclick = () => showIndex(i);
                pagination.appendChild(pageBtn);
            }
        };

        const showIndex = (index) => {
            if (index < 0) index = total - 1;
            if (index >= total) index = 0;
            currentIndex = index;

            renderPagination();
            const currentGreeting = currentGreetings[currentIndex];
            markdownBody.innerHTML = this.renderMarkdown(currentGreeting);
            // 更新 Token 计数
            tokenCountEl.textContent = calculateTokens(currentGreeting);
            cardContainer.scrollTop = 0;
        };

        const renderSortList = () => {
            sortListContainer.innerHTML = '';
            currentGreetings.forEach((g, i) => {
                const greetingTokens = calculateTokens(g);
                const item = doc.createElement('div');
                item.className = 'cm-sort-item';
                item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;background:var(--cm-bg-ter);border:1px solid var(--cm-border);border-radius:6px;flex-shrink:0;';
                
                const idx = doc.createElement('div');
                idx.textContent = `#${i + 1} 🪙 ${greetingTokens}`;
                idx.style.cssText = 'font-weight:bold;color:var(--cm-text-sec);width:60px;flex-shrink:0;';
                
                const text = doc.createElement('div');
                text.textContent = g.length > 80 ? g.substring(0, 80).replace(/\n/g, ' ') + '...' : g.replace(/\n/g, ' ');
                text.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;color:var(--cm-text);';
                
                const actions = doc.createElement('div');
                actions.style.display = 'flex';
                actions.style.gap = '4px';
                actions.style.flexShrink = '0';
                
                const upBtn = doc.createElement('button');
                upBtn.className = 'cm-btn cm-btn-secondary';
                upBtn.innerHTML = '⬆';
                upBtn.title = '上移';
                upBtn.style.padding = '4px 8px';
                upBtn.disabled = i === 0;
                upBtn.onclick = () => moveItem(i, -1);
                
                const downBtn = doc.createElement('button');
                downBtn.className = 'cm-btn cm-btn-secondary';
                downBtn.innerHTML = '⬇';
                downBtn.title = '下移';
                downBtn.style.padding = '4px 8px';
                downBtn.disabled = i === currentGreetings.length - 1;
                downBtn.onclick = () => moveItem(i, 1);
                
                actions.appendChild(upBtn);
                actions.appendChild(downBtn);
                
                item.appendChild(idx);
                item.appendChild(text);
                item.appendChild(actions);
                sortListContainer.appendChild(item);
            });
        };

        const moveItem = (index, direction) => {
            const newIndex = index + direction;
            if (newIndex < 0 || newIndex >= currentGreetings.length) return;
            
            const temp = currentGreetings[index];
            currentGreetings[index] = currentGreetings[newIndex];
            currentGreetings[newIndex] = temp;
            
            renderSortList();
        };

        // 切换模式
        toggleSortBtn.onclick = () => {
            isSortMode = true;
            viewControls.style.display = 'none';
            sortControls.style.display = 'flex';
            toggleSortBtn.style.display = 'none';
            
            cardContainer.style.display = 'none';
            sortListContainer.style.display = 'flex';
            
            renderSortList();
        };

        cancelSortBtn.onclick = () => {
            isSortMode = false;
            // 还原数据
            currentGreetings = [...greetings];
            
            viewControls.style.display = 'flex';
            sortControls.style.display = 'none';
            toggleSortBtn.style.display = 'block';
            
            cardContainer.style.display = 'block';
            sortListContainer.style.display = 'none';
            
            showIndex(currentIndex);
        };

        saveSortBtn.onclick = async () => {
            try {
                await saveCharacterData(this.char.fileName, (data) => {
                    data.alternate_greetings = currentGreetings;
                });
                
                // 更新本地状态
                this.char.alternate_greetings = currentGreetings;
                greetings = currentGreetings; // 更新闭包变量
                total = currentGreetings.length;
                
                notify('顺序已保存', 'success');
                
                // 退出排序模式
                isSortMode = false;
                viewControls.style.display = 'flex';
                sortControls.style.display = 'none';
                toggleSortBtn.style.display = 'block';
                
                cardContainer.style.display = 'block';
                sortListContainer.style.display = 'none';
                
                // 刷新视图
                showIndex(currentIndex);
                
                // 刷新外部详情页
                if (this.viewMode === 'legacy') {
                    const body = this.container.querySelector('.cm-detail-body');
                    if (body) {
                        body.innerHTML = '';
                        this.renderHeader();
                        body.appendChild(this.container.querySelector('.cm-detail-header'));
                        this.renderLegacyView(body);
                    }
                } else {
                    this.renderDetailsTab();
                }
                
            } catch (e) {
                console.error(e);
                notify('保存失败: ' + e.message, 'error');
            }
        };

        // 初始化显示
        showIndex(0);

        createBaseDialog(`备选开场白 (${total})`, '', [], (ov, close) => {
            const body = ov.querySelector('.cm-tag-editor-body');
            if (body) {
                body.style.padding = '0';
                body.style.background = 'var(--cm-bg)';
                body.appendChild(content);
            }
            
            // 调整弹窗大小
            const dialog = ov.querySelector('.cm-tag-editor');
            if (dialog) {
                dialog.style.maxWidth = '90vw';
                dialog.style.height = '80vh';
                dialog.style.width = '800px';
            }

            // 键盘导航支持
            const keyHandler = (e) => {
                if (isSortMode) return; // 排序模式下禁用键盘翻页
                if (e.key === 'ArrowLeft') showIndex(currentIndex - 1);
                if (e.key === 'ArrowRight') showIndex(currentIndex + 1);
            };
            window.addEventListener('keydown', keyHandler);
            
            // 清理事件监听
            const observer = new MutationObserver((mutations) => {
                if (!doc.body.contains(ov)) {
                    window.removeEventListener('keydown', keyHandler);
                    observer.disconnect();
                }
            });
            observer.observe(doc.body, { childList: true, subtree: true });
        });
    }

    renderHeader() {
        const header = doc.createElement('div');
        header.className = 'cm-detail-header';

        // Mobile Drag Support
        let startY = 0;
        let startScrollTop = 0;

        header.addEventListener('touchstart', (e) => {
            if (e.target.closest('button') || e.target.closest('.cm-cam-btn') || e.target.closest('input')) return;
            const body = this.container.querySelector('.cm-detail-body');
            if (!body) return;
            startY = e.touches[0].clientY;
            startScrollTop = body.scrollTop;
        }, { passive: true });

        header.addEventListener('touchmove', (e) => {
            if (e.target.closest('button') || e.target.closest('.cm-cam-btn') || e.target.closest('input')) return;
            const body = this.container.querySelector('.cm-detail-body');
            if (!body) return;
            const deltaY = e.touches[0].clientY - startY;
            body.scrollTop = startScrollTop - deltaY;
        }, { passive: true });

        // Top Row: Avatar + Info
        const topRow = doc.createElement('div');
        topRow.className = 'cm-detail-header-top';
        
        // 获取封面显示判定结果
        const charTags = getCharTags(this.char.fileName);
        const coverResult = resolveDetailPageCoverDisplay(charTags);
        
        // 1. 头像区域
        const avatarWrap = doc.createElement('div');
        avatarWrap.className = 'cm-detail-avatar-wrap';
        avatarWrap.style.position = 'relative';

        // 根据封面显示模式渲染不同内容
        if (coverResult.displayMode === 'no-image') {
            // 无图模式：纯黑背景 + 角色名称
            avatarWrap.classList.add('cm-detail-avatar-no-image');
            
            const noImageName = doc.createElement('div');
            noImageName.className = 'cm-detail-avatar-no-image-name';
            noImageName.textContent = this.char.name;
            avatarWrap.appendChild(noImageName);
        } else {
            // normal 或 blur 模式：显示图片
            const avatar = doc.createElement('img');
            avatar.className = 'cm-detail-avatar';
            avatar.src = this.char.avatarUrl;
            
            // blur 模式：添加模糊样式类
            if (coverResult.displayMode === 'blur') {
                avatar.classList.add('cm-detail-avatar-blur');
            }
            
            // 更换头像按钮
            const camBtn = doc.createElement('div');
            camBtn.className = 'cm-cam-btn';
            camBtn.innerHTML = ICONS.camera;
            camBtn.title = '更换图片';
            camBtn.onclick = () => this.handleAvatarChange(avatar);

            avatarWrap.appendChild(avatar);
            avatarWrap.appendChild(camBtn);
        }
        topRow.appendChild(avatarWrap);

        // 2. 信息区域
        const info = doc.createElement('div');
        info.className = 'cm-detail-info';

        // 标题与重命名
        const nameWrap = doc.createElement('div');
        nameWrap.className = 'cm-detail-title-wrap';
        
        const h2 = doc.createElement('h2');
        h2.textContent = this.char.name;
        
        const editBtn = doc.createElement('button');
        editBtn.className = 'cm-edit-btn';
        editBtn.innerHTML = ICONS.pencil;
        editBtn.onclick = () => this.handleRename(nameWrap, h2);

        nameWrap.appendChild(h2);
        nameWrap.appendChild(editBtn);

        // Header Actions (Fav & Download)
        const headerActions = doc.createElement('div');
        headerActions.className = 'cm-header-actions';
        headerActions.style.cssText = 'margin-left:auto;display:flex;gap:6px;align-items:center;';

        // Favorite
        const favBtn = doc.createElement('button');
        favBtn.className = 'cm-btn cm-btn-secondary';
        favBtn.style.padding = '4px 8px';
        favBtn.style.fontSize = '12px';
        favBtn.innerHTML = this.char.fav ? ICONS.starSolid : ICONS.star;
        favBtn.title = this.char.fav ? '取消收藏' : '收藏';
        favBtn.style.color = this.char.fav ? '#f59e0b' : 'var(--cm-text-sec)';
        favBtn.onclick = async (e) => {
            e.stopPropagation();
            const newState = await toggleFavorite(this.char.fileName, this.char.fav);
            this.char.fav = newState;
            favBtn.innerHTML = newState ? ICONS.starSolid : ICONS.star;
            favBtn.title = newState ? '取消收藏' : '收藏';
            favBtn.style.color = newState ? '#f59e0b' : 'var(--cm-text-sec)';
            renderTagSidebar();
            // 更新列表页卡片的收藏样式类
            const listCard = doc.querySelector(`.cm-card[data-file="${CSS.escape(this.char.fileName)}"]`);
            if (listCard) {
                listCard.classList.toggle('cm-favorite', newState);
            }
            if (state.currentView === 'favorites') renderView();
        };
        headerActions.appendChild(favBtn);

        // Download
        const dlBtn = doc.createElement('button');
        dlBtn.className = 'cm-btn cm-btn-secondary';
        dlBtn.style.padding = '4px 8px';
        dlBtn.style.fontSize = '12px';
        dlBtn.innerHTML = ICONS.download;
        dlBtn.title = '下载角色卡';
        dlBtn.onclick = async (e) => {
            e.stopPropagation();
            if (await showConfirm(`确定下载 "${this.char.name}"？`)) {
                await downloadChar(this.char.fileName);
                notify('已下载', 'success');
            }
        };
        headerActions.appendChild(dlBtn);

        nameWrap.appendChild(headerActions);
        info.appendChild(nameWrap);

        // 来源链接
        this.renderSourceLink(info);

        // 元数据 (作者、时间、大小、Token)
        const meta = doc.createElement('div');
        meta.className = 'cm-detail-meta';
        const importTime = this.char.data?.extensions?.cm_manager?.import_time || this.char.date_added;
        const dateStr = importTime ? new Date(parseInt(importTime)).toLocaleDateString() : '未知';
        
        let metaHtml = `
            <span>${ICONS.user} ${escapeHtml(this.char.creator)}</span>
            <span>${ICONS.time} ${dateStr}</span>
            <span>${ICONS.box} ${formatSize(this.char.fileSize)}</span>
            <span id="cm-detail-chat-count" title="聊天记录数"></span>
            <span title="估算Token数">🪙 ${this.char.tokens || 0}</span>
        `;

        getCharHistoryCount(this.char).then(count => {
            const el = meta.querySelector('#cm-detail-chat-count');
            if (el) el.innerHTML = '💬 ' + count;
        });

        const displayVer = this.char.version || '(未设定)';
        metaHtml += `<span id="cmVersionSpan" style="cursor:pointer;border-bottom:1px dashed var(--cm-text-sec)" title="点击修改版本号">🔖 v${escapeHtml(displayVer)} <span style="font-size:10px">${ICONS.pencil}</span></span>`;

        meta.innerHTML = metaHtml;
        info.appendChild(meta);

        // 版本号点击事件
        const verSpan = meta.querySelector('#cmVersionSpan');
        if (verSpan) {
            verSpan.onclick = () => this.handleVersionEdit();
        }

        // 关联世界书
        const wiDiv = doc.createElement('div');
        wiDiv.style.cssText = 'margin-bottom:8px;font-size:12px;color:var(--cm-text-sec)';
        if (this.char.character_book) {
            // character_book 可能是字符串（文件名）或对象（世界书数据）
            const bookName = typeof this.char.character_book === 'string'
                ? this.char.character_book
                : (this.char.character_book.name || '角色世界书');
            wiDiv.innerHTML = `<span title="角色世界书">🌐 ${escapeHtml(bookName)}</span>`;
        } else {
            wiDiv.innerHTML = '<span style="opacity:0.5">🌐 无世界书</span>';
        }
        info.appendChild(wiDiv);

        // 文件名
        const fileDiv = doc.createElement('div');
        fileDiv.style.cssText = 'margin-bottom:8px;font-size:12px;color:var(--cm-text-sec);opacity:0.6';
        fileDiv.innerHTML = `📁 ${escapeHtml(this.char.fileName)}`;
        info.appendChild(fileDiv);

        // 标签容器
        const tagsContainer = doc.createElement('div');
        tagsContainer.className = 'cm-char-tags';
        this.renderTags(tagsContainer);
        info.appendChild(tagsContainer);

        topRow.appendChild(info);
        header.appendChild(topRow);

        // 操作按钮栏 (Full Width Row)
        this.renderActionButtons(header);

        // 关闭按钮 (Moved inside header for better layout control)
        const closeBtn = doc.createElement('span');
        closeBtn.className = 'cm-detail-close';
        closeBtn.innerHTML = ICONS.close;
        closeBtn.onclick = () => this.close();
        header.appendChild(closeBtn);

        this.container.appendChild(header);
    }

    renderSourceLink(container) {
        const linkRow = doc.createElement('div');
        linkRow.className = 'detail-subrow';
        linkRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;';

        const linkInput = doc.createElement('input');
        linkInput.type = 'text';
        linkInput.className = 'detail-link-input';
        linkInput.style.cssText = 'flex:1;min-width:0;padding:6px;border-radius:4px;border:1px solid var(--cm-border);background:var(--cm-input-bg);color:var(--cm-text);font-size:12px;';
        linkInput.placeholder = '来源链接 (http://...)';
        linkInput.value = (this.char.source_link || '').trim();

        const openLink = doc.createElement('a');
        openLink.className = 'detail-open-link';
        openLink.textContent = '🔗 打开';
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.style.cssText = 'display:none;flex-shrink:0;font-size:12px;color:var(--cm-accent-text);background:var(--cm-accent-bg);padding:4px 8px;border-radius:4px;text-decoration:none;white-space:nowrap;';

        const normalizeUrl = (raw) => {
            let s = (raw || '').trim();
            if (!s) return '';
            if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
            return s;
        };

        const refreshOpenBtn = (raw) => {
            const u = normalizeUrl(raw);
            if (u) {
                openLink.href = u;
                openLink.style.display = 'inline-block';
            } else {
                openLink.removeAttribute('href');
                openLink.style.display = 'none';
            }
        };

        refreshOpenBtn(linkInput.value);

        let linkSaveTimer = null;
        let lastSavedLink = (this.char.source_link || '').trim();

        const saveSourceLink = async (raw) => {
            const normalized = normalizeUrl(raw);
            if (normalized === normalizeUrl(lastSavedLink)) return;

            this.char.source_link = normalized;
            lastSavedLink = normalized;
            refreshOpenBtn(normalized);

            try {
                await saveCharacterData(this.char.fileName, (data) => {
                    data.extensions = data.extensions || {};
                    data.extensions.source_url = normalized;
                    delete data.extensions.source_link;
                });
            } catch (e) {
                notify('保存来源链接失败: ' + (e?.message || e), 'error');
            }
        };

        linkInput.addEventListener('input', () => {
            refreshOpenBtn(linkInput.value);
            if (linkSaveTimer) clearTimeout(linkSaveTimer);
            linkSaveTimer = setTimeout(() => saveSourceLink(linkInput.value), 600);
        });
        linkInput.addEventListener('blur', () => {
            if (linkSaveTimer) clearTimeout(linkSaveTimer);
            saveSourceLink(linkInput.value);
        });

        linkRow.appendChild(linkInput);
        linkRow.appendChild(openLink);
        container.appendChild(linkRow);
    }

    renderActionButtons(container) {
        const actions = doc.createElement('div');
        actions.className = 'cm-detail-actions';
        actions.style.marginTop = '8px';

        // 1. 开始聊天按钮
        const playBtn = doc.createElement('button');
        playBtn.className = 'cm-btn cm-btn-success';
        playBtn.innerHTML = ICONS.rocket + ' 启动';
        playBtn.onclick = () => this.launchChat();
        actions.appendChild(playBtn);

        // 2. 画廊按钮
        const galleryBtn = doc.createElement('button');
        galleryBtn.className = 'cm-btn cm-btn-secondary cm-btn-gallery';
        galleryBtn.innerHTML = ICONS.gallery + ' 画廊 <span class="cm-gallery-badge">...</span>';
        galleryBtn.title = '查看角色画廊';
        // galleryBtn.disabled = true;
        
        // 异步获取画廊数量
        (async () => {
            const items = await getGalleryItems(this.char.name);
            const count = items.length;
            const badge = galleryBtn.querySelector('.cm-gallery-badge');
            if (badge) badge.textContent = count;
            // galleryBtn.disabled = count === 0;
            // 缓存到角色对象
            this.char.galleryCount = count;
            this.char._galleryItems = items;
        })();

        galleryBtn.onclick = async () => {
            let items = this.char._galleryItems;
            if (!items) {
                items = await getGalleryItems(this.char.name);
            }
            // if (items.length === 0) {
            //     notify('画廊为空', 'warning');
            //     return;
            // }
            showGallery(this.char, items, notify, showConfirm, replaceCharacterImage);
        };
        actions.appendChild(galleryBtn);


        // 更新按钮
        const updateBtn = doc.createElement('button');
        updateBtn.className = 'cm-btn cm-btn-secondary';
        updateBtn.innerHTML = ICONS.refresh + ' 更新';
        updateBtn.title = '用新卡覆盖当前角色 (保留文件名和来源链接)';
        updateBtn.onclick = () => this.handleUpdate();
        actions.appendChild(updateBtn);

        // 翻译按钮
        if (state.settings.translationEnabled) {
            const transBtn = doc.createElement('button');
            transBtn.className = 'cm-btn cm-btn-secondary';
            transBtn.innerHTML = ICONS.translate + ' \u7ffb\u8bd1';
            transBtn.onclick = () => {
                this.close();
                openTranslationDialog(this.char);
            };
            actions.appendChild(transBtn);
        }

        // 视图切换按钮
        const viewBtn = doc.createElement('button');
        viewBtn.className = 'cm-btn cm-btn-secondary';
        viewBtn.innerHTML = this.viewMode === 'legacy' ? (ICONS.menu + ' 视图') : (ICONS.list + ' 视图');
        viewBtn.title = '切换详情页布局风格';
        viewBtn.onclick = () => this.toggleViewMode();
        actions.appendChild(viewBtn);

        // 删除按钮
        const rmBtn = doc.createElement('button');
        rmBtn.className = 'cm-btn cm-btn-danger';
        rmBtn.innerHTML = ICONS.trash + ' 删除';
        rmBtn.onclick = async () => {
            let wiCount = 0;
            if (this.char.character_book) {
                const isUsedByOthers = state.characters.some(c => c.fileName !== this.char.fileName && c.character_book === this.char.character_book);
                if (!isUsedByOthers) wiCount = 1;
            }
            const confirmRes = await showDeleteConfirm(1, wiCount);
            if (!confirmRes.ok) return;
            
            try {
                // 传递 deleteChats 参数
                await deleteChar(this.char, {
                    deleteChats: confirmRes.delChats,
                    deleteWi: confirmRes.delWi && wiCount > 0
                });

                // deleteChar 已内部处理 state.characters 清理和持久化，此处移除冗余代码
                
                // 刷新界面
                renderTagSidebar();
                renderView();
                
                this.close();
                notify('已删除', 'success');
            } catch (err) {
                console.error(err);
                notify('删除失败: ' + err.message, 'error');
            }
        };
        actions.appendChild(rmBtn);

        container.appendChild(actions);
    }

    rebuildHeaderPreserveOrder() {
        if (!this.container) return;
        const detailBody = this.container.querySelector('.cm-detail-body');
        const tabsNav = this.container.querySelector('.cm-tabs-nav');
        const oldHeader = this.container.querySelector('.cm-detail-header');
        if (oldHeader) oldHeader.remove();
        this.renderHeader();
        const newHeader = this.container.querySelector('.cm-detail-header');
        // header 和 tabs 都在 detailBody 内部
        // anchor 是 tabsNav 或 detailBody 的第一个子元素
        const anchor = tabsNav || (detailBody ? detailBody.firstChild : null);
        if (anchor && newHeader) {
            detailBody.insertBefore(newHeader, anchor);
        } else if (detailBody && newHeader) {
            detailBody.appendChild(newHeader);
        }
    }

    renderTabs() {
        const tabsNav = doc.createElement('div');
        tabsNav.className = 'cm-tabs-nav';
        tabsNav.style.cssText = 'display:flex;gap:2px;padding:0 16px;border-bottom:1px solid var(--cm-border);background:var(--cm-bg-sec);flex-shrink:0;';

        TABS.forEach(tab => {
            const btn = doc.createElement('button');
            btn.className = `cm-tab-btn cm-tab-btn-${tab.id}`;
            btn.innerHTML = `${tab.icon} ${tab.label}`;
            btn.onclick = () => this.switchTab(tab.id);
            
            // 样式
            btn.style.cssText = `
                padding: 10px 16px;
                background: transparent;
                border: none;
                border-bottom: 2px solid transparent;
                color: var(--cm-text-sec);
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
            `;
            
            tabsNav.appendChild(btn);
        });

        // 将 tabs-nav 插入到滚动容器内部，header 之后
        const body = this.container.querySelector('.cm-detail-body');
        const header = body ? body.querySelector('.cm-detail-header') : null;
        if (header) {
            // 插入到 header 之后
            header.after(tabsNav);
        } else if (body) {
            body.appendChild(tabsNav);
        } else {
            this.container.appendChild(tabsNav);
        }
    }

    switchTab(tabId) {
        this.currentTab = tabId;
        
        // 切换标签页时回顶
        const body = this.container.querySelector('.cm-detail-body');
        if (body) {
            body.scrollTop = 0;
        }

        // 更新按钮状态
        const btns = this.container.querySelectorAll('.cm-tab-btn');
        btns.forEach(btn => {
            if (btn.classList.contains(`cm-tab-btn-${tabId}`)) {
                btn.style.color = 'var(--cm-text)';
                btn.style.borderBottomColor = '#2563eb';
            } else {
                btn.style.color = 'var(--cm-text-sec)';
                btn.style.borderBottomColor = 'transparent';
            }
        });

        // 更新内容显示
        Object.keys(this.tabContents).forEach(id => {
            this.tabContents[id].style.display = (id === tabId) ? 'block' : 'none';
        });

        // 特殊处理 Gallery 标签页的滚动
        if (body) {
            if (tabId === 'gallery') {
                body.classList.add('has-fixed-content');
            } else {
                body.classList.remove('has-fixed-content');
            }
        }
        
        // 切换标签后重新检测备选开场白位置
        this.updateBackToTopPosition();
    }
    
    // 检测当前页面最后一个 section 是否为备选开场白
    checkAltGreetingsAtBottom() {
        let hasAltGreetings = false;
        const activeTabId = this.viewMode === 'legacy' ? null : this.currentTab;
        
        if (this.viewMode === 'legacy') {
            // 经典视图：直接检查 contentBody 中的 section
            const contentBody = this.container.querySelector('.cm-detail-body');
            if (contentBody) {
                const sections = contentBody.querySelectorAll('.cm-section');
                if (sections.length > 0) {
                    const lastSection = sections[sections.length - 1];
                    if (lastSection.querySelector('[data-section-type="alt-greetings"]')) {
                        hasAltGreetings = true;
                    }
                }
            }
        } else if (activeTabId && this.tabContents[activeTabId]) {
            // 标签视图：检查当前激活的 tab 内容
            const activeTabContent = this.tabContents[activeTabId];
            const sections = activeTabContent.querySelectorAll('.cm-section');
            if (sections.length > 0) {
                const lastSection = sections[sections.length - 1];
                if (lastSection.querySelector('[data-section-type="alt-greetings"]')) {
                    hasAltGreetings = true;
                }
            }
        }
        
        return hasAltGreetings;
    }
    
    // 更新回顶按钮位置状态
    updateBackToTopPosition() {
        if (this.checkAltGreetingsAtBottom()) {
            this.container.classList.add('has-alt-greetings-at-bottom');
        } else {
            this.container.classList.remove('has-alt-greetings-at-bottom');
        }
    }

    /**
     * 渲染 AI 智能概览区块
     * @returns {HTMLDivElement|null}
     */
    renderAIOOverviewSection() {
        const char = this.char;
        const cm = getCmManager(char);
        const summary = cm.summary || '';
        const tags = cm.tags || [];

        const aiSection = doc.createElement('div');
        aiSection.className = 'cm-section cm-section-ai-overview';

        const headerHtml = summary ? `
            <div class="cm-ai-overview-content">
                <div class="cm-ai-summary">${escapeHtml(summary)}</div>
                ${tags.length > 0 ? `
                    <div class="cm-ai-tags">
                        ${tags.map(t => `<span class="cm-ai-tag">${escapeHtml(t)}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        ` : `<div class="cm-ai-overview-content cm-ai-overview-empty">点击"生成概览"按钮，使用 AI 分析角色卡内容...</div>`;

        aiSection.innerHTML = `
            <div class="cm-section-header">
                <span>📊 AI 智能概览</span>
                <button class="cm-btn cm-btn-primary" id="cmAIGenerateBtn">
                    🪄 生成概览
                </button>
                <button class="cm-btn cm-btn-secondary" id="cmAIEditBtn" style="display:${summary ? 'inline-block' : 'none'}">
                    📝 编辑
                </button>
            </div>
            ${headerHtml}
        `;

        // 绑定事件
        aiSection.querySelector('#cmAIGenerateBtn').onclick = () => {
            this.generateAIOverview();
        };

        const editBtn = aiSection.querySelector('#cmAIEditBtn');
        if (editBtn) {
            editBtn.onclick = () => {
                this.editAIOOverview();
            };
        }

        return aiSection;
    }

    /**
     * 生成 AI 概览
     */
    async generateAIOverview() {
        const btn = this.container.querySelector('#cmAIGenerateBtn');
        if (!btn || btn.disabled) return;

        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '生成中...';

        try {
            const { generateAIOverview } = await import('./ai-overview/ai-service.js');
            // 使用设置中的 aiOverwriteTags 决定是否覆盖已有标签
            const forceGenerateTags = state.settings.aiOverwriteTags || false;
            const result = await generateAIOverview(this.char, forceGenerateTags);

            notify(`概览生成成功${result.tags.length > 0 ? `，已生成${result.tags.length}个标签` : ''}`, 'success');

            // 重新渲染详情页
            this.renderDetailsTab();
            
            // 触发标签刷新事件，通知列表页刷新（只要生成了概览就触发）
            window.dispatchEvent(new CustomEvent('cm-tags-updated', {
                detail: { fileName: this.char.fileName }
            }));
        } catch (e) {
            console.error('[CharManager] [AI Overview] Generation failed:', e);
            notify(`生成失败：${e.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    /**
     * 编辑 AI 概览
     */
    async editAIOOverview() {
        const cm = getCmManager(this.char);
        const currentSummary = cm.summary || '';

        createBaseDialog('编辑 AI 概览', `
            <div style="padding:10px">
                <div style="margin-bottom:10px;font-size:12px;color:var(--cm-text-sec)">
                    编辑概览内容，修改后将保存到角色卡
                </div>
                <textarea class="cm-input" id="cmAIEditSummary" style="width:100%;min-height:200px;box-sizing:border-box;font-family:monospace;font-size:12px;padding:8px">${escapeHtml(currentSummary)}</textarea>
            </div>
        `, [
            { text: '取消', cls: 'cm-btn-secondary', onClick: (ov, close) => close() },
            { text: '保存', cls: 'cm-btn-primary', id: 'cmAIEditSaveBtn', onClick: async (ov, close) => {
                const saveBtn = ov.querySelector('#cmAIEditSaveBtn');
                const newSummary = ov.querySelector('#cmAIEditSummary').value.trim();
                
                if (!newSummary) {
                    notify('概览内容不能为空', 'warning');
                    return;
                }

                // 防止重复提交：禁用按钮
                if (saveBtn.disabled) return;
                saveBtn.disabled = true;
                saveBtn.textContent = '保存中...';

                try {
                    await saveCharacterData(this.char.fileName, (data) => {
                        const dataCm = getCmManager({ data });
                        dataCm.summary = newSummary;
                    });

                    notify('概览已保存', 'success');
                    this.renderDetailsTab();
                    close();
                } catch (e) {
                    notify(`保存失败：${e.message}`, 'error');
                    // 恢复按钮状态
                    saveBtn.disabled = false;
                    saveBtn.textContent = '保存';
                }
            }}
        ]);
    }

    renderDetailsTab() {
        const container = this.tabContents['details'];
        container.innerHTML = '';
        container.style.padding = '0';

        const char = this.char;
        const isExpand = state.settings.detailContentMode === 'expand';
        const maxHeightStyle = isExpand ? 'max-height:none;overflow-y:visible;' : 'max-height:300px;overflow-y:auto;';

        // AI 智能概览区块（新增）
        const aiSection = this.renderAIOOverviewSection();
        if (aiSection) {
            container.appendChild(aiSection);
        }

        // 1. 作者注释
        const commentSection = doc.createElement('div');
        commentSection.className = 'cm-section';
        commentSection.style.borderColor = '#ca8a04';
        
        const commentHeader = doc.createElement('div');
        commentHeader.className = 'cm-section-header';
        commentHeader.style.cssText = 'padding:10px 14px;font-size:13px;color:#ca8a04;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);display:flex;align-items:center;gap:8px';
        
        const commentTitle = doc.createElement('span');
        commentTitle.textContent = '作者注释';
        commentHeader.appendChild(commentTitle);
        
        const commentContentResult = this.createToggleableContent(char.creator_notes || char.creatorcomment || '(无)', 'author-comment');
        const commentContent = commentContentResult.container;
        const commentToggleBtn = commentContentResult.toggleBtn;
        
        // 将按钮放在标题旁边
        commentHeader.appendChild(commentToggleBtn);
        
        commentSection.appendChild(commentHeader);
        commentSection.appendChild(commentContent);
        container.appendChild(commentSection);
        
        // 1.5 用户备注
        const noteSection = doc.createElement('div');
        noteSection.className = 'cm-section';
        noteSection.style.borderColor = '#2563eb';
        
        const noteHeader = doc.createElement('div');
        noteHeader.className = 'cm-section-header';
        noteHeader.style.cssText = 'padding:10px 14px;font-size:13px;color:#2563eb;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);display:flex;align-items:center;gap:8px';
        
        const noteTitle = doc.createElement('span');
        noteTitle.textContent = '备注';
        noteHeader.appendChild(noteTitle);
        
        // 获取备注（优先使用 cm_manager.note，兼容旧字段）
        const cm = getCmManager(char);
        const userNote = cm.note !== undefined ? cm.note : (char.extensions && char.extensions.st_character_manager_note) || '';
        const noteContentResult = this.createToggleableContent(userNote || '(无)', 'user-note');
        const noteContent = noteContentResult.container;
        const noteToggleBtn = noteContentResult.toggleBtn;
        noteContent.id = 'cmNoteContent';
        
        // 将伸缩按钮放在标题旁边
        noteHeader.appendChild(noteToggleBtn);
        
        // 添加编辑按钮到最右边
        const noteEditBtn = doc.createElement('button');
        noteEditBtn.className = 'cm-edit-btn';
        noteEditBtn.id = 'cmEditNoteBtn';
        noteEditBtn.innerHTML = ICONS.pencil;
        noteEditBtn.style.marginLeft = 'auto';
        noteHeader.appendChild(noteEditBtn);
        
        noteSection.appendChild(noteHeader);
        noteSection.appendChild(noteContent);
        container.appendChild(noteSection);
        
        // 备注编辑逻辑
        noteHeader.querySelector('#cmEditNoteBtn').onclick = () => {
            if (noteContent.tagName === 'DIV') {
                const contentDiv = noteContent.querySelector('.cm-markdown-body');
                if (contentDiv) {
                    const textarea = doc.createElement('textarea');
                    textarea.className = 'cm-input';
                    textarea.style.height = '100px';
                    textarea.style.resize = 'vertical';
                    textarea.value = userNote;
                    contentDiv.replaceWith(textarea);
                    const btn = noteHeader.querySelector('#cmEditNoteBtn');
                    btn.innerHTML = '💾';
                    btn.onclick = async () => {
                        const val = textarea.value.trim();
                        // 保存备注到 cm_manager.note
                        await saveCharacterData(char.fileName, (data) => {
                            const dataCm = getCmManager({ data });
                            dataCm.note = val;
                            // 清理旧字段
                            if (data.extensions && data.extensions.st_character_manager_note !== undefined) {
                                delete data.extensions.st_character_manager_note;
                            }
                        });
                        
                        // 刷新显示
                        this.renderDetailsTab();
                    };
                }
            }
        };

        // 2. 描述
        const descSection = doc.createElement('div');
        descSection.className = 'cm-section cm-section-desc';
        const desc = this.getCharProp('description');
        const descHeader = doc.createElement('h4');
        descHeader.className = 'cm-section-header';
        descHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
        descHeader.innerHTML = '<span>📋 描述</span>';
        const descContentResult = this.createToggleableContent(desc || '(无)', 'description');
        const descContent = descContentResult.container;
        const descToggleBtn = descContentResult.toggleBtn;
        
        // 将按钮放在标题旁边
        descHeader.appendChild(descToggleBtn);
        
        descSection.appendChild(descHeader);
        descSection.appendChild(descContent);
        container.appendChild(descSection);

        // 历史后指令
        const phi = this.getCharProp('post_history_instructions');
        if (phi) {
            const phiSection = doc.createElement('div');
            phiSection.className = 'cm-section';
            const phiHeader = doc.createElement('h4');
            phiHeader.className = 'cm-section-header';
            phiHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
            phiHeader.innerHTML = '<span>📜 历史后指令</span>';
            const phiContentResult = this.createToggleableContent(phi, 'post-history-instructions');
            const phiContent = phiContentResult.container;
            const phiToggleBtn = phiContentResult.toggleBtn;
            
            phiHeader.appendChild(phiToggleBtn);
            
            phiSection.appendChild(phiHeader);
            phiSection.appendChild(phiContent);
            container.appendChild(phiSection);
        }
    }

    renderGreetingsTab() {
        const container = this.tabContents['greetings'];
        if (!container) return;
        
        container.innerHTML = '';
        container.style.padding = '0';

        const char = this.char;

        // 1. 主开场白
        const firstSection = doc.createElement('div');
        firstSection.className = 'cm-section cm-section-first';
        const firstMes = this.getCharProp('first_mes') || this.getCharProp('first_message');
        const firstHeader = doc.createElement('h4');
        firstHeader.className = 'cm-section-header';
        firstHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
        firstHeader.innerHTML = `<span>${ICONS.chat} 主开场白</span>`;
        const firstContentResult = this.createToggleableContent(firstMes || '(无)', 'first-message');
        const firstContent = firstContentResult.container;
        const firstToggleBtn = firstContentResult.toggleBtn;
        
        firstHeader.appendChild(firstToggleBtn);
        firstSection.appendChild(firstHeader);
        firstSection.appendChild(firstContent);
        container.appendChild(firstSection);

        // 2. 备选开场白
        if (char.alternate_greetings && char.alternate_greetings.length > 0) {
            const altSection = doc.createElement('div');
            altSection.className = 'cm-section';
            altSection.setAttribute('data-section-type', 'alt-greetings');
            
            const altHeader = doc.createElement('h4');
            altHeader.className = 'cm-section-header';
            altHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
            altHeader.innerHTML = `<span>🪙 备选开场白 (${char.alternate_greetings.length})</span>`;

            const maxBtn = doc.createElement('button');
            maxBtn.innerHTML = ICONS.maximize || '⛶';
            maxBtn.title = '全屏查看';
            maxBtn.style.cssText = 'background:transparent;border:none;color:var(--cm-text-sec);cursor:pointer;padding:0 8px;margin-left:auto;';
            maxBtn.onclick = (e) => {
                e.stopPropagation();
                this.openAltGreetingsModal(char.alternate_greetings);
            };
            altHeader.appendChild(maxBtn);
            
            const contentDiv = doc.createElement('div');
            contentDiv.className = 'cm-greetings-list';
            
            char.alternate_greetings.forEach((g, i) => {
                const greetingTokens = calculateTokens(g);
                const item = doc.createElement('div');
                item.className = 'cm-greeting-item';
                const greetingHeader = doc.createElement('div');
                greetingHeader.className = 'cm-greeting-header';
                greetingHeader.style.cssText = 'display:flex;align-items:center;gap:8px';
                greetingHeader.innerHTML = `<span>#${i + 1}</span>`;
                const greetingContentResult = this.createToggleableContent(g, `alt-greeting-${i}`, true, 200);
                const greetingContent = greetingContentResult.container;
                const greetingToggleBtn = greetingContentResult.toggleBtn;
                
                greetingHeader.appendChild(greetingToggleBtn);
                item.appendChild(greetingHeader);
                item.appendChild(greetingContent);
                contentDiv.appendChild(item);
            });

            altSection.appendChild(altHeader);
            altSection.appendChild(contentDiv);
            container.appendChild(altSection);
        } else {
            // 无备选开场白时显示提示
            const emptySection = doc.createElement('div');
            emptySection.className = 'cm-section';
            emptySection.innerHTML = '<div style="padding:40px;text-align:center;color:var(--cm-text-sec);font-size:14px">暂无备选开场白</div>';
            container.appendChild(emptySection);
        }
    }

    renderHistoryTab() {
        const container = this.tabContents['history'];
        container.innerHTML = '';
        container.style.padding = '0';

        const historySection = doc.createElement('div');
        historySection.className = 'cm-section';
        historySection.style.border = 'none';
        historySection.style.margin = '0';
        
        historySection.innerHTML = '<div id="cmHistoryList" style="max-height:100%;overflow-y:auto"></div>';
        container.appendChild(historySection);
        
        const list = historySection.querySelector('#cmHistoryList');
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--cm-text-sec);">加载中...</div>';

        getCharChatHistory(this.char).then(history => {
            if (!history || history.length === 0) {
                list.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.6;display:flex;flex-direction:column;align-items:center;gap:10px;">' +
                    '<div style="font-size:40px">💬</div>' +
                    '<div>暂无聊天记录</div>' +
                    '</div>';
                return;
            }
            
            list.innerHTML = '';
            
            // 新对话按钮
            const newChatBtn = doc.createElement('div');
            newChatBtn.className = 'cm-history-item new-chat';
            newChatBtn.style.cssText = 'padding:16px;border-bottom:1px solid var(--cm-border);cursor:pointer;display:flex;align-items:center;gap:12px;background:var(--cm-bg-sec);color:var(--cm-accent);font-weight:bold;';
            newChatBtn.innerHTML = '<div style="font-size:20px">+</div><div>开始新对话</div>';
            newChatBtn.onclick = () => this.launchChat('');
            list.appendChild(newChatBtn);

            history.forEach(h => {
                const item = doc.createElement('div');
                item.className = 'cm-history-item';
                item.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--cm-border);cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:background 0.2s;';
                item.onmouseover = () => item.style.background = 'var(--cm-hover)';
                item.onmouseout = () => item.style.background = 'transparent';
                
                const base = this.char.fileName.replace(/\.[^/.]+$/, "");
                let chatName = h.file_name.replace(base + ' - ', '').replace(/\.jsonl$/i, '');
                if (chatName === h.file_name) chatName = h.file_name;

                const dateStr = h.last_mes ? new Date(h.last_mes).toLocaleString() : '未知时间';

                const info = doc.createElement('div');
                info.style.cssText = 'flex:1;overflow:hidden';
                info.innerHTML = `
                    <div style="font-weight:bold;font-size:14px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(chatName)}">${escapeHtml(chatName)}</div>
                    <div style="font-size:12px;color:var(--cm-text-sec);display:flex;gap:10px;">
                        <span>${dateStr}</span>
                        <span>${h.chat_items || 0} 条对话</span>
                        <span>${h.file_size || '0 KB'}</span>
                    </div>
                `;
                
                info.onclick = () => this.launchChat(h.file_name);
                
                // 删除按钮
                const delBtn = doc.createElement('button');
                delBtn.innerHTML = ICONS.trash;
                delBtn.className = 'cm-icon-btn';
                delBtn.style.cssText = 'padding:8px;color:var(--cm-text-sec);opacity:0.5;background:transparent;border:none;cursor:pointer;';
                delBtn.onmouseover = (e) => { e.stopPropagation(); delBtn.style.opacity = '1'; delBtn.style.color = 'var(--cm-red)'; };
                delBtn.onmouseout = (e) => { e.stopPropagation(); delBtn.style.opacity = '0.5'; delBtn.style.color = 'var(--cm-text-sec)'; };
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (await showConfirm(`确定删除聊天记录 "${chatName}" 吗？`)) {
                        try {
                            const success = await deleteChatFile(h.file_name, this.char.fileName);
                            if (success) {
                                item.remove();
                                notify('聊天记录已删除', 'success');
                                // 刷新计数
                                getCharHistoryCount(this.char).then(count => {
                                    const el = this.container.querySelector('#cm-detail-chat-count');
                                    if (el) el.innerHTML = '💬 ' + count;
                                });
                            }
                        } catch (err) {
                            console.error('删除聊天记录失败:', err);
                            notify('删除失败: ' + err.message, 'error');
                        }
                    }
                };

                item.appendChild(info);
                item.appendChild(delBtn);
                list.appendChild(item);
            });
        });
    }

    // 辅助方法：尝试从不同位置读取属性
    getCharProp(key) {
        // 1. 尝试直接读取顶层属性 (非空值优先)
        if (this.char[key] !== undefined && this.char[key] !== null && this.char[key] !== '') {
            return this.char[key];
        }
        // 2. 尝试从 data 对象读取
        if (this.char.data && this.char.data[key] !== undefined && this.char.data[key] !== null && this.char.data[key] !== '') {
            return this.char.data[key];
        }
        // 3. 如果都为空，返回顶层属性
        return this.char[key];
    }

    /**
     * 净化 CSS 内容，移除危险属性
     * 移植自 SillyTavern-CharacterLibrary
     */


    renderMarkdown(text) {
        if (!text) return '';
        // 检测是否包含 HTML 标签，决定是否保留 HTML
        const hasHtml = /<\/?[a-z][\s\S]*>/i.test(text);
        return formatRichText(text, this.char?.name || '', hasHtml);
    }

    renderMarkdownField(container, label, value) {
        // if (!value) return; // 不再隐藏空字段

        const wrapper = doc.createElement('div');
        wrapper.style.marginBottom = '16px';
        
        const labelEl = doc.createElement('div');
        labelEl.textContent = label;
        labelEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--cm-text-sec);margin-bottom:4px;text-transform:uppercase;';
        
        const contentEl = doc.createElement('div');
        contentEl.className = 'cm-markdown-body';
        contentEl.innerHTML = this.renderMarkdown(value);
        
        const isExpand = state.settings.detailContentMode === 'expand';
        const maxHeightStyle = isExpand ? 'max-height:none;overflow-y:visible;' : 'max-height:400px;overflow-y:auto;';
        
        contentEl.style.cssText = `font-size:14px;color:var(--cm-text);line-height:1.5;background:var(--cm-bg-ter);padding:10px;border-radius:6px;border:1px solid var(--cm-border);${maxHeightStyle}overflow-x:hidden;word-wrap:break-word;`;
        
        // 确保链接在新标签页打开
        contentEl.querySelectorAll('a').forEach(a => {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.color = 'var(--cm-accent-text)';
        });

        // 限制图片最大宽度
        contentEl.querySelectorAll('img').forEach(img => {
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.borderRadius = '4px';
        });

        wrapper.appendChild(labelEl);
        wrapper.appendChild(contentEl);
        container.appendChild(wrapper);
    }

    renderField(container, label, value) {
        // if (!value) return; // 不再隐藏空字段
        
        const wrapper = doc.createElement('div');
        wrapper.style.marginBottom = '16px';
        
        const labelEl = doc.createElement('div');
        labelEl.textContent = label;
        labelEl.style.cssText = 'font-size:12px;font-weight:600;color:var(--cm-text-sec);margin-bottom:4px;text-transform:uppercase;';
        
        const contentEl = doc.createElement('div');
        contentEl.textContent = value;
        contentEl.style.cssText = 'font-size:14px;color:var(--cm-text);white-space:pre-wrap;line-height:1.5;background:var(--cm-bg-ter);padding:10px;border-radius:6px;border:1px solid var(--cm-border);max-height:300px;overflow-y:auto;';
        
        wrapper.appendChild(labelEl);
        wrapper.appendChild(contentEl);
        container.appendChild(wrapper);
    }

    renderExtendedTab() {
        const container = this.tabContents['extended'];
        container.innerHTML = '';
        
        const advContent = doc.createElement('div');
        advContent.className = 'cm-advanced-content';
        
        let html = '';
        // 1. 角色专属世界书
        html += buildCharacterBookHTML(this.char);
        // 2. 角色卡内正则脚本
        html += buildRegexScriptsHTML(this.char);
        // 3. 角色卡内酒馆助手脚本
        html += buildTavernHelperHTML(this.char);

        if (!html) {
            html = '<div style="padding:16px;text-align:center;color:var(--cm-text-sec);opacity:0.6">该角色卡无扩展数据</div>';
        }

        advContent.innerHTML = html;
        container.appendChild(advContent);

        // 绑定折叠/展开事件
        this.bindExtendedEvents(advContent);
    }

    bindExtendedEvents(container) {
        // 主块折叠
        container.querySelectorAll('.cm-adv-toggle').forEach(btn => {
            btn.onclick = function () {
                const target = this.closest('.cm-adv-block').querySelector('.cm-adv-block-body');
                const icon = this.querySelector('.cm-adv-toggle-icon');
                if (target.style.display === 'none') {
                    target.style.display = '';
                    icon.textContent = '▼';
                } else {
                    target.style.display = 'none';
                    icon.textContent = '▶';
                }
            };
        });

        // 世界书条目折叠
        container.querySelectorAll('.cm-wi-entry-header').forEach(hdr => {
            hdr.onclick = function () {
                const body = this.nextElementSibling;
                const icon = this.querySelector('.cm-wi-toggle-icon');
                if (body.style.display === 'none') {
                    body.style.display = '';
                    icon.textContent = '▼';
                } else {
                    body.style.display = 'none';
                    icon.textContent = '▶';
                }
            };
        });

        // 正则/脚本条目折叠
        container.querySelectorAll('.cm-collapsible-header').forEach(hdr => {
            hdr.onclick = function () {
                const body = this.nextElementSibling;
                const icon = this.querySelector('.cm-collapsible-icon');
                if (body && body.style.display === 'none') {
                    body.style.display = '';
                    if (icon) icon.textContent = '▼';
                } else if (body) {
                    body.style.display = 'none';
                    if (icon) icon.textContent = '▶';
                }
            };
        });
    }

    renderGalleryTab() {
        const container = this.tabContents['gallery'];
        container.innerHTML = '';
        container.style.cssText = 'display:flex;flex-direction:column;height:100%;flex:1;min-height:0;';
        
        renderGallery(container, this.char);
    }

    renderEditTab() {
        const container = this.tabContents['edit'];
        container.innerHTML = '';
        container.style.padding = '16px';

        const toolbar = doc.createElement('div');
        toolbar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid var(--cm-border);';

        const unlockLabel = doc.createElement('label');
        unlockLabel.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;';

        const unlockCheck = doc.createElement('input');
        unlockCheck.type = 'checkbox';

        const unlockText = doc.createElement('span');
        unlockText.innerHTML = `${ICONS.lock} 解锁编辑`;
        unlockText.style.fontSize = '13px';

        unlockLabel.appendChild(unlockCheck);
        unlockLabel.appendChild(unlockText);
        toolbar.appendChild(unlockLabel);

        const saveBtn = doc.createElement('button');
        saveBtn.className = 'cm-btn cm-btn-primary';
        saveBtn.innerHTML = '💾 保存更改';
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        toolbar.appendChild(saveBtn);

        container.appendChild(toolbar);

        const form = doc.createElement('div');
        form.className = 'cm-edit-form';
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '14px';

        const makeSection = (title) => {
            const section = doc.createElement('div');
            section.className = 'cm-section';
            section.style.margin = '0';
            section.style.border = '1px solid var(--cm-border)';
            section.style.borderRadius = '8px';

            const header = doc.createElement('div');
            header.style.cssText = 'padding:10px 12px;font-size:13px;font-weight:600;color:var(--cm-text);background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);';
            header.textContent = title;

            const body = doc.createElement('div');
            body.style.cssText = 'padding:12px;background:var(--cm-bg);display:flex;flex-direction:column;gap:10px;';

            section.appendChild(header);
            section.appendChild(body);
            return { section, body };
        };

        const secBasic = makeSection('📌 基础信息');
        const secRole = makeSection('🧩 角色信息');
        const secGreeting = makeSection('💬 开场白');
        const secNotes = makeSection('📝 作者注释');
        const secWorld = makeSection('🌐 角色世界书');

        form.appendChild(secBasic.section);
        form.appendChild(secRole.section);
        form.appendChild(secGreeting.section);
        form.appendChild(secNotes.section);
        form.appendChild(secWorld.section);

        const fields = [
            { key: 'name', label: '角色名称', type: 'text', section: secBasic.body },
            { key: 'creator', label: '作者', type: 'text', section: secBasic.body },
            { key: 'version', label: '版本', type: 'text', section: secBasic.body },
            { key: 'description', label: '描述 / 人设', type: 'textarea', rows: 6, section: secRole.body },
            { key: 'personality_summary', label: '人格摘要', type: 'textarea', rows: 3, section: secRole.body },
            { key: 'scenario', label: '场景 / 设定', type: 'textarea', rows: 4, section: secRole.body },
            { key: 'first_mes', label: '默认开场白', type: 'textarea', rows: 6, section: secGreeting.body },
            { key: 'creator_notes', label: '作者注释', type: 'textarea', rows: 6, section: secNotes.body },
            { key: 'character_book', label: '世界书名称（可选）', type: 'text', section: secWorld.body },
        ];

        const inputs = {};

        fields.forEach(f => {
            const fieldWrap = doc.createElement('div');
            fieldWrap.style.marginBottom = '12px';

            const label = doc.createElement('div');
            label.textContent = f.label;
            label.style.cssText = 'font-size:12px;font-weight:600;color:var(--cm-text-sec);margin-bottom:4px;';

            let input;
            if (f.type === 'textarea') {
                input = doc.createElement('textarea');
                input.rows = f.rows || 4;
                input.style.resize = 'vertical';
            } else {
                input = doc.createElement('input');
                input.type = 'text';
            }

            input.className = 'cm-input';
            input.style.cssText = 'width:100%;padding:8px;border-radius:4px;border:1px solid var(--cm-border);background:var(--cm-input-bg);color:var(--cm-text);font-family:inherit;font-size:13px;';
            input.disabled = true;

            let val = this.getCharProp(f.key);
            if (f.key === 'character_book') {
                val = (typeof val === 'string') ? val : (val && typeof val === 'object' ? String(val.name || '') : '');
            }
            input.value = val || '';

            inputs[f.key] = input;

            fieldWrap.appendChild(label);
            fieldWrap.appendChild(input);
            f.section.appendChild(fieldWrap);
        });

        const altTitle = doc.createElement('div');
        altTitle.textContent = '备选开场白';
        altTitle.style.cssText = 'font-size:12px;font-weight:600;color:var(--cm-text-sec);margin-top:4px;';
        secGreeting.body.appendChild(altTitle);

        const altList = doc.createElement('div');
        altList.className = 'cm-edit-alt-list';
        altList.style.display = 'flex';
        altList.style.flexDirection = 'column';
        altList.style.gap = '12px';
        secGreeting.body.appendChild(altList);

        const altInputs = [];

        const renderAltItem = (text, index) => {
            const item = doc.createElement('div');
            item.className = 'cm-edit-alt-item';
            item.style.cssText = 'display:flex;gap:8px;align-items:flex-start;background:var(--cm-bg-ter);padding:10px;border-radius:6px;border:1px solid var(--cm-border);';

            const num = doc.createElement('div');
            num.textContent = `#${index + 1}`;
            num.style.cssText = 'font-size:12px;color:var(--cm-text-sec);width:24px;flex-shrink:0;padding-top:6px;';

            const textarea = doc.createElement('textarea');
            textarea.className = 'cm-input';
            textarea.value = text || '';
            textarea.rows = 3;
            textarea.style.cssText = 'flex:1;resize:vertical;min-height:60px;font-size:13px;';
            textarea.disabled = !unlockCheck.checked;

            const delBtn = doc.createElement('button');
            delBtn.className = 'cm-btn cm-btn-danger';
            delBtn.innerHTML = ICONS.trash;
            delBtn.style.padding = '4px 8px';
            delBtn.disabled = !unlockCheck.checked;
            delBtn.onclick = () => {
                item.remove();
                const idx = altInputs.indexOf(textarea);
                if (idx > -1) altInputs.splice(idx, 1);
                updateAltNumbers();
            };

            item.appendChild(num);
            item.appendChild(textarea);
            item.appendChild(delBtn);
            altList.appendChild(item);
            altInputs.push(textarea);
        };

        const updateAltNumbers = () => {
            altList.querySelectorAll('.cm-edit-alt-item').forEach((item, i) => {
                item.querySelector('div').textContent = `#${i + 1}`;
            });
        };

        const existingAlts = this.getCharProp('alternate_greetings') || [];
        existingAlts.forEach((g, i) => renderAltItem(g, i));

        const addAltBtn = doc.createElement('button');
        addAltBtn.className = 'cm-btn cm-btn-secondary';
        addAltBtn.innerHTML = '+ 添加备选开场白';
        addAltBtn.style.marginTop = '12px';
        addAltBtn.style.width = '100%';
        addAltBtn.disabled = !unlockCheck.checked;
        addAltBtn.onclick = () => {
            renderAltItem('', altInputs.length);
        };
        secGreeting.body.appendChild(addAltBtn);
        const secWorldHeader = secWorld.section.firstElementChild;
        secWorldHeader.style.display = 'flex';
        secWorldHeader.style.alignItems = 'center';
        secWorldHeader.style.justifyContent = 'space-between';

        const lorebookCount = doc.createElement('span');
        lorebookCount.style.cssText = 'font-size:12px;color:var(--cm-text-sec);font-weight:500;';
        lorebookCount.textContent = '(0 ??)';
        secWorldHeader.appendChild(lorebookCount);

        const worldNameInput = inputs['character_book'];
        worldNameInput.style.marginBottom = '10px';

        const currentBookRaw = this.getCharProp('character_book');
        const normalizeBookEntries = (book) => {
            if (!book) return [];
            if (Array.isArray(book)) return [...book];
            if (typeof book === 'object') {
                if (Array.isArray(book.entries)) return [...book.entries];
                if (book.entries && typeof book.entries === 'object') return Object.values(book.entries);
            }
            return [];
        };

        const lorebookEntriesContainer = doc.createElement('div');
        lorebookEntriesContainer.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
        secWorld.body.appendChild(lorebookEntriesContainer);

        const updateLorebookCount = () => {
            const count = lorebookEntriesContainer.querySelectorAll('.cm-lorebook-entry-edit').length;
            lorebookCount.textContent = `(${count} 条目)`;
        };

        const addLorebookEntryField = (entry = null, index = null) => {
            const idx = index !== null ? index : lorebookEntriesContainer.children.length;
            const name = entry?.comment || entry?.name || '';
            const keys = entry?.keys || entry?.key || [];
            const keyStr = Array.isArray(keys) ? keys.join(', ') : String(keys || '');
            const secondaryKeys = entry?.secondary_keys || [];
            const secondaryKeyStr = Array.isArray(secondaryKeys) ? secondaryKeys.join(', ') : String(secondaryKeys || '');
            const content = entry?.content || '';
            const enabled = entry?.enabled !== false && !entry?.disable;
            const selective = entry?.selective || false;
            const constant = entry?.constant || false;
            const order = entry?.order ?? entry?.insertion_order ?? idx;
            const priority = entry?.priority ?? 10;

            const wrapper = doc.createElement('div');
            wrapper.className = `cm-lorebook-entry-edit${enabled ? '' : ' cm-lorebook-entry-disabled'}`;
            wrapper.style.cssText = 'display:flex;flex-direction:column;gap:8px;background:var(--cm-bg-ter);padding:10px;border-radius:6px;border:1px solid var(--cm-border);';
            wrapper.innerHTML = `
                <div style="display:flex;gap:8px;align-items:center;">
                    <input type="text" class="cm-input cm-lorebook-name-input" placeholder="条目名称/备注" style="flex:1;font-weight:600;">
                    <label class="cm-lorebook-toggle ${enabled ? 'enabled' : 'disabled'}" style="font-size:12px;cursor:pointer;white-space:nowrap;">
                        <input type="checkbox" class="cm-lorebook-enabled-checkbox" ${enabled ? 'checked' : ''} style="display:none;">
                        ${enabled ? '启用' : '停用'}
                    </label>
                    <button type="button" class="cm-btn cm-btn-danger cm-lorebook-delete-btn" style="padding:4px 8px;">${ICONS.trash}</button>
                </div>
                <input type="text" class="cm-input cm-lorebook-keys-input" placeholder="关键词（逗号分隔）">
                <input type="text" class="cm-input cm-lorebook-secondary-keys-input" placeholder="次级关键词（可选）">
                <textarea class="cm-input cm-lorebook-content-input" rows="3" style="resize:vertical;" placeholder="条目内容"></textarea>
                <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
                    <label style="font-size:12px;"><input type="checkbox" class="cm-lorebook-selective-checkbox" ${selective ? 'checked' : ''}> 选择性匹配</label>
                    <label style="font-size:12px;"><input type="checkbox" class="cm-lorebook-constant-checkbox" ${constant ? 'checked' : ''}> 常驻条目</label>
                    <label style="font-size:12px;display:flex;align-items:center;gap:6px;">顺序 <input type="number" class="cm-input cm-lorebook-order-input" style="width:80px;padding:4px 6px;"></label>
                    <label style="font-size:12px;display:flex;align-items:center;gap:6px;">优先级 <input type="number" class="cm-input cm-lorebook-priority-input" style="width:80px;padding:4px 6px;"></label>
                </div>
            `;

            lorebookEntriesContainer.appendChild(wrapper);
            wrapper.querySelector('.cm-lorebook-name-input').value = name;
            wrapper.querySelector('.cm-lorebook-keys-input').value = keyStr;
            wrapper.querySelector('.cm-lorebook-secondary-keys-input').value = secondaryKeyStr;
            wrapper.querySelector('.cm-lorebook-content-input').value = content;
            wrapper.querySelector('.cm-lorebook-order-input').value = String(order);
            wrapper.querySelector('.cm-lorebook-priority-input').value = String(priority);

            const toggleLabel = wrapper.querySelector('.cm-lorebook-toggle');
            toggleLabel.onclick = (e) => {
                e.preventDefault();
                const checkbox = wrapper.querySelector('.cm-lorebook-enabled-checkbox');
                const next = !checkbox.checked;
                checkbox.checked = next;
                toggleLabel.className = `cm-lorebook-toggle ${next ? 'enabled' : 'disabled'}`;
                toggleLabel.innerHTML = `<input type="checkbox" class="cm-lorebook-enabled-checkbox" ${next ? 'checked' : ''} style="display:none;">${next ? '启用' : '停用'}`;
                wrapper.classList.toggle('cm-lorebook-entry-disabled', !next);
            };

            wrapper.querySelector('.cm-lorebook-delete-btn').onclick = () => {
                wrapper.remove();
                updateLorebookCount();
            };

            updateLorebookCount();
        };

        const addLorebookBtn = doc.createElement('button');
        addLorebookBtn.className = 'cm-btn cm-btn-secondary';
        addLorebookBtn.innerHTML = '+ 添加条目';
        addLorebookBtn.style.width = '100%';
        addLorebookBtn.style.marginTop = '10px';
        addLorebookBtn.disabled = true;
        addLorebookBtn.onclick = () => addLorebookEntryField();
        secWorld.body.appendChild(addLorebookBtn);

        const getCharacterBookFromEditor = () => {
            const entries = [];
            lorebookEntriesContainer.querySelectorAll('.cm-lorebook-entry-edit').forEach((el, idx) => {
                const name = el.querySelector('.cm-lorebook-name-input')?.value.trim() || `条目${idx + 1}`;
                const keys = (el.querySelector('.cm-lorebook-keys-input')?.value || '').split(',').map(k => k.trim()).filter(Boolean);
                const secondaryKeys = (el.querySelector('.cm-lorebook-secondary-keys-input')?.value || '').split(',').map(k => k.trim()).filter(Boolean);
                const content = el.querySelector('.cm-lorebook-content-input')?.value || '';
                const enabled = el.querySelector('.cm-lorebook-enabled-checkbox')?.checked ?? true;
                const selective = el.querySelector('.cm-lorebook-selective-checkbox')?.checked || false;
                const constant = el.querySelector('.cm-lorebook-constant-checkbox')?.checked || false;
                const order = parseInt(el.querySelector('.cm-lorebook-order-input')?.value, 10);
                const priority = parseInt(el.querySelector('.cm-lorebook-priority-input')?.value, 10);

                entries.push({
                    keys,
                    secondary_keys: secondaryKeys,
                    content,
                    comment: name,
                    enabled,
                    selective,
                    constant,
                    insertion_order: Number.isFinite(order) ? order : idx,
                    order: Number.isFinite(order) ? order : idx,
                    priority: Number.isFinite(priority) ? priority : 10,
                    id: idx,
                    position: 'before_char',
                    case_sensitive: false,
                    use_regex: false,
                    extensions: {},
                });
            });

            if (entries.length === 0) return null;
            return {
                name: (worldNameInput.value || '').trim(),
                description: '',
                scan_depth: 2,
                token_budget: 512,
                recursive_scanning: false,
                entries,
            };
        };

        const normalizeComparableBook = (book) => {
            if (!book) return null;
            const entries = normalizeBookEntries(book);
            if (entries.length === 0) return null;
            return entries.map((entry) => ({
                keys: (entry.keys || entry.key || []).map(k => String(k || '').trim()).filter(Boolean),
                secondary_keys: (entry.secondary_keys || []).map(k => String(k || '').trim()).filter(Boolean),
                content: String(entry.content || '').replace(/\r\n/g, '\n').trim(),
                comment: String(entry.comment || entry.name || '').replace(/\r\n/g, '\n').trim(),
                enabled: entry.enabled !== false && !entry.disable,
                selective: !!entry.selective,
                constant: !!entry.constant,
                order: entry.order ?? entry.insertion_order ?? 0,
                priority: entry.priority ?? 10,
            }));
        };

        normalizeBookEntries(currentBookRaw).forEach((entry, idx) => addLorebookEntryField(entry, idx));
        updateLorebookCount();

        container.appendChild(form);

        unlockCheck.onchange = () => {
            const isUnlocked = unlockCheck.checked;
            unlockText.innerHTML = isUnlocked ? `${ICONS.unlock} 编辑模式` : `${ICONS.lock} 解锁编辑`;
            unlockText.style.color = isUnlocked ? 'var(--cm-accent)' : 'inherit';

            Object.values(inputs).forEach(inp => inp.disabled = !isUnlocked);
            altInputs.forEach(inp => inp.disabled = !isUnlocked);
            altList.querySelectorAll('button').forEach(btn => btn.disabled = !isUnlocked);
            addAltBtn.disabled = !isUnlocked;

            addLorebookBtn.disabled = !isUnlocked;
            lorebookEntriesContainer.querySelectorAll('input, textarea, button').forEach(el => el.disabled = !isUnlocked);
            lorebookEntriesContainer.querySelectorAll('.cm-lorebook-toggle').forEach((toggle) => {
                toggle.style.pointerEvents = isUnlocked ? '' : 'none';
                toggle.style.opacity = isUnlocked ? '' : '0.5';
            });

            saveBtn.disabled = !isUnlocked;
            saveBtn.style.opacity = isUnlocked ? '1' : '0.5';
        };

        // 初始化时设置锁定状态
        unlockCheck.onchange();

        saveBtn.onclick = async () => {
            if (!unlockCheck.checked) return;

            const changes = {};
            let hasChanges = false;

            // 预先获取当前世界书对象和新编辑器数据（用于处理 character_book 变化时保留 entries）
            const currentCharBook = this.getCharProp('character_book');
            const newBookFromEditor = getCharacterBookFromEditor();

            fields.forEach(f => {
                const newVal = inputs[f.key].value.trim();
                let oldVal = this.getCharProp(f.key);

                if (f.key === 'character_book') {
                    oldVal = typeof oldVal === 'string' ? oldVal : (oldVal && typeof oldVal === 'object' ? String(oldVal.name || '') : '');
                }

                if (newVal !== (oldVal || '')) {
                    // 关键修复：character_book 必须始终写为完整对象，保留 entries
                    if (f.key === 'character_book') {
                        // 获取当前 entries（保留原有词条），确保不会返回 undefined
                        const existingEntries = (currentCharBook?.entries) || (newBookFromEditor?.entries) || [];
                        
                        // 构建完整世界书对象
                        changes[f.key] = {
                            name: newVal,  // 名称来自输入框
                            description: currentCharBook?.description || '',
                            scan_depth: currentCharBook?.scan_depth ?? 2,
                            token_budget: currentCharBook?.token_budget ?? 512,
                            recursive_scanning: currentCharBook?.recursive_scanning ?? false,
                            entries: existingEntries,  // 保留原有词条
                        };
                    } else {
                        changes[f.key] = newVal;
                    }
                    hasChanges = true;
                }
            });

            const newAlts = altInputs.map(inp => inp.value).filter(s => s.trim() !== '');
            const oldAlts = this.getCharProp('alternate_greetings') || [];
            if (JSON.stringify(newAlts) !== JSON.stringify(oldAlts)) {
                changes['alternate_greetings'] = newAlts;
                hasChanges = true;
            }

            const oldBookComparable = normalizeComparableBook(this.getCharProp('character_book'));
            const newBookComparable = normalizeComparableBook(newBookFromEditor);
            if (JSON.stringify(oldBookComparable) !== JSON.stringify(newBookComparable)) {
                changes['character_book'] = newBookFromEditor;
                hasChanges = true;
            }

            if (!hasChanges) {
                notify('没有检测到更改', 'info');
                return;
            }

            // 防抖：保存进行中时禁用按钮并显示 loading 状态
            const originalBtnText = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="cm-spinner" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:6px;vertical-align:middle;"></span> 保存中...';
            
            // 添加 spinner 旋转动画（仅添加一次）
            if (!doc.getElementById('cm-spinner-style')) {
                const style = doc.createElement('style');
                style.id = 'cm-spinner-style';
                style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
                doc.head.appendChild(style);
            }

            try {
                await saveCharacterData(this.char.fileName, (data) => {
                    Object.assign(data, changes);
                });

                if (this.char.data) {
                    Object.assign(this.char.data, changes);
                } else {
                    Object.assign(this.char, changes);
                }

                this.renderDetailsTab();
                if (typeof this.rebuildHeaderPreserveOrder === 'function') {
                    this.rebuildHeaderPreserveOrder();
                } else if (this.container) {
                    const detailBody = this.container.querySelector('.cm-detail-body');
                    const tabsNav = this.container.querySelector('.cm-tabs-nav');
                    const oldHeader = this.container.querySelector('.cm-detail-header');
                    if (oldHeader) oldHeader.remove();
                    this.renderHeader();
                    const newHeader = this.container.querySelector('.cm-detail-header');
                    // header 应该在 detailBody 内部，tabsNav 之前
                    if (detailBody && newHeader) {
                        if (tabsNav) {
                            tabsNav.before(newHeader);
                        } else {
                            detailBody.insertBefore(newHeader, detailBody.firstChild);
                        }
                    }
                }
                renderView();

                unlockCheck.checked = false;
                unlockCheck.onchange();
                notify('保存成功', 'success');

            } catch (e) {
                notify('保存失败: ' + e.message, 'error');
            } finally {
                // 恢复保存按钮状态
                saveBtn.disabled = !unlockCheck.checked;
                saveBtn.innerHTML = originalBtnText;
            }
        };
    }
    renderTags(container) {
        container.innerHTML = '';
        const charTags = getCharTags(this.char.fileName);
        
        charTags.forEach(tag => {
            const span = doc.createElement('span');
            span.className = 'cm-char-tag';
            span.style.background = tag.color || '#666';
            span.textContent = tag.name;
            
            const removeBtn = doc.createElement('span');
            removeBtn.className = 'cm-char-tag-remove';
            removeBtn.textContent = '×';
            removeBtn.onclick = async (e) => {
                e.stopPropagation();
                await removeTagFromChar(this.char.fileName, tag.id);
                this.renderTags(container); // 重新渲染标签区域
                renderTagSidebar();
                renderView();
                notify('标签已移除', 'success');
            };
            
            span.appendChild(removeBtn);
            container.appendChild(span);
        });

        if (charTags.length === 0) {
            const noTag = doc.createElement('span');
            noTag.style.color = 'var(--cm-text-sec)';
            noTag.style.fontSize = '12px';
            noTag.style.opacity = '0.6';
            noTag.textContent = '无标签';
            container.appendChild(noTag);
        }

        const addBtn = doc.createElement('span');
        addBtn.className = 'cm-char-tag-add';
        addBtn.textContent = '+';
        addBtn.onclick = (e) => {
            e.stopPropagation();
            showTagSelector(this.char, container, this.overlay, () => this.renderTags(container));
        };
        container.appendChild(addBtn);

        // 一键删除所有标签的扫把按钮
        if (charTags.length > 0) {
            const clearBtn = doc.createElement('span');
            clearBtn.className = 'cm-char-tag-clear';
            clearBtn.innerHTML = ICONS.trash;
            clearBtn.title = '清除所有标签';
            clearBtn.style.cssText = 'cursor:pointer;margin-left:8px;opacity:0.6;transition:opacity 0.2s;font-size:14px;display:inline-flex;align-items:center;';
            clearBtn.onmouseover = () => clearBtn.style.opacity = '1';
            clearBtn.onmouseout = () => clearBtn.style.opacity = '0.6';
            clearBtn.onclick = async (e) => {
                e.stopPropagation();
                const confirmed = await showConfirm(`确定要清除 "${this.char.name}" 的所有标签吗？共 ${charTags.length} 个标签。`);
                if (!confirmed) return;
                
                // 调用删除单个标签的函数实现批量删除
                for (const tag of charTags) {
                    await removeTagFromChar(this.char.fileName, tag.id);
                }
                
                this.renderTags(container); // 重新渲染标签区域
                renderTagSidebar();
                renderView();
                notify('已清除所有标签', 'success');
            };
            container.appendChild(clearBtn);
        }
    }

    // --- Event Handlers ---

    handleAvatarChange(avatarImg) {
        const fileInput = doc.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/webp,image/jpeg';
        fileInput.onchange = async (e) => {
            const file = fileInput.files[0];
            if (!file) return;
            
            if (file.type === 'image/png' || file.type === 'image/webp') {
                try {
                    const buf = await file.arrayBuffer();
                    const meta = await parsePNG(buf);
                    if (meta && meta.name) {
                        notify('❌ 无法替换：该图片包含角色数据卡(V2/V3)！\n请使用无数据的纯图片，或使用顶部“导入”功能。', 'error');
                        return;
                    }
                } catch (e) { }
            }

            if (await showConfirm('确定要更换卡面图片吗？\n(注意：仅替换显示图片，不修改角色数据)')) {
                try {
                    await replaceCharacterImage(this.char, file);
                    avatarImg.src = this.char.avatarUrl;
                    // 更新列表卡片
                    const cardImg = doc.querySelector(`.cm-card[data-file="${CSS.escape(this.char.fileName)}"] .cm-card-img`);
                    if (cardImg) cardImg.src = this.char.avatarUrl;
                    notify('图片已更换', 'success');
                } catch (err) { notify(err.message, 'error'); }
            }
        };
        fileInput.click();
    }

    handleRename(nameWrap, h2) {
        nameWrap.innerHTML = '';
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'cm-detail-title-input';
        input.value = this.char.name;
        
        const saveBtn = doc.createElement('button');
        saveBtn.className = 'cm-edit-btn';
        saveBtn.innerHTML = '💾';
        saveBtn.onclick = async () => {
            const newName = input.value.trim();
            if (newName && newName !== this.char.name) {
                if (await renameCharacterFile(this.char, newName)) {
                    this.show(); // 重新渲染
                    renderView();
                }
            } else {
                this.show(); // 恢复原状
            }
        };
        
        nameWrap.appendChild(input);
        nameWrap.appendChild(saveBtn);
        input.focus();
    }

    handleVersionEdit() {
        createBaseDialog(
            '修改版本号',
            '<div class="cm-form-group"><label>版本号</label><input type="text" class="cm-input" id="cmVerInput" value="' + escapeHtml(this.char.version || '') + '" placeholder="例如: 1.0.0"></div>',
            [
                { text: '取消', id: 'cmVerCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => close() },
                {
                    text: '保存', id: 'cmVerSave', cls: 'cm-btn-primary', onClick: (ov, close) => {
                        const input = ov.querySelector('#cmVerInput');
                        const newVer = input.value.trim();
                        if (newVer !== (this.char.version || '')) {
                            updateCharacterVersion(this.char, newVer).then(success => {
                                if (success) this.show();
                            });
                        }
                        close();
                    }
                }
            ],
            (ov) => ov.querySelector('#cmVerInput').focus()
        );
    }

    handleUpdate() {
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = '.png,.webp';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const doUpdate = await showConfirm(
                '⚠️ 覆盖更新确认\n\n' +
                '即将用新图片覆盖：' + this.char.name + '\n' +
                '1. 文件名保持不变\n' +
                '2. 来源链接(Source Link) 将被保留\n' +
                '3. 其他设定将被新卡替换\n\n' +
                '确定继续吗？'
            );
            if (!doUpdate) return;

            try {
                notify('正在解析新卡片...', 'info');
                const buf = await file.arrayBuffer();
                const cardData = await parsePNG(buf);

                if (!cardData) throw new Error('无法解析图片数据');

                const dataBlock = cardData.data || cardData;

                await updateCharacter(this.char.fileName, dataBlock, file, {
                    cleanOldWorldInfo: true,
                    preserveSourceLink: true,
                    refreshUI: true,
                    notifySuccess: true,
                    fullCardData: cardData
                });
                
                // 更新成功后刷新详情页
                this.show();

            } catch (e) {
                console.error(e);
                notify('更新失败: ' + e.message, 'error');
            }
        };
        input.click();
    }

    /**
     * 创建可伸缩的内容区域
     * @param {string} content - 要显示的内容
     * @param {string} id - 内容区域的唯一标识
     * @param {boolean} isGreeting - 是否为开场白内容（使用不同的高度阈值）
     * @param {number} maxHeight - 最大高度阈值（默认300px）
     * @returns {Object} 包含内容容器和伸缩按钮的对象
     */
    createToggleableContent(content, id, isGreeting = false, maxHeight = 300) {
        const container = doc.createElement('div');
        container.className = 'cm-section-content';
        container.id = `cm-content-${id}`;
        
        const contentDiv = doc.createElement('div');
        contentDiv.className = 'cm-markdown-body';
        contentDiv.style.padding = isGreeting ? '12px' : '14px';
        contentDiv.innerHTML = this.renderMarkdown(content || '(无)');
        
        // 创建伸缩按钮 - 默认显示
        const toggleBtn = doc.createElement('button');
        toggleBtn.className = 'cm-toggle-btn';
        toggleBtn.title = '展开/折叠内容';
        
        // 添加 ARIA 无障碍属性
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.setAttribute('aria-controls', `cm-content-${id}`);
        
        // 配置优先级：全局设置 > 本地存储
        const globalSetting = state.settings.detailContentMode;
        const isExpanded = (globalSetting === 'expand') ||
                          (globalSetting !== 'scroll' && localStorage.getItem(this._getToggleKey(id)) === 'expanded');
        
        // 初始化展开/折叠状态
        this._setToggleState(container, toggleBtn, isExpanded, maxHeight);
        
        // 绑定点击事件
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            const shouldExpand = !container.classList.contains('expanded');
            this._setToggleState(container, toggleBtn, shouldExpand, maxHeight);
            localStorage.setItem(this._getToggleKey(id), shouldExpand ? 'expanded' : 'collapsed');
        };
        
        container.appendChild(contentDiv);
        
        return { container, toggleBtn };
    }

    /**
     * 获取本地存储键名（添加角色 ID 命名空间避免冲突）
     * @private
     */
    _getToggleKey(id) {
        const charId = this.char?.fileName || 'default';
        return `cm_toggle_${charId}_${id}`;
    }

    /**
     * 设置伸缩状态（包含动画逻辑）
     * @private
     */
    _setToggleState(container, toggleBtn, isExpanded, maxHeight) {
        if (isExpanded) {
            container.classList.add('expanded');
            container.style.maxHeight = 'none';
            container.style.overflowY = 'visible';
            toggleBtn.classList.add('active');
            toggleBtn.innerHTML = ICONS.minus;
            toggleBtn.setAttribute('aria-expanded', 'true');
        } else {
            container.classList.remove('expanded');
            container.style.maxHeight = `${maxHeight}px`;
            container.style.overflowY = 'auto';
            toggleBtn.classList.remove('active');
            toggleBtn.innerHTML = ICONS.plus;
            toggleBtn.setAttribute('aria-expanded', 'false');
        }
    }
}

// 导出便捷函数
export function showDetail(char) {
    const details = new CharacterDetails(char);
    details.show();
}

function showTagSelector(char, tagsContainer, detailOverlay, onUpdate) {
    const wrapper = doc.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;max-height:60vh;';

    const quickCreate = doc.createElement('div');
    quickCreate.className = 'cm-quick-create';
    quickCreate.style.position = 'relative';
    quickCreate.innerHTML = '<input type="text" placeholder="新建标签..." class="cm-input-sm" autocomplete="off"><button class="cm-btn-sm">+</button>';

    const suggestions = doc.createElement('div');
    suggestions.className = 'cm-tag-suggestions';
    quickCreate.appendChild(suggestions);

    const list = doc.createElement('div');
    list.className = 'cm-tag-selector-list';

    wrapper.appendChild(quickCreate);
    wrapper.appendChild(list);

    const DEFAULT_TAG_COLOR = '#666666'; // 简单定义默认颜色

    function renderListItems() {
        list.innerHTML = '';
        const charTags = getCharTags(char.fileName);
        const charTagIds = charTags.map(t => t.id);
        if (state.tags.length === 0) {
            const empty = doc.createElement('div');
            empty.style.cssText = 'padding:20px;color:var(--cm-text-sec);text-align:center';
            empty.textContent = '暂无标签';
            list.appendChild(empty);
        } else {
            const sortedTags = [...state.tags].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
            sortedTags.forEach(tag => {
                const isSelected = charTagIds.includes(tag.id);
                const item = doc.createElement('div');
                item.className = 'cm-tag-selector-item' + (isSelected ? ' selected' : '');
                item.innerHTML =
                    '<span class="cm-tag-color" style="background:' + (tag.color || '#666') + '"></span>' +
                    '<span>' + escapeHtml(tag.name) + '</span>' +
                    (isSelected ? '<span class="cm-tag-check">✓</span>' : '');

                item.onclick = async function () {
                    if (item.classList.contains('selected')) {
                        await removeTagFromChar(char.fileName, tag.id);
                    } else {
                        await addTagToChar(char.fileName, tag.id);
                    }
                    renderListItems();
                    if (onUpdate) onUpdate();
                    renderTagSidebar();
                    renderView(); // 同步更新角色卡列表页的标签显示
                };
                list.appendChild(item);
            });
        }
    }

    createBaseDialog(
        '选择标签',
        '',
        [{ text: '关闭', id: 'cmTagSelClose', cls: 'cm-btn-secondary', onClick: (ov, close) => close() }],
        (ov, close) => {
            const body = ov.querySelector('.cm-tag-editor-body');
            body.style.padding = '0';
            body.appendChild(wrapper);
            renderListItems();

            const quickInput = quickCreate.querySelector('input');
            const quickBtn = quickCreate.querySelector('button');

            const handleCreate = async (forceName) => {
                const val = (forceName || quickInput.value).trim();
                if (val) {
                    const existingTag = state.tags.find(t => t.name === val);
                    if (existingTag) {
                        await addTagToChar(char.fileName, existingTag.id);
                        notify('已添加已有标签: ' + val, 'success');
                    } else {
                        const newTag = createTag(val, DEFAULT_TAG_COLOR);
                        await addTagToChar(char.fileName, newTag.id);
                        notify('已创建并添加标签', 'success');
                    }
                    if (onUpdate) onUpdate();
                    renderTagSidebar();
                    renderView();
                    renderListItems();
                    quickInput.value = '';
                    suggestions.style.display = 'none';
                }
            };

            quickInput.oninput = function () {
                const val = this.value.trim().toLowerCase();
                if (!val) { suggestions.style.display = 'none'; return; }
                const matches = state.tags.filter(t => t.name.toLowerCase().includes(val));
                if (matches.length > 0) {
                    suggestions.innerHTML = '';
                    matches.forEach(t => {
                        const item = doc.createElement('div');
                        item.className = 'cm-tag-suggestion-item';
                        item.innerHTML = '<span class="cm-tag-color" style="background:' + (t.color || '#666') + '"></span><span>' + escapeHtml(t.name) + '</span>';
                        item.onclick = function () { handleCreate(t.name); };
                        suggestions.appendChild(item);
                    });
                    suggestions.style.display = 'block';
                } else {
                    suggestions.style.display = 'none';
                }
            };
            quickBtn.onclick = () => handleCreate();
            quickInput.onkeydown = (e) => { if (e.key === 'Enter') handleCreate(); };
            quickInput.focus();
        }
    );
}

// --- Helper Functions for Extended Tab ---

function buildCharacterBookHTML(charData) {
    const book = charData.character_book;
    if (!book) return '';

    let entries = [];
    if (Array.isArray(book)) {
        entries = book;
    } else if (book.entries) {
        if (Array.isArray(book.entries)) {
            entries = book.entries;
        } else if (typeof book.entries === 'object') {
            entries = Object.values(book.entries);
        }
    }

    if (entries.length === 0) return '';

    const bookName = (typeof book === 'object' && book.name) ? book.name : '角色世界书';

    // 统计启用/禁用条目数
    const enabledCount = entries.filter(e => e.enabled !== false && !e.disable).length;
    const disabledCount = entries.length - enabledCount;

    // 估算总 Token
    let totalTokens = 0;
    entries.forEach(e => {
        if (e.enabled !== false && !e.disable) {
            totalTokens += calculateTokens(e.content || '');
        }
    });

    let html = '<div class="cm-adv-block">';
    html += '<div class="cm-adv-block-header cm-adv-toggle">';
    html += '<span class="cm-adv-toggle-icon">▼</span>';
    html += '<span class="cm-adv-block-title">🌐 角色世界书</span>';
    html += '<span class="cm-adv-block-badge">' + escapeHtml(bookName) + '</span>';
    html += '<span class="cm-adv-block-stats">' + enabledCount + ' 启用';
    if (disabledCount > 0) html += ' / ' + disabledCount + ' 禁用';
    html += ' · 约 ' + totalTokens + ' T</span>';
    html += '</div>';
    html += '<div class="cm-adv-block-body">';

    entries.forEach((entry, idx) => {
        const isEnabled = entry.enabled !== false && !entry.disable;
        const keys = entry.keys || entry.key || [];
        const keyStr = Array.isArray(keys) ? keys.join(', ') : (typeof keys === 'string' ? keys : '');
        const secondaryKeys = entry.secondary_keys || [];
        const secKeyStr = Array.isArray(secondaryKeys) ? secondaryKeys.join(', ') : '';
        const content = entry.content || '';
        const comment = entry.comment || entry.name || '';
        const entryTokens = calculateTokens(content);

        // 位置映射
        const positionMap = { 0: '之前', 1: '之后', 2: '作者注释顶', 3: '作者注释底', 4: 'Depth' };
        const position = entry.position !== undefined ? (positionMap[entry.position] || '位置 ' + entry.position) : '';

        html += '<div class="cm-wi-entry' + (isEnabled ? '' : ' cm-wi-disabled') + '">';
        html += '<div class="cm-wi-entry-header">';
        html += '<span class="cm-wi-toggle-icon">▶</span>';
        html += '<span class="cm-wi-entry-idx">#' + idx + '</span>';
        html += '<span class="cm-wi-entry-name" title="' + escapeHtml(comment) + '">' + escapeHtml(comment || '(未命名)') + '</span>';
        if (!isEnabled) html += '<span class="cm-wi-badge cm-wi-badge-off">禁用</span>';
        if (entry.constant) html += '<span class="cm-wi-badge cm-wi-badge-const">常驻</span>';
        if (position) html += '<span class="cm-wi-badge cm-wi-badge-pos">' + escapeHtml(position) + '</span>';
        html += '<span class="cm-wi-tokens">🪙 ' + entryTokens + '</span>';
        html += '</div>';

        // 条目详情（默认折叠）
        html += '<div class="cm-wi-entry-body" style="display:none">';
        if (keyStr) {
            html += '<div class="cm-wi-field"><label>主关键词</label><div class="cm-wi-field-val">' + escapeHtml(keyStr) + '</div></div>';
        }
        if (secKeyStr) {
            html += '<div class="cm-wi-field"><label>次关键词</label><div class="cm-wi-field-val">' + escapeHtml(secKeyStr) + '</div></div>';
        }
        if (content) {
            html += '<div class="cm-wi-field"><label>内容</label><pre class="cm-wi-content">' + escapeHtml(content) + '</pre></div>';
        }
        if (entry.depth !== undefined && entry.depth !== null) {
            html += '<div class="cm-wi-field"><label>深度</label><div class="cm-wi-field-val">' + entry.depth + '</div></div>';
        }
        html += '</div>'; // cm-wi-entry-body
        html += '</div>'; // cm-wi-entry
    });

    html += '</div>'; // cm-adv-block-body
    html += '</div>'; // cm-adv-block
    return html;
}

function buildRegexScriptsHTML(charData) {
    const ext = charData.extensions;
    if (!ext || !Array.isArray(ext.regex_scripts) || ext.regex_scripts.length === 0) return '';

    const scripts = ext.regex_scripts;

    // 位置映射
    const placementMap = {
        0: 'MD 显示',
        1: '用户输入',
        2: 'AI 输出',
        3: '斜杠命令',
        4: '世界书',
        5: '提示词',
        6: '用户输入(Raw)',
        99: '仅运行'
    };

    let html = '<div class="cm-adv-block">';
    html += '<div class="cm-adv-block-header cm-adv-toggle">';
    html += '<span class="cm-adv-toggle-icon">▼</span>';
    html += '<span class="cm-adv-block-title">🧩 正则脚本 (Regex)</span>';
    html += '<span class="cm-adv-block-stats">' + scripts.length + ' 个脚本</span>';
    html += '</div>';
    html += '<div class="cm-adv-block-body">';

    scripts.forEach((script, idx) => {
        const isDisabled = script.disabled === true;
        const name = script.scriptName || '未命名脚本';
        const findRegex = script.findRegex || '';
        const replaceStr = script.replaceString || '';
        const trimStrings = script.trimStrings || [];

        // 解析 placement
        let placementStr = '';
        if (Array.isArray(script.placement) && script.placement.length > 0) {
            placementStr = script.placement.map(p => placementMap[p] || ('位置' + p)).join(', ');
        }

        html += '<div class="cm-regex-item' + (isDisabled ? ' cm-regex-disabled' : '') + '">';
        html += '<div class="cm-regex-header cm-collapsible-header">';
        html += '<span class="cm-collapsible-icon">▶</span>';
        html += '<span class="cm-regex-idx">#' + (idx + 1) + '</span>';
        html += '<span class="cm-regex-name">' + escapeHtml(name) + '</span>';
        if (isDisabled) html += '<span class="cm-wi-badge cm-wi-badge-off">禁用</span>';
        if (script.markdownOnly) html += '<span class="cm-wi-badge" style="background:rgba(147,51,234,0.2);color:#a78bfa">仅MD</span>';
        if (script.promptOnly) html += '<span class="cm-wi-badge" style="background:rgba(37,99,235,0.2);color:#93c5fd">仅提示</span>';
        html += '</div>';

        html += '<div class="cm-regex-body cm-collapsible-body" style="display:none">';
        html += '<div class="cm-regex-field"><label>查找正则</label><code class="cm-regex-code">' + escapeHtml(findRegex) + '</code></div>';
        html += '<div class="cm-regex-field"><label>替换为</label><code class="cm-regex-code cm-regex-replace">' + escapeHtml(replaceStr || '(空)') + '</code></div>';
        if (placementStr) {
            html += '<div class="cm-regex-field"><label>作用范围</label><span class="cm-regex-val">' + escapeHtml(placementStr) + '</span></div>';
        }
        if (trimStrings.length > 0) {
            html += '<div class="cm-regex-field"><label>裁剪字符串</label><span class="cm-regex-val">' + escapeHtml(trimStrings.join(' | ')) + '</span></div>';
        }
        // 深度范围
        if (script.minDepth !== undefined && script.minDepth !== null) {
            let depthStr = '最小: ' + script.minDepth;
            if (script.maxDepth !== undefined && script.maxDepth !== null) depthStr += ', 最大: ' + script.maxDepth;
            html += '<div class="cm-regex-field"><label>深度</label><span class="cm-regex-val">' + depthStr + '</span></div>';
        }
        html += '</div>'; // cm-regex-body
        html += '</div>'; // cm-regex-item
    });

    html += '</div>'; // cm-adv-block-body
    html += '</div>'; // cm-adv-block
    return html;
}

function buildTavernHelperHTML(charData) {
    const ext = charData.extensions;
    if (!ext) return '';

    const helper = ext.tavern_helper;
    if (!helper) return '';

    // 提取脚本列表（兼容新版字典结构和旧版数组结构）
    let scripts = [];
    if (!Array.isArray(helper) && typeof helper === 'object') {
        // 新版字典结构：{ scripts: [], variables: {} }
        if (Array.isArray(helper.scripts)) {
            scripts = helper.scripts;
        }
    } else if (Array.isArray(helper)) {
        // 旧版数组结构：查找 ["scripts", Array]
        const scriptBlock = helper.find(item => Array.isArray(item) && item[0] === 'scripts');
        if (scriptBlock && Array.isArray(scriptBlock[1])) {
            scripts = scriptBlock[1];
        }
    }

    if (scripts.length === 0) return '';

    let html = '<div class="cm-adv-block">';
    html += '<div class="cm-adv-block-header cm-adv-toggle">';
    html += '<span class="cm-adv-toggle-icon">▼</span>';
    html += '<span class="cm-adv-block-title">📜 酒馆助手脚本 (ST Script)</span>';
    html += '<span class="cm-adv-block-stats">' + scripts.length + ' 个脚本</span>';
    html += '</div>';
    html += '<div class="cm-adv-block-body">';

    scripts.forEach((script, idx) => {
        const name = script.name || '未命名脚本';
        const isEnabled = script.enabled !== false;
        const content = script.content || '';
        const info = script.info || '';
        const type = script.type || 'script';

        // 按钮信息
        let buttonsInfo = '';
        if (script.button && script.button.buttons && script.button.buttons.length > 0) {
            buttonsInfo = script.button.buttons.map(b => b.name || '未命名').join(', ');
        }

        html += '<div class="cm-script-item' + (isEnabled ? '' : ' cm-script-disabled') + '">';
        html += '<div class="cm-script-header cm-collapsible-header">';
        html += '<span class="cm-collapsible-icon">▶</span>';
        html += '<span class="cm-script-idx">#' + (idx + 1) + '</span>';
        html += '<span class="cm-script-name">' + escapeHtml(name) + '</span>';
        if (!isEnabled) html += '<span class="cm-wi-badge cm-wi-badge-off">禁用</span>';
        html += '<span class="cm-wi-badge" style="background:rgba(34,197,94,0.2);color:#86efac">' + escapeHtml(type) + '</span>';
        html += '</div>';

        html += '<div class="cm-script-body cm-collapsible-body" style="display:none">';
        if (info) {
            html += '<div class="cm-script-field"><label>备注</label><div class="cm-script-val">' + escapeHtml(info) + '</div></div>';
        }
        if (buttonsInfo) {
            html += '<div class="cm-script-field"><label>按钮</label><div class="cm-script-val">' + escapeHtml(buttonsInfo) + '</div></div>';
        }
        if (content) {
            html += '<div class="cm-script-field"><label>内容</label><pre class="cm-wi-content">' + escapeHtml(content) + '</pre></div>';
        }
        html += '</div>'; // cm-script-body
        html += '</div>'; // cm-script-item
    });

    html += '</div>'; // cm-adv-block-body
    html += '</div>'; // cm-adv-block
    return html;
}

