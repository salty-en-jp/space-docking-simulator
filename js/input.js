// キーボード／タッチ入力 → 操作量
const held = new Set();
const toggles = { sas: true, spinLock: false, bodyFrame: false };
const listeners = {};

export function onKey(code, fn) {
  listeners[code] = fn;
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  held.add(e.code);
  if (listeners[e.code]) listeners[e.code](e);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

// タッチボタン: data-key 属性のキーを押したことにする
export function bindTouchButtons(root) {
  root.querySelectorAll('[data-key]').forEach((btn) => {
    const code = btn.dataset.key;
    const down = (e) => {
      e.preventDefault();
      if (btn.dataset.toggle) {
        if (listeners[code]) listeners[code](e);
        return;
      }
      held.add(code);
      btn.classList.add('on');
    };
    const up = (e) => {
      e.preventDefault();
      if (btn.dataset.toggle) return; // 切り替えボタンの点灯状態は main 側で管理
      held.delete(code);
      btn.classList.remove('on');
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  });
}

const k = (c) => (held.has(c) ? 1 : 0);

export function readControls() {
  return {
    tz: k('KeyW') - k('KeyS'),
    tx: k('KeyD') - k('KeyA'),
    ty: k('KeyR') - k('KeyF'),
    rx: k('ArrowUp') - k('ArrowDown'),
    ry: k('ArrowRight') - k('ArrowLeft'),
    rz: k('KeyE') - k('KeyQ'),
    fine: held.has('ShiftLeft') || held.has('ShiftRight') || toggles.fineLatch === true,
    sas: toggles.sas,
    killRel: held.has('KeyX'),
    spinLock: toggles.spinLock,
    rotStop: held.has('KeyB'),
    realign: held.has('KeyG'),
    bodyFrame: toggles.bodyFrame,
  };
}

export const state = toggles;
