(function () {
  'use strict';

  const APP_VERSION = 9; // sw.js 의 VERSION 과 같게 유지
  const SAVE_KEY = 'gostop.save.v1';
  const R = window.GS;
  const C = R.CARDS;

  const $ = sel => document.querySelector(sel);
  const homeEl = $('#home'), gameEl = $('#game'), overlay = $('#overlay');

  // ---------------- 저장 (고스톱 전용 키) ----------------
  let save = { sound: true, stats: { wins: 0, losses: 0, draws: 0, points: 0 }, current: null, nextFirst: 0 };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      save = Object.assign(save, s, { stats: Object.assign({}, save.stats, s.stats) });
    }
  } catch (e) { /* 저장소 사용 불가 - 기본값 */ }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ }
  }

  // 판이 끝났으면 기록에 한 번만 반영
  function recordResult() {
    if (!S || !S.over || S.over.recorded) return;
    const o = S.over;
    if (o.draw) save.stats.draws++;
    else if (o.winner === 0) { save.stats.wins++; save.stats.points += o.points; save.nextFirst = 0; }
    else { save.stats.losses++; save.stats.points -= o.points; save.nextFirst = 1; }
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
    // 패를 '탁' 내려놓는 소리: 짧은 잡음
    function slap() {
      if (!save.sound) return;
      const c = ensure();
      if (!c) return;
      const len = Math.floor(c.sampleRate * 0.06), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
      const src = c.createBufferSource(), g = c.createGain();
      g.gain.value = 0.5;
      src.buffer = buf;
      src.connect(g).connect(c.destination);
      src.start();
      tone(160, 0, 0.08, 'sine', 0.25);
    }
    return {
      unlock: ensure, slap,
      flip: () => tone(520, 0, 0.1, 'triangle', 0.15, 780),
      take: () => [620, 820].forEach((f, i) => tone(f, i * 0.07, 0.14, 'triangle', 0.2)),
      event: () => [660, 880, 1100].forEach((f, i) => tone(f, i * 0.07, 0.18, 'square', 0.08)),
      go: () => [523, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.2, 'triangle', 0.22)),
      win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.22)),
      lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.18, 0.3, 'sawtooth', 0.07)),
    };
  })();

  // ---------------- 패 그리기 ----------------
  const TAG = { gwang: '광', yeol: '열끗', pi: '' };
  const DAN_TAG = { hong: '홍단', cheong: '청단', cho: '초단' };
  function cardEl(id) {
    const c = C[id];
    const el = document.createElement('div');
    el.className = `hw m${c.month} k-${c.kind}` + (c.dan ? ` dan-${c.dan}` : '') + (c.pi === 2 ? ' ssang' : '');
    const tag = c.kind === 'tti' ? (DAN_TAG[c.dan] || '띠') : c.pi === 2 ? '쌍피' : TAG[c.kind];
    el.innerHTML = `<span class="hw-m">${c.month}</span><span class="hw-ic">${c.icon}</span><span class="hw-tag">${tag}</span>`;
    el.dataset.id = id;
    el.setAttribute('aria-label', `${c.month}월 ${R.MONTH_NAME[c.month]} ${tag || '피'}`);
    return el;
  }
  function backEl() {
    const el = document.createElement('div');
    el.className = 'hw back';
    return el;
  }

  // ---------------- 게임 상태 / 화면 ----------------
  let S = null;
  let busy = false;
  let pickOptions = null, pickResolve = null, selected = null;
  let fresh = new Set();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const setMsg = t => { $('#msg').textContent = t || ''; };

  function capsHTML(ids, goCount) {
    const s = R.score(ids);
    const chip = (label, on) => `<span class="cap${on ? ' on' : ''}">${label}</span>`;
    let h = chip(`광 ${s.gwangCount}`, s.gwangScore > 0) +
      chip(`열끗 ${s.yeolCount}`, s.yeolScore > 0) +
      chip(`띠 ${s.ttiCount}`, s.ttiScore > 0) +
      chip(`피 ${s.piCount}`, s.piScore > 0);
    if (s.godori) h += chip('고도리', true);
    if (s.hong) h += chip('홍단', true);
    if (s.cheong) h += chip('청단', true);
    if (s.cho) h += chip('초단', true);
    if (goCount) h += `<span class="cap go">${goCount}고</span>`;
    return h;
  }

  function render() {
    if (!S) return;
    $('#opp-hand').textContent = `패 ${S.hands[1].length}장`;
    $('#deck-count').textContent = `${S.deck.length}장`;
    $('#deck').style.visibility = S.deck.length ? 'visible' : 'hidden';
    $('#opp-caps').innerHTML = capsHTML(S.captured[1], S.go[1]);
    $('#my-caps').innerHTML = capsHTML(S.captured[0], S.go[0]);
    $('#opp-pts').textContent = `${R.score(S.captured[1]).total}점`;
    $('#my-pts').textContent = `${R.score(S.captured[0]).total}점`;
    $('#opp-row').classList.toggle('turn', S.turn === 1 && S.phase !== 'over');
    $('#me-row').classList.toggle('turn', S.turn === 0 && S.phase !== 'over');

    // 바닥: 같은 달끼리 겹쳐서
    const floor = $('#floor');
    floor.innerHTML = '';
    const byMonth = {};
    S.floor.forEach(id => { (byMonth[C[id].month] = byMonth[C[id].month] || []).push(id); });
    Object.keys(byMonth).map(Number).sort((a, b) => a - b).forEach(m => {
      const st = document.createElement('div');
      st.className = 'stack' + (S.ppeok[m] !== undefined ? ' ppeok' : '');
      if (pickOptions && byMonth[m].some(id => pickOptions.includes(id))) st.classList.add('spread');
      byMonth[m].forEach(id => {
        const el = cardEl(id);
        if (pickOptions && pickOptions.includes(id)) el.classList.add('pick');
        if (fresh.has(id)) el.classList.add('fresh');
        el.addEventListener('click', () => onFloorTap(id));
        st.appendChild(el);
      });
      floor.appendChild(st);
    });
    fresh = new Set();

    // 내 손패: 월 순서, 바닥에 짝이 있으면 표시
    const hand = $('#hand');
    hand.innerHTML = '';
    const myTurn = S.turn === 0 && S.phase === 'play' && !busy;
    hand.classList.toggle('wait', !myTurn);
    S.hands[0].slice().sort((a, b) => a - b).forEach(id => {
      const el = cardEl(id);
      if (myTurn && S.floor.some(f => C[f].month === C[id].month)) el.classList.add('match');
      if (selected === id) el.classList.add('sel');
      el.addEventListener('click', () => onHandTap(id));
      hand.appendChild(el);
    });
  }

  function showFlip(id, label) {
    const box = $('#flip-show');
    box.innerHTML = '';
    box.appendChild(cardEl(id));
    const s = document.createElement('span');
    s.textContent = label;
    box.appendChild(s);
    box.classList.remove('hidden');
  }
  const hideFlip = () => $('#flip-show').classList.add('hidden');

  async function flash(text, small) {
    const el = $('#event');
    el.innerHTML = '';
    el.append(text);
    if (small) {
      const s = document.createElement('small');
      s.textContent = small;
      el.appendChild(s);
    }
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    await sleep(950);
    el.classList.add('hidden');
  }

  // 바닥에서 한 장 고르기 (후보를 반짝이게 하고 누를 때까지 기다림)
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

  // ---------------- 진행 ----------------
  function proceed() {
    if (!S) return;
    if (S.phase === 'over') { busy = true; render(); showResult(); return; }
    if (S.phase === 'gostop') { handleGoStop(); return; }
    if (S.turn === 1) { aiTurn(); return; }
    busy = false;
    setMsg('낼 패를 골라 주세요');
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
      if (same) { setMsg('낼 패를 골라 주세요'); render(); return; }
    }
    if (busy) return;
    sfx.unlock();
    const opts = R.handOptions(S, id);
    let choice = null;
    if (opts) {
      const seq = ++pickSeq;
      selected = id;
      choice = await pickFloor(opts, '가져올 바닥 패를 눌러 주세요');
      if (seq !== pickSeq) return; // 다른 패를 눌러 취소됨
      selected = null;
      if (choice === null) return;
    }
    busy = true;
    await doPlay(id, choice);
  }

  function onFloorTap(id) {
    if (pickResolve && pickOptions && pickOptions.includes(id)) endPick(id);
  }

  async function doPlay(id, choice) {
    const game = S;
    const p = S.turn;
    R.play(S, id, choice);
    sfx.slap();
    fresh.add(id);
    setMsg(p === 0 ? '' : '컴퓨터가 패를 냈어요');
    render();
    await sleep(500);
    if (S !== game) return;

    // 더미에서 한 장 뒤집기
    const d = R.peek(S);
    showFlip(d, p === 0 ? '뒤집은 패' : '컴퓨터가 뒤집은 패');
    sfx.flip();
    await sleep(750);
    if (S !== game) return;
    let fc = null;
    const fo = R.flipOptions(S);
    if (fo) {
      if (p === 0) fc = await pickFloor(fo, '뒤집은 패로 가져올 패를 골라 주세요');
      else fc = R.bestCard(fo);
    }
    hideFlip();
    const res = R.flip(S, fc);
    if (S.floor.includes(d)) fresh.add(d);
    render();
    await showEvents(res);
    if (S !== game) return;
    R.endTurn(S);
    saveGame();
    render();
    await sleep(250);
    if (S === game) proceed();
  }

  const EVENT_TEXT = { jjok: '쪽!', ppeok: '뻑!', ttadak: '따닥!', sseul: '싹쓸이!', ppeokTake: '뻑 먹기!', jappeok: '자뻑!' };
  async function showEvents(res) {
    const mine = res.player === 0;
    const stolenMsg = res.stolen.length ? (mine ? `상대 피 ${res.stolen.length}장 가져옴` : `피 ${res.stolen.length}장 뺏겼어요`) : '';
    if (res.events.length) {
      sfx.event();
      for (let i = 0; i < res.events.length; i++) {
        const last = i === res.events.length - 1;
        await flash((mine ? '' : '컴퓨터 ') + EVENT_TEXT[res.events[i]], last ? stolenMsg : '');
      }
    } else if (res.taken.length) {
      sfx.take();
      await sleep(350);
    } else {
      await sleep(250);
    }
  }

  async function aiTurn() {
    busy = true;
    const game = S;
    setMsg('컴퓨터 차례예요…');
    render();
    await sleep(800);
    if (S !== game) return;
    const { card, choice } = R.aiPick(S);
    await doPlay(card, choice);
  }

  async function handleGoStop() {
    busy = true;
    const game = S;
    const p = S.turn;
    const sc = R.score(S.captured[p]).total;
    render();
    let go;
    if (p === 0) {
      go = await askGoStop(sc);
    } else {
      await sleep(600);
      go = R.aiGoStop(S);
    }
    if (S !== game) return;
    R.decide(S, go);
    if (go) { sfx.go(); await flash(p === 0 ? `${S.go[0]}고!` : `컴퓨터 ${S.go[1]}고!`, p === 0 ? '계속합니다' : '조심하세요!'); }
    else await flash(p === 0 ? '스톱!' : '컴퓨터 스톱!');
    saveGame();
    if (S === game) proceed();
  }

  function askGoStop(sc) {
    return new Promise(res => {
      showModal({
        emoji: '🎴', title: `${sc}점 났어요!`,
        html: '<b>고</b>: 계속해서 점수를 더 내요 (+점수)<br>대신 컴퓨터가 먼저 나면 2배로 잃어요.<br><b>스톱</b>: 여기서 끝내고 점수를 받아요.',
        row: true,
        buttons: [
          { label: '고!', onClick: () => res(true) },
          { label: '스톱', cls: 'stop', onClick: () => res(false) },
        ],
      });
    });
  }

  function showResult() {
    recordResult();
    saveGame();
    const o = S.over;
    let emoji, title, html;
    if (o.draw) {
      emoji = '🤝'; title = '나가리 (무승부)';
      html = '아무도 7점을 내지 못했어요.';
      sfx.lose();
    } else {
      const win = o.winner === 0;
      emoji = win ? '🎉' : '😢';
      title = win ? `이겼어요! +${o.points}점` : `졌어요… -${o.points}점`;
      html = '<table>' + o.lines.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') +
        `<tr class="total"><td>합계</td><td>${o.points}점</td></tr></table>`;
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
    const s = R.score(ids);
    const groups = [['광', 'gwang', s.gwangScore], ['열끗', 'yeol', s.yeolScore + s.godori], ['띠', 'tti', s.ttiScore + s.hong + s.cheong + s.cho], ['피', 'pi', s.piScore]];
    const box = document.createElement('div');
    for (const [name, kind, pts] of groups) {
      const g = document.createElement('div');
      g.className = 'cap-group';
      const list = ids.filter(id => C[id].kind === kind).sort((a, b) => a - b);
      const cnt = kind === 'pi' ? s.piCount : list.length;
      g.innerHTML = `<b>${name} ${cnt}장${pts ? ` → ${pts}점` : ''}</b>`;
      const cards = document.createElement('div');
      cards.className = 'cards';
      if (!list.length) cards.textContent = '없음';
      list.forEach(id => cards.appendChild(cardEl(id)));
      g.appendChild(cards);
      box.appendChild(g);
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
    if (node) body.appendChild(node);
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
    const cont = $('#btn-continue');
    cont.classList.toggle('hidden', !save.current);
    // 하던 판이 없으면 '새 판 시작'이 주 버튼
    $('#btn-new').className = save.current ? 'btn light' : 'btn big';
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

  function startNew() {
    hideModal();
    S = R.newRound(Math.random, save.nextFirst || 0);
    busy = false;
    saveGame();
    showScreen(gameEl);
    setMsg('');
    render();
    if (S.turn === 1) toast('컴퓨터가 먼저 시작해요');
    proceed();
  }

  function resume() {
    if (!save.current) return startNew();
    S = JSON.parse(JSON.stringify(save.current));
    S.pending = null; // 차례 도중 저장은 없지만 혹시 모를 경우 대비
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
    sfx.flip();
  }

  function showRules() {
    showModal({
      emoji: '📖', title: '고스톱(맞고) 규칙',
      html: `<ul class="rules">
        <li>같은 <b>달(숫자)</b> 패끼리 짝을 맞춰 가져와요.</li>
        <li>내 패 1장을 내고, 더미에서 1장을 뒤집어요.</li>
        <li><b>7점</b>이 나면 <b>고</b>(계속) 또는 <b>스톱</b>(끝내기)을 골라요.</li>
        <li>광 3장 3점(비광 끼면 2점) · 4장 4점 · 5장 15점</li>
        <li>열끗·띠 5장부터 1점 · 피 10장부터 1점 (쌍피는 2장 몫)</li>
        <li>고도리 5점 · 홍단·청단·초단 각 3점</li>
        <li>쪽·따닥·싹쓸이·뻑 먹기를 하면 상대 피를 가져와요.</li>
        <li>피박·광박·고박이면 점수가 2배예요.</li>
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
  $('#opp-row').addEventListener('click', () => showCaptured(1));
  $('#me-row').addEventListener('click', () => showCaptured(0));
  $('#btn-hub').addEventListener('click', () => {
    let fromHub = false;
    try { fromHub = sessionStorage.getItem('hub.opened') === '1'; } catch (e) { /* 무시 */ }
    if (fromHub && history.length > 1) history.back();
    else location.replace('../../');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && S && !busy && S.phase === 'play') saveGame();
  });

  // 첫 화면 장식 (1월 광, 8월 광, 3월 광)
  [0, 28, 8].forEach(id => $('#logo').appendChild(cardEl(id)));
  $('#app-version').textContent = `버전 ${APP_VERSION}`;
  showHome();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('../../sw.js', { scope: '../../' }).catch(() => { });
  }
})();
