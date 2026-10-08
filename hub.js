// 게임 모음 메인 화면
(function () {
  'use strict';

  const list = document.getElementById('game-list');
  const games = window.GAME_REGISTRY || [];

  function readSave(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
  }

  function render() {
    list.innerHTML = '';
    for (const g of games.filter(x => !x.hidden)) { // 숨긴 게임(만드는 중)은 목록에 안 보임
      const card = document.createElement('button');
      card.className = 'game-card' + (g.ready ? '' : ' soon');
      card.dataset.game = g.id;
      let status = '';
      if (g.ready && g.summary) {
        const s = readSave(g.storageKey);
        if (s) { try { status = g.summary(s) || ''; } catch (e) { status = ''; } }
      }
      card.innerHTML =
        `<span class="game-icon">${g.icon}</span>` +
        `<span class="game-text"><span class="game-name"></span><span class="game-desc"></span>` +
        `<span class="game-status"></span></span>` +
        (g.ready ? '<span class="game-arrow">▶</span>' : '<span class="soon-badge">준비중</span>');
      card.querySelector('.game-name').textContent = g.name;
      card.querySelector('.game-desc').textContent = g.desc;
      card.querySelector('.game-status').textContent = status;
      card.setAttribute('aria-label', g.name + (g.ready ? '' : ' 준비중'));
      card.addEventListener('click', () => open(g));
      list.appendChild(card);
    }
  }

  function open(g) {
    if (!g.ready) return toast(`${g.icon} ${g.name}\n준비 중인 게임이에요. 조금만 기다려 주세요!`);
    // 게임의 '게임 목록' 버튼이 뒤로 가기로 이 화면에 돌아오도록 표시
    try { sessionStorage.setItem('hub.opened', '1'); } catch (e) { /* 무시 */ }
    location.href = g.path;
  }

  // ---------------- 게임머니 · 오늘의 미션 (wallet.js) ----------------
  const W = window.Wallet;
  const sheet = document.getElementById('missions');
  function renderWallet() {
    document.getElementById('wb-money').textContent = `🪙 ${W.fmt(W.money())}`;
    const n = W.unclaimed();
    const cnt = document.getElementById('wb-count');
    cnt.classList.toggle('hidden', !n);
    cnt.textContent = n;
    if (!sheet.classList.contains('hidden')) renderMissions();
  }
  function renderMissions() {
    const d = W.today().split('-');
    document.getElementById('missions-sub').textContent = `${+d[1]}월 ${+d[2]}일 · 날짜가 바뀌면 새 미션이 열려요`;
    const box = document.getElementById('mission-list');
    box.innerHTML = '';
    for (const m of W.missions()) {
      const row = document.createElement('div');
      row.className = 'mission' + (m.claimed ? ' claimed' : '');
      row.innerHTML = '<span class="m-check"></span><span class="m-text"><span class="m-title"></span><span class="m-sub"></span></span><button class="m-btn"></button>';
      row.querySelector('.m-check').textContent = m.claimed ? '✅' : m.done ? '🎁' : '⬜';
      row.querySelector('.m-title').textContent = m.title;
      row.querySelector('.m-sub').textContent = `보상 +${W.fmt(m.reward)} · ${m.progress}/${m.goal}판`;
      const btn = row.querySelector('.m-btn');
      btn.textContent = m.claimed ? '받음' : m.done ? '받기' : '진행 중';
      btn.disabled = m.claimed || !m.done;
      btn.addEventListener('click', () => {
        const got = W.claim(m.id); // 하루에 한 번만 (지갑에서 다시 확인)
        if (got) toast(`+${W.fmt(got)} 받았어요!`);
        renderWallet();
        renderMissions();
      });
      box.appendChild(row);
    }
  }
  function openMissions() {
    sheet.classList.remove('hidden');
    renderMissions();
  }
  document.getElementById('wallet-bar').addEventListener('click', openMissions);
  document.getElementById('missions-close').addEventListener('click', () => sheet.classList.add('hidden'));
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.classList.add('hidden'); });

  document.getElementById('hub-version').textContent = `버전 ${window.APP_VERSION}`;
  render();
  renderWallet();
  if (location.hash === '#missions') { // 게임에서 '미션으로 게임머니 얻기'
    openMissions();
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 무시 */ }
  }
  // 게임에서 뒤로 돌아왔을 때(페이지 복원 포함) 진행 상황 다시 표시
  window.addEventListener('pageshow', e => { if (e.persisted) { render(); renderWallet(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renderWallet(); }); // 날짜가 바뀌었을 수도

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
