/**
 * 高级画廊灯箱 (Lightbox)
 * 支持缩放、平移、切换、键盘导航
 * 支持单击图片放大/还原，放大后可拖拽平移
 */
import { doc } from './context.js';
import { ICONS } from './constants.js';
import { escapeHtml } from './utils.js';
import { state } from './state.js';

export class GalleryViewer {
    constructor(items, startIndex, options = {}) {
        this.items = items;
        this.currentIndex = startIndex;
        this.options = options; // { onDelete, onSetCover, onDownload }
        
        this.overlay = null;
        this.img = null;
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.isZoomed = false; // 是否处于放大状态
        this.baseScale = 1; // 初始适配缩放比例
    }

    show() {
        this.overlay = doc.createElement('div');
        this.overlay.className = 'cm-gallery-lightbox ' + (state.isDarkMode ? 'cm-theme-dark' : 'cm-theme-light');
        this.overlay.tabIndex = -1; // Make focusable for keyboard events

        this.render();
        doc.body.appendChild(this.overlay);
        this.overlay.focus();

        this.bindEvents();
        this.updateImage();
    }

    close() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }

    render() {
        this.overlay.innerHTML = `
            <div class="cm-lightbox-header">
                <span class="cm-lightbox-counter"></span>
                <span class="cm-lightbox-filename"></span>
                <div class="cm-lightbox-actions">
                    <button class="cm-btn cm-btn-primary cm-lightbox-set-cover" title="设为角色封面">${ICONS.camera} 设为封面</button>
                    <button class="cm-btn cm-btn-secondary cm-lightbox-download" title="下载">${ICONS.download}</button>
                    <button class="cm-btn cm-btn-danger cm-lightbox-delete" title="删除">${ICONS.trash}</button>
                    <button class="cm-lightbox-close">${ICONS.close}</button>
                </div>
            </div>
            <div class="cm-lightbox-body">
                <button class="cm-lightbox-nav cm-lightbox-prev">${ICONS.chevronLeft}</button>
                <div class="cm-lightbox-viewport">
                    <div class="cm-lightbox-img-wrap">
                        <img class="cm-lightbox-img" src="" alt="">
                    </div>
                </div>
                <button class="cm-lightbox-nav cm-lightbox-next">${ICONS.chevronRight}</button>
            </div>
            <div class="cm-lightbox-zoom-controls">
                <button class="cm-zoom-out" title="缩小">-</button>
                <span class="cm-zoom-level">100%</span>
                <button class="cm-zoom-in" title="放大">+</button>
                <button class="cm-zoom-reset" title="重置">1:1</button>
            </div>
        `;

        this.img = this.overlay.querySelector('.cm-lightbox-img');
        this.counterEl = this.overlay.querySelector('.cm-lightbox-counter');
        this.filenameEl = this.overlay.querySelector('.cm-lightbox-filename');
        this.zoomLevelEl = this.overlay.querySelector('.cm-zoom-level');
        this.viewport = this.overlay.querySelector('.cm-lightbox-viewport');
    }

    updateImage() {
        if (this.items.length === 0) {
            this.close();
            return;
        }

        if (this.currentIndex >= this.items.length) this.currentIndex = this.items.length - 1;
        if (this.currentIndex < 0) this.currentIndex = 0;

        const item = this.items[this.currentIndex];
        
        // 重置缩放/平移状态
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.isZoomed = false;
        this.baseScale = 1;
        this.updateTransform();

        this.img.src = item.src;
        this.img.alt = item.name;
        this.counterEl.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
        this.filenameEl.textContent = item.name;

        // 更新导航按钮状态
        this.overlay.querySelector('.cm-lightbox-prev').disabled = this.currentIndex <= 0;
        this.overlay.querySelector('.cm-lightbox-next').disabled = this.currentIndex >= this.items.length - 1;

        // 图片加载后计算初始适配缩放
        this.img.onload = () => {
            this.calculateBaseScale();
        };
        // 如果图片已缓存，立即计算
        if (this.img.complete) {
            this.calculateBaseScale();
        }
    }

    /**
     * 计算图片在视口内完整显示的初始缩放比例
     */
    calculateBaseScale() {
        const viewportRect = this.viewport.getBoundingClientRect();
        const imgW = this.img.naturalWidth;
        const imgH = this.img.naturalHeight;
        const viewW = viewportRect.width;
        const viewH = viewportRect.height;

        // 计算让图片完整显示在视口内的缩放比例
        const scaleX = viewW / imgW;
        const scaleY = viewH / imgH;
        this.baseScale = Math.min(scaleX, scaleY, 1); // 不超过 1:1

        // 设置初始状态：完整显示，不裁切
        this.scale = this.baseScale;
        this.isZoomed = false;
        this.updateTransform();
    }

    updateTransform() {
        this.img.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        this.zoomLevelEl.textContent = Math.round(this.scale * 100) + '%';
        
        // 更新鼠标样式：放大状态时显示可拖拽样式
        if (this.isZoomed && this.scale > this.baseScale) {
            this.viewport.style.cursor = 'grab';
        } else {
            this.viewport.style.cursor = 'default';
        }
    }

    bindEvents() {
        // 关闭按钮
        this.overlay.querySelector('.cm-lightbox-close').onclick = () => this.close();
        
        // 导航
        this.overlay.querySelector('.cm-lightbox-prev').onclick = () => this.prev();
        this.overlay.querySelector('.cm-lightbox-next').onclick = () => this.next();

        // 操作按钮
        this.overlay.querySelector('.cm-lightbox-download').onclick = () => {
            if (this.options.onDownload) this.options.onDownload(this.items[this.currentIndex]);
        };
        this.overlay.querySelector('.cm-lightbox-delete').onclick = async () => {
            if (this.options.onDelete) {
                const success = await this.options.onDelete(this.items[this.currentIndex], this.currentIndex);
                if (success) {
                    this.updateImage();
                }
            }
        };
        this.overlay.querySelector('.cm-lightbox-set-cover').onclick = () => {
            if (this.options.onSetCover) this.options.onSetCover(this.items[this.currentIndex]);
        };

        // 缩放控制按钮
        this.overlay.querySelector('.cm-zoom-in').onclick = () => this.zoom(0.2);
        this.overlay.querySelector('.cm-zoom-out').onclick = () => this.zoom(-0.2);
        this.overlay.querySelector('.cm-zoom-reset').onclick = () => {
            this.scale = this.baseScale;
            this.translateX = 0;
            this.translateY = 0;
            this.isZoomed = false;
            this.updateTransform();
        };

        // 键盘事件
        this.overlay.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.prev();
            else if (e.key === 'ArrowRight') this.next();
            else if (e.key === 'Escape') this.close();
            else if (e.key === '+' || e.key === '=') this.zoom(0.2);
            else if (e.key === '-' || e.key === '_') this.zoom(-0.2);
            else if (e.key === '0') {
                this.scale = this.baseScale;
                this.translateX = 0;
                this.translateY = 0;
                this.isZoomed = false;
                this.updateTransform();
            }
        });

        // 鼠标滚轮缩放
        this.viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.15 : 0.15;
            this.zoom(delta);
        });

        // 单击图片切换放大/还原
        this.img.onclick = (e) => {
            e.stopPropagation();
            this.toggleZoom();
        };

        // 拖拽平移（仅在放大状态可用）
        this.viewport.addEventListener('mousedown', (e) => {
            // 只有在放大状态才允许拖拽
            if (!this.isZoomed || this.scale <= this.baseScale) return;
            if (e.target !== this.img && e.target !== this.viewport) return;
            e.preventDefault();
            this.isDragging = true;
            this.startX = e.clientX - this.translateX;
            this.startY = e.clientY - this.translateY;
            this.viewport.style.cursor = 'grabbing';
        });

        doc.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            this.translateX = e.clientX - this.startX;
            this.translateY = e.clientY - this.startY;
            this.updateTransform();
        });

        doc.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.updateTransform(); // 更新鼠标样式
            }
        });

        // 移除点击遮罩关闭逻辑，仅保留关闭按钮和 Esc 关闭
        // 不再添加 this.overlay.onclick 事件
    }

    /**
     * 切换放大/还原状态
     */
    toggleZoom() {
        if (this.isZoomed && this.scale > this.baseScale) {
            // 当前是放大状态，还原
            this.scale = this.baseScale;
            this.translateX = 0;
            this.translateY = 0;
            this.isZoomed = false;
        } else {
            // 当前是初始状态，放大到 2 倍
            this.scale = this.baseScale * 2;
            this.translateX = 0;
            this.translateY = 0;
            this.isZoomed = true;
        }
        this.updateTransform();
    }

    prev() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.updateImage();
        }
    }

    next() {
        if (this.currentIndex < this.items.length - 1) {
            this.currentIndex++;
            this.updateImage();
        }
    }

    zoom(delta) {
        const oldScale = this.scale;
        this.scale += delta;
        if (this.scale < 0.1) this.scale = 0.1;
        if (this.scale > 5) this.scale = 5;
        
        // 判断是否处于放大状态
        this.isZoomed = this.scale > this.baseScale;
        
        this.updateTransform();
    }
}