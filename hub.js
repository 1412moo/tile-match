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
    for (const g of games) {
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

  document.getElementById('hub-version').textContent = `버전 ${window.APP_VERSION}`;
  render();
  // 게임에서 뒤로 돌아왔을 때(페이지 복원 포함) 진행 상황 다시 표시
  window.addEventListener('pageshow', e => { if (e.persisted) render(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
