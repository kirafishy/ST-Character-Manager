import { doc, parentWin } from './context.js';

const BALL_ID = 'cmFloatBall';
const POSITION_KEY = 'cm_floatBall_position';

/**
 * 获取 jQuery（从 SillyTavern 主窗口）
 * @returns {jQuery|null}
 */
function getjQuery() {
    try {
        const $ = parentWin.$ || doc.defaultView.$ || window.$;
        if ($ && $.fn && $.fn.draggable) {
            return $;
        }
    } catch (e) {}
    return null;
}

/**
 * 加载保存的位置
 * @returns {{ left: number, top: number }}
 */
function loadPosition() {
    try {
        const saved = localStorage.getItem(POSITION_KEY);
        if (saved) {
            const pos = JSON.parse(saved);
            if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                const win = parentWin || window;
                const ballSize = 48;
                const margin = 10;
                
                if (pos.left >= margin && pos.left <= win.innerWidth - ballSize - margin &&
                    pos.top >= margin && pos.top <= win.innerHeight - ballSize - margin) {
                    return pos;
                }
            }
        }
    } catch (e) {}
    const win = parentWin || window;
    return { 
        left: Math.max(10, win.innerWidth - 58), 
        top: Math.max(10, win.innerHeight / 2 - 24) 
    };
}

/**
 * 保存位置
 * @param {number} left
 * @param {number} top
 */
function savePosition(left, top) {
    try {
        localStorage.setItem(POSITION_KEY, JSON.stringify({ left, top }));
    } catch (e) {}
}

/**
 * 创建悬浮球
 * @param {Function} openModalCallback - 打开弹窗的回调
 * @returns {HTMLDivElement|null}
 */
export function createFloatBall(openModalCallback) {
    if (doc.getElementById(BALL_ID)) return null;

    const ball = doc.createElement('div');
    ball.id = BALL_ID;
    ball.className = 'cm-float-ball';
    ball.innerHTML = '📁';
    ball.title = '角色卡管理';

    const pos = loadPosition();
    ball.style.left = pos.left + 'px';
    ball.style.top = pos.top + 'px';

    doc.body.appendChild(ball);

    const $ = getjQuery();
    if (!$) {
        console.warn('[CharManager] jQuery UI draggable 不可用，悬浮球无法拖动');
        // 仍然绑定点击事件
        ball.addEventListener('click', () => openModalCallback());
        return ball;
    }

    // 拖动状态
    let hasDragged = false;
    let dragStartPos = { left: 0, top: 0 };
    const DRAG_THRESHOLD = 5;

    const $ball = $(ball);
    
    $ball.draggable({
        start: (_event, ui) => {
            hasDragged = false;
            dragStartPos = {
                left: ui.position?.left ?? 0,
                top: ui.position?.top ?? 0,
            };
            ball.classList.add('is-dragging');
        },
        drag: (_event, ui) => {
            const dx = Math.abs((ui.position?.left ?? 0) - dragStartPos.left);
            const dy = Math.abs((ui.position?.top ?? 0) - dragStartPos.top);
            if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
                hasDragged = true;
            }
        },
        stop: (_event, ui) => {
            ball.classList.remove('is-dragging');
            savePosition(ui.position?.left ?? pos.left, ui.position?.top ?? pos.top);
            setTimeout(() => {
                hasDragged = false;
            }, 100);
        },
        containment: 'window',
        scroll: false,
    });

    $ball.css('position', 'fixed');

    ball.addEventListener('click', () => {
        if (!hasDragged) {
            openModalCallback();
        }
    });

    return ball;
}

/**
 * 移除悬浮球
 */
export function removeFloatBall() {
    const ball = doc.getElementById(BALL_ID);
    if (ball) {
        const $ = getjQuery();
        if ($) {
            try {
                $(ball).draggable('destroy');
            } catch (e) {}
        }
        ball.remove();
    }
}