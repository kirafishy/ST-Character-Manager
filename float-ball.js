/**
 * 悬浮球入口模块
 * 提供可拖拽的悬浮球作为插件入口
 */

const BALL_ID = 'cmFloatBall';
const POSITION_KEY = 'cm_floatBall_position';

/**
 * 加载保存的悬浮球位置
 * @returns {{top: number, right: number}} 位置对象，top 为百分比
 */
function loadPosition() {
    try {
        const saved = localStorage.getItem(POSITION_KEY);
        if (saved) {
            const pos = JSON.parse(saved);
            if (typeof pos.top === 'number' && typeof pos.right === 'number') {
                return pos;
            }
        }
    } catch (e) {}
    return { top: 50, right: 10 };
}

/**
 * 保存悬浮球位置到 localStorage
 * @param {number} top - 垂直位置（百分比）
 * @param {number} right - 右侧距离（像素）
 */
function savePosition(top, right) {
    try {
        localStorage.setItem(POSITION_KEY, JSON.stringify({ top, right }));
    } catch (e) {}
}

/**
 * 应用位置到悬浮球元素
 * @param {HTMLElement} ball - 悬浮球元素
 * @param {{top: number, right: number}} pos - 位置对象
 */
function applyPosition(ball, pos) {
    ball.style.top = pos.top + '%';
    ball.style.right = pos.right + 'px';
    ball.style.transform = 'translateY(-50%)';
}

/**
 * 绑定拖拽事件
 * @param {HTMLElement} ball - 悬浮球元素
 */
function bindDragEvents(ball) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startTopPercent = 0;
    let dragDistance = 0;

    const onMouseDown = (e) => {
        isDragging = true;
        dragDistance = 0;

        startX = e.clientX;
        startY = e.clientY;
        startRight = parseInt(ball.style.right) || 10;
        startTopPercent = parseFloat(ball.style.top) || 50;

        ball.style.transition = 'none';
        e.preventDefault();
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;

        const deltaX = startX - e.clientX;
        const deltaY = e.clientY - startY;
        dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        const ballSize = 48;
        const minRight = 0;
        const maxRight = window.innerWidth - ballSize;
        const minTopPx = ballSize / 2;
        const maxTopPx = window.innerHeight - ballSize / 2;

        let newRight = startRight + deltaX;
        newRight = Math.max(minRight, Math.min(maxRight, newRight));

        const startTopPx = window.innerHeight * (startTopPercent / 100);
        let newTopPx = startTopPx + deltaY;
        newTopPx = Math.max(minTopPx, Math.min(maxTopPx, newTopPx));

        const newTopPercent = (newTopPx / window.innerHeight) * 100;

        ball.style.right = newRight + 'px';
        ball.style.top = newTopPercent + '%';
        ball.style.transform = 'translateY(-50%)';
    };

    const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;

        ball.style.transition = '';

        if (dragDistance > 5) {
            savePosition(
                parseFloat(ball.style.top),
                parseInt(ball.style.right)
            );
        }

        ball._dragDistance = dragDistance;
    };

    ball.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

/**
 * 绑定点击事件（区分拖拽）
 * @param {HTMLElement} ball - 悬浮球元素
 * @param {Function} openModalCallback - 点击时调用的打开管理器函数
 */
function bindClickEvent(ball, openModalCallback) {
    ball.addEventListener('click', () => {
        if (ball._dragDistance > 5) {
            ball._dragDistance = 0;
            return;
        }
        openModalCallback();
    });
}

/**
 * 创建悬浮球
 * @param {Function} openModalCallback - 点击时调用的打开管理器函数
 * @returns {HTMLElement|null} 悬浮球元素，若已存在则返回 null
 */
export function createFloatBall(openModalCallback) {
    if (document.getElementById(BALL_ID)) return null;

    const ball = document.createElement('div');
    ball.id = BALL_ID;
    ball.className = 'cm-float-ball';
    ball.innerHTML = '📁';
    ball.title = '角色卡管理';

    const savedPos = loadPosition();
    applyPosition(ball, savedPos);

    bindDragEvents(ball);
    bindClickEvent(ball, openModalCallback);

    document.body.appendChild(ball);
    return ball;
}

/**
 * 移除悬浮球
 */
export function removeFloatBall() {
    const ball = document.getElementById(BALL_ID);
    if (ball) {
        ball.remove();
    }
}