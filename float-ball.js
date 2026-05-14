import { doc } from './context.js';

const BALL_ID = 'cmFloatBall';
const POSITION_KEY = 'cm_floatBall_position';

function getWin() {
    return doc.defaultView || window;
}

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

function savePosition(top, right) {
    try {
        localStorage.setItem(POSITION_KEY, JSON.stringify({ top, right }));
    } catch (e) {}
}

function applyPosition(ball, pos) {
    const win = getWin();
    const ballSize = 48;
    const minRight = 0;
    const maxRight = win.innerWidth - ballSize;
    const minTopPx = ballSize / 2;
    const maxTopPx = win.innerHeight - ballSize / 2;

    const right = Math.max(minRight, Math.min(maxRight, pos.right));

    const topPx = win.innerHeight * (pos.top / 100);
    const clampedTopPx = Math.max(minTopPx, Math.min(maxTopPx, topPx));
    const topPercent = (clampedTopPx / win.innerHeight) * 100;

    ball.style.top = topPercent + '%';
    ball.style.right = right + 'px';
    ball.style.transform = 'translateY(-50%)';
}

function getClientXY(e) {
    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
        return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
}

function bindDragEvents(ball) {
    const win = getWin();
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startRight = 0;
    let startTopPercent = 0;
    let dragDistance = 0;

    function dragStart(e) {
        isDragging = true;
        dragDistance = 0;

        const pos = getClientXY(e);
        startX = pos.x;
        startY = pos.y;
        startRight = parseInt(ball.style.right) || 10;
        startTopPercent = parseFloat(ball.style.top) || 50;

        ball.style.transition = 'none';
        e.preventDefault();
    }

    function dragMove(e) {
        if (!isDragging) return;

        const pos = getClientXY(e);
        const deltaX = startX - pos.x;
        const deltaY = pos.y - startY;
        dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        const ballSize = 48;
        const minRight = 0;
        const maxRight = win.innerWidth - ballSize;
        const minTopPx = ballSize / 2;
        const maxTopPx = win.innerHeight - ballSize / 2;

        let newRight = startRight + deltaX;
        newRight = Math.max(minRight, Math.min(maxRight, newRight));

        const startTopPx = win.innerHeight * (startTopPercent / 100);
        let newTopPx = startTopPx + deltaY;
        newTopPx = Math.max(minTopPx, Math.min(maxTopPx, newTopPx));

        const newTopPercent = (newTopPx / win.innerHeight) * 100;

        ball.style.right = newRight + 'px';
        ball.style.top = newTopPercent + '%';
        ball.style.transform = 'translateY(-50%)';

        e.preventDefault();
    }

    function dragEnd() {
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
    }

    ball.addEventListener('mousedown', dragStart);
    ball.addEventListener('touchstart', dragStart, { passive: false });
    doc.addEventListener('mousemove', dragMove);
    doc.addEventListener('touchmove', dragMove, { passive: false });
    doc.addEventListener('mouseup', dragEnd);
    doc.addEventListener('touchend', dragEnd);
}

function bindClickEvent(ball, openModalCallback) {
    ball.addEventListener('click', () => {
        if (ball._dragDistance > 5) {
            ball._dragDistance = 0;
            return;
        }
        openModalCallback();
    });
}

export function createFloatBall(openModalCallback) {
    if (doc.getElementById(BALL_ID)) return null;

    const ball = doc.createElement('div');
    ball.id = BALL_ID;
    ball.className = 'cm-float-ball';
    ball.innerHTML = '📁';
    ball.title = '角色卡管理';

    const savedPos = loadPosition();
    applyPosition(ball, savedPos);

    bindDragEvents(ball);
    bindClickEvent(ball, openModalCallback);

    doc.body.appendChild(ball);
    return ball;
}

export function removeFloatBall() {
    const ball = doc.getElementById(BALL_ID);
    if (ball) {
        ball.remove();
    }
}
