(function () {
  'use strict';

  const APP_VERSION = 32; // sw.js 의 VERSION 이하, 이 게임 HTML 의 ?v= 와 같게
  const SAVE_KEY = 'match-3.save.v1';
  const M = window.M3;
  const S3 = window.M3S; // 스테이지 데이터 (stages.js)
  const N = M.N;
  const GEM_COLORS = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#a855f7'];

  const $ = sel => document.querySelector(sel);
  const homeEl = $('#home'), gameEl = $('#game'), overlay = $('#overlay'), board = $('#board');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------------- 저장 (보석 맞추기 전용 키) ----------------
  // { v:2, sound, progress: { unlocked, stars, best }, current: { stage, st } | null }
  let save = S3.migrate(null);
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) save = S3.migrate(JSON.parse(raw)); // v0.1 자유 플레이 하던 판은 여기서 정리됨
  } catch (e) { /* 저장소 사용 불가 - 기본값 */ }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ }
  }
  persist(); // 정리한 형식으로 바로 저장 (v0.1 저장이 남아 있지 않게)

  let st = null;       // 지금 판 (logic.js 상태)
  let stage = null;    // 지금 스테이지 (stages.js)
  function saveGame() {
    if (!st) return;
    save.current = st.over ? null : { stage: stage.id, st };
    persist();
  }

  // ---------------- 효과음 (Web Audio 합성) ----------------
  const sfx = (() => {
    let ctx = null, noiseBuf = null;
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
    function noise(o) {
      if (!save.sound) return;
      const c = ensure();
      if (!c) return;
      if (!noiseBuf) {
        noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = c.currentTime + (o.at || 0), src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = noiseBuf;
      f.type = o.type || 'bandpass';
      f.frequency.setValueAtTime(o.freq, t0);
      if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + o.dur);
      f.Q.value = o.q || 1;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.vol, t0 + (o.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + o.dur + 0.02);
    }
    return {
      unlock: ensure,
      swap: () => noise({ dur: 0.08, freq: 1400, freqTo: 2600, q: 1.2, vol: 0.25, attack: 0.01 }),
      bad: () => { tone(220, 0, 0.12, 'square', 0.08, 160); tone(200, 0.1, 0.12, 'square', 0.07, 150); },
      // 터지는 소리: 연쇄가 이어질수록 음이 올라감
      pop: combo => {
        const f = 520 * Math.pow(1.12, Math.min(combo - 1, 8));
        tone(f, 0, 0.12, 'triangle', 0.22, f * 1.5);
        tone(f * 1.5, 0.05, 0.12, 'sine', 0.1);
      },
      line: () => { noise({ dur: 0.3, freq: 800, freqTo: 5000, q: 0.8, vol: 0.4, attack: 0.02 }); tone(880, 0, 0.25, 'sawtooth', 0.06, 1760); },
      bomb: () => { tone(120, 0, 0.4, 'sine', 0.55, 40); noise({ dur: 0.3, freq: 900, freqTo: 150, q: 0.6, vol: 0.7, type: 'lowpass' }); },
      rainbow: () => [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.05, 0.2, 'triangle', 0.16)),
      made: () => [784, 1175].forEach((f, i) => tone(f, i * 0.07, 0.16, 'sine', 0.16)),
      // 특수 보석이 생길 때 (종류마다 다른 소리)
      makeLine: () => { tone(600, 0, 0.22, 'sine', 0.2, 1800); noise({ dur: 0.18, freq: 2000, freqTo: 6000, q: 1, vol: 0.12, attack: 0.03 }); },
      makeBomb: () => { tone(150, 0, 0.3, 'sine', 0.4, 90); tone(523, 0.08, 0.2, 'triangle', 0.12); },
      makeRainbow: () => [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(f, i * 0.045, 0.18, 'sine', 0.12)),
      // 조합이 터질 때: 묵직한 소리 + 화음
      combo: () => { tone(90, 0, 0.5, 'sine', 0.6, 35); noise({ dur: 0.45, freq: 1200, freqTo: 120, q: 0.5, vol: 0.6, type: 'lowpass' }); [523, 659, 784, 1047].forEach(f => tone(f, 0.08, 0.35, 'triangle', 0.08)); },
      convert: i => tone(700 + Math.min(i, 20) * 45, 0, 0.07, 'sine', 0.1),
      chord: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.03, 0.4, 'triangle', 0.12)),
      goal: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, i === 3 ? 0.4 : 0.16, 'triangle', 0.2)),
      land: () => noise({ dur: 0.05, freq: 900, q: 1, vol: 0.18 }),
      shuffle: () => noise({ dur: 0.45, freq: 600, freqTo: 3000, q: 0.7, vol: 0.3, attack: 0.05 }),
      end: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.2)),
    };
  })();
  function updateSoundButtons() {
    $('#btn-sound').textContent = save.sound ? '🔊' : '🔇';
    $('#btn-sound-home').textContent = save.sound ? '🔊 소리 켜짐' : '🔇 소리 꺼짐';
  }
  function toggleSound() { save.sound = !save.sound; persist(); updateSoundButtons(); if (save.sound) sfx.swap(); }

  // ---------------- 판 그리기 ----------------
  let cell = 40;                 // 한 칸 크기(px)
  const els = new Map();         // 보석 id → 요소

  function gemHTML(x) {
    const sym = x.s === 'rainbow' ? 'gemR' : 'gem' + x.c;
    return `<svg viewBox="0 0 100 100"><use href="#${sym}"/></svg>` + (x.s && x.s !== 'rainbow' ? '<div class="mark"></div>' : '');
  }
  function makeEl(x, r, c) {
    const el = document.createElement('div');
    el.className = 'gem' + (x.s ? ' sp-' + x.s : '');
    el.innerHTML = gemHTML(x);
    el.dataset.id = x.id;
    place(el, r, c, 0);
    board.appendChild(el);
    els.set(x.id, el);
    return el;
  }
  function place(el, r, c, dur, ease) {
    el.style.transition = dur ? `transform ${dur}ms ${ease || 'cubic-bezier(.3,.7,.4,1)'}` : 'none';
    el.style.transform = `translate(${c * cell}px, ${r * cell}px)`;
    el.dataset.r = r; el.dataset.c = c;
  }
  function renderAll() {
    board.innerHTML = '';
    els.clear();
    st.board.forEach((row, r) => row.forEach((x, c) => makeEl(x, r, c)));
  }
  function layout() {
    if (gameEl.classList.contains('hidden')) return;
    const stage = $('#stage');
    const w = stage.clientWidth - 16, h = stage.clientHeight - 8;
    cell = Math.max(24, Math.floor(Math.min(w, h, 560) / N));
    board.style.width = board.style.height = (cell * N) + 'px';
    board.style.setProperty('--cell', cell + 'px');
    if (st) st.board.forEach((row, r) => row.forEach((x, c) => { const el = els.get(x.id); if (el) place(el, r, c, 0); }));
  }
  const elAt = (r, c) => els.get(st.board[r][c].id);

  let shownScore = -1, shownMoves = -1;
  let view = null; // 화면에 보이는 진행도 { score, cleared[], made } - 연쇄 단계마다 늘어남
  let goalCelebrated = false; // 이번 판에서 '클리어!' 연출을 했는지 (별 게이지 ★1)
  let movesView = null;       // 화면에 보일 남은 횟수 (엔드 보너스에서 하나씩 줄어듦). null 이면 st.moves
  let bonusRunning = false;   // 엔드 보너스 연출 중 (누르면 빨리 감기)
  let speed = 1;              // 연출 속도 (엔드 보너스 중 누르면 빨라짐)
  const wait = ms => sleep(ms / speed);
  const syncView = () => { view = { score: st.score, cleared: st.cleared.slice(), made: st.made }; };
  const iconHTML = g => (g.type === 'color' ? `<svg viewBox="0 0 100 100"><use href="#gem${g.color}"/></svg>`
    : `<span class="gi">${g.type === 'score' ? '🎯' : '✨'}</span>`);
  function renderGoals() {
    $('#goals').innerHTML = stage.goals.map((g, i) => `<div class="goal" data-i="${i}">${iconHTML(g)}<span class="count"></span></div>`).join('');
  }
  function updateHud() {
    if (!st) return;
    if (!view) syncView();
    const s = $('#score'), m = $('#moves');
    if (view.score !== shownScore) {
      s.textContent = view.score.toLocaleString('ko-KR');
      if (shownScore >= 0) { s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); }
      shownScore = view.score;
    }
    const moves = movesView != null ? movesView : st.moves;
    if (moves !== shownMoves) {
      m.textContent = moves;
      shownMoves = moves;
    }
    m.parentElement.classList.toggle('low', moves <= 3 && !st.over);
    // 목표: 색·특수는 남은 개수, 점수는 지금/목표
    stage.goals.forEach((g, i) => {
      const el = $(`#goals .goal[data-i="${i}"]`);
      if (!el) return;
      const have = g.type === 'score' ? view.score : g.type === 'color' ? view.cleared[g.color] : view.made;
      const need = g.type === 'score' ? g.target : g.count;
      const text = g.type === 'score' ? `${Math.min(have, need).toLocaleString('ko-KR')}/${need.toLocaleString('ko-KR')}` : String(Math.max(0, need - have));
      const cnt = el.querySelector('.count');
      if (cnt.textContent !== text) {
        if (cnt.textContent) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
        cnt.textContent = text;
      }
      el.classList.toggle('done', have >= need);
    });
    // 별 게이지: 목표를 채우면 ★1, 점수가 기준을 넘으면 ★2·★3
    const [s2, s3] = stage.stars;
    const max = s3 * 1.12;
    const met = goalCelebrated;
    const n = met ? S3.starsFor(stage, true, view.score) : 0;
    $('#gauge-stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= n ? 'on' : 'off'}">★</span>`).join('');
    $('#gauge-fill').style.width = Math.min(100, 100 * view.score / max) + '%';
    const m2 = $('#gauge .m2'), m3 = $('#gauge .m3');
    m2.style.left = (100 * s2 / max) + '%'; m3.style.left = (100 * s3 / max) + '%';
    m2.classList.toggle('on', view.score >= s2); m3.classList.toggle('on', view.score >= s3);
    m2.querySelector('small').textContent = s2.toLocaleString('ko-KR');
    m3.querySelector('small').textContent = s3.toLocaleString('ko-KR');
  }

  // ---------------- 효과 ----------------
  const COMBO_LABEL = { cross: '십자 폭발!', cross3: '왕십자 폭발!', bomb5: '대폭발!', rbline: '무지개 변신!', rbbomb: '무지개 변신!', rbrb: '무지개 대폭발!' };
  const fxEl = (cls, css, life) => {
    const e = document.createElement('div');
    e.className = cls;
    Object.assign(e.style, css);
    board.appendChild(e);
    setTimeout(() => e.remove(), life);
    return e;
  };
  function sparks(r, c, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = cell * (0.5 + Math.random() * 0.7);
      const s = fxEl('spark', { left: ((c + 0.5) * cell - 4) + 'px', top: ((r + 0.5) * cell - 4) + 'px', background: color }, 460);
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', Math.sin(a) * d + 'px');
    }
  }
  // 줄 빛: 터진 보석 자리에서 양쪽으로 뻗어 나감. thick: 조합이면 굵게
  function lineBeam(dir, r, c, thick) {
    const t = cell * (thick ? 0.5 : 0.26), o = (cell - t) / 2;
    if (dir === 'row') fxEl('beam grow-x', { left: '0px', top: (r * cell + o) + 'px', width: (N * cell) + 'px', height: t + 'px', transformOrigin: `${(c + 0.5) * cell}px 50%` }, 380);
    else fxEl('beam grow-y', { top: '0px', left: (c * cell + o) + 'px', height: (N * cell) + 'px', width: t + 'px', transformOrigin: `50% ${(r + 0.5) * cell}px` }, 380);
  }
  // 폭탄: 둥근 충격파 (size 칸만큼 퍼짐)
  function shock(r, c, size) {
    const d = size * cell;
    fxEl('ring', { left: ((c + 0.5) * cell - d / 2) + 'px', top: ((r + 0.5) * cell - d / 2) + 'px', width: d + 'px', height: d + 'px' }, 420);
    fxEl('beam', { left: ((c + 0.5) * cell - d / 2) + 'px', top: ((r + 0.5) * cell - d / 2) + 'px', width: d + 'px', height: d + 'px', borderRadius: '30%', background: 'rgba(255,220,120,.55)' }, 340);
  }
  // 무지개: 무지개 자리에서 지울 보석마다 가는 빛줄기
  function rays(r, c, targets) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'rays');
    svg.setAttribute('width', N * cell); svg.setAttribute('height', N * cell);
    for (const x of targets) {
      const l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', (c + 0.5) * cell); l.setAttribute('y1', (r + 0.5) * cell);
      l.setAttribute('x2', (x.c + 0.5) * cell); l.setAttribute('y2', (x.r + 0.5) * cell);
      svg.appendChild(l);
    }
    board.appendChild(svg);
    setTimeout(() => svg.remove(), 380);
  }
  function mostColor(list) {
    const cnt = new Map();
    list.forEach(x => { if (x.color >= 0) cnt.set(x.color, (cnt.get(x.color) || 0) + 1); });
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])[0];
  }
  function flashAll() { fxEl('beam', { left: '0px', top: '0px', width: (N * cell) + 'px', height: (N * cell) + 'px', borderRadius: '16px', background: 'rgba(255,255,255,.4)' }, 340); }
  // 판 흔들기 (big: 조합·큰 연쇄)
  function shake(big) {
    board.classList.remove('shake', 'shake-big'); void board.offsetWidth;
    board.classList.add(big ? 'shake-big' : 'shake');
    clearTimeout(shake.t);
    shake.t = setTimeout(() => board.classList.remove('shake', 'shake-big'), 320);
  }
  function floatText(x, y, text, cls, color) {
    const f = fxEl('float' + (cls ? ' ' + cls : ''), { left: x + 'px', top: y + 'px' }, 1000);
    if (color) f.style.color = color;
    f.textContent = text;
  }
  // 연쇄 글자: 2 연쇄 → 작게, 3 연쇄 → 크게, 4 연쇄 이상 → '대단해요!'
  function showCombo(n) {
    const el = $('#combo');
    el.textContent = n >= 4 ? `${n} 연쇄! 대단해요!` : `${n} 연쇄!`;
    el.className = 'tier' + Math.min(n, 4);
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(showCombo.t);
    showCombo.t = setTimeout(() => el.classList.add('hidden'), 750);
  }
  // 가운데 큰 글씨 (조합 이름, 목표 달성 등)
  function showBanner(text, cls, ms) {
    const el = $('#banner');
    el.textContent = text;
    el.className = cls || '';
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(() => el.classList.add('hidden'), ms || 800);
  }
  // 보석 모양 바꾸기 (무지개 변신)
  function morph(id, s, color) {
    const el = els.get(id);
    if (!el) return;
    el.className = 'gem sp-' + s + ' morph';
    el.innerHTML = gemHTML({ c: color, s });
  }
  function celebrateGoal() {
    goalCelebrated = true;
    sfx.goal();
    showBanner('🎉 클리어!', 'goal', 1100);
    const g = $('#goals');
    g.classList.remove('win'); void g.offsetWidth; g.classList.add('win');
  }

  // 엔진이 돌려준 단계(바꾸기/지우기/채우기/섞기)를 차례로 보여 준다
  async function runSteps(steps) {
    for (const step of steps) {
      if (step.kind === 'bonus') {
        // 클리어! → 엔드 보너스 시작 (이제부터 누르면 빨리 감기)
        movesView = step.moves;
        updateHud();
        celebrateGoal();
        bonusRunning = true;
        speed = 1.3;
        await wait(1100);
      } else if (step.kind === 'bonusConvert') {
        // 남은 횟수 1번 → 일반 보석 하나가 줄 보석으로 (횟수가 하나씩 줄어듦)
        showBanner('남은 횟수 보너스!', 'combo', 900);
        await wait(350);
        for (let i = 0; i < step.cells.length; i++) {
          const x = step.cells[i];
          morph(x.id, x.s, x.color);
          sparks(x.r, x.c, '#fff', 3);
          sfx.convert(i);
          movesView = Math.max(0, movesView - 1);
          updateHud();
          await wait(140);
        }
        movesView = 0;
        updateHud();
        await wait(250);
      } else if (step.kind === 'convert') {
        // 무지개+줄/폭탄: 그 색 보석이 하나씩 특수 보석으로 바뀜 (합쳐서 0.5초 안)
        showBanner(COMBO_LABEL[step.s === 'bomb' ? 'rbbomb' : 'rbline'], 'combo', 900);
        const gap = Math.min(30, 480 / Math.max(1, step.cells.length));
        const far = x => Math.abs(x.r - step.r) + Math.abs(x.c - step.c);
        const order = step.cells.slice().sort((a, b) => far(a) - far(b));
        for (let i = 0; i < order.length; i++) {
          morph(order[i].id, order[i].s || step.s, step.color); // 무지개+줄: 가로/세로 무작위
          if (i % 2 === 0) sfx.convert(i);
          await wait(gap);
        }
        await wait(220);
      } else if (step.kind === 'clear') {
        const fx = step.fx;
        const combo = fx && COMBO_LABEL[fx.type];
        const origin = fx ? fx : step.triggered[0] || null;
        let sounds = 0;
        // 조합 / 직접 발동 연출
        if (combo) {
          if (fx.type !== 'rbline' && fx.type !== 'rbbomb') showBanner(COMBO_LABEL[fx.type], 'combo', 900);
          if (fx.type === 'cross') { lineBeam('row', fx.r, fx.c, true); lineBeam('col', fx.r, fx.c, true); }
          else if (fx.type === 'cross3') for (let d = -1; d <= 1; d++) { lineBeam('row', fx.r + d, fx.c, true); lineBeam('col', fx.r, fx.c + d, true); }
          else if (fx.type === 'bomb5') shock(fx.r, fx.c, 5.5);
          else if (fx.type === 'rbrb') flashAll();
          sfx.combo(); sounds++;
          shake(true);
        }
        // 한꺼번에 많이 터지면(무지개 변신 등) 빛은 10개까지만 (휴대폰에서 무겁지 않게)
        for (const t of step.triggered.slice(0, 10)) {
          if (t.s === 'row' || t.s === 'col') lineBeam(t.s, t.r, t.c);
          else if (t.s === 'bomb') shock(t.r, t.c, 3.2);
          else if (t.s === 'rainbow') {
            // 무지개가 지운 색: 바꾼 상대 색(또는 더블탭이면 가장 많은 색). 다른 특수 보석에 맞았으면 지운 보석 중 가장 많은 색
            const col = fx && fx.color != null && fx.r === t.r && fx.c === t.c ? fx.color : mostColor(step.cleared);
            rays(t.r, t.c, step.cleared.filter(x => x.color === col && x.s !== 'rainbow').slice(0, 40));
          }
          if (sounds < 3) { (t.s === 'bomb' ? sfx.bomb : t.s === 'rainbow' ? sfx.rainbow : sfx.line)(); sounds++; }
        }
        if (!combo && step.triggered.some(t => t.s === 'bomb')) shake(false);
        if (step.combo >= 2) showCombo(step.combo);
        if (step.combo >= 4) { sfx.chord(); shake(true); } else sfx.pop(step.combo);
        if (!combo && step.cleared.length >= 20) showBanner('굉장해요!', 'wow', 700);
        // 새 특수 보석 자리로 모여드는 보석 (같은 색, 같은 줄, 가까이)
        const trig = new Set(step.triggered.map(t => t.r * N + t.c));
        const gatherTo = new Map();
        for (const sp of step.specials) {
          const at = step.cleared.find(x => x.r === sp.r && x.c === sp.c);
          const spColor = sp.s === 'rainbow' ? (at ? at.color : -2) : sp.color;
          for (const x of step.cleared) {
            if (gatherTo.has(x.id) || trig.has(x.r * N + x.c) || x.color !== spColor) continue;
            if ((x.r === sp.r || x.c === sp.c) && Math.abs(x.r - sp.r) + Math.abs(x.c - sp.c) <= 4) gatherTo.set(x.id, sp);
          }
        }
        // 터지는 순서: 터진 자리에서 가까운 보석부터 (최대 0.22초)
        const dist = x => (origin ? Math.abs(x.r - origin.r) + Math.abs(x.c - origin.c) : 0);
        const perSpark = step.cleared.length <= 12 ? 3 : step.cleared.length <= 30 ? 1 : 0;
        let maxDelay = 0, sx = 0, sy = 0;
        const colorCount = new Map();
        for (const x of step.cleared) {
          const el = els.get(x.id);
          els.delete(x.id);
          sx += x.c; sy += x.r;
          if (x.color >= 0) colorCount.set(x.color, (colorCount.get(x.color) || 0) + 1);
          const g = gatherTo.get(x.id);
          if (g && el) { el.classList.add('gather'); place(el, g.r, g.c, 130, 'ease-in'); setTimeout(() => el.remove(), 150); continue; }
          const delay = origin ? Math.min(dist(x) * 22, 220) : 0;
          maxDelay = Math.max(maxDelay, delay);
          const go = () => {
            if (el) { el.classList.add('pop'); setTimeout(() => el.remove(), 200); }
            if (perSpark) sparks(x.r, x.c, GEM_COLORS[x.color] || '#fff', perSpark);
          };
          if (delay) setTimeout(go, delay); else go();
        }
        const n = step.cleared.length || 1;
        const tint = colorCount.size === 1 ? GEM_COLORS[[...colorCount.keys()][0]] : null;
        const big = combo || step.cleared.length >= 20;
        floatText((sx / n + 0.5) * cell, (sy / n + 0.5) * cell, `+${step.points.toLocaleString('ko-KR')}${step.combo >= 3 ? ' ×' + step.combo : ''}`, big ? 'big' : '', tint);
        if (step.specials.length) {
          await wait(140);
          for (const x of step.specials) {
            const el = makeEl(x, x.r, x.c);
            el.classList.add('appear');
            fxEl('make-ring ' + x.s, { left: (x.c * cell) + 'px', top: (x.r * cell) + 'px', width: cell + 'px', height: cell + 'px' }, 520);
          }
          const kinds = step.specials.map(x => x.s);
          if (kinds.includes('rainbow')) sfx.makeRainbow();
          else if (kinds.includes('bomb')) sfx.makeBomb();
          else sfx.makeLine();
          await wait(Math.max(60, maxDelay + 200 - 140));
        } else await wait(maxDelay + 200);
        if (view) {
          view.score += step.points;
          step.cleared.forEach(x => { if (x.color >= 0) view.cleared[x.color]++; });
          view.made += step.specials.length;
        }
        updateHud();
        await wait(40);
      } else if (step.kind === 'fall') {
        let longest = 0;
        for (const m of step.moves) {
          const el = els.get(m.id);
          const dur = 90 + 50 * (m.r - m.fromR);
          if (el) place(el, m.r, m.c, dur / speed, 'cubic-bezier(.45,0,.6,1.3)');
          longest = Math.max(longest, dur);
        }
        const fresh = step.spawns.map(sp => ({ sp, el: makeEl({ id: sp.id, c: sp.color, s: null }, sp.fromR, sp.c) }));
        void board.offsetWidth; // 위에서 시작한 자리를 먼저 그리고
        for (const { sp, el } of fresh) {
          const dur = 90 + 50 * (sp.r - sp.fromR);
          place(el, sp.r, sp.c, dur / speed, 'cubic-bezier(.45,0,.6,1.3)');
          longest = Math.max(longest, dur);
        }
        await wait(longest + 20);
        sfx.land();
      } else if (step.kind === 'shuffle') {
        toast('더 움직일 수 없어서\n보석을 섞을게요');
        sfx.shuffle();
        await wait(500);
        if (step.fresh) renderAll();
        else for (const x of step.cells) { const el = els.get(x.id); if (el) place(el, x.r, x.c, 380); }
        await wait(420);
      }
    }
  }

  // ---------------- 조작 ----------------
  let busy = false, sel = null, drag = null;
  function cellFromEvent(e) {
    const rc = board.getBoundingClientRect();
    const c = Math.floor((e.clientX - rc.left) / cell), r = Math.floor((e.clientY - rc.top) / cell);
    return r >= 0 && r < N && c >= 0 && c < N ? { r, c } : null;
  }
  function select(p) {
    if (sel) { const old = elAt(sel.r, sel.c); if (old) old.classList.remove('sel'); }
    sel = p;
    if (sel) elAt(sel.r, sel.c).classList.add('sel');
  }
  $('#stage').addEventListener('pointerdown', () => { if (bonusRunning) speed = 4; });
  board.addEventListener('pointerdown', e => {
    if (!st || busy || st.over) return;
    sfx.unlock();
    const p = cellFromEvent(e);
    if (!p) return;
    drag = { p, x: e.clientX, y: e.clientY, moved: false };
    try { board.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
  });
  board.addEventListener('pointermove', e => {
    if (!drag || drag.moved) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < cell * 0.35) return;
    drag.moved = true;
    const q = Math.abs(dx) > Math.abs(dy) ? { r: drag.p.r, c: drag.p.c + Math.sign(dx) } : { r: drag.p.r + Math.sign(dy), c: drag.p.c };
    if (q.r >= 0 && q.r < N && q.c >= 0 && q.c < N) trySwap(drag.p, q);
  });
  board.addEventListener('pointerup', () => {
    const d = drag;
    drag = null;
    if (!d || d.moved || busy) return;
    // 밀지 않고 눌렀다 떼면: 한 번 누르면 고르고, 옆 보석을 누르면 바꾸기
    // 고른 특수 보석을 한 번 더 누르면 바로 터짐 (일반 보석은 고르기 취소)
    if (sel && M.adjacent(sel, d.p)) trySwap(sel, d.p);
    else if (sel && sel.r === d.p.r && sel.c === d.p.c) {
      if (st.board[d.p.r][d.p.c].s) tryActivate(d.p);
      else select(null);
    } else {
      select(d.p);
      if (st.board[d.p.r][d.p.c].s && !save.tapTip) showTip(d.p, '한 번 더 누르면 터져요');
    }
  });
  // 고른 보석 위 말풍선 (특수 보석 첫 사용 안내)
  function showTip(p, text) {
    board.querySelectorAll('.tip').forEach(e => e.remove());
    const t = document.createElement('div');
    t.className = 'tip' + (p.r < 1 ? ' below' : '');
    t.textContent = text;
    t.style.left = Math.min(Math.max((p.c + 0.5) * cell, 70), N * cell - 70) + 'px';
    t.style.top = (p.r < 1 ? (p.r + 1) * cell + 4 : p.r * cell - 4) + 'px';
    board.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  board.addEventListener('pointercancel', () => { drag = null; });

  async function trySwap(a, b) {
    if (busy || !st || st.over) return;
    busy = true;
    select(null);
    clearHint();
    const A = elAt(a.r, a.c), B = elAt(b.r, b.c);
    place(A, b.r, b.c, 140); place(B, a.r, a.c, 140);
    sfx.swap();
    await sleep(150);
    const res = M.play(st, a, b, Math.random);
    if (!res.ok) { // 맞는 게 없으면 제자리로
      place(A, a.r, a.c, 140); place(B, b.r, b.c, 140);
      sfx.bad();
      await sleep(160);
      busy = false;
      scheduleHint();
      return;
    }
    await afterMove(res);
  }

  // 특수 보석 더블탭: 제자리에서 바로 터뜨림 (1수)
  async function tryActivate(p) {
    if (busy || !st || st.over) return;
    busy = true;
    select(null);
    clearHint();
    board.querySelectorAll('.tip').forEach(e => e.remove());
    const res = M.activate(st, p, Math.random);
    if (!res.ok) { busy = false; return; }
    if (!save.tapTip) { save.tapTip = true; persist(); }
    await afterMove(res);
  }

  // 한 수를 보여 준 뒤: 끝났으면(클리어 → 엔드 보너스 / 실패) 결과
  // 결과(별·해금·최고 점수)는 연출 전에 바로 저장 → 엔드 보너스 중 앱을 닫아도 클리어가 남음
  async function afterMove(res) {
    const game = st;
    const bonus = res.steps.find(x => x.kind === 'bonus');
    movesView = bonus ? bonus.moves : null;
    if (st.over) recordResult();
    speed = 1;
    await runSteps(res.steps);
    bonusRunning = false;
    speed = 1;
    movesView = null;
    if (st !== game) return;
    syncView(); // 화면 진행도를 실제 값과 맞춤
    updateHud();
    if (st.over) { showResult(); busy = false; return; }
    saveGame();
    busy = false;
    scheduleHint();
  }

  // 한동안 가만히 있으면 움직일 수 있는 두 보석을 살짝 흔들어 알려 줌
  let hintTimer = 0;
  function clearHint() {
    clearTimeout(hintTimer);
    board.querySelectorAll('.gem.hint').forEach(el => el.classList.remove('hint'));
  }
  function scheduleHint() {
    clearHint();
    hintTimer = setTimeout(() => {
      if (!st || busy || st.over || gameEl.classList.contains('hidden')) return;
      const mv = M.findMove(st.board);
      if (mv) mv.forEach(p => { const el = elAt(p.r, p.c); if (el) { el.classList.remove('hint'); void el.offsetWidth; el.classList.add('hint'); } });
    }, 6000);
  }

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
      el.addEventListener('click', () => { sfx.unlock(); b.onClick(); });
      box.appendChild(el);
    });
    overlay.classList.remove('hidden');
  }
  const hideModal = () => overlay.classList.add('hidden');
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1500);
  }

  const starsHTML = n => [1, 2, 3].map(i => `<span class="${i <= n ? 'on' : 'off'}" style="animation-delay:${(i - 1) * 0.18}s">★</span>`).join('');
  function goalListHTML(goals, withProgress) {
    const prog = withProgress ? M.goalProgress(st) : null;
    return '<ul class="goal-list">' + goals.map((g, i) => {
      const p = prog && prog[i];
      const tail = p ? (p.done ? ' ✓' : ` (${g.type === 'score' ? p.have.toLocaleString('ko-KR') + '점' : p.have + '/' + p.need})`) : '';
      return `<li>${iconHTML(g)}<span>${S3.goalText(g)}${tail}</span></li>`;
    }).join('') + '</ul>';
  }
  let lastResult = null;
  function recordResult() {
    const won = st.result === 'win';
    const score = st.score;
    const before = save.progress.stars[stage.id] || 0;
    save.progress = S3.applyResult(save.progress, stage.id, won, score);
    save.current = null;
    persist();
    lastResult = { won, score, before, stars: S3.starsFor(stage, won, score) };
    if (window.Wallet) window.Wallet.recordPlay('match-3'); // 오늘의 미션 (한 판 마침)
  }
  function showResult() {
    if (!lastResult) recordResult();
    const { won, score, before, stars } = lastResult;
    const next = S3.byId(stage.id + 1);
    (won ? sfx.end : sfx.bad)();
    setTimeout(() => {
      if (!st || !st.over || gameEl.classList.contains('hidden')) return;
      if (won) {
        showModal({
          emoji: '', title: `스테이지 ${stage.id} 성공!`,
          body: `<div class="big-stars">${starsHTML(stars)}</div><span class="big-score">${score.toLocaleString('ko-KR')}점</span>` +
            (stars > before && before > 0 ? '<span class="new-best">별이 늘었어요! 🎉</span>' : '') +
            (!next ? '<br>🎉 모든 스테이지를 깼어요!' : ''),
          buttons: [
            ...(next ? [{ label: `다음 스테이지 ▶`, onClick: () => openStage(next.id) }] : []),
            { label: '다시 하기', light: true, onClick: () => startStage(stage.id) },
            { label: '스테이지 목록', light: true, onClick: goHome },
          ],
        });
      } else {
        showModal({
          emoji: '😢', title: '아쉬워요!',
          body: `움직일 수 있는 횟수를 다 썼어요.${goalListHTML(stage.goals, true)}`,
          buttons: [
            { label: '다시 하기', onClick: () => startStage(stage.id) },
            { label: '스테이지 목록', light: true, onClick: goHome },
          ],
        });
      }
    }, 500);
  }

  // ---------------- 화면 전환 / 뒤로 가기 ----------------
  function showScreen(el) {
    [homeEl, gameEl].forEach(s => s.classList.toggle('hidden', s !== el));
    if (el !== homeEl && !(history.state && history.state.m3)) {
      try { history.pushState({ m3: 1 }, ''); } catch (e) { /* 무시 */ }
    }
  }
  function showHome() {
    hideModal();
    showScreen(homeEl);
    const cur = save.current;
    $('#btn-continue').classList.toggle('hidden', !cur);
    $('#continue-info').textContent = cur ? `스테이지 ${cur.stage} · 남은 ${cur.st.moves}번` : '';
    // 다음에 할 스테이지: 열린 것 중 아직 안 깬 첫 스테이지 (다 깼으면 마지막)
    const p = save.progress;
    const nextId = S3.STAGES.find(x => x.id <= p.unlocked && !p.stars[x.id]) ? S3.STAGES.find(x => x.id <= p.unlocked && !p.stars[x.id]).id : p.unlocked;
    const play = $('#btn-play');
    play.textContent = `스테이지 ${nextId} 시작`;
    play.dataset.stage = nextId;
    play.className = cur ? 'btn light' : 'btn big';
    $('#stage-grid').innerHTML = S3.STAGES.map(x => {
      if (x.id > p.unlocked) return `<button class="stage-btn locked" disabled aria-label="스테이지 ${x.id} 잠김">🔒</button>`;
      const n = p.stars[x.id] || 0;
      return `<button class="stage-btn${x.id === nextId ? ' next' : ''}" data-stage="${x.id}" aria-label="스테이지 ${x.id}, 별 ${n}개">${x.id}<span class="st">${[1, 2, 3].map(i => `<span class="${i <= n ? '' : 'off'}">★</span>`).join('')}</span></button>`;
    }).join('');
    const total = S3.totalStars(p);
    $('#record').textContent = total ? `⭐ 모은 별 ${total} / ${S3.STAGES.length * 3}` : '';
    updateSoundButtons();
  }
  // 스테이지 소개 창: 목표와 횟수를 보여 주고 '시작'
  function openStage(id) {
    const x = S3.byId(id);
    if (!x || id > save.progress.unlocked) return;
    const start = () => {
      if (save.current && save.current.stage !== id) save.current = null; // 다른 스테이지를 시작하면 하던 판은 버림
      startStage(id);
    };
    showModal({
      emoji: '', title: `스테이지 ${id}`,
      body: `<div><b>목표</b></div>${goalListHTML(x.goals, false)}<div class="moves-note">${x.moves}번 안에 해내면 성공!<br>빨리 깰수록 남은 횟수가 보너스 점수가 돼요</div>`,
      buttons: [
        { label: '시작', onClick: start },
        { label: '닫기', light: true, onClick: hideModal },
      ],
    });
  }
  function startStage(id, saved) {
    stage = S3.byId(id);
    startGame(saved);
  }
  function startGame(saved) {
    hideModal();
    const opts = { moves: stage.moves, colors: stage.colors, goals: stage.goals };
    st = saved ? M.restore(saved, Math.random, opts) : M.createGame(Math.random, opts);
    busy = false; sel = null; drag = null;
    shownScore = -1; shownMoves = -1;
    goalCelebrated = false; movesView = null; bonusRunning = false; speed = 1; lastResult = null;
    $('#goals').classList.remove('win');
    syncView();
    showScreen(gameEl);
    $('#stage-label').textContent = `스테이지 ${stage.id}`;
    renderGoals();
    layout();
    renderAll();
    updateHud();
    updateSoundButtons();
    // v0.3 에서 목표를 채운 채 '계속하기' 하던 판: 바로 클리어 + 엔드 보너스
    if (saved && !st.over && st.goals && M.goalsDone(st)) {
      busy = true;
      afterMove(M.settle(st, Math.random));
      return;
    }
    saveGame();
    scheduleHint();
  }
  let skipPop = false;
  function leaveGame() {
    if (st && !st.over && !busy) saveGame();
    clearHint();
    st = null;
    view = null;
  }
  function goHome() {
    leaveGame();
    showHome();
    if (history.state && history.state.m3) { skipPop = true; history.back(); }
  }
  window.addEventListener('popstate', () => {
    if (skipPop) { skipPop = false; return; }
    if (!gameEl.classList.contains('hidden')) { leaveGame(); showHome(); }
  });
  window.addEventListener('resize', layout);

  $('#btn-continue').addEventListener('click', () => { sfx.unlock(); if (save.current) startStage(save.current.stage, save.current.st); });
  $('#btn-play').addEventListener('click', () => { sfx.unlock(); openStage(+$('#btn-play').dataset.stage); });
  $('#stage-grid').addEventListener('click', e => {
    const b = e.target.closest('.stage-btn[data-stage]');
    if (b) { sfx.unlock(); openStage(+b.dataset.stage); }
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && st && !st.over && !busy) saveGame();
  });

  // 첫 화면 장식
  $('#logo').innerHTML = [0, 1, 2, 3, 4, 5].map(i => `<svg viewBox="0 0 100 100"><use href="#gem${i}"/></svg>`).join('');
  $('#app-version').textContent = `버전 ${APP_VERSION}`;
  showHome();

  // 확인용 (개발자 도구에서 사용)
  window.__m3 = { get st() { return st; }, get stage() { return stage; }, trySwap, tryActivate, get busy() { return busy; } };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('../../sw.js', { scope: '../../' }).catch(() => { });
  }
})();
