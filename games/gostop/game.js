(function () {
  'use strict';

  const APP_VERSION = 14; // sw.js 의 VERSION 과 같게 유지
  const SAVE_KEY = 'gostop.save.v1';
  const R = window.GS;
  const C = R.CARDS;
  const ART = window.GSArt;

  const $ = sel => document.querySelector(sel);
  const homeEl = $('#home'), gameEl = $('#game'), overlay = $('#overlay');

  // ---------------- 저장 (고스톱 전용 키) ----------------
  let save = { sound: true, stats: { wins: 0, losses: 0, draws: 0, points: 0 }, current: null, nextFirst: 0, nextMult: 1 };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      save = Object.assign(save, s, { stats: Object.assign({}, save.stats, s.stats) });
      if (save.current) save.current = R.upgradeState(save.current); // 예전 규칙으로 저장된 판도 이어서
    }
  } catch (e) { /* 저장소 사용 불가 - 기본값 */ }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ }
  }

  // 판이 끝났으면 기록에 한 번만 반영
  function recordResult() {
    if (!S || !S.over || S.over.recorded) return;
    const o = S.over;
    const net = R.netForPlayer(o);
    save.stats.points += net;
    if (o.draw) {
      save.stats.draws++;
      save.nextMult = Math.min((S.mult || 1) * 2, 16); // 나가리: 다음 판 2배, 선 유지
      save.nextFirst = S.first;
    } else {
      if (o.winner === 0) save.stats.wins++; else save.stats.losses++;
      save.nextFirst = o.winner;
      save.nextMult = 1;
    }
    o.net = net;
    o.recorded = true;
  }

  function saveGame() {
    if (S && S.phase === 'over') recordResult();
    save.current = S && S.phase !== 'over' ? JSON.parse(JSON.stringify(S)) : null;
    persist();
  }

  // ---------------- 효과음 (Web Audio 합성) ----------------
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
    // 잡음 한 번: 카드가 부딪히고 스치는 소리의 재료
    // o = { at, dur, freq, freqTo, q, vol, type, curve(감쇠 세기) }
    let noiseBuf = null;
    function noise(o) {
      if (!save.sound) return;
      const c = ensure();
      if (!c) return;
      if (!noiseBuf) {
        const len = c.sampleRate; // 1초짜리 흰 잡음을 만들어 두고 잘라 씀
        noiseBuf = c.createBuffer(1, len, c.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = c.currentTime + (o.at || 0), dur = o.dur;
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = noiseBuf;
      f.type = o.type || 'bandpass';
      f.frequency.setValueAtTime(o.freq, t0);
      if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t0 + dur);
      f.Q.value = o.q || 1;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(o.vol, t0 + (o.attack || 0.002));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(c.destination);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + 0.02);
    }
    // '탁': 패를 바닥에 내리치는 소리 (짝패 위에 칠 때는 더 세고 높게 '딱!')
    function slap(hard) {
      noise({ dur: hard ? 0.07 : 0.06, freq: hard ? 2600 : 1900, q: 0.9, vol: hard ? 1 : 0.75 });
      noise({ dur: 0.012, freq: 5200, q: 0.7, vol: hard ? 0.55 : 0.3, type: 'highpass' }); // 앞의 딱딱한 부딪힘
      tone(hard ? 190 : 160, 0, 0.07, 'sine', hard ? 0.4 : 0.3, 70);                      // 바닥 울림
    }
    return {
      unlock: ensure, slap,
      // '쓱-': 상대 피를 끌어오는 소리 + 짧은 '띵'
      steal: () => { noise({ dur: 0.22, freq: 3400, freqTo: 900, q: 1.1, vol: 0.35, attack: 0.03 }); tone(1320, 0.17, 0.14, 'triangle', 0.13); },
      // '슥': 더미에서 한 장 받아 손으로
      draw: () => noise({ dur: 0.09, freq: 1600, freqTo: 2600, q: 1, vol: 0.25, attack: 0.015 }),
      go: () => [523, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.2, 'triangle', 0.22)),
      win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.22)),
      lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.18, 0.3, 'sawtooth', 0.07)),
      // ---- 상황별 효과음 (전부 직접 합성) ----
      // 쪽: 짧고 높은 '쪽' + 반짝
      jjok: () => { tone(1500, 0, 0.05, 'sine', 0.28, 3300); noise({ at: 0.035, dur: 0.03, freq: 4200, q: 2, vol: 0.3 }); tone(2350, 0.1, 0.14, 'triangle', 0.12); },
      // 뻑: 둔하고 김빠지는 '뻐억'
      ppeok: () => { tone(230, 0, 0.32, 'sawtooth', 0.15, 70); tone(244, 0, 0.32, 'square', 0.07, 74); noise({ dur: 0.2, freq: 320, q: 0.8, vol: 0.55, type: 'lowpass' }); },
      // 따닥: 연달아 두 번 세게 + 딩동
      ttadak: () => { slap(true); setTimeout(() => slap(true), 110); [880, 1320].forEach((f, i) => tone(f, 0.24 + i * 0.07, 0.14, 'triangle', 0.16)); },
      // 싹쓸이: 쓸어 담는 '쏴아' + 올라가는 음
      sseul: () => { noise({ dur: 0.4, freq: 500, freqTo: 6000, q: 0.7, vol: 0.45, attack: 0.05 }); [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.26 + i * 0.06, 0.16, 'triangle', 0.15)); },
      // 뻑 먹기 / 자뻑: 가져오는 '쓱' + 두 음
      grab: () => { noise({ dur: 0.2, freq: 3000, freqTo: 900, q: 1, vol: 0.28 }); [660, 990].forEach((f, i) => tone(f, 0.08 + i * 0.07, 0.14, 'triangle', 0.18)); },
      // 첫뻑·연뻑·첫따닥 점수
      points: () => [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, i * 0.06, 0.18, 'square', 0.07)),
      // 폭탄: 낮게 '쾅'
      boom: () => { tone(120, 0, 0.5, 'sine', 0.65, 36); noise({ dur: 0.4, freq: 1000, freqTo: 120, q: 0.6, vol: 0.85, type: 'lowpass' }); noise({ dur: 0.025, freq: 2500, q: 0.5, vol: 0.5, type: 'highpass' }); },
      // 흔들기: 달그락달그락
      rattle: () => { for (let i = 0; i < 7; i++) noise({ at: i * 0.055, dur: 0.035, freq: 2400 + (i % 2) * 800, q: 1.6, vol: 0.38 }); },
      // 족보 완성: 빰빠밤
      yaku: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.2, 'triangle', 0.22)); tone(1047, 0.34, 0.5, 'triangle', 0.2); tone(1319, 0.34, 0.5, 'sine', 0.12); },
      // 고도리: 새소리 + 빰빠밤
      godori: () => { [2637, 3136, 2637, 3520].forEach((f, i) => tone(f, i * 0.06, 0.06, 'sine', 0.1, f * 1.1)); [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28 + i * 0.08, 0.2, 'triangle', 0.22)); tone(1047, 0.62, 0.5, 'triangle', 0.2); },
      // 비상: 삐뽀삐뽀
      siren: () => [0, 0.24].forEach(t => { tone(880, t, 0.12, 'square', 0.07); tone(660, t + 0.12, 0.12, 'square', 0.07); }),
      stop: () => [784, 659, 523, 1047].forEach((f, i) => tone(f, i * 0.1, i === 3 ? 0.45 : 0.16, 'triangle', 0.22)),
    };
  })();

  // ---------------- 패 ----------------
  const KIND_NAME = { gwang: '광', yeol: '열끗', tti: '띠', pi: '피' };
  function cardName(id) {
    const c = C[id];
    if (c.bonus) return c.pi === 3 ? '보너스 쓰리피' : '보너스 쌍피';
    const k = c.gukjin ? '국진' : c.dan ? { hong: '홍단', cheong: '청단', cho: '초단' }[c.dan] : c.pi === 2 ? '쌍피' : KIND_NAME[c.kind];
    return `${c.month}월 ${R.MONTH_NAME[c.month]} ${k}`;
  }
  function cardEl(id, w) {
    const el = document.createElement('div');
    el.className = 'hw';
    el.style.backgroundImage = ART.url(id);
    if (w) el.style.setProperty('--w', w + 'px');
    el.dataset.id = id;
    if (hidden.has(id)) el.classList.add('ghost'); // 날아오는 중: 도착하면 보임
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', cardName(id));
    return el;
  }
  function backEl() {
    const el = document.createElement('div');
    el.className = 'hw back';
    el.style.backgroundImage = ART.back();
    return el;
  }
  function showCards(ids) {
    const box = document.createElement('div');
    box.className = 'show';
    ids.forEach(id => box.appendChild(cardEl(id)));
    return box;
  }

  // ---------------- 게임 상태 / 화면 ----------------
  let S = null;
  let busy = false;
  let pickOptions = null, pickResolve = null, selected = null;
  let slotOf = {}; // 바닥: 달 → 자리 번호 (한 번 놓인 자리는 그 달이 없어질 때까지 유지)
  // 연출 중 잠깐 보여 주는 화면 상태 (규칙 상태 S 는 그대로)
  //   floorAdd: 뒤집어서 바닥에 내려놓은 것처럼 보일 패, deckHide: 더미에서 이미 꺼낸 장수,
  //   capAdd: 먼저 먹은 것처럼 보일 패 (더미 위 보너스패)
  const view = { floorAdd: [], deckHide: 0, capAdd: [[], []] };
  const hidden = new Set(); // 날아오는 중이라 아직 숨겨 둔 카드
  const resetView = () => { view.floorAdd = []; view.deckHide = 0; view.capAdd = [[], []]; };
  const floorIds = () => S.floor.concat(view.floorAdd);

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const setMsg = t => { $('#msg').textContent = t || ''; };

  function badgesHTML(p) {
    let h = '';
    if (S.go[p]) h += `<span class="badge go">${S.go[p]}고</span>`;
    if (S.shake[p]) h += `<span class="badge shake">흔들기${S.shake[p] > 1 ? ' ×' + S.shake[p] : ''}</span>`;
    if (S.bomb[p]) h += `<span class="badge shake">폭탄${S.bomb[p] > 1 ? ' ×' + S.bomb[p] : ''}</span>`;
    const sc = R.bestScore(S.captured[p]);
    if (sc.godori) h += '<span class="badge">고도리</span>';
    if (sc.hong) h += '<span class="badge">홍단</span>';
    if (sc.cheong) h += '<span class="badge">청단</span>';
    if (sc.cho) h += '<span class="badge">초단</span>';
    return h;
  }

  // 먹은 패를 광·열끗·띠·피 더미로 (국진은 점수 계산대로 열끗 또는 피 쪽에)
  function renderPiles(box, ids) {
    const sc = R.bestScore(ids);
    const group = id => (C[id].gukjin && sc.gukjinAsPi ? 'pi' : C[id].kind);
    const groups = [
      ['gwang', sc.gwangCount, sc.gwangScore > 0],
      ['yeol', sc.yeolCount, sc.yeolScore + sc.godori > 0],
      ['tti', sc.ttiCount, sc.ttiScore + sc.hong + sc.cheong + sc.cho > 0],
      ['pi', sc.piCount, sc.piScore > 0],
    ];
    box.innerHTML = '';
    for (const [k, cnt, on] of groups) {
      const pile = document.createElement('div');
      pile.className = `pile g-${k}`;
      const list = ids.filter(id => group(id) === k).sort((a, b) => C[b].pi - C[a].pi || a - b);
      list.forEach(id => pile.appendChild(cardEl(id)));
      if (list.length) {
        const b = document.createElement('span');
        b.className = 'cnt' + (on ? ' on' : '');
        b.textContent = cnt;
        pile.appendChild(b);
      }
      box.appendChild(pile);
    }
    layoutPiles(box);
  }

  // 먹은 패 배치: 광·열끗·띠는 장수만큼만 폭을 쓰고, 남는 폭은 모두 피에 준다.
  // 피는 한 장당 최소 PI_MIN_STEP(카드 폭의 45%, 11px 이상)씩 보이게 겹치고,
  // 한 줄에 다 안 들어가면 두 줄로 (둘째 줄은 첫 줄 위에 반쯤 겹쳐) 놓는다.
  function layoutPiles(box) {
    const piles = [...box.querySelectorAll('.pile')];
    const first = box.querySelector('.hw');
    if (!first) { piles.forEach(p => { p.style.width = '0px'; p.style.height = '0px'; }); return; }
    const w = first.offsetWidth, h = first.offsetHeight;
    const GAP = 6, BADGE = 8;
    const boxW = box.clientWidth;
    const nOf = p => p.querySelectorAll('.hw').length;
    const others = piles.filter(p => !p.classList.contains('g-pi'));
    const pi = piles.find(p => p.classList.contains('g-pi'));
    const piN = nOf(pi);
    const minStep = Math.max(11, Math.round(w * 0.45));
    const used = piles.filter(p => nOf(p)).length;
    const gaps = GAP * Math.max(0, used - 1);
    const widthOf = (n, step) => (n ? w + (n - 1) * step + BADGE : 0);

    // 1) 광·열끗·띠: 카드 폭의 반씩 보이게 (자리가 모자라면 아래에서 줄임)
    let oStep = Math.round(w * 0.5);
    const piNeed = rows => (piN ? w + (Math.ceil(piN / rows) - 1) * minStep + BADGE : 0);
    const othersW = st => others.reduce((a, p) => a + widthOf(nOf(p), st), 0);
    let rows = 1;
    if (piN && boxW - gaps - othersW(oStep) < piNeed(1)) rows = 2;
    // 두 줄로도 모자라면 광·열끗·띠 겹침을 더 촘촘하게 (최소 6px)
    const extra = others.reduce((a, p) => a + Math.max(0, nOf(p) - 1), 0);
    if (extra && boxW - gaps - othersW(oStep) < piNeed(rows)) {
      const fixed = others.reduce((a, p) => a + (nOf(p) ? w + BADGE : 0), 0);
      oStep = Math.max(6, Math.floor((boxW - gaps - piNeed(rows) - fixed) / extra));
    }
    others.forEach(p => {
      const n = nOf(p);
      p.style.flex = 'none';
      p.style.width = widthOf(n, oStep) + 'px';
      p.style.height = n ? h + 'px' : '0px';
      [...p.querySelectorAll('.hw')].forEach((c, i) => { c.style.left = (i * oStep) + 'px'; c.style.top = '0px'; c.style.zIndex = i + 1; });
    });

    // 2) 피: 남은 폭 전부
    if (!piN) { pi.style.width = '0px'; pi.style.height = '0px'; return; }
    const piW = Math.max(piNeed(rows), boxW - gaps - othersW(oStep));
    const perRow = Math.ceil(piN / rows);
    const step = perRow > 1 ? Math.min(Math.round(w * 0.62), (piW - BADGE - w) / (perRow - 1)) : 0;
    const rowOff = Math.round(h * 0.45); // 둘째 줄은 아래로 45% 내려 놓음
    pi.style.flex = 'none';
    pi.style.width = Math.ceil(w + (perRow - 1) * step + BADGE) + 'px';
    pi.style.height = (h + (rows - 1) * rowOff) + 'px';
    [...pi.querySelectorAll('.hw')].forEach((c, i) => {
      const r = Math.floor(i / perRow), k = i % perRow;
      c.style.left = (k * step).toFixed(1) + 'px';
      c.style.top = (r * rowOff) + 'px';
      c.style.zIndex = i + 1;
    });
  }

  // 바닥 패: 가운데 더미를 둘러싼 자리(링)에 달별로 겹쳐 놓기
  function layoutFloor() {
    const table = $('#table'), floor = $('#floor');
    const W = table.clientWidth, H = table.clientHeight;
    floor.innerHTML = '';
    const byMonth = {};
    floorIds().forEach(id => { (byMonth[C[id].month] = byMonth[C[id].month] || []).push(id); });
    for (const m of Object.keys(slotOf)) if (!byMonth[m]) delete slotOf[m];
    const months = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
    const need = Math.max(months.length, 8);
    // 가장 큰 패가 들어가는 격자 고르기 (가운데 칸들은 더미 자리)
    let best = null;
    for (const [cols, rows] of [[4, 4], [5, 4], [6, 3], [5, 3], [4, 5], [6, 4], [7, 3], [5, 5], [7, 4]]) {
      const ring = cols * rows - (cols - 2) * (rows - 2);
      if (ring < need) continue;
      const w = Math.min(W / cols / 1.5, H / rows / 1.75, 64);
      if (!best || w > best.w) best = { cols, rows, w };
    }
    const { cols, rows, w } = best;
    const h = w * 1.63, cw = W / cols, ch = H / rows;
    // 자리 순서: 위·아래 줄을 번갈아, 가운데 열부터 바깥쪽으로 → 그다음 왼쪽·오른쪽 옆 칸
    const cells = [];
    const colOrder = [...Array(cols).keys()].sort((a, b) => Math.abs(a - (cols - 1) / 2) - Math.abs(b - (cols - 1) / 2) || a - b);
    for (const c of colOrder) { cells.push([c, 0]); cells.push([c, rows - 1]); }
    for (let r = 1; r < rows - 1; r++) { cells.push([0, r]); cells.push([cols - 1, r]); }
    for (const m of Object.keys(slotOf)) if (slotOf[m] >= cells.length) delete slotOf[m];
    const used = new Set(Object.values(slotOf));
    months.forEach(m => {
      if (slotOf[m] !== undefined) return;
      let i = 0;
      while (used.has(i)) i++;
      slotOf[m] = i;
      used.add(i);
    });
    // 가운데 더미: 가운데 빈 칸 안에 들어가는 크기로
    const innerW = (cols - 2) * cw, innerH = (rows - 2) * ch;
    const dw = Math.max(18, Math.min(w, innerW * 0.8, innerH * 0.85 / 1.63));
    $('#deck').querySelector('.hw').style.setProperty('--w', Math.round(dw) + 'px');
    for (const m of months) {
      const ids = byMonth[m];
      const [c, r] = cells[slotOf[m]];
      const cx = (c + 0.5) * cw, cy = (r + 0.5) * ch;
      const picking = pickOptions && ids.some(id => pickOptions.includes(id));
      const step = picking ? w * 1.08 : w * 0.42; // 겹친 패도 그림이 조금 보이게
      const total = w + step * (ids.length - 1);
      const x0 = Math.max(0, Math.min(W - total, cx - total / 2));
      ids.forEach((id, i) => {
        const el = cardEl(id, Math.round(w));
        el.classList.add('fcard');
        el.style.left = (x0 + i * step).toFixed(1) + 'px';
        el.style.top = (cy - h / 2).toFixed(1) + 'px';
        el.style.zIndex = picking ? 20 + i : 2 + i;
        if (pickOptions && pickOptions.includes(id)) el.classList.add('pick');
        el.addEventListener('click', () => onFloorTap(id));
        floor.appendChild(el);
      });
      if (S.ppeok[m] !== undefined) {
        const mk = document.createElement('span');
        mk.className = 'ppeok-mark';
        mk.textContent = '뻑';
        mk.style.left = (x0 + total - 12).toFixed(1) + 'px';
        mk.style.top = (cy - h / 2 - 8).toFixed(1) + 'px';
        floor.appendChild(mk);
      }
    }
  }

  function render() {
    if (!S) return;
    // 상대 손패 (뒷면)
    const ob = $('#opp-hand');
    ob.innerHTML = '';
    for (let i = 0; i < S.hands[1].length; i++) ob.appendChild(backEl());
    const oc = document.createElement('span');
    oc.textContent = `${S.hands[1].length}장` + (S.dummies[1] ? ` +폭탄패 ${S.dummies[1]}` : '');
    ob.appendChild(oc);
    const deckN = S.deck.length - view.deckHide;
    $('#deck-count').textContent = `${deckN}장`;
    $('#deck').style.visibility = deckN > 0 ? 'visible' : 'hidden';
    $('#opp-badges').innerHTML = badgesHTML(1);
    $('#my-badges').innerHTML = badgesHTML(0);
    $('#opp-pts').textContent = `${R.bestScore(S.captured[1]).total}점`;
    $('#my-pts').textContent = `${R.bestScore(S.captured[0]).total}점`;
    $('#opp-side').classList.toggle('turn', S.turn === 1 && S.phase !== 'over');
    $('#me-side').classList.toggle('turn', S.turn === 0 && S.phase !== 'over');
    const mult = $('#round-mult');
    mult.classList.toggle('hidden', (S.mult || 1) <= 1);
    mult.textContent = `판 ×${S.mult}`;

    renderPiles($('#opp-piles'), S.captured[1].concat(view.capAdd[1]));
    renderPiles($('#my-piles'), S.captured[0].concat(view.capAdd[0]));
    renderHand();
    layoutFloor(); // 손패 높이가 정해진 뒤에 바닥 크기를 잰다
  }

  function renderHand() {
    // 내 손패: 월 순서, 바닥에 짝이 있으면 표시, 같은 달 3장이면 표시
    const hand = $('#hand');
    hand.innerHTML = '';
    const myTurn = S.turn === 0 && S.phase === 'play' && !busy;
    hand.classList.toggle('wait', !myTurn);
    const mine = S.hands[0].slice().sort((a, b) => (C[a].month || 13) - (C[b].month || 13) || a - b);
    mine.forEach(id => {
      const el = cardEl(id);
      const m = C[id].month;
      if (myTurn && (C[id].bonus || S.floor.some(f => C[f].month === m))) el.classList.add('match');
      if (m && S.hands[0].filter(x => C[x].month === m).length === 3) el.classList.add('three');
      if (selected === id) el.classList.add('sel');
      el.addEventListener('click', () => onHandTap(id));
      hand.appendChild(el);
    });
    for (let i = 0; i < S.dummies[0]; i++) {
      const d = document.createElement('div');
      d.className = 'hw dummy';
      d.innerHTML = '<b>💣</b>폭탄패<br>뒤집기';
      d.setAttribute('aria-label', '폭탄패: 손패를 내지 않고 뒤집기만');
      d.addEventListener('click', onDummyTap);
      hand.appendChild(d);
    }
    sizeHand();
  }

  // 손패는 항상 2줄: 10장이 넘으면 칸을 늘리고 패를 조금 작게
  function sizeHand() {
    const hand = $('#hand');
    const n = hand.children.length;
    const cols = Math.max(5, Math.ceil(n / 2));
    const maxW = innerHeight > 700 ? 66 : innerHeight > 600 ? 54 : 46;
    const w = Math.floor(Math.min(maxW, (hand.clientWidth - 16 - 6 * (cols - 1)) / cols));
    hand.style.gridTemplateColumns = `repeat(${cols}, ${w}px)`;
    hand.style.setProperty('--hand-w', w + 'px');
  }

  const hideFlip = () => $('#flip-show').classList.add('hidden');

  // '컴퓨터 싹쓸이!' → 작은 '컴퓨터' + 큰 '싹쓸이!' (좁은 화면에서도 한 줄에 들어가게)
  function whoSplit(el, text) {
    const m = /^컴퓨터 (.+)$/.exec(text);
    if (!m) { el.append(text); return; }
    const w = document.createElement('span');
    w.className = 'who-tag';
    w.textContent = '컴퓨터';
    el.append(w, m[1]);
  }

  async function flash(text, small, ms, kind) {
    const el = $('#event');
    el.className = kind ? 'stamp ev-' + kind : '';
    el.innerHTML = '';
    const box = kind ? document.createElement('div') : el; // 도장: 빛살(뒤) + 배지(앞)
    if (kind) { box.className = 'stamp-box'; el.appendChild(box); }
    whoSplit(box, text);
    if (small) {
      const s = document.createElement('small');
      s.textContent = small;
      box.appendChild(s);
    }
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    el.style.animationDuration = (ms || 1000) + 'ms'; // 보이는 시간만큼 튀어나왔다 사라짐
    await sleep(ms || 1000);
    el.classList.add('hidden');
  }

  // 판 전체가 '쿵' 하고 흔들림 (폭탄·따닥·싹쓸이)
  function shakeBoard(strong) {
    const el = $('#game');
    if (!el.animate) return;
    const a = strong ? 7 : 4;
    el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${-a}px,${a / 2}px)` }, { transform: `translate(${a}px,${-a / 2}px)` },
      { transform: `translate(${-a / 2}px,0)` }, { transform: 'translate(0,0)' }], { duration: strong ? 320 : 220, easing: 'ease-out' });
  }
  // 가운데에 패 여러 장을 크게 펼쳐 보여 주기 (흔들기·족보 완성·비상)
  // opt = { title, sub, kind, ms, wobble(흔들림), focus(강조할 패 id), dim(흐리게 할 패 id 목록) }
  async function showcase(ids, opt) {
    const box = document.createElement('div');
    box.className = 'showcase sc-' + opt.kind;
    const row = document.createElement('div');
    row.className = 'sc-cards';
    ids.forEach((id, i) => {
      const c = cardEl(id);
      c.classList.remove('ghost');
      c.style.animationDelay = (i * 70) + 'ms';
      if (opt.wobble) c.classList.add('wobble');
      if (opt.focus === id) c.classList.add('focus');
      row.appendChild(c);
    });
    const t = document.createElement('div');
    t.className = 'sc-title';
    whoSplit(t, opt.title);
    box.append(row, t);
    if (opt.sub) {
      const sm = document.createElement('div');
      sm.className = 'sc-sub';
      sm.textContent = opt.sub;
      box.appendChild(sm);
    }
    document.body.appendChild(box);
    await sleep(opt.ms || 1100);
    box.classList.add('out');
    await sleep(160);
    box.remove();
  }
  // 먹은 패 더미 근처에 잠깐 떠오르는 글자 (피 뺏기)
  function floatText(rect, text) {
    if (!rect) return;
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.left = (rect.left + rect.width / 2) + 'px';
    el.style.top = rect.top + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  // 바닥에서 한 장 고르기 (후보를 펼쳐 반짝이게 하고 누를 때까지 기다림)
  function pickFloor(options, msg) {
    pickOptions = options;
    setMsg(msg);
    render();
    return new Promise(res => { pickResolve = res; });
  }
  function endPick(value) {
    const r = pickResolve;
    pickResolve = null;
    pickOptions = null;
    if (r) r(value);
  }

  // 버튼 여러 개 중 하나 고르는 창
  function ask(opts) {
    return new Promise(res => {
      showModal(Object.assign({}, opts, {
        buttons: opts.buttons.map(b => Object.assign({}, b, { onClick: () => res(b.value) })),
      }));
      if (opts.onShow) opts.onShow(res);
    });
  }

  // ---------------- 진행 ----------------
  function proceed() {
    if (!S) return;
    if (S.phase === 'over') { busy = true; render(); showResult(); return; }
    if (S.phase === 'gostop') { handleGoStop(); return; }
    if (S.turn === 1) { aiTurn(); return; }
    busy = false;
    setMsg(S.dummies[0] ? '낼 패나 폭탄패를 골라 주세요' : '낼 패를 골라 주세요');
    render();
  }

  let pickSeq = 0;
  async function onHandTap(id) {
    if (!S || S.turn !== 0 || S.phase !== 'play') return;
    if (pickResolve && selected !== null) { // 바닥 패를 고르던 중: 같은 패면 취소만, 다른 패면 그 패로 바꿈
      const same = selected === id;
      pickSeq++;
      selected = null;
      endPick(null);
      if (same) { proceed(); return; }
    }
    if (busy) return;
    sfx.unlock();

    if (R.isBonus(id)) { // 보너스패: 바로 먹고 한 장 더
      busy = true;
      await doBonus(id);
      return;
    }

    const opt = {};
    const seq = ++pickSeq;
    const three = S.hands[0].filter(x => C[x].month === C[id].month);
    if (R.canBomb(S, id)) {
      busy = true;
      const v = await ask({
        emoji: '💣', title: '폭탄 할까요?',
        html: '같은 달 3장을 한꺼번에 내서 바닥 패까지 <b>4장</b>을 가져와요.<br>상대 피 1장을 뺏고, 이기면 점수 <b>2배</b>!<div class="show"></div>',
        node: showCards(three), row: true,
        buttons: [{ label: '폭탄!', cls: 'red', value: 'bomb' }, { label: '한 장만', cls: 'light', value: 'one' }],
      });
      busy = false;
      if (seq !== pickSeq || !S) return;
      opt.bomb = v === 'bomb';
    } else if (R.canShake(S, id)) {
      busy = true;
      const v = await ask({
        emoji: '🤚', title: '흔들까요?',
        html: '같은 달 패가 3장 있어요. 흔들면 상대에게 보여 주고,<br>이기면 점수가 <b>2배</b>가 돼요.<div class="show"></div>',
        node: showCards(three), row: true,
        buttons: [{ label: '흔들기', cls: 'red', value: true }, { label: '그냥 내기', cls: 'light', value: false }],
      });
      busy = false;
      if (seq !== pickSeq || !S) return;
      opt.shake = v;
    }
    if (!opt.bomb) {
      const opts = R.handOptions(S, id);
      if (opts) {
        selected = id;
        const choice = await pickFloor(opts, '가져올 바닥 패를 눌러 주세요');
        if (seq !== pickSeq) return; // 다른 패를 눌러 취소됨
        selected = null;
        if (choice === null) return;
        opt.choice = choice;
      }
    }
    busy = true;
    await doPlay(id, opt);
  }

  function onDummyTap() {
    if (!S || busy || S.turn !== 0 || S.phase !== 'play' || !S.dummies[0]) return;
    sfx.unlock();
    if (pickResolve) { pickSeq++; selected = null; endPick(null); }
    busy = true;
    doPlay(null, { dummy: true });
  }

  function onFloorTap(id) {
    if (pickResolve && pickOptions && pickOptions.includes(id)) endPick(id);
  }

  // ---------------- 카드 이동 연출 (신맞고처럼 짧고 경쾌하게) ----------------
  // 속도(ms): 패 내기 180 · 뒤집기 330 · 먹기 한 장 210(간격 65) · 피 뺏기 280
  const T = { play: 180, bombGap: 95, flip: 330, take: 210, takeGap: 65, steal: 280, after: 110 };
  const FX = window.GSFx;
  const floorEl = id => document.querySelector(`#floor .hw[data-id="${id}"]`);
  const pileEl = (p, id) => document.querySelector(`${p === 0 ? '#my-piles' : '#opp-piles'} .hw[data-id="${id}"]`);
  const handEl = id => document.querySelector(`#hand .hw[data-id="${id}"]`);
  const deckRect = () => FX.rectOf($('#deck .hw'));
  // 상대 손패(뒷면) 중 뒤에서 n 장의 위치
  function oppBackRects(n) {
    const backs = [...document.querySelectorAll('#opp-hand .hw.back')];
    const out = [];
    for (let i = 0; i < n; i++) out.push(FX.rectOf(backs[Math.max(0, backs.length - 1 - i)]) || deckRect());
    return out;
  }
  // 먹은 패 더미의 끝 (아직 그려지지 않은 패가 날아갈 곳)
  function pileRect(p) {
    const box = $(p === 0 ? '#my-piles' : '#opp-piles');
    const cards = box.querySelectorAll('.g-pi .hw');
    return FX.rectOf(cards[cards.length - 1]) || FX.rectOf(box);
  }
  // 숨겨 둔 진짜 카드를 보이게 하고 착지 느낌
  function reveal(id, strong) {
    hidden.delete(id);
    document.querySelectorAll(`.hw[data-id="${id}"].ghost`).forEach(el => { el.classList.remove('ghost'); FX.land(el, strong); });
  }
  // 한 장 날리기 → 도착하면 진짜 카드를 보이고 소리
  async function flyCard(id, from, to, opt, onLand) {
    const el = await FX.fly(Object.assign({ front: ART.url(id), back: ART.back(), from, to }, opt));
    reveal(id, opt && opt.strong);
    FX.remove(el);
    if (onLand) onLand();
  }
  const same = (a, b) => a !== b && C[a].month && C[a].month === C[b].month;

  // 1) 손에서 바닥으로 패 내기. ids: 이번에 낸 패 (폭탄이면 3장), from: 출발 위치들
  async function animPlay(p, ids, from, hadMatch) {
    const jobs = ids.map((id, i) => (async () => {
      await sleep(i * T.bombGap); // 폭탄은 '타-타-탁' 한 장씩
      const to = FX.rectOf(floorEl(id));
      await flyCard(id, from[i], to, { dur: T.play, flip: p === 1, strong: hadMatch },
        () => {
          sfx.slap();
          if (hadMatch) floorIds().filter(f => same(f, id) && !ids.includes(f)).forEach(f => FX.bump(floorEl(f)));
        });
    })());
    await Promise.all(jobs);
  }

  // 2) 더미에서 뒤집기: 더미 위 보너스패는 먹는 쪽으로, 그다음 패는 바닥 자리로
  //    돌려주는 값: 뒤집은 패 id, 더미가 비었으면 null, 판이 바뀌었으면 undefined
  async function animFlip(p, game) {
    const bonusTop = R.peekBonus(S);
    const d = R.peek(S);
    for (const b of bonusTop) {
      const from = deckRect();
      view.deckHide++;
      view.capAdd[p].push(b);
      hidden.add(b);
      render();
      await flyCard(b, from, FX.rectOf(pileEl(p, b)) || pileRect(p), { dur: T.flip + 60, flip: true, pop: 0.4 }, () => sfx.slap());
      if (S !== game) return undefined;
      sfx.points();
      await flash(p === 0 ? '보너스 패!' : '컴퓨터 보너스 패!', '한 장 더 뒤집어요', 650, 'points');
      if (S !== game) return undefined;
    }
    if (d === null) return null;
    const from = deckRect();
    const hit = floorIds().some(f => same(f, d));
    view.deckHide++;
    view.floorAdd = [d];
    hidden.add(d);
    render();
    await flyCard(d, from, FX.rectOf(floorEl(d)), { dur: T.flip, flip: true, pop: 0.42, strong: hit },
      () => { sfx.slap(); if (hit) floorIds().filter(f => same(f, d)).forEach(f => FX.bump(floorEl(f))); });
    return S === game ? d : undefined;
  }

  // 3) 먹기: 짝끼리 차례로 먹은 패 더미로
  // before: 규칙을 적용하기 전(지금 화면)의 카드 위치들
  async function animCollect(p, res, before) {
    const jobs = res.taken.map((id, i) => (async () => {
      await sleep(i * T.takeGap);
      await flyCard(id, before[id], FX.rectOf(pileEl(p, id)), { dur: T.take, arc: 14 },
        i === 0 ? () => sfx.slap(true) : null); // 짝이 맞아 가져갈 때 첫 장이 닿으며 '딱' 한 번
    })());
    await Promise.all(jobs);
  }
  // 4) 상대 피 뺏기: 상대 더미에서 한 장씩 끌어옴
  async function animSteal(p, res, before) {
    for (const id of res.stolen) {
      sfx.steal();
      const to = FX.rectOf(pileEl(p, id));
      floatText(to, p === 0 ? `피 +${C[id].pi}` : `피 -${C[id].pi}`);
      await flyCard(id, before[id], to, { dur: T.steal, arc: 30 });
      await sleep(60);
    }
  }
  // 지금 화면에 보이는 카드들의 위치 (바닥 + 양쪽 먹은 패)
  function snapshotRects() {
    const out = {};
    document.querySelectorAll('#floor .hw[data-id], #my-piles .hw[data-id], #opp-piles .hw[data-id]').forEach(el => {
      const r = FX.rectOf(el);
      if (r) out[el.dataset.id] = r;
    });
    return out;
  }

  // 보너스패: 손에서 내면 먹고, 더미에서 한 장 받아 같은 차례 계속
  async function doBonus(id) {
    const game = S, p = S.turn;
    const from = p === 0 ? FX.rectOf(handEl(id)) : oppBackRects(1)[0];
    const r = R.play(S, id);
    hidden.add(id);
    if (r.drawn !== null) hidden.add(r.drawn);
    render();
    await flyCard(id, from, FX.rectOf(pileEl(p, id)), { dur: T.play + 60, flip: p === 1, arc: 20 }, () => sfx.slap());
    if (S !== game) return;
    if (r.drawn !== null) { // 더미에서 한 장 받아 손으로
      const to = p === 0 ? FX.rectOf(handEl(r.drawn)) : oppBackRects(1)[0];
      sfx.draw();
      const el = await FX.fly({ front: p === 0 ? ART.url(r.drawn) : ART.back(), back: ART.back(), from: deckRect(), to, dur: 240, flip: p === 0 });
      reveal(r.drawn);
      FX.remove(el);
    }
    if (S !== game) return;
    sfx.points();
    await flash(p === 0 ? '보너스!' : '컴퓨터 보너스!', r.stolen.length ? (p === 0 ? '상대 피 1장 · 한 장 더' : '피 1장 뺏겼어요') : '한 장 더', 700, 'points');
    if (S !== game) return;
    saveGame();
    if (p === 1) { aiTurn(); return; }
    busy = false;
    setMsg('한 장 더 내 주세요');
    render();
  }

  async function doPlay(id, opt) {
    const game = S;
    const p = S.turn;
    const capBefore = S.captured[p].slice(); // 족보 완성 알림용
    if (opt.dummy) {
      R.playDummy(S);
      setMsg(p === 0 ? '폭탄패: 뒤집기만 해요' : '컴퓨터 폭탄패: 뒤집기만');
      render();
    } else {
      // 낼 패들의 출발 위치 (내 손패 / 상대 손패 뒷면)
      const bombCards = opt.bomb && R.canBomb(S, id) ? S.hands[p].filter(x => C[x].month === C[id].month) : [id];
      const from = p === 0 ? bombCards.map(x => FX.rectOf(handEl(x))) : oppBackRects(bombCards.length);
      const hadMatch = S.floor.some(f => same(f, id));
      const res = R.play(S, id, opt);
      const ids = res.bomb ? S.pending.cards.slice() : [id];
      if (opt.shake && S.shake[p] && !res.bomb) {
        render();
        sfx.rattle();
        await showcase([id, ...S.hands[p].filter(x => same(x, id))],
          { title: p === 0 ? '흔들기!' : '컴퓨터 흔들기!', sub: '이기면 점수 2배', kind: 'shake', wobble: true, ms: 900 });
        if (S !== game) return;
      }
      setMsg(p === 0 ? '' : '컴퓨터가 패를 냈어요');
      ids.forEach(x => hidden.add(x));
      render();
      await animPlay(p, ids, from, hadMatch);
      if (S !== game) return;
      if (res.bomb) { // '타-타-탁' 다음 '쾅!'
        sfx.boom();
        shakeBoard(true);
        await flash(p === 0 ? '폭탄!' : '컴퓨터 폭탄!', '이기면 점수 2배', 750, 'bomb');
        if (S !== game) return;
      }
      await sleep(70);
    }

    // 더미에서 뒤집기 (위에 보너스패가 있으면 먼저 나옴)
    const d = await animFlip(p, game);
    if (S !== game || d === undefined) return;
    let fc = null;
    if (d !== null) {
      const fo = R.flipOptions(S);
      if (fo) {
        if (p === 0) fc = await pickFloor(fo, '뒤집은 패로 가져올 패를 골라 주세요');
        else { await sleep(250); fc = R.bestCard(fo); }
        if (S !== game) return;
      }
    }
    await sleep(90);
    if (S !== game) return;

    // 규칙 적용 → (쪽·뻑·따닥 등 알림) → 먹기 → 피 뺏기
    const before = snapshotRects();
    const res = R.flip(S, fc);
    await showEvents(res);
    if (S !== game) return;
    resetView();
    res.taken.concat(res.stolen).forEach(x => hidden.add(x));
    render();
    await animCollect(p, res, before);
    if (S !== game) return;
    if (res.stolen.length) {
      await sleep(80);
      await animSteal(p, res, before);
      if (S !== game) return;
    }
    hidden.clear();
    await showYaku(p, capBefore, game);
    if (S !== game) return;
    await showAlerts(game);
    if (S !== game) return;
    R.endTurn(S);
    saveGame();
    render();
    await sleep(T.after);
    if (S === game) proceed();
  }

  // 족보 완성: 모은 패를 가운데 크게 + 빰빠밤
  async function showYaku(p, capBefore, game) {
    for (const y of R.newYaku(capBefore, S.captured[p])) {
      (y.key === 'godori' ? sfx.godori : sfx.yaku)();
      if (y.key !== 'godori' && !y.key.startsWith('gwang')) shakeBoard(false);
      await showcase(y.ids, { title: (p === 0 ? '' : '컴퓨터 ') + y.name + '!', sub: `+${y.pts}점`, kind: 'yaku', ms: 1200 });
      if (S !== game) return;
    }
  }
  // 비상: 족보까지 1장 남았을 때 (나·컴퓨터 모두, 족보마다 한 판에 한 번)
  async function showAlerts(game) {
    S.alerted = S.alerted || {};
    for (const q of [S.turn, 1 - S.turn]) {
      for (const a of R.yakuAlerts(S.captured[q], S.captured[1 - q])) {
        const key = q + ':' + a.key;
        if (S.alerted[key]) continue;
        S.alerted[key] = 1;
        sfx.siren();
        await showcase([...a.have, a.missing], {
          title: (q === 0 ? '' : '컴퓨터 ') + a.name + ' 비상!',
          sub: q === 0 ? `이 패만 더 먹으면 +${a.pts}점!` : '이 패를 먼저 가져오세요!',
          kind: 'alert', focus: a.missing, ms: 1300,
        });
        if (S !== game) return;
      }
    }
  }

  // [글자, 작은 글자, 도장 모양, 소리, 판 흔들림]
  const EVENT_TEXT = {
    jjok: ['쪽!', '', 'jjok', 'jjok'], ppeok: ['뻑!', '', 'ppeok', 'ppeok'],
    ttadak: ['따닥!', '', 'ttadak', 'ttadak', 1], sseul: ['싹쓸이!', '', 'sseul', 'sseul', 2],
    ppeokTake: ['뻑 먹기!', '', 'grab', 'grab'], jappeok: ['자뻑!', '', 'grab', 'grab'],
    firstPpeok: ['첫뻑!', '+7점', 'points', 'points'], yeonPpeok: ['연뻑!', '+14점', 'points', 'points'],
    samyeonPpeok: ['삼연뻑!', '바로 이겨요', 'points', 'points', 2], firstTtadak: ['첫따닥!', '+7점', 'points', 'points'],
  };
  // 쪽·뻑·따닥 등: 패가 바닥에 놓인 채로 알림 (먹는 연출은 그다음)
  async function showEvents(res) {
    const mine = res.player === 0;
    const stolenMsg = res.stolen.length ? (mine ? `상대 피 ${res.stolen.length}장 가져옴` : `피 ${res.stolen.length}장 뺏겼어요`) : '';
    const evs = res.events.filter(e => EVENT_TEXT[e]);
    if (!evs.length) return;
    for (let i = 0; i < evs.length; i++) {
      const [t, sub, kind, sound, shake] = EVENT_TEXT[evs[i]];
      const last = i === evs.length - 1;
      sfx[sound]();
      if (shake) shakeBoard(shake > 1);
      await flash((mine ? '' : '컴퓨터 ') + t, [sub, last ? stolenMsg : ''].filter(Boolean).join(' · '), 750, kind);
    }
  }

  async function aiTurn() {
    busy = true;
    const game = S;
    setMsg('컴퓨터 차례예요…');
    render();
    await sleep(450);
    if (S !== game) return;
    const a = R.aiPick(S);
    if (a.dummy) return doPlay(null, { dummy: true });
    if (R.isBonus(a.card)) return doBonus(a.card);
    await doPlay(a.card, a);
  }

  async function handleGoStop() {
    busy = true;
    const game = S;
    const p = S.turn;
    const sc = R.bestScore(S.captured[p]).total;
    render();
    let go;
    if (p === 0) {
      sfx.yaku();
      for (;;) {
        const next = S.go[0] + 1;
        const v = await ask({
          emoji: '🎴', title: `${sc}점 났어요!`,
          html: (S.go[0] ? `지금 <b>${S.go[0]}고</b> 중이에요.<br>` : '') +
            `<b>고</b>: 계속해서 점수를 더 내요 (${next}고 → +${next}점${next >= 3 ? ', 점수 ' + 2 ** (next - 2) + '배' : ''}).<br>` +
            '대신 컴퓨터가 먼저 나면 2배로 잃어요(고박).<br><b>스톱</b>: 여기서 끝내고 점수를 받아요.' +
            '<div class="look-row"><button type="button" class="look-btn">👀 판 보기</button></div>',
          row: true,
          buttons: [{ label: `${next}고!`, value: true }, { label: '스톱', cls: 'stop', value: false }],
          onShow: (resolve) => { overlay.querySelector('.look-btn').onclick = () => { hideModal(); resolve('look'); }; },
        });
        if (S !== game) return;
        if (v !== 'look') { go = v; break; }
        await lookBoard(); // 판을 보다가 '고/스톱 고르기'를 누르면 다시 창
        if (S !== game) return;
      }
    } else {
      await sleep(400);
      go = R.aiGoStop(S);
    }
    if (S !== game) return;
    R.decide(S, go);
    if (go) {
      sfx.go();
      await flash(p === 0 ? `${S.go[0]}고!` : `컴퓨터 ${S.go[1]}고!`, p === 0 ? '계속합니다' : '조심하세요!', 850, 'go');
    } else {
      sfx.stop();
      await flash(p === 0 ? '스톱!' : '컴퓨터 스톱!', '', 850, 'stop');
    }
    saveGame();
    if (S === game) proceed();
  }

  // 고/스톱 중 '판 보기': 창을 잠시 내리고 아래 버튼으로 다시 열기 (먹은 패 누르면 자세히 보기 가능)
  function lookBoard() {
    return new Promise(res => {
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'look-bar btn';
      bar.textContent = '고 / 스톱 고르기 ▲';
      bar.onclick = () => { bar.remove(); res(); };
      document.body.appendChild(bar);
    });
  }

  function showResult() {
    recordResult();
    saveGame();
    const o = S.over;
    const bp = o.bonusPts || [0, 0];
    const bonusRows = (bp[0] ? `<tr class="sub"><td>내 보너스(첫뻑 등)</td><td>+${bp[0]}점</td></tr>` : '') +
      (bp[1] ? `<tr class="sub"><td>컴퓨터 보너스(첫뻑 등)</td><td>-${bp[1]}점</td></tr>` : '');
    const netRow = bonusRows ? `<tr class="total"><td>정산</td><td>${o.net >= 0 ? '+' : ''}${o.net}점</td></tr>` : '';
    let emoji, title, html;
    if (o.draw) {
      emoji = '🤝'; title = '나가리';
      html = `${o.reason}<br>다음 판은 점수 <b>${save.nextMult}배</b>!` + (bonusRows ? `<table>${bonusRows}${netRow}</table>` : '');
      sfx.lose();
    } else {
      const win = o.winner === 0;
      emoji = win ? '🎉' : '😢';
      title = (win ? '이겼어요!' : '졌어요…') + (o.reason ? ` (${o.reason})` : '');
      html = '<table>' + o.lines.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') +
        `<tr class="total"><td>${win ? '딴 점수' : '잃은 점수'}</td><td>${o.points}점</td></tr>` + bonusRows + netRow + '</table>';
      (win ? sfx.win : sfx.lose)();
    }
    showModal({
      emoji, title, html,
      buttons: [
        { label: '한 판 더', onClick: startNew },
        { label: '고스톱 메뉴로', cls: 'light', onClick: goHome },
      ],
    });
  }

  // 먹은 패 자세히 보기
  function showCaptured(p) {
    if (!S) return;
    const ids = S.captured[p];
    const s = R.bestScore(ids);
    const groups = [['광', 'gwang', s.gwangScore], ['열끗', 'yeol', s.yeolScore + s.godori], ['띠', 'tti', s.ttiScore + s.hong + s.cheong + s.cho], ['피', 'pi', s.piScore]];
    const box = document.createElement('div');
    for (const [name, kind, pts] of groups) {
      const g = document.createElement('div');
      g.className = 'cap-group';
      const list = ids.filter(id => (C[id].gukjin && s.gukjinAsPi ? 'pi' : C[id].kind) === kind).sort((a, b) => a - b);
      const cnt = kind === 'pi' ? s.piCount : kind === 'yeol' ? s.yeolCount : list.length;
      g.innerHTML = `<b>${name} ${cnt}장${pts ? ` → ${pts}점` : ''}</b>`;
      const cards = document.createElement('div');
      cards.className = 'cards';
      if (!list.length) cards.textContent = '없음';
      list.forEach(id => cards.appendChild(cardEl(id)));
      g.appendChild(cards);
      box.appendChild(g);
    }
    if (ids.includes(R.GUKJIN)) {
      const n = document.createElement('p');
      n.textContent = `9월 국진은 ${s.gukjinAsPi ? '쌍피' : '열끗'}로 계산했어요 (점수가 더 높은 쪽).`;
      n.style.fontSize = '15px';
      box.appendChild(n);
    }
    showModal({
      title: `${p === 0 ? '내가' : '컴퓨터가'} 먹은 패 (${s.total}점)`, node: box,
      buttons: [{ label: '닫기', cls: 'light', onClick: () => { } }],
    });
  }

  // ---------------- 창 / 알림 ----------------
  function showModal({ emoji, title, html, node, buttons, row }) {
    overlay.querySelector('.modal-emoji').textContent = emoji || '';
    overlay.querySelector('.modal-title').textContent = title;
    const body = overlay.querySelector('.modal-body');
    body.innerHTML = html || '';
    if (node) {
      const slot = body.querySelector('.show');
      if (slot) slot.replaceWith(node); else body.appendChild(node);
    }
    const box = overlay.querySelector('.modal-btns');
    box.className = 'modal-btns' + (row ? ' row' : '');
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
  const hideModal = () => overlay.classList.add('hidden');

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  // ---------------- 화면 전환 / 뒤로 가기 ----------------
  function showScreen(el) {
    [homeEl, gameEl].forEach(s => s.classList.toggle('hidden', s !== el));
    if (el !== homeEl && !(history.state && history.state.gs)) {
      try { history.pushState({ gs: 1 }, ''); } catch (e) { /* 무시 */ }
    }
  }

  function showHome() {
    hideModal();
    showScreen(homeEl);
    $('#btn-continue').classList.toggle('hidden', !save.current);
    $('#btn-new').className = save.current ? 'btn light' : 'btn big'; // 하던 판이 없으면 '새 판 시작'이 주 버튼
    const st = save.stats, games = st.wins + st.losses + st.draws;
    $('#record').textContent = games
      ? `${st.wins}승 ${st.losses}패${st.draws ? ` ${st.draws}무` : ''} · 누적 ${st.points >= 0 ? '+' : ''}${st.points}점`
      : '';
    updateSoundButtons();
  }

  let skipPop = false;
  function leaveGame() {
    if (pickResolve) endPick(null);
    if (S && S.phase !== 'over' && !busy) saveGame();
    S = null;
    busy = false;
    selected = null;
    hideFlip();
    FX.clear();
    hidden.clear();
    resetView();
    document.querySelectorAll('.showcase, .float-text, .look-bar').forEach(el => el.remove());
    $('#event').classList.add('hidden');
  }
  function goHome() {
    leaveGame();
    showHome();
    if (history.state && history.state.gs) { skipPop = true; history.back(); }
  }

  window.addEventListener('popstate', () => {
    if (skipPop) { skipPop = false; return; }
    if (busy && S && S.phase !== 'over') { // 패를 주고받는 중에는 무시
      try { history.pushState({ gs: 1 }, ''); } catch (e) { /* 무시 */ }
      return;
    }
    leaveGame();
    showHome();
  });
  window.addEventListener('resize', () => { if (S) render(); });

  async function startNew() {
    hideModal();
    S = R.newRound(Math.random, save.nextFirst || 0, save.nextMult || 1);
    slotOf = {};
    busy = true;
    showScreen(gameEl);
    setMsg('');
    render();
    if (S.phase === 'over') { // 총통 또는 바닥 총통
      const game = S;
      if (S.over.draw) await flash('나가리!', S.over.reason, 1400);
      else {
        const w = S.over.winner;
        const m = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find(mm => S.hands[w].filter(x => C[x].month === mm).length === 4);
        showModalCards(`${w === 0 ? '내' : '컴퓨터'} 총통! (${m}월 4장)`, S.hands[w].filter(x => C[x].month === m));
        await sleep(1800);
        hideModal();
      }
      if (S === game) proceed();
      return;
    }
    saveGame();
    busy = false;
    if ((S.mult || 1) > 1) toast(`나가리 다음 판! 점수 ×${S.mult}`);
    else if (S.turn === 1) toast('컴퓨터가 먼저 시작해요 (선)');
    proceed();
  }

  function resume() {
    if (!save.current) return startNew();
    S = R.upgradeState(JSON.parse(JSON.stringify(save.current)));
    S.pending = null; // 차례 도중 저장은 없지만 혹시 모를 경우 대비
    slotOf = {};
    busy = false;
    showScreen(gameEl);
    render();
    proceed();
  }

  function updateSoundButtons() {
    $('#btn-sound').textContent = save.sound ? '🔊' : '🔇';
    $('#btn-sound-home').textContent = save.sound ? '🔊 소리 켜짐' : '🔇 소리 꺼짐';
  }
  function toggleSound() {
    save.sound = !save.sound;
    persist();
    updateSoundButtons();
    sfx.slap();
  }

  function showRules() {
    showModal({
      emoji: '📖', title: '맞고 규칙',
      html: `<ul class="rules">
        <li>손패 10장, 바닥 8장. 같은 <b>달</b> 패끼리 짝을 맞춰 가져와요.</li>
        <li>내 패 1장을 내고 더미에서 1장을 뒤집어요.</li>
        <li><b>7점</b>이 나면 <b>고</b>(계속) 또는 <b>스톱</b>. 고 할 때마다 +1점, 3고부터는 고마다 점수 2배.</li>
        <li>광 3장 3점(비광 끼면 2점)·4장 4점·5장 15점 / 열끗·띠 5장부터 1점 / 피 10장부터 1점</li>
        <li>고도리 5점 · 홍단·청단·초단 3점 · 9월 국진은 열끗이나 쌍피 중 유리한 쪽</li>
        <li>보너스패는 내면 먹고 한 장 더 받아요.</li>
        <li>쪽·따닥·싹쓸이·뻑 먹기·폭탄: 상대 피 1장 (자뻑 2장)</li>
        <li><b>흔들기</b>(같은 달 3장)·<b>폭탄</b>(3장+바닥 1장): 이기면 2배</li>
        <li>피박(피로 났을 때 상대 피 7장 이하)·광박·멍따(열끗 7장 이상)·고박: 각각 2배</li>
        <li>총통(같은 달 4장) 10점 · 첫뻑·첫따닥 +7점 · 연뻑 +14점 · 삼연뻑 21점으로 끝</li>
        <li>나가리가 나면 다음 판 점수 2배</li>
      </ul>`,
      buttons: [{ label: '알겠어요', onClick: () => { } }],
    });
  }

  // ---------------- 이벤트 연결 ----------------
  $('#btn-continue').addEventListener('click', () => { sfx.unlock(); resume(); });
  $('#btn-new').addEventListener('click', () => {
    sfx.unlock();
    if (!save.current) return startNew();
    showModal({
      emoji: '🎴', title: '새 판을 시작할까요?', html: '하던 판은 지워져요.',
      buttons: [{ label: '새 판 시작', onClick: startNew }, { label: '취소', cls: 'light', onClick: () => { } }],
    });
  });
  $('#btn-rules').addEventListener('click', showRules);
  $('#btn-sound-home').addEventListener('click', toggleSound);
  $('#btn-sound').addEventListener('click', toggleSound);
  $('#btn-home').addEventListener('click', () => {
    if (busy && S && S.phase !== 'over') return toast('패를 주고받는 중이에요. 잠시만요!');
    goHome();
  });
  $('#opp-side').addEventListener('click', () => { if (!pickResolve) showCaptured(1); });
  $('#me-side').addEventListener('click', () => { if (!pickResolve) showCaptured(0); });
  $('#btn-hub').addEventListener('click', () => {
    let fromHub = false;
    try { fromHub = sessionStorage.getItem('hub.opened') === '1'; } catch (e) { /* 무시 */ }
    if (fromHub && history.length > 1) history.back();
    else location.replace('../../');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && S && !busy && S.phase === 'play') saveGame();
  });

  $('#deck .hw').style.backgroundImage = ART.back(); // 가운데 더미는 뒷면
  // 첫 화면 장식 (1월 광, 8월 광, 3월 광)
  [0, 28, 8].forEach(id => $('#logo').appendChild(cardEl(id)));
  $('#app-version').textContent = `버전 ${APP_VERSION}`;
  showHome();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('../../sw.js', { scope: '../../' }).catch(() => { });
  }
})();
