/**
 * 高级画廊灯箱 (Lightbox)
 * 支持缩放、平移、切换、键盘导航
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
    }

    updateImage() {
        if (this.items.length === 0) {
            this.close();
            return;
        }

        if (this.currentIndex >= this.items.length) this.currentIndex = this.items.length - 1;
        if (this.currentIndex < 0) this.currentIndex = 0;

        const item = this.items[this.currentIndex];
        
        // Reset zoom/pan
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.updateTransform();

        this.img.src = item.src;
        this.img.alt = item.name;
        this.counterEl.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
        this.filenameEl.textContent = item.name;

        // Update nav buttons state
        this.overlay.querySelector('.cm-lightbox-prev').disabled = this.currentIndex <= 0;
        this.overlay.querySelector('.cm-lightbox-next').disabled = this.currentIndex >= this.items.length - 1;
    }

    updateTransform() {
        this.img.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        this.zoomLevelEl.textContent = Math.round(this.scale * 100) + '%';
    }

    bindEvents() {
        // Close
        this.overlay.querySelector('.cm-lightbox-close').onclick = () => this.close();
        
        // Navigation
        this.overlay.querySelector('.cm-lightbox-prev').onclick = () => this.prev();
        this.overlay.querySelector('.cm-lightbox-next').onclick = () => this.next();

        // Actions
        this.overlay.querySelector('.cm-lightbox-download').onclick = () => {
            if (this.options.onDownload) this.options.onDownload(this.items[this.currentIndex]);
        };
        this.overlay.querySelector('.cm-lightbox-delete').onclick = async () => {
            if (this.options.onDelete) {
                const success = await this.options.onDelete(this.items[this.currentIndex], this.currentIndex);
                if (success) {
                    // Item removed from array by caller, just update view
                    this.updateImage();
                }
            }
        };
        this.overlay.querySelector('.cm-lightbox-set-cover').onclick = () => {
            if (this.options.onSetCover) this.options.onSetCover(this.items[this.currentIndex]);
        };

        // Zoom Controls
        this.overlay.querySelector('.cm-zoom-in').onclick = () => this.zoom(0.1);
        this.overlay.querySelector('.cm-zoom-out').onclick = () => this.zoom(-0.1);
        this.overlay.querySelector('.cm-zoom-reset').onclick = () => {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this.updateTransform();
        };

        // Keyboard
        this.overlay.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.prev();
            else if (e.key === 'ArrowRight') this.next();
            else if (e.key === 'Escape') this.close();
            else if (e.key === '+' || e.key === '=') this.zoom(0.1);
            else if (e.key === '-' || e.key === '_') this.zoom(-0.1);
            else if (e.key === '0') {
                this.scale = 1;
                this.translateX = 0;
                this.translateY = 0;
                this.updateTransform();
            }
        });

        // Mouse Wheel Zoom
        this.overlay.querySelector('.cm-lightbox-viewport').addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            this.zoom(delta);
        });

        // Drag to Pan
        const viewport = this.overlay.querySelector('.cm-lightbox-viewport');
        
        viewport.addEventListener('mousedown', (e) => {
            if (e.target !== this.img && e.target !== viewport) return;
            e.preventDefault();
            this.isDragging = true;
            this.startX = e.clientX - this.translateX;
            this.startY = e.clientY - this.translateY;
            viewport.style.cursor = 'grabbing';
        });

        doc.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            e.preventDefault();
            this.translateX = e.clientX - this.startX;
            this.translateY = e.clientY - this.startY;
            this.updateTransform();
        });

        doc.addEventListener('mouseup', () => {
            this.isDragging = false;
            viewport.style.cursor = 'default';
        });
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
        this.scale += delta;
        if (this.scale < 0.1) this.scale = 0.1;
        if (this.scale > 5) this.scale = 5;
        this.updateTransform();
    }
}