// 공용 게임머니 지갑 + 오늘의 미션 - 모든 게임이 함께 쓴다 (브라우저: window.Wallet, Node: module.exports)
//   저장 키 'hub.wallet.v1' 하나에만 쓰고, 게임별 저장 키(tilematch.save.v1 등)는 건드리지 않는다.
//   읽고 고칠 때마다 저장소에서 새로 읽어 바로 저장한다 (다른 탭·다른 게임에서 바뀐 값을 덮어쓰지 않게).
//
// 게임에서 쓰는 법
//   Wallet.recordPlay('tile-match')   한 판을 마쳤을 때 (미션 진행)
//   Wallet.money()                    지금 잔액
//   Wallet.add(+1200, '고유 id')       잔액 증감 (같은 id 는 한 번만 반영, 0 아래로 내려가지 않음)
(function (root) {
  'use strict';

  // ---------------- 설정 (숫자는 여기서만 바꾼다) ----------------
  const CONFIG = {
    INITIAL_GAME_MONEY: 10000,       // 처음 들어온 사람에게 주는 게임머니
    UNIT: '냥',
    STAKES: [10, 50, 100, 500],      // 고스톱 방 만들 때 고르는 점당 게임머니
    DEFAULT_STAKE: 100,
    MAX_STAKE: 10000,                // 직접 설정할 때 최대
    // 오늘의 미션: game 이 있으면 그 게임만, 없으면 아무 게임이나. goal 판을 마치면 reward 를 받을 수 있다
    MISSIONS: [
      { id: 'first', title: '오늘 첫 게임 플레이', goal: 1, reward: 200 },
      { id: 'tile-match', title: '타일 매치 1회 플레이', game: 'tile-match', goal: 1, reward: 100 },
      { id: 'english', title: '영어 탐험대 1회 플레이', game: 'english', goal: 1, reward: 100 },
      { id: 'any3', title: '아무 게임이나 3판 플레이', goal: 3, reward: 100 },
    ],
  };
  const KEY = 'hub.wallet.v1';
  const APPLIED_KEEP = 200; // 이미 반영한 거래 id 를 최근 몇 개까지 기억할지

  // 로컬 날짜 'YYYY-MM-DD'
  function today(now) {
    const d = now ? now() : new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const fmt = n => `${Math.round(n).toLocaleString('ko-KR')}${CONFIG.UNIT}`;

  // storage: getItem/setItem 이 있는 저장소 (테스트에서는 가짜 저장소), now: 날짜 함수 (테스트용)
  function create(storage, now) {
    let memory = null; // 저장소를 못 쓰는 환경이면 메모리에만
    function blank() {
      return { v: 1, money: CONFIG.INITIAL_GAME_MONEY, daily: { date: today(now), played: {}, claimed: [] }, applied: [] };
    }
    function read() {
      let w = null;
      try { w = JSON.parse(storage.getItem(KEY) || 'null'); } catch (e) { w = memory; }
      if (!w || typeof w !== 'object' || typeof w.money !== 'number' || !isFinite(w.money)) w = memory || blank();
      w.money = Math.max(0, Math.floor(w.money));
      if (!Array.isArray(w.applied)) w.applied = [];
      const d = today(now);
      if (!w.daily || w.daily.date !== d) w.daily = { date: d, played: {}, claimed: [] }; // 날짜가 바뀌면 미션 처음부터
      if (!w.daily.played) w.daily.played = {};
      if (!Array.isArray(w.daily.claimed)) w.daily.claimed = [];
      return w;
    }
    function write(w) {
      memory = w;
      try { storage.setItem(KEY, JSON.stringify(w)); } catch (e) { /* 메모리에만 */ }
    }
    // 처음 열었을 때 초기 게임머니 지급 (이미 있으면 그대로)
    function ensure() {
      let has = false;
      try { has = !!storage.getItem(KEY); } catch (e) { has = !!memory; }
      if (!has) write(read());
    }

    function progressOf(w, m) {
      const p = w.daily.played;
      return m.game ? (p[m.game] || 0) : Object.values(p).reduce((a, b) => a + b, 0);
    }
    function missions() {
      const w = read();
      return CONFIG.MISSIONS.map(m => {
        const progress = Math.min(m.goal, progressOf(w, m));
        return Object.assign({}, m, { progress, done: progress >= m.goal, claimed: w.daily.claimed.includes(m.id) });
      });
    }

    return {
      CONFIG, fmt, today: () => today(now), ensure,
      money: () => read().money,
      // 잔액 증감. txId 가 있으면 같은 거래는 한 번만 반영. 돌려주는 값: 실제로 바뀐 양
      add(delta, txId) {
        const w = read();
        if (txId && w.applied.includes(txId)) return 0;
        const before = w.money;
        w.money = Math.max(0, Math.floor(before + (delta || 0)));
        if (txId) { w.applied.push(txId); if (w.applied.length > APPLIED_KEEP) w.applied.splice(0, w.applied.length - APPLIED_KEEP); }
        write(w);
        return w.money - before;
      },
      applied: txId => read().applied.includes(txId),
      recordPlay(gameId) {
        if (!gameId) return;
        const w = read();
        w.daily.played[gameId] = (w.daily.played[gameId] || 0) + 1;
        write(w);
      },
      missions,
      unclaimed: () => missions().filter(m => m.done && !m.claimed).length,
      // 미션 보상 받기: 조건을 채웠고 오늘 아직 안 받았을 때만. 돌려주는 값: 받은 게임머니 (못 받으면 0)
      claim(id) {
        const w = read();
        const m = CONFIG.MISSIONS.find(x => x.id === id);
        if (!m || w.daily.claimed.includes(id) || progressOf(w, m) < m.goal) return 0;
        w.daily.claimed.push(id);
        w.money += m.reward;
        write(w);
        return m.reward;
      },
    };
  }

  const memStore = () => { const o = {}; return { getItem: k => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); } }; };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { create, CONFIG, KEY, today, fmt, memStore };
  } else {
    let store;
    try { store = root.localStorage; store.getItem(KEY); } catch (e) { store = memStore(); }
    const w = create(store);
    w.create = create;
    w.ensure();
    root.Wallet = w;
  }
})(typeof window !== 'undefined' ? window : this);
