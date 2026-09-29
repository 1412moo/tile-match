(function () {
  'use strict';

  const APP_VERSION = 20; // sw.js 의 VERSION 이하, 이 게임 HTML 의 ?v= 와 같게
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
    if (st.moves !== shownMoves) {
      m.textContent = st.moves;
      shownMoves = st.moves;
    }
    m.parentElement.classList.toggle('low', st.moves <= 3);
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
    // 별 기준 (넘으면 밝게)
    const [s2, s3] = stage.stars;
    const on = v => (view.score >= v ? 'on' : 'off');
    $('#best').innerHTML = `<span class="stars-line"><span class="${on(s2)}">★★</span> ${s2.toLocaleString('ko-KR')}점 · <span class="${on(s3)}">★★★</span> ${s3.toLocaleString('ko-KR')}점</span>`;
  }

  // ---------------- 효과 ----------------
  function sparks(r, c, color, n) {
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'spark';
      const a = Math.random() * Math.PI * 2, d = cell * (0.5 + Math.random() * 0.7);
      s.style.left = ((c + 0.5) * cell - 4) + 'px';
      s.style.top = ((r + 0.5) * cell - 4) + 'px';
      s.style.background = color;
      s.style.setProperty('--dx', Math.cos(a) * d + 'px');
      s.style.setProperty('--dy', Math.sin(a) * d + 'px');
      board.appendChild(s);
      setTimeout(() => s.remove(), 460);
    }
  }
  function beam(t) {
    const b = document.createElement('div');
    b.className = 'beam';
    if (t.s === 'row') Object.assign(b.style, { left: '0px', top: (t.r * cell + cell * 0.38) + 'px', width: (N * cell) + 'px', height: (cell * 0.24) + 'px' });
    else if (t.s === 'col') Object.assign(b.style, { top: '0px', left: (t.c * cell + cell * 0.38) + 'px', height: (N * cell) + 'px', width: (cell * 0.24) + 'px' });
    else if (t.s === 'bomb') Object.assign(b.style, { left: ((t.c - 1) * cell) + 'px', top: ((t.r - 1) * cell) + 'px', width: (3 * cell) + 'px', height: (3 * cell) + 'px', borderRadius: '30%', background: 'rgba(255,220,120,.6)' });
    else Object.assign(b.style, { left: '0px', top: '0px', width: (N * cell) + 'px', height: (N * cell) + 'px', borderRadius: '16px', background: 'rgba(255,255,255,.35)' });
    board.appendChild(b);
    setTimeout(() => b.remove(), 340);
  }
  function floatText(x, y, text) {
    const f = document.createElement('div');
    f.className = 'float';
    f.textContent = text;
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    board.appendChild(f);
    setTimeout(() => f.remove(), 820);
  }
  function showCombo(n) {
    const el = $('#combo');
    el.textContent = `${n} 연쇄!`;
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(showCombo.t);
    showCombo.t = setTimeout(() => el.classList.add('hidden'), 700);
  }

  // 엔진이 돌려준 단계(지우기/채우기/섞기)를 차례로 보여 준다
  async function runSteps(steps) {
    for (const step of steps) {
      if (step.kind === 'clear') {
        if (step.combo >= 2) showCombo(step.combo);
        for (const t of step.triggered) { beam(t); (t.s === 'bomb' ? sfx.bomb : t.s === 'rainbow' ? sfx.rainbow : sfx.line)(); }
        sfx.pop(step.combo);
        let sx = 0, sy = 0;
        for (const x of step.cleared) {
          const el = els.get(x.id);
          if (el) { el.classList.add('pop'); setTimeout(() => el.remove(), 200); els.delete(x.id); }
          if (step.cleared.length <= 12) sparks(x.r, x.c, GEM_COLORS[x.color] || '#fff', 3);
          sx += x.c; sy += x.r;
        }
        const n = step.cleared.length || 1;
        floatText((sx / n + 0.5) * cell, (sy / n + 0.5) * cell, `+${step.points}`);
        if (step.specials.length) sfx.made();
        await sleep(200);
        for (const x of step.specials) makeEl(x, x.r, x.c).classList.add('appear');
        if (view) {
          view.score += step.points;
          step.cleared.forEach(x => { if (x.color >= 0) view.cleared[x.color]++; });
          view.made += step.specials.length;
        }
        updateHud();
        await sleep(40);
      } else if (step.kind === 'fall') {
        let longest = 0;
        for (const m of step.moves) {
          const el = els.get(m.id);
          const dur = 90 + 50 * (m.r - m.fromR);
          if (el) place(el, m.r, m.c, dur, 'cubic-bezier(.45,0,.6,1.3)');
          longest = Math.max(longest, dur);
        }
        const fresh = step.spawns.map(sp => ({ sp, el: makeEl({ id: sp.id, c: sp.color, s: null }, sp.fromR, sp.c) }));
        void board.offsetWidth; // 위에서 시작한 자리를 먼저 그리고
        for (const { sp, el } of fresh) {
          const dur = 90 + 50 * (sp.r - sp.fromR);
          place(el, sp.r, sp.c, dur, 'cubic-bezier(.45,0,.6,1.3)');
          longest = Math.max(longest, dur);
        }
        await sleep(longest + 20);
        sfx.land();
      } else if (step.kind === 'shuffle') {
        toast('더 움직일 수 없어서\n보석을 섞을게요');
        sfx.shuffle();
        await sleep(500);
        if (step.fresh) renderAll();
        else for (const x of step.cells) { const el = els.get(x.id); if (el) place(el, x.r, x.c, 380); }
        await sleep(420);
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
    if (sel && M.adjacent(sel, d.p)) trySwap(sel, d.p);
    else if (sel && sel.r === d.p.r && sel.c === d.p.c) select(null);
    else select(d.p);
  });
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
    const game = st;
    await runSteps(res.steps);
    if (st !== game) return;
    syncView(); // 화면 진행도를 실제 값과 맞춤
    updateHud();
    if (st.over) { gameOver(); busy = false; return; }
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
  function gameOver() {
    const won = st.result === 'win';
    const score = st.score;
    const before = save.progress.stars[stage.id] || 0;
    save.progress = S3.applyResult(save.progress, stage.id, won, score);
    save.current = null;
    persist();
    const stars = S3.starsFor(stage, won, score);
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
      body: `<div><b>목표</b></div>${goalListHTML(x.goals, false)}<div class="moves-note">${x.moves}번 안에 해내면 성공!</div>`,
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
    syncView();
    showScreen(gameEl);
    $('#stage-label').textContent = `스테이지 ${stage.id}`;
    renderGoals();
    layout();
    renderAll();
    updateHud();
    updateSoundButtons();
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
  window.__m3 = { get st() { return st; }, get stage() { return stage; }, trySwap, get busy() { return busy; } };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('../../sw.js', { scope: '../../' }).catch(() => { });
  }
})();
