/**
 * 画廊模块 - 用于显示和管理角色画廊
 */
import { ICONS } from './constants.js';
import { doc, parentWin, getSTContext } from './context.js';
import { state } from './state.js';
import { authFetch } from './api.js';
import { escapeHtml, arrayBufferToBase64 } from './utils.js';
import { GalleryViewer } from './gallery-viewer.js';
import { notify } from './utils.js';
import { showConfirm } from './ui-utils.js';
import { replaceCharacterImage } from './data.js';

// 画廊计数缓存
const GALLERY_CACHE_KEY = 'cm_gallery_count_cache';
const GALLERY_CACHE_EXPIRE = 24 * 60 * 60 * 1000; // 24小时过期
export let galleryCountCache = {};
try {
    const cached = JSON.parse(localStorage.getItem(GALLERY_CACHE_KEY) || '{}');
    if (cached._timestamp && Date.now() - cached._timestamp < GALLERY_CACHE_EXPIRE) {
        galleryCountCache = cached;
    }
} catch (e) { }

function saveGalleryCountCache() {
    galleryCountCache._timestamp = Date.now();
    try {
        localStorage.setItem(GALLERY_CACHE_KEY, JSON.stringify(galleryCountCache));
    } catch (e) { }
}

// 获取角色画廊图片列表
export async function getGalleryItems(charName) {
    try {
        const response = await authFetch('/api/images/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                folder: charName,
                sortField: 'date',
                sortOrder: 'desc',
                type: 3 // IMAGE | VIDEO
            })
        });
        if (!response.ok) return [];
        const files = await response.json();
        return files.map(file => ({
            src: `user/images/${charName}/${file}`,
            name: file
        }));
    } catch (e) {
        console.error('[CharManager] 获取画廊失败:', e);
        return [];
    }
}

// 获取画廊图片数量（带缓存）
export async function getGalleryCount(charName) {
    // 优先从缓存读取
    if (galleryCountCache[charName] !== undefined) {
        return galleryCountCache[charName];
    }
    const items = await getGalleryItems(charName);
    galleryCountCache[charName] = items.length;
    saveGalleryCountCache();
    return items.length;
}

// 删除画廊图片
export async function deleteGalleryImage(imagePath) {
    try {
        const response = await authFetch('/api/images/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: imagePath })
        });
        return response.ok;
    } catch (e) {
        console.error('[CharManager] 删除画廊图片失败:', e);
        return false;
    }
}

// 上传画廊图片
export async function uploadGalleryImage(charName, file) {
    try {
        // 检查文件类型
        if (!file.type.startsWith('image/')) {
            console.warn(`[CharManager] 跳过非图片文件: ${file.name}`);
            return false;
        }

        // 转换为 Base64
        const buffer = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        
        // 准备文件名和扩展名
        const nameOnly = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png';

        // 使用 JSON 格式上传，参考 library.js 的实现
        const response = await authFetch('/api/images/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: base64,
                filename: nameOnly,
                format: ext,
                ch_name: charName
            })
        });
        
        if (response.ok) {
            // 消费响应体
            await response.text().catch(() => {});
            
            // 更新缓存
            if (galleryCountCache[charName] !== undefined) {
                galleryCountCache[charName]++;
                saveGalleryCountCache();
            }
            return true;
        } else {
            const errorText = await response.text();
            console.error(`[CharManager] 上传失败 ${nameOnly}:`, response.status, errorText);
            return false;
        }
    } catch (e) {
        console.error('[CharManager] 上传画廊图片失败:', e);
        return false;
    }
}

// 下载图片
function downloadImage(url, filename) {
    const a = doc.createElement('a');
    a.href = url;
    a.download = filename || url.split('/').pop();
    a.target = '_blank';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
}

// 图片裁剪器 - 让用户选择要作为封面的区域（固定 512:768 比例）
function showImageCropper(imageSrc, imageName) {
    return new Promise((resolve) => {
        // 封面标准尺寸
        const TARGET_W = 512;
        const TARGET_H = 768;
        const ASPECT_RATIO = TARGET_W / TARGET_H; // 2:3

        const cropOverlay = doc.createElement('div');
        cropOverlay.className = 'cm-cropper-overlay ' + (state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light');

        cropOverlay.innerHTML = `
            <div class="cm-cropper-container">
                    <div class="cm-cropper-header">
                        <h3>裁剪封面图片</h3>
                        <div style="font-size:12px;color:#ef4444;font-weight:bold;margin-top:4px;">⚠️ 覆盖封面后原图将无法恢复！</div>
                        <span class="cm-cropper-hint">拖动调整裁剪区域 (512×768)</span>
                    </div>
                <div class="cm-cropper-body">
                    <div class="cm-cropper-canvas-wrap">
                        <canvas class="cm-cropper-canvas"></canvas>
                        <div class="cm-cropper-selection"></div>
                    </div>
                </div>
                <div class="cm-cropper-footer">
                    <button class="cm-btn cm-btn-secondary cm-cropper-cancel">取消</button>
                    <button class="cm-btn cm-btn-primary cm-cropper-confirm">确认裁剪</button>
                </div>
            </div>
        `;

        doc.body.appendChild(cropOverlay);

        const canvas = cropOverlay.querySelector('.cm-cropper-canvas');
        const ctx = canvas.getContext('2d');
        const selection = cropOverlay.querySelector('.cm-cropper-selection');
        const canvasWrap = cropOverlay.querySelector('.cm-cropper-canvas-wrap');

        const img = new Image();
        img.crossOrigin = 'anonymous';

        let imgWidth, imgHeight, scale;
        let selX, selY, selW, selH;
        let isDragging = false;
        let isResizing = false;
        let dragStartX, dragStartY, selStartX, selStartY, selStartW, selStartH;

        img.onload = () => {
            // 计算画布尺寸（限制最大尺寸）
            const maxW = Math.min(800, window.innerWidth - 80);
            const maxH = Math.min(600, window.innerHeight - 200);

            scale = Math.min(maxW / img.width, maxH / img.height, 1);
            imgWidth = img.width * scale;
            imgHeight = img.height * scale;

            canvas.width = imgWidth;
            canvas.height = imgHeight;
            canvasWrap.style.width = imgWidth + 'px';
            canvasWrap.style.height = imgHeight + 'px';

            ctx.drawImage(img, 0, 0, imgWidth, imgHeight);

            // 初始选择框 - 固定 512:768 比例，最大化填满图片区域
            if (imgWidth / imgHeight > ASPECT_RATIO) {
                // 图片更宽，以高度为准填满
                selH = imgHeight;
                selW = selH * ASPECT_RATIO;
            } else {
                // 图片更高或等比，以宽度为准填满
                selW = imgWidth;
                selH = selW / ASPECT_RATIO;
            }
            selX = (imgWidth - selW) / 2;
            selY = (imgHeight - selH) / 2;
            updateSelection();
        };

        img.onerror = () => {
            cropOverlay.remove();
            resolve(null);
        };

        img.src = imageSrc;

        function updateSelection() {
            // 保持比例
            selH = selW / ASPECT_RATIO;

            // 限制最小尺寸
            const minW = 50;
            const minH = minW / ASPECT_RATIO;
            if (selW < minW) {
                selW = minW;
                selH = minH;
            }

            // 限制边界
            if (selW > imgWidth) {
                selW = imgWidth;
                selH = selW / ASPECT_RATIO;
            }
            if (selH > imgHeight) {
                selH = imgHeight;
                selW = selH * ASPECT_RATIO;
            }

            selX = Math.max(0, Math.min(selX, imgWidth - selW));
            selY = Math.max(0, Math.min(selY, imgHeight - selH));

            selection.style.left = selX + 'px';
            selection.style.top = selY + 'px';
            selection.style.width = selW + 'px';
            selection.style.height = selH + 'px';
        }

        // 统一事件处理：鼠标与触摸
        const getPointerPos = (e) => {
            if (e.touches && e.touches.length > 0) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        };

        const handleStart = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pos = getPointerPos(e);
            const rect = selection.getBoundingClientRect();
            const x = pos.x - rect.left;
            const y = pos.y - rect.top;
            const edge = 30; // 增大触摸判定范围

            // 检测是否在角落
            const onRight = x > rect.width - edge;
            const onBottom = y > rect.height - edge;
            const onLeft = x < edge;
            const onTop = y < edge;

            if ((onRight || onLeft) && (onTop || onBottom)) {
                isResizing = true;
            } else {
                isDragging = true;
            }

            dragStartX = pos.x;
            dragStartY = pos.y;
            selStartX = selX;
            selStartY = selY;
            selStartW = selW;
            selStartH = selH;
        };

        const handleMove = (e) => {
            // 光标逻辑
            if (!isDragging && !isResizing) {
                const pos = getPointerPos(e);
                const rect = selection.getBoundingClientRect();
                const x = pos.x - rect.left;
                const y = pos.y - rect.top;
                const edge = 30;

                const onRight = x > rect.width - edge;
                const onBottom = y > rect.height - edge;
                const onLeft = x < edge;
                const onTop = y < edge;

                if ((onRight && onBottom) || (onLeft && onTop)) selection.style.cursor = 'nwse-resize';
                else if ((onRight && onTop) || (onLeft && onBottom)) selection.style.cursor = 'nesw-resize';
                else selection.style.cursor = 'move';

                return;
            }

            const pos = getPointerPos(e);
            const dx = pos.x - dragStartX;
            const dy = pos.y - dragStartY;

            if (isDragging) {
                selX = selStartX + dx;
                selY = selStartY + dy;
            } else if (isResizing) {
                // 按对角线方向缩放，保持比例
                const delta = (dx + dy) / 2;
                selW = Math.max(50, selStartW + delta);
            }

            updateSelection();
        };

        const handleEnd = () => {
            isDragging = false;
            isResizing = false;
        };

        selection.onmousedown = handleStart;
        selection.ontouchstart = handleStart;

        doc.onmousemove = handleMove;
        doc.ontouchmove = handleMove;

        doc.onmouseup = handleEnd;
        doc.ontouchend = handleEnd;

        // 取消按钮
        cropOverlay.querySelector('.cm-cropper-cancel').onclick = () => {
            cropOverlay.remove();
            resolve(null);
        };

        // 确认裁剪
        cropOverlay.querySelector('.cm-cropper-confirm').onclick = () => {
            // 计算原图上的裁剪区域
            const cropX = selX / scale;
            const cropY = selY / scale;
            const cropW = selW / scale;
            const cropH = selH / scale;

            // 创建固定 512x768 的输出
            const cropCanvas = doc.createElement('canvas');
            cropCanvas.width = TARGET_W;
            cropCanvas.height = TARGET_H;
            const cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, TARGET_W, TARGET_H);

            cropCanvas.toBlob((blob) => {
                cropOverlay.remove();
                resolve(blob);
            }, 'image/png');
        };

        // 禁用点击遮罩关闭，避免拖拽越界时误触发关闭
        // 用户只能通过"取消"或"确认裁剪"按钮关闭弹窗
    });
}

// 渲染画廊网格到指定容器
export async function renderGallery(container, char) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--cm-text-sec);">加载中...</div>';
    
    const items = await getGalleryItems(char.name);
    
    container.innerHTML = '';
    
    // 状态
    let batchMode = false;
    let selectedItems = new Set();

    // 工具栏
    const toolbar = doc.createElement('div');
    toolbar.className = 'cm-gallery-toolbar';
    toolbar.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--cm-border);';
    
    const leftTools = doc.createElement('div');
    leftTools.style.cssText = 'display:flex;gap:8px;align-items:center;';
    
    const uploadBtn = doc.createElement('button');
    uploadBtn.className = 'cm-btn cm-btn-primary';
    uploadBtn.innerHTML = `${ICONS.upload} 上传图片`;
    
    const batchBtn = doc.createElement('button');
    batchBtn.className = 'cm-btn cm-btn-secondary';
    batchBtn.innerHTML = `${ICONS.checkSquare} 批量管理`;
    
    leftTools.appendChild(uploadBtn);
    leftTools.appendChild(batchBtn);
    
    const countSpan = doc.createElement('span');
    countSpan.style.cssText = 'font-size:12px;color:var(--cm-text-sec);';
    countSpan.textContent = `${items.length} 张图片 (支持拖拽上传)`;
    
    toolbar.appendChild(leftTools);
    toolbar.appendChild(countSpan);
    container.appendChild(toolbar);

    // 批量操作栏（默认隐藏）
    const batchBar = doc.createElement('div');
    batchBar.className = 'cm-gallery-batch-bar';
    batchBar.style.cssText = 'display:none;padding:10px;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);align-items:center;gap:10px;';
    batchBar.innerHTML = `
        <span style="font-size:13px;">已选 <strong class="cm-gallery-sel-count">0</strong> 张</span>
        <div style="flex:1"></div>
        <button class="cm-btn cm-btn-secondary cm-gallery-select-all">全选</button>
        <button class="cm-btn cm-btn-secondary cm-gallery-clear-sel">取消</button>
        <button class="cm-btn cm-btn-danger cm-gallery-del-sel">${ICONS.trash} 删除</button>
    `;
    container.appendChild(batchBar);

    // 拖拽上传区域
    const dropzone = doc.createElement('div');
    dropzone.className = 'cm-gallery-dropzone';
    dropzone.style.cssText = 'display:none;padding:20px;border:2px dashed var(--cm-accent);background:var(--cm-bg-ter);text-align:center;margin:10px;border-radius:8px;color:var(--cm-accent);';
    dropzone.innerHTML = '拖放图片到这里上传';
    container.appendChild(dropzone);

    // 图片网格
    const grid = doc.createElement('div');
    grid.className = 'cm-gallery-grid';
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill, minmax(120px, 1fr));gap:10px;padding:10px;overflow-y:auto;flex:1;min-height:0;';
    container.appendChild(grid);

    // 渲染逻辑
    let renderBatchSize = 20;
    let renderedCount = 0;
    let isRendering = false;

    function renderNextBatch() {
        if (isRendering) return;
        isRendering = true;

        const fragment = doc.createDocumentFragment();
        const endIdx = Math.min(renderedCount + renderBatchSize, items.length);

        for (let idx = renderedCount; idx < endIdx; idx++) {
            const item = items[idx];
            const cell = doc.createElement('div');
            cell.className = 'cm-gallery-cell' + (selectedItems.has(idx) ? ' selected' : '');
            cell.style.cssText = 'position:relative;aspect-ratio:2/3;background:var(--cm-bg-ter);border-radius:4px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:all 0.2s;';
            if (selectedItems.has(idx)) cell.style.borderColor = 'var(--cm-accent)';
            
            cell.dataset.index = idx;
            cell.innerHTML = `
                <img data-src="${item.src}" alt="${escapeHtml(item.name)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.3s">
                ${batchMode ? '<div class="cm-gallery-checkbox" style="position:absolute;top:4px;right:4px;width:18px;height:18px;background:rgba(0,0,0,0.5);border:1px solid #fff;border-radius:3px;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;">' + (selectedItems.has(idx) ? '✓' : '') + '</div>' : ''}
            `;
            
            const img = cell.querySelector('img');
            img.onload = () => { img.style.opacity = '1'; };
            img.src = item.src;

            const capturedIdx = idx;
            cell.onclick = () => {
                if (batchMode) {
                    if (selectedItems.has(capturedIdx)) {
                        selectedItems.delete(capturedIdx);
                        cell.style.borderColor = 'transparent';
                        cell.querySelector('.cm-gallery-checkbox').textContent = '';
                    } else {
                        selectedItems.add(capturedIdx);
                        cell.style.borderColor = 'var(--cm-accent)';
                        cell.querySelector('.cm-gallery-checkbox').textContent = '✓';
                    }
                    updateBatchCount();
                } else {
                    // 打开灯箱
                    const viewer = new GalleryViewer(items, capturedIdx, {
                        onDelete: async (item, idx) => {
                            if (await showConfirm(`确定删除图片 "${item.name}" 吗？`)) {
                                const success = await deleteGalleryImage(item.src);
                                if (success) {
                                    notify('图片已删除', 'success');
                                    items.splice(idx, 1);
                                    // 刷新网格
                                    renderGrid();
                                    countSpan.textContent = `${items.length} 张图片`;
                                    return true;
                                }
                            }
                            return false;
                        },
                        onDownload: (item) => {
                            downloadImage(item.src, item.name);
                        },
                        onSetCover: async (item) => {
                            try {
                                const croppedBlob = await showImageCropper(item.src, item.name);
                                if (!croppedBlob) return;

                                const file = new File([croppedBlob], item.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' });
                                await replaceCharacterImage(char, file);
                                notify('封面已更换', 'success');
                                
                                // 更新 UI
                                const cardImg = doc.querySelector(`.cm-card[data-file="${CSS.escape(char.fileName)}"] .cm-card-img`);
                                if (cardImg) cardImg.src = char.avatarUrl;
                                const detailAvatar = doc.querySelector('.cm-detail-avatar');
                                if (detailAvatar) detailAvatar.src = char.avatarUrl;
                            } catch (err) {
                                notify('设置封面失败: ' + err.message, 'error');
                            }
                        }
                    });
                    viewer.show();
                }
            };
            fragment.appendChild(cell);
        }

        grid.appendChild(fragment);
        renderedCount = endIdx;
        isRendering = false;

        // 如果还有数据，且没有填满容器（或者没有滚动条），继续加载
        if (renderedCount < items.length && grid.scrollHeight <= grid.clientHeight) {
            setTimeout(renderNextBatch, 0);
        }
    }

    function renderGrid() {
        grid.innerHTML = '';
        renderedCount = 0;
        renderNextBatch();
    }

    function updateBatchCount() {
        const el = batchBar.querySelector('.cm-gallery-sel-count');
        if (el) el.textContent = selectedItems.size;
    }

    // 滚动加载
    grid.onscroll = () => {
        if (renderedCount < items.length &&
            grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200) {
            renderNextBatch();
        }
    };

    // 初始渲染
    renderGrid();

    // 事件绑定
    
    // 批量模式切换
    batchBtn.onclick = () => {
        batchMode = !batchMode;
        batchBar.style.display = batchMode ? 'flex' : 'none';
        batchBtn.classList.toggle('active', batchMode);
        if (!batchMode) {
            selectedItems.clear();
            renderGrid(); // 重绘以移除复选框
        } else {
            renderGrid(); // 重绘以显示复选框
        }
    };

    // 全选
    batchBar.querySelector('.cm-gallery-select-all').onclick = () => {
        items.forEach((_, idx) => selectedItems.add(idx));
        updateBatchCount();
        renderGrid();
    };

    // 取消选择
    batchBar.querySelector('.cm-gallery-clear-sel').onclick = () => {
        selectedItems.clear();
        updateBatchCount();
        renderGrid();
    };

    // 删除选中
    batchBar.querySelector('.cm-gallery-del-sel').onclick = async () => {
        if (selectedItems.size === 0) return;
        if (await showConfirm(`确定删除选中的 ${selectedItems.size} 张图片吗？`)) {
            const toDelete = Array.from(selectedItems).sort((a, b) => b - a);
            let successCount = 0;
            for (const idx of toDelete) {
                if (await deleteGalleryImage(items[idx].src)) {
                    items.splice(idx, 1);
                    successCount++;
                }
            }
            selectedItems.clear();
            updateBatchCount();
            renderGrid();
            countSpan.textContent = `${items.length} 张图片`;
            notify(`已删除 ${successCount} 张图片`, 'success');
        }
    };

    // 上传按钮
    uploadBtn.onclick = () => {
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            
            let successCount = 0;
            for (const file of files) {
                if (await uploadGalleryImage(char.name, file)) {
                    successCount++;
                }
            }
            
            if (successCount > 0) {
                notify(`成功上传 ${successCount} 张图片`, 'success');
                // 重新获取列表并刷新
                const newItems = await getGalleryItems(char.name);
                items.length = 0;
                items.push(...newItems);
                renderGrid();
                countSpan.textContent = `${items.length} 张图片`;
            }
        };
        input.click();
    };

    // 拖拽上传
    let dragCounter = 0;
    container.ondragenter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        dropzone.style.display = 'block';
    };
    container.ondragleave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter === 0) dropzone.style.display = 'none';
    };
    container.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    container.ondrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        dropzone.style.display = 'none';
        
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;

        let successCount = 0;
        for (const file of files) {
            if (await uploadGalleryImage(char.name, file)) {
                successCount++;
            }
        }

        if (successCount > 0) {
            notify(`成功上传 ${successCount} 张图片`, 'success');
            const newItems = await getGalleryItems(char.name);
            items.length = 0;
            items.push(...newItems);
            renderGrid();
            countSpan.textContent = `${items.length} 张图片`;
        }
    };
}

// 创建画廊预览窗口 (旧版实现)
export function showGallery(char, items, notifyFn, showConfirmFn, replaceCharacterImageFn) {
    // 使用传入的函数或导入的函数
    const _notify = notifyFn || notify;
    const _showConfirm = showConfirmFn || showConfirm;
    const _replaceCharacterImage = replaceCharacterImageFn || replaceCharacterImage;

    if (!items) items = [];
    // if (!items || items.length === 0) {
    //     _notify('画廊为空', 'warning');
    //     return;
    // }

    // 状态
    let currentIndex = 0;
    let batchMode = false;
    let selectedItems = new Set();

    // 创建遮罩层
    const overlay = doc.createElement('div');
    overlay.className = 'cm-gallery-overlay ' + (state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light');

    // 创建容器
    const container = doc.createElement('div');
    container.className = 'cm-gallery-container';

    // 头部
    const header = doc.createElement('div');
    header.className = 'cm-gallery-header';
    header.innerHTML = `
        <div class="cm-gallery-title">${ICONS.gallery} ${escapeHtml(char.name)} 的画廊 <span class="cm-gallery-count">(${items.length}张)</span> <span style="font-size:0.8em;opacity:0.7;font-weight:normal;">(支持拖拽上传)</span></div>
        <div class="cm-gallery-actions">
            <button class="cm-btn cm-btn-primary cm-gallery-upload-btn" title="上传图片">${ICONS.upload} 上传</button>
            <button class="cm-btn cm-btn-secondary cm-gallery-batch-btn">${ICONS.checkSquare} 批量模式</button>
            <button class="cm-gallery-close">${ICONS.close}</button>
        </div>
    `;
    container.appendChild(header);

    // 上传功能
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    
    const handleFiles = async (files) => {
        if (files.length === 0) return;
        
        let successCount = 0;
        const total = files.length;
        
        for (let i = 0; i < total; i++) {
            const file = files[i];
            // 简单的进度提示
            if (total > 1) _notify(`正在上传 ${i+1}/${total}...`, 'info');
            
            if (await uploadGalleryImage(char.name, file)) {
                successCount++;
            }
        }
        
        if (successCount > 0) {
            _notify(`成功上传 ${successCount} 张图片`, 'success');
            // 刷新列表
            const newItems = await getGalleryItems(char.name);
            items.length = 0;
            items.push(...newItems);
            
            // 更新计数
            header.querySelector('.cm-gallery-count').textContent = `(${items.length}张)`;
            char.galleryCount = items.length;
            galleryCountCache[char.name] = items.length;
            saveGalleryCountCache();
            
            renderGrid();
        } else {
            _notify('上传失败', 'error');
        }
    };

    fileInput.onchange = (e) => handleFiles(Array.from(e.target.files));
    
    header.querySelector('.cm-gallery-upload-btn').onclick = () => fileInput.click();

    // 拖拽上传
    container.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.add('drag-over');
    };
    container.ondragleave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('drag-over');
    };
    container.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        container.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        handleFiles(files);
    };

    // 批量操作栏（默认隐藏）
    const batchBar = doc.createElement('div');
    batchBar.className = 'cm-gallery-batch-bar';
    batchBar.style.display = 'none';
    batchBar.innerHTML = `
        <span>已选 <strong class="cm-gallery-sel-count">0</strong> 张</span>
        <button class="cm-btn cm-btn-secondary cm-gallery-select-all">全选</button>
        <button class="cm-btn cm-btn-secondary cm-gallery-clear-sel">取消选择</button>
        <button class="cm-btn cm-btn-danger cm-gallery-del-sel">${ICONS.trash} 删除选中</button>
    `;
    container.appendChild(batchBar);

    // 图片网格
    const grid = doc.createElement('div');
    grid.className = 'cm-gallery-grid';
    container.appendChild(grid);

    // 分批渲染，每批20个，避免一次性加载太多图片导致卡顿
    let renderBatchSize = 20;
    let renderedCount = 0;
    let isRendering = false;

    function renderGrid() {
        grid.innerHTML = '';
        renderedCount = 0;
        renderNextBatch();
    }

    function renderNextBatch() {
        if (isRendering) return;
        isRendering = true;

        const fragment = doc.createDocumentFragment();
        const endIdx = Math.min(renderedCount + renderBatchSize, items.length);

        for (let idx = renderedCount; idx < endIdx; idx++) {
            const item = items[idx];
            const cell = doc.createElement('div');
            cell.className = 'cm-gallery-cell' + (selectedItems.has(idx) ? ' selected' : '');
            cell.dataset.index = idx;
            cell.innerHTML = `
                <img data-src="${item.src}" alt="${escapeHtml(item.name)}" loading="lazy" style="opacity:0;transition:opacity 0.3s">
                ${batchMode ? '<div class="cm-gallery-checkbox">' + (selectedItems.has(idx) ? '✓' : '') + '</div>' : ''}
            `;
            // 懒加载图片
            const img = cell.querySelector('img');
            img.onload = () => { img.style.opacity = '1'; };
            img.src = item.src;

            const capturedIdx = idx;
            cell.onclick = () => {
                if (batchMode) {
                    if (selectedItems.has(capturedIdx)) {
                        selectedItems.delete(capturedIdx);
                        cell.classList.remove('selected');
                        cell.querySelector('.cm-gallery-checkbox').textContent = '';
                    } else {
                        selectedItems.add(capturedIdx);
                        cell.classList.add('selected');
                        cell.querySelector('.cm-gallery-checkbox').textContent = '✓';
                    }
                    updateBatchCount();
                } else {
                    showLightbox(capturedIdx);
                }
            };
            fragment.appendChild(cell);
        }

        grid.appendChild(fragment);
        renderedCount = endIdx;
        isRendering = false;

        // 如果还有更多图片，监听滚动继续加载
        if (renderedCount < items.length) {
            requestAnimationFrame(() => {
                if (grid.scrollHeight <= grid.clientHeight + 100) {
                    // 内容不够，继续加载
                    renderNextBatch();
                }
            });
        }
    }

    // 滚动加载更多
    grid.onscroll = () => {
        if (renderedCount < items.length &&
            grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 200) {
            renderNextBatch();
        }
    };

    // 更新批量选择计数
    function updateBatchCount() {
        const countEl = batchBar.querySelector('.cm-gallery-sel-count');
        if (countEl) countEl.textContent = selectedItems.size;
    }

    // 灯箱模式
    function showLightbox(startIndex) {
        currentIndex = startIndex;

        const lightbox = doc.createElement('div');
        lightbox.className = 'cm-gallery-lightbox ' + (state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light');

        // 缩略图容器
        const thumbsContainer = doc.createElement('div');
        thumbsContainer.className = 'cm-lightbox-thumbs';

        function renderThumbs() {
            thumbsContainer.innerHTML = '';
            items.forEach((item, idx) => {
                const thumb = doc.createElement('div');
                thumb.className = 'cm-lightbox-thumb' + (idx === currentIndex ? ' active' : '');
                thumb.innerHTML = `<img src="${item.src}" loading="lazy">`;
                thumb.onclick = () => {
                    currentIndex = idx;
                    updateLightbox();
                };
                thumbsContainer.appendChild(thumb);
            });
            // 滚动到当前选中的缩略图
            setTimeout(() => {
                const activeThumb = thumbsContainer.querySelector('.active');
                if (activeThumb) {
                    activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            }, 0);
        }

        function updateLightbox() {
            const item = items[currentIndex];
            // 清空除了缩略图容器以外的内容
            lightbox.innerHTML = '';
            
            const content = doc.createElement('div');
            content.className = 'cm-lightbox-content';
            content.innerHTML = `
                <div class="cm-lightbox-header">
                    <span class="cm-lightbox-counter">${currentIndex + 1} / ${items.length}</span>
                    <span class="cm-lightbox-filename">${escapeHtml(item.name)}</span>
                    <div class="cm-lightbox-actions">
                        <button class="cm-btn cm-btn-primary cm-lightbox-set-cover" title="设为角色封面">${ICONS.camera} 设为封面</button>
                        <button class="cm-btn cm-btn-secondary cm-lightbox-download" title="下载">${ICONS.download}</button>
                        <button class="cm-btn cm-btn-danger cm-lightbox-delete" title="删除">${ICONS.trash}</button>
                        <button class="cm-lightbox-close">${ICONS.close}</button>
                    </div>
                </div>
                <div class="cm-lightbox-body">
                    <button class="cm-lightbox-nav cm-lightbox-prev" ${currentIndex <= 0 ? 'disabled' : ''}>${ICONS.chevronLeft}</button>
                    <div class="cm-lightbox-img-wrap">
                        <img src="${item.src}" alt="${escapeHtml(item.name)}">
                    </div>
                    <button class="cm-lightbox-nav cm-lightbox-next" ${currentIndex >= items.length - 1 ? 'disabled' : ''}>${ICONS.chevronRight}</button>
                </div>
            `;
            
            lightbox.appendChild(content);
            lightbox.appendChild(thumbsContainer);
            renderThumbs();

            // 绑定事件
            content.querySelector('.cm-lightbox-close').onclick = () => lightbox.remove();
            content.querySelector('.cm-lightbox-prev').onclick = () => {
                if (currentIndex > 0) { currentIndex--; updateLightbox(); }
            };
            content.querySelector('.cm-lightbox-next').onclick = () => {
                if (currentIndex < items.length - 1) { currentIndex++; updateLightbox(); }
            };
            content.querySelector('.cm-lightbox-download').onclick = () => {
                downloadImage(item.src, item.name);
            };
            content.querySelector('.cm-lightbox-delete').onclick = async () => {
                const confirmed = await _showConfirm(`确定删除图片 "${item.name}" 吗？`);
                if (!confirmed) return;
                const success = await deleteGalleryImage(item.src);
                if (success) {
                    _notify('图片已删除', 'success');
                    items.splice(currentIndex, 1);
                    // 更新缓存
                    char.galleryCount = items.length;
                    galleryCountCache[char.name] = items.length;
                    saveGalleryCountCache();
                    if (items.length === 0) {
                        lightbox.remove();
                        overlay.remove();
                        return;
                    }
                    if (currentIndex >= items.length) currentIndex = items.length - 1;
                    updateLightbox();
                    renderGrid();
                    // 更新标题计数
                    header.querySelector('.cm-gallery-count').textContent = `(${items.length}张)`;
                } else {
                    _notify('删除失败', 'error');
                }
            };
            // 设为封面按钮
            content.querySelector('.cm-lightbox-set-cover').onclick = async () => {
                if (!_replaceCharacterImage) {
                    _notify('设置封面功能不可用', 'error');
                    return;
                }
                try {
                    // 打开裁剪器
                    const croppedBlob = await showImageCropper(item.src, item.name);
                    if (!croppedBlob) return;

                    const file = new File([croppedBlob], item.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' });
                    await _replaceCharacterImage(char, file);
                    _notify('封面已更换', 'success');
                    // 更新卡片上的图片
                    const cardImg = doc.querySelector(`.cm-card[data-file="${CSS.escape(char.fileName)}"] .cm-card-img`);
                    if (cardImg) cardImg.src = char.avatarUrl;
                    // 更新详情页的头像
                    const detailAvatar = doc.querySelector('.cm-detail-avatar');
                    if (detailAvatar) detailAvatar.src = char.avatarUrl;
                } catch (err) {
                    _notify('设置封面失败: ' + err.message, 'error');
                }
            };
        }

        // 键盘导航
        function handleKeydown(e) {
            if (e.key === 'ArrowLeft' && currentIndex > 0) {
                currentIndex--;
                updateLightbox();
            } else if (e.key === 'ArrowRight' && currentIndex < items.length - 1) {
                currentIndex++;
                updateLightbox();
            } else if (e.key === 'Escape') {
                lightbox.remove();
                doc.removeEventListener('keydown', handleKeydown);
            }
        }
        doc.addEventListener('keydown', handleKeydown);

        // 移除点击背景关闭逻辑，仅保留关闭按钮和 Esc 关闭

        updateLightbox();
        doc.body.appendChild(lightbox);
    }

    // 批量模式按钮
    header.querySelector('.cm-gallery-batch-btn').onclick = () => {
        batchMode = !batchMode;
        batchBar.style.display = batchMode ? 'flex' : 'none';
        header.querySelector('.cm-gallery-batch-btn').classList.toggle('active', batchMode);
        if (!batchMode) {
            selectedItems.clear();
            updateBatchCount();
        }
        renderGrid();
    };

    // 全选
    batchBar.querySelector('.cm-gallery-select-all').onclick = () => {
        items.forEach((_, idx) => selectedItems.add(idx));
        updateBatchCount();
        renderGrid();
    };

    // 取消选择
    batchBar.querySelector('.cm-gallery-clear-sel').onclick = () => {
        selectedItems.clear();
        updateBatchCount();
        renderGrid();
    };

    // 删除选中
    batchBar.querySelector('.cm-gallery-del-sel').onclick = async () => {
        if (selectedItems.size === 0) {
            _notify('请先选择图片', 'warning');
            return;
        }
        const confirmed = await _showConfirm(`确定删除选中的 ${selectedItems.size} 张图片吗？`);
        if (!confirmed) return;

        const toDelete = Array.from(selectedItems).sort((a, b) => b - a); // 倒序删除
        let successCount = 0;
        for (const idx of toDelete) {
            const success = await deleteGalleryImage(items[idx].src);
            if (success) {
                items.splice(idx, 1);
                successCount++;
            }
        }
        selectedItems.clear();
        updateBatchCount();
        renderGrid();
        header.querySelector('.cm-gallery-count').textContent = `(${items.length}张)`;
        _notify(`已删除 ${successCount} 张图片`, 'success');

        // 更新缓存
        char.galleryCount = items.length;
        galleryCountCache[char.name] = items.length;
        saveGalleryCountCache();

        if (items.length === 0) {
            overlay.remove();
        }
    };

    // 关闭按钮
    header.querySelector('.cm-gallery-close').onclick = () => overlay.remove();

    // 点击遮罩关闭
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    // ESC关闭
    function handleOverlayKeydown(e) {
        if (e.key === 'Escape' && !doc.querySelector('.cm-gallery-lightbox')) {
            overlay.remove();
            doc.removeEventListener('keydown', handleOverlayKeydown);
        }
    }
    doc.addEventListener('keydown', handleOverlayKeydown);

    overlay.appendChild(container);
    doc.body.appendChild(overlay);
    renderGrid();
}
