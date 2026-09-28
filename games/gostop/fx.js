// 고스톱 카드 이동 연출 (패 내기 · 뒤집기 · 먹기 · 피 뺏기)
// 화면(DOM)은 game.js 가 그대로 그리고, 여기서는 그 위에 '날아가는 카드 복사본'만 띄운다.
//   1) 옮기기 전 카드 위치를 재고  2) 화면을 새 상태로 그리되 도착할 카드는 숨기고
//   3) 복사본을 옛 위치 → 새 위치로 날린 뒤  4) 도착하면 진짜 카드를 보이게 한다.
// Web Animations API 사용. 외부 라이브러리 없음.
(function (root) {
  'use strict';

  let layer = null;
  function ensureLayer() {
    if (!layer || !layer.isConnected) {
      layer = document.createElement('div');
      layer.id = 'fx';
      document.body.appendChild(layer);
    }
    return layer;
  }

  // 화면 좌표 (스크롤 없는 고정 화면이라 getBoundingClientRect 그대로)
  function rectOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // 카드 복사본 만들기. front/back: CSS background-image 값
  function makeCard(to, front, back) {
    const el = document.createElement('div');
    el.className = 'fx-card';
    el.style.left = to.left + 'px';
    el.style.top = to.top + 'px';
    el.style.width = to.width + 'px';
    el.style.height = to.height + 'px';
    el.style.setProperty('--r', (to.width * 0.07).toFixed(1) + 'px');
    const f = document.createElement('div');
    f.className = 'face front';
    f.style.backgroundImage = front;
    el.appendChild(f);
    if (back) {
      const b = document.createElement('div');
      b.className = 'face back';
      b.style.backgroundImage = back;
      el.appendChild(b);
    }
    ensureLayer().appendChild(el);
    return el;
  }

  // from 위치(크기)에서 to 위치로 보이게 하는 transform (가운데 기준)
  function offset(from, to, extra) {
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    const s = from.width / to.width;
    return `perspective(800px) translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(3)}) ${extra || ''}`;
  }

  // 카드 한 장 날리기.
  // opt: { front, back, from, to, dur, flip(뒷면에서 시작해 뒤집힘), pop(출발점에서 한 번 들렸다가 감), easing, arc(위로 휘는 정도 px) }
  // 도착하면 복사본 요소를 돌려준다 (호출한 쪽에서 진짜 카드를 보인 뒤 remove).
  function fly(opt) {
    const { from, to } = opt;
    if (!from || !to) return Promise.resolve(null);
    const el = makeCard(to, opt.front, opt.back);
    const dur = opt.dur || 200;
    const flipDeg = opt.flip ? 'rotateY(180deg)' : 'rotateY(0deg)';
    let frames;
    if (opt.pop) {
      // 더미에서 뒤집기: 제자리에서 들리며 뒤집히고 → 자리로 착
      const lift = { left: from.left, top: from.top - from.height * 0.25, width: from.width * 1.3, height: from.height * 1.3 };
      frames = [
        { transform: offset(from, to, flipDeg), offset: 0 },
        { transform: offset(lift, to, 'rotateY(0deg)'), offset: opt.pop, easing: 'cubic-bezier(.3,.6,.4,1)' },
        { transform: 'perspective(800px) translate(0,0) scale(1) rotateY(0deg)', offset: 1 },
      ];
    } else if (opt.arc) {
      // 먹은 패/뺏은 피: 살짝 떠올랐다가 들어감
      const mid = { left: (from.left + to.left) / 2, top: Math.min(from.top, to.top) - opt.arc, width: (from.width + to.width) / 2 * 1.08, height: (from.height + to.height) / 2 * 1.08 };
      frames = [
        { transform: offset(from, to, flipDeg), offset: 0 },
        { transform: offset(mid, to, 'rotateY(0deg)'), offset: 0.5 },
        { transform: 'perspective(800px) translate(0,0) scale(1) rotateY(0deg)', offset: 1 },
      ];
    } else {
      frames = [
        { transform: offset(from, to, flipDeg) },
        { transform: 'perspective(800px) translate(0,0) scale(1) rotateY(0deg)' },
      ];
    }
    const anim = el.animate(frames, { duration: dur, easing: opt.easing || 'cubic-bezier(.25,.75,.35,1)', fill: 'forwards' });
    // 화면이 가려져 애니메이션이 멈춰도 게임은 계속 가도록 시간 제한
    const timeout = new Promise(res => setTimeout(res, dur + 250));
    return Promise.race([anim.finished.catch(() => null), timeout]).then(() => el);
  }

  // 복사본 치우기: 진짜 카드가 화면에 그려진 다음 프레임에 치운다 (같은 순간에 치우면 둘 다 안 보이는 프레임이 생길 수 있음)
  function remove(el) {
    if (!el) return;
    const gone = () => { if (el.parentNode) el.parentNode.removeChild(el); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(gone));
    setTimeout(gone, 100); // 화면이 가려져 프레임이 멈춰도 쌓이지 않게
  }
  function clear() { if (layer) layer.innerHTML = ''; }

  // 도착한 카드에 '착' 하고 내려앉는 느낌 (살짝 눌렸다 돌아옴)
  function land(el, strong) {
    if (!el || !el.animate) return;
    el.animate(strong
      ? [{ transform: 'scale(1.16)' }, { transform: 'scale(.94)', offset: 0.55 }, { transform: 'scale(1)' }]
      : [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
    { duration: strong ? 170 : 120, easing: 'ease-out' });
  }

  // 부딪힌 자리의 카드가 한 번 흔들림 (패를 내리칠 때 밑의 짝패)
  function bump(el) {
    if (!el || !el.animate) return;
    el.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-2px,1px) rotate(-2deg)' }, { transform: 'translate(2px,0) rotate(1.5deg)' }, { transform: 'translate(0,0)' }],
      { duration: 150, easing: 'ease-out' });
  }

  root.GSFx = { rectOf, fly, remove, clear, land, bump };
})(typeof window !== 'undefined' ? window : this);
