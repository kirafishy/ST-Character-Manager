import { doc } from './context.js';
import { state } from './state.js';
import { ICONS } from './constants.js';
import { escapeHtml } from './utils.js';

export function createBaseDialog(title, bodyContent, footerButtons = [], onOpen = null, options = {}) {
    const { stack = false } = options;
    if (!stack) {
        const existing = doc.querySelector('.cm-tag-editor-overlay');
        if (existing) existing.remove();
    }

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

export function showAlert(msg) {
    return new Promise(resolve => {
        createBaseDialog('提示', '<div style="padding:10px;text-align:center">' + escapeHtml(msg) + '</div>', [
            { text: '确定', id: 'cmAlertOk', cls: 'cm-btn-primary', onClick: (ov, close) => { close(); resolve(); } }
        ]);
    });
}

export function showConfirm(msg) {
    return new Promise(resolve => {
        createBaseDialog('确认', '<div style="padding:10px;text-align:left;white-space:pre-wrap;line-height:1.5">' + escapeHtml(msg) + '</div>', [
            { text: '取消', id: 'cmConfirmCancel', cls: 'cm-btn-secondary', onClick: (ov, close) => { close(); resolve(false); } },
            { text: '确定', id: 'cmConfirmOk', cls: 'cm-btn-primary', onClick: (ov, close) => { close(); resolve(true); } }
        ]);
    });
}

export function showDeleteConfirm(count, wiCount) {
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