(function () {
  'use strict';

  const APP_VERSION = 32; // sw.js 의 VERSION 이하, 이 게임 HTML 의 ?v= 와 같게
  const SAVE_KEY = 'watermelon.save.v1';
  const C = window.WMCore;
  const ART = window.WMArt;
  const { WW, TOP, WH, HOLD_Y, DANGER_Y, DANGER_TIME, FRUITS, DT } = C;
  const PAD = 5; // 상자 테두리 두께 (물리 벽 바깥에 그림)

  const $ = sel => document.querySelector(sel);
  const homeEl = $('#home'), gameEl = $('#game'), overlay = $('#overlay');

  // ---------------- 저장 (수박게임 전용 키) ----------------
  let save = { sound: true, best: 0, games: 0, watermelons: 0, current: null };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) save = Object.assign(save, JSON.parse(raw));
  } catch (e) { /* 저장소 사용 불가 - 기본값 */ }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ }
  }

  let G = null;        // 지금 게임
  let dirty = false;   // 저장 안 한 변화가 있음
  function saveGame() {
    if (!G) return;
    if (G.score > save.best) save.best = G.score;
    save.current = G.over ? null : C.serialize(G);
    persist();
    dirty = false;
  }

  // ---------------- 효과음 (Web Audio 합성) ----------------
  const sfx = (() => {
    let ctx = null, lastMerge = 0;
    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, at, dur, type, vol, slideTo) {
      if (!save.sound) return;
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
    return {
      unlock: ensure,
      drop: () => tone(430, 0, 0.1, 'sine', 0.16, 250),
      // 합체 '뽁': 큰 과일일수록 낮고 풍성하게
      merge: t => {
        const now = performance.now();
        if (now - lastMerge < 50) return; // 연쇄로 한꺼번에 나면 하나만
        lastMerge = now;
        const f = 700 * Math.pow(0.93, t);
        tone(f, 0, 0.13, 'triangle', 0.22, f * 1.6);
        tone(f * 1.5, 0.05, 0.12, 'sine', 0.1);
      },
      watermelon: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.25, 'triangle', 0.22)),
      burst: () => [784, 1047, 1319, 1568, 1319, 1568, 2093].forEach((f, i) => tone(f, i * 0.08, 0.25, 'triangle', 0.2)),
      warn: () => tone(880, 0, 0.09, 'square', 0.05),
      over: () => [523, 440, 392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.3, 'triangle', 0.18)),
      best: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.9 + i * 0.11, 0.22, 'triangle', 0.2)),
    };
  })();

  function updateSoundButtons() {
    $('#btn-sound').textContent = save.sound ? '🔊' : '🔇';
    $('#btn-sound-home').textContent = save.sound ? '🔊 소리 켜짐' : '🔇 소리 꺼짐';
  }
  function toggleSound() {
    save.sound = !save.sound;
    persist();
    updateSoundButtons();
    if (save.sound) sfx.drop();
  }

  // ---------------- 화면 그리기 ----------------
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const stage = $('#stage');
  let scale = 1, dpr = 1, sprites = [];
  let particles = [], popups = [];

  function resize() {
    if (gameEl.classList.contains('hidden')) return;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cs = getComputedStyle(stage);
    const aw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ah = stage.clientHeight;
    if (!aw || !ah) return;
    const s = Math.min(aw / (WW + PAD * 2), ah / (WH + PAD));
    if (s === scale && sprites.length && cv.width) return;
    scale = s;
    cv.style.width = ((WW + PAD * 2) * scale) + 'px';
    cv.style.height = ((WH + PAD) * scale) + 'px';
    cv.width = Math.round((WW + PAD * 2) * scale * dpr);
    cv.height = Math.round((WH + PAD) * scale * dpr);
    sprites = ART.sprites(FRUITS.map(f => f.r), scale * dpr);
    render();
  }

  function drawSprite(t, x, y, ang, k = 1) {
    const s = sprites[t];
    ctx.save(); ctx.translate(x, y); if (ang) ctx.rotate(ang);
    const h = s.half * k;
    ctx.drawImage(s.c, -h, -h, h * 2, h * 2);
    ctx.restore();
  }

  function render() {
    if (!G || !sprites.length) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, PAD * scale * dpr, 0);
    ctx.clearRect(-PAD, 0, WW + PAD * 2, WH + PAD);

    // 상자 (안쪽 = 물리 벽, 테두리는 바깥)
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, TOP, WW, WH - TOP);
    const k = PAD / 2;
    ctx.strokeStyle = '#d9a86c'; ctx.lineWidth = PAD; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-k, TOP - 6); ctx.lineTo(-k, WH + k); ctx.lineTo(WW + k, WH + k); ctx.lineTo(WW + k, TOP - 6); ctx.stroke();

    // 위험선: 평소엔 옅게, 과일이 넘으면 빨갛게 깜빡임 + 남은 초
    const danger = G.dangerT > 0;
    const blink = danger ? 0.55 + 0.45 * Math.sin(performance.now() / 110) : 0;
    ctx.save();
    ctx.strokeStyle = danger ? `rgba(230,40,40,${0.5 + blink * 0.5})` : 'rgba(230,80,60,.28)';
    ctx.lineWidth = danger ? 3 : 2; ctx.setLineDash([8, 7]);
    ctx.beginPath(); ctx.moveTo(0, DANGER_Y); ctx.lineTo(WW, DANGER_Y); ctx.stroke();
    ctx.restore();

    // 조준선 + 들고 있는 과일
    if (!G.over) {
      const r = FRUITS[G.held].r, x = C.aimClamp(G.held, aimX);
      ctx.save();
      ctx.strokeStyle = 'rgba(90,59,30,.22)'; ctx.setLineDash([5, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, HOLD_Y + r); ctx.lineTo(x, WH - 2); ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = C.canDrop(G) ? 1 : 0.35;
      drawSprite(G.held, x, HOLD_Y, 0);
      ctx.globalAlpha = 1;
    }

    // 과일
    for (const b of G.world.bodies) drawSprite(b.type, b.x, b.y, b.angle, b.r / b.tr);

    // 합체 반짝이
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      if (p.rect) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillRect(-p.s, -p.s * 0.5, p.s * 2, p.s); ctx.restore(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill(); }
    }
    // +점수
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of popups) {
      ctx.globalAlpha = Math.min(1, p.life / 0.3);
      ctx.font = `800 ${p.size}px system-ui, "Malgun Gothic", sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.c; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    if (danger && !G.over) {
      const left = Math.max(1, Math.ceil(DANGER_TIME - G.dangerT));
      ctx.font = '800 20px system-ui, "Malgun Gothic", sans-serif';
      ctx.textAlign = 'right'; ctx.lineWidth = 4; ctx.strokeStyle = '#fff';
      ctx.strokeText(`넘쳐요! ${left}`, WW - 6, DANGER_Y + 18);
      ctx.fillStyle = '#e02828'; ctx.fillText(`넘쳐요! ${left}`, WW - 6, DANGER_Y + 18);
    }
  }

  function sparkle(e) {
    const f = ART.COLORS[e.type];
    const n = 8 + Math.min(e.type, 8) * 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * (60 + e.type * 12);
      particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 1.5 + Math.random() * 2.5,
        c: i % 3 ? f.hi : '#fff6c9', life: 0.45, max: 0.45 });
    }
  }
  // 수박 완성 / 수박 터짐: 색종이
  function confetti(x, y, n) {
    const cols = ['#ff6f5b', '#ffc933', '#3f9d4a', '#8d5fd3', '#4fb3ff', '#ff9ac1'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, sp = 120 + Math.random() * 220;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 380, s: 2.5 + Math.random() * 2.5, rect: true,
        a: Math.random() * 6, va: (Math.random() - 0.5) * 12, c: cols[i % cols.length], life: 1.4, max: 1.4 });
    }
  }
  function popup(x, y, text, c = '#d44c3a', size = 16) {
    popups.push({ x, y, text, c, size, life: 0.9 });
  }

  function stepEffects(dt) {
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.g) { p.vy += p.g * dt; p.vx *= 0.99; p.a += p.va * dt; } else { p.vx *= 0.9; p.vy *= 0.9; }
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
    for (const p of popups) { p.y -= 28 * dt; p.life -= dt; }
    popups = popups.filter(p => p.life > 0);
  }

  // ---------------- 점수 표시 ----------------
  let shownScore = -1;
  function updateScore() {
    if (!G) return;
    const el = $('#score');
    if (G.score !== shownScore) {
      el.textContent = G.score.toLocaleString('ko-KR');
      if (shownScore >= 0) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
      shownScore = G.score;
    }
    $('#best').textContent = `최고 ${Math.max(save.best, G.score).toLocaleString('ko-KR')}`;
  }
  let shownNext = -1;
  function updateNext() {
    if (!G || G.next === shownNext) return;
    shownNext = G.next;
    const box = $('#next');
    box.textContent = '';
    box.appendChild(ART.icon(G.next, 34, Math.min(window.devicePixelRatio || 1, 3)));
  }

  // ---------------- 게임 진행 ----------------
  let aimX = WW / 2;
  let pendingDrop = false; // 기다리는 동안 손을 뗐으면 준비되는 즉시 떨어뜨림
  let warnSec = 0;

  function handle(ev) {
    for (const e of ev) {
      switch (e.kind) {
        case 'merge':
          sparkle(e);
          popup(e.x, e.y - FRUITS[e.type].r * 0.6, `+${e.points}`);
          sfx.merge(e.type);
          dirty = true;
          break;
        case 'watermelon':
          confetti(e.x, e.y, 60);
          sfx.watermelon();
          save.watermelons = (save.watermelons || 0) + 1;
          toast('🍉 수박 완성!');
          break;
        case 'burst':
          confetti(e.x, e.y, 90);
          popup(e.x, e.y, `+${e.points}`, '#3f9d4a', 26);
          sfx.burst();
          toast('🍉🍉 수박 두 개가 팡!\n+' + e.points + '점');
          dirty = true;
          break;
        case 'danger':
          warnSec = 0;
          break;
        case 'over':
          gameOver();
          break;
      }
    }
  }

  function tick() {
    handle(C.update(G));
    if (G.dangerT > 0) {
      const s = Math.floor(G.dangerT);
      if (s >= warnSec) { sfx.warn(); warnSec = s + 1; }
    }
    if (pendingDrop && C.canDrop(G)) { pendingDrop = false; doDrop(); }
    stepEffects(DT);
  }

  function doDrop() {
    if (C.drop(G, aimX)) {
      sfx.drop();
      updateNext();
      dirty = true;
    }
  }

  // ---------------- 루프 ----------------
  let running = false, acc = 0, last = 0;
  function frame(now) {
    if (!running) return;
    const el = last ? Math.min(0.1, (now - last) / 1000) : DT;
    last = now;
    if (G && !G.over) {
      acc += el;
      let n = 0;
      while (acc >= DT && n < 4) { tick(); acc -= DT; n++; }
      if (n === 4) acc = 0;
    } else {
      stepEffects(el);
    }
    render();
    updateScore();
    requestAnimationFrame(frame);
  }
  function startLoop() {
    if (running) return;
    running = true; last = 0; acc = 0;
    requestAnimationFrame(frame);
  }
  function stopLoop() { running = false; }

  // ---------------- 조작 ----------------
  let pressing = false;
  function toWorldX(clientX) {
    const rc = cv.getBoundingClientRect();
    return (clientX - rc.left) / scale - PAD;
  }
  stage.addEventListener('pointerdown', e => {
    if (!G || G.over) return;
    sfx.unlock();
    pressing = true;
    aimX = toWorldX(e.clientX);
    try { stage.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
  });
  stage.addEventListener('pointermove', e => {
    if (!G || G.over) return;
    if (pressing || e.pointerType === 'mouse') aimX = toWorldX(e.clientX);
  });
  stage.addEventListener('pointerup', e => {
    if (!pressing) return;
    pressing = false;
    if (!G || G.over) return;
    aimX = toWorldX(e.clientX);
    if (C.canDrop(G)) doDrop(); else pendingDrop = true;
  });
  stage.addEventListener('pointercancel', () => { pressing = false; });

  // ---------------- 창 / 알림 ----------------
  function showModal({ emoji = '', title = '', body = '', buttons = [] }) {
    overlay.querySelector('.modal-emoji').textContent = emoji;
    overlay.querySelector('.modal-title').textContent = title;
    overlay.querySelector('.modal-body').innerHTML = body;
    const box = overlay.querySelector('.modal-btns');
    box.textContent = '';
    buttons.forEach(b => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.light ? ' light' : '');
      el.textContent = b.label;
      el.addEventListener('click', b.onClick);
      box.appendChild(el);
    });
    $('#toast').classList.add('hidden'); // 알림이 창을 가리지 않게
    overlay.classList.remove('hidden');
  }
  function hideModal() { overlay.classList.add('hidden'); }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1600);
  }

  function gameOver() {
    const score = G.score;
    const newBest = score > save.best && score > 0;
    save.games = (save.games || 0) + 1;
    if (window.Wallet) window.Wallet.recordPlay('watermelon'); // 오늘의 미션 (한 판 마침)
    saveGame(); // 끝난 판은 지우고 최고 점수만 남김
    sfx.over();
    if (newBest) sfx.best();
    setTimeout(() => {
      if (!G || !G.over || gameEl.classList.contains('hidden')) return;
      showModal({
        emoji: newBest ? '🏆' : '🍉',
        title: '게임 끝!',
        body: `<span class="big-score">${score.toLocaleString('ko-KR')}점</span>` +
          (newBest ? '<span class="new-best">최고 기록이에요! 🎉</span>' : `최고 ${save.best.toLocaleString('ko-KR')}점`),
        buttons: [
          { label: '새 게임', onClick: () => startGame(null) },
          { label: '메뉴로', light: true, onClick: goHome },
        ],
      });
    }, 900);
  }

  // ---------------- 화면 전환 / 뒤로 가기 ----------------
  function showScreen(el) {
    [homeEl, gameEl].forEach(s => s.classList.toggle('hidden', s !== el));
    if (el !== homeEl && !(history.state && history.state.wm)) {
      try { history.pushState({ wm: 1 }, ''); } catch (e) { /* 무시 */ }
    }
  }

  function showHome() {
    hideModal();
    showScreen(homeEl);
    const cur = save.current;
    $('#btn-continue').classList.toggle('hidden', !cur);
    $('#continue-info').textContent = cur ? `지금 ${(cur.score | 0).toLocaleString('ko-KR')}점` : '';
    $('#btn-new').className = cur ? 'btn light' : 'btn big'; // 하던 판이 없으면 '새 게임'이 주 버튼
    $('#record').textContent = save.best ? `🏆 최고 점수 ${save.best.toLocaleString('ko-KR')}점` : '';
    updateSoundButtons();
  }

  function startGame(saved) {
    hideModal();
    G = C.createGame(Math.random, saved);
    particles = []; popups = [];
    pendingDrop = false; pressing = false; warnSec = 0;
    shownScore = -1; shownNext = -1;
    aimX = WW / 2;
    if (!saved) { save.current = C.serialize(G); persist(); }
    showScreen(gameEl);
    resize();
    updateNext();
    updateScore();
    updateSoundButtons();
    startLoop();
  }

  let skipPop = false;
  function leaveGame() {
    if (G && !G.over) saveGame();
    stopLoop();
    G = null;
  }
  function goHome() {
    leaveGame();
    showHome();
    if (history.state && history.state.wm) { skipPop = true; history.back(); }
  }
  window.addEventListener('popstate', () => {
    if (skipPop) { skipPop = false; return; }
    if (!gameEl.classList.contains('hidden')) { leaveGame(); showHome(); }
  });
  window.addEventListener('resize', resize);

  // ---------------- 버튼 ----------------
  $('#btn-continue').addEventListener('click', () => { sfx.unlock(); if (save.current) startGame(save.current); });
  $('#btn-new').addEventListener('click', () => {
    sfx.unlock();
    if (!save.current) return startGame(null);
    showModal({
      emoji: '🍉', title: '새 게임',
      body: `하던 판(${(save.current.score | 0).toLocaleString('ko-KR')}점)은 사라져요.<br>새로 시작할까요?`,
      buttons: [
        { label: '새로 시작', onClick: () => startGame(null) },
        { label: '그만두기', light: true, onClick: hideModal },
      ],
    });
  });
  $('#btn-home').addEventListener('click', goHome);
  $('#btn-sound').addEventListener('click', toggleSound);
  $('#btn-sound-home').addEventListener('click', toggleSound);
  $('#btn-hub').addEventListener('click', () => {
    let fromHub = false;
    try { fromHub = sessionStorage.getItem('hub.opened') === '1'; } catch (e) { /* 무시 */ }
    if (fromHub && history.length > 1) history.back();
    else location.replace('../../');
  });

  // 자동 저장: 변화가 있으면 3초마다, 화면을 떠날 때는 바로
  setInterval(() => { if (dirty && G && !G.over) saveGame(); }, 3000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (G && !G.over) saveGame();
      stopLoop();
    } else if (G && !gameEl.classList.contains('hidden')) {
      startLoop();
    }
  });
  window.addEventListener('pagehide', () => { if (G && !G.over) saveGame(); });

  // 첫 화면 장식 + 과일 순서표
  const d = Math.min(window.devicePixelRatio || 1, 3);
  [0, 2, 4, 7, 10].forEach((t, i) => $('#logo').appendChild(ART.icon(t, 34 + i * 9, d)));
  const legend = $('#legend');
  FRUITS.forEach((f, t) => {
    const c = ART.icon(t, 28, d);
    c.title = f.name;
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', f.name);
    legend.appendChild(c);
  });
  $('#app-version').textContent = `버전 ${APP_VERSION}`;
  showHome();

  // 확인용 (개발자 도구에서 사용)
  window.__wm = {
    get G() { return G; },
    run: sec => { for (let i = 0; i < sec * 60 && G && !G.over; i++) tick(); render(); updateScore(); },
    drop: x => { aimX = x; G.cool = 0; doDrop(); },
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('../../sw.js', { scope: '../../' }).catch(() => { });
  }
})();
