'use strict';

(function () {
    console.log('=== 角色卡管理器 (v89.2 搜索优化版) 启动 ===');

    let doc = document;
    let parentWin = window;

    try {
        if (window.parent && window.parent.document !== document) {
            doc = window.parent.document;
            parentWin = window.parent;
        }
    } catch (e) { }

    const MODAL_ID = 'charManagerModal';
    const STYLE_ID = 'charManagerStylesV97';
    const BUTTON_ID = 'charManagerBtn';

    // --- UI素材 --- //
    const ICONS = {
        folder: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
        menu: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>',
        settings: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
        search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
        refresh: '<svg class="cm-spin-target" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>',
        close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
        trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
        star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>',
        download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
        dupe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="8" height="8" rx="2" ry="2"></rect><rect x="14" y="14" width="8" height="8" rx="2" ry="2"></rect><line x1="10" y1="10" x2="14" y2="14"></line></svg>',
        time: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
        sortAlpha: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 10l5 5 5-5"/><path d="M4 6h7"/><path d="M4 12h7"/><path d="M4 18h7"/></svg>',
        arrowUp: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>',
        arrowDown: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>',
        moon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
        sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
        pencil: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>',
        rocket: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="M12 15l-3-3a22 22 0 0 1 2-7 24 24 0 0 1 7 2c.42.42.5.93.3 1.3L15 12"></path></svg>',
        user: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>',
        box: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>',
        chat: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>',
        zoomIn: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>',
        zoomOut: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>',
        camera: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
        upload: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
        pinReal: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>',
        sortList: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>'
    };

    const COLORS = [
        { name: '红色', value: 'rgba(220, 38, 38, 1)' },
        { name: '橙色', value: 'rgba(234, 88, 12, 1)' },
        { name: '黄色', value: 'rgba(202, 138, 4, 1)' },
        { name: '绿色', value: 'rgba(22, 163, 74, 1)' },
        { name: '青色', value: 'rgba(6, 182, 212, 1)' },
        { name: '蓝色', value: 'rgba(37, 99, 235, 1)' },
        { name: '紫色', value: 'rgba(147, 51, 234, 1)' },
        { name: '粉色', value: 'rgba(219, 39, 119, 1)' },
        { name: '灰色', value: 'rgba(100, 100, 100, 1)' }
    ];

    const DEFAULT_TAG_COLOR = COLORS.find(c => c.name === '灰色').value;

    const savedTheme = localStorage.getItem('cm_theme_mode');
    const initialDarkMode = savedTheme === null ? true : (savedTheme === 'dark');
    const savedZoom = localStorage.getItem('cm_zoom_level');
    const initialZoom = savedZoom ? parseInt(savedZoom) : 160;

    let defaultSidebarWidth = 160;
    try {
        if (window.innerWidth < 600) defaultSidebarWidth = 120;
    } catch (e) { }
    const savedSidebarWidth = parseInt(localStorage.getItem('cm_sidebar_width')) || defaultSidebarWidth;

    const state = {
        characters: (() => { try { return JSON.parse(localStorage.getItem('cm_char_cache') || '[]'); } catch (e) { return []; } })(),
        duplicateGroups: [],
        selectedCards: new Set(),
        isScanning: false,
        currentView: 'all',
        currentTag: null,
        tags: [],
        tagMap: {},
        currentDetailChar: null,
        searchQuery: '',
        tagSearchQuery: '',
        tagBatchMode: false,
        isSidebarVisible: true,
        sortBy: 'date',
        sortOrder: 'desc',
        isDarkMode: initialDarkMode,
        zoomLevel: initialZoom,
        lastSelectedIndex: -1,
        isTouchSelecting: false,
        tagSortMode: 'name',
        sidebarWidth: savedSidebarWidth,
        randomMode: localStorage.getItem('cm_random_mode') || 'all',

        // --- Infinite Scroll State ---
        filteredList: [],
        renderedCount: 0,
        BATCH_SIZE: 50,
        observer: null
    };

    function log(msg) { console.log('[CharManager]', msg); }

    function getSTContext() {
        const st = parentWin.SillyTavern || window.SillyTavern;
        return st ? st.getContext() : null;
    }

    function getSTCharacters() {
        if (parentWin.characters && Array.isArray(parentWin.characters)) return parentWin.characters;
        const ctx = getSTContext();
        if (ctx && ctx.characters) return ctx.characters;
        return [];
    }

    async function loadJSZip() {
        if (parentWin.JSZip) return parentWin.JSZip;
        if (window.JSZip) return window.JSZip;
        return new Promise((resolve, reject) => {
            const script = doc.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            script.onload = () => resolve(window.JSZip || parentWin.JSZip);
            script.onerror = () => reject(new Error('无法加载 JSZip 库'));
            doc.head.appendChild(script);
        });
    }

    function getAuthHeaders() {
        try {
            if (parentWin && typeof parentWin.getRequestHeaders === 'function') {
                return parentWin.getRequestHeaders();
            }
        } catch (e) { }
        try {
            if (typeof getRequestHeaders === 'function') {
                return getRequestHeaders();
            }
        } catch (e) { }
        try {
            const ctx = getSTContext();
            if (ctx && ctx.getRequestHeaders) {
                return ctx.getRequestHeaders();
            }
        } catch (e) { }
        return { 'Content-Type': 'application/json' };
    }

    async function authFetch(url, opt = {}) {
        const headers = getAuthHeaders();
        if (opt.body instanceof FormData) {
            if (headers['Content-Type']) delete headers['Content-Type'];
        }
        opt.headers = Object.assign({}, headers, opt.headers || {});
        opt.credentials = 'same-origin';
        const fetchFn = parentWin.fetch || window.fetch;
        return fetchFn.call(parentWin, url, opt);
    }

    function showAlert(msg) {
        return new Promise(resolve => {
            createBaseDialog('提示', '<div style="padding:10px;text-align:center">' + escapeHtml(msg) + '</div>', [
                { text: '确定', id: 'cmAlertOk', cls: 'cm-btn-primary', onClick: (ov, close) => { close(); resolve(); } }
            ]);
        });
    }

    function showConfirm(msg) {
        return new Promise(resolve => {
            createBaseDialog('确认', '<div style="padding:10px;text-align:left;white-space:pre-wrap;line-height:1.5">' + escapeHtml(msg) + '</div>', [
                { text: '取消', id: 'cmConfirmCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => { close(); resolve(false); } },
                { text: '确定', id: 'cmConfirmOk', cls: 'cm-btn-primary', onClick: (ov, close) => { close(); resolve(true); } }
            ]);
        });
    }

    function showDeleteConfirm(count, wiCount) {
        return new Promise(resolve => {
            let html = `<div style="padding:10px 14px">`;
            html += `<div style="font-size:14px;margin-bottom:12px">确定要删除选中的 <b>${count}</b> 个角色吗？</div>`;
            if (wiCount > 0) {
                html += `<div style="padding:10px;background:var(--cm-bg-ter);border-radius:6px;border:1px solid var(--cm-border)">`;
                html += `<label style="display:flex;align-items:center;cursor:pointer;font-size:13px">`;
                html += `<input type="checkbox" id="cmDelWiCb" checked style="width:16px;height:16px;margin-right:8px">`;
                html += `<span>同时删除 <b>${wiCount}</b> 个关联世界书</span>`;
                html += `</label>`;
                html += `<div style="font-size:11px;color:var(--cm-text-sec);margin-top:4px;margin-left:24px;opacity:0.8">智能检测：仅删除未被其他角色使用的世界书</div>`;
                html += `</div>`;
            }
            html += `</div>`;

            createBaseDialog('删除确认', html, [
                { text: '取消', id: 'cmDelCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => { close(); resolve({ ok: false }); } },
                {
                    text: '确定删除', id: 'cmDelOk', cls: 'cm-btn-danger', onClick: (ov, close) => {
                        const cb = ov.querySelector('#cmDelWiCb');
                        const delWi = cb ? cb.checked : false;
                        close();
                        resolve({ ok: true, delWi: delWi });
                    }
                }
            ]);
        });
    }

    function notify(msg, type = 'info') {
        try {
            if (parentWin.toastr) parentWin.toastr[type](msg);
            else if (typeof toastr !== 'undefined') toastr[type](msg);
            else log(msg);
        } catch (e) { }
    }

    function truncate(t, l) { return !t ? '(无)' : t.length > l ? t.slice(0, l) + '...' : t; }
    function formatSize(b) { if (!b) return '0B'; const k = 1024, s = ['B', 'KB', 'MB']; const i = Math.floor(Math.log(b) / Math.log(k)); return (b / Math.pow(k, i)).toFixed(1) + s[i]; }
    function escapeHtml(t) { if (!t) return ''; const d = doc.createElement('div'); d.textContent = t; return d.innerHTML; }
    function generateId() { return Date.now().toString() + Math.random().toString(36).substr(2, 9); }

    function loadTags() {
        const ctx = getSTContext();
        if (ctx) {
            state.tags = ctx.tags || [];
            state.tagMap = ctx.tagMap || {};
        }
    }

    function saveTags() {
        const ctx = getSTContext();
        if (ctx) {
            ctx.tags = state.tags;
            ctx.tagMap = state.tagMap;
            if (ctx.saveSettingsDebounced) ctx.saveSettingsDebounced();
        }
    }

    function toggleTheme() {
        state.isDarkMode = !state.isDarkMode;
        localStorage.setItem('cm_theme_mode', state.isDarkMode ? 'dark' : 'light');
        applyTheme();
        const themeBtn = doc.getElementById('cmThemeBtn');
        if (themeBtn) {
            themeBtn.innerHTML = state.isDarkMode ? ICONS.moon : ICONS.sun;
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

    async function importFiles(files) {
        if (!files || files.length === 0) return;
        const nativeInput = parentWin.document.getElementById('character_import_file');
        if (!nativeInput) return notify('未找到酒馆原生导入接口', 'error');

        const btn = doc.getElementById('cmImportBtn');
        if (btn) btn.disabled = true;

        try {
            const oldLen = getSTCharacters().length; // 记录导入前的数量
            const dt = new DataTransfer();
            for (const f of files) dt.items.add(f);
            nativeInput.files = dt.files;
            nativeInput.dispatchEvent(new Event('change', { bubbles: true }));

            // 立即显示进度条提示等待
            showProgressBar('正在等待导入完成...', true);

            // 批量导入防抖检测逻辑
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
                        const body = doc.getElementById('cmBody');
                        if (body) body.innerHTML = '';

                        updateProgressBar(80, `导入结束 (新增 ${currentLen - oldLen} 个)，正在同步...`, '');
                        // 传入 skipSync=true，信任本地列表
                        await scan(false, false, true);

                        updateProgressBar(100, '同步完成', '');
                        await new Promise(r => setTimeout(r, 1500));
                        hideProgressBar();

                        state.currentView = 'all';
                        renderView();

                        if (btn) btn.disabled = false;
                        notify(`成功同步 ${currentLen - oldLen} 个新角色`, 'success');
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
                        await scan(false, false, true);
                        state.currentView = 'all';
                        renderView();
                    } else {
                        notify('未检测到新角色导入', 'warning');
                    }
                }
            }, 200);

        } catch (e) {
            notify('导入同步失败', 'error');
            if (btn) btn.disabled = false;
        }
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

    // --- BUG FIXED: Add alternate_greetings explicitly --- 
    async function saveCharacterData(fileName, updateCallback) {
        try {
            const getRes = await authFetch('/api/characters/get', {
                method: 'POST',
                body: JSON.stringify({ avatar_url: fileName })
            });
            if (!getRes.ok) throw new Error('无法读取角色数据');
            const fullData = await getRes.json();

            let charData = fullData;
            if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
                charData = fullData.data;
            }

            updateCallback(charData);

            const fd = new FormData();

            fd.append('ch_name', charData.name || fileName.replace(/\.png$/i, ''));
            fd.append('avatar_url', fileName);
            fd.append('avatar', new Blob([''], { type: 'application/octet-stream' }), '');

            // Removed 'tags' from this list to handle it explicitly
            const fields = [
                'fav', 'description', 'first_mes', 'personality', 'scenario',
                'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions',
                'character_version', 'creator', 'talkativeness'
            ];

            fields.forEach(k => {
                if (charData[k] !== undefined && charData[k] !== null) {
                    fd.append(k, charData[k]);
                }
                if (k === 'fav') {
                    if (charData.extensions && charData.extensions.fav !== undefined) {
                        fd.set('fav', charData.extensions.fav.toString());
                    } else if (charData.fav !== undefined) {
                        fd.set('fav', charData.fav.toString());
                    }
                }
            });

            // Explicitly handle array fields to prevent data loss
            if (charData.alternate_greetings && Array.isArray(charData.alternate_greetings)) {
                charData.alternate_greetings.forEach(g => fd.append('alternate_greetings', g));
            }

            if (charData.tags && Array.isArray(charData.tags)) {
                charData.tags.forEach(t => fd.append('tags', t));
            }

            // 显式处理 character_book 以防止世界书解绑
            if (charData.character_book) {
                if (typeof charData.character_book === 'string') {
                    fd.append('character_book', charData.character_book);
                } else if (typeof charData.character_book === 'object') {
                    // 如果是对象形式，保留完整结构
                    fd.append('character_book', JSON.stringify(charData.character_book));
                }
            }

            if (fullData.data && (fullData.spec === 'chara_card_v3' || fullData.data.name)) {
                fullData.data = charData;
            }
            fd.append('json_data', JSON.stringify(fullData));

            const r = await authFetch('/api/characters/edit', {
                method: 'POST',
                body: fd
            });

            if (!r.ok) {
                const txt = await r.text();
                throw new Error(txt);
            }

            const stChars = getSTCharacters();
            const stChar = stChars.find(c => c.avatar === fileName);
            if (stChar) {
                Object.assign(stChar, charData);
                if (charData.extensions && stChar.data) {
                    stChar.data.extensions = stChar.data.extensions || {};
                    Object.assign(stChar.data.extensions, charData.extensions);
                }
            }

            return true;
        } catch (e) {
            console.error('[CharManager] Save Error:', e);
            throw e;
        }
    }

    async function replaceCharacterImage(char, file) {
        try {
            const img = new Image();
            img.src = URL.createObjectURL(file);
            await new Promise(r => img.onload = r);

            const canvas = doc.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const cleanBlob = await new Promise(r => canvas.toBlob(r, 'image/png'));

            const getRes = await authFetch('/api/characters/get', {
                method: 'POST',
                body: JSON.stringify({ avatar_url: char.fileName })
            });
            if (!getRes.ok) throw new Error('无法读取角色数据');
            const fullData = await getRes.json();

            const dataBlock = fullData.data || fullData;

            const fd = new FormData();
            fd.append('ch_name', dataBlock.name || char.name);
            fd.append('avatar', cleanBlob, file.name);
            fd.append('avatar_url', char.fileName);
            fd.append('json_data', JSON.stringify(fullData));

            const explicitFields = [
                'description', 'first_mes', 'personality', 'scenario',
                'mes_example', 'creator_notes', 'system_prompt',
                'post_history_instructions', 'creator', 'character_version',
                'talkativeness'
            ];

            explicitFields.forEach(k => {
                if (dataBlock[k] !== undefined && dataBlock[k] !== null) {
                    fd.append(k, dataBlock[k]);
                }
            });

            if (Array.isArray(dataBlock.alternate_greetings)) {
                dataBlock.alternate_greetings.forEach(g => fd.append('alternate_greetings', g));
            }
            if (Array.isArray(dataBlock.tags)) {
                dataBlock.tags.forEach(t => fd.append('tags', t));
            }

            const isFav = dataBlock.extensions?.fav || dataBlock.fav;
            fd.append('fav', isFav ? 'true' : 'false');

            // 显式处理 character_book 以防止世界书解绑
            if (dataBlock.character_book) {
                if (typeof dataBlock.character_book === 'string') {
                    fd.append('character_book', dataBlock.character_book);
                } else if (typeof dataBlock.character_book === 'object') {
                    fd.append('character_book', JSON.stringify(dataBlock.character_book));
                }
            }

            const r = await authFetch('/api/characters/edit', {
                method: 'POST',
                body: fd
            });

            if (!r.ok) throw new Error(await r.text());

            char.avatarUrl = '/characters/' + encodeURIComponent(char.fileName) + '?t=' + Date.now();
            return true;
        } catch (e) {
            console.error(e);
            throw new Error('更换图片失败: ' + e.message);
        }
    }

    async function toggleFavorite(fileName, currentFavState) {
        const newState = !currentFavState;
        let isActiveChar = false;
        try {
            const currentChId = parentWin.this_chid;
            if (typeof currentChId !== 'undefined' && parentWin.characters && parentWin.characters[currentChId]) {
                const curName = parentWin.characters[currentChId].avatar.split('/').pop();
                const tarName = fileName.split('/').pop();
                if (curName === tarName) isActiveChar = true;
            }
        } catch (e) { }
        if (isActiveChar) {
            const domBtn = parentWin.document.getElementById('favorite_button');
            if (domBtn) {
                domBtn.click();
                const char = state.characters.find(c => c.fileName === fileName);
                if (char) char.fav = newState;
                notify(newState ? '已收藏 (当前角色)' : '取消收藏 (当前角色)', 'success');
                return newState;
            }
        }
        const char = state.characters.find(c => c.fileName === fileName);
        if (char) char.fav = newState;
        try {
            await saveCharacterData(fileName, (data) => {
                if (!data.extensions) data.extensions = {};
                data.extensions.fav = newState;
                data.fav = newState;
            });
            notify(newState ? '已收藏' : '取消收藏', 'success');
            return newState;
        } catch (e) {
            if (char) char.fav = currentFavState;
            notify('操作失败: ' + e.message, 'error');
            return currentFavState;
        }
    }

    async function updateCreatorComment(char, newComment) {
        try {
            await saveCharacterData(char.fileName, (data) => {
                data.creator_notes = newComment;
                data.creatorcomment = newComment;
            });
            char.creatorcomment = newComment;
            notify('备注已保存 (永久写入)', 'success');
            return true;
        } catch (e) {
            notify('保存失败: ' + e.message, 'error');
            return false;
        }
    }

    async function updateCharacterVersion(char, newVersion) {
        try {
            await saveCharacterData(char.fileName, (data) => {
                data.character_version = newVersion;
            });
            char.version = newVersion;
            notify('版本号已更新', 'success');
            return true;
        } catch (e) {
            notify('版本号更新失败: ' + e.message, 'error');
            return false;
        }
    }

    async function renameCharacterFile(char, newName) {
        if (!newName || newName === char.name) return null;
        try {
            const r = await authFetch('/api/characters/rename', {
                method: 'POST',
                body: JSON.stringify({
                    avatar_url: char.fileName,
                    new_name: newName
                })
            });
            if (!r.ok) throw new Error('重命名失败');

            const data = await r.json();
            const newFileName = (data && data.avatar) ? data.avatar : (newName + '.png');

            const oldFileName = char.fileName;
            if (state.tagMap[oldFileName]) {
                state.tagMap[newFileName] = state.tagMap[oldFileName];
                delete state.tagMap[oldFileName];
                saveTags();
            }
            if (state.selectedCards.has(oldFileName)) {
                state.selectedCards.delete(oldFileName);
                state.selectedCards.add(newFileName);
            }

            char.fileName = newFileName;
            char.name = newName;
            char.avatarUrl = '/characters/' + encodeURIComponent(newFileName);

            notify('重命名成功', 'success');
            return true;
        } catch (e) {
            notify('重命名失败: ' + e.message, 'error');
            return false;
        }
    }

    function getCharTags(fileName) {
        const tagIds = state.tagMap[fileName] || [];
        return tagIds.map(id => state.tags.find(t => t.id === id)).filter(t => t);
    }

    function addTagToChar(fileName, tagId) {
        if (!state.tagMap[fileName]) state.tagMap[fileName] = [];
        if (!state.tagMap[fileName].includes(tagId)) {
            state.tagMap[fileName].push(tagId);
            saveTags();
            return true;
        }
        return false;
    }

    function removeTagFromChar(fileName, tagId) {
        if (state.tagMap[fileName]) {
            const idx = state.tagMap[fileName].indexOf(tagId);
            if (idx > -1) {
                state.tagMap[fileName].splice(idx, 1);
                saveTags();
                return true;
            }
        }
        return false;
    }

    function createTag(name, color) {
        const tag = { id: generateId(), name: name, color: color || COLORS[0].value, pinned: false };
        state.tags.push(tag);
        saveTags();
        return tag;
    }

    function updateTag(tagId, name, color) {
        const tag = state.tags.find(t => t.id === tagId);
        if (tag) { tag.name = name; tag.color = color; saveTags(); return true; }
        return false;
    }

    function deleteTag(tagId) {
        const idx = state.tags.findIndex(t => t.id === tagId);
        if (idx > -1) {
            state.tags.splice(idx, 1);
            for (const fileName in state.tagMap) {
                const tagIdx = state.tagMap[fileName].indexOf(tagId);
                if (tagIdx > -1) state.tagMap[fileName].splice(tagIdx, 1);
            }
            saveTags();
            return true;
        }
        return false;
    }

    function getUntaggedChars() {
        return state.characters.filter(c => {
            const tags = state.tagMap[c.fileName];
            return !tags || tags.length === 0;
        });
    }

    function getCharsByTag(tagId) {
        return state.characters.filter(c => {
            const tags = state.tagMap[c.fileName];
            return tags && tags.includes(tagId);
        });
    }

    function getFavChars() {
        return state.characters.filter(c => c.fav);
    }

    function getTagCharCount(tagId) {
        let count = 0;
        for (const fileName in state.tagMap) {
            if (state.tagMap[fileName].includes(tagId)) count++;
        }
        return count;
    }

    function filterAndSortChars(chars) {
        let result = chars;
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            const matchMap = new Map();
            result = result.filter(c => {
                let matchType = -1;
                if (c.name.toLowerCase().includes(q)) matchType = 0;
                else {
                    const cTags = getCharTags(c.fileName);
                    if (cTags.some(t => t.name.toLowerCase().includes(q))) matchType = 1;
                    else if ((c.creatorcomment || '').toLowerCase().includes(q)) matchType = 2;
                    else if ((c.desc || '').toLowerCase().includes(q)) matchType = 3;
                    else if ((c.firstMes || '').toLowerCase().includes(q)) matchType = 4;
                }
                if (matchType > -1) {
                    matchMap.set(c.fileName, matchType);
                    return true;
                }
                return false;
            });
            result.sort((a, b) => {
                const typeA = matchMap.get(a.fileName);
                const typeB = matchMap.get(b.fileName);
                if (typeA !== typeB) return typeA - typeB;
                return compareChars(a, b);
            });
        } else {
            result.sort(compareChars);
        }
        return result;
    }

    function compareChars(a, b) {
        let ret = 0;
        switch (state.sortBy) {
            case 'date':
                ret = (a.date_added || 0) - (b.date_added || 0);
                break;
            case 'access':
                // Check multiple possible properties for last access
                const lastA = a.date_last_chat || a.chat_date || a.last_mes || 0;
                const lastB = b.date_last_chat || b.chat_date || b.last_mes || 0;
                ret = lastA - lastB;
                break;
            case 'name':
                ret = (a.name || '').localeCompare(b.name || '', 'zh-CN', { numeric: true, sensitivity: 'base' });
                break;
            case 'token':
                ret = (a.tokens || 0) - (b.tokens || 0);
                break;
            default:
                ret = (a.date_added || 0) - (b.date_added || 0);
        }
        return state.sortOrder === 'asc' ? ret : -ret;
    }

    function calculateTokens(text) {
        if (!text) return 0;
        // Simple heuristic: 1 token ~= 2.5 chars (mixed) for rough sorting
        return Math.floor(text.length / 2.5);
    }

    function countTokens(p) {
        const d = p.data || p;
        if (!d) return 0;
        let t = (d.description || '') + (d.first_mes || '') + (d.scenario || '') + (d.mes_example || '') + (d.system_prompt || '');
        if (d.alternate_greetings && Array.isArray(d.alternate_greetings)) t += d.alternate_greetings.join('');
        return calculateTokens(t);
    }

    async function parsePNG(buf) {
        try {
            const v = new DataView(buf);
            let o = 8;
            const latin1 = new TextDecoder('latin1');
            while (o < buf.byteLength) {
                const len = v.getUint32(o); o += 4;
                const type = latin1.decode(new Uint8Array(buf, o, 4)); o += 4;
                if (type === 'tEXt') {
                    const ch = new Uint8Array(buf, o, len);
                    const ni = Array.prototype.indexOf.call(ch, 0);
                    if (ni > 0) {
                        const key = latin1.decode(ch.slice(0, ni));
                        if (key === 'chara' || key === 'ccv3') {
                            const b64 = latin1.decode(ch.slice(ni + 1));
                            try {
                                const binary = atob(b64);
                                const bytes = new Uint8Array(binary.length);
                                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                                return JSON.parse(new TextDecoder('utf-8').decode(bytes));
                            } catch (e) { }
                        }
                    }
                }
                o += len + 4;
                if (type === 'IEND') break;
            }
        } catch (e) { }
        return null;
    }

    async function getCharacterList() {
        const r = await authFetch('/api/characters/all', { method: 'POST', body: '{}' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (Array.isArray(d)) return d.map(x => typeof x === 'string' ? x : x.avatar || x.name + '.png');
        throw new Error('数据格式错误');
    }

    async function getCharacterData(fn, stMeta) {
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
            const r = await authFetch('/characters/' + encodeURIComponent(fn));
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
                ...baseInfo,
                fileSize: buf.byteLength,
                name: info.name || baseInfo.name,
                desc: info.desc, greetings: info.greetings, creator: info.creator,
                firstMes: info.firstMes, altGreetings: info.altGreetings,
                creatorcomment: baseInfo.creatorcomment || info.creatorcomment,
                version: baseInfo.version || info.version,
                fav: baseInfo.fav || info.fav,
                character_book: baseInfo.character_book || info.character_book,
                source_link: baseInfo.source_link || info.source_link || '',
                tokens: info.tokens || 0
            };
        } catch (e) {
            return { ...baseInfo, greetings: 0, error: true };
        }
    }

    function getCharInfo(d) {
        if (!d) return { name: '未知', desc: '', greetings: 0, creator: '未知', creatorcomment: '', version: '', fav: false, character_book: '', source_link: '', tokens: 0 };
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
            tokens: countTokens(d)
        };
    }

    async function deleteWorldInfo(wiName) {
        await authFetch('/api/worldinfo/delete', {
            method: 'POST',
            body: JSON.stringify({ name: wiName })
        });
    }

    async function deleteChar(fn) {
        const r = await authFetch('/api/characters/delete', { method: 'POST', body: JSON.stringify({ avatar_url: fn, delete_chats: false }) });
        if (!r.ok) throw new Error('删除失败');

        // 同步移除酒馆内存中的角色，防止快速刷新时误判为新角色
        if (parentWin.characters && Array.isArray(parentWin.characters)) {
            const idx = parentWin.characters.findIndex(c => c.avatar === fn);
            if (idx !== -1) parentWin.characters.splice(idx, 1);
        }
    }

    async function downloadChar(fn) {
        const r = await authFetch('/characters/' + encodeURIComponent(fn));
        const b = await r.blob();
        const a = doc.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = fn;
        doc.body.appendChild(a);
        a.click();
        a.remove();
    }

    async function downloadAsZip(files) {
        try {
            const JSZip = await loadJSZip();
            const zip = new JSZip();
            let count = 0;
            const total = files.length;
            notify('正在准备打包 ' + total + ' 个角色...', 'info');
            for (const fn of files) {
                try {
                    const r = await authFetch('/characters/' + encodeURIComponent(fn));
                    const blob = await r.blob();
                    zip.file(fn, blob);
                    count++;
                } catch (e) {
                    console.error('Download failed for ' + fn, e);
                }
            }
            if (count === 0) throw new Error('没有文件下载成功');
            const content = await zip.generateAsync({ type: 'blob' });
            const a = doc.createElement('a');
            a.href = URL.createObjectURL(content);
            const date = new Date().toISOString().slice(0, 10);
            a.download = `characters_export_${date}.zip`;
            doc.body.appendChild(a);
            a.click();
            a.remove();
            notify('ZIP 下载完成', 'success');
        } catch (e) {
            notify('打包下载失败: ' + e.message, 'error');
        }
    }

    function saveCache() {
        try {
            localStorage.setItem('cm_char_cache', JSON.stringify(state.characters));
        } catch (e) { }
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

    function showProgressBar(initialText = '处理中...') {
        const existing = doc.getElementById('cmProgressOverlay');
        if (existing) existing.remove();

        const ov = doc.createElement('div');
        ov.id = 'cmProgressOverlay';
        ov.className = 'cm-progress-overlay';
        ov.innerHTML =
            '<div class="cm-progress-box">' +
            '<div class="cm-progress-text">' + initialText + '</div>' +
            '<div class="cm-progress-bar-wrap"><div class="cm-progress-bar-fill"></div></div>' +
            '<div class="cm-progress-sub"></div>' +
            '</div>';
        doc.body.appendChild(ov);
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

                    newList.push(cached);
                } else {
                    toFetch.push(stC);
                }
            }

            if (toFetch.length > 0) {
                if (showToast && !forceFull) notify(`发现 ${toFetch.length} 张新卡，正在后台同步...`, 'info');
                const chunkSize = 10;
                for (let i = 0; i < toFetch.length; i += chunkSize) {
                    const chunk = toFetch.slice(i, i + chunkSize);

                    if (forceFull) {
                        const progress = Math.round(((i) / toFetch.length) * 100);
                        updateProgressBar(progress, `正在扫描... ${i}/${toFetch.length}`, `当前批次: ${chunk.length} 个`);
                    }

                    // 并发抓取
                    const results = await Promise.all(chunk.map(c => getCharacterData(c.avatar, c)));
                    for (const fresh of results) {
                        if (!fresh.error) {
                            newList.push(fresh);
                            newCount++;
                        }
                    }
                }
            }

            if (forceFull) updateProgressBar(100, '扫描完成！', '即将刷新列表...');

            state.characters = newList;
            state.renderedCount = 0; // 重置无限滚动计数

            findDuplicates();
            updateStats();
            renderTagSidebar();
            renderView(); // 重新渲染列表

            if (showToast) {
                if (newCount > 0) notify('同步完成，新增 ' + newCount + ' 个', 'success');
                else notify('列表已同步 (无新增)', 'success');
            }

            saveCache();

            // 延时关闭进度条
            if (forceFull) setTimeout(hideProgressBar, 800);

        } catch (e) {
            console.error(e);
            notify('扫描出错: ' + e.message, 'error');
            if (forceFull) hideProgressBar();
        } finally {
            state.isScanning = false;
            if (btn) btn.disabled = false;
            if (icon) icon.classList.remove('rotating');
        }
    }

    function findDuplicates() {
        const g = new Map();
        state.characters.forEach(c => {
            const core = c.name.replace(/^\d+/, '').replace(/\d+$/, '').trim() || c.name;
            if (!g.has(core)) g.set(core, []);
            g.get(core).push(c);
        });
        state.duplicateGroups = [];
        g.forEach((chars, core) => { if (chars.length > 1) state.duplicateGroups.push({ coreName: core, characters: chars, count: chars.length }); });
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
            }
        }, { root: doc.getElementById('cmBody'), rootMargin: '300px' });

        state.observer.observe(sentinel);
    }

    function renderView() {
        if (state.currentView === 'all') { state.currentTag = null; renderAll(); }
        else if (state.currentView === 'favorites') { state.currentTag = null; renderFavorites(); }
        else if (state.currentView === 'duplicates') { state.currentTag = null; renderDuplicates(); }
        else if (state.currentView === 'tags') { renderByTag(); }
        else if (state.currentView === 'tagManager') { renderTagManager(); }
        updateActiveTab();
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

    function renderTagSidebar() {
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

    function createBaseDialog(title, bodyContent, footerButtons = [], onOpen = null) {
        const existing = doc.querySelector('.cm-tag-editor-overlay');
        if (existing) existing.remove();

        const ov = doc.createElement('div');
        ov.className = state.isDarkMode ? 'cm-tag-editor-overlay cm-theme-dark' : 'cm-tag-editor-overlay cm-theme-light';

        let footerHtml = '';
        if (footerButtons.length > 0) {
            footerHtml = '<div class="cm-tag-editor-footer">';
            footerButtons.forEach(btn => {
                footerHtml += '<button class="cm-btn ' + (btn.cls || 'cm-btn-secondary') + '" id="' + btn.id + '">' + btn.text + '</button>';
            });
            footerHtml += '</div>';
        }

        ov.innerHTML =
            '<div class="cm-tag-editor">' +
            '<div class="cm-tag-editor-header"><h3>' + escapeHtml(title) + '</h3><button class="cm-tag-editor-close">' + ICONS.close + '</button></div>' +
            '<div class="cm-tag-editor-body">' + bodyContent + '</div>' +
            footerHtml +
            '</div>';

        doc.body.appendChild(ov);

        const close = () => ov.remove();
        ov.querySelector('.cm-tag-editor-close').onclick = close;
        ov.onclick = (e) => { if (e.target === ov) close(); };

        footerButtons.forEach(btn => {
            const el = ov.querySelector('#' + btn.id);
            if (el && btn.onClick) {
                el.onclick = () => btn.onClick(ov, close);
            }
        });

        if (onOpen) onOpen(ov, close);
        return ov;
    }

    function createCard(char, isDup) {
        const card = doc.createElement('div');
        card.className = 'cm-card' + (isDup ? ' cm-dup' : '');
        card.dataset.file = char.fileName;
        card.dataset.index = state.characters.indexOf(char);

        const charTags = getCharTags(char.fileName);
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

        let badgesHtml = '<div class="cm-top-right-badges">';
        if (isDup) badgesHtml += '<span class="cm-badge cm-badge-dup">重复</span>';
        if (char.version) badgesHtml += '<span class="cm-badge cm-badge-ver">v' + escapeHtml(char.version) + '</span>';
        badgesHtml += '</div>';

        let countBadge = '<span class="cm-badge cm-badge-count">💬 ' + char.greetings + '</span>';

        const tokenCount = char.tokens || 0;
        let tokenBadge = '';
        if (tokenCount > 0) {
            let colors = '';
            if (tokenCount > 20000) colors = 'color:#fca5a5;border-color:rgba(239,68,68,0.5);background:rgba(127,29,29,0.8)';
            else if (tokenCount > 5000) colors = 'color:#fde047;border-color:rgba(234,179,8,0.5);background:rgba(113,63,18,0.8)';
            else colors = 'color:#86efac;border-color:rgba(34,197,94,0.5);background:rgba(20,83,45,0.8)';

            tokenBadge = '<div class="cm-token-badge" style="display:inline-block; border: 1px solid; border-radius: 4px; padding: 1px 6px; font-size: 10px; font-weight: bold; backdrop-filter: blur(2px); ' + colors + '">' +
                '🪙 <span class="text-neon">' + tokenCount + '</span> T' +
                '</div>';
        }

        card.innerHTML =
            '<img class="cm-card-img" src="' + char.avatarUrl + '" loading="lazy">' +
            '<div class="cm-card-overlay-bottom"></div>' +
            '<div class="cm-card-content">' +
            '<div class="cm-card-badges-top-left">' +
            countBadge +
            tokenBadge +
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
            if (e.target.tagName === 'BUTTON') return;
            if (e.button === 2) return;

            isDragging = false;
            if (e.type === 'touchstart') {
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
            if (e.target.tagName === 'BUTTON') return;
            clearTimeout(pressTimer);
            card.style.transform = 'scale(1)';
            card.classList.remove('pressing');
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
        groups.forEach(group => {
            const div = doc.createElement('div');
            div.className = 'cm-group';
            div.innerHTML = '<div class="cm-group-header"><span>' + ICONS.dupe + ' ' + escapeHtml(group.coreName) + '</span><span>' + group.count + ' 个</span></div>';
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
                    if (item) deleteTag(item.dataset.id);
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

    function showVersionEditor(char) {
        createBaseDialog(
            '修改版本号',
            '<div class="cm-form-group"><label>版本号</label><input type="text" class="cm-input" id="cmVerInput" value="' + escapeHtml(char.version || '') + '" placeholder="例如: 1.0.0"></div>',
            [
                { text: '取消', id: 'cmVerCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => close() },
                {
                    text: '保存', id: 'cmVerSave', cls: 'cm-btn-primary', onClick: (ov, close) => {
                        const input = ov.querySelector('#cmVerInput');
                        const newVer = input.value.trim();
                        if (newVer !== (char.version || '')) {
                            updateCharacterVersion(char, newVer).then(success => {
                                if (success) showDetail(char);
                            });
                        }
                        close();
                    }
                }
            ],
            (ov) => ov.querySelector('#cmVerInput').focus()
        );
    }

    function showDetail(char) {
        state.currentDetailChar = char;
        const existing = doc.querySelector('.cm-detail-overlay');
        if (existing) existing.remove();
        const ov = doc.createElement('div');
        ov.className = state.isDarkMode ? 'cm-detail-overlay cm-theme-dark' : 'cm-detail-overlay cm-theme-light';
        ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
        const detail = doc.createElement('div');
        detail.className = 'cm-detail';
        const closeBtn = doc.createElement('span');
        closeBtn.className = 'cm-detail-close';
        closeBtn.innerHTML = ICONS.close;
        closeBtn.onclick = function () { ov.remove(); };
        detail.appendChild(closeBtn);
        const header = doc.createElement('div');
        header.className = 'cm-detail-header';

        const avatarWrap = doc.createElement('div');
        avatarWrap.className = 'cm-detail-avatar-wrap';
        avatarWrap.style.position = 'relative';

        const avatar = doc.createElement('img');
        avatar.className = 'cm-detail-avatar';
        avatar.src = char.avatarUrl;

        const camBtn = doc.createElement('div');
        camBtn.className = 'cm-cam-btn';
        camBtn.innerHTML = ICONS.camera;
        camBtn.title = '更换图片';
        camBtn.onclick = function () {
            const fileInput = doc.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/png,image/webp,image/jpeg';
            fileInput.onchange = async function (e) {
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
                        await replaceCharacterImage(char, file);
                        avatar.src = char.avatarUrl;
                        const cardImg = doc.querySelector(`.cm-card[data-file="${CSS.escape(char.fileName)}"] .cm-card-img`);
                        if (cardImg) cardImg.src = char.avatarUrl;
                        notify('图片已更换', 'success');
                    } catch (err) { notify(err.message, 'error'); }
                }
            };
            fileInput.click();
        };

        avatarWrap.appendChild(avatar);
        avatarWrap.appendChild(camBtn);
        header.appendChild(avatarWrap);

        const info = doc.createElement('div');
        info.className = 'cm-detail-info';

        const nameWrap = doc.createElement('div');
        nameWrap.className = 'cm-detail-title-wrap';

        const h2 = doc.createElement('h2');
        h2.textContent = char.name;

        const editBtn = doc.createElement('button');
        editBtn.className = 'cm-edit-btn';
        editBtn.innerHTML = ICONS.pencil;
        editBtn.onclick = function () {
            nameWrap.innerHTML = '';
            const input = doc.createElement('input');
            input.type = 'text';
            input.className = 'cm-detail-title-input';
            input.value = char.name;
            const saveBtn = doc.createElement('button');
            saveBtn.className = 'cm-edit-btn';
            saveBtn.innerHTML = '💾';
            saveBtn.onclick = async function () {
                const newName = input.value.trim();
                if (newName && newName !== char.name) {
                    if (await renameCharacterFile(char, newName)) {
                        showDetail(char);
                        renderView();
                    }
                } else {
                    showDetail(char);
                }
            };
            nameWrap.appendChild(input);
            nameWrap.appendChild(saveBtn);
            input.focus();
        };

        nameWrap.appendChild(h2);
        nameWrap.appendChild(editBtn);
        info.appendChild(nameWrap);


        // --- 🔗 来源链接：标题下方一行（自动保存 + 打开） ---
        const linkRow = doc.createElement('div');
        linkRow.className = 'detail-subrow';
        // 使用 flex 布局，输入框和按钮在同一行
        linkRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;';

        const linkInput = doc.createElement('input');
        linkInput.type = 'text';
        linkInput.className = 'detail-link-input';
        linkInput.style.cssText = 'flex:1;min-width:0;padding:6px;border-radius:4px;border:1px solid var(--cm-border);background:var(--cm-input-bg);color:var(--cm-text);font-size:12px;';
        linkInput.placeholder = '来源链接 (http://...)';
        linkInput.value = (char.source_link || '').trim();

        const openLink = doc.createElement('a');
        openLink.className = 'detail-open-link';
        openLink.textContent = '🔗 打开';
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.style.cssText = 'display:none;flex-shrink:0;font-size:12px;color:var(--cm-accent-text);background:var(--cm-accent-bg);padding:4px 8px;border-radius:4px;text-decoration:none;white-space:nowrap;';

        function normalizeUrl(raw) {
            let s = (raw || '').trim();
            if (!s) return '';
            // 没有 scheme 就默认补 https://，避免 “example.com” 打不开
            if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
            return s;
        }
        function refreshOpenBtn(raw) {
            const u = normalizeUrl(raw);
            if (u) {
                openLink.href = u;
                openLink.style.display = 'inline-block';
            } else {
                openLink.removeAttribute('href');
                openLink.style.display = 'none';
            }
        }

        refreshOpenBtn(linkInput.value);

        let linkSaveTimer = null;
        let lastSavedLink = (char.source_link || '').trim();

        async function saveSourceLink(raw) {
            const normalized = normalizeUrl(raw);
            if (normalized === normalizeUrl(lastSavedLink)) return;

            // 先更新本地 UI/对象
            char.source_link = normalized;
            lastSavedLink = normalized;
            refreshOpenBtn(normalized);

            try {
                await saveCharacterData(char.fileName, (data) => {
                    data.extensions = data.extensions || {};
                    data.extensions.source_url = normalized;
                    delete data.extensions.source_link;
                });
                // 成功就静默，不刷屏；要提示也可以 notify('已保存来源链接','success')
            } catch (e) {
                notify('保存来源链接失败: ' + (e?.message || e), 'error');
            }
        }

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
        info.appendChild(linkRow);
        // --- end 来源链接 ---

        const meta = doc.createElement('div');
        meta.className = 'cm-detail-meta';
        const dateStr = char.date_added ? new Date(parseInt(char.date_added)).toLocaleDateString() : '未知';

        let metaHtml =
            '<span>' + ICONS.user + ' ' + escapeHtml(char.creator) + '</span>' +
            '<span>' + ICONS.time + ' ' + dateStr + '</span>' +
            '<span>' + ICONS.box + ' ' + formatSize(char.fileSize) + '</span>' +
            '<span title="估算Token数">🪙 ' + (char.tokens || 0) + '</span>';

        const displayVer = char.version || '(未设定)';
        metaHtml += '<span id="cmVersionSpan" style="cursor:pointer;border-bottom:1px dashed var(--cm-text-sec)" title="点击修改版本号">🔖 v' + escapeHtml(displayVer) + ' <span style="font-size:10px">' + ICONS.pencil + '</span></span>';

        meta.innerHTML = metaHtml;
        info.appendChild(meta);

        const wiDiv = doc.createElement('div');
        wiDiv.style.cssText = 'margin-bottom:8px;font-size:12px;color:var(--cm-text-sec)';
        if (char.character_book) {
            wiDiv.innerHTML = '<span title="关联世界书">🌐 ' + escapeHtml(char.character_book) + '</span>';
        } else {
            wiDiv.innerHTML = '<span style="opacity:0.5">🌐 无世界书</span>';
        }
        info.appendChild(wiDiv);

        const fileDiv = doc.createElement('div');
        fileDiv.style.cssText = 'margin-bottom:8px;font-size:12px;color:var(--cm-text-sec);opacity:0.6';
        fileDiv.innerHTML = '📁 ' + escapeHtml(char.fileName);
        info.appendChild(fileDiv);

        const verSpan = meta.querySelector('#cmVersionSpan');
        if (verSpan) {
            verSpan.onclick = function () {
                showVersionEditor(char);
            };
        }

        const tagsContainer = doc.createElement('div');
        tagsContainer.className = 'cm-char-tags';
        info.appendChild(tagsContainer);
        header.appendChild(info);
        detail.appendChild(header);
        const body = doc.createElement('div');
        body.className = 'cm-detail-body';

        const actions = doc.createElement('div');
        actions.className = 'cm-detail-actions';

        const favBtn = doc.createElement('button');
        favBtn.className = 'cm-btn cm-btn-secondary';
        favBtn.innerHTML = char.fav ? (ICONS.star + ' 已收藏') : (ICONS.star + ' 收藏');
        favBtn.style.color = char.fav ? '#f59e0b' : 'var(--cm-text-sec)';
        favBtn.onclick = async function () {
            const newState = await toggleFavorite(char.fileName, char.fav);
            char.fav = newState;
            this.innerHTML = newState ? (ICONS.star + ' 已收藏') : (ICONS.star + ' 收藏');
            this.style.color = newState ? '#f59e0b' : 'var(--cm-text-sec)';
            renderTagSidebar();
            if (state.currentView === 'favorites') renderView();
        };
        actions.appendChild(favBtn);

        const dlBtn = doc.createElement('button');
        dlBtn.className = 'cm-btn cm-btn-secondary';
        dlBtn.innerHTML = ICONS.download + ' 下载';
        dlBtn.onclick = async function () {
            const doDl = await showConfirm('确定下载 "' + char.name + '"？');
            if (!doDl) return;
            await downloadChar(char.fileName);
            notify('已下载', 'success');
        };
        actions.appendChild(dlBtn);

        const updateBtn = doc.createElement('button');
        updateBtn.className = 'cm-btn cm-btn-secondary';
        updateBtn.innerHTML = ICONS.refresh + ' 更新'; // 需求2：使用不同图标
        updateBtn.title = '用新卡覆盖当前角色 (保留文件名和来源链接)';
        updateBtn.onclick = function () {
            const input = doc.createElement('input');
            input.type = 'file';
            input.accept = '.png,.webp';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const doUpdate = await showConfirm(
                    '⚠️ 覆盖更新确认\n\n' +
                    '即将用新图片覆盖：' + char.name + '\n' +
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

                    const fd = new FormData();
                    fd.append('avatar_url', char.fileName); // 保持文件名
                    fd.append('avatar', file); // 新图片

                    const dataBlock = cardData.data || cardData;

                    // --- 无条件保留原有 source_link ---
                    // 不管新卡里有没有，只要内存里有，就覆盖进去
                    const savedLink = char.source_link || '';

                    if (savedLink) {
                        if (!dataBlock.extensions) dataBlock.extensions = {};
                        // 强制写入，因为这是脚本的自定义字段，新卡里肯定没有
                        dataBlock.extensions.source_link = savedLink;
                        // 为了兼容性，也可以顺便写一下 source_url
                        dataBlock.extensions.source_url = savedLink;
                    }
                    // ------------------------------------

                    fd.append('ch_name', dataBlock.name || char.name);

                    // 显式传递所有字段
                    const fields = [
                        'description', 'first_mes', 'personality', 'scenario',
                        'mes_example', 'creator_notes', 'system_prompt', 'post_history_instructions',
                        'character_version', 'creator', 'talkativeness'
                    ];

                    fields.forEach(k => {
                        if (dataBlock[k] !== undefined && dataBlock[k] !== null) {
                            fd.append(k, dataBlock[k]);
                        }
                    });

                    if (dataBlock.alternate_greetings && Array.isArray(dataBlock.alternate_greetings)) {
                        dataBlock.alternate_greetings.forEach(g => fd.append('alternate_greetings', g));
                    }
                    if (dataBlock.tags && Array.isArray(dataBlock.tags)) {
                        dataBlock.tags.forEach(t => fd.append('tags', t));
                    }

                    // 传递包含 source_link 的 extensions
                    fd.append('json_data', JSON.stringify(cardData));

                    notify('正在上传覆盖...', 'info');

                    const r = await authFetch('/api/characters/edit', {
                        method: 'POST',
                        body: fd
                    });

                    if (!r.ok) throw new Error(await r.text());

                    notify('✅ 更新成功', 'success');

                    // 刷新图片缓存
                    char.avatarUrl = '/characters/' + encodeURIComponent(char.fileName) + '?t=' + Date.now();
                    avatar.src = char.avatarUrl;

                    // 更新内存数据
                    const updatedInfo = getCharInfo(cardData);
                    // 确保内存对象也保留了链接
                    if (savedLink) updatedInfo.source_link = savedLink;

                    Object.assign(char, updatedInfo);

                    // 刷新UI
                    showDetail(char);
                    renderView();

                } catch (err) {
                    console.error(err);
                    notify('更新失败: ' + err.message, 'error');
                } finally {
                    // 更新后尝试保存缓存，确保新数据被持久化
                    saveCache();
                }
            };
            input.click();
        };
        actions.appendChild(updateBtn);

        const rmBtn = doc.createElement('button');
        rmBtn.className = 'cm-btn cm-btn-danger';
        rmBtn.innerHTML = ICONS.trash + ' 删除';
        rmBtn.onclick = async function () {
            let wiCount = 0;
            if (char.character_book) {
                const isUsedByOthers = state.characters.some(c => c.fileName !== char.fileName && c.character_book === char.character_book);
                if (!isUsedByOthers) wiCount = 1;
            }

            const confirmRes = await showDeleteConfirm(1, wiCount);
            if (!confirmRes.ok) return;

            try {
                await deleteChar(char.fileName);
                if (confirmRes.delWi && wiCount > 0 && char.character_book) {
                    await deleteWorldInfo(char.character_book);
                }

                const card = doc.querySelector(`.cm-card[data-file="${CSS.escape(char.fileName)}"]`);
                if (card) card.remove();

                state.characters = state.characters.filter(c => c.fileName !== char.fileName);
                findDuplicates(); updateStats(); renderTagSidebar();
                ov.remove();
                notify('已删除', 'success');
            } catch (err) {
                console.error(err);
                notify('删除失败: ' + err.message, 'error');
            }
        };
        actions.appendChild(rmBtn);

        const playBtn = doc.createElement('button');
        playBtn.className = 'cm-btn cm-btn-success';
        playBtn.innerHTML = ICONS.rocket + ' 启动';
        playBtn.onclick = function () {
            closeModal();
            ov.remove();
            const targetFileName = char.fileName;

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
                    break;
                }
            }

            if (found) return;

            for (const win of targets) {
                const context = win.SillyTavern && win.SillyTavern.getContext ? win.SillyTavern.getContext() : null;
                if (context && typeof context.selectCharacterById === 'function') {
                    context.selectCharacterById(String(chIndex));
                    found = true;
                    break;
                }
            }

            if (found) return;
            notify('启动失败：角色卡未在当前列表显示（请检查搜索过滤）', 'warning');
        };
        actions.appendChild(playBtn);

        body.appendChild(actions);

        const commentSection = doc.createElement('div');
        commentSection.className = 'cm-section';
        commentSection.style.borderColor = '#ca8a04';
        const commentHeader = doc.createElement('div');
        commentHeader.style.cssText = 'padding:10px 14px;font-size:13px;color:#ca8a04;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);display:flex;justify-content:space-between;align-items:center';
        commentHeader.innerHTML = '<span>备注/注释</span><button class="cm-edit-btn" id="cmEditCommentBtn">' + ICONS.pencil + '</button>';

        const commentContent = doc.createElement('pre');
        commentContent.id = 'cmCommentContent';
        commentContent.textContent = char.creatorcomment || '(无)';

        commentSection.appendChild(commentHeader);
        commentSection.appendChild(commentContent);
        body.appendChild(commentSection);

        commentHeader.querySelector('#cmEditCommentBtn').onclick = function () {
            if (commentContent.tagName === 'PRE') {
                const textarea = doc.createElement('textarea');
                textarea.className = 'cm-input';
                textarea.style.height = '100px';
                textarea.style.resize = 'none';
                textarea.value = char.creatorcomment || '';
                commentContent.replaceWith(textarea);
                this.innerHTML = '💾';
                this.onclick = async function () {
                    const val = textarea.value.trim();
                    if (await updateCreatorComment(char, val)) {
                        showDetail(char);
                        renderView();
                    }
                };
            }
        };

        const descSection = doc.createElement('div');
        descSection.className = 'cm-section cm-section-desc';
        descSection.innerHTML = '<h4>📋 描述</h4><pre>' + escapeHtml(char.desc || '(无)') + '</pre>';
        body.appendChild(descSection);
        const firstSection = doc.createElement('div');
        firstSection.className = 'cm-section cm-section-first';
        firstSection.innerHTML = '<h4>' + ICONS.chat + ' 主开场白</h4><pre>' + escapeHtml(char.firstMes || '(无)') + '</pre>';
        body.appendChild(firstSection);
        if (char.altGreetings && char.altGreetings.length > 0) {
            const altSection = doc.createElement('div');
            altSection.className = 'cm-section';
            let altHtml = '<h4>📝 备选开场白 (' + char.altGreetings.length + ')</h4><div class="cm-greetings-list">';
            char.altGreetings.forEach((g, i) => { altHtml += '<div class="cm-greeting-item"><div class="cm-greeting-header">#' + (i + 1) + '</div><pre>' + escapeHtml(g) + '</pre></div>'; });
            altHtml += '</div>';
            altSection.innerHTML = altHtml;
            body.appendChild(altSection);
        }
        detail.appendChild(body);
        ov.appendChild(detail);
        doc.body.appendChild(ov);
        renderDetailTags(char, tagsContainer, detail);
    }

    function renderDetailTags(char, container, detail) {
        container.innerHTML = '';
        const charTags = getCharTags(char.fileName);
        charTags.forEach(tag => {
            const span = doc.createElement('span');
            span.className = 'cm-char-tag';
            span.style.background = tag.color || '#666';
            span.textContent = tag.name;
            const removeBtn = doc.createElement('span');
            removeBtn.className = 'cm-char-tag-remove';
            removeBtn.textContent = '×';
            removeBtn.onclick = function (e) {
                e.stopPropagation();
                removeTagFromChar(char.fileName, tag.id);
                renderDetailTags(char, container, detail);
                renderTagSidebar();
                renderView();
                notify('标签已移除', 'success');
            };
            span.appendChild(removeBtn);
            container.appendChild(span);
        });
        if (charTags.length === 0) {
            const noTag = doc.createElement('span');
            noTag.style.color = '#888';
            noTag.textContent = '无标签';
            container.appendChild(noTag);
        }
        const addBtn = doc.createElement('span');
        addBtn.className = 'cm-char-tag-add';
        addBtn.textContent = '+';
        addBtn.onclick = function (e) { e.stopPropagation(); showTagSelector(char, container, detail); };
        container.appendChild(addBtn);
    }

    function showTagSelector(char, tagsContainer, detail) {
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
                        renderDetailTags(char, tagsContainer, detail);
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
                        renderDetailTags(char, tagsContainer, detail);
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
                    text: '移除', id: 'cmBatchRemove', cls: 'cm-btn-danger', onClick: (ov, close) => {
                        const tagIds = Array.from(listContainer.querySelectorAll('input:checked')).map(cb => cb.value);
                        if (tagIds.length === 0) { notify('请选择标签', 'warning'); return; }
                        let count = 0;
                        state.selectedCards.forEach(fileName => { tagIds.forEach(tagId => { if (removeTagFromChar(fileName, tagId)) count++; }); });
                        renderTagSidebar(); renderView(); notify('已移除 ' + count + ' 个标签', 'success');
                        close();
                    }
                },
                {
                    text: '添加', id: 'cmBatchApply', cls: 'cm-btn-primary', onClick: (ov, close) => {
                        const tagIds = Array.from(listContainer.querySelectorAll('input:checked')).map(cb => cb.value);
                        if (tagIds.length === 0) { notify('请选择标签', 'warning'); return; }
                        let count = 0;
                        state.selectedCards.forEach(fileName => { tagIds.forEach(tagId => { if (addTagToChar(fileName, tagId)) count++; }); });
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

    function injectStyles() {
        if (doc.getElementById(STYLE_ID)) return;
        const css = `
.cm-theme-dark {
    --cm-bg: #1e1e1e;
    --cm-bg-sec: #252526;
    --cm-bg-ter: #2d2d30;
    --cm-card-bg: #2d2d30;
    --cm-border: #3e3e42;
    --cm-text: #cccccc;
    --cm-text-sec: #858585;
    --cm-hover: #37373d;
    --cm-active: #094771;
    --cm-input-bg: #3c3c3c;
    --cm-overlay: rgba(0,0,0,0.85);
    --cm-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
    --cm-accent-bg: #094771;
    --cm-accent-text: #fff;
    --cm-btn-sec-bg: transparent;
    --cm-btn-sec-text: #cccccc;
    --cm-radius: 8px;
}
.cm-theme-light {
    --cm-bg: #f5f5f5;
    --cm-bg-sec: #ffffff;
    --cm-bg-ter: #f0f0f0;
    --cm-card-bg: #ffffff;
    --cm-border: #e0e0e0;
    --cm-text: #333333;
    --cm-text-sec: #757575;
    --cm-hover: #f0f0f0;
    --cm-active: #e6f7ff;
    --cm-input-bg: #ffffff;
    --cm-overlay: rgba(0,0,0,0.6);
    --cm-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    --cm-accent-bg: #e6f7ff;
    --cm-accent-text: #1890ff;
    --cm-btn-sec-bg: transparent;
    --cm-btn-sec-text: #333;
    --cm-radius: 8px;
}
/* Progress Bar Styles */
.cm-progress-overlay {
    position: fixed; bottom: 20px; right: 20px;
    z-index: 200000;
    pointer-events: none;
}
.cm-progress-box {
    width: 320px;
    background: var(--cm-bg-sec);
    padding: 16px;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.6);
    text-align: center;
    border: 1px solid var(--cm-border);
    pointer-events: auto;
    backdrop-filter: blur(10px);
}
.cm-progress-bar-wrap {
    height: 10px;
    background: var(--cm-bg-ter);
    border-radius: 5px;
    overflow: hidden;
    margin: 15px 0;
    position: relative;
}
.cm-progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #4facfe 0%, #00f2fe 100%);
    width: 0%;
    border-radius: 5px;
    transition: width 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); /* Q弹效果 */
    position: relative;
}
.cm-progress-bar-fill::after {
    content: ''; position: absolute; top: 0; left: 0; bottom: 0; right: 0;
    background: linear-gradient(45deg, rgba(255,255,255,0.2) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.2) 75%, transparent 75%, transparent);
    background-size: 20px 20px;
    animation: cm-progress-stripes 1s linear infinite;
}
@keyframes cm-progress-stripes { 0% { background-position: 0 0; } 100% { background-position: 20px 20px; } }
.cm-progress-text { font-size: 14px; font-weight: bold; color: var(--cm-text); }
.cm-progress-sub { font-size: 12px; color: var(--cm-text-sec); margin-top: 5px; }

@container card (max-width: 80px) {
    .cm-token-badge { display: none !important; }
}


:root {
    --cm-card-width: ${initialZoom}px;
    --cm-sidebar-width: ${savedSidebarWidth}px;
}

#${MODAL_ID} { user-select: none; -webkit-user-select: none; }

#${MODAL_ID}{display:none;position:fixed;z-index:99999;left:0;top:0;width:100vw;height:100vh;background:var(--cm-bg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.cm-dialog{background:var(--cm-bg);color:var(--cm-text);width:100%;height:100%;display:flex;flex-direction:column}
.cm-header{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);flex-shrink:0;height:50px;box-sizing:border-box;}
.cm-header h2{margin:0;font-size:14px;color:var(--cm-text);font-weight:600;display:flex;align-items:center}
.cm-header-actions{display:flex;align-items:center;gap:8px}
.cm-close{background:transparent;border:none;color:var(--cm-text-sec);width:32px;height:32px;border-radius:var(--cm-radius);cursor:pointer;display:flex;justify-content:center;align-items:center;transition:background 0.2s}
.cm-close:hover{background:var(--cm-hover);color:var(--cm-text)}

.cm-toolbar{display:flex;flex-direction:column;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);flex-shrink:0;}
.cm-toolbar-row{display:flex;gap:12px;padding:8px 16px;align-items:center;width:100%;box-sizing:border-box;flex-wrap:nowrap}

.cm-btn{padding:6px 12px;border:none;border-radius:6px;cursor:pointer;font-size:13px;min-height:32px;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:all 0.2s;font-weight:500}
.cm-btn svg { width: 14px; height: 14px; stroke-width: 2px; }
.cm-btn-primary{background:#2563eb;color:#fff}
.cm-btn-secondary{background:var(--cm-btn-sec-bg);color:var(--cm-btn-sec-text);border:1px solid transparent}
.cm-btn-secondary:hover{background:var(--cm-hover);border-color:var(--cm-border)}
.cm-btn-danger{background:transparent;color:#ef4444;border:1px solid transparent}
.cm-btn-danger:hover{background:rgba(239, 68, 68, 0.1);border-color:#ef4444}
.cm-btn-success{background:#16a34a;color:#fff}
.cm-btn-success:hover{background:#15803d}
.cm-btn:disabled{opacity:.5}

.cm-tabs{display:flex;gap:4px;background:var(--cm-bg-ter);padding:4px;border-radius:8px;flex-shrink:0}
.cm-tab{padding:6px 12px;background:transparent;border:none;border-radius:6px;color:var(--cm-text-sec);cursor:pointer;font-size:12px;font-weight:500;transition:all 0.2s}
.cm-tab.active{background:var(--cm-bg-sec);color:var(--cm-text);box-shadow:0 1px 2px rgba(0,0,0,0.1)}

.cm-sort-controls{display:flex;gap:8px;flex:1;align-items:center;min-width:0;overflow-x:auto;}
.cm-sort-btn{background:transparent;color:var(--cm-text-sec);border:1px solid transparent;padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer;display:flex;justify-content:center;align-items:center;gap:4px;transition:all 0.2s;white-space:nowrap}
.cm-sort-btn:hover { background: var(--cm-hover); }
.cm-sort-btn.active{background:var(--cm-hover);color:var(--cm-text);font-weight:600;}

.cm-batch{display:none;padding:0 8px;background:var(--cm-accent-bg);align-items:center;gap:8px;font-size:12px;color:var(--cm-accent-text);flex-shrink:0;height:44px;overflow-x:auto;white-space:nowrap;border-bottom:1px solid var(--cm-border)}
.cm-batch .cm-btn{padding:4px 10px;font-size:12px;min-height:28px}

.cm-main{display:flex;flex:1;overflow:hidden}
.cm-sidebar{width:var(--cm-sidebar-width);background:var(--cm-bg-sec);border-right:1px solid var(--cm-border);flex-shrink:0;overflow-y:auto;transition:width 0.1s ease;padding-top:10px}
.cm-sidebar.closed{width:0 !important;border:none;}
.cm-tag-list{padding:0}
.cm-tag-item{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;border-left:3px solid transparent;transition:background 0.2s}
.cm-tag-item:hover{background:var(--cm-hover)}
.cm-tag-item.active{background:var(--cm-active);color:var(--cm-text);font-weight:500;border-left-color:#2563eb}
.cm-tag-icon{width:16px;display:flex;align-items:center;justify-content:center;color:var(--cm-text-sec)}
.cm-tag-color{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.cm-tag-name{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cm-text)}
.cm-tag-count{font-size:10px;color:var(--cm-text-sec);}

.cm-resizer{width:12px;background:transparent;cursor:col-resize;flex-shrink:0;z-index:10;margin-left:-6px;transition:background 0.2s}
.cm-resizer:hover,.cm-resizing .cm-resizer{background:rgba(37, 99, 235, 0.5)}
body.cm-resizing *{cursor:col-resize !important;user-select:none !important}

.cm-body{flex:1;overflow-y:auto;padding:10px;background:var(--cm-bg);-webkit-overflow-scrolling:touch}

.cm-grid { 
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--cm-card-width), 1fr));
    gap: 10px;
}

.cm-card {
    aspect-ratio: 2 / 3;
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background: var(--cm-bg-ter);
    cursor: pointer;
    border: 2px solid transparent;
    transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
    user-select: none;
    content-visibility: auto;
    contain-intrinsic-size: 0 200px;
    contain-intrinsic-size: 0 200px;
    contain: layout paint style;
    container-type: inline-size;
    container-name: card;
}
.cm-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 2; }
.cm-card.cm-sel { border-color: #00ccff; box-shadow: 0 0 0 2px #00ccff, 0 0 10px rgba(0, 204, 255, 0.6); }
.cm-card.cm-dup { border-color: #ca8a04; }
.cm-card.pressing .cm-card-overlay-bottom { background: rgba(0,0,0,0.8); height: 100%; }

.cm-card-img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.cm-card-overlay-bottom {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 60%;
    background: linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 40%, rgba(0,0,0,0) 100%);
    pointer-events: none;
    transition: background 0.3s, height 0.3s;
}

.cm-card-content { position: absolute; top: 0; left: 0; width: 100%; height: 100%; padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-end; pointer-events: none; }
.cm-card-badges-top-left { position: absolute; top: 6px; left: 6px; display: flex; flex-direction: column; gap: 4px; pointer-events: none; align-items: flex-start; }
.cm-top-right-badges { position: absolute; top: 6px; right: 6px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; pointer-events: none; }

.cm-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; background: rgba(0,0,0,0.65); color: #fff; backdrop-filter: blur(2px); box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
.cm-badge-dup { background: #ca8a04; color: #000; }

.cm-card-actions {
    position: absolute;
    bottom: 60px;
    right: 6px;
    display: flex;
    gap: 4px;
    z-index: 10;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: auto;
}
.cm-card:hover .cm-card-actions { opacity: 1; }
@media (hover: none) { .cm-card-actions { opacity: 1; } }
.cm-card.cm-sel .cm-card-actions { opacity: 1; }

.cm-action-btn {
    width: 26px; height: 26px;
    border: 1px solid rgba(255,255,255,0.4);
    background: rgba(0,0,0,0.4);
    color: #fff;
    border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    backdrop-filter: blur(2px);
    font-size: 14px;
}
.cm-action-btn:hover { background: rgba(255,255,255,0.2); border-color: #fff; }
.cm-action-btn.cm-fav.active { color: #f59e0b; border-color: #f59e0b; }

.cm-card-info { position: relative; z-index: 5; text-shadow: 0 2px 4px rgba(0,0,0,0.8); margin-top: auto; }
.cm-name { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 2px; line-height: 1.2; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cm-note { font-size: 10px; color: rgba(255,255,255,0.7); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; height: 14px; }

.cm-card-tags { display: flex; gap: 2px; margin-bottom: 6px; flex-wrap: nowrap; overflow: hidden; pointer-events: none; height: 16px; align-items: center; }
.cm-card-tag { font-size: 9px; padding: 1px 4px; border-radius: 3px; color: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.5); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.cm-card-tag-more { font-size: 9px; color: rgba(255,255,255,0.7); flex-shrink: 0; }

.cm-minimal .cm-card-actions, 
.cm-minimal .cm-card-tags,
.cm-minimal .cm-note,
.cm-minimal .cm-badge-dup,
.cm-minimal .cm-badge-count {
    display: none !important;
}
.cm-minimal .cm-name { font-size: 10px; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 0; line-height: 1.1; }

.cm-group{background:transparent;border:none;margin-bottom:24px;}
.cm-group-header{display:flex;justify-content:space-between;padding:0 0 12px 0;font-size:14px;color:var(--cm-text);font-weight:600;border-bottom:1px solid var(--cm-border);margin-bottom:16px}

.cm-tag-view-header{display:flex;justify-content:space-between;align-items:center;padding:16px;background:var(--cm-bg-sec);border-radius:12px;margin-bottom:16px;box-shadow:var(--cm-shadow)}
.cm-tag-view-header h3{margin:0;font-size:16px;color:var(--cm-text);font-weight:600;display:flex;align-items:center;gap:8px}
.cm-tag-view-header span{color:var(--cm-text-sec);font-size:13px}
.cm-tag-view-header.editable{cursor:pointer;}
.cm-tag-edit-hint{font-size:14px;color:var(--cm-text-sec);opacity:0;transition:opacity 0.2s}
.cm-tag-view-header.editable:hover .cm-tag-edit-hint{opacity:1}

.cm-tag-manager{padding:0}
.cm-tag-manager-header{display:block;padding:0;background:transparent;border:none;margin-bottom:16px;}
.cm-tag-manager-header h3{margin-bottom:16px;font-size:18px;color:var(--cm-text);display:flex;align-items:center;gap:8px}
.cm-tag-manager-list{display:flex;flex-direction:column;gap:8px}
.cm-tag-manager-item{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--cm-card-bg);border-radius:8px;border:1px solid var(--cm-border);transition:border-color 0.2s}
.cm-tag-manager-item:hover { border-color: #2563eb; }
.cm-tag-manager-info{display:flex;align-items:center;gap:12px;flex:1;min-width:0}
.cm-tag-color-big{width:16px;height:16px;border-radius:4px;flex-shrink:0}
.cm-tag-manager-name{font-size:14px;font-weight:500;color:var(--cm-text)}
.cm-tag-manager-count{font-size:12px;color:var(--cm-text-sec);background:var(--cm-bg);padding:2px 8px;border-radius:10px;}
.cm-tag-manager-actions{display:flex;gap:4px}

.cm-tag-editor-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:var(--cm-overlay);z-index:100003;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
.cm-tag-editor{background:var(--cm-bg-sec);border-radius:16px;width:100%;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,0.3);overflow:hidden;display:flex;flex-direction:column}
.cm-tag-editor-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--cm-border);flex-shrink:0}
.cm-tag-editor-close{background:transparent;border:none;color:var(--cm-text-sec);width:32px;height:32px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.cm-tag-editor-body{padding:20px;flex:1;overflow-y:auto;min-height:0}
.cm-form-group{margin-bottom:20px}
.cm-form-group label{display:block;font-size:13px;color:var(--cm-text-sec);margin-bottom:8px;font-weight:500}
.cm-input{width:100%;padding:10px 12px;background:var(--cm-input-bg);border:1px solid var(--cm-border);border-radius:8px;color:var(--cm-text);font-size:14px;box-sizing:border-box;transition:border-color 0.2s}
.cm-input:focus{outline:none;border-color:#2563eb}
.cm-color-picker{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.cm-color-option{width:32px;height:32px;border-radius:50%;cursor:pointer;border:3px solid transparent;transition:transform 0.2s}
.cm-color-option:hover{transform:scale(1.1)}
.cm-color-option.selected{border-color:var(--cm-text)}
.cm-tag-preview{padding:20px;background:var(--cm-bg);border-radius:8px;text-align:center;border:1px dashed var(--cm-border)}
.cm-tag-preview-tag{display:inline-block;padding:6px 14px;border-radius:6px;color:#fff;font-size:13px;font-weight:500}
.cm-tag-editor-footer{display:flex;gap:10px;padding:12px 16px;background:var(--cm-bg-ter);flex-shrink:0}
.cm-tag-editor-footer .cm-btn{flex:1}

.cm-detail-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:var(--cm-overlay);z-index:100000;overflow-y:auto;-webkit-overflow-scrolling:touch}
.cm-detail{background:var(--cm-bg-sec);min-height:100%;position:relative;padding-bottom:100px;max-width:800px;margin:0 auto;box-shadow:0 0 50px rgba(0,0,0,0.5)}
.cm-detail-close{position:fixed;top:12px;right:12px;background:var(--cm-bg-sec);border:1px solid var(--cm-border);color:var(--cm-text);width:40px;height:40px;border-radius:50%;cursor:pointer;z-index:100001;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(0,0,0,0.2)}
.cm-detail-header{display:flex;gap:16px;padding:20px;padding-right:60px;background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);align-items:flex-start}
.cm-detail-avatar-wrap{flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,0.2);border-radius:8px;position:relative}
.cm-detail-avatar{width:120px;height:180px;border-radius:8px;object-fit:cover;object-position:top;display:block}
.cm-cam-btn{position:absolute;bottom:-8px;right:-8px;width:32px;height:32px;background:#2563eb;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.3);z-index:10}
.cm-cam-btn:hover{transform:scale(1.1)}
.cm-detail-info{flex:1;min-width:0}
.cm-detail-title-wrap{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
.cm-detail-title-input{flex:1;background:var(--cm-input-bg);border:1px solid var(--cm-border);color:var(--cm-text);padding:8px 12px;border-radius:8px;font-size:18px;font-weight:bold;min-width:0;}
.cm-edit-btn{background:transparent;border:none;cursor:pointer;padding:4px;color:var(--cm-text-sec);display:flex;align-items:center;justify-content:center;opacity:0.6}
.cm-edit-btn:hover{opacity:1}
.cm-detail-info h2{margin:0;font-size:18px;color:var(--cm-text);line-height:1.2;font-weight:700}
.cm-detail-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:10px;color:var(--cm-text-sec);font-size:12px;align-items:center}
.cm-char-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;width:100%}
.cm-char-tag{display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 8px;border-radius:6px;color:#fff!important;font-weight:500;line-height:1.2;white-space:nowrap;}
.cm-char-tag-remove{cursor:pointer;opacity:0.7;display:inline-flex;width:14px;height:14px;align-items:center;justify-content:center;}
.cm-char-tag-remove:hover{opacity:1;background:rgba(0,0,0,0.2);border-radius:50%}
.cm-char-tag-add{background:transparent;color:var(--cm-text-sec);width:24px;height:24px;border-radius:4px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;border:1px dashed var(--cm-border)}
.cm-char-tag-add:hover{border-color:var(--cm-text);color:var(--cm-text)}
.cm-detail-body{padding:16px}
.cm-detail-actions{display:flex;gap:10px;padding:16px;border-radius:12px;border:1px solid var(--cm-border);background:var(--cm-bg-ter);flex-wrap:wrap;margin-bottom:24px;}
.cm-detail-actions .cm-btn { border-radius: 8px; }
.cm-section{margin-bottom:20px;background:var(--cm-bg);border:1px solid var(--cm-border);border-radius:8px;overflow:hidden}
.cm-section h4{margin:0;padding:10px 14px;font-size:13px;color:var(--cm-text);background:var(--cm-bg-sec);border-bottom:1px solid var(--cm-border);font-weight:600;display:flex;align-items:center;gap:6px}
.cm-section pre{margin:0;padding:14px;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;color:var(--cm-text);background:var(--cm-bg);line-height:1.5;font-family:inherit}
.cm-search-wrap{position:relative;flex:1;margin-left:auto;min-width:120px;}
.cm-search-input{background:var(--cm-input-bg);border:1px solid var(--cm-border);color:var(--cm-text);padding:8px 12px;padding-left:34px;padding-right:32px;border-radius:8px;font-size:13px;width:100%;box-sizing:border-box;transition:all 0.2s}
.cm-search-input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37, 99, 235, 0.2)}
.cm-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--cm-text-sec);pointer-events:none;display:flex}
.cm-search-icon svg { width: 14px; height: 14px; }
.cm-search-clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--cm-text-sec);cursor:pointer;padding:4px;border-radius:50%;display:none;align-items:center;justify-content:center;}
.cm-search-clear:hover{background:var(--cm-hover);color:var(--cm-text)}
.cm-search-clear svg{width:14px;height:14px}
.cm-header-btn{background:transparent;border:none;width:36px;height:36px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--cm-text-sec);transition:all 0.2s;font-size:16px;}
.cm-header-btn:hover{background:var(--cm-hover);color:var(--cm-text)}
.rotating{animation:spin 1s linear infinite; transform-origin: center;}
@keyframes spin{100%{transform:rotate(360deg)}}
.cm-header-stats{font-size:12px;color:var(--cm-text-sec);font-weight:normal;margin-left:8px;opacity:0.8}
.cm-tag-suggestions{position:absolute;top:100%;left:0;right:0;background:var(--cm-bg-sec);border:1px solid var(--cm-border);border-radius:0 0 8px 8px;z-index:20;max-height:200px;overflow-y:auto;display:none;box-shadow:0 10px 20px rgba(0,0,0,0.2)}
.cm-tag-suggestion-item{padding:10px 12px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--cm-text);border-bottom:1px solid var(--cm-border)}
.cm-tag-suggestion-item:last-child{border-bottom:none}
.cm-tag-suggestion-item:hover{background:var(--cm-hover)}
.cm-greetings-list { display: flex; flex-direction: column; gap: 12px; padding: 12px; }
.cm-greeting-item { background: var(--cm-bg-sec); border: 1px solid var(--cm-border); border-radius: 8px; overflow: hidden; }
.cm-greeting-header { background: var(--cm-bg-ter); color: var(--cm-text-sec); font-size: 11px; padding: 6px 10px; border-bottom: 1px solid var(--cm-border); font-weight: bold; }
.cm-greeting-item pre { background: var(--cm-bg); border: none; padding: 12px; margin: 0; max-height: 200px; }
.cm-zoom-control { display: flex; align-items: center; gap: 8px; padding: 0 12px; border-left: 1px solid var(--cm-border); border-right: 1px solid var(--cm-border); height: 28px; }
.cm-zoom-btn { background: transparent; border: none; cursor: pointer; color: var(--cm-text-sec); display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 4px; }
.cm-zoom-btn:hover { background: var(--cm-hover); color: var(--cm-text); }
.cm-zoom-input { width: 80px; cursor: pointer; }
.cm-zoom-val { font-size: 10px; color: var(--cm-text-sec); width: 30px; text-align: center; }
.cm-select-wrap { position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid var(--cm-border); border-radius: 6px; background: var(--cm-btn-sec-bg); padding: 0 8px; height: 26px; box-sizing: border-box; transition: border-color 0.2s; }
.cm-select-wrap:hover { border-color: var(--cm-border); background: var(--cm-hover); }
.cm-select-wrap svg { width: 14px; height: 14px; color: var(--cm-text-sec); flex-shrink: 0; }
.cm-select-input { appearance: none; -webkit-appearance: none; border: none; background: transparent; color: var(--cm-text); font-size: 12px; padding: 0 24px 0 8px; cursor: pointer; outline: none; width: auto; height: 100%; text-align: left; margin-top: 3px; }
.cm-btn-sm-tag { height: 26px; padding: 0 10px; font-size: 12px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
.cm-tag-selector-list{flex:1;overflow-y:auto;padding:8px;max-height:50vh}
.cm-tag-selector-item{display:flex;align-items:center;gap:10px;padding:12px;border-radius:8px;cursor:pointer;border-bottom:1px solid transparent}
.cm-tag-selector-item:hover{background:var(--cm-hover)}
.cm-tag-selector-item.selected{background:var(--cm-active);color:var(--cm-text)}
.cm-tag-check{margin-left:auto;color:#22c55e;font-size:16px}
.cm-tag-options{display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow-y:auto;padding-right:4px}
.cm-tag-option{display:flex;align-items:center;gap:10px;padding:10px;background:var(--cm-bg-ter);border:1px solid var(--cm-border);border-radius:8px;cursor:pointer;flex-shrink:0}
.cm-tag-option:hover{background:var(--cm-hover)}
.cm-tag-option input{width:18px;height:18px}
.cm-quick-create{padding:10px 16px;border-bottom:1px solid var(--cm-border);display:flex;gap:8px}
.cm-input-sm{flex:1;background:var(--cm-input-bg);border:1px solid var(--cm-border);border-radius:6px;padding:6px 10px;color:var(--cm-text);font-size:13px}
.cm-btn-sm{background:#2563eb;color:#fff;border:none;border-radius:6px;width:30px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center}

/* --- Detail: source link row --- */
.detail-subrow{
    display:flex;
    align-items:center;
    gap:12px;
    margin:10px 0;
    font-size:14px;
}

.detail-link-icon{
    opacity:.75;
    font-size:16px;
    flex-shrink:0;
}

.detail-link-input{
    flex:1;
    height:28px;
    padding:8px 12px;
    border-radius:10px;
    border:1px solid var(--cm-border);
    background:var(--cm-bg-sec);
    color:var(--cm-text);
    font-size:14px;
    transition: all 0.2s ease;
}

.detail-link-input:focus{
    outline:none;
    box-shadow:0 0 0 3px rgba(59,130,246,.25);
    border-color: var(--cm-primary);
}

.detail-open-link{
    flex-shrink:0;
    display:none; /* 默认隐藏，JS 有链接时显示 */
    align-items:center;
    justify-content:center;
    padding:5px 12px;
    border-radius:10px;
    border:1px solid var(--cm-border);
    background:linear-gradient(90deg, #7F8C8D, #BDC3C7);
    color:var(--cm-text);
    text-decoration:none;
    font-size:14px;
    opacity:0.85;
    transition: all 0.2s ease;
}

.detail-open-link:hover{
    background:linear-gradient(90deg, #2980B9, #3498DB);
    opacity:1;
}
/* --- end Detail: source link row --- */


@media (max-width: 600px) {
    .cm-toolbar-row { flex-wrap: wrap; gap: 8px; padding: 8px 10px; }
    .cm-search-wrap { order: 10; width: 100%; margin-top: 4px; }
    .cm-tabs { flex: 1; justify-content: space-between; }
    .cm-tab { flex: 1; text-align: center; padding: 6px 4px; font-size: 11px; }
    .cm-grid { gap: 6px; }
    .cm-card { border-radius: 6px; }
    .cm-name { font-size: 11px; margin-bottom: 0; }
    .cm-sidebar { position: static; height: auto; }
}
        `;
        const s = doc.createElement('style');
        s.id = STYLE_ID;
        s.textContent = css;
        doc.head.appendChild(s);
    }




    // --- Random Pick Helpers ---
    async function getCharHistoryCount(char) {
        try {
            const getHistory = parentWin.getChatHistoryBrief || window.getChatHistoryBrief;
            if (typeof getHistory !== 'function') return 0;
            const avatarId = char.fileName.replace(/\.[^/.]+$/, "");
            const history = await getHistory(avatarId, true);
            return Array.isArray(history) ? history.length : 0;
        } catch (e) { return 0; }
    }

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
        menu.style.cssText = 'position:fixed;top:' + (rect.bottom + 5) + 'px;left:' + (rect.left - 100) + 'px;background:var(--cm-bg-sec);border:1px solid var(--cm-border);border-radius:8px;z-index:100005;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,0.2);';

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

        m.innerHTML = '<div class="cm-dialog">' +
            '<div class="cm-header">' +
            '<h2><span style="margin-right:6px">' + ICONS.folder + '</span> 角色卡管理<span id="cmHeaderStats" class="cm-header-stats"></span></h2>' +
            '<div class="cm-header-actions">' +
            '<button class="cm-header-btn" id="cmThemeBtn" title="切换主题">' + (state.isDarkMode ? ICONS.moon : ICONS.sun) + '</button>' +
            '<button class="cm-header-btn" id="cmImportBtn" title="导入角色/ZIP">' + ICONS.upload + '</button>' +
            '<button class="cm-header-btn" id="cmSyncBtn" title="快速刷新">' + ICONS.refresh + '</button>' +
            '<button class="cm-header-btn" id="cmFullScanBtn" title="强制全量刷新">' + ICONS.search + '</button>' +
            '<button class="cm-close">' + ICONS.close + '</button>' +
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
            '<option value="access_desc">🕒 最近 (最近互动)</option>' +
            '<option value="date_desc">📅 最新 (创建日期)</option>' +
            '<option value="date_asc">📅 最旧 (创建日期)</option>' +
            '<option value="token_desc">🪙 Token (多→少)</option>' +
            '<option value="token_asc">🪙 Token (少→多)</option>' +
            '<option value="name_asc">🔤 名称 (A→Z)</option>' +
            '<option value="name_desc">🔤 名称 (Z→A)</option>' +
            '</select>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '</div>' +
            '<div class="cm-batch" id="cmBatchBar">' +
            '<span>已选 <strong id="cmSelectedCount">0</strong></span>' +
            '<button class="cm-btn cm-btn-secondary" id="cmSelectAll">全选</button>' +
            '<button class="cm-btn cm-btn-secondary" id="cmClearSel">取消</button>' +
            '<button class="cm-btn cm-btn-primary" id="cmBatchTag">标签</button>' +
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

        m.addEventListener('dragover', (e) => {
            e.preventDefault();
            m.style.boxShadow = 'inset 0 0 0 4px #2563eb';
        });
        m.addEventListener('dragleave', (e) => {
            e.preventDefault();
            m.style.boxShadow = 'none';
        });
        m.addEventListener('drop', (e) => {
            e.preventDefault();
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
                    await deleteChar(fileName);
                    if (confirmRes.delWi && wiCount > 0 && char.character_book) {
                        await deleteWorldInfo(char.character_book);
                    }

                    card.remove();
                    state.characters = state.characters.filter(c => c.fileName !== fileName);
                    findDuplicates(); updateStats(); renderTagSidebar();
                    notify('已删除', 'success');
                } catch (err) { notify('删除失败', 'error'); }
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
                    if (char) showDetail(char);
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
        sortSel.value = state.sortBy + '_' + state.sortOrder;

        sortSel.onchange = function () {
            const parts = this.value.split('_');
            if (parts.length === 2) {
                state.sortBy = parts[0];
                state.sortOrder = parts[1];
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
                try {
                    await deleteChar(fn);
                    state.characters = state.characters.filter(c => c.fileName !== fn);
                    ok++;
                } catch (e) { }
            }

            // 删除后也要同步清理酒馆内存中的角色列表
            if (parentWin.characters && Array.isArray(parentWin.characters)) {
                const toDel = new Set(files);
                parentWin.characters = parentWin.characters.filter(c => !toDel.has(c.avatar));
            }

            if (confirmRes.delWi && targetWIs.size > 0) {
                for (const wi of targetWIs) {
                    try { await deleteWorldInfo(wi); } catch (e) { }
                }
            }

            state.selectedCards.clear();
            findDuplicates(); updateStats(); updateBatchBar(); renderTagSidebar(); renderView();
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

        doc.body.appendChild(m);
    }

    function openModal() {
        createModal();
        loadTags();
        renderTagSidebar();
        if (state.characters.length === 0) {
            scan();
        } else {
            updateStats();
            renderView();
        }
        doc.getElementById(MODAL_ID).style.display = 'block';
    }

    function closeModal() {
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

    function init() {
        injectStyles();
        createButton();
        parentWin.openCharManager = openModal;
        window.openCharManager = openModal;
        setTimeout(() => scan(), 1000);
        log('v89.2 搜索优化版已加载');
    }

    setTimeout(init, 500);
})();
