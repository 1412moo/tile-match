// 같이 치기 (각자 폰으로 맞고) - 두 폰을 PeerJS(WebRTC)로 직접 연결한다. 우리 서버는 없음.
//   방장(host)이 4자리 방 코드로 방을 열고, 상대(guest)가 코드를 넣어 들어온다.
//   PeerJS 무료 공개 서버(0.peerjs.com)는 처음 서로를 찾을 때만 쓰고, 패 정보는 두 폰이 직접 주고받는다.
//
// 동기화 방식: 판의 처음 상태(init, 방장 기준)와 그 뒤의 '행동 기록(log)'만 주고받는다.
//   규칙 엔진(rules.js)은 같은 상태 + 같은 행동이면 항상 같은 결과를 내므로, 두 폰이 각자 같은 판을 진행한다.
//   행동: { k:'bonus', card } 보너스패 내기 / { k:'turn', card|dummy, opt, fc } 한 차례(내기+뒤집기) / { k:'decide', go }
//   각 폰은 자기가 '나(0)'가 되도록 상태를 뒤집어서 본다 (방장: 그대로, 상대: swapState).
//   연결이 끊겼다 다시 붙으면 서로 가진 기록 길이를 알려 주고 모자란 뒤쪽만 다시 보낸다.
//   폰에서 앱이 꺼져도 기록이 localStorage 에 있어서 다시 열면 그대로 이어진다.
//
// 방 정보: 방 ID(code) · 방장(hostName) · 플레이어 · 점당 게임머니(stake) · 상태 - room() 참고
//   점당은 방장이 방을 만들 때만 정하고, 판마다 처음 상태(init.stake)에 넣어 보낸다.
//   두 폰은 init 의 stake·판 시작 잔액(init.money)으로 정산하므로 한쪽에서 값을 바꿔도 이미 시작한 판에는 영향이 없다.
// 메시지(t): hello 인사(이름·기록 길이·잔액·점당) / round 새 판 / act 행동 / ready 한 판 더 / bye 그만하기
//   deny 방장이 참가를 거절(게임머니 부족) / chat 채팅 / ping 연결 확인
(function (root) {
  'use strict';
  const R = root.GS || (typeof require !== 'undefined' ? require('./rules.js') : null);

  // ---------------- 규칙 쪽 (화면·네트워크와 무관 - Node 테스트 가능) ----------------
  const PER_PLAYER = ['hands', 'captured', 'go', 'goScore', 'shake', 'bomb', 'dummies', 'shook', 'turnNo', 'ppeokRun', 'bonusPts', 'money'];
  const clone = o => JSON.parse(JSON.stringify(o));

  // 플레이어 0 ↔ 1 을 바꾼 상태 (새 객체)
  function swapState(s0) {
    const s = clone(s0);
    for (const k of PER_PLAYER) if (Array.isArray(s[k])) s[k].reverse();
    s.turn = 1 - s.turn;
    s.first = 1 - s.first;
    for (const m of Object.keys(s.ppeok || {})) s.ppeok[m] = 1 - s.ppeok[m];
    if (s.over) {
      if (s.over.winner !== null && s.over.winner !== undefined) s.over.winner = 1 - s.over.winner;
      if (s.over.bonusPts) s.over.bonusPts.reverse();
    }
    if (s.last) s.last.player = 1 - s.last.player;
    s.alerted = {};
    return s;
  }
  // 방장 기준 상태 → 이 폰 기준 상태
  const toLocal = (init, role) => (role === 'host' ? clone(init) : swapState(init));
  // 다음에 와야 할 행동 종류
  const expectedKind = s => (s.phase === 'gostop' ? 'decide' : s.phase === 'play' ? 'play' : null);

  // 행동 하나를 화면 연출 없이 적용 (게임 화면은 같은 순서로 연출하며 적용한다)
  function applyAction(s, a) {
    if (a.k === 'decide') { R.decide(s, !!a.go); return; }
    if (a.k === 'bonus') { R.play(s, a.card); return; }
    if (a.dummy) R.playDummy(s);
    else R.play(s, a.card, a.opt || {});
    R.flip(s, a.fc === undefined ? null : a.fc);
    R.endTurn(s);
  }
  function rebuild(init, log, role) {
    const s = toLocal(init, role);
    for (const a of log) applyAction(s, a);
    return s;
  }

  // ---------------- 연결 (브라우저 전용) ----------------
  const PREFIX = 'mom-gamechunguk-gostop-'; // 다른 PeerJS 사용자와 겹치지 않게 붙이는 앞글자
  const KEY = 'gostop.online.v1';
  const PING_MS = 4000, DEAD_MS = 13000, RETRY_MS = 3000, CONNECT_TIMEOUT = 9000;
  const PROTO = 2; // 주고받는 형식 버전 (2: 게임머니·두 장 폭탄·채팅). 다르면 같이 칠 수 없음
  // 채팅: 한 줄 최대 글자 / 도배 막기 (1초에 1개, 10초에 5개) / 기억할 줄 수
  const CHAT_MAX = 60, CHAT_GAP_MS = 1000, CHAT_BURST = 5, CHAT_WINDOW_MS = 10000, CHAT_KEEP = 50;
  // 받은 글: 문자열로 바꾸고 줄바꿈 외 제어 문자를 지우고 길이를 자른다 (화면에는 textContent 로만 넣음)
  const cleanText = t => String(t == null ? '' : t).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, CHAT_MAX);

  function loadSession() {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  const newCode = () => String(1000 + Math.floor(Math.random() * 9000));

  // ev: { status(state, text), round(fresh), act(), ready(), bye(), fail(msg), needRound(), money() 내 잔액, chat(msg) }
  //   state: 'connecting' | 'waiting'(방장: 상대 기다림) | 'online' | 'lost'
  class Link {
    constructor(sess, ev) {
      this.sess = sess;
      this.ev = ev;
      this.peer = null;
      this.conn = null;
      this.cursor = sess.log ? sess.log.length : 0; // 화면에 적용한 행동 수
      this.waiter = null;
      this.closed = false;
      this.everConnected = !!sess.joined;
      this.firstHostTry = !sess.init;
      this.lastRecv = 0;
      this.timers = [];
      this.lastSent = 0;
      this.state = '';
      this.onVis = () => { if (document.visibilityState === 'visible') this.checkAlive(true); };
      document.addEventListener('visibilitychange', this.onVis);
      this.timers.push(setInterval(() => this.tick(), 1000));
    }

    // stake: 방장이 정한 점당 게임머니 (상대는 0 으로 시작해 방장 인사에서 받음)
    static create(role, myName, code, stake) {
      const old = loadSession();
      const stats = (old && old.stats) || { wins: 0, losses: 0, draws: 0, points: 0 };
      return { role, code: code || newCode(), myName, oppName: '', r: 0, init: null, log: [],
        nextFirst: 0, nextMult: 1, myReady: false, oppReady: false, recorded: 0, stats, joined: false,
        stake: role === 'host' ? stake : 0, oppMoney: null, chat: [] };
    }
    static load() { const s = loadSession(); return s && s.code && s.role ? s : null; }
    static clear() {
      const s = loadSession();
      try {
        if (s && s.stats) localStorage.setItem(KEY, JSON.stringify({ stats: s.stats, myName: s.myName }));
        else localStorage.removeItem(KEY);
      } catch (e) { /* 무시 */ }
    }
    static lastName() { const s = loadSession(); return (s && s.myName) || ''; }

    persist() { try { localStorage.setItem(KEY, JSON.stringify(this.sess)); } catch (e) { /* 무시 */ } }
    get connected() { return !!(this.conn && this.conn.open); }

    // 방 정보 (화면 표시·확인용)
    room() {
      const s = this.sess, host = s.role === 'host';
      return {
        id: s.code,
        host: host ? s.myName : s.oppName,
        players: [s.myName, s.oppName].filter(Boolean),
        stake: s.stake,
        status: !s.joined ? 'waiting' : s.init ? 'playing' : 'ready',
      };
    }
    myMoney() { return this.ev.money ? this.ev.money() : 0; }
    hello() {
      const s = this.sess;
      const m = { t: 'hello', pv: PROTO, name: s.myName, r: s.r, n: s.log.length, ready: s.myReady, money: this.myMoney() };
      if (s.role === 'host') m.stake = s.stake;
      this.send(m);
    }

    setState(st, text) {
      this.state = st;
      this.ev.status(st, text || '');
    }

    start() {
      if (!root.Peer) { this.ev.fail('연결 기능을 불러오지 못했어요. 인터넷을 확인해 주세요.'); return; }
      this.setState('connecting', '연결하는 중…');
      this.openPeer();
    }

    openPeer() {
      if (this.closed) return;
      if (this.peer) { try { this.peer.destroy(); } catch (e) { /* 무시 */ } }
      const host = this.sess.role === 'host';
      const peer = host ? new root.Peer(PREFIX + this.sess.code, { debug: 0 }) : new root.Peer({ debug: 0 });
      this.peer = peer;
      peer.on('open', () => {
        if (peer !== this.peer) return;
        if (host) { this.firstHostTry = false; if (!this.connected) this.setState('waiting', '상대를 기다리는 중…'); }
        else this.connect();
      });
      peer.on('connection', c => { if (peer === this.peer && host) this.adopt(c); });
      peer.on('disconnected', () => { // 찾기 서버와만 끊김 (이미 연결된 상대와는 계속 통함)
        if (peer !== this.peer || this.closed || peer.destroyed) return;
        setTimeout(() => { if (peer === this.peer && !peer.destroyed && peer.disconnected) try { peer.reconnect(); } catch (e) { /* 무시 */ } }, 1500);
      });
      peer.on('error', err => {
        if (peer !== this.peer || this.closed) return;
        const t = err && err.type;
        if (t === 'unavailable-id' && host && this.firstHostTry) { // 새 방 코드가 이미 쓰이는 중 → 다른 코드
          this.sess.code = newCode();
          this.persist();
          this.ev.codeChanged && this.ev.codeChanged(this.sess.code);
          this.retry(300);
          return;
        }
        if (t === 'peer-unavailable') { // 방장 폰이 아직 안 열림 / 코드가 틀림
          if (!this.everConnected) { this.ev.fail('방을 찾을 수 없어요. 방 코드를 확인하고, 방장 폰에서 고스톱이 켜져 있는지 봐 주세요.'); return; }
          this.connecting = false;
          this.setState('lost', '상대 폰을 기다리는 중…');
          return; // tick 에서 다시 시도
        }
        if (t === 'browser-incompatible') { this.ev.fail('이 브라우저는 같이 치기를 지원하지 않아요. Chrome 으로 열어 주세요.'); return; }
        // unavailable-id(방장 다시 열기: 예전 연결이 아직 안 지워짐), network, server-error 등 → 잠시 뒤 다시
        this.setState(this.connected ? 'online' : 'lost', '다시 연결하는 중…');
        this.retry(RETRY_MS);
      });
    }
    retry(ms) {
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => { if (!this.closed) this.openPeer(); }, ms);
    }

    // 상대(guest): 방장에게 연결
    connect() {
      if (this.closed || !this.peer || this.peer.destroyed || this.peer.disconnected || this.connected || this.connecting) return;
      this.connecting = true;
      const c = this.peer.connect(PREFIX + this.sess.code, { serialization: 'json', reliable: true });
      if (!c) { this.connecting = false; return; }
      const t = setTimeout(() => { if (!c.open) { this.connecting = false; try { c.close(); } catch (e) { /* 무시 */ } } }, CONNECT_TIMEOUT);
      c.on('open', () => clearTimeout(t));
      this.adopt(c);
    }

    adopt(c) {
      if (this.conn && this.conn !== c) { try { this.conn.close(); } catch (e) { /* 무시 */ } }
      this.conn = c;
      c.on('open', () => {
        if (c !== this.conn) return;
        this.connecting = false;
        this.everConnected = true;
        this.lastRecv = Date.now();
        this.setState('online', '');
        this.hello();
      });
      c.on('data', d => { if (c === this.conn) this.recv(d); });
      const lost = () => {
        if (c !== this.conn) return;
        this.conn = null;
        this.connecting = false;
        if (this.closed) return;
        if (this.sess.role === 'host' && !this.sess.joined) this.setState('waiting', '상대를 기다리는 중…');
        else this.setState('lost', '연결이 끊겼어요. 다시 연결하는 중…');
      };
      c.on('close', lost);
      c.on('error', lost);
    }

    tick() {
      if (this.closed) return;
      if (this.connected) {
        if (Date.now() - this.lastSent > PING_MS - 200) this.send({ t: 'ping' });
        this.checkAlive(false);
      } else if (this.sess.role === 'guest' && this.peer && this.peer.open && !this.connecting && Date.now() - (this.lastTry || 0) > RETRY_MS) {
        this.lastTry = Date.now();
        this.connect();
      }
    }
    // 휴대폰이 잠들었다 깨면 연결이 죽어 있어도 close 가 안 올 때가 있어 직접 확인
    checkAlive(woke) {
      if (this.closed) return;
      if (this.conn && Date.now() - this.lastRecv > DEAD_MS) {
        const c = this.conn;
        this.conn = null;
        try { c.close(); } catch (e) { /* 무시 */ }
        this.setState('lost', '연결이 끊겼어요. 다시 연결하는 중…');
      }
      if (woke && this.peer && (this.peer.destroyed || this.peer.disconnected)) this.retry(100);
      if (woke && !this.connected && this.sess.role === 'guest') { this.lastTry = 0; this.tick(); }
    }

    send(m) {
      if (!this.connected) return false;
      try { this.conn.send(m); this.lastSent = Date.now(); return true; } catch (e) { return false; }
    }

    recv(m) {
      this.lastRecv = Date.now();
      if (!m || typeof m !== 'object') return;
      const s = this.sess, host = s.role === 'host';
      switch (m.t) {
        case 'ping': return;
        case 'hello': {
          if (m.pv !== PROTO) { // 한쪽 폰이 예전 버전 (형식이 달라 판이 어긋남)
            this.send({ t: 'bye' });
            this.ev.fail('두 폰의 고스톱 버전이 달라요. 두 폰 모두 고스톱을 껐다가 다시 열어 최신 버전으로 맞춰 주세요.');
            return;
          }
          if (m.name && m.name !== s.oppName) { s.oppName = cleanText(m.name).slice(0, 8); this.ev.names && this.ev.names(); }
          if (typeof m.money === 'number' && isFinite(m.money)) s.oppMoney = Math.max(0, Math.floor(m.money));
          if (!host && typeof m.stake === 'number' && m.stake > 0) s.stake = Math.floor(m.stake); // 점당은 방장 값만 따름
          // 처음 들어올 때 게임머니가 점당보다 적으면 참가할 수 없음 (방장·상대 양쪽에서 확인)
          if (!s.joined && s.stake > 0) {
            if (host && s.oppMoney !== null && s.oppMoney < s.stake) { this.send({ t: 'deny', why: 'money', stake: s.stake }); return; }
            if (!host && this.myMoney() < s.stake) { this.ev.fail(moneyMsg(s.stake)); return; }
          }
          if (!s.joined) { s.joined = true; }
          this.persist();
          if (host) {
            if (!s.init) { this.ev.needRound(); return; }
            if (m.r !== s.r) { this.sendRound(); return; }
          } else if (m.r !== s.r) return; // 방장이 곧 round 를 보내 줌
          if (m.ready && !s.oppReady) { s.oppReady = true; this.persist(); this.ev.ready(); }
          for (let i = m.n; i < s.log.length; i++) this.send({ t: 'act', r: s.r, i, a: s.log[i] });
          return;
        }
        case 'round': { // 방장 → 상대: 새 판 (또는 다시 붙었을 때 판 전체)
          if (host) return;
          const fresh = m.r !== s.r || !s.init;
          if (!fresh && m.log.length <= s.log.length) return;
          s.r = m.r; s.init = m.init; s.log = m.log; s.oppName = m.name ? cleanText(m.name).slice(0, 8) : s.oppName;
          if (m.init && m.init.stake) s.stake = m.init.stake;
          s.myReady = false; s.oppReady = false; s.joined = true;
          this.persist();
          this.cursor = 0;
          this.ev.round(m.log.length === 0);
          this.hello();
          return;
        }
        case 'act': {
          if (m.r !== s.r) return;
          if (m.i < s.log.length) return; // 이미 받음
          if (m.i > s.log.length) { this.hello(); return; }
          s.log.push(m.a);
          this.persist();
          this.wake();
          this.ev.act && this.ev.act();
          return;
        }
        case 'ready':
          if (m.r !== s.r) return;
          if (typeof m.money === 'number' && isFinite(m.money)) s.oppMoney = Math.max(0, Math.floor(m.money));
          s.oppReady = true;
          this.persist();
          this.ev.ready();
          return;
        case 'bye':
          this.ev.bye();
          return;
        case 'deny': // 방장이 거절: 게임머니 부족
          if (host) return;
          this.ev.fail(moneyMsg(m.stake || s.stake));
          return;
        case 'chat': {
          const text = cleanText(m.text);
          if (!text) return;
          const now = Date.now();
          this.chatIn = (this.chatIn || []).filter(t => now - t < CHAT_WINDOW_MS);
          if (this.chatIn.length >= CHAT_BURST * 2) return; // 받는 쪽에서도 지나친 도배는 버림
          this.chatIn.push(now);
          this.pushChat({ from: 'opp', text, at: now });
          return;
        }
      }
    }

    pushChat(msg) {
      const s = this.sess;
      s.chat = (s.chat || []).concat(msg).slice(-CHAT_KEEP);
      this.persist();
      this.ev.chat && this.ev.chat(msg);
    }
    // 채팅 보내기. 돌려주는 값: 'ok' | 'empty' | 'offline'(연결 끊김) | 'fast'(도배 막기)
    sendChat(raw) {
      const text = cleanText(raw);
      if (!text) return 'empty';
      if (!this.connected) return 'offline';
      const now = Date.now();
      this.chatOut = (this.chatOut || []).filter(t => now - t < CHAT_WINDOW_MS);
      if (this.chatOut.length >= CHAT_BURST || (this.chatOut.length && now - this.chatOut[this.chatOut.length - 1] < CHAT_GAP_MS)) return 'fast';
      if (!this.send({ t: 'chat', text })) return 'offline';
      this.chatOut.push(now);
      this.pushChat({ from: 'me', text, at: now });
      return 'ok';
    }

    sendRound() {
      const s = this.sess;
      this.send({ t: 'round', r: s.r, init: s.init, log: s.log, name: s.myName });
    }

    // 방장: 새 판 시작 (state 는 방장 기준 newRound 결과)
    startRound(state) {
      const s = this.sess;
      s.r++;
      s.init = clone(state);
      s.log = [];
      s.myReady = false; s.oppReady = false;
      this.cursor = 0;
      this.persist();
      this.sendRound();
    }

    // 내 행동 보내기 (기록에 남기고, 끊겨 있으면 다시 붙을 때 보냄)
    sendAct(a) {
      const s = this.sess;
      if (this.cursor !== s.log.length) console.warn('online: 기록이 어긋남', this.cursor, s.log.length);
      s.log.push(a);
      this.cursor = s.log.length;
      this.persist();
      this.send({ t: 'act', r: s.r, i: s.log.length - 1, a });
    }
    // 상대의 다음 행동 기다리기
    next() {
      const r = this.sess.r;
      return new Promise(res => {
        this.waiter = { res, r };
        this.wake();
      });
    }
    wake() {
      const w = this.waiter;
      if (!w || w.r !== this.sess.r || this.cursor >= this.sess.log.length) return;
      this.waiter = null;
      w.res(this.sess.log[this.cursor++]);
    }
    cancelWait() { this.waiter = null; }
    syncCursor() { this.cursor = this.sess.log.length; this.waiter = null; }

    setReady() {
      const s = this.sess;
      s.myReady = true;
      this.persist();
      this.send({ t: 'ready', r: s.r, money: this.myMoney() });
    }

    close(bye) {
      if (bye) this.send({ t: 'bye' });
      this.closed = true;
      this.waiter = null;
      this.timers.forEach(clearInterval);
      clearTimeout(this.retryTimer);
      document.removeEventListener('visibilitychange', this.onVis);
      const peer = this.peer, conn = this.conn;
      this.peer = null; this.conn = null;
      // bye 가 실제로 나가도록 조금 뒤에 끊음
      setTimeout(() => {
        try { if (conn) conn.close(); } catch (e) { /* 무시 */ }
        try { if (peer) peer.destroy(); } catch (e) { /* 무시 */ }
      }, bye ? 400 : 0);
    }
  }

  function moneyMsg(stake) {
    return `게임머니가 부족합니다. 이 방은 점당 ${Number(stake).toLocaleString('ko-KR')}냥이라 그 이상 있어야 들어갈 수 있어요. 미션을 완료해서 게임머니를 얻어보세요.`;
  }

  const api = { swapState, toLocal, applyAction, rebuild, expectedKind, Link, clone, cleanText, PROTO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GSOnline = api;
})(typeof window !== 'undefined' ? window : this);
