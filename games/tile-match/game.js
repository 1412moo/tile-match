(function () {
  'use strict';

  const { EMOJIS, generateLevel, levelParams, overlaps, solvableShuffle } = window.TM_Levels;

  const APP_VERSION = 9; // sw.js 의 VERSION 과 같게 유지
  const SLOT_SIZE = 7;
  const BOOSTER_START = { undo: 3, shuffle: 2, hint: 3 }; // 레벨마다 다시 채워짐
  const SAVE_KEY = 'tilematch.save.v1';
  const TILE_RATIO = 1.15; // 높이 / 너비
  const LIFT = 0.07;       // 층마다 위로 올라가는 정도 (타일 너비 비율)

  const $ = sel => document.querySelector(sel);
  const homeEl = $('#home'), gameEl = $('#game'), stagesEl = $('#stages'), boardArea = $('#board-area');
  const slotBar = $('#slot-bar'), tilesEl = $('#tiles'), overlay = $('#overlay');
  const slotCells = [...slotBar.querySelectorAll('.slot-cell')];

  // ---------------- 저장 ----------------
  let save = { level: 1, sound: true, current: null };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) save = Object.assign(save, JSON.parse(raw));
  } catch (e) { /* 저장소 사용 불가 - 기본값으로 진행 */ }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ }
  }

  function saveProgress() {
    if (!G) return;
    save.current = {
      level: G.level,
      tiles: G.tiles.map(t => [t.x, t.y, t.z, t.type, t.state]),
      slot: G.slot, undo: G.undo, boosters: G.boosters,
    };
    persist();
  }

  // ---------------- 효과음 (Web Audio 합성, 파일 없음) ----------------
  const sfx = (() => {
    let ctx = null;
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
      const t0 = c.currentTime + at;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
    return {
      unlock: ensure,
      tap: () => tone(700, 0, 0.08, 'triangle', 0.22, 900),
      blocked: () => tone(180, 0, 0.12, 'square', 0.06),
      match: () => [660, 830, 990].forEach((f, i) => tone(f, i * 0.06, 0.16, 'triangle', 0.2)),
      booster: () => tone(520, 0, 0.18, 'sine', 0.2, 1040),
      win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.22)),
      lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.18, 0.3, 'sawtooth', 0.07)),
    };
  })();

  // ---------------- 게임 상태 ----------------
  let G = null;       // { level, tiles, slot, undo, boosters, busy, bounds }
  const els = new Map(); // tile id -> element

  function newGame(level) {
    return {
      level,
      tiles: generateLevel(level),
      slot: [], undo: [],
      boosters: Object.assign({}, BOOSTER_START),
      busy: false,
    };
  }

  function restoreGame(cur) {
    const tiles = cur.tiles.map((a, id) => ({ id, x: a[0], y: a[1], z: a[2], type: a[3], state: a[4] }));
    // 매칭 애니메이션 도중 종료되어 같은 그림 3개가 슬롯에 남았다면 정리
    let slot = cur.slot.slice();
    const count = {};
    slot.forEach(id => { count[tiles[id].type] = (count[tiles[id].type] || 0) + 1; });
    slot = slot.filter(id => {
      if (count[tiles[id].type] < 3) return true;
      tiles[id].state = 'gone';
      return false;
    });
    return {
      level: cur.level, tiles, slot,
      undo: cur.undo.filter(id => tiles[id].state === 'slot'),
      boosters: Object.assign({}, BOOSTER_START, cur.boosters),
      busy: false,
    };
  }

  function isBlocked(t) {
    for (const o of G.tiles) {
      if (o.state === 'board' && o.z > t.z && overlaps(o, t)) return true;
    }
    return false;
  }

  // ---------------- 화면 전환 ----------------
  function showScreen(el) {
    [homeEl, gameEl, stagesEl].forEach(s => s.classList.toggle('hidden', s !== el));
    // 홈이 아닌 화면에서는 휴대폰 '뒤로' 버튼이 앱을 닫지 않고 홈으로 오도록 기록을 하나 쌓는다
    if (el !== homeEl && !(history.state && history.state.tm)) {
      try { history.pushState({ tm: 1 }, ''); } catch (e) { /* 무시 */ }
    }
  }

  function showHome() {
    clearHint();
    hideModal();
    showScreen(homeEl);
    const cur = save.current;
    $('#continue-sub').textContent = cur ? `레벨 ${cur.level} · 하던 판 이어서` : `레벨 ${save.level}`;
    updateSoundButtons();
  }

  // 홈으로 (버튼): 진행 저장 후 홈 화면, 쌓아 둔 '뒤로' 기록도 정리
  let skipPop = false;
  function goHome() {
    if (G && !G.busy) saveProgress();
    G = null;
    showHome();
    if (history.state && history.state.tm) { skipPop = true; history.back(); }
  }

  // 휴대폰 '뒤로' 버튼
  window.addEventListener('popstate', () => {
    if (skipPop) { skipPop = false; return; }
    if (G && G.busy) { // 매칭/결과 처리 중에는 무시하고 현재 화면 유지
      try { history.pushState({ tm: 1 }, ''); } catch (e) { /* 무시 */ }
      return;
    }
    if (G) saveProgress();
    G = null;
    showHome();
  });

  // 이어하기: 하던 판이 있으면 그 판, 없으면 아직 못 깬 레벨
  function continueGame() {
    if (save.current) startLevel(save.current.level, true);
    else startLevel(save.level, false);
  }

  // 새 게임: 하던 판을 버리고 도전할 레벨을 처음부터
  function newGameClick() {
    const start = () => startLevel(save.level, false);
    if (!save.current) return start();
    showModal({
      emoji: '🆕', title: '새 게임을 시작할까요?',
      text: `하던 판(레벨 ${save.current.level})은 지워지고
레벨 ${save.level}부터 새로 시작해요.`,
      buttons: [
        { label: '새로 시작', onClick: start },
        { label: '취소', cls: 'light', onClick: () => { } },
      ],
    });
  }

  // ---------------- 스테이지 선택 ----------------
  const PAGE = 20;
  let stagePage = 0;
  function showStages(page) {
    const lastPage = Math.floor((save.level - 1) / PAGE);
    stagePage = Math.max(0, Math.min(lastPage, page === undefined ? lastPage : page));
    const grid = $('#stage-grid');
    grid.innerHTML = '';
    const first = stagePage * PAGE + 1;
    for (let lv = first; lv < first + PAGE; lv++) {
      const b = document.createElement('button');
      const state = lv < save.level ? 'cleared' : lv === save.level ? 'current' : 'locked';
      b.className = 'stage ' + state;
      b.innerHTML = state === 'locked' ? '<span class="mark">🔒</span>'
        : `${lv}<span class="mark">${state === 'cleared' ? '✓' : '▶'}</span>`;
      if (save.current && save.current.level === lv) b.insertAdjacentHTML('beforeend', '<span class="tag">진행 중</span>');
      b.setAttribute('aria-label', `레벨 ${lv}` + (state === 'locked' ? ' 잠김' : ''));
      b.addEventListener('click', () => pickStage(lv));
      grid.appendChild(b);
    }
    $('#pg-label').textContent = `${first} – ${first + PAGE - 1}`;
    $('#pg-prev').disabled = stagePage === 0;
    $('#pg-next').disabled = stagePage === lastPage;
    showScreen(stagesEl);
    grid.scrollTop = 0;
  }

  function pickStage(lv) {
    sfx.unlock();
    if (lv > save.level) { sfx.blocked(); return toast('앞 레벨을 먼저 깨면 열려요'); }
    const cur = save.current;
    if (!cur || cur.level === lv) return startLevel(lv, true); // 하던 판이면 이어서
    showModal({
      emoji: '🎯', title: `레벨 ${lv} 시작할까요?`,
      text: `하던 판(레벨 ${cur.level})은 지워져요.`,
      buttons: [
        { label: '시작', onClick: () => startLevel(lv, false) },
        { label: '취소', cls: 'light', onClick: () => { } },
      ],
    });
  }

  function startLevel(level, resume) {
    hideModal();
    showScreen(gameEl);
    G = resume && save.current && save.current.level === level ? restoreGame(save.current) : newGame(level);
    const all = G.tiles;
    G.bounds = {
      minX: Math.min(...all.map(t => t.x)), maxX: Math.max(...all.map(t => t.x)),
      minY: Math.min(...all.map(t => t.y)), maxY: Math.max(...all.map(t => t.y)),
      maxZ: Math.max(...all.map(t => t.z)),
    };
    $('#level-label').textContent = `레벨 ${level}`;
    $('#tip').textContent = level === 1 ? '같은 그림 3개를 모으면 사라져요!'
      : level === 2 ? '어두운 타일은 위의 타일을 먼저 치워야 해요'
        : '';

    tilesEl.innerHTML = '';
    els.clear();
    for (const t of G.tiles) {
      if (t.state === 'gone') continue;
      const el = document.createElement('div');
      el.className = 'tile appear';
      el.dataset.id = t.id;
      el.style.animationDelay = (t.z * 0.08 + Math.random() * 0.12).toFixed(2) + 's';
      el.innerHTML = `<span class="em">${EMOJIS[t.type]}</span>`;
      el.addEventListener('click', () => onTileTap(t.id)); // 누른 타일에서 손을 뗄 때만 선택
      el.addEventListener('animationend', () => el.classList.remove('appear', 'shuffling', 'shake'));
      tilesEl.appendChild(el);
      els.set(t.id, el);
    }
    layout(false);
    refresh();
    saveProgress();
  }

  // ---------------- 배치 계산 ----------------
  function layout(animate) {
    if (!G || gameEl.classList.contains('hidden')) return;
    if (!animate) tilesEl.classList.add('no-anim');
    const gr = gameEl.getBoundingClientRect();
    const ba = boardArea.getBoundingClientRect();
    const b = G.bounds;
    const unitsW = b.maxX - b.minX + 2, unitsH = b.maxY - b.minY + 2;
    const cols = unitsW / 2, rows = unitsH / 2;
    const W = Math.min(
      (ba.width - 8) / cols,
      (ba.height - 12) / (rows * TILE_RATIO + b.maxZ * LIFT + 0.12),
      84);
    const H = W * TILE_RATIO;
    const boardW = cols * W, boardH = rows * H + b.maxZ * LIFT * W;
    const ox = ba.left - gr.left + (ba.width - boardW) / 2;
    const oy = ba.top - gr.top + (ba.height - boardH) / 2 + b.maxZ * LIFT * W;

    for (const t of G.tiles) {
      if (t.state !== 'board') continue;
      place(els.get(t.id),
        ox + (t.x - b.minX) / 2 * W,
        oy + (t.y - b.minY) / 2 * H - t.z * LIFT * W,
        W, H, 10 + t.z * 100 + t.y);
    }
    G.slot.forEach((id, i) => {
      const r = slotCells[i].getBoundingClientRect();
      place(els.get(id), r.left - gr.left, r.top - gr.top - 2, r.width, r.height, 5000 + i);
    });

    if (!animate) {
      void tilesEl.offsetWidth; // 트랜지션 없이 즉시 적용
      tilesEl.classList.remove('no-anim');
    }
  }

  function place(el, x, y, w, h, z) {
    if (!el) return;
    el.style.left = x.toFixed(1) + 'px';
    el.style.top = y.toFixed(1) + 'px';
    el.style.width = w.toFixed(1) + 'px';
    el.style.height = h.toFixed(1) + 'px';
    el.style.fontSize = (w * 0.62).toFixed(1) + 'px';
    el.style.setProperty('--d', Math.max(3, w * 0.1).toFixed(1) + 'px');
    el.style.zIndex = z;
  }

  // 막힘 표시, 부스터 개수, 위험 표시 갱신
  function refresh() {
    for (const t of G.tiles) {
      const el = els.get(t.id);
      if (el) el.classList.toggle('blocked', t.state === 'board' && isBlocked(t));
    }
    layout(true);
    for (const k of ['undo', 'shuffle', 'hint']) {
      const btn = $('#b-' + k);
      btn.querySelector('.b-count').textContent = G.boosters[k];
      btn.classList.toggle('empty', G.boosters[k] <= 0);
    }
    slotBar.classList.toggle('danger', G.slot.length >= SLOT_SIZE - 1);
  }

  // ---------------- 플레이 ----------------
  function onTileTap(id) {
    sfx.unlock();
    if (!G || G.busy) return;
    const t = G.tiles[id];
    if (t.state !== 'board') return;
    const el = els.get(id);
    if (isBlocked(t)) {
      sfx.blocked();
      el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
      return;
    }
    clearHint();
    sfx.tap();

    // 같은 그림 옆에 끼워 넣기
    t.state = 'slot';
    let idx = -1;
    G.slot.forEach((s, i) => { if (G.tiles[s].type === t.type) idx = i; });
    if (idx >= 0) G.slot.splice(idx + 1, 0, id); else G.slot.push(id);
    G.undo.push(id);
    refresh();

    const same = G.slot.filter(s => G.tiles[s].type === t.type);
    if (same.length >= 3) {
      G.busy = true;
      setTimeout(() => {
        sfx.match();
        same.forEach(s => els.get(s).classList.add('pop'));
        setTimeout(() => {
          same.forEach(s => {
            G.tiles[s].state = 'gone';
            els.get(s).remove();
            els.delete(s);
          });
          G.slot = G.slot.filter(s => !same.includes(s));
          G.undo = G.undo.filter(u => G.tiles[u].state === 'slot');
          G.busy = false;
          refresh();
          if (G.tiles.every(x => x.state === 'gone')) onWin();
          else saveProgress();
        }, 270);
      }, 230);
    } else if (G.slot.length >= SLOT_SIZE) {
      G.busy = true;
      save.current = null; persist();
      setTimeout(onLose, 450);
    } else {
      saveProgress();
    }
  }

  function onWin() {
    const lv = G.level;
    G.busy = true; // 결과 창이 뜰 때까지 다른 조작 막기
    save.level = Math.max(save.level, lv + 1);
    save.current = null;
    persist();
    sfx.win();
    setTimeout(() => showModal({
      emoji: '🎉', title: `레벨 ${lv} 클리어!`, text: '잘하셨어요!',
      buttons: [
        { label: '다음 레벨 ▶', onClick: () => startLevel(lv + 1, false) },
        { label: '홈으로', cls: 'light', onClick: goHome },
      ],
    }), 250);
  }

  function onLose() {
    const lv = G.level;
    sfx.lose();
    showModal({
      emoji: '😢', title: '칸이 가득 찼어요', text: '다시 도전해 보세요!',
      buttons: [
        { label: '다시 하기', onClick: () => startLevel(lv, false) },
        { label: '홈으로', cls: 'light', onClick: goHome },
      ],
    });
  }

  // ---------------- 부스터 ----------------
  function useUndo() {
    if (!G || G.busy) return;
    if (G.boosters.undo <= 0) return toast('되돌리기를 모두 사용했어요');
    let id = null;
    while (G.undo.length) {
      const c = G.undo.pop();
      if (G.tiles[c].state === 'slot') { id = c; break; }
    }
    if (id === null) return toast('되돌릴 타일이 없어요');
    clearHint();
    sfx.booster();
    G.boosters.undo--;
    G.tiles[id].state = 'board';
    G.slot.splice(G.slot.indexOf(id), 1);
    refresh();
    saveProgress();
  }

  function useShuffle() {
    if (!G || G.busy) return;
    if (G.boosters.shuffle <= 0) return toast('섞기를 모두 사용했어요');
    const onBoard = G.tiles.filter(t => t.state === 'board');
    if (onBoard.length < 2) return toast('섞을 타일이 없어요');
    // 풀 수 있는 배치만 사용 (각 그림 개수는 그대로)
    const slotTypes = G.slot.map(id => G.tiles[id].type);
    const types = solvableShuffle(onBoard, slotTypes, levelParams(G.level).maxOpen, Math.random, SLOT_SIZE);
    if (!types) return toast('지금은 섞어도 풀 수 없어요.\n되돌리기를 먼저 써 보세요');
    clearHint();
    sfx.booster();
    G.boosters.shuffle--;
    G.busy = true;
    onBoard.forEach(t => {
      const el = els.get(t.id);
      el.classList.remove('shuffling'); void el.offsetWidth; el.classList.add('shuffling');
    });
    setTimeout(() => { // 뒤집히는 순간에 그림 교체
      onBoard.forEach((t, i) => {
        t.type = types[i];
        els.get(t.id).querySelector('.em').textContent = EMOJIS[t.type];
      });
    }, 210);
    setTimeout(() => { G.busy = false; refresh(); saveProgress(); }, 430);
  }

  let hinted = [];
  function clearHint() {
    hinted.forEach(id => { const el = els.get(id); if (el) el.classList.remove('hint'); });
    hinted = [];
  }

  function useHint() {
    if (!G || G.busy) return;
    if (G.boosters.hint <= 0) return toast('힌트를 모두 사용했어요');
    clearHint();
    const free = G.tiles.filter(t => t.state === 'board' && !isBlocked(t));
    const inSlot = {};
    G.slot.forEach(id => { const ty = G.tiles[id].type; inSlot[ty] = (inSlot[ty] || 0) + 1; });
    const byType = {};
    free.forEach(t => (byType[t.type] = byType[t.type] || []).push(t));

    // 슬롯에 이미 있는 그림을 우선으로, 3개를 완성할 수 있는 조합 찾기
    let best = null;
    for (const ty in byType) {
      const have = inSlot[ty] || 0, need = 3 - have;
      if (byType[ty].length < need) continue;
      if (G.slot.length + need - 1 >= SLOT_SIZE) continue; // 넣다가 칸이 차면 안 됨
      if (!best || have > best.have) best = { have, tiles: byType[ty].slice(0, need) };
    }
    if (!best) return toast('지금은 바로 맞출 수 있는 게 없어요.\n섞기를 써 보세요!');
    sfx.booster();
    G.boosters.hint--;
    hinted = best.tiles.map(t => t.id);
    hinted.forEach(id => els.get(id).classList.add('hint'));
    refresh();
    saveProgress();
  }

  // ---------------- UI 도우미 ----------------
  function showModal({ emoji, title, text, buttons }) {
    overlay.querySelector('.modal-emoji').textContent = emoji;
    overlay.querySelector('.modal-title').textContent = title;
    overlay.querySelector('.modal-text').textContent = text || '';
    const box = overlay.querySelector('.modal-btns');
    box.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => { sfx.unlock(); hideModal(); b.onClick(); });
      box.appendChild(btn);
    }
    overlay.classList.remove('hidden');
  }
  function hideModal() { overlay.classList.add('hidden'); }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.style.whiteSpace = 'pre-line';
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  function updateSoundButtons() {
    $('#btn-sound').textContent = save.sound ? '🔊' : '🔇';
    $('#btn-sound-home').textContent = save.sound ? '🔊 소리 켜짐' : '🔇 소리 꺼짐';
  }
  function toggleSound() {
    save.sound = !save.sound;
    persist();
    updateSoundButtons();
    sfx.tap();
  }

  // ---------------- 이벤트 연결 ----------------
  $('#btn-continue').addEventListener('click', () => { sfx.unlock(); continueGame(); });
  $('#btn-new').addEventListener('click', () => { sfx.unlock(); newGameClick(); });
  $('#btn-stages').addEventListener('click', () => { sfx.unlock(); showStages(); });
  $('#btn-stages-back').addEventListener('click', goHome);
  // 게임 모음 메인 화면으로: 메인에서 들어왔으면 뒤로 가기(기록이 쌓이지 않게), 아니면 이동
  $('#btn-hub').addEventListener('click', () => {
    let fromHub = false;
    try { fromHub = sessionStorage.getItem('hub.opened') === '1'; } catch (e) { /* 무시 */ }
    if (fromHub && history.length > 1) history.back();
    else location.replace('../../');
  });
  $('#pg-prev').addEventListener('click', () => showStages(stagePage - 1));
  $('#pg-next').addEventListener('click', () => showStages(stagePage + 1));
  $('#btn-sound-home').addEventListener('click', toggleSound);
  $('#btn-sound').addEventListener('click', toggleSound);
  $('#btn-home').addEventListener('click', () => {
    if (G && G.busy) return; // 매칭/결과 처리 중에는 무시
    goHome();
  });
  $('#btn-restart').addEventListener('click', () => {
    if (!G || G.busy) return;
    const lv = G.level;
    showModal({
      emoji: '↻', title: '처음부터 다시 할까요?', text: '',
      buttons: [
        { label: '다시 하기', onClick: () => startLevel(lv, false) },
        { label: '취소', cls: 'light', onClick: () => { } },
      ],
    });
  });
  $('#b-undo').addEventListener('click', useUndo);
  $('#b-shuffle').addEventListener('click', useShuffle);
  $('#b-hint').addEventListener('click', useHint);

  window.addEventListener('resize', () => layout(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && G && !G.busy) saveProgress();
  });

  $('#app-version').textContent = `버전 ${APP_VERSION}`;
  showHome();

  // 오프라인 실행을 위한 서비스 워커 (http(s)로 열었을 때만)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // 서비스 워커는 앱 전체(루트)에 하나만 둔다
    navigator.serviceWorker.register('../../sw.js', { scope: '../../' }).catch(() => { });
  }
})();
