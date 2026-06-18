import { ICONS, COLORS, Z_INDEX, AI_MODELS, getModelTokenLimit, CHARACTER_SORT_OPTIONS } from './constants.js';
import { resolveListPageCoverDisplay } from './utils/cover-display.js';
import manifest from './manifest.json' with { type: 'json' };
import { doc, parentWin, getSTContext, getSTCharacters, getCurrentChatChar } from './context.js';
import { log, truncate, formatSize, escapeHtml, generateId, loadJSZip, notify, parsePNG } from './utils.js';
import { createBaseDialog, showAlert, showConfirm, showDeleteConfirm, showErrorReport } from './ui-utils.js';
export { createBaseDialog, showAlert, showConfirm, showDeleteConfirm, showErrorReport };
import { authFetch } from './api.js';
import { state, saveSettings, DEFAULT_TAG_COLOR } from './state.js';
import { getCache, setCache, clearCache, migrateFromLocalStorage } from './db.js';
import { loadTags, saveTags, createTag, updateTag, deleteTag, getCharTags, addTagToChar, removeTagFromChar, getUntaggedChars, getCharsByTag, getFavChars, getTagCharCount, filterAndSortChars, compareChars, replaceCharacterImage, saveCharacterData, updateCharacter, toggleFavorite, updateCharacterVersion, renameCharacterFile, downloadChar, downloadAsZip, getCharChatHistory, getCharHistoryCount, deleteWorldInfo, syncAllTags, deleteChar } from './data.js';
import { importTags, needsTagImport, batchImportTags, migrateToCmManager, migrateAndSaveCmManager, getCmManager, pendingApiWrites, batchWriteTagsToCards, clearPendingApiWrites } from './st-tags.js';
import { getGalleryItems, showGallery, galleryCountCache } from './gallery.js';
import { showSettingsDialog } from './settings.js';
import { initTranslationUI, openTranslationDialog } from './translation/translation-ui.js';
import { writePngText } from './translation/png-writer.js';
import { CharacterDetails, showDetail } from './ui-details.js';
import { createFloatBall, removeFloatBall } from './float-ball.js';
import { openMetadataSeparatorDialog } from './ui-metadata-separator.js';
import { initInterceptor } from './interceptor.js';

console.log(`=== 角色卡管理器 小鱼改版 v${manifest.version} 启动 ===`);

const MODAL_ID = 'charManagerModal';
const STYLE_ID = 'charManagerStylesV97';
const BUTTON_ID = 'charManagerBtn';

// 导入队列控制
const importQueue = [];
let isProcessingQueue = false;
let lastTouchTime = 0;

const characterSortOptionsHtml = CHARACTER_SORT_OPTIONS
    .map(option => `<option value="${option.value}">${option.label}</option>`)
    .join('');





function toggleTheme() {
    state.isDarkMode = !state.isDarkMode;
    localStorage.setItem('cm_theme_mode', state.isDarkMode ? 'dark' : 'light');
    applyTheme();
    const themeBtn = doc.getElementById('cmThemeBtn');
    if (themeBtn) {
        themeBtn.innerHTML = state.isDarkMode ? ICONS.moon : ICONS.sun;
    }
    const menuTheme = doc.getElementById('cmMenuTheme');
    if (menuTheme) {
        menuTheme.innerHTML = (state.isDarkMode ? ICONS.moon : ICONS.sun) + ' 切换主题';
    }
}

function applyTheme() {
    const m = doc.getElementById(MODAL_ID);
    if (m) {
        m.className = state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light';
    }
    doc.querySelectorAll('.cm-tag-editor-overlay').forEach(el => {
        el.className = state.isDarkMode ? 'cm-tag-editor-overlay cm-theme-dark' : 'cm-tag-editor-overlay cm-theme-light';
    });
}

function setZoom(val) {
    let v = parseInt(val);
    if (v < 60) v = 60;
    if (v > 300) v = 300;
    state.zoomLevel = v;
    localStorage.setItem('cm_zoom_level', state.zoomLevel);

    const r = doc.querySelector(':root');
    if (r) r.style.setProperty('--cm-card-width', state.zoomLevel + 'px');

    const body = doc.getElementById('cmBody');
    if (body) {
        if (state.zoomLevel <= 80) body.classList.add('cm-minimal');
        else body.classList.remove('cm-minimal');
    }

    const valDisp = doc.getElementById('cmZoomVal');
    const rangeInp = doc.querySelector('.cm-zoom-input');
    if (valDisp) valDisp.textContent = state.zoomLevel + 'px';
    if (rangeInp) rangeInp.value = state.zoomLevel;
}

// 队列化导入入口
async function importFiles(files) {
    if (!files || files.length === 0) return;
    return new Promise((resolve, reject) => {
        importQueue.push({ files, resolve, reject });
        processImportQueue();
    });
}

// 实际执行导入的逻辑 (原 importFiles)
async function doActualImport(files, remainingInQueue) {
    // 改为手动上传，以便控制标签导入流程
    const queueMsg = remainingInQueue > 0 ? ` (队列剩余: ${remainingInQueue})` : '';
    showProgressBar(`正在导入${queueMsg}...`, true);

    const ctx = getSTContext();
    const importedChars = [];

    // 1. 上传文件
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        updateProgressBar(Math.floor((i / files.length) * 50), `正在上传 ${file.name}...`);
        
        try {
            const formData = new FormData();
            const ext = file.name.split('.').pop().toLowerCase();
            formData.append('avatar', file);
            formData.append('file_type', ext);
            formData.append('user_name', ctx.name1 || 'User');
            
            const res = await authFetch('/api/characters/import', {
                method: 'POST',
                body: formData
            });
            
            if (!res.ok) {
                let errText = await res.text();
                try {
                    const errJson = JSON.parse(errText);
                    if (errJson.error) errText = errJson.error;
                } catch (parseErr) {}
                throw new Error(errText);
            }
            
            const data = await res.json();
            if (data && data.file_name) {
                importedChars.push(data.file_name);
            }
        } catch (e) {
            console.error('上传失败:', file.name, e);
            notify(`上传失败 ${file.name}: ${e.message}`, 'error');
        }
    }

    if (importedChars.length === 0) {
        hideProgressBar();
        notify('导入失败：未识别到有效的角色卡数据', 'warning');
        return;
    }

    const totalImported = importedChars.length;
    updateProgressBar(60, `正在刷新列表...（${totalImported} 张角色卡，如果数量较多请耐心等待）`);

    // 2. 刷新原生列表 (确保 ctx.characters 更新)
    if (ctx && ctx.getCharacters) {
        await ctx.getCharacters();
    }

    // 3. 处理标签导入
    updateProgressBar(80, '正在处理标签...');
    const allChars = getSTCharacters(); // 获取最新列表
    
    // 加载最新的标签数据（因为原生刷新可能重置了 ctx.tags/tagMap，虽然不应该）
    loadTags();

    // 【修复】记录元数据保存失败的角色，用于区分错误消息
    const metadataFailedChars = [];
    
    for (const fileName of importedChars) {
        // 查找对应的角色对象
        // 注意：API 返回的 file_name 是带扩展名的，allChars 里的 avatar 也是带扩展名的
        // 但为了保险，也检查一下去掉扩展名的匹配
        let char = allChars.find(c => c.avatar === fileName);
        if (!char) {
             // 尝试 fuzzy match
             const nameNoExt = fileName.replace(/\.[^/.]+$/, "");
             char = allChars.find(c => c.avatar.startsWith(nameNoExt));
        }

        if (char) {
            try {
                // [Fix] 导入前清除该文件名的旧标签缓存，防止显示已删除同名卡的残留标签
                if (state.tagMap[fileName]) {
                    console.log('[CharManager] Clearing ghost tags for imported file:', fileName);
                    delete state.tagMap[fileName];
                    saveTags(); // 必须保存，否则会被后续 scan 中的 loadTags 覆盖
                }

                // 迁移旧配置并导入标签
                await migrateAndSaveCmManager(char);
                await importTags(char, { skipSave: false, checkCmManager: true, isManualImport: true });
                
                // 强制保存一次标签状态，确保新导入的标签被持久化
                saveTags();
            } catch (e) {
                console.warn('标签导入失败:', fileName, e);
                // 记录元数据保存失败的角色（角色卡已导入，但标签等元数据保存失败）
                metadataFailedChars.push(fileName);
            }
        }
    }

    // 4. 检查并添加 create_date 字段
    updateProgressBar(90, '检查创建时间...');
    
    let addedCreateDateCount = 0;
    for (const fileName of importedChars) {
        try {
            // 查找对应的角色对象
            const allChars = getSTCharacters();
            let char = allChars.find(c => c.avatar === fileName);
            if (!char) {
                const nameNoExt = fileName.replace(/\.[^/.]+$/, "");
                char = allChars.find(c => c.avatar.startsWith(nameNoExt));
            }
            
            if (char) {
                // 检查是否缺少 create_date 字段
                if (!char.create_date) {
                    await saveCharacterData(fileName, (data) => {
                        if (!data.create_date) {
                            // 优先使用 date_added（酒馆提供的文件创建时间戳，毫秒）
                            // 如果没有 date_added，才使用当前时间作为降级
                            const createDate = char.date_added 
                                ? new Date(char.date_added).toISOString() 
                                : new Date().toISOString();
                            data.create_date = createDate;
                            addedCreateDateCount++;
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[CharManager] 导入后添加 create_date 失败:', fileName, e);
        }
    }
    
    // 5. 完成
    updateProgressBar(100, '完成', '');
    await new Promise(r => setTimeout(r, 500));
    
    // 快速刷新扩展 UI（检测新卡，同步酒馆最新数据）
    try {
        await scan(false, false, false);
    } catch (e) {
        console.warn('[CharManager] 导入后刷新列表失败:', e);
    }
    
    hideProgressBar();
    
    // 【修复】区分"完全成功"和"部分成功"的情况
    if (metadataFailedChars.length > 0) {
        let message = `已导入 ${importedChars.length} 个角色，但 ${metadataFailedChars.length} 个角色的元数据保存失败`;
        if (addedCreateDateCount > 0) {
            message += `，并为 ${addedCreateDateCount} 个角色卡添加了创建时间`;
        }
        notify(message, 'warning');
    } else if (addedCreateDateCount > 0) {
        notify(`成功导入 ${importedChars.length} 个角色，并为 ${addedCreateDateCount} 个角色卡添加了创建时间`, 'success');
    } else {
        notify(`成功导入 ${importedChars.length} 个角色`, 'success');
    }
}

// 队列处理器
async function processImportQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    try {
        while (importQueue.length > 0) {
            const task = importQueue[0]; // Peek
            try {
                await doActualImport(task.files, importQueue.length - 1);
                task.resolve(true);
            } catch (e) {
                console.error(e);
                notify('导入失败: ' + e.message, 'error');
                task.reject(e);
            } finally {
                importQueue.shift(); // Remove
            }
        }
    } finally {
        isProcessingQueue = false;
        // 确保进度条关闭
        hideProgressBar();
    }
}

/**
 * 检测字符串是否为有效的 URL
 * @param {string} value - 待检测的字符串
 * @returns {boolean} - 是否为有效 URL
 */
function isValidUrl(value) {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

/**
 * 从 URL 中提取主机名
 * @param {string} url - URL 字符串
 * @returns {string} - 主机名
 */
function getHostFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return '';
    }
}

/**
 * 平台检测配置
 * 遵循开闭原则：新增平台只需添加配置项，无需修改检测逻辑
 * @type {Array<{hosts: string[], sourceType: string}>}
 */
const PLATFORM_URL_CONFIGS = [
    { hosts: ['chub.ai', 'characterhub.org'], sourceType: 'Chub' },
    { hosts: ['janitorai'], sourceType: 'JanitorAI' },
    { hosts: ['pygmalion.chat'], sourceType: 'Pygmalion' },
    { hosts: ['aicharactercards.com'], sourceType: 'AICharacterCards' },
    { hosts: ['realm.risuai.net'], sourceType: 'RisuAI' },
    { hosts: ['perchance.org'], sourceType: 'Perchance' }
];

/**
 * UUID 检测配置
 * @type {Array<{pattern: RegExp, sourceType: string}>}
 */
const UUID_PATTERNS = [
    // Pygmalion UUID: 36字符的标准 UUID
    { pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i, sourceType: 'Pygmalion UUID' },
    // JanitorAI UUID: 带 _character 后缀
    { pattern: /^[a-f0-9-]+_character$/i, sourceType: 'JanitorAI UUID' },
    // AICC UUID: 以 AICC/ 开头
    { pattern: /^AICC\//i, sourceType: 'AICharacterCards UUID' },
    // Chub UUID: creator/project 格式 (需在 lorebook 检测之前)
    { pattern: /^[\w-]+\/[\w-]+$/, sourceType: 'Chub UUID' }
];

/**
 * 检测输入类型并返回对应的 API 端点和类型信息
 * @param {string} input - 用户输入的 URL 或 UUID
 * @returns {{ endpoint: string, inputType: 'url' | 'uuid', sourceType: string }}
 */
function detectImportSourceType(input) {
    // 检测是否为有效 URL
    if (isValidUrl(input)) {
        const host = getHostFromUrl(input);
        
        // 使用配置驱动的方式检测各平台
        for (const config of PLATFORM_URL_CONFIGS) {
            if (config.hosts.some(h => host.includes(h))) {
                return { endpoint: '/api/content/importURL', inputType: 'url', sourceType: config.sourceType };
            }
        }
        
        // 通用 URL
        return { endpoint: '/api/content/importURL', inputType: 'url', sourceType: 'URL' };
    }
    
    // 检测 UUID 格式 (非 URL 的字符串)
    for (const { pattern, sourceType } of UUID_PATTERNS) {
        if (pattern.test(input)) {
            return { endpoint: '/api/content/importUUID', inputType: 'uuid', sourceType };
        }
    }
    
    // Chub Lorebook UUID: 包含 lorebook 关键字
    if (input.includes('lorebook')) {
        return { endpoint: '/api/content/importUUID', inputType: 'uuid', sourceType: 'Chub Lorebook UUID' };
    }
    
    // 默认尝试作为 UUID
    return { endpoint: '/api/content/importUUID', inputType: 'uuid', sourceType: 'UUID' };
}

async function showUrlImportDialog() {
    let selectedTagIds = [];

    const renderSelectedTags = (container) => {
        container.innerHTML = '';
        if (selectedTagIds.length === 0) {
            const span = doc.createElement('span');
            span.style.color = 'var(--cm-text-sec)';
            span.style.fontSize = '12px';
            span.textContent = '未选择标签';
            container.appendChild(span);
        } else {
            selectedTagIds.forEach(id => {
                const tag = state.tags.find(t => t.id === id);
                if (tag) {
                    const span = doc.createElement('span');
                    span.className = 'cm-card-tag';
                    span.style.background = tag.color || '#666';
                    span.textContent = tag.name;
                    span.style.cursor = 'pointer';
                    // 增大显示尺寸以匹配 + 按钮
                    span.style.fontSize = '14px';
                    span.style.padding = '6px 12px';
                    span.style.lineHeight = '1.2';
                    span.onclick = () => {
                        selectedTagIds = selectedTagIds.filter(tid => tid !== id);
                        renderSelectedTags(container);
                    };
                    container.appendChild(span);
                }
            });
        }
        const addBtn = doc.createElement('button');
        addBtn.className = 'cm-btn cm-btn-sm';
        addBtn.type = 'button'; // 防止意外提交
        addBtn.textContent = '+';
        addBtn.style.marginLeft = '8px';
        addBtn.onclick = (e) => {
            e.stopPropagation(); // 防止冒泡关闭弹窗
            showTagPicker([...selectedTagIds], (newIds) => {
                selectedTagIds = newIds;
                renderSelectedTags(container);
            });
        };
        container.appendChild(addBtn);
    };

    const content = `
        <div style="display:flex;flex-direction:column;gap:12px;padding:10px">
            <div class="cm-form-group">
                <label>链接或 UUID <span style="color:red">*</span></label>
                <input type="text" class="cm-input" id="cmUrlImportLink" placeholder="支持: Chub/JanitorAI/Pygmalion/RisuAI/Perchance/AICC 链接或 UUID">
                <small style="color:var(--cm-text-sec);font-size:11px;margin-top:4px;display:block">
                    支持的平台: Chub.ai, JanitorAI, Pygmalion.chat, RisuAI, Perchance, AICharacterCards.com, 以及直链图片
                </small>
            </div>
            <div class="cm-form-group">
                <label>源链接 (Source)</label>
                <input type="text" class="cm-input" id="cmUrlImportSource" placeholder="来源地址 (选填)">
            </div>
            <div class="cm-form-group">
                <label>备注 (Note)</label>
                <textarea class="cm-input" id="cmUrlImportNote" rows="3" placeholder="追加到备注 (选填)"></textarea>
            </div>
            <div class="cm-form-group">
                <label>标签 (Tags)</label>
                <div id="cmUrlImportTags" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-height:28px"></div>
            </div>
        </div>
    `;

    createBaseDialog('从外部导入', content, [
        { text: '取消', id: 'cmUrlImportCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => close() },
        {
            text: '导入', id: 'cmUrlImportOk', cls: 'cm-btn-primary', onClick: async (ov, close) => {
                const urlInput = ov.querySelector('#cmUrlImportLink');
                const sourceInput = ov.querySelector('#cmUrlImportSource');
                const noteInput = ov.querySelector('#cmUrlImportNote');
                const importBtn = ov.querySelector('#cmUrlImportOk');
                
                const input = urlInput.value.trim();
                const source = sourceInput.value.trim();
                const note = noteInput.value.trim();

                if (!input) {
                    notify('请输入链接或 UUID', 'warning');
                    urlInput.focus();
                    return;
                }

                // 检测输入类型
                const { endpoint, inputType, sourceType } = detectImportSourceType(input);
                // 日志记录：输入值脱敏处理，仅显示前后各20字符
                const sanitizedInput = input.length > 50
                    ? `${input.slice(0, 20)}...${input.slice(-20)}`
                    : input;
                console.log(`[CharManager] 检测到输入类型: ${sourceType}, 端点: ${endpoint}, 输入: ${sanitizedInput}`);

                // 锁定按钮防止重复点击
                importBtn.disabled = true;
                importBtn.textContent = `正在从 ${sourceType} 下载...`;
                const originalBtnText = '导入';

                try {
                    // 1. 下载文件 - 使用检测到的端点
                    let response;
                    try {
                        response = await authFetch(endpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ url: input })
                        });
                    } catch (fetchErr) {
                        throw new Error(`网络请求失败: ${fetchErr.message}`);
                    }

                    if (!response.ok) {
                        const errText = await response.text();
                        let errMsg = `下载失败: ${response.status}`;
                        if (response.status === 404) {
                            errMsg = `未找到内容，请检查链接是否正确`;
                        } else if (errText) {
                            try {
                                const errJson = JSON.parse(errText);
                                if (errJson.message) errMsg = errJson.message;
                            } catch {
                                // 仅显示短错误信息，避免泄露服务器内部信息
                                if (errText.length < 100 && !errText.includes('<') && !errText.includes('stack')) {
                                    errMsg += ` - ${errText}`;
                                }
                            }
                        }
                        throw new Error(errMsg);
                    }

                    // 获取内容类型 (角色卡或 Lorebook)
                    const customContentType = response.headers.get('X-Custom-Content-Type') || 'character';
                    const contentType = response.headers.get('Content-Type') || '';
                    
                    // 获取文件名
                    let fileName = `import_${Date.now()}.png`;
                    const contentDisposition = response.headers.get('Content-Disposition');
                    if (contentDisposition) {
                        const match = contentDisposition.match(/filename="?([^";\n]+)"?/i);
                        if (match) {
                            // 安全处理文件名：移除路径分隔符和前导点，防止路径遍历攻击
                            fileName = decodeURIComponent(match[1])
                                .replace(/[\/\\]/g, '_')  // 移除路径分隔符
                                .replace(/^\.+/, '');      // 移除前导点
                        }
                    }

                    // 检查是否为 Lorebook
                    if (customContentType === 'lorebook') {
                        // Lorebook 需要特殊处理
                        const blob = await response.blob();
                        const file = new File([blob], fileName, { type: blob.type || 'application/json' });
                        
                        close();
                        notify(`正在导入 Lorebook: ${fileName}`, 'info');
                        
                        // 调用原生的 Lorebook 导入
                        try {
                            const ctx = getSTContext();
                            if (ctx && ctx.importWorldInfo) {
                                await ctx.importWorldInfo(file);
                                notify('Lorebook 导入成功', 'success');
                            } else {
                                // 降级：提示用户手动导入
                                const blobUrl = URL.createObjectURL(blob);
                                const a = doc.createElement('a');
                                a.href = blobUrl;
                                a.download = fileName;
                                a.click();
                                // 延迟释放 URL，确保下载完成
                                setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                                notify('Lorebook 已下载，请手动导入到酒馆', 'warning');
                            }
                        } catch (lorebookErr) {
                            console.error('[CharManager] Lorebook 导入失败:', lorebookErr);
                            notify(`Lorebook 导入失败: ${lorebookErr.message}`, 'error');
                        }
                        return;
                    }

                    // 校验 Content-Type (角色卡)
                    if (!contentType.startsWith('image/') && !contentType.includes('json') && !contentType.includes('octet-stream')) {
                        throw new Error(`无效的文件类型: ${contentType}。请提供有效的角色卡链接。`);
                    }

                    const blob = await response.blob();
                    
                    // 使用服务器返回的文件名或生成唯一文件名
                    let ext = 'png';
                    if (contentType.includes('json')) ext = 'json';
                    else if (contentType.includes('webp')) ext = 'webp';
                    
                    // 确保文件名有正确的扩展名
                    if (!/\.\w+$/.test(fileName)) {
                        fileName += '.' + ext;
                    }
                    const uniqueName = fileName;

                    const file = new File([blob], uniqueName, { type: blob.type || 'image/png' });

                    // 2. 预处理：注入 metadata (Source, Note, Tags)
                    // 这样导入后就不需要再调用 updateCharacter，且文件本身也包含了信息
                    let fileToImport = file;
                    try {
                        // 尝试解析 PNG
                        const buf = await blob.arrayBuffer();
                        const charData = await parsePNG(buf); // 使用 index.js 内置的 parsePNG
                        
                        if (charData) {
                            let dataModified = false;
                            
                            // 确定数据节点 (兼容 V2/V3)
                            // 注意：parsePNG 返回的是解码后的 JSON 对象
                            // 如果是 V3，通常结构是 { spec: 'chara_card_v3', data: { ... } }
                            // 如果是 V2，直接是 { name: ... }
                            let dataBlock = charData;
                            if (charData.spec === 'chara_card_v3' && charData.data) {
                                dataBlock = charData.data;
                            }

                            // 1. 注入 Source (如果用户没有填写，使用原始输入)
                            const finalSource = source || (inputType === 'url' ? input : '');
                            if (finalSource) {
                                if (!dataBlock.extensions) dataBlock.extensions = {};
                                // 保留原有 source_url 如果存在? 不，这里是导入新卡，应该应用用户输入的 source
                                dataBlock.extensions.source_url = finalSource;
                                dataModified = true;
                            }

                            // 2. 注入 Note (写入 cm_manager.note)
                            if (note) {
                                if (!dataBlock.extensions) dataBlock.extensions = {};
                                if (!dataBlock.extensions.cm_manager) dataBlock.extensions.cm_manager = {};
                                const oldNote = dataBlock.extensions.cm_manager.note || '';
                                dataBlock.extensions.cm_manager.note = oldNote ? oldNote + '\n' + note : note;
                                dataModified = true;
                            }

                            // 3. 注入 Tags (写入 metadata 以便便携，但 ST-CM 还需要导入后关联)
                            if (selectedTagIds.length > 0) {
                                const newTagNames = selectedTagIds
                                    .map(id => state.tags.find(t => t.id === id)?.name)
                                    .filter(Boolean);
                                
                                if (newTagNames.length > 0) {
                                    if (!dataBlock.extensions) dataBlock.extensions = {};
                                    if (!dataBlock.extensions.cm_manager) dataBlock.extensions.cm_manager = {};
                                    if (!dataBlock.extensions.cm_manager.tags) dataBlock.extensions.cm_manager.tags = [];
                                    
                                    // 合并并去重
                                    const existingTags = new Set(dataBlock.extensions.cm_manager.tags);
                                    newTagNames.forEach(t => existingTags.add(t));
                                    dataBlock.extensions.cm_manager.tags = Array.from(existingTags);
                                    dataModified = true;
                                }
                            }

                            if (dataModified) {
                                // 重新打包 PNG
                                const jsonStr = JSON.stringify(charData);
                                // UTF-8 base64 encoding
                                const base64Str = btoa(unescape(encodeURIComponent(jsonStr)));
                                const key = (charData.spec === 'chara_card_v3') ? 'ccv3' : 'chara';
                                
                                const newBlob = writePngText(buf, key, base64Str);
                                fileToImport = new File([newBlob], uniqueName, { type: 'image/png' });
                                console.log('[CharManager] Metadata injected successfully');
                            }
                        }
                    } catch (err) {
                        console.warn('[CharManager] Failed to inject metadata, falling back to original file', err);
                    }

                    // 3. 记录当前角色列表，执行导入
                    // FIX: getSTCharacters() 返回的是原生对象，属性是 avatar 而非 fileName
                    const oldChars = getSTCharacters().map(c => c.avatar);
                    
                    // 关键修改：下载成功后，关闭弹窗，然后将文件推入队列
                    close();
                    notify(`从 ${sourceType} 下载成功，正在导入...`, 'success');
                    
                    await importFiles([fileToImport]);

                    // 4. 查找新导入的角色并应用 ST-CM 标签关联
                    // (Source 和 Note 已经在 Metadata 里了，不需要再更新)
                    const currentChars = getSTCharacters();
                    // 找出旧列表中不存在的新文件
                    let targetChar = currentChars.find(c => !oldChars.includes(c.avatar));

                    // 如果没找到，尝试通过 uniqueName 查找
                    if (!targetChar) {
                        const nameWithoutExt = uniqueName.replace(/\.[^/.]+$/, "");
                        targetChar = currentChars.find(c => c.avatar && c.avatar.includes(nameWithoutExt));
                    }

                    if (targetChar) {
                        // 仅需处理标签关联 (ST-CM 数据库层面)
                        if (selectedTagIds.length > 0) {
                            let tagCount = 0;
                            for (const tagId of selectedTagIds) {
                                if (await addTagToChar(targetChar.avatar, tagId, true)) tagCount++;
                            }
                            if (tagCount > 0) notify(`已添加 ${tagCount} 个标签`, 'success');
                        }

                        // 尝试导入角色自带的标签 (如果存在)
                        // 即使没有手动选择标签，角色卡本身可能自带标签，需要导入到 ST-CM
                        await migrateAndSaveCmManager(targetChar);
                        await importTags(targetChar, { skipSave: false, checkCmManager: true, isManualImport: true });

                        // 刷新界面以显示标签
                        renderView();
                        renderTagSidebar();
                    } else {
                        if (selectedTagIds.length > 0) {
                             console.warn('未找到新导入的角色，无法应用标签关联');
                             notify('未找到新导入的角色，无法应用标签关联', 'warning');
                        }
                    }

                } catch (e) {
                    console.error(e);
                    notify('导入处理失败: ' + e.message, 'error');
                    // 恢复按钮状态
                    importBtn.disabled = false;
                    importBtn.textContent = originalBtnText;
                } finally {
                    hideProgressBar();
                }
            }
        }
    ], (ov) => {
        // 禁止点击遮罩层关闭
        ov.onclick = null;
        
        const tagsContainer = ov.querySelector('#cmUrlImportTags');
        renderSelectedTags(tagsContainer);
    });
}

function showTagPicker(currentIds, onConfirm) {
    // 1. Create Overlay (stacked)
    const overlay = doc.createElement('div');
    overlay.className = 'cm-tag-editor-overlay';
    // 强制样式以确保覆盖在最上层 (Avoid conflict with base dialog)
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:' + Z_INDEX.SYSTEM_FORCE_OVERLAY + ';display:flex;justify-content:center;align-items:center;'; /* 系统级: 强制覆盖层 */

    // 2. Create Dialog Box
    const dialog = doc.createElement('div');
    dialog.className = 'cm-tag-editor ' + (state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light');
    dialog.style.cssText = 'width:400px;max-width:90%;max-height:80vh;display:flex;flex-direction:column;background:var(--cm-bg);border:1px solid var(--cm-border);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

    // 3. Header
    const header = doc.createElement('div');
    header.className = 'cm-tag-editor-header';
    header.style.cssText = 'padding:12px 16px;border-bottom:1px solid var(--cm-border);display:flex;justify-content:space-between;align-items:center';
    header.innerHTML = '<h3>选择标签</h3><button class="cm-tag-editor-close">' + ICONS.close + '</button>';

    // 4. Body (Matches showTagSelector structure)
    const body = doc.createElement('div');
    body.className = 'cm-tag-editor-body';
    body.style.cssText = 'padding:0;flex:1;overflow:hidden;display:flex;flex-direction:column';

    const wrapper = doc.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    // Quick Create & Suggestions
    const quickCreate = doc.createElement('div');
    quickCreate.className = 'cm-quick-create';
    quickCreate.style.position = 'relative';
    quickCreate.innerHTML = '<input type="text" placeholder="新建或搜索标签..." class="cm-input-sm" autocomplete="off"><button class="cm-btn-sm">+</button>';

    const suggestions = doc.createElement('div');
    suggestions.className = 'cm-tag-suggestions';
    quickCreate.appendChild(suggestions);

    // List
    const list = doc.createElement('div');
    list.className = 'cm-tag-selector-list';
    list.style.cssText = 'flex:1;overflow-y:auto;';

    wrapper.appendChild(quickCreate);
    wrapper.appendChild(list);
    body.appendChild(wrapper);

    // 5. Footer
    const footer = doc.createElement('div');
    footer.className = 'cm-tag-editor-footer';
    footer.style.cssText = 'padding:10px 16px;border-top:1px solid var(--cm-border);text-align:right';
    
    const closeBtnFooter = doc.createElement('button');
    closeBtnFooter.className = 'cm-btn cm-btn-secondary';
    closeBtnFooter.textContent = '关闭';
    closeBtnFooter.style.width = '100%';
    footer.appendChild(closeBtnFooter);

    // Assemble
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    doc.body.appendChild(overlay);

    // 6. Logic
    let localIds = [...currentIds];

    const close = () => overlay.remove();
    header.querySelector('.cm-tag-editor-close').onclick = close;
    closeBtnFooter.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    function renderListItems() {
        list.innerHTML = '';
        if (state.tags.length === 0) {
            const empty = doc.createElement('div');
            empty.style.cssText = 'padding:20px;color:var(--cm-text-sec);text-align:center';
            empty.textContent = '暂无标签';
            list.appendChild(empty);
        } else {
            const sortedTags = [...state.tags].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
            sortedTags.forEach(tag => {
                const isSelected = localIds.includes(tag.id);
                const item = doc.createElement('div');
                item.className = 'cm-tag-selector-item' + (isSelected ? ' selected' : '');
                item.innerHTML =
                    '<span class="cm-tag-color" style="background:' + (tag.color || '#666') + '"></span>' +
                    '<span>' + escapeHtml(tag.name) + '</span>' +
                    (isSelected ? '<span class="cm-tag-check">✓</span>' : '');

                item.onclick = function () {
                    if (isSelected) {
                        localIds = localIds.filter(id => id !== tag.id);
                    } else {
                        localIds.push(tag.id);
                    }
                    renderListItems();
                    onConfirm(localIds); // Live update
                };
                list.appendChild(item);
            });
        }
    }

    renderListItems();

    const quickInput = quickCreate.querySelector('input');
    const quickBtn = quickCreate.querySelector('button');

    const handleCreate = (forceName) => {
        const val = (forceName || quickInput.value).trim();
        if (val) {
            const existingTag = state.tags.find(t => t.name === val);
            if (existingTag) {
                if (!localIds.includes(existingTag.id)) {
                        localIds.push(existingTag.id);
                        notify('已添加已有标签: ' + val, 'success');
                } else {
                        notify('标签已存在', 'warning');
                }
            } else {
                const newTag = createTag(val, DEFAULT_TAG_COLOR);
                localIds.push(newTag.id);
                notify('已创建并添加标签', 'success');
            }
            renderListItems();
            onConfirm(localIds);
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

// 抽取公共的导入进度监控函数，用于文件导入和URL导入
function monitorImportProgress(oldLen, btn, expectedCount = 0) {
    return new Promise(resolve => {
        let checkAttempts = 0;
        const maxChecks = 150; // 最多等 30 秒
        let lastLen = oldLen;
        let stableTicks = 0;

        const checkTimer = setInterval(async () => {
            checkAttempts++;
            const currentLen = getSTCharacters().length;

            if (currentLen > lastLen) {
                // 数量还在增加，重置稳定计数
                const added = currentLen - oldLen;
                updateProgressBar(50, `检测到新角色 (已新增 ${added} 个)...`, '请耐心等待所有角色导入完成');
                lastLen = currentLen;
                stableTicks = 0;
            } else if (currentLen > oldLen && currentLen === lastLen) {
                // 数量大于初始值且保持稳定
                stableTicks++;
                // 连续 4 次检测 (4 * 200ms = 0.8s) 数量无变化，认为导入结束
                if (stableTicks >= 4) {
                    clearInterval(checkTimer);

                    state.renderedCount = 0;
                    // const body = doc.getElementById('cmBody');
                    // if (body) body.innerHTML = ''; // 移除全量清空，避免闪烁

                    // 修正显示数量：如果检测到的增量远大于预期导入数量（例如初始化导致 oldLen=0），则使用预期数量
                    let addedCount = currentLen - oldLen;
                    if (expectedCount > 0 && addedCount > expectedCount) {
                        addedCount = expectedCount;
                    }

                    updateProgressBar(80, `导入结束 (新增 ${addedCount} 个)，正在同步...`, '');
                    // 传入 skipSync=true，因为我们已经确认 parentWin.characters 已更新
                    // 避免调用 parentWin.getCharacters() 可能导致覆盖为旧列表
                    await scan(false, false, true);

                    updateProgressBar(100, '同步完成', '');
                    await new Promise(r => setTimeout(r, 1500));
                    hideProgressBar();

                    state.currentView = 'all';
                    renderView();

                    if (btn) btn.disabled = false;
                    notify(`导入结束，新增 ${addedCount} 个角色`, 'success');
                    resolve(true); // 完成
                }
            } else if (currentLen < oldLen) {
                // 数量减少（可能是删卡后导入），重置基准
                lastLen = currentLen;
                oldLen = currentLen; // 关键：更新oldLen，防止误判
                stableTicks = 0;
            }

            if (checkAttempts >= maxChecks) {
                clearInterval(checkTimer);
                if (btn) btn.disabled = false;
                // 超时了但如果有新增，还是尝试刷新一下
                if (currentLen > oldLen) {
                    notify('导入检测超时，尝试刷新已导入的角色', 'warning');
                    resolve(true);
                } else {
                    notify('导入超时或无变化', 'warning');
                    hideProgressBar();
                    resolve(false);
                }
            }
        }, 200);
    });
}

function sortTags(tags) {
    return tags.sort((a, b) => {
        const pinnedA = !!a.pinned;
        const pinnedB = !!b.pinned;
        if (pinnedA !== pinnedB) return (pinnedB ? 1 : 0) - (pinnedA ? 1 : 0);

        if (state.tagSortMode === 'count') {
            const countA = getTagCharCount(a.id);
            const countB = getTagCharCount(b.id);
            if (countA !== countB) return countB - countA;
        }
        if (state.tagSortMode === 'color') {
            const idxA = COLORS.findIndex(c => c.value === a.color);
            const idxB = COLORS.findIndex(c => c.value === b.color);
            if (idxA !== idxB) return idxA - idxB;
        }
        return a.name.localeCompare(b.name, 'zh-CN');
    });
}

function toggleTagPin(tagId) {
    const tag = state.tags.find(t => t.id === tagId);
    if (tag) {
        tag.pinned = !tag.pinned;
        saveTags();
        renderTagManager();
        renderTagSidebar();
    }
}


export async function updateCreatorComment(char, newComment) {
    try {
        await saveCharacterData(char.fileName, (data) => {
            data.creator_notes = newComment;
            data.creatorcomment = newComment;
        });
        char.creatorcomment = newComment;
        saveCache(); // 手动更新缓存，防止刷新后丢失显示
        notify('备注已保存 (永久写入)', 'success');
        return true;
    } catch (e) {
        notify('保存失败: ' + e.message, 'error');
        return false;
    }
}




function calculateTokens(text) {
    if (!text) return 0;
    // 分离 CJK（中日韩）字符和其他字符，分别使用不同的比例计算
    // 中文字符约 1 字符 = 1 token，其他字符约 3.5 字符 = 1 token
    const cjkMatches = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const otherCount = text.length - cjkCount;
    return Math.ceil(cjkCount + (otherCount / 3.5));
}

function countTokens(p) {
    const d = p.data || p;
    if (!d) return 0;
    let t = (d.name || '') + (d.description || '') + (d.first_mes || '') + (d.scenario || '') + (d.mes_example || '') + (d.system_prompt || '');
    // 包含世界书（character_book）中启用的条目
    const cb = d.character_book;
    if (cb) {
        let entries = [];
        if (Array.isArray(cb)) {
            entries = cb;
        } else if (cb.entries) {
            // V2/V3 格式: character_book.entries
            if (Array.isArray(cb.entries)) {
                entries = cb.entries;
            } else if (typeof cb.entries === 'object') {
                entries = Object.values(cb.entries);
            }
        }
        for (const e of entries) {
            // 默认启用，除非明确 disabled
            if (e.enabled !== false && !e.disable) {
                t += (e.content || '');
                const keys = e.keys || e.key || [];
                if (Array.isArray(keys)) {
                    t += keys.join('');
                } else if (typeof keys === 'string') {
                    t += keys;
                }
            }
        }
    }
    return calculateTokens(t);
}


async function getCharacterList() {
    const r = await authFetch('/api/characters/all', { method: 'POST', body: '{}' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (Array.isArray(d)) return d.map(x => typeof x === 'string' ? x : x.avatar || x.name + '.png');
    throw new Error('数据格式错误');
}

/**
 * 获取角色卡数据（从服务器获取并解析 PNG 元数据）
 * @param {string} fn - 角色文件名
 * @param {Object} stMeta - SillyTavern 内存中的角色元数据对象
 * @param {boolean} [bypassCache=false] - 是否绕过缓存强制从服务器重新获取
 * @returns {Promise<Object>} 角色数据对象，包含基础信息和解析后的扩展数据
 */
async function getCharacterData(fn, stMeta, bypassCache = false) {
    const isFav = stMeta ? (!!stMeta.fav || (stMeta.data && stMeta.data.extensions && !!stMeta.data.extensions.fav)) : false;
    const charBook = stMeta ? (stMeta.character_book || (stMeta.data && stMeta.data.character_book) || '') : '';

    let bookName = '';
    if (charBook) {
        if (typeof charBook === 'string') bookName = charBook;
        else if (typeof charBook === 'object' && charBook.name) bookName = charBook.name;
    }

    const baseInfo = {
        fileName: fn,
        name: fn.replace(/\.png$/i, ''),
        avatarUrl: '/characters/' + encodeURIComponent(fn),
        fav: isFav,
        date_added: (stMeta && stMeta.date_added) ? Number(stMeta.date_added) : 0,
        creatorcomment: stMeta ? (stMeta.creatorcomment || (stMeta.data && stMeta.data.creator_notes) || '') : '',
        version: stMeta ? (stMeta.character_version || (stMeta.data && stMeta.data.character_version) || '') : '',
        character_book: bookName,
        source_link: stMeta ? ((stMeta.data && stMeta.data.extensions && (stMeta.data.extensions.source_link || stMeta.data.extensions.source_url || stMeta.data.extensions.source)) || stMeta.source_link || stMeta.source_url || '') : '',
        chat_date: (stMeta && stMeta.chat_date) ? Number(stMeta.chat_date) : 0,
        date_last_chat: (stMeta && stMeta.date_last_chat) ? Number(stMeta.date_last_chat) : 0
    };
    try {
        const url = '/characters/' + encodeURIComponent(fn) + (bypassCache ? '?t=' + Date.now() : '');
        const r = await authFetch(url);
        if (!r.ok) return { ...baseInfo, greetings: 0, error: true };
        const buf = await r.arrayBuffer();
        const p = await parsePNG(buf);
        const info = getCharInfo(p);
        // 补充 Token 统计
        info.tokens = countTokens(p);
        // 自动迁移逻辑 (Auto Migration): source_link -> source_url
        try {
            const cData = p.data || p;
            if (cData && cData.extensions && cData.extensions.source_link) {
                const oldLink = cData.extensions.source_link;
                // 保存数据 (Save)
                await saveCharacterData(fn, (d) => {
                    if (!d.extensions) d.extensions = {};
                    // 迁移：如果新字段为空，则填入旧字段的值
                    if (!d.extensions.source_url && d.extensions.source_link) {
                        d.extensions.source_url = d.extensions.source_link;
                    }
                    // 删除旧字段
                    delete d.extensions.source_link;
                });
                // 更新当前内存对象，确保后续UI显示正常
                if (cData.extensions) {
                    if (!cData.extensions.source_url) cData.extensions.source_url = oldLink;
                    delete cData.extensions.source_link;
                }
                console.log('[迁移] source_link -> source_url:', fn);
            }
        } catch (e) {
            console.warn('Auto migration failed for ' + fn, e);
        }
        return {
            // ===== 基础信息（用于 UI 显示和列表渲染）=====
            ...baseInfo,           // fileName, avatarUrl, date_added 等基础字段
            fileSize: buf.byteLength,  // 文件大小（字节）
            name: info.name || baseInfo.name,  // 角色名称
            desc: info.desc,       // 角色描述
            greetings: info.greetings,  // 开场白数量
            creator: info.creator, // 创作者
            firstMes: info.firstMes,  // 第一条消息
            altGreetings: info.altGreetings,  // 候补开场白数组
            creatorcomment: baseInfo.creatorcomment || info.creatorcomment,  // 创作者备注
            version: baseInfo.version || info.version,  // 角色卡版本
            fav: baseInfo.fav || info.fav,  // 是否收藏
            character_book: baseInfo.character_book || info.character_book,  // 世界书
            source_link: baseInfo.source_link || info.source_link || '',  // 来源链接
            // 角色卡创建时间：优先使用酒馆 API 返回的值（与快速刷新保持一致）
            // 这样可以确保全量刷新和快速刷新的排序结果一致
            create_date: (stMeta && stMeta.create_date) || info.create_date || (baseInfo.date_added ? new Date(baseInfo.date_added).toISOString() : ''),
            // 保存文件根层级的原始 create_date（用于判断文件是否缺失该字段）
            _fileCreateDate: info.create_date || '',
            tokens: info.tokens || 0,  // Token 数量
            
            // ===== 完整原始数据（用于标签导入等需要访问扩展字段的场景）=====
            data: p.data || p,  // 完整的 data 对象，包含 extensions.cm_manager.tags 等扩展字段
            tags: (p.data || p).tags || [],  // 原生标签数组（data.tags）
            extensions: (p.data || p).extensions || {}  // 扩展字段对象，包含 cm_manager、source_url 等
        };
    } catch (e) {
        return { ...baseInfo, greetings: 0, error: true };
    }
}

function getCharInfo(d) {
    if (!d) return { name: '未知', desc: '', greetings: 0, creator: '未知', creatorcomment: '', version: '', fav: false, character_book: '', source_link: '', tokens: 0, create_date: '' };
    const x = d.data || d;
    const comment = x.creator_notes || x.creatorcomment || x.comment || '';
    const fileFav = (x.extensions && x.extensions.fav) === true;
    let bookName = '';
    if (x.character_book) {
        if (typeof x.character_book === 'string') bookName = x.character_book;
        else if (typeof x.character_book === 'object' && x.character_book.name) bookName = x.character_book.name;
    }
    return {
        name: x.name || '未知',
        desc: x.description || '',
        greetings: 1 + (x.alternate_greetings?.length || 0),
        creator: x.creator || '未知',
        firstMes: x.first_mes || '',
        altGreetings: x.alternate_greetings || [],
        creatorcomment: comment,
        version: x.character_version || '',
        fav: fileFav,
        character_book: bookName,
        source_link: (x.extensions && (x.extensions.source_link || x.extensions.source_url || x.extensions.source)) || x.source_link || x.sourceUrl || '',
        // create_date：与酒馆保持一致，只检查根层级
        create_date: d.create_date || '',
        tokens: countTokens(d)
    };
}




async function saveCache() {
    try {
        // 低内存优化：列表缓存瘦身，去除体积庞大的 data 完整对象，仅保留必要列表/状态字段
        const shallowChars = state.characters.map(c => {
            const shallow = { ...c };
            if (shallow.data) {
                // 保留对列表渲染和标签必要的扩展状态，丢弃 description/book/scenario 等大文本
                const slimData = { 
                    name: shallow.data.name,
                    tags: shallow.data.tags,
                    extensions: {
                        cm_manager: shallow.data.extensions?.cm_manager || {}
                    }
                };
                if (shallow.data.extensions?.fav !== undefined) {
                    slimData.extensions.fav = shallow.data.extensions.fav;
                }
                shallow.data = slimData;
            }
            return shallow;
        });
        
        // 使用 IndexedDB 保存，彻底解决 LocalStorage 容量限制问题
        await setCache('characters', shallowChars);
        console.log('[CharManager] Cache saved to IndexedDB. Items:', shallowChars.length);
    } catch (e) {
        console.error('[CharManager] Failed to save cache:', e);
        notify('无法保存缓存: ' + e.message, 'error');
    }
}

function updateProgressBar(progress, text, subtext = '') {
    const overlay = doc.getElementById('cmProgressOverlay');
    if (overlay) {
        const bar = overlay.querySelector('.cm-progress-bar-fill');
        const txt = overlay.querySelector('.cm-progress-text');
        const sub = overlay.querySelector('.cm-progress-sub');
        if (bar) bar.style.width = progress + '%';
        if (txt) txt.textContent = text;
        if (sub) sub.textContent = subtext;
    }
}

/**
 * 显示进度条
 * @param {string} initialText - 初始文本
 * @param {boolean|function} showCancelOrCallback - 是否显示取消按钮，或取消回调函数
 * @returns {HTMLElement|null} 返回取消按钮元素（如果存在）
 */
function showProgressBar(initialText = '处理中...', showCancelOrCallback = false) {
    const existing = doc.getElementById('cmProgressOverlay');
    if (existing) existing.remove();

    const showCancel = !!showCancelOrCallback;
    const cancelCallback = typeof showCancelOrCallback === 'function' ? showCancelOrCallback : null;

    const ov = doc.createElement('div');
    ov.id = 'cmProgressOverlay';
    ov.className = 'cm-progress-overlay';
    ov.innerHTML =
        '<div class="cm-progress-box">' +
        '<div class="cm-progress-text">' + initialText + '</div>' +
        '<div class="cm-progress-bar-wrap"><div class="cm-progress-bar-fill"></div></div>' +
        '<div class="cm-progress-sub"></div>' +
        (showCancel ? '<button id="cmProgressBarCancel" class="cm-btn cm-btn-secondary" style="margin-top:12px;font-size:12px;padding:6px 16px">取消</button>' : '') +
        '</div>';
    doc.body.appendChild(ov);

    // 如果提供了取消回调，立即绑定
    const cancelBtn = ov.querySelector('#cmProgressBarCancel');
    if (cancelBtn && cancelCallback) {
        cancelBtn.onclick = cancelCallback;
    }

    return cancelBtn;
}

function hideProgressBar() {
    const ov = doc.getElementById('cmProgressOverlay');
    if (ov) {
        ov.style.opacity = '0';
        setTimeout(() => ov.remove(), 300);
    }
}

async function scan(showToast = true, forceFull = false, skipSync = false) {
    if (state.isScanning) return;
    state.isScanning = true;

    const btn = doc.getElementById('cmScanBtn');
    const icon = btn ? btn.querySelector('.cm-spin-target') : null;
    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('rotating');

    try {
        console.debug('[CharManager] Scan triggered. forceFull:', forceFull, 'skipSync:', skipSync);
        if (forceFull) showProgressBar('正在准备全量扫描...');

        // 强制同步酒馆内存 (skipSync=true 时跳过，防止覆盖本地已更新的列表)
        if (!skipSync && parentWin.getCharacters && typeof parentWin.getCharacters === 'function') {
            await parentWin.getCharacters();
            // 给一点时间让酒馆处理
            await new Promise(r => setTimeout(r, 100));
        }

        let stChars = getSTCharacters();
        // 防误删保护：如果API返回空但本地有较多数据，可能是API挂了
        if ((!stChars || stChars.length === 0) && state.characters.length > 5) {
            await new Promise(r => setTimeout(r, 500));
            stChars = getSTCharacters();
            if ((!stChars || stChars.length === 0)) {
                console.warn('[CharManager] 列表读取异常，已拦截清空操作');
                if (showToast) notify('读取酒馆列表失败 (可能未就绪)，已取消扫描', 'warning');
                return;
            }
        }

        // 在扫描开始时保存标签快照，防止异步操作期间被覆盖
        // 加载最新的标签数据
        loadTags();
        
        // 保存标签快照（深拷贝），用于扫描结束后恢复可能的丢失数据
        const tagsSnapshot = {
            tags: JSON.parse(JSON.stringify(state.tags)),
            tagMap: JSON.parse(JSON.stringify(state.tagMap))
        };
        
        const cacheMap = new Map();
        state.characters.forEach(c => cacheMap.set(c.fileName, c));

        const newList = [];
        let newCount = 0;
        const listToProcess = Array.isArray(stChars) ? stChars : [];
        const toFetch = [];

        for (const stC of listToProcess) {
            if (!forceFull && cacheMap.has(stC.avatar)) {
                const cached = cacheMap.get(stC.avatar);
                // 同步基础元数据以免改名后不同步
                const data = stC.data || {};
                cached.name = stC.name || data.name || stC.avatar.replace(/\.png$/i, '');

                if (stC.creator) cached.creator = stC.creator;

                // 同步 creator_notes (修复覆盖翻译后不更新的问题)
                cached.creatorcomment = stC.creatorcomment || data.creator_notes || cached.creatorcomment || '';

                // 同步 Tag/Fav
                const isFav = !!stC.fav || (data.extensions && !!data.extensions.fav);
                cached.fav = isFav;

                // 同步 Source Link
                const src = (data.extensions && (data.extensions.source_link || data.extensions.source_url || data.extensions.source)) || data.source_link || stC.source_link;
                if (src) cached.source_link = src;

                let bookName = '';
                const rawBook = stC.character_book || data.character_book;
                if (rawBook) {
                    if (typeof rawBook === 'string') bookName = rawBook;
                    else if (typeof rawBook === 'object' && rawBook.name) bookName = rawBook.name;
                    cached.character_book = bookName;
                }

                cached.version = stC.character_version || data.character_version || cached.version || '';

                // 迁移旧的扩展配置到 cm_manager（如有迁移则保存）
                await migrateAndSaveCmManager(stC);

                // 同步最新扫描元数据到当前列表内存，避免重新导入后继续沿用旧时间排序
                if (stC.date_added !== undefined) {
                    cached.date_added = stC.date_added;
                }
                // 同步角色卡创建时间（用于"创建日期"排序）
                if (stC.create_date !== undefined) {
                    cached.create_date = stC.create_date;
                }
                // 同步最近聊天时间（用于"最近"排序）
                if (stC.date_last_chat !== undefined) {
                    cached.date_last_chat = stC.date_last_chat;
                }

                // 同步 Tag（使用 cm_manager.tags 或检查是否需要导入）
                await importTags(stC, { skipSave: true, checkCmManager: true, skipApiCall: true });

                newList.push(cached);
            } else {
                toFetch.push(stC);
            }
        }

        // 收集需要标签导入确认的角色
        const charsNeedTagImport = [];

        if (toFetch.length > 0) {
            console.debug('[CharManager] New/Modified cards to fetch:', toFetch.length);
            if (showToast && !forceFull) notify(`发现 ${toFetch.length} 张新卡，正在后台同步...`, 'info');
            const chunkSize = state.settings?.scanBatchSize || 15;
            for (let i = 0; i < toFetch.length; i += chunkSize) {
                const chunk = toFetch.slice(i, i + chunkSize);

                if (forceFull) {
                    const progress = Math.round(((i) / toFetch.length) * 100);
                    updateProgressBar(progress, `正在扫描... ${i}/${toFetch.length}`, `当前批次: ${chunk.length} 个`);
                }

                // 并发抓取（全量扫描时强制绕过缓存）
                const results = await Promise.all(chunk.map(c => getCharacterData(c.avatar, c, forceFull)));
                for (const fresh of results) {
                    if (!fresh.error) {
                        // 迁移旧的扩展配置到 cm_manager（如有迁移则保存）
                        await migrateAndSaveCmManager(fresh);

                        // 检查是否需要标签导入确认
                        if (needsTagImport(fresh)) {
                            charsNeedTagImport.push(fresh);
                        } else {
                            // 已有 cm_manager.tags 或无标签，直接导入
                            await importTags(fresh, { skipSave: true, checkCmManager: true, skipApiCall: true });
                        }
                        
                        newList.push(fresh);
                        newCount++;
                    }
                }
            }
        }

        // 批量处理需要标签导入确认的角色
        if (charsNeedTagImport.length > 0) {
            await batchImportTags(charsNeedTagImport, { skipSave: true, skipApiCall: true });
        }

        if (forceFull) updateProgressBar(100, '扫描完成！', '即将刷新列表...');

        // 批量保存标签更改
        saveTags();
        
        // 合并标签快照，恢复异步操作期间可能丢失的标签数据
        // 【修复】添加时间戳机制，避免恢复用户在扫描期间有意删除的标签
        // 注意：如果扫描期间用户删除了标签，该标签在 state.tags 中不存在是预期行为
        // 只有当标签有角色关联但不在 state.tags 中时，才可能是数据丢失
        const deletedTagIdsDuringScan = new Set();
        
        // 找出扫描期间被有意删除的标签（快照中有但当前没有，且无关联）
        for (const tag of tagsSnapshot.tags) {
            if (!state.tags.some(t => t.id === tag.id)) {
                // 检查该标签是否仍有关联的角色
                const hasAssociationInSnapshot = Object.values(tagsSnapshot.tagMap).some(tagIds => tagIds.includes(tag.id));
                const hasAssociationInCurrent = Object.values(state.tagMap).some(tagIds => tagIds.includes(tag.id));
                
                // 如果快照中有关联但当前没有，说明用户可能在扫描期间取消了标签关联
                // 如果快照中和当前都有关联，说明标签数据可能丢失，需要恢复
                if (hasAssociationInSnapshot && hasAssociationInCurrent) {
                    // 恢复该标签（可能是数据丢失）
                    state.tags.push(tag);
                    console.log('[CharManager] 恢复扫描期间丢失的标签:', tag.name);
                } else if (!hasAssociationInSnapshot && !hasAssociationInCurrent) {
                    // 无关联，可能是之前遗留的标签，不需要恢复
                    deletedTagIdsDuringScan.add(tag.id);
                }
                // 其他情况：用户可能在扫描期间修改了关联，以当前状态为准
            }
        }
        
        // 检查 tagMap 中是否有丢失的关联
        for (const [fileName, tagIds] of Object.entries(tagsSnapshot.tagMap)) {
            // 跳过在扫描期间被删除的角色
            if (!state.characters.some(c => c.fileName === fileName)) continue;
            
            if (!state.tagMap[fileName]) {
                // 该角色的标签关联完全丢失，恢复
                state.tagMap[fileName] = tagIds.filter(tagId =>
                    // 只恢复仍然存在的标签，跳过被删除的标签
                    state.tags.some(t => t.id === tagId) && !deletedTagIdsDuringScan.has(tagId)
                );
                if (state.tagMap[fileName].length > 0) {
                    console.log('[CharManager] 恢复扫描期间丢失的标签关联:', fileName);
                }
            } else {
                // 合并标签关联，但跳过被删除的标签
                for (const tagId of tagIds) {
                    if (!state.tagMap[fileName].includes(tagId)) {
                        // 只合并仍然存在的标签
                        if (state.tags.some(t => t.id === tagId) && !deletedTagIdsDuringScan.has(tagId)) {
                            state.tagMap[fileName].push(tagId);
                        }
                    }
                }
            }
        }
        
        // 再次保存合并后的标签
        saveTags();
        
        // 批量写入 API（如果有待写入的角色卡）
        if (pendingApiWrites.length > 0) {
            updateProgressBar(0, `正在写入标签 0/${pendingApiWrites.length}`, '');
            
            const writeResult = await batchWriteTagsToCards(pendingApiWrites, (current, total) => {
                updateProgressBar(Math.round((current / total) * 100), `正在写入标签 ${current}/${total}`, '');
            });
            
            // 显示结果
            if (writeResult.failed.length > 0) {
                const failedNames = writeResult.failed.map(f => f.fileName.replace(/\.png$/i, '')).join(', ');
                notify(`成功 ${writeResult.success} 张，失败 ${writeResult.failed.length} 张：${failedNames}`, 'warning');
            } else {
                notify(`成功写入 ${writeResult.success} 张角色卡标签`, 'success');
            }
            
            // 清空队列
            clearPendingApiWrites();
            
            updateProgressBar(100, '写入完成', '');
        }

        state.characters = newList;

        // 注入画廊计数缓存
        state.characters.forEach(c => {
            if (galleryCountCache[c.name] !== undefined) {
                c.galleryCount = galleryCountCache[c.name];
            }
        });

        // 按照当前排序规则对角色列表进行排序
        state.characters.sort(compareChars);

        state.renderedCount = 0; // 重置无限滚动计数


        findDuplicates();
        updateStats();
        renderTagSidebar();
        renderView(); // 重新渲染列表

        if (showToast) {
            if (newCount > 0) notify('同步完成，新增 ' + newCount + ' 个', 'success');
            else notify('列表已同步 (无新增)', 'success');
        }

        await saveCache();

        // 【清理】全量扫描时清理已废弃的 import_time 字段（同时清理内存和角色卡文件）
        if (forceFull) {
            // 计算后续操作的总数量，用于进度条显示
            const charsToClean = state.characters.filter(
                char => char.data?.extensions?.cm_manager?.import_time !== undefined
            );
            const charsMissingCreateDate = state.settings.autoAddCreateDate 
                ? state.characters.filter(char => !char._fileCreateDate)
                : [];
            const totalPostOps = charsToClean.length + charsMissingCreateDate.length;
            
            if (totalPostOps > 0) {
                updateProgressBar(100, '正在处理后续操作...', `共 ${totalPostOps} 个角色`);
            }
            
            let cleanedCount = 0;
            
            // 写入角色卡文件
            let postOpIndex = 0;
            for (const char of charsToClean) {
                try {
                postOpIndex++;
                if (totalPostOps > 0) {
                    const progress = Math.round((postOpIndex / totalPostOps) * 100);
                    updateProgressBar(progress, '清理废弃字段...', `${postOpIndex}/${totalPostOps}`);
                }
                    await saveCharacterData(char.fileName, (data) => {
                        if (data.extensions?.cm_manager?.import_time !== undefined) {
                            delete data.extensions.cm_manager.import_time;
                            cleanedCount++;
                        }
                    });
                    // 同步清理内存中的字段
                    if (char.data?.extensions?.cm_manager?.import_time !== undefined) {
                        delete char.data.extensions.cm_manager.import_time;
                    }
                } catch (e) {
                    console.warn('[CharManager] 清理 import_time 失败:', char.fileName, e);
                }
            }
            
            // 【新增】全量扫描时自动为缺少 create_date 字段的角色卡添加该字段
            if (state.settings.autoAddCreateDate) {
                let addedCount = 0;
                
                // 写入角色卡文件
                for (const char of charsMissingCreateDate) {
                    try {
                    postOpIndex++;
                    if (totalPostOps > 0) {
                        const progress = Math.round((postOpIndex / totalPostOps) * 100);
                        updateProgressBar(progress, '补全创建时间...', `${postOpIndex}/${totalPostOps}`);
                    }
                        await saveCharacterData(char.fileName, (data) => {
                            if (!data.create_date) {
                                // 优先使用 date_added（酒馆提供的文件创建时间戳，毫秒）
                                // 如果没有 date_added，才使用当前时间作为降级
                                const createDate = char.date_added 
                                    ? new Date(char.date_added).toISOString() 
                                    : new Date().toISOString();
                                data.create_date = createDate;
                                addedCount++;
                                console.log('[CharManager] 补全 create_date:', char.name, '→', createDate);
                            }
                        });
                        // 同步更新内存中的字段
                        if (!char.create_date) {
                            char.create_date = char.date_added 
                                ? new Date(char.date_added).toISOString() 
                                : new Date().toISOString();
                        }
                    } catch (e) {
                        console.warn('[CharManager] 添加 create_date 失败:', char.fileName, e);
                    }
                }
                
                if (addedCount > 0) {
                    console.log('[CharManager] 全量扫描为', addedCount, '个角色添加了 create_date 字段');
                    notify(`已为 ${addedCount} 个角色卡添加创建时间`, 'success');
                    // 补全后重新排序，确保排序一致性
                    state.characters.sort(compareChars);
                    await saveCache(); // 保存更新后的数据

                    // 实时刷新列表页，使最新/最旧排序立即生效
                    state.renderedCount = 0;
                    renderView();

                    // 实时刷新详情页（如果当前打开了某张角色卡的详情页）
                    if (state.currentDetailChar) {
                        const updatedChar = state.characters.find(c => c.fileName === state.currentDetailChar.fileName);
                        if (updatedChar) {
                            state.currentDetailChar = updatedChar;
                            const detailOverlay = doc.querySelector('.cm-detail-overlay');
                            if (detailOverlay) {
                                const detailInstance = detailOverlay.__detailInstance;
                                if (detailInstance) {
                                    detailInstance.char = updatedChar;
                                    // 重建 header 以刷新日期等元数据显示
                                    detailInstance.rebuildHeaderPreserveOrder();
                                }
                            }
                        }
                    }
                }
            }
            
            if (cleanedCount > 0) {
                console.log('[CharManager] 全量扫描清理了', cleanedCount, '个角色的 import_time 字段');
                await saveCache(); // 保存清理后的数据
            }
            setTimeout(hideProgressBar, 800);
        }

    } catch (e) {
        console.error(e);
        
        // 收集详细的上下文信息
        const errorContext = {
            forceFull,
            skipSync,
            characterCount: state.characters?.length || 0,
            tagsCount: state.tags?.length || 0,
            tagMapKeys: state.tagMap ? Object.keys(state.tagMap).slice(0, 10) : [],
        };
        
        // 如果错误包含诊断信息（来自 filterTags 的类型检查），添加到上下文
        if (e.diagnostics) {
            errorContext.diagnostics = e.diagnostics;
            errorContext.errorType = 'filterTags_type_check';
        }
        
        // 如果是 JSON 解析错误，尝试提取更多信息
        if (e.message && e.message.includes('JSON')) {
            // 尝试获取可能导致问题的数据
            try {
                const ctx = getSTContext();
                if (ctx && ctx.tagMap) {
                    // 检查 tagMap 是否有异常值
                    const tagMapStr = JSON.stringify(ctx.tagMap);
                    errorContext.tagMapPreview = tagMapStr.substring(0, 500);
                }
            } catch (ctxErr) {
                errorContext.tagMapError = ctxErr.message;
            }
        }
        
        // 显示详细错误报告弹窗
        showErrorReport({
            title: '扫描出错',
            message: e.message || '未知错误',
            error: e,
            context: errorContext
        });
        
        if (forceFull) hideProgressBar();
    } finally {
        state.isScanning = false;
        if (btn) btn.disabled = false;
        if (icon) icon.classList.remove('rotating');
    }
}

/**
 * 刷新单张角色卡的缓存数据并更新 UI
 * @param {string} fileName - 角色卡文件名
 * @param {object} [options] - 选项
 * @param {boolean} [options.refreshUI=true] - 是否刷新 UI
 * @param {boolean} [options.refreshDetails=true] - 是否刷新详情页
 * @param {boolean} [options.useSavedTags=false] - 是否使用已保存的标签（true: 使用 cm_manager.tags，适用于翻译后刷新；false: 从 data.tags 重新加载）
 */
async function refreshSingleCard(fileName, { refreshUI = true, refreshDetails = true, useSavedTags = false } = {}) {
    try {
        // 1. 从酒馆获取最新数据
        if (parentWin.getCharacters && typeof parentWin.getCharacters === 'function') {
            await parentWin.getCharacters();
        }
        
        const stChars = getSTCharacters();
        const stChar = stChars.find(c => c.avatar === fileName);
        
        if (!stChar) {
            console.warn('[CharManager] 未找到角色:', fileName);
            return false;
        }
        
        // 2. 获取完整角色数据，绕过缓存
        const freshData = await getCharacterData(fileName, stChar, true);
        
        if (freshData.error) {
            console.warn('[CharManager] 获取角色数据失败:', fileName);
            return false;
        }
        
        // 3. 迁移和导入标签
        await migrateAndSaveCmManager(freshData);
        // 根据 useSavedTags 参数决定是否使用已保存的标签
        // useSavedTags=true: 使用 cm_manager.tags（适用于翻译后刷新，保留翻译后的标签）
        // useSavedTags=false: 从 data.tags 重新加载（适用于一般刷新）
        await importTags(freshData, { skipSave: false, checkCmManager: useSavedTags });
        saveTags(); // 强制保存标签状态
        
        // 4. 更新本地缓存
        const cachedIndex = state.characters.findIndex(c => c.fileName === fileName);
        if (cachedIndex !== -1) {
            // 保留一些本地字段
            const oldData = state.characters[cachedIndex];
            freshData.galleryCount = oldData.galleryCount;
            // 注意：不保留旧标签，使用 importTags 更新后的 state.tagMap
            
            state.characters[cachedIndex] = freshData;
        } else {
            // 新卡，添加到列表
            state.characters.push(freshData);
        }
        
        // 持久化到 IndexedDB，确保重启后数据一致
        await persistCharacterState(true);
        
        // 5. 刷新 UI
        if (refreshUI) {
            renderView();
            updateStats();
            renderTagSidebar();
        }
        
        // 6. 刷新详情页（如果当前正在查看该角色）
        if (refreshDetails && state.currentDetailChar && state.currentDetailChar.fileName === fileName) {
            // 更新 currentDetailChar 引用
            state.currentDetailChar = freshData;
            // 找到详情页实例并更新
            const detailOverlay = doc.querySelector('.cm-detail-overlay');
            if (detailOverlay) {
                // 更新详情页实例的 char 引用
                const detailInstance = detailOverlay.__detailInstance;
                if (detailInstance) {
                    detailInstance.char = freshData;
                    // 重新渲染详情页
                    detailInstance.renderDetailsTab();
                }
            }
        }
        
        return true;
    } catch (e) {
        console.error('[CharManager] 刷新单卡失败:', fileName, e);
        return false;
    }
}

function findDuplicates() {
    const g = new Map();
    // 提取核心名称的逻辑：移除首尾数字，并且移除圆括号或方括号内的内容（如果是后缀形式）
    // 例如： "Annie 2" -> "Annie"
    //       "Annie (Variant)" -> "Annie"
    //       "Annie [Diff]" -> "Annie"
    // 注意：这里的正则比较激进，旨在捕捉常见的变体命名
    // 但根据用户需求：如果用户明确改名为 "Annie (小克版)"，他可能不希望被识别为重复
    // 修正：用户希望通过后缀来区分，意味着如果有后缀，就不应该被视为重复
    // 因此，我们只去除纯数字后缀，保留文字后缀。
    
    state.characters.forEach(c => {
        // 旧逻辑：移除首尾数字
        // const core = c.name.replace(/^\d+/, '').replace(/\d+$/, '').trim() || c.name;

        // 新逻辑：仅移除首尾的纯数字编号（如 "Char 1", "2Char"），
        // 但保留括号、文字后缀等。
        // 这样 "Annie" 和 "Annie (Ver 2)" 将被视为两个不同的核心名，不再判定为重复。
        let core = c.name;
        
        // 移除末尾的数字（通常是自动重命名产生的），例如 "Name 1", "Name 2"
        // 匹配模式：空格+数字+结束
        core = core.replace(/\s+\d+$/, '');

        // 增强：移除括号内的数字，如 "Name (1)"，这是操作系统常见的重命名格式
        core = core.replace(/\s*\(\d+\)$/, '');

        // 进一步增强：移除文字后缀，以应对 "Name_kami" 或 "Name (Var)" 这样的情况
        // 策略：移除末尾的下划线及其后内容
        core = core.replace(/_.*$/, '');
        // 策略：移除末尾的括号及其内容
        core = core.replace(/\s*\(.*\)$/, '');
        
        // 移除开头的数字（较少见，但也处理一下）
        core = core.replace(/^\d+\s+/, '');

        core = core.trim();

        if (!core) core = c.name; // 防止变成空字符串

        if (!g.has(core)) g.set(core, []);
        g.get(core).push(c);
    });
    
    state.duplicateGroups = [];
    g.forEach((chars, core) => {
        if (chars.length > 1) {
            // 用户需求：只有"裸名"卡才被视为重复卡
            // "裸名"定义：名字本身就是核心名，或者只是被系统自动加了数字后缀（如 "丽莎1", "丽莎 2", "丽莎(3)"）
            // 已经有文字后缀的卡（如 "丽莎_kami", "丽莎 (Ver2)"）说明用户已经区分过了，不需要再提醒
            const bareChars = chars.filter(c => {
                // 对名字执行与 coreName 提取相同的"数字后缀清理"
                let stripped = c.name;
                stripped = stripped.replace(/\s+\d+$/, '');   // "Name 1" -> "Name"
                stripped = stripped.replace(/\s*\(\d+\)$/, ''); // "Name (1)" -> "Name"
                stripped = stripped.replace(/\d+$/, '');       // "Name1" -> "Name"（无空格紧接数字）
                stripped = stripped.trim();
                if (!stripped) stripped = c.name;
                return stripped === core;
            });
            if (bareChars.length > 0) {
                state.duplicateGroups.push({ coreName: core, characters: bareChars, count: bareChars.length, totalVariants: chars.length });
            }
        }
    });
}

function updateStats() {
    const el = doc.getElementById('cmHeaderStats');
    if (el) {
        let txt = state.characters.length + ' 个';
        if (state.duplicateGroups.length > 0) txt += ' | ' + state.duplicateGroups.length + ' 组重复';
        el.textContent = txt;
    }
}

function updateBatchBar() {
    const bar = doc.getElementById('cmBatchBar');
    const cnt = doc.getElementById('cmSelectedCount');
    if (bar && cnt) {
        cnt.textContent = state.selectedCards.size;
        bar.style.display = state.selectedCards.size > 0 ? 'flex' : 'none';
    }
}

// --- Infinite Scroll Logic --- 
function appendBatch(container) {
    const total = state.filteredList.length;
    if (state.renderedCount >= total) return;

    const nextBatch = state.filteredList.slice(state.renderedCount, state.renderedCount + state.BATCH_SIZE);
    const fragment = doc.createDocumentFragment();

    nextBatch.forEach(char => {
        const isDup = state.duplicateGroups.some(g => g.characters.some(c => c.fileName === char.fileName));
        fragment.appendChild(createCard(char, isDup));
    });

    const sentinel = container.querySelector('#cmSentinel');
    if (sentinel) {
        container.insertBefore(fragment, sentinel);
    } else {
        container.appendChild(fragment);
    }

    state.renderedCount += nextBatch.length;
    updateStats();
}

function setupInfiniteScroll(container) {
    if (state.observer) state.observer.disconnect();

    let sentinel = doc.getElementById('cmSentinel');
    if (!sentinel) {
        sentinel = doc.createElement('div');
        sentinel.id = 'cmSentinel';
        sentinel.style.gridColumn = '1 / -1';
        sentinel.style.height = '60px';
        sentinel.style.textAlign = 'center';
        sentinel.style.color = 'var(--cm-text-sec)';
        sentinel.style.display = 'flex';
        sentinel.style.alignItems = 'center';
        sentinel.style.justifyContent = 'center';
        sentinel.innerHTML = '加载更多...';
        container.appendChild(sentinel);
    }

    state.observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            appendBatch(container);
            // 递归检查：如果加载后sentinel仍在视野内（屏幕过大），继续加载
            setTimeout(() => {
                const sent = doc.getElementById('cmSentinel');
                if (sent && state.renderedCount < state.filteredList.length) {
                    const rect = sent.getBoundingClientRect();
                    const root = doc.getElementById('cmBody').getBoundingClientRect();
                    if (rect.top < root.bottom + 500) {
                        appendBatch(container);
                    }
                }
            }, 100);
        }
    }, { root: doc.getElementById('cmBody'), rootMargin: '300px' });

    state.observer.observe(sentinel);
}

export function renderView() {
    if (state.currentView === 'all') { state.currentTag = null; renderAll(); }
    else if (state.currentView === 'favorites') { state.currentTag = null; renderFavorites(); }
    else if (state.currentView === 'duplicates') { state.currentTag = null; renderDuplicates(); }
    else if (state.currentView === 'tags') { renderByTag(); }
    else if (state.currentView === 'tagManager') { renderTagManager(); }
    updateActiveTab();
}

/**
 * 刷新单张卡片的标签显示（用于 AI 概览生成后）
 * @param {string} fileName - 角色文件名
 */
export function refreshCardTags(fileName) {
    // 标签显示相关常量
    const MAX_VISIBLE_TAGS = 3;           // 最多显示的标签数量
    const TAG_OVERFLOW_THRESHOLD = 4;     // 触发溢出提示的标签数量阈值
    
    const card = doc.querySelector(`.cm-card[data-file="${CSS.escape(fileName)}"]`);
    if (!card) return;
    
    const char = state.characters.find(c => c.fileName === fileName);
    if (!char) return;
    
    const charTags = getCharTags(fileName);
    let tagsHtml = '';
    if (charTags.length > 0) {
        tagsHtml = '<div class="cm-card-tags">';
        const maxVisible = charTags.length > TAG_OVERFLOW_THRESHOLD ? MAX_VISIBLE_TAGS : charTags.length;
        charTags.slice(0, maxVisible).forEach(t => {
            tagsHtml += '<span class="cm-card-tag" style="background:' + (t.color || '#666') + '">' + escapeHtml(truncate(t.name, 4)) + '</span>';
        });
        if (charTags.length > TAG_OVERFLOW_THRESHOLD) {
            tagsHtml += '<span class="cm-card-tag-more">+' + (charTags.length - MAX_VISIBLE_TAGS) + '</span>';
        }
        tagsHtml += '</div>';
    }
    
    const tagsContainer = card.querySelector('.cm-card-info');
    if (tagsContainer) {
        const existingTags = tagsContainer.querySelector('.cm-card-tags');
        if (existingTags) {
            existingTags.remove();
        }
        // 统一插入到 tagsContainer 开头位置
        if (tagsHtml) {
            tagsContainer.insertAdjacentHTML('afterbegin', tagsHtml);
        }
    }
}

function updateActiveTab() {
    doc.querySelectorAll('.cm-tab').forEach(t => {
        const view = t.dataset.view;
        if (view === 'tags' || view === 'tagManager') {
            t.classList.toggle('active', state.currentView === 'tags' || state.currentView === 'tagManager');
        } else {
            t.classList.toggle('active', t.dataset.view === state.currentView);
        }
    });
}

export function renderTagSidebar() {
    const sidebar = doc.getElementById('cmTagSidebar');
    if (!sidebar) return;
    const untaggedCount = getUntaggedChars().length;
    const favCount = getFavChars().length;
    let html = '<div class="cm-tag-list">';
    html += '<div class="cm-tag-item' + (state.currentView === 'favorites' ? ' active' : '') + '" id="cmSidebarFav"><span class="cm-tag-icon">' + ICONS.star + '</span><span class="cm-tag-name">收藏夹</span><span class="cm-tag-count">' + favCount + '</span></div>';
    html += '<div style="height:1px;background:var(--cm-border);margin:8px 10px;opacity:0.5"></div>';
    html += '<div class="cm-tag-item' + (state.currentView === 'tags' && state.currentTag === null ? ' active' : '') + '" data-tag="untagged"><span class="cm-tag-color" style="background:#888"></span><span class="cm-tag-name">未分类</span><span class="cm-tag-count">' + untaggedCount + '</span></div>';
    const sortedTags = sortTags([...state.tags]);
    sortedTags.forEach(tag => {
        const count = getTagCharCount(tag.id);
        const pinStyle = tag.pinned ? 'border-bottom:2px solid #ffd700;padding-bottom:0px;display:inline-block;line-height:1.2;' : '';
        html += '<div class="cm-tag-item' + (state.currentTag === tag.id ? ' active' : '') + '" data-tag="' + tag.id + '"><span class="cm-tag-color" style="background:' + (tag.color || '#666') + '"></span><span class="cm-tag-name"><span style="' + pinStyle + '">' + escapeHtml(tag.name) + '</span></span><span class="cm-tag-count">' + count + '</span></div>';
    });
    html += '<div style="height:60px"></div></div>';
    sidebar.innerHTML = html;
    const favBtn = sidebar.querySelector('#cmSidebarFav');
    if (favBtn) favBtn.onclick = function () {
        state.currentView = 'favorites';
        state.currentTag = null;
        renderView();
        renderTagSidebar();
    };
    sidebar.querySelectorAll('.cm-tag-item[data-tag]').forEach(item => {
        item.onclick = function () {
            state.currentView = 'tags';
            state.currentTag = this.dataset.tag === 'untagged' ? null : this.dataset.tag;
            renderView();
            renderTagSidebar();
        };
    });
}

/**
 * 更新卡片上的桃心徽章显示状态（局部刷新）
 * @param {HTMLElement} card - 卡片 DOM 元素
 * @param {boolean} isFav - 是否已收藏
 */
export function updateFavHeartOnCard(card, isFav) {
    if (!card) return;
    // 查找右上角徽章区域内的桃心
    const badgesContainer = card.querySelector('.cm-top-right-badges');
    if (!badgesContainer) return;
    
    let heart = badgesContainer.querySelector('.cm-badge-fav-heart');
    if (isFav) {
        if (!heart) {
            // 创建桃心徽章
            heart = doc.createElement('span');
            heart.className = 'cm-badge cm-badge-fav-heart';
            heart.innerHTML = ICONS.heart;
            badgesContainer.appendChild(heart);
        }
    } else {
        if (heart) {
            heart.remove();
        }
    }
}


function createCard(char, isDup) {
    const card = doc.createElement('div');
    card.className = 'cm-card' + (isDup ? ' cm-dup' : '');
    card.dataset.file = char.fileName;
    card.dataset.index = state.characters.indexOf(char);

    // 检测是否为当前聊天角色卡
    const currentChatChar = getCurrentChatChar();
    if (currentChatChar && currentChatChar.fileName === char.fileName) {
        card.classList.add('cm-current');
    }

    // 检测是否为收藏卡
    if (char.fav) {
        card.classList.add('cm-favorite');
    }

    const charTags = getCharTags(char.fileName);
    
    // 调用统一封面判定逻辑
    const coverResult = resolveListPageCoverDisplay(charTags);
    
    let tagsHtml = '';
    if (charTags.length > 0) {
        tagsHtml = '<div class="cm-card-tags">';
        const maxVisible = charTags.length > 4 ? 3 : charTags.length;
        charTags.slice(0, maxVisible).forEach(t => {
            tagsHtml += '<span class="cm-card-tag" style="background:' + (t.color || '#666') + '">' + escapeHtml(truncate(t.name, 4)) + '</span>';
        });
        if (charTags.length > 4) {
            tagsHtml += '<span class="cm-card-tag-more">+' + (charTags.length - 3) + '</span>';
        }
        tagsHtml += '</div>';
    }

    const isSel = state.selectedCards.has(char.fileName);
    if (isSel) card.classList.add('cm-sel');

    // 收藏桃心标识（仅对已收藏角色显示，位于右上角徽章区域内部）
    let favoriteHeart = '';
    if (char.fav) {
        favoriteHeart = '<span class="cm-badge cm-badge-fav-heart">' + ICONS.heart + '</span>';
    }

    let badgesHtml = '<div class="cm-top-right-badges">';
    if (isDup) badgesHtml += '<span class="cm-badge cm-badge-dup">重复</span>';
    if (char.version) badgesHtml += '<span class="cm-badge cm-badge-ver">v' + escapeHtml(char.version) + '</span>';
    badgesHtml += favoriteHeart; // 桃心放在徽章区域内部
    badgesHtml += '</div>';

    let countBadge = '<span class="cm-badge cm-badge-count">💬 ' + char.greetings + '</span>';

    const tokenCount = char.tokens || 0;
    let tokenBadge = '';
    if (tokenCount > 0 && state.settings.showTokenBadge) {
        let colors = '';
        if (tokenCount > 20000) colors = 'color:#fca5a5;border-color:rgba(239,68,68,0.5);background:rgba(127,29,29,0.8)';
        else if (tokenCount > 5000) colors = 'color:#fde047;border-color:rgba(234,179,8,0.5);background:rgba(113,63,18,0.8)';
        else colors = 'color:#86efac;border-color:rgba(34,197,94,0.5);background:rgba(20,83,45,0.8)';

        tokenBadge = '<div class="cm-token-badge" style="display:inline-block; border: 1px solid; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: bold; ' + colors + '">' +
            '🪙 <span class="text-neon">' + tokenCount + '</span> T' +
            '</div>';
    }

    // 画廊数量徽章 (仅当数量>0时显示)
    const galleryCount = char.galleryCount || 0;
    let galleryBadge = '';
    if (galleryCount > 0 && state.settings.showGalleryBadge) {
        galleryBadge = '<div class="cm-gallery-badge-card" style="display:inline-block; border: 1px solid; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: bold; color:#a5b4fc;border-color:rgba(129,140,248,0.5);background:rgba(49,46,129,0.85)">' +
            '🖼️ <span class="text-neon">' + galleryCount + '</span>' +
            '</div>';
    }

    let authorHtml = '';
    if (state.settings.showAuthor && char.creator) {
        authorHtml = '<div class="cm-author" style="font-size:10px;opacity:0.7;margin-top:2px">by ' + escapeHtml(truncate(char.creator, 20)) + '</div>';
    }

    // 根据封面判定结果构建封面区域 HTML
    let coverHtml = '';
    const displayMode = coverResult.displayMode;
    
    if (displayMode === 'no-image') {
        // 无图模式：纯黑背景 + 居中角色名称
        coverHtml = '<div class="cm-card-no-image">' +
            '<div class="cm-card-no-image-name">' + escapeHtml(char.name) + '</div>' +
            '</div>';
    } else if (displayMode === 'blur') {
        // 模糊模式：图片保留但模糊处理
        coverHtml = '<img class="cm-card-img cm-card-img-blur" src="' + char.avatarUrl + '" loading="lazy">';
    } else {
        // 正常模式：原图展示
        coverHtml = '<img class="cm-card-img" src="' + char.avatarUrl + '" loading="lazy">';
    }

    card.innerHTML =
        coverHtml +
        '<div class="cm-card-overlay-bottom"></div>' +
        '<div class="cm-card-content">' +
        '<div class="cm-card-badges-top-left">' +
        countBadge +
        tokenBadge +
        galleryBadge +
        '</div>' +
        badgesHtml +

        '<div class="cm-card-actions">' +
        '<button class="cm-action-btn cm-fav ' + (char.fav ? 'active' : '') + '" title="收藏">' + ICONS.star + '</button>' +
        '<button class="cm-action-btn cm-backup" title="下载">' + ICONS.download + '</button>' +
        '<button class="cm-action-btn cm-del" title="删除">' + ICONS.trash + '</button>' +
        '</div>' +
        '<div class="cm-card-info">' +
        tagsHtml +
        '<div class="cm-name" title="' + escapeHtml(char.name) + '">' + escapeHtml(char.name) + '</div>' +
        '<div class="cm-note">' + escapeHtml(truncate(char.creatorcomment, 20)) + '</div>' +
        authorHtml +
        '</div>' +
        '</div>';

    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let isDragging = false;

    const toggleCard = (forceState = null) => {
        const curr = state.selectedCards.has(char.fileName);
        const next = forceState !== null ? forceState : !curr;
        if (next) state.selectedCards.add(char.fileName);
        else state.selectedCards.delete(char.fileName);
        card.classList.toggle('cm-sel', next);
        updateBatchBar();
    };

    const startHandler = (e) => {
        // 检查是否点击了按钮（包括按钮内部的 SVG 等元素）
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        if (e.button === 2) return;

        // 防止触摸设备上的重复触发 (Touch -> Mouse)
        if (e.type === 'mousedown' && Date.now() - lastTouchTime < 500) {
            return;
        }

        isDragging = false;
        if (e.type === 'touchstart') {
            lastTouchTime = Date.now();
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            state.isTouchSelecting = false;
        } else {
            startX = e.clientX;
            startY = e.clientY;
        }

        card.style.transform = 'scale(0.96)';
        pressTimer = setTimeout(() => {
            state.isTouchSelecting = true;
            card.style.transform = 'scale(1)';
            card.dataset.ignoreClick = 'true';
            card.classList.add('pressing');
            if (navigator.vibrate) navigator.vibrate(50);
            toggleCard(true);
        }, 500);
    };

    const moveHandler = (e) => {
        const x = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
        const y = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

        if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) {
            isDragging = true;
            clearTimeout(pressTimer);
            card.style.transform = 'scale(1)';
            card.classList.remove('pressing');
        }

        if (state.isTouchSelecting && (e.type === 'touchmove' || (e.type === 'mousemove' && e.buttons === 1))) {
            if (e.type === 'touchmove') e.preventDefault();
            const target = doc.elementFromPoint(x, y);
            const targetCard = target ? target.closest('.cm-card') : null;
            if (targetCard && targetCard.dataset.file) {
                const fName = targetCard.dataset.file;
                if (!state.selectedCards.has(fName)) {
                    state.selectedCards.add(fName);
                    targetCard.classList.add('cm-sel');
                    updateBatchBar();
                    if (navigator.vibrate) navigator.vibrate(10);
                }
            }
        }
    };

    const endHandler = (e) => {
        // 检查是否点击了按钮（包括按钮内部的 SVG 等元素）
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
        // 交给 body.onclick 处理 Shift/Ctrl/Meta 组合键
        if (e.shiftKey || e.ctrlKey || e.metaKey) return;

        // 更新最后触摸时间，防止长按（>500ms）后的模拟鼠标事件穿透防抖检查
        if (e.type === 'touchend') {
            lastTouchTime = Date.now();
        }

        // 防止触摸设备上的重复触发
        if (e.type === 'mouseup' && Date.now() - lastTouchTime < 500) {
            return;
        }

        clearTimeout(pressTimer);
        card.style.transform = 'scale(1)';
        card.classList.remove('pressing');

        if (!isDragging && !state.isTouchSelecting) {
            // 标记此次点击已被处理，防止 body.onclick 再次触发导致状态反转
            card.dataset.ignoreClick = 'true';

            if (state.selectedCards.size > 0) {
                toggleCard();
            } else {
                new CharacterDetails(char).show();
            }
        }

        state.isTouchSelecting = false;
    };

    card.addEventListener('touchstart', startHandler, { passive: false });
    card.addEventListener('touchmove', moveHandler, { passive: false });
    card.addEventListener('touchend', endHandler);
    card.addEventListener('mousedown', startHandler);
    card.addEventListener('mousemove', moveHandler);
    card.addEventListener('mouseup', endHandler);
    card.addEventListener('mouseleave', () => {
        clearTimeout(pressTimer);
        card.style.transform = 'scale(1)';
        card.classList.remove('pressing');
    });

    return card;
}

function renderAll() {
    const body = doc.getElementById('cmBody');
    if (!body) return;
    body.innerHTML = '';

    state.filteredList = filterAndSortChars(state.characters);
    state.renderedCount = 0;

    if (!state.filteredList.length) {
        if (state.characters.length === 0) {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--cm-text-sec)">📂 点击刷新开始</div>';
        } else {
            body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--cm-text-sec)">无搜索结果</div>';
        }
        return;
    }

    const grid = doc.createElement('div');
    grid.className = 'cm-grid';
    body.appendChild(grid);

    appendBatch(grid);
    setupInfiniteScroll(grid);
}

function renderFavorites() {
    const body = doc.getElementById('cmBody');
    if (!body) return;
    body.innerHTML = '';

    state.filteredList = filterAndSortChars(getFavChars());
    state.renderedCount = 0;

    if (!state.filteredList.length) { body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--cm-text-sec)">没有收藏的角色<br><small>在卡片上点击星星收藏</small></div>'; return; }
    body.innerHTML = '<div class="cm-tag-view-header"><h3>' + ICONS.star + ' 收藏夹</h3><span>' + state.filteredList.length + ' 个</span></div>';
    const grid = doc.createElement('div');
    grid.className = 'cm-grid';
    body.appendChild(grid);

    appendBatch(grid);
    setupInfiniteScroll(grid);
}

function renderDuplicates() {
    findDuplicates(); // 重新计算重复组，以确保改名后能即时反映
    const body = doc.getElementById('cmBody');
    if (!body) return;
    body.innerHTML = '';
    if (!state.duplicateGroups.length) { body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--cm-text-sec)">✅ 没有重复</div>'; return; }
    let groups = state.duplicateGroups;
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        groups = groups.filter(g => g.coreName.toLowerCase().includes(q) || g.characters.some(c => c.name.toLowerCase().includes(q)));
    }
    if (!groups.length) { body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--cm-text-sec)">无搜索结果</div>'; return; }
    // 提示信息
    body.insertAdjacentHTML('beforeend', '<div style="text-align:center;padding:8px 16px;color:var(--cm-text-sec);font-size:12px;opacity:0.8">💡 通过「批量重命名」给重复卡添加不同的名称后缀即可消除重复</div>');
    groups.forEach(group => {
        const div = doc.createElement('div');
        div.className = 'cm-group';

        const header = doc.createElement('div');
        header.className = 'cm-group-header';
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:center';

        const titleDiv = doc.createElement('div');
        titleDiv.innerHTML = '<span>' + ICONS.dupe + ' ' + escapeHtml(group.coreName) + '</span> <span>(' + group.count + ')</span>';
        
        const btn = doc.createElement('button');
        btn.className = 'cm-btn cm-btn-sm';
        btn.innerHTML = ICONS.pencil + ' 批量重命名';
        btn.style.marginLeft = '10px';
        btn.style.whiteSpace = 'nowrap';
        btn.style.flexShrink = '0';
        btn.style.width = 'auto';
        btn.style.height = '28px';
        btn.style.fontSize = '12px';
        btn.style.padding = '0 10px';
        btn.onclick = () => showBatchRenameDialog(group);

        header.appendChild(titleDiv);
        header.appendChild(btn);
        div.appendChild(header);

        const grid = doc.createElement('div');
        grid.className = 'cm-grid';
        group.characters.forEach(char => grid.appendChild(createCard(char, true)));
        div.appendChild(grid);
        body.appendChild(div);
    });
    body.insertAdjacentHTML('beforeend', '<div style="height:60px"></div>');
}

function renderByTag() {
    const body = doc.getElementById('cmBody');
    if (!body) return;
    body.innerHTML = '';
    let title;
    let currentTagObj = null;

    if (state.currentTag === null) {
        state.filteredList = getUntaggedChars();
        title = '📂 未分类';
    } else {
        state.filteredList = getCharsByTag(state.currentTag);
        currentTagObj = state.tags.find(t => t.id === state.currentTag);
        title = '🏷️ ' + (currentTagObj ? currentTagObj.name : '未知');
    }

    state.filteredList = filterAndSortChars(state.filteredList);
    state.renderedCount = 0;

    if (state.currentTag !== null && currentTagObj) {
        const header = doc.createElement('div');
        header.className = 'cm-tag-view-header editable';
        header.id = 'cmTagHeader';
        header.title = '点击编辑标签';
        header.innerHTML =
            '<div style="display:flex;align-items:center;gap:10px">' +
            '<span class="cm-tag-color-big" style="background:' + (currentTagObj.color || '#666') + '"></span>' +
            '<h3>' + escapeHtml(currentTagObj.name) + '</h3>' +
            '<span class="cm-tag-edit-hint">' + ICONS.pencil + '</span>' +
            '</div>' +
            '<span>' + state.filteredList.length + ' 个</span>';

        header.onclick = function () {
            showTagEditor(currentTagObj);
        };
        body.appendChild(header);
    } else {
        const header = doc.createElement('div');
        header.className = 'cm-tag-view-header';
        header.innerHTML = '<h3>' + escapeHtml(title) + '</h3><span>' + state.filteredList.length + ' 个</span>';
        body.appendChild(header);
    }

    if (!state.filteredList.length) {
        body.insertAdjacentHTML('beforeend', '<div style="text-align:center;padding:40px;color:var(--cm-text-sec)">没有找到角色</div>');
        return;
    }

    const grid = doc.createElement('div');
    grid.className = 'cm-grid';
    body.appendChild(grid);

    appendBatch(grid);
    setupInfiniteScroll(grid);
}

function showColorSelectionDialog(callback) {
    let colorsHtml = '';
    COLORS.forEach(c => {
        colorsHtml += '<div class="cm-color-option" data-color="' + c.value + '" style="background:' + c.value + '"></div>';
    });

    createBaseDialog(
        '选择颜色',
        '<div class="cm-color-picker">' + colorsHtml + '</div>',
        [],
        (ov, close) => {
            ov.querySelectorAll('.cm-color-option').forEach(opt => {
                opt.onclick = function () {
                    const color = this.dataset.color;
                    if (callback) callback(color);
                    close();
                };
            });
        }
    );
}

function renderTagManager() {
    const body = doc.getElementById('cmBody');
    if (!body) return;
    const isBatch = state.tagBatchMode;

    let toolbarHtml = '';
    if (isBatch) {
        toolbarHtml =
            '<div style="display:flex;gap:4px;align-items:center">' +
            '<button class="cm-btn cm-btn-secondary" id="cmTagSelectAll" style="padding:4px 8px;font-size:12px">全选</button>' +
            '<button class="cm-btn cm-btn-secondary" id="cmTagBatchColor" style="padding:4px 8px;font-size:12px">🎨</button>' +
            '<button class="cm-btn cm-btn-danger" id="cmTagBatchDel" style="padding:4px 8px;font-size:12px">' + ICONS.trash + '</button>' +
            '<button class="cm-btn cm-btn-secondary" id="cmTagBatchCancel" style="padding:4px 8px;font-size:12px">取消</button>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--cm-text-sec);margin-top:4px" id="cmTagSelectCount">已选: 0</div>';
    } else {
        toolbarHtml =
            '<div style="display:flex;gap:4px;align-items:center;height:26px">' +
            '<div class="cm-select-wrap">' + ICONS.sortList +
            '<select class="cm-select-input" id="cmTagSortSelect">' +
            '<option value="name">名称</option>' +
            '<option value="count">数量</option>' +
            '<option value="color">颜色</option>' +
            '</select></div>' +
            '<button class="cm-btn cm-btn-secondary cm-btn-sm-tag" id="cmTagClearEmpty" title="清除空标签">🧹</button>' +
            '<button class="cm-btn cm-btn-secondary cm-btn-sm-tag" id="cmTagBatchStart">批量</button>' +
            '<button class="cm-btn cm-btn-primary cm-btn-sm-tag" id="cmAddTagBtn">新建</button>' +
            '</div>';
    }

    let html = '<div class="cm-tag-manager">' +
        '<div class="cm-tag-manager-header" style="display:block">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;height:32px">' +
        '<h3 style="margin:0">' + ICONS.settings + ' 标签管理</h3>' +
        '<div style="text-align:right">' + toolbarHtml + '</div>' +
        '</div>' +
        '<div class="cm-search-wrap" style="margin:0">' +
        '<span class="cm-search-icon">' + ICONS.search + '</span>' +
        '<input type="text" class="cm-search-input" id="cmTagSearchInput" placeholder="搜索标签..." value="' + escapeHtml(state.tagSearchQuery) + '">' +
        '</div>' +
        '</div>' +
        '<div class="cm-tag-manager-list">';

    let filteredTags = sortTags([...state.tags]);
    if (state.tagSearchQuery) {
        const q = state.tagSearchQuery.toLowerCase();
        filteredTags = filteredTags.filter(t => t.name.toLowerCase().includes(q));
    }

    if (filteredTags.length === 0) {
        html += '<div class="cm-tag-empty">没有找到标签</div>';
    } else {
        filteredTags.forEach(tag => {
            const count = getTagCharCount(tag.id);
            const cbHtml = isBatch ? '<input type="checkbox" class="cm-tag-cb" style="margin-right:10px">' : '';
            const actionsStyle = isBatch ? 'style="display:none"' : '';
            const pinClass = tag.pinned ? 'active' : '';
            const pinStyle = tag.pinned ? 'color:#2563eb' : 'color:var(--cm-text-sec)';

            html += '<div class="cm-tag-manager-item" data-id="' + tag.id + '">' +
                cbHtml +
                '<div class="cm-tag-manager-info"><span class="cm-tag-color-big" style="background:' + (tag.color || '#666') + '"></span><span class="cm-tag-manager-name">' + escapeHtml(tag.name) + '</span><span class="cm-tag-manager-count">' + count + ' 个</span></div>' +
                '<div class="cm-tag-manager-actions" ' + actionsStyle + '>' +
                '<button class="cm-btn cm-btn-secondary cm-tag-pin ' + pinClass + '" style="' + pinStyle + '">' + ICONS.pinReal + '</button>' +
                '<button class="cm-btn cm-btn-secondary cm-tag-edit">' + ICONS.pencil + '</button>' +
                '<button class="cm-btn cm-btn-danger cm-tag-delete">' + ICONS.trash + '</button>' +
                '</div>' +
                '</div>';
        });
    }
    html += '<div style="height:60px"></div></div></div>';
    body.innerHTML = html;

    const searchInput = body.querySelector('#cmTagSearchInput');
    if (searchInput) {
        searchInput.oninput = function () {
            state.tagSearchQuery = this.value.trim();
            renderTagManager();
            const newInput = doc.getElementById('cmTagSearchInput');
            if (newInput) {
                newInput.focus();
                newInput.setSelectionRange(newInput.value.length, newInput.value.length);
            }
        };
    }

    if (!isBatch) {
        const addBtn = body.querySelector('#cmAddTagBtn');
        if (addBtn) addBtn.onclick = function () { showTagEditor(null); };

        const startBatchBtn = body.querySelector('#cmTagBatchStart');
        if (startBatchBtn) startBatchBtn.onclick = function () { state.tagBatchMode = true; renderTagManager(); };

        const clearEmptyBtn = body.querySelector('#cmTagClearEmpty');
        if (clearEmptyBtn) clearEmptyBtn.onclick = async function () {
            const emptyTags = state.tags.filter(t => getTagCharCount(t.id) === 0);
            if (emptyTags.length === 0) {
                notify('没有空标签', 'info');
                return;
            }
            if (await showConfirm(`确定要清除 ${emptyTags.length} 个空标签吗？`)) {
                emptyTags.forEach(t => deleteTag(t.id, true));
                renderTagManager();
                renderTagSidebar();
                notify(`已清除 ${emptyTags.length} 个空标签`, 'success');
            }
        };

        const sortSel = body.querySelector('#cmTagSortSelect');
        if (sortSel) {
            sortSel.value = state.tagSortMode;
            sortSel.onchange = function () {
                state.tagSortMode = this.value;
                renderTagManager();
                renderTagSidebar();
            };
        }

        body.querySelectorAll('.cm-tag-pin').forEach(btn => {
            btn.onclick = function (e) {
                e.stopPropagation();
                const tagId = this.closest('.cm-tag-manager-item').dataset.id;
                toggleTagPin(tagId);
            };
        });

        body.querySelectorAll('.cm-tag-edit').forEach(btn => {
            btn.onclick = function (e) {
                e.stopPropagation();
                const tagId = this.closest('.cm-tag-manager-item').dataset.id;
                const tag = state.tags.find(t => t.id === tagId);
                if (tag) showTagEditor(tag);
            };
        });
        body.querySelectorAll('.cm-tag-delete').forEach(btn => {
            btn.onclick = function (e) {
                e.stopPropagation();
                const item = this.closest('.cm-tag-manager-item');
                const tagId = item.dataset.id;
                const tag = state.tags.find(t => t.id === tagId);
                const count = getTagCharCount(tagId);
                if (!confirm('确定删除标签 "' + tag.name + '"？' + (count > 0 ? '\n该标签已关联 ' + count + ' 个角色' : ''))) return;
                deleteTag(tagId);
                renderTagManager();
                renderTagSidebar();
                notify('标签已删除', 'success');
            };
        });
    } else {
        const updateCount = () => {
            const c = body.querySelectorAll('.cm-tag-cb:checked').length;
            const el = doc.getElementById('cmTagSelectCount');
            if (el) el.textContent = '已选: ' + c;
        };

        body.querySelectorAll('.cm-tag-cb').forEach(cb => {
            cb.onchange = updateCount;
            cb.onclick = (e) => e.stopPropagation();
        });

        body.querySelector('#cmTagBatchCancel').onclick = function () {
            state.tagBatchMode = false;
            renderTagManager();
        };

        body.querySelector('#cmTagSelectAll').onclick = function () {
            const cbs = body.querySelectorAll('.cm-tag-cb');
            const allChecked = Array.from(cbs).every(c => c.checked);
            cbs.forEach(c => c.checked = !allChecked);
            updateCount();
        };

        body.querySelector('#cmTagBatchDel').onclick = async function () {
            const checked = Array.from(body.querySelectorAll('.cm-tag-cb:checked'));
            if (checked.length === 0) { notify('请先选择标签', 'warning'); return; }
            const doDel = await showConfirm('确定删除选中的 ' + checked.length + ' 个标签？');
            if (!doDel) return;
            checked.forEach(cb => {
                const item = cb.closest('.cm-tag-manager-item');
                if (item) deleteTag(item.dataset.id, true);
            });
            state.tagBatchMode = false;
            renderTagManager();
            renderTagSidebar();
            notify('批量删除成功', 'success');
        };

        body.querySelector('#cmTagBatchColor').onclick = function () {
            const checked = Array.from(body.querySelectorAll('.cm-tag-cb:checked'));
            if (checked.length === 0) { notify('请先选择标签', 'warning'); return; }

            showColorSelectionDialog((color) => {
                checked.forEach(cb => {
                    const item = cb.closest('.cm-tag-manager-item');
                    if (item) {
                        const tagId = item.dataset.id;
                        const tag = state.tags.find(t => t.id === tagId);
                        if (tag) tag.color = color;
                    }
                });
                saveTags();
                state.tagBatchMode = false;
                renderTagManager();
                renderTagSidebar();
                notify('已修改 ' + checked.length + ' 个标签的颜色', 'success');
            });
        };
    }

    body.querySelectorAll('.cm-tag-manager-info').forEach(div => {
        div.style.cursor = 'pointer';
        div.onclick = function (e) {
            if (state.tagBatchMode) {
                const cb = this.parentElement.querySelector('.cm-tag-cb');
                if (cb) {
                    cb.checked = !cb.checked;
                    const evt = new Event('change');
                    cb.dispatchEvent(evt);
                }
            } else {
                const tagId = this.parentElement.dataset.id;
                state.currentView = 'tags';
                state.currentTag = tagId;
                renderView();
                renderTagSidebar();
            }
        };
    });
}


function showTagEditor(tag) {
    const isEdit = !!tag;
    const currentName = tag ? tag.name : '';
    const currentColor = tag ? (tag.color || COLORS[0].value) : COLORS[0].value;
    let selectedColor = currentColor;

    let colorsHtml = '';
    COLORS.forEach(c => {
        colorsHtml += '<div class="cm-color-option' + (c.value === currentColor ? ' selected' : '') + '" data-color="' + c.value + '" style="background:' + c.value + '"></div>';
    });

    const content =
        '<div class="cm-form-group"><label>标签名称</label><input type="text" class="cm-input" id="cmTagName" value="' + escapeHtml(currentName) + '" placeholder="输入标签名称"></div>' +
        '<div class="cm-form-group"><label>选择颜色</label><div class="cm-color-picker">' + colorsHtml + '</div></div>' +
        '<div class="cm-form-group"><label>预览</label><div class="cm-tag-preview"><span class="cm-tag-preview-tag" id="cmTagPreview" style="background:' + currentColor + '">' + escapeHtml(currentName || '标签名称') + '</span></div></div>';

    const buttons = [];
    if (isEdit) {
        buttons.push({
            text: '删除', id: 'cmTagDel', cls: 'cm-btn-danger', onClick: (ov, close) => {
                const count = getTagCharCount(tag.id);
                showConfirm('确定删除标签 "' + tag.name + '"？' + (count > 0 ? '\n该标签已关联 ' + count + ' 个角色' : '')).then(doDel => {
                    if (doDel) {
                        deleteTag(tag.id);
                        if (state.currentTag === tag.id) { state.currentView = 'all'; state.currentTag = null; }
                        renderTagManager(); renderTagSidebar(); renderView(); notify('标签已删除', 'success');
                        close();
                    }
                });
            }
        });
    }
    buttons.push({ text: '取消', id: 'cmTagCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => close() });
    buttons.push({
        text: isEdit ? '保存' : '创建', id: 'cmTagSave', cls: 'cm-btn-primary', onClick: (ov, close) => {
            const nameInput = ov.querySelector('#cmTagName');
            const name = nameInput.value.trim();
            if (!name) { notify('请输入标签名称', 'warning'); nameInput.focus(); return; }
            if (isEdit) { updateTag(tag.id, name, selectedColor); notify('标签已更新', 'success'); }
            else { createTag(name, selectedColor); notify('标签已创建', 'success'); }
            renderTagManager(); renderTagSidebar(); renderView();
            close();
        }
    });

    createBaseDialog(
        isEdit ? '编辑标签' : '新建标签',
        content,
        buttons,
        (ov) => {
            ov.querySelectorAll('.cm-color-option').forEach(opt => {
                opt.onclick = function () {
                    ov.querySelectorAll('.cm-color-option').forEach(o => o.classList.remove('selected'));
                    this.classList.add('selected');
                    selectedColor = this.dataset.color;
                    ov.querySelector('#cmTagPreview').style.background = selectedColor;
                };
            });
            const nameInput = ov.querySelector('#cmTagName');
            nameInput.oninput = function () {
                ov.querySelector('#cmTagPreview').textContent = this.value || '标签名称';
            };
            nameInput.focus();
        }
    );
}

/**
 * 批量 AI 生成标签
 * @param {string} mode - 'serial' | 'batch'
 * @param {number} tokenLimit - Token 上限
 * @param {{tags: boolean, summary: boolean}} overwriteOptions - 覆盖选项对象
 * @param {string} generateMode - 生成模式：'both' | 'summary' | 'tags'
 */
async function batchAIGenerateTags(mode = 'serial', tokenLimit = 4096, overwriteOptions = { tags: false, summary: false }, generateMode = 'both') {
    const selectedAvatars = Array.from(state.selectedCards);
    const characters = state.characters.filter(c =>
        selectedAvatars.includes(c.fileName || c.avatar)
    );
    
    // 根据 generateMode 和 overwriteOptions 决定目标角色
    let targetChars;
    targetChars = characters.filter(c => {
        const cm = getCmManager(c);
        
        // 检查标签状态
        const hasTags = cm.tags && cm.tags.length > 0 && !(cm.tags.length === 1 && cm.tags[0] === '');
        
        // 检查概览状态
        const hasSummary = cm.summary && cm.summary.trim() !== '';
        
        // 根据生成模式和覆盖选项判断是否需要处理
        switch (generateMode) {
            case 'tags':
                return overwriteOptions.tags || !hasTags;
            case 'summary':
                return overwriteOptions.summary || !hasSummary;
            case 'both':
            default:
                // 需要生成标签或概览
                const needTags = overwriteOptions.tags || !hasTags;
                const needSummary = overwriteOptions.summary || !hasSummary;
                return needTags || needSummary;
        }
    });
    
    if (targetChars.length === 0) {
        // 根据 generateMode 显示对应的提示信息
        let noTargetMsg;
        switch (generateMode) {
            case 'tags':
                noTargetMsg = overwriteOptions.tags ? '请先选择角色' : '所有选中角色已有标签，无需生成';
                break;
            case 'summary':
                noTargetMsg = overwriteOptions.summary ? '请先选择角色' : '所有选中角色已有概览，无需生成';
                break;
            case 'both':
            default:
                noTargetMsg = (overwriteOptions.tags && overwriteOptions.summary) ? '请先选择角色' : '所有选中角色已有标签和概览，无需生成';
                break;
        }
        notify(noTargetMsg, 'info');
        return;
    }
    
    // 计算跳过数量：根据 generateMode 判断跳过的是哪些角色
    let skippedCount = 0;
    if (generateMode === 'tags' && !overwriteOptions.tags) {
        skippedCount = characters.filter(c => {
            const cm = getCmManager(c);
            return cm.tags && cm.tags.length > 0 && !(cm.tags.length === 1 && cm.tags[0] === '');
        }).length;
    } else if (generateMode === 'summary' && !overwriteOptions.summary) {
        skippedCount = characters.filter(c => {
            const cm = getCmManager(c);
            return cm.summary && cm.summary.trim() !== '';
        }).length;
    } else if (generateMode === 'both') {
        // both 模式下，计算有多少角色被完全跳过（不需要任何生成）
        // 只有当角色已有概览且不覆盖概览，且已有标签且不覆盖标签时，才完全跳过
        skippedCount = characters.filter(c => {
            const cm = getCmManager(c);
            const hasTags = cm.tags && cm.tags.length > 0 && !(cm.tags.length === 1 && cm.tags[0] === '');
            const hasSummary = cm.summary && cm.summary.trim() !== '';
            // 如果不覆盖概览且已有概览，且不覆盖标签且已有标签，则完全跳过
            return (!overwriteOptions.summary && hasSummary) && (!overwriteOptions.tags && hasTags);
        }).length;
    }
    
    const modeText = mode === 'serial' ? '逐个处理' : `批量处理（Token 上限：${tokenLimit}）`;
    
    // 根据 generateMode 构建确认消息
    let generateText = '';
    let skipText = '';
    switch (generateMode) {
        case 'tags':
            generateText = '标签';
            skipText = skippedCount > 0 ? `（跳过 ${skippedCount} 个已有标签的角色）` : '';
            break;
        case 'summary':
            generateText = '概览';
            skipText = skippedCount > 0 ? `（跳过 ${skippedCount} 个已有概览的角色）` : '';
            break;
        case 'both':
        default:
            generateText = '概览和标签';
            skipText = skippedCount > 0 ? `（跳过 ${skippedCount} 个已有概览和标签的角色）` : '';
            break;
    }
    
    const confirmMsg = `将对 ${targetChars.length} 个角色生成 AI ${generateText}${skipText}\n\n模式：${modeText}${overwriteOptions.tags ? '\n⚠️ 将覆盖已有标签' : ''}${overwriteOptions.summary ? '\n⚠️ 将覆盖已有概览' : ''}`;
    
    const confirmed = await showConfirm(confirmMsg);
    
    if (!confirmed) return;
    
    let success = 0, errors = 0;
    const total = targetChars.length;
    let cancelled = false;
    // 收集详细信息用于结果弹窗
    let details = [];
    
    // 显示进度条（带取消按钮和回调）
    showProgressBar('准备开始批量处理...', () => {
        cancelled = true;
        hideProgressBar();
        notify('批量处理已取消', 'info');
    });
    
    try {
        const { generateAIOverview, generateBatchOverview } = await import('./ai-overview/ai-service.js');
        const { showBatchResultModal } = await import('./ui-utils.js');
        
        // 低内存优化：在发送给 AI 前回源获取缺失的完整数据
        for (let i = 0; i < targetChars.length; i++) {
            if (cancelled) break;
            const char = targetChars[i];
            if (!char.data || char.data.description === undefined) {
                updateProgressBar(
                    0,
                    `正在读取角色卡：${char.name} (${i + 1}/${total})`,
                    ''
                );
                try {
                    const r = await authFetch('/api/characters/get', {
                        method: 'POST',
                        body: JSON.stringify({ avatar_url: char.fileName || char.avatar })
                    });
                    if (r.ok) {
                        const fullData = await r.json();
                        if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
                            Object.assign(char, { data: fullData.data });
                        } else {
                            Object.assign(char, fullData);
                        }
                    }
                } catch (e) {
                    console.warn('[CharManager] 批量生成 AI 概览前回源数据失败:', char.fileName, e);
                }
            }
        }

        let result = { success: 0, errors: 0, batchInfo: { total: 0, failed: 0 } };
        
        if (mode === 'serial') {
            // 逐个处理模式
            for (let i = 0; i < targetChars.length; i++) {
                if (cancelled) break;
                
                const char = targetChars[i];
                updateProgressBar(
                    Math.round((i / total) * 100),
                    `正在处理：${char.name} (${i + 1}/${total})`,
                    `成功：${success} | 失败：${errors}`
                );
                
                try {
                    // overwriteOptions.tags=true 时强制生成标签
                    await generateAIOverview(char, overwriteOptions.tags, overwriteOptions.summary, generateMode);
                    success++;
                    details.push({ name: char.name, success: true });
                    notify(`✅ ${char.name}: 生成成功`, 'success', 1500);
                } catch (e) {
                    errors++;
                    details.push({ name: char.name, success: false, error: e.message });
                    notify(`❌ ${char.name}: ${e.message}`, 'error', 2000);
                }
                
                // 添加小延迟防止限流
                if (i < targetChars.length - 1) {
                    await new Promise(r => setTimeout(r, 800));
                }
            }
            // serial 模式下更新 result 结构
            result.success = success;
            result.errors = errors;
        } else {
            // 批量处理模式
            let processedCount = 0;
            let batchSuccess = 0;
            let batchErrors = 0;
            
            result = await generateBatchOverview(targetChars, tokenLimit, (event) => {
                if (cancelled) return;
                
                switch (event.type) {
                    case 'batch_start':
                        updateProgressBar(
                            Math.round((processedCount / total) * 100),
                            `正在处理第 ${event.batchIndex}/${event.totalBatches} 批次（共 ${total} 个角色）`,
                            `✅ 成功：${batchSuccess} | ❌ 失败：${batchErrors}`
                        );
                        break;
                        
                    case 'char_success':
                        processedCount++;
                        batchSuccess++;
                        details.push({ name: event.charName, success: true });
                        notify(`✅ ${event.charName}: 生成成功`, 'success', 1000);
                        updateProgressBar(
                            Math.round((processedCount / total) * 100),
                            `正在处理第 ${event.batchIndex}/${event.totalBatches} 批次`,
                            `✅ 成功：${batchSuccess} | ❌ 失败：${batchErrors}`
                        );
                        break;
                        
                    case 'char_error':
                        processedCount++;
                        batchErrors++;
                        details.push({ name: event.charName, success: false, error: event.error });
                        notify(`❌ ${event.charName}: ${event.error}`, 'error', 1500);
                        updateProgressBar(
                            Math.round((processedCount / total) * 100),
                            `正在处理第 ${event.batchIndex}/${event.totalBatches} 批次`,
                            `✅ 成功：${batchSuccess} | ❌ 失败：${batchErrors}`
                        );
                        break;
                        
                    case 'batch_end':
                        // 批次完成，可以在这里添加额外处理
                        break;
                        
                    default:
                        // 未知事件类型，记录警告日志
                        console.warn(`[CharManager] [AI Batch] 未知事件类型：${event.type}`);
                }
            }, overwriteOptions.tags, overwriteOptions.summary, () => cancelled, generateMode); // 传入取消检查回调和生成模式
            
            success = result.success;
            errors = result.errors;
            
            // 如果是后台取消，更新 UI 状态
            if (result.cancelled) {
                cancelled = true;
            }
        }
        
        if (!cancelled) {
            const batchInfoStr = result.batchInfo && result.batchInfo.failed > 0
                ? `（${result.batchInfo.failed} 个批次失败）`
                : '';
            updateProgressBar(100, '批量处理完成！' + batchInfoStr, `成功：${success} | 失败：${errors}`);
            
            // P1: 先关闭进度条，再显示结果弹窗，避免遮挡和交互干扰
            hideProgressBar();
            
            // 显示结果弹窗
            await showBatchResultModal({
                success,
                errors,
                details
            });
            
            // 刷新界面
            renderView();
            renderTagSidebar();
        }
    } catch (e) {
        console.error('[CharManager] [AI Batch] Error:', e);
        hideProgressBar();
        notify(`批量处理失败：${e.message}`, 'error');
    }
}

/**
 * 显示 AI 标签配置弹窗
 */
function showAITagConfigDialog() {
    if (state.selectedCards.size === 0) {
        notify('请先选择角色卡', 'warning');
        return;
    }
    
    const selectedCount = state.selectedCards.size;
    
    // 构建模型选项 HTML
    const modelOptions = AI_MODELS.map(m =>
        `<option value="${m.id}">${m.name} (${Math.round(m.tokenLimit / 1024)}K)</option>`
    ).join('');
    
    const contentHtml = `
        <div style="padding:10px">
            <div style="margin-bottom:16px;padding:12px;background:var(--cm-bg-hover);border-radius:6px">
                <div style="font-size:14px;font-weight:600;margin-bottom:4px">📊 已选择 ${selectedCount} 个角色</div>
                <div style="font-size:12px;color:var(--cm-text-sec)">AI 将为这些角色生成概览和标签</div>
            </div>
            
            <div class="cm-form-group" style="margin-bottom:12px">
                <label style="font-size:13px;font-weight:600">处理模式</label>
                <select id="cmAIModeSelect" class="cm-select-input" style="width:100%;margin-top:6px">
                    <option value="serial">🔄 逐个处理（稳定，适合少量角色）</option>
                    <option value="batch">⚡ 批量处理（快速，适合大量角色）</option>
                </select>
            </div>
            
            <div id="cmBatchModelGroup" class="cm-form-group" style="margin-bottom:12px;display:none">
                <label style="font-size:13px;font-weight:600">
                    模型选择
                    <span style="font-size:11px;color:var(--cm-text-sec);font-weight:normal;margin-left:6px">（仅影响 Token 上限判断）</span>
                </label>
                <select id="cmAIModelSelect" class="cm-select-input" style="width:100%;margin-top:6px">
                    ${modelOptions}
                </select>
            </div>
            
            <div id="cmCustomTokenGroup" class="cm-form-group" style="margin-bottom:12px;display:none">
                <label style="font-size:13px;font-weight:600">自定义 Token 上限</label>
                <input type="number" id="cmCustomTokenInput" class="cm-input" style="width:100%;margin-top:6px"
                    value="4096" min="1024" max="2000000" step="1024"
                    placeholder="输入 Token 上限">
            </div>
            
            <div class="cm-form-group" style="margin-bottom:12px">
                <label style="font-size:13px;font-weight:600">生成内容</label>
                <div class="cm-mode-toggle-group" id="cmBatchAIModeGroup" style="margin-top:6px;width:fit-content;">
                    <button class="cm-mode-toggle-btn active" data-val="both">概览+标签</button>
                    <button class="cm-mode-toggle-btn" data-val="summary">仅概览</button>
                    <button class="cm-mode-toggle-btn" data-val="tags">仅标签</button>
                </div>
                <input type="hidden" id="cmBatchGenerateMode" value="both">
            </div>

            <div class="cm-form-group" style="margin-bottom:12px">
                <label style="font-size:13px;font-weight:600;margin-bottom:8px;display:block">覆盖选项</label>
                <div style="display:flex;gap:16px;padding-left:4px">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                        <input type="checkbox" id="cmOverwriteTagsCheckbox" style="width:16px;height:16px" ${state.settings.aiOverwriteTags ? 'checked' : ''}>
                        <span style="font-size:13px">标签</span>
                    </label>
                    <label id="cmOverwriteSummaryGroup" style="display:flex;align-items:center;gap:6px;cursor:pointer">
                        <input type="checkbox" id="cmOverwriteSummaryCheckbox" style="width:16px;height:16px" ${state.settings.aiOverwriteSummary ? 'checked' : ''}>
                        <span style="font-size:13px">概览</span>
                    </label>
                </div>
            </div>
        </div>
    `;
    
    createBaseDialog('🪄 AI 概览生成', contentHtml, [
        { text: '取消', cls: 'cm-btn-secondary', onClick: (ov, close) => close() },
        { text: '开始生成', id: 'cmAIStartBtn', cls: 'cm-btn-primary', onClick: async (ov, close) => {
            const mode = ov.querySelector('#cmAIModeSelect').value;
            const overwriteTags = ov.querySelector('#cmOverwriteTagsCheckbox')?.checked || false;
            const overwriteSummary = ov.querySelector('#cmOverwriteSummaryCheckbox')?.checked || false;
            const overwriteOptions = { tags: overwriteTags, summary: overwriteSummary };
            const generateMode = ov.querySelector('#cmBatchGenerateMode').value || 'both';
            
            let tokenLimit = 4096;
            if (mode === 'batch') {
                const modelId = ov.querySelector('#cmAIModelSelect').value;
                if (modelId === 'custom') {
                    tokenLimit = parseInt(ov.querySelector('#cmCustomTokenInput').value) || 4096;
                } else {
                    tokenLimit = getModelTokenLimit(modelId);
                }
            }
            
            close();
            await batchAIGenerateTags(mode, tokenLimit, overwriteOptions, generateMode);
        }}
    ], (ov) => {
        const modeSelect = ov.querySelector('#cmAIModeSelect');
        const modelGroup = ov.querySelector('#cmBatchModelGroup');
        const customTokenGroup = ov.querySelector('#cmCustomTokenGroup');
        const modelSelect = ov.querySelector('#cmAIModelSelect');
        
        // 模式切换时显示/隐藏模型选择
        const updateModelVisibility = () => {
            const isBatch = modeSelect.value === 'batch';
            modelGroup.style.display = isBatch ? 'block' : 'none';
        };
        
        // 模型选择切换时显示/隐藏自定义输入
        const updateCustomTokenVisibility = () => {
            const isCustom = modelSelect.value === 'custom';
            customTokenGroup.style.display = isCustom ? 'block' : 'none';
        };
        
        modeSelect.onchange = updateModelVisibility;
        modelSelect.onchange = updateCustomTokenVisibility;
        
        // 初始化状态
        updateModelVisibility();
        updateCustomTokenVisibility();

        // 绑定生成模式 toggle group 事件
        const batchModeGroup = ov.querySelector('#cmBatchAIModeGroup');
        const batchModeInput = ov.querySelector('#cmBatchGenerateMode');
        if (batchModeGroup && batchModeInput) {
            batchModeGroup.querySelectorAll('.cm-mode-toggle-btn').forEach(btn => {
                btn.onclick = () => {
                    batchModeInput.value = btn.getAttribute('data-val');
                    batchModeGroup.querySelectorAll('.cm-mode-toggle-btn').forEach(b => {
                        const isActive = b.getAttribute('data-val') === batchModeInput.value;
                        b.classList.toggle('active', isActive);
                    });
                    // 直接调用，确保可见性更新
                    updateOverwriteVisibility();
                };
            });
        }

        // 覆盖选项可见性控制
        const updateOverwriteVisibility = () => {
            const generateMode = ov.querySelector('#cmBatchGenerateMode').value || 'both';
            const summaryGroup = ov.querySelector('#cmOverwriteSummaryGroup');
            if (summaryGroup) {
                summaryGroup.style.display = generateMode === 'tags' ? 'none' : 'flex';
            }
        };

        // 绑定覆盖复选框 change 事件，保存设置
        const overwriteTagsCheckbox = ov.querySelector('#cmOverwriteTagsCheckbox');
        const overwriteSummaryCheckbox = ov.querySelector('#cmOverwriteSummaryCheckbox');
        if (overwriteTagsCheckbox) {
            overwriteTagsCheckbox.onchange = () => {
                state.settings.aiOverwriteTags = overwriteTagsCheckbox.checked;
                saveSettings();
            };
        }
        if (overwriteSummaryCheckbox) {
            overwriteSummaryCheckbox.onchange = () => {
                state.settings.aiOverwriteSummary = overwriteSummaryCheckbox.checked;
                saveSettings();
            };
        }

        // 初始化覆盖选项可见性
        updateOverwriteVisibility();
    });
}

function showBatchTagDialog() {
    if (state.selectedCards.size === 0) { notify('请先选择角色', 'warning'); return; }

    const wrapper = doc.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;max-height:60vh;';

    const quickCreate = doc.createElement('div');
    quickCreate.className = 'cm-quick-create';
    quickCreate.style.cssText = 'border-bottom:none;padding:0 0 12px 0;position:relative;flex-shrink:0';
    quickCreate.innerHTML = '<input type="text" placeholder="新建标签..." class="cm-input-sm" autocomplete="off"><button class="cm-btn-sm">+</button>';

    const suggestions = doc.createElement('div');
    suggestions.className = 'cm-tag-suggestions';
    quickCreate.appendChild(suggestions);
    wrapper.appendChild(quickCreate);

    const listContainer = doc.createElement('div');
    listContainer.className = 'cm-tag-options';
    wrapper.appendChild(listContainer);

    const renderOptions = (checkedId = null) => {
        let html = '';
        const sortedTags = [...state.tags].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        sortedTags.forEach(tag => {
            const isChecked = checkedId === tag.id ? ' checked' : '';
            html += '<label class="cm-tag-option"><input type="checkbox" value="' + tag.id + '"' + isChecked + '><span class="cm-tag-color" style="background:' + (tag.color || '#666') + '"></span><span>' + escapeHtml(tag.name) + '</span></label>';
        });
        if (state.tags.length === 0) html = '<div style="color:var(--cm-text-sec);padding:10px;text-align:center">暂无标签</div>';
        listContainer.innerHTML = html;
    };

    const quickInput = quickCreate.querySelector('input');
    const quickBtn = quickCreate.querySelector('button');

    createBaseDialog(
        '批量标签',
        '',
        [
            { text: '取消', id: 'cmBatchCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => close() },
            {
                text: '移除', id: 'cmBatchRemove', cls: 'cm-btn-danger', onClick: async (ov, close) => {
                    const tagIds = Array.from(listContainer.querySelectorAll('input:checked')).map(cb => cb.value);
                    if (tagIds.length === 0) { notify('请选择标签', 'warning'); return; }
                    let count = 0;
                    for (const fileName of state.selectedCards) {
                        for (const tagId of tagIds) {
                            if (await removeTagFromChar(fileName, tagId, true)) count++;
                        }
                    }
                    renderTagSidebar(); renderView(); notify('已移除 ' + count + ' 个标签', 'success');
                    close();
                }
            },
            {
                text: '添加', id: 'cmBatchApply', cls: 'cm-btn-primary', onClick: async (ov, close) => {
                    const tagIds = Array.from(listContainer.querySelectorAll('input:checked')).map(cb => cb.value);
                    if (tagIds.length === 0) { notify('请选择标签', 'warning'); return; }
                    let count = 0;
                    for (const fileName of state.selectedCards) {
                        for (const tagId of tagIds) {
                            if (await addTagToChar(fileName, tagId, true)) count++;
                        }
                    }
                    renderTagSidebar(); renderView(); notify('已添加 ' + count + ' 个标签', 'success');
                    close();
                }
            }
        ],
        (ov) => {
            ov.querySelector('.cm-tag-editor-body').appendChild(wrapper);
            renderOptions();

            const handleCreate = (forceName) => {
                const val = (forceName || quickInput.value).trim();
                if (val) {
                    const existingTag = state.tags.find(t => t.name === val);
                    if (existingTag) {
                        renderOptions(existingTag.id);
                        notify('已选中已有标签: ' + val, 'success');
                    } else {
                        const newTag = createTag(val, DEFAULT_TAG_COLOR);
                        renderTagSidebar();
                        renderOptions(newTag.id);
                        notify('已创建标签', 'success');
                    }
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
        }
    );
}

function showBatchRenameDialog(group) {
    let listHtml = '<div class="cm-batch-list" style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:10px">';
    
    // Sort by name
    const sortedChars = [...group.characters].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    
    sortedChars.forEach(char => {
        listHtml += `
            <div class="cm-batch-item" style="display:flex;align-items:center;gap:10px;padding:5px;border:1px solid var(--cm-border);border-radius:4px">
                <img src="${char.avatarUrl}" style="width:40px;height:40px;object-fit:cover;border-radius:4px">
                <div style="flex:1">
                    <div style="font-size:10px;color:var(--cm-text-sec);margin-bottom:2px">${escapeHtml(char.fileName)}</div>
                    <input type="text" class="cm-batch-input" data-file="${escapeHtml(char.fileName)}" value="${escapeHtml(char.name)}" style="width:100%;padding:4px;border:1px solid var(--cm-border);background:var(--cm-input-bg);color:var(--cm-text);border-radius:4px">
                </div>
            </div>
        `;
    });
    listHtml += '</div>';

    createBaseDialog(
        '批量重命名: ' + group.coreName,
        listHtml,
        [
            { id: 'cmBatchCancel', text: '取消', cls: 'cm-btn-secondary' },
            { id: 'cmBatchSave', text: '保存全部', cls: 'cm-btn-primary' }
        ],
        (ov, close) => {
            ov.querySelector('#cmBatchCancel').onclick = close;
            ov.querySelector('#cmBatchSave').onclick = async () => {
                const inputs = ov.querySelectorAll('.cm-batch-input');
                let changes = [];
                inputs.forEach(input => {
                    const newName = input.value.trim();
                    const fileName = input.dataset.file;
                    const char = group.characters.find(c => c.fileName === fileName);
                    if (char && newName && newName !== char.name) {
                        changes.push({ char, newName });
                    }
                });

                if (changes.length === 0) {
                    notify('没有需要保存的更改', 'info');
                    return;
                }

                if (!await showConfirm(`确定要重命名 ${changes.length} 个角色吗？`)) return;
                
                let successCount = 0;
                for (const change of changes) {
                    try {
                        await renameCharacterFile(change.char, change.newName);
                        successCount++;
                    } catch (e) {
                        console.error(e);
                    }
                }
                
                close();
                renderView();
            };
        }
    );
}


// --- Random Pick Helpers ---

async function executeRandomPick() {
    let pool = [];
    const mode = state.randomMode || 'all';

    if (mode === 'current') {
        pool = state.filteredList || state.characters;
    } else {
        pool = state.characters;
    }

    if (pool.length === 0) return notify('当前列表为空', 'warning');

    const dice = doc.getElementById('cmRandomDice');
    if (dice) {
        dice.style.transition = 'transform 0.5s';
        dice.style.transform = 'translateY(-50%) rotate(360deg)';
        setTimeout(() => dice.style.transform = 'translateY(-50%)', 500);
    }

    if (mode === 'no_chat') {
        notify('正在寻找未对话过的角色...', 'info');
        for (let i = 0; i < 50; i++) {
            const char = pool[Math.floor(Math.random() * pool.length)];
            const count = await getCharHistoryCount(char);
            if (count === 0) {
                showDetail(char);
                return;
            }
        }
        notify('未找到无聊天记录的角色 (已尝试50次)', 'warning');
    } else {
        const char = pool[Math.floor(Math.random() * pool.length)];
        showDetail(char);
    }
}

function showRandomModeMenu(targetBtn) {
    const existing = doc.querySelector('.cm-random-menu');
    if (existing) { existing.remove(); return; }

    const rect = targetBtn.getBoundingClientRect();
    const menu = doc.createElement('div');
    menu.className = 'cm-random-menu ' + (state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light');
    menu.style.cssText = 'position:fixed;top:' + (rect.bottom + 5) + 'px;left:' + (rect.left - 100) + 'px;background:var(--cm-bg-sec);border:1px solid var(--cm-border);border-radius:8px;z-index:' + Z_INDEX.MODAL_DROPDOWN + ';padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.2);'; /* 弹窗级: 下拉菜单 */

    if (parseInt(menu.style.left) < 10) menu.style.left = '10px';

    const modes = [
        { k: 'all', t: '🎲 所有角色' },
        { k: 'current', t: '📂 当前分类' },
        { k: 'no_chat', t: '💬 没聊过天' }
    ];

    modes.forEach(m => {
        const item = doc.createElement('div');
        item.style.cssText = 'padding:8px 16px;cursor:pointer;font-size:13px;color:var(--cm-text);transition:background 0.2s;';
        if (state.randomMode === m.k) {
            item.style.background = 'var(--cm-hover)';
            item.style.fontWeight = 'bold';
        }
        item.textContent = m.t;
        item.onclick = () => {
            state.randomMode = m.k;
            localStorage.setItem('cm_random_mode', m.k);
            notify('随机模式: ' + m.t, 'success');
            menu.remove();
        };
        item.onmouseenter = () => { if (state.randomMode !== m.k) item.style.background = 'var(--cm-hover)'; }
        item.onmouseleave = () => { if (state.randomMode !== m.k) item.style.background = 'transparent'; }
        menu.appendChild(item);
    });

    doc.body.appendChild(menu);

    const closeHandler = (e) => {
        if (!menu.contains(e.target) && e.target !== targetBtn) {
            menu.remove();
            doc.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => doc.addEventListener('click', closeHandler), 0);
}

function createModal() {
    if (doc.getElementById(MODAL_ID)) return;
    const m = doc.createElement('div');
    m.id = MODAL_ID;
    m.className = state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light';
    
    // 初始化应用设置类
    if (!state.settings.showCardHoverButtons) m.classList.add('cm-hide-hover-btns');
    if (!state.settings.showCardNote) m.classList.add('cm-hide-card-note');

    m.innerHTML = '<div class="cm-dialog">' +
        '<div class="cm-header">' +
        '<h2><span style="margin-right:6px">' + ICONS.folder + '</span> 角色卡管理<span id="cmHeaderStats" class="cm-header-stats"></span></h2>' +
        '<div class="cm-header-actions">' +
        '<button class="cm-header-btn cm-mobile-only" id="cmMobileMenuBtn" title="更多">' + ICONS.menu + '</button>' +
        '<div class="cm-desktop-actions">' +
        '<button class="cm-header-btn" id="cmSettingsBtn" title="设置">' + ICONS.settings + '</button>' +
        '<button class="cm-header-btn" id="cmMetadataSepBtn" title="元数据分离器">' + ICONS.box + '</button>' +
        '<button class="cm-header-btn" id="cmThemeBtn" title="切换主题">' + (state.isDarkMode ? ICONS.moon : ICONS.sun) + '</button>' +
        '<button class="cm-header-btn" id="cmMigrateBtn" title="从旧版本迁移数据" style="display:none;color:#fbbf24">📥</button>' +
        '<button class="cm-header-btn" id="cmImportBtn" title="导入角色/ZIP">' + ICONS.upload + '</button>' +
        '<button class="cm-header-btn" id="cmUrlImportBtn" title="从 URL 导入">' + ICONS.link + '</button>' +
        '</div>' +
        '<button class="cm-header-btn" id="cmSyncBtn" title="快速刷新">' + ICONS.refresh + '</button>' +
        '<button class="cm-header-btn" id="cmFullScanBtn" title="强制全量刷新">' + ICONS.search + '</button>' +
        '<button class="cm-close">' + ICONS.close + '</button>' +
        '<div class="cm-mobile-menu" id="cmMobileMenu" style="display:none">' +
        '<div class="cm-menu-item" id="cmMenuImport">' + ICONS.upload + ' 导入文件</div>' +
        '<div class="cm-menu-item" id="cmMenuUrlImport">' + ICONS.link + ' URL 导入</div>' +
        '<div class="cm-menu-item" id="cmMenuAIGenerate">' + ICONS.ai + ' AI 概览</div>' +
        '<div class="cm-menu-item" id="cmMenuSettings">' + ICONS.settings + ' 设置</div>' +
        '<div class="cm-menu-item" id="cmMenuTheme">' + (state.isDarkMode ? ICONS.moon : ICONS.sun) + ' 切换主题</div>' +
        '<div class="cm-menu-item" id="cmMenuMigrate" style="display:none">📥 迁移数据</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="cm-toolbar">' +
        '<div class="cm-toolbar-row">' +
        '<button class="cm-btn cm-btn-secondary" id="cmToggleSidebar" style="width:32px;padding:0;justify-content:center;">' + ICONS.menu + '</button>' +
        '<button class="cm-btn cm-btn-secondary" id="cmOpenTagManager" title="管理标签" style="width:32px;padding:0;justify-content:center;">' + ICONS.settings + '</button>' +
        '<div class="cm-tabs"><button class="cm-tab active" data-view="all">全部</button><button class="cm-tab" data-view="favorites">收藏</button><button class="cm-tab" data-view="tags">分类</button></div>' +
        '<div class="cm-search-wrap">' +
        '<span class="cm-search-icon" id="cmRandomDice" title="随机抽取 (长按切换模式)" style="pointer-events:auto;cursor:pointer;margin-right:4px">🎲</span>' +
        '<input type="text" class="cm-search-input" id="cmSearchInput" placeholder="搜索...">' +
        '<button id="cmSearchClear" class="cm-search-clear" title="清除">' + ICONS.close + '</button>' +
        '</div>' +
        '</div>' +
        '<div class="cm-toolbar-row">' +
        '<div class="cm-sort-controls">' +
        '<button class="cm-sort-btn" id="cmShowDupes">' + ICONS.dupe + ' 重复</button>' +
        '<div class="cm-zoom-control">' +
        '<button class="cm-zoom-btn" id="cmZoomOutBtn">' + ICONS.zoomOut + '</button>' +
        '<input type="range" class="cm-zoom-input" min="60" max="300" step="20" value="' + state.zoomLevel + '">' +
        '<button class="cm-zoom-btn" id="cmZoomInBtn">' + ICONS.zoomIn + '</button>' +
        '<span id="cmZoomVal" class="cm-zoom-val">' + state.zoomLevel + 'px</span>' +
        '</div>' +
        '<div class="cm-select-wrap">' +
        '<select class="cm-select-input" id="cmSortSelect">' +
        characterSortOptionsHtml +
        '</select>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="cm-batch" id="cmBatchBar">' +
        '<span>已选 <strong id="cmSelectedCount">0</strong></span>' +
        '<button class="cm-btn cm-btn-secondary" id="cmSelectAll">全选</button>' +
        '<button class="cm-btn cm-btn-secondary" id="cmClearSel">退出</button>' +
        '<button class="cm-btn cm-btn-primary" id="cmBatchTag">标签</button>' +
        '<button class="cm-btn cm-btn-success" id="cmBatchAIGenerate">🪄 AI 概览</button>' +
        '<button class="cm-btn cm-btn-secondary" id="cmBatchFav">' + ICONS.star + '</button>' +
        '<button class="cm-btn cm-btn-danger" id="cmDelSel">' + ICONS.trash + '</button>' +
        '<button class="cm-btn cm-btn-secondary" id="cmBackupSel">' + ICONS.download + '</button>' +
        '</div>' +
        '<div class="cm-main">' +
        '<div class="cm-sidebar" id="cmTagSidebar"></div>' +
        '<div class="cm-resizer" id="cmSidebarResizer"></div>' +
        '<div class="cm-body" id="cmBody">' +
        '<div style="text-align:center;padding:60px 20px;color:var(--cm-text-sec)"><div style="opacity:0.5;margin-bottom:16px">' + ICONS.search.replace('16', '48') + '</div><div>点击刷新开始</div></div>' +
        '</div>' +
        '</div>' +
        '</div>';

    m.querySelector('.cm-close').onclick = closeModal;

    // Dice Button Logic
    const diceBtn = m.querySelector('#cmRandomDice');
    if (diceBtn) {
        let diceTimer = null;
        let isDiceLong = false;
        const handleDiceLong = () => {
            isDiceLong = true;
            showRandomModeMenu(diceBtn);
        };
        const clearDiceTimer = () => {
            if (diceTimer) { clearTimeout(diceTimer); diceTimer = null; }
        };
        diceBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            isDiceLong = false;
            diceTimer = setTimeout(handleDiceLong, 500);
        });
        diceBtn.addEventListener('mouseup', clearDiceTimer);
        diceBtn.addEventListener('mouseleave', clearDiceTimer);
        diceBtn.addEventListener('touchstart', (e) => {
            isDiceLong = false;
            diceTimer = setTimeout(handleDiceLong, 500);
        }, { passive: true });
        diceBtn.addEventListener('touchend', clearDiceTimer);
        diceBtn.onclick = (e) => {
            if (isDiceLong) { e.preventDefault(); e.stopPropagation(); return; }
            executeRandomPick();
        };
    }
    m.querySelector('#cmSyncBtn').onclick = () => scan(true, false);
    m.querySelector('#cmFullScanBtn').onclick = () => scan(true, true);
    m.querySelector('#cmThemeBtn').onclick = toggleTheme;
    m.querySelector('#cmMetadataSepBtn').onclick = openMetadataSeparatorDialog;
    m.querySelector('#cmSettingsBtn').onclick = () => showSettingsDialog({
        createBaseDialog,
        toggleTheme,
        renderView,
        notify,
        setZoom,
        showConfirm,
        showProgressBar,
        updateProgressBar,
        hideProgressBar
    });

    // Mobile Menu Logic
    const mobileMenuBtn = m.querySelector('#cmMobileMenuBtn');
    const mobileMenu = m.querySelector('#cmMobileMenu');
    
    if (mobileMenuBtn && mobileMenu) {
        mobileMenuBtn.onclick = (e) => {
            e.stopPropagation();
            mobileMenu.style.display = mobileMenu.style.display === 'none' ? 'block' : 'none';
        };

        const closeMenu = (e) => {
            // Check if element still exists in DOM
            if (!doc.body.contains(mobileMenu)) {
                doc.removeEventListener('click', closeMenu);
                return;
            }
            if (mobileMenu.style.display !== 'none' && !mobileMenu.contains(e.target) && e.target !== mobileMenuBtn) {
                mobileMenu.style.display = 'none';
            }
        };
        doc.addEventListener('click', closeMenu);

        // Bind menu items
        const bindMenu = (id, targetId) => {
            const el = m.querySelector(id);
            const target = m.querySelector(targetId);
            if (el && target) {
                el.onclick = () => {
                    target.click();
                    mobileMenu.style.display = 'none';
                };
            }
        };

        bindMenu('#cmMenuImport', '#cmImportBtn');
        bindMenu('#cmMenuUrlImport', '#cmUrlImportBtn');
        const aiMenu = m.querySelector('#cmMenuAIGenerate');
        if (aiMenu) {
            aiMenu.onclick = () => {
                showAITagConfigDialog();
                mobileMenu.style.display = 'none';
            };
        }
        bindMenu('#cmMenuSettings', '#cmSettingsBtn');
        bindMenu('#cmMenuTheme', '#cmThemeBtn');
        bindMenu('#cmMenuMigrate', '#cmMigrateBtn');
    }

    const importBtn = m.querySelector('#cmImportBtn');
    importBtn.onclick = function () {
        const inp = doc.createElement('input');
        inp.type = 'file';
        inp.multiple = true;
        inp.accept = '.png,.webp,.json,.zip';
        inp.style.display = 'none';
        doc.body.appendChild(inp);
        inp.onchange = function (e) {
            if (e.target.files && e.target.files.length > 0) {
                importFiles(Array.from(e.target.files));
            }
            doc.body.removeChild(inp);
        };
        inp.click();
    };

    m.querySelector('#cmUrlImportBtn').onclick = function () {
        showUrlImportDialog();
    };

    m.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        m.style.boxShadow = 'inset 0 0 0 4px #2563eb';
    });
    m.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        m.style.boxShadow = 'none';
    });
    m.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        m.style.boxShadow = 'none';
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            importFiles(Array.from(e.dataTransfer.files));
        }
    });


    const resizer = m.querySelector('#cmSidebarResizer');
    const sidebar = m.querySelector('#cmTagSidebar');

    const startResize = (e) => {
        e.preventDefault();
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const startWidth = parseInt(getComputedStyle(sidebar).width);

        doc.body.classList.add('cm-resizing');

        const doDrag = (moveEvent) => {
            const currentX = moveEvent.type.includes('touch') ? moveEvent.touches[0].clientX : moveEvent.clientX;
            let newWidth = startWidth + (currentX - clientX);
            if (newWidth < 100) newWidth = 100;
            if (newWidth > 500) newWidth = 500;
            state.sidebarWidth = newWidth;
            m.style.setProperty('--cm-sidebar-width', newWidth + 'px');
        };

        const stopDrag = () => {
            if (e.type.includes('touch')) {
                doc.removeEventListener('touchmove', doDrag);
                doc.removeEventListener('touchend', stopDrag);
            } else {
                doc.removeEventListener('mousemove', doDrag);
                doc.removeEventListener('mouseup', stopDrag);
            }
            doc.body.classList.remove('cm-resizing');
            localStorage.setItem('cm_sidebar_width', state.sidebarWidth);
        };

        if (e.type.includes('touch')) {
            doc.addEventListener('touchmove', doDrag, { passive: false });
            doc.addEventListener('touchend', stopDrag);
        } else {
            doc.addEventListener('mousemove', doDrag);
            doc.addEventListener('mouseup', stopDrag);
        }
    };

    resizer.addEventListener('mousedown', startResize);
    resizer.addEventListener('touchstart', startResize, { passive: false });

    // 迁移按钮逻辑
    const migrateBtn = m.querySelector('#cmMigrateBtn');
    if (migrateBtn) {
        migrateBtn.onclick = async () => {
            try {
                const migSources = checkForMigration();
                if (migSources.length === 0) return notify('未找到旧版数据', 'info');

                let migTarget = migSources.find(k => k.includes('脚本') || k.includes('角色卡'));
                if (!migTarget) migTarget = migSources[0];

                const oldSettings = parentWin.SillyTavern.extension_settings[migTarget];
                const tCount = (oldSettings.tags || []).length;

                const doMigrate = await showConfirm(`在配置 "${migTarget}" 中发现 ${tCount} 个标签。\n\n是否将其合并到当前插件？\n(相同名称的标签会自动合并，不会覆盖现有数据)`);
                if (doMigrate) {
                    performMigration(migTarget);
                }
            } catch (err) {
                console.error(err);
                notify('操作失败: ' + err.message, 'error');
            }
        };
        // 检查是否显示
        const sources = checkForMigration();
        if (sources.length > 0) {
            migrateBtn.style.display = 'flex';
            const menuMigrate = m.querySelector('#cmMenuMigrate');
            if (menuMigrate) menuMigrate.style.display = 'flex';
        }
    }

    const zoomInput = m.querySelector('.cm-zoom-input');
    zoomInput.oninput = function () { setZoom(this.value); };

    m.querySelector('#cmZoomOutBtn').onclick = function () {
        setZoom(state.zoomLevel - 20);
    };
    m.querySelector('#cmZoomInBtn').onclick = function () {
        setZoom(state.zoomLevel + 20);
    };

    setZoom(state.zoomLevel);

    const body = m.querySelector('#cmBody');
    body.onclick = async (e) => {
        const card = e.target.closest('.cm-card');
        if (card && card.dataset.ignoreClick === 'true') {
            delete card.dataset.ignoreClick;
            return;
        }

        const favBtn = e.target.closest('.cm-fav');
        if (favBtn) {
            e.stopPropagation();
            if (!card) return;
            const fileName = card.dataset.file;
            const char = state.characters.find(c => c.fileName === fileName);
            if (char) {
                const newState = await toggleFavorite(fileName, char.fav);
                char.fav = newState;
                favBtn.classList.toggle('active', newState);
                // 更新卡片的收藏样式类
                card.classList.toggle('cm-favorite', newState);
                // 更新桃心徽章显示状态（局部刷新）
                updateFavHeartOnCard(card, newState);
                if (state.currentView === 'favorites' && !newState) renderView();
                renderTagSidebar();
            }
            return;
        }

        const delBtn = e.target.closest('.cm-del');
        if (delBtn) {
            e.stopPropagation();
            if (!card) return;
            const fileName = card.dataset.file;
            const char = state.characters.find(c => c.fileName === fileName);

            let wiCount = 0;
            if (char && char.character_book) {
                const isUsed = state.characters.some(c => c.fileName !== fileName && c.character_book === char.character_book);
                if (!isUsed) wiCount = 1;
            }

            const confirmRes = await showDeleteConfirm(1, wiCount);
            if (!confirmRes.ok) return;

            try {
                await deleteChar(char, {
                    deleteChats: confirmRes.delChats,
                    deleteWi: confirmRes.delWi && wiCount > 0
                });

                card.remove();
                // deleteChar 已内部处理 state.characters 清理和持久化，此处移除冗余代码
                findDuplicates(); updateStats(); renderTagSidebar();
                notify('已删除', 'success');
            } catch (err) {
                console.error('删除角色失败:', err);
                notify('删除失败', 'error');
            }
            return;
        }

        const dlBtn = e.target.closest('.cm-backup');
        if (dlBtn) {
            e.stopPropagation();
            if (!card) return;
            const fileName = card.dataset.file;
            const char = state.characters.find(c => c.fileName === fileName);
            if (await showConfirm('确定下载 "' + (char ? char.name : fileName) + '"？')) {
                await downloadChar(fileName);
                notify('已下载', 'success');
            }
            return;
        }

        if (card) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;

            if (e.shiftKey && state.lastSelectedIndex > -1) {
                const currentIndex = parseInt(card.dataset.index);
                const start = Math.min(state.lastSelectedIndex, currentIndex);
                const end = Math.max(state.lastSelectedIndex, currentIndex);
                const allCards = Array.from(doc.querySelectorAll('.cm-card'));

                const targetFile = card.dataset.file;
                const shouldSelect = !state.selectedCards.has(targetFile);

                for (let i = start; i <= end; i++) {
                    const c = allCards.find(el => parseInt(el.dataset.index) === i);
                    if (c) {
                        const fName = c.dataset.file;
                        if (shouldSelect) {
                            state.selectedCards.add(fName);
                            c.classList.add('cm-sel');
                        } else {
                            state.selectedCards.delete(fName);
                            c.classList.remove('cm-sel');
                        }
                    }
                }
                updateBatchBar();
                state.lastSelectedIndex = currentIndex;
                return;
            }

            if (e.ctrlKey || e.metaKey || state.selectedCards.size > 0) {
                const fileName = card.dataset.file;
                const isSel = !state.selectedCards.has(fileName);
                if (isSel) state.selectedCards.add(fileName);
                else state.selectedCards.delete(fileName);
                card.classList.toggle('cm-sel', isSel);
                updateBatchBar();
                state.lastSelectedIndex = parseInt(card.dataset.index);
            } else {
                const fileName = card.dataset.file;
                const char = state.characters.find(c => c.fileName === fileName);
                
                if (char) {
                    showDetail(char);
                }
                state.lastSelectedIndex = parseInt(card.dataset.index);
            }
        }
    };

    m.querySelector('#cmOpenTagManager').onclick = function () {
        state.currentView = 'tagManager';
        renderView();
        renderTagSidebar();
    };

    m.querySelector('#cmToggleSidebar').onclick = function () {
        const sidebar = doc.getElementById('cmTagSidebar');
        const main = m.querySelector('.cm-main');
        state.isSidebarVisible = !state.isSidebarVisible;
        if (state.isSidebarVisible) {
            sidebar.classList.remove('closed');
            main.classList.remove('sidebar-closed');
        } else {
            sidebar.classList.add('closed');
            main.classList.add('sidebar-closed');
        }
    };

    const btnDupes = m.querySelector('#cmShowDupes');
    const sortSel = m.querySelector('#cmSortSelect');

    // 设置初始值
    // 【兼容性处理】如果用户当前排序是不存在的排序方式（如已删除的 import），回退到创建日期排序
    const validSortValues = CHARACTER_SORT_OPTIONS.map(opt => opt.value);
    const currentSortValue = state.sortBy + '_' + state.sortOrder;
    if (!validSortValues.includes(currentSortValue)) {
        console.warn('[CharManager] 检测到无效的排序方式:', currentSortValue, '，回退到 date_desc');
        state.sortBy = 'date';
        state.sortOrder = 'desc';
        saveSettings(); // 持久化修正后的排序设置
    }
    sortSel.value = state.sortBy + '_' + state.sortOrder;

    sortSel.onchange = async function () {
        const parts = this.value.split('_');
        if (parts.length === 2) {
            state.sortBy = parts[0];
            state.sortOrder = parts[1];

            // 如果选择画廊排序，且还没有加载过画廊数量，需要先批量获取
            if (state.sortBy === 'gallery') {
                const needsLoad = state.characters.some(c => c.galleryCount === undefined);
                if (needsLoad) {
                    notify('正在加载画廊数量...', 'info');
                    sortSel.disabled = true;

                    // 批量并发获取画廊数量
                    const batchSize = 10;
                    for (let i = 0; i < state.characters.length; i += batchSize) {
                        const batch = state.characters.slice(i, i + batchSize);
                        await Promise.all(batch.map(async (char) => {
                            if (char.galleryCount === undefined) {
                                try {
                                    const items = await getGalleryItems(char.name);
                                    char.galleryCount = items.length;
                                } catch (e) {
                                    char.galleryCount = 0;
                                }
                            }
                        }));
                    }

                    sortSel.disabled = false;
                    notify('画廊数量加载完成', 'success');
                }
            }

            renderView();
        }
    };

    const updateSortUI = () => {
        btnDupes.classList.toggle('active', state.currentView === 'duplicates');
        // Dropdown updates automatically via value bind in onchange if needed, but here we just render
    };

    btnDupes.onclick = () => {
        state.currentView = 'duplicates';
        state.currentTag = null;
        renderView();
        renderTagSidebar();
        updateSortUI();
    };

    const searchInput = m.querySelector('#cmSearchInput');
    const clearBtn = m.querySelector('#cmSearchClear');

    searchInput.oninput = function () {
        state.searchQuery = this.value.trim();
        clearBtn.style.display = this.value ? 'flex' : 'none';
        renderView();
    };

    clearBtn.onclick = function () {
        searchInput.value = '';
        state.searchQuery = '';
        this.style.display = 'none';
        renderView();
        searchInput.focus();
    };

    m.querySelectorAll('.cm-tab[data-view]').forEach(t => {
        t.onclick = function () {
            state.currentView = this.dataset.view;
            state.currentTag = null;
            renderView();
            renderTagSidebar();
            btnDupes.classList.remove('active');
        };
    });

    m.querySelector('#cmSelectAll').onclick = function () {
        state.filteredList.forEach(c => {
            state.selectedCards.add(c.fileName);
        });
        doc.querySelectorAll('.cm-card').forEach(c => c.classList.add('cm-sel'));
        updateBatchBar();
    };

    m.querySelector('#cmClearSel').onclick = function () {
        state.selectedCards.clear();
        doc.querySelectorAll('.cm-card').forEach(c => {
            c.classList.remove('cm-sel');
        });
        updateBatchBar();
    };

    m.querySelector('#cmBatchTag').onclick = showBatchTagDialog;

    m.querySelector('#cmBatchAIGenerate').onclick = showAITagConfigDialog;

    m.querySelector('#cmBatchFav').onclick = async function () {
        if (!state.selectedCards.size) return;
        const files = Array.from(state.selectedCards);
        const doFav = await showConfirm('点击“确定”全部收藏，点击“取消”全部取消收藏？');
        for (const fn of files) {
            await toggleFavorite(fn, !doFav);
        }
        state.selectedCards.clear();
        updateBatchBar();
        renderView();
        renderTagSidebar();
    };

    m.querySelector('#cmDelSel').onclick = async function () {
        if (!state.selectedCards.size) return;

        const files = Array.from(state.selectedCards);

        const allChars = state.characters;
        const toDeleteNames = new Set(files);
        const otherChars = allChars.filter(c => !toDeleteNames.has(c.fileName));
        const otherUsedWIs = new Set(otherChars.map(c => c.character_book).filter(Boolean));

        const targetWIs = new Set();
        files.forEach(fn => {
            const c = allChars.find(x => x.fileName === fn);
            if (c && c.character_book && !otherUsedWIs.has(c.character_book)) {
                targetWIs.add(c.character_book);
            }
        });

        const confirmRes = await showDeleteConfirm(files.length, targetWIs.size);
        if (!confirmRes.ok) return;

        let ok = 0;
        for (const fn of files) {
            const char = allChars.find(c => c.fileName === fn);
            if (!char) continue;

            try {
                const shouldDeleteWi = confirmRes.delWi && char.character_book && targetWIs.has(char.character_book);
                await deleteChar(char, {
                    deleteChats: confirmRes.delChats,
                    deleteWi: shouldDeleteWi,
                    skipNativeUi: true
                });
                // deleteChar 已内部处理 state.characters 清理和持久化，此处移除冗余代码
                ok++;
            } catch (e) {
                console.error('批量删除角色失败:', e);
            }
        }
        
        state.selectedCards.clear();
        findDuplicates(); updateStats(); updateBatchBar(); renderTagSidebar(); renderView();

        // 批量操作完成后统一刷新
        try {
            if (parentWin.SillyTavern && parentWin.SillyTavern.getContext) {
                await parentWin.SillyTavern.getContext().getCharacters();
            }
        } catch (e) { }

        notify('已删除 ' + ok + ' 个角色', 'success');
    };

    m.querySelector('#cmBackupSel').onclick = async function () {
        const files = Array.from(state.selectedCards);
        if (files.length === 0) return;
        if (files.length === 1) {
            await downloadChar(files[0]);
            notify('已下载', 'success');
        } else {
            await downloadAsZip(files);
        }
    };

    // 应用初始化设置
    if (!state.settings.showCardHoverButtons) {
        m.classList.add('cm-hide-hover-btns');
    }
    if (!state.settings.showCardNote) {
        m.classList.add('cm-hide-card-note');
    }

    doc.body.appendChild(m);
}



// 检查是否有可迁移的旧数据
function checkForMigration() {
    try {
        const settings = parentWin.SillyTavern.extension_settings;
        if (!settings) return [];
        return Object.keys(settings).filter(k =>
            k !== 'ST-Character-Manager' &&
            (k.includes('ST-Character') || k.includes('角色卡') || k.includes('manager')) &&
            settings[k].tags &&
            Array.isArray(settings[k].tags) &&
            settings[k].tags.length > 0
        );
    } catch (e) { return []; }
}

function performMigration(sourceKey) {
    try {
        const oldData = parentWin.SillyTavern.extension_settings[sourceKey];
        if (!oldData) return;

        let addedTags = 0;
        let taggedChars = 0;

        // 1. 迁移标签定义
        const oldTags = oldData.tags || [];
        const idMap = {}; // oldId -> newId

        oldTags.forEach(ot => {
            let existing = state.tags.find(t => t.name === ot.name);
            if (!existing) {
                const newTag = {
                    id: generateId(),
                    name: ot.name,
                    color: ot.color || '#a5b4fc',
                    pinned: !!ot.pinned
                };
                state.tags.push(newTag);
                existing = newTag;
                addedTags++;
            }
            idMap[ot.id] = existing.id;
        });

        // 2. 迁移标签映射
        const oldMap = oldData.tagMap || {};
        Object.keys(oldMap).forEach(fileName => {
            const tids = oldMap[fileName] || [];
            if (tids.length > 0) {
                if (!state.tagMap[fileName]) state.tagMap[fileName] = [];
                let changed = false;
                tids.forEach(oldTid => {
                    const newTid = idMap[oldTid];
                    if (newTid && !state.tagMap[fileName].includes(newTid)) {
                        state.tagMap[fileName].push(newTid);
                        changed = true;
                    }
                });
                if (changed) taggedChars++;
            }
        });

        if (addedTags > 0 || taggedChars > 0) {
            saveTags();
            renderTagSidebar();
            notify(`迁移成功：新增 ${addedTags} 个标签，关联 ${taggedChars} 个角色`, 'success');
            // 可选：迁移后隐藏按钮？还是留着防止误操作没点到
            // doc.getElementById('cmMigrateBtn').style.display = 'none';
        } else {
            notify('数据已全部存在，无需更新', 'info');
        }

    } catch (e) {
        console.error(e);
        notify('迁移失败: ' + e.message, 'error');
    }
}

async function openModal() {
    createModal();
    loadTags();
    renderTagSidebar();
    if (state.characters.length === 0) {
        scan();
    } else {
        // 确保打开面板时重新检查重复项，因为外部可能会修改角色列表
        // 或者之前的检查逻辑已更新
        findDuplicates();
        updateStats();
        renderView();
    }
    doc.getElementById(MODAL_ID).style.display = 'block';

    // 检查是否有未同步的标签
    if (state.settings.autoSyncTags && state.hasUnsyncedTags) {
        const unsyncedCount = state.unsyncedCards?.size || state.characters.length;
        if (await showConfirm(`检测到有未同步的标签，是否立即执行全量同步？\n\n当前情况：你之前在"不同步"模式下修改过标签，现在开启了"同步插件标签到原生标签"。\n共有 ${unsyncedCount} 张角色卡需要同步。\n\n这可能需要一些时间，期间请勿关闭页面。`)) {
            const syncBtn = doc.getElementById('cmSyncBtn');
            if (syncBtn) syncBtn.disabled = true;
            showProgressBar('准备同步标签...');
            try {
                const count = await syncAllTags((current, total) => {
                    updateProgressBar(Math.round((current / total) * 100), `同步中 (${current}/${total})`, '');
                });
                notify(`成功同步 ${count} 个角色的标签`, 'success');
            } catch (e) {
                console.error(e);
                notify('同步失败: ' + e.message, 'error');
            } finally {
                hideProgressBar();
                if (syncBtn) syncBtn.disabled = false;
            }
        }
    }
}

export function closeModal() {
    const m = doc.getElementById(MODAL_ID);
    if (m) m.style.display = 'none';
}

function createButton() {
    if (doc.getElementById(BUTTON_ID)) return;
    const menu = doc.getElementById('extensionsMenu') || doc.getElementById('extensions_menu');
    if (menu) {
        const btn = doc.createElement('div');
        btn.id = BUTTON_ID;
        btn.className = 'list-group-item flex-container flexGap5 interactable';
        btn.innerHTML = '<span>📁</span><span>角色卡管理</span>';
        btn.onclick = openModal;
        menu.prepend(btn);
    } else {
        setTimeout(createButton, 500);
    }
}

function removeButton() {
    const btn = doc.getElementById(BUTTON_ID);
    if (btn) btn.remove();
}

function updateEntryMode(mode) {
    const existingBtn = doc.getElementById(BUTTON_ID);
    const existingBall = doc.getElementById('cmFloatBall');

    switch (mode) {
        case 'magicWand':
            removeFloatBall();
            if (!existingBtn) createButton();
            break;

        case 'floatBall':
            if (existingBtn) existingBtn.remove();
            if (!existingBall) createFloatBall(openModal);
            break;

        case 'both':
            if (!existingBtn) createButton();
            if (!existingBall) createFloatBall(openModal);
            break;
    }
}

window.cmUpdateEntryMode = updateEntryMode;

async function init() {
    // injectStyles(); // Removed: using style.css
    // Restore dynamic styles
    doc.documentElement.style.setProperty('--cm-card-width', state.zoomLevel + 'px');
    doc.documentElement.style.setProperty('--cm-sidebar-width', state.sidebarWidth + 'px');

    updateEntryMode(state.settings.entryMode || 'magicWand');
    parentWin.openCharManager = openModal;
    window.openCharManager = openModal;
    
    // 初始化翻译模块
    initTranslationUI({ createBaseDialog, notify, showConfirm, scan, importFiles, updateCharacter, refreshSingleCard });
    
    // 初始化网络请求拦截器
    initInterceptor();
    
    // 监听 AI 概览生成标签事件，刷新列表页 tag DOM
    window.addEventListener('cm-tags-updated', (e) => {
        const { fileName } = e.detail || {};
        if (fileName) {
            refreshCardTags(fileName);
        }
    });
    
    // 异步加载缓存数据
    try {
        let chars = await getCache('characters');
        let migratedFromOldCache = false;
        
        // 如果 IndexedDB 的 characters 键为空，尝试从旧数据迁移
        if (!chars || !Array.isArray(chars) || chars.length === 0) {
            // 优先尝试从 IndexedDB 的 cm_char_cache 迁移（旧版键名）
            const oldCache = await getCache('cm_char_cache');
            if (oldCache && Array.isArray(oldCache) && oldCache.length > 0) {
                chars = oldCache;
                // 迁移到新键名
                await setCache('characters', chars);
                await clearCache('cm_char_cache');
                migratedFromOldCache = true;
                log('已从 IndexedDB cm_char_cache 迁移到 characters');
            } else {
                // 尝试从 LocalStorage 迁移更早的旧数据
                const migrated = await migrateFromLocalStorage('cm_char_cache');
                if (migrated && Array.isArray(migrated) && migrated.length > 0) {
                    chars = migrated;
                    // 迁移到新键名，避免仅存在旧键导致的重启后数据丢失窗口
                    await setCache('characters', chars);
                    await clearCache('cm_char_cache');
                    migratedFromOldCache = true;
                    log('已从 LocalStorage cm_char_cache 迁移到 characters');
                }
            }
        }
        
        // 清理 IndexedDB 中可能遗留的旧键（当 chars 已有数据但旧键未被清理时）
        if (!migratedFromOldCache) {
            try {
                const oldIndexedDBCache = await getCache('cm_char_cache');
                if (oldIndexedDBCache) {
                    await clearCache('cm_char_cache');
                    log('已清理 IndexedDB 遗留键 cm_char_cache');
                }
            } catch (e) { /* 忽略清理错误 */ }
        }

        if (chars && Array.isArray(chars)) {
            state.characters = chars;
            log('已加载缓存角色: ' + chars.length);
        }
    } catch (e) {
        console.error('[CharManager] Failed to load cache on init:', e);
    }

    if (state.settings.autoScan) {
        setTimeout(() => scan(), 1000);
    }
    
    // 全局快捷键监听器
    const shortcutListener = (e) => {
        if (!state.openShortcut) return;
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        if (e.metaKey) parts.push('Meta');
        const key = e.key.toUpperCase();
        if (!['CONTROL', 'SHIFT', 'ALT', 'META'].includes(key)) parts.push(key);
        const sc = parts.join('+');
        if (sc === state.openShortcut) {
            e.preventDefault();
            // 优先级1：关闭画廊查看器
            const galleryViewer = doc.querySelector('.cm-gallery-viewer');
            if (galleryViewer) { galleryViewer.click(); return; }
            // 优先级2：关闭文本弹窗
            const textModal = doc.querySelector('.cm-text-modal-overlay');
            if (textModal) { textModal.remove(); return; }
            // 优先级3：关闭角色详情页
            const detailOverlay = doc.querySelector('.cm-detail-overlay');
            if (detailOverlay) {
                const closeBtn = detailOverlay.querySelector('.cm-detail-close');
                if (closeBtn) { closeBtn.click(); return; }
                detailOverlay.remove();
                return;
            }
            // 优先级4：关闭任意 createBaseDialog 弹窗（标签编辑器、确认框、设置面板等）
            const overlays = doc.querySelectorAll('.cm-tag-editor-overlay');
            if (overlays.length > 0) { overlays[overlays.length - 1].remove(); return; }
            // 优先级5：切换管理器主窗口
            const m = doc.getElementById(MODAL_ID);
            if (m && m.style.display === 'block') closeModal();
            else openModal();
        }
    };
    window.addEventListener('keydown', shortcutListener);
    if (parentWin !== window) parentWin.addEventListener('keydown', shortcutListener);
    
    log(`角色卡管理器 小鱼改版 v${manifest.version} 已加载`);
}

setTimeout(init, 500);

