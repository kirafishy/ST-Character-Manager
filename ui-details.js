/**
 * 角色详情页模块 (UI Details)
 * 负责渲染角色详情弹窗，采用固定头部 + 标签页布局
 */
import { doc, parentWin, getSTContext, getSTCharacters } from './context.js';
import { state } from './state.js';
import { ICONS } from './constants.js';
import { escapeHtml, formatSize, notify, parsePNG } from './utils.js';
import { createBaseDialog, showConfirm, showDeleteConfirm } from './ui-utils.js';
import { getCharHistoryCount, getCharChatHistory, saveCharacterData, renameCharacterFile, replaceCharacterImage, downloadChar, updateCharacter, toggleFavorite, getCharTags, removeTagFromChar, addTagToChar, createTag, deleteChar, deleteWorldInfo, updateCharacterVersion } from './data.js';
import { authFetch } from './api.js';
import { renderView, renderTagSidebar, updateCreatorComment } from './index.js';
import { getGalleryItems, showGallery, renderGallery } from './gallery.js';
import { openTranslationDialog } from './translation/translation-ui.js';
import { calculateTokens } from './utils.js';

// 标签页定义
const TABS = [
    { id: 'details', label: '详情', icon: ICONS.menu },
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
        
        // 关闭按钮
        const closeBtn = doc.createElement('span');
        closeBtn.className = 'cm-detail-close';
        closeBtn.innerHTML = ICONS.close;
        closeBtn.onclick = () => this.close();
        this.container.appendChild(closeBtn);

        // 渲染固定头部
        this.renderHeader();

        // 渲染内容区域容器
        const contentBody = doc.createElement('div');
        contentBody.className = 'cm-detail-body';
        this.container.appendChild(contentBody);

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
            this.renderExtendedTab();
            this.renderEditTab();

            // 激活默认标签页
            this.switchTab(this.currentTab);
            
            // 左右滑动切换支持
            this.bindSwipeEvents(contentBody);
        }

        this.overlay.appendChild(this.container);
        doc.body.appendChild(this.overlay);

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
                        this.renderLegacyView(body);
                    }
                } else {
                    this.renderDetailsTab();
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
                chatFile = '';
            }
        }

        this.close();
        
        const switchChatAfterLoad = async () => {
            if (!chatFile) return;
            await new Promise(r => setTimeout(r, 500));
            try {
                const ctx = getSTContext();
                if (ctx.loadChat) {
                    await ctx.loadChat(chatFile);
                    notify('已加载存档: ' + chatFile, 'success');
                } else if (parentWin.loadChat) {
                    parentWin.loadChat(chatFile);
                    notify('已加载存档: ' + chatFile, 'success');
                }
            } catch (e) { console.warn('Load chat failed', e); }
        };

        const targetFileName = this.char.fileName;
        const stChars = getSTCharacters();
        const chIndex = stChars.findIndex(c => c.avatar === targetFileName);

        if (chIndex === -1) {
            notify('启动失败：内存中未找到该角色', 'error');
            return;
        }

        const targets = [parentWin, window];
        let found = false;

        const domId = 'CharID' + chIndex;
        for (const win of targets) {
            if (!win || !win.document) continue;
            const el = win.document.getElementById(domId);
            if (el) {
                el.click();
                found = true;
                switchChatAfterLoad();
                break;
            }
        }

        if (!found) {
            // 尝试使用 API 切换
            try {
                const ctx = getSTContext();
                if (ctx.selectCharacterById) {
                    ctx.selectCharacterById(chIndex);
                    switchChatAfterLoad();
                } else {
                    notify('无法自动切换角色，请手动选择', 'warning');
                }
            } catch (e) {
                notify('启动失败: ' + e.message, 'error');
            }
        }
    }

    renderLegacyView(body) {
        const char = this.char;
        
        // 1. 备注/注释
        const commentSection = doc.createElement('div');
        commentSection.className = 'cm-section';
        commentSection.style.borderColor = '#ca8a04';
        
        const commentHeader = doc.createElement('div');
        commentHeader.style.cssText = 'padding:10px 14px;font-size:13px;color:#ca8a04;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);display:flex;justify-content:space-between;align-items:center';
        commentHeader.innerHTML = '<span>备注/注释</span><button class="cm-edit-btn" id="cmEditCommentBtn">' + ICONS.pencil + '</button>';
        
        const isExpand = state.settings.detailContentMode === 'expand';
        const maxHeightStyle = isExpand ? 'max-height:none;overflow-y:visible;' : 'max-height:300px;overflow-y:auto;';

        const commentContent = doc.createElement('div');
        commentContent.id = 'cmCommentContent';
        commentContent.className = 'cm-markdown-body';
        commentContent.style.cssText = `padding:14px;${maxHeightStyle}background:var(--cm-bg);`;
        commentContent.innerHTML = this.renderMarkdown(char.creator_notes || char.creatorcomment || '(无)');
        
        commentSection.appendChild(commentHeader);
        commentSection.appendChild(commentContent);
        body.appendChild(commentSection);
        
        // 备注编辑逻辑
        commentHeader.querySelector('#cmEditCommentBtn').onclick = () => {
            if (commentContent.tagName === 'DIV') {
                const textarea = doc.createElement('textarea');
                textarea.className = 'cm-input';
                textarea.style.height = '100px';
                textarea.style.resize = 'vertical';
                textarea.value = char.creator_notes || char.creatorcomment || '';
                commentContent.replaceWith(textarea);
                const btn = commentHeader.querySelector('#cmEditCommentBtn');
                btn.innerHTML = '💾';
                btn.onclick = async () => {
                    const val = textarea.value.trim();
                    if (await updateCreatorComment(char, val)) {
                        // 刷新显示
                        const newDiv = doc.createElement('div');
                        newDiv.id = 'cmCommentContent';
                        newDiv.className = 'cm-markdown-body';
                        newDiv.style.cssText = 'padding:14px;max-height:300px;overflow-y:auto;background:var(--cm-bg);';
                        newDiv.innerHTML = this.renderMarkdown(val || '(无)');
                        textarea.replaceWith(newDiv);
                        btn.innerHTML = ICONS.pencil;
                        // 重置 onclick (递归调用自身来重新绑定)
                        // 注意：这里不能直接赋值 old onclick，因为闭包问题，最好重新绑定
                        // 简单起见，重新渲染整个 Legacy View 或者重新绑定事件
                        // 这里我们重新绑定事件处理函数
                        btn.onclick = () => {
                             // 重新触发编辑逻辑 (复制上面的代码)
                             // 为了避免代码重复，建议将编辑逻辑封装成函数，但这里为了简单直接内联修复
                             // 实际上，由于我们使用了箭头函数和闭包，上面的逻辑是可以复用的，只要我们能重新进入这个状态
                             // 但最简单的方法是重新调用 renderLegacyView，或者...
                             // 让我们简化一下：直接重新绑定相同的逻辑
                             this.renderLegacyView(body); // 简单粗暴刷新整个视图
                        };
                    }
                };
            }
        };

        // 3. 描述
        const descSection = doc.createElement('div');
        descSection.className = 'cm-section cm-section-desc';
        const desc = this.getCharProp('description');
        descSection.innerHTML = `<h4>📋 描述</h4><div class="cm-markdown-body" style="padding:14px;${maxHeightStyle}background:var(--cm-bg);">${this.renderMarkdown(desc || '(无)')}</div>`;
        body.appendChild(descSection);

        // 4. 开场白
        const firstSection = doc.createElement('div');
        firstSection.className = 'cm-section cm-section-first';
        const firstMes = this.getCharProp('first_mes') || this.getCharProp('first_message');
        firstSection.innerHTML = `<h4>${ICONS.chat} 主开场白</h4><div class="cm-markdown-body" style="padding:14px;${maxHeightStyle}background:var(--cm-bg);">${this.renderMarkdown(firstMes || '(无)')}</div>`;
        body.appendChild(firstSection);

        // 5. 备选开场白
        if (char.alternate_greetings && char.alternate_greetings.length > 0) {
            const altSection = doc.createElement('div');
            altSection.className = 'cm-section';
            
            const header = doc.createElement('h4');
            header.style.cursor = 'pointer';
            header.innerHTML = `<span style="display:inline-block;width:16px;transition:transform 0.2s">▶</span> 📝 备选开场白 (${char.alternate_greetings.length})`;
            
            const contentDiv = doc.createElement('div');
            contentDiv.className = 'cm-greetings-list';
            contentDiv.style.display = 'none'; // 默认折叠
            
            let altHtml = '';
            char.alternate_greetings.forEach((g, i) => {
                altHtml += `<div class="cm-greeting-item">
                    <div class="cm-greeting-header">#${i + 1}</div>
                    <div class="cm-markdown-body" style="padding:12px;${isExpand ? 'max-height:none;overflow-y:visible;' : 'max-height:200px;overflow-y:auto;'}background:var(--cm-bg);">${this.renderMarkdown(g)}</div>
                </div>`;
            });
            contentDiv.innerHTML = altHtml;

            // Toggle logic
            header.onclick = () => {
                const icon = header.querySelector('span');
                if (contentDiv.style.display === 'none') {
                    contentDiv.style.display = 'flex';
                    icon.style.transform = 'rotate(90deg)';
                } else {
                    contentDiv.style.display = 'none';
                    icon.style.transform = 'rotate(0deg)';
                }
            };

            altSection.appendChild(header);
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
        historySection.innerHTML = '<h4>💬 聊天历史记录 <span id="cmHistoryLoading" style="font-size:11px;font-weight:normal;color:var(--cm-text-sec);margin-left:8px">加载中...</span></h4><div id="cmHistoryList" style="max-height:300px;overflow-y:auto"></div>';
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

    renderHeader() {
        const header = doc.createElement('div');
        header.className = 'cm-detail-header';

        // 1. 头像区域
        const avatarWrap = doc.createElement('div');
        avatarWrap.className = 'cm-detail-avatar-wrap';
        avatarWrap.style.position = 'relative';

        const avatar = doc.createElement('img');
        avatar.className = 'cm-detail-avatar';
        avatar.src = this.char.avatarUrl;
        
        // 更换头像按钮
        const camBtn = doc.createElement('div');
        camBtn.className = 'cm-cam-btn';
        camBtn.innerHTML = ICONS.camera;
        camBtn.title = '更换图片';
        camBtn.onclick = () => this.handleAvatarChange(avatar);

        avatarWrap.appendChild(avatar);
        avatarWrap.appendChild(camBtn);
        header.appendChild(avatarWrap);

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
        info.appendChild(nameWrap);

        // 来源链接
        this.renderSourceLink(info);

        // 元数据 (作者、时间、大小、Token)
        const meta = doc.createElement('div');
        meta.className = 'cm-detail-meta';
        const dateStr = this.char.date_added ? new Date(parseInt(this.char.date_added)).toLocaleDateString() : '未知';
        
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
            wiDiv.innerHTML = `<span title="关联世界书">🌐 ${escapeHtml(this.char.character_book)}</span>`;
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

        // 操作按钮栏
        this.renderActionButtons(info);

        header.appendChild(info);
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
        galleryBtn.disabled = true;
        
        // 异步获取画廊数量
        (async () => {
            const items = await getGalleryItems(this.char.name);
            const count = items.length;
            const badge = galleryBtn.querySelector('.cm-gallery-badge');
            if (badge) badge.textContent = count;
            galleryBtn.disabled = count === 0;
            // 缓存到角色对象
            this.char.galleryCount = count;
            this.char._galleryItems = items;
        })();

        galleryBtn.onclick = async () => {
            let items = this.char._galleryItems;
            if (!items) {
                items = await getGalleryItems(this.char.name);
            }
            if (items.length === 0) {
                notify('画廊为空', 'warning');
                return;
            }
            showGallery(this.char, items, notify, showConfirm, replaceCharacterImage);
        };
        actions.appendChild(galleryBtn);

        // 3. 收藏按钮
        const favBtn = doc.createElement('button');
        favBtn.className = 'cm-btn cm-btn-secondary';
        favBtn.innerHTML = this.char.fav ? (ICONS.star + ' 已收藏') : (ICONS.star + ' 收藏');
        favBtn.style.color = this.char.fav ? '#f59e0b' : 'var(--cm-text-sec)';
        favBtn.onclick = async () => {
            const newState = await toggleFavorite(this.char.fileName, this.char.fav);
            this.char.fav = newState;
            favBtn.innerHTML = newState ? (ICONS.star + ' 已收藏') : (ICONS.star + ' 收藏');
            favBtn.style.color = newState ? '#f59e0b' : 'var(--cm-text-sec)';
            renderTagSidebar();
            if (state.currentView === 'favorites') renderView();
        };
        actions.appendChild(favBtn);

        // 下载按钮
        const dlBtn = doc.createElement('button');
        dlBtn.className = 'cm-btn cm-btn-secondary';
        dlBtn.innerHTML = ICONS.download + ' 下载';
        dlBtn.onclick = async () => {
            if (await showConfirm(`确定下载 "${this.char.name}"？`)) {
                await downloadChar(this.char.fileName);
                notify('已下载', 'success');
            }
        };
        actions.appendChild(dlBtn);

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
            transBtn.innerHTML = '🌍 翻译';
            transBtn.onclick = () => {
                this.close();
                openTranslationDialog(this.char);
            };
            actions.appendChild(transBtn);
        }

        // 视图切换按钮
        const viewBtn = doc.createElement('button');
        viewBtn.className = 'cm-btn cm-btn-secondary';
        viewBtn.innerHTML = this.viewMode === 'legacy' ? (ICONS.menu + ' 标签视图') : (ICONS.list + ' 经典视图');
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
                await deleteChar(this.char.fileName);
                if (confirmRes.delWi && wiCount > 0 && this.char.character_book) {
                    await deleteWorldInfo(this.char.character_book);
                }

                // 从本地状态移除
                state.characters = state.characters.filter(c => c.fileName !== this.char.fileName);
                
                // 刷新界面
                // findDuplicates(); // 需要导入或在 renderView 中处理
                // updateStats(); // 需要导入
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

        // 确保插入到 body 之前
        const body = this.container.querySelector('.cm-detail-body');
        if (body) {
            this.container.insertBefore(tabsNav, body);
        } else {
            this.container.appendChild(tabsNav);
        }
    }

    switchTab(tabId) {
        this.currentTab = tabId;
        
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
        const body = this.container.querySelector('.cm-detail-body');
        if (body) {
            if (tabId === 'gallery') {
                body.classList.add('has-fixed-content');
            } else {
                body.classList.remove('has-fixed-content');
            }
        }
    }

    renderDetailsTab() {
        const container = this.tabContents['details'];
        container.innerHTML = '';
        container.style.padding = '16px';

        // 作者注释
        const notes = this.getCharProp('creator_notes') || this.getCharProp('creatorcomment');
        this.renderMarkdownField(container, '作者注释', notes || '(无)');

        // 描述
        this.renderMarkdownField(container, '描述', this.getCharProp('description'));
        
        // 第一条消息
        this.renderMarkdownField(container, '开场白', this.getCharProp('first_mes') || this.getCharProp('first_message'));
        
        // 备选开场白
        const altGreetings = this.getCharProp('alternate_greetings');
        if (altGreetings && altGreetings.length > 0) {
            const wrapper = doc.createElement('div');
            wrapper.className = 'cm-adv-block';
            wrapper.style.marginBottom = '16px';
            
            const header = doc.createElement('div');
            header.className = 'cm-adv-block-header cm-adv-toggle';
            header.innerHTML = `
                <span class="cm-adv-toggle-icon">▶</span>
                <span class="cm-adv-block-title">📝 备选开场白</span>
                <span class="cm-adv-block-stats">${altGreetings.length} 条</span>
            `;
            
            const body = doc.createElement('div');
            body.className = 'cm-adv-block-body';
            body.style.display = 'none';
            
            altGreetings.forEach((g, i) => {
                const item = doc.createElement('div');
                item.style.marginBottom = '10px';
                item.innerHTML = `<div style="font-size:12px;color:var(--cm-text-sec);margin-bottom:4px">#${i + 1}</div>`;
                
                const contentEl = doc.createElement('div');
                contentEl.className = 'cm-markdown-body';
                contentEl.innerHTML = this.renderMarkdown(g);
                contentEl.style.cssText = 'font-size:14px;color:var(--cm-text);line-height:1.5;background:var(--cm-bg-ter);padding:10px;border-radius:6px;border:1px solid var(--cm-border);max-height:300px;overflow-y:auto;overflow-x:hidden;word-wrap:break-word;';
                
                item.appendChild(contentEl);
                body.appendChild(item);
            });
            
            header.onclick = () => {
                const icon = header.querySelector('.cm-adv-toggle-icon');
                if (body.style.display === 'none') {
                    body.style.display = 'block';
                    icon.textContent = '▼';
                } else {
                    body.style.display = 'none';
                    icon.textContent = '▶';
                }
            };
            
            wrapper.appendChild(header);
            wrapper.appendChild(body);
            container.appendChild(wrapper);
        } else {
            // 显示空的备选开场白
            this.renderMarkdownField(container, '备选开场白', '(无)');
        }
        
        // 替代称呼
        const altNames = this.getCharProp('alternate_names');
        this.renderField(container, '别名', (altNames && altNames.length > 0) ? altNames.join(', ') : '(无)');
        
        // 场景
        const scenario = this.getCharProp('scenario');
        this.renderMarkdownField(container, '场景', scenario || '(无)');
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

    renderMarkdown(text) {
        if (!text) return '';
        try {
            // 尝试使用 SillyTavern 的 showdown
            if (parentWin.showdown) {
                const converter = new parentWin.showdown.Converter({
                    emoji: true,
                    underline: true,
                    strikethrough: true,
                    tables: true,
                    tasklists: true,
                    simpleLineBreaks: true,
                    parseImgDimensions: true,
                    simplifiedAutoLink: true
                });
                let html = converter.makeHtml(text);
                
                // 尝试使用 DOMPurify
                if (parentWin.DOMPurify) {
                    // 扩展允许的标签和属性以支持 Rich Markdown/HTML/CSS
                    html = parentWin.DOMPurify.sanitize(html, {
                        ALLOWED_TAGS: [
                            'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'code', 'pre',
                            'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
                            'table', 'thead', 'tbody', 'tr', 'th', 'td',
                            'img', 'span', 'div', 'del', 's', 'strike', 'u',
                            'details', 'summary', 'font', 'center', 'small', 'big',
                            'style' // 允许 style 标签
                        ],
                        ALLOWED_ATTR: [
                            'href', 'src', 'alt', 'title', 'class', 'style', 'target',
                            'width', 'height', 'align', 'color', 'size', 'id'
                        ],
                        ADD_TAGS: ['iframe'], // 视情况允许 iframe
                        ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling'] // iframe 属性
                    });
                }
                return html;
            }
        } catch (e) {
            console.warn('Markdown render failed, fallback to text', e);
        }
        return escapeHtml(text).replace(/\n/g, '<br>');
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

        // 顶部工具栏：解锁开关
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

        // 保存按钮
        const saveBtn = doc.createElement('button');
        saveBtn.className = 'cm-btn cm-btn-primary';
        saveBtn.innerHTML = '💾 保存更改';
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        toolbar.appendChild(saveBtn);

        container.appendChild(toolbar);

        // 表单容器
        const form = doc.createElement('div');
        form.className = 'cm-edit-form';
        
        // 字段定义
        const fields = [
            { key: 'description', label: '描述', type: 'textarea', rows: 6 },
            { key: 'first_mes', label: '首条消息', type: 'textarea', rows: 6 },
            { key: 'scenario', label: '场景', type: 'textarea', rows: 4 },
            { key: 'creator_notes', label: '作者注释', type: 'textarea', rows: 4 },
            { key: 'alternate_names', label: '别名 (逗号分隔)', type: 'text' },
            { key: 'creator', label: '作者', type: 'text' },
            { key: 'version', label: '版本', type: 'text' },
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
                input.rows = f.rows;
                input.style.resize = 'vertical';
            } else {
                input = doc.createElement('input');
                input.type = 'text';
            }
            
            input.className = 'cm-input'; // 假设有通用样式，或者内联样式
            input.style.cssText = 'width:100%;padding:8px;border-radius:4px;border:1px solid var(--cm-border);background:var(--cm-input-bg);color:var(--cm-text);font-family:inherit;font-size:13px;';
            input.disabled = true; // 默认禁用

            // 填充值
            let val = this.getCharProp(f.key);
            if (f.key === 'alternate_names' && Array.isArray(val)) {
                val = val.join(', ');
            }
            input.value = val || '';
            
            inputs[f.key] = input;
            
            fieldWrap.appendChild(label);
            fieldWrap.appendChild(input);
            form.appendChild(fieldWrap);
        });

        // --- 备选开场白编辑区域 ---
        const altWrap = doc.createElement('div');
        altWrap.style.marginTop = '20px';
        altWrap.style.borderTop = '1px solid var(--cm-border)';
        altWrap.style.paddingTop = '16px';

        const altHeader = doc.createElement('div');
        altHeader.innerHTML = '<h4>📝 备选开场白</h4>';
        altHeader.style.marginBottom = '12px';
        altWrap.appendChild(altHeader);

        const altList = doc.createElement('div');
        altList.className = 'cm-edit-alt-list';
        altList.style.display = 'flex';
        altList.style.flexDirection = 'column';
        altList.style.gap = '12px';
        altWrap.appendChild(altList);

        // 存储备选开场白的 inputs
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
                // 从数组中移除
                const idx = altInputs.indexOf(textarea);
                if (idx > -1) altInputs.splice(idx, 1);
                // 重新编号
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

        // 初始化现有备选开场白
        const existingAlts = this.getCharProp('alternate_greetings') || [];
        existingAlts.forEach((g, i) => renderAltItem(g, i));

        // 添加按钮
        const addAltBtn = doc.createElement('button');
        addAltBtn.className = 'cm-btn cm-btn-secondary';
        addAltBtn.innerHTML = '+ 添加备选开场白';
        addAltBtn.style.marginTop = '12px';
        addAltBtn.style.width = '100%';
        addAltBtn.disabled = !unlockCheck.checked;
        addAltBtn.onclick = () => {
            renderAltItem('', altInputs.length);
        };
        altWrap.appendChild(addAltBtn);

        form.appendChild(altWrap);

        container.appendChild(form);

        // 事件处理
        unlockCheck.onchange = () => {
            const isUnlocked = unlockCheck.checked;
            unlockText.innerHTML = isUnlocked ? `${ICONS.unlock} 编辑模式` : `${ICONS.lock} 解锁编辑`;
            unlockText.style.color = isUnlocked ? 'var(--cm-accent)' : 'inherit';
            
            Object.values(inputs).forEach(inp => inp.disabled = !isUnlocked);
            // 备选开场白控件
            altInputs.forEach(inp => inp.disabled = !isUnlocked);
            altList.querySelectorAll('button').forEach(btn => btn.disabled = !isUnlocked);
            addAltBtn.disabled = !isUnlocked;

            saveBtn.disabled = !isUnlocked;
            saveBtn.style.opacity = isUnlocked ? '1' : '0.5';
        };

        saveBtn.onclick = async () => {
            if (!unlockCheck.checked) return;
            
            const changes = {};
            let hasChanges = false;

            fields.forEach(f => {
                let newVal = inputs[f.key].value.trim();
                let oldVal = this.getCharProp(f.key);

                // 特殊处理数组
                if (f.key === 'alternate_names') {
                    const newArr = newVal ? newVal.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
                    const oldArr = Array.isArray(oldVal) ? oldVal : [];
                    // 简单比较数组
                    if (JSON.stringify(newArr) !== JSON.stringify(oldArr)) {
                        changes[f.key] = newArr;
                        hasChanges = true;
                    }
                } else {
                    if (newVal !== (oldVal || '')) {
                        changes[f.key] = newVal;
                        hasChanges = true;
                    }
                }
            });

            // 处理备选开场白
            const newAlts = altInputs.map(inp => inp.value).filter(s => s.trim() !== '');
            const oldAlts = this.getCharProp('alternate_greetings') || [];
            if (JSON.stringify(newAlts) !== JSON.stringify(oldAlts)) {
                changes['alternate_greetings'] = newAlts;
                hasChanges = true;
            }

            if (!hasChanges) {
                notify('没有检测到更改', 'info');
                return;
            }

            try {
                await saveCharacterData(this.char.fileName, (data) => {
                    Object.assign(data, changes);
                });
                
                // 更新本地对象
                if (this.char.data) {
                    Object.assign(this.char.data, changes);
                } else {
                    Object.assign(this.char, changes);
                }
                
                notify('保存成功', 'success');
                
                // 刷新界面
                this.renderDetailsTab(); // 刷新详情页
                this.renderHeader(); // 刷新头部（如版本号）
                renderView(); // 刷新列表
                
                // 重新锁定
                unlockCheck.checked = false;
                unlockCheck.onchange();

            } catch (e) {
                notify('保存失败: ' + e.message, 'error');
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
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeTagFromChar(this.char.fileName, tag.id);
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

                item.onclick = function () {
                    if (item.classList.contains('selected')) {
                        removeTagFromChar(char.fileName, tag.id);
                    } else {
                        addTagToChar(char.fileName, tag.id);
                    }
                    renderListItems();
                    if (onUpdate) onUpdate();
                    renderTagSidebar();
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

            const handleCreate = (forceName) => {
                const val = (forceName || quickInput.value).trim();
                if (val) {
                    const existingTag = state.tags.find(t => t.name === val);
                    if (existingTag) {
                        addTagToChar(char.fileName, existingTag.id);
                        notify('已添加已有标签: ' + val, 'success');
                    } else {
                        const newTag = createTag(val, DEFAULT_TAG_COLOR);
                        addTagToChar(char.fileName, newTag.id);
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
    html += '<span class="cm-adv-block-title">🌐 角色专属世界书</span>';
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
