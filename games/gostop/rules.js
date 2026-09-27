// 고스톱(맞고) 규칙 엔진 - 화면과 무관한 순수 로직 (브라우저: window.GS, Node: module.exports)
// 상태(state)는 JSON 으로 그대로 저장/복원할 수 있는 평범한 객체다. 플레이어 0 = 나, 1 = 컴퓨터.
(function (root) {
  'use strict';

  const MONTH_ICON = [null, '🌲', '🌺', '🌸', '🌿', '🌷', '🌹', '🍀', '🌾', '🌼', '🍁', '🍃', '☔'];
  const MONTH_NAME = [null, '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국화', '단풍', '오동', '비'];

  // [월, 종류, 추가정보]  종류: gwang 광 / yeol 열끗 / tti 띠 / pi 피
  const DEF = [
    [1, 'gwang', { icon: '🦢' }], [1, 'tti', { dan: 'hong' }], [1, 'pi'], [1, 'pi'],
    [2, 'yeol', { bird: true, icon: '🐥' }], [2, 'tti', { dan: 'hong' }], [2, 'pi'], [2, 'pi'],
    [3, 'gwang', { icon: '🎪' }], [3, 'tti', { dan: 'hong' }], [3, 'pi'], [3, 'pi'],
    [4, 'yeol', { bird: true, icon: '🐦' }], [4, 'tti', { dan: 'cho' }], [4, 'pi'], [4, 'pi'],
    [5, 'yeol', { icon: '🌉' }], [5, 'tti', { dan: 'cho' }], [5, 'pi'], [5, 'pi'],
    [6, 'yeol', { icon: '🦋' }], [6, 'tti', { dan: 'cheong' }], [6, 'pi'], [6, 'pi'],
    [7, 'yeol', { icon: '🐗' }], [7, 'tti', { dan: 'cho' }], [7, 'pi'], [7, 'pi'],
    [8, 'gwang', { icon: '🌕' }], [8, 'yeol', { bird: true, icon: '🦆' }], [8, 'pi'], [8, 'pi'],
    [9, 'yeol', { icon: '🍶' }], [9, 'tti', { dan: 'cheong' }], [9, 'pi'], [9, 'pi'],
    [10, 'yeol', { icon: '🦌' }], [10, 'tti', { dan: 'cheong' }], [10, 'pi'], [10, 'pi'],
    [11, 'gwang', { icon: '🦚' }], [11, 'pi', { pi: 2 }], [11, 'pi'], [11, 'pi'],
    [12, 'gwang', { icon: '🌂', rain: true }], [12, 'yeol', { icon: '🕊️' }], [12, 'tti'], [12, 'pi', { pi: 2, icon: '⚡' }],
  ];
  const CARDS = DEF.map(([month, kind, x = {}], id) => ({
    id, month, kind,
    pi: kind === 'pi' ? (x.pi || 1) : 0,
    dan: x.dan || null,
    bird: !!x.bird,
    rain: !!x.rain,
    icon: x.icon || MONTH_ICON[month],
  }));

  const WIN_SCORE = 7;
  const month = id => CARDS[id].month;

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function hasFour(ids) {
    const c = {};
    return ids.some(id => (c[month(id)] = (c[month(id)] || 0) + 1) === 4);
  }

  // 새 판: 각자 10장, 바닥 8장, 더미 20장 (바닥이나 손에 같은 달 4장이면 다시 나눔)
  function newRound(rng, first) {
    rng = rng || Math.random;
    let deck, hands, floor;
    do {
      const ids = shuffle([...Array(48).keys()], rng);
      hands = [ids.slice(0, 10), ids.slice(10, 20)];
      floor = ids.slice(20, 28);
      deck = ids.slice(28);
    } while (hasFour(floor) || hasFour(hands[0]) || hasFour(hands[1]));
    return {
      deck, floor, hands,
      captured: [[], []],
      turn: first || 0, first: first || 0,
      go: [0, 0], goScore: [0, 0],
      ppeok: {},          // 뻑으로 바닥에 쌓인 달 -> 뻑을 낸 사람
      pending: null,      // 패를 내고 뒤집기 전 상태
      phase: 'play',      // play | gostop | over
      over: null,
      last: null,         // 직전 차례 결과 (화면 표시용)
    };
  }

  // ---------------- 점수 ----------------
  function score(ids) {
    const cs = ids.map(i => CARDS[i]);
    const gw = cs.filter(c => c.kind === 'gwang');
    const g = gw.length, rain = gw.some(c => c.rain);
    const gwangScore = g === 5 ? 15 : g === 4 ? 4 : g === 3 ? (rain ? 2 : 3) : 0;
    const ye = cs.filter(c => c.kind === 'yeol');
    const yeolScore = ye.length >= 5 ? ye.length - 4 : 0;
    const godori = ye.filter(c => c.bird).length === 3 ? 5 : 0;
    const ti = cs.filter(c => c.kind === 'tti');
    const ttiScore = ti.length >= 5 ? ti.length - 4 : 0;
    const dan = d => (ti.filter(c => c.dan === d).length === 3 ? 3 : 0);
    const hong = dan('hong'), cheong = dan('cheong'), cho = dan('cho');
    const piCount = cs.reduce((s, c) => s + c.pi, 0);
    const piScore = piCount >= 10 ? piCount - 9 : 0;
    return {
      total: gwangScore + yeolScore + godori + ttiScore + hong + cheong + cho + piScore,
      gwangCount: g, gwangScore, yeolCount: ye.length, yeolScore, godori,
      ttiCount: ti.length, ttiScore, hong, cheong, cho, piCount, piScore,
    };
  }

  // ---------------- 한 차례 진행 ----------------
  function floorMatches(s, m) { return s.floor.filter(id => month(id) === m); }

  // 낼 패와 같은 달이 바닥에 2장이면 고를 수 있는 후보, 아니면 null
  function handOptions(s, cardId) {
    const F = floorMatches(s, month(cardId));
    return F.length === 2 ? F : null;
  }

  // 1단계: 손에서 패를 낸다 (바닥에 놓고, 무엇과 짝이 될지 기억)
  function play(s, cardId, choice) {
    const p = s.turn;
    const hand = s.hands[p];
    const i = hand.indexOf(cardId);
    if (s.phase !== 'play' || s.pending || i < 0) throw new Error('낼 수 없는 패');
    hand.splice(i, 1);
    const m = month(cardId);
    const F = floorMatches(s, m);
    let pair = null, took = null;
    if (F.length === 1) pair = F[0];
    else if (F.length === 2) pair = F.includes(choice) ? choice : bestCard(F);
    else if (F.length === 3) took = F.slice();
    s.floor.push(cardId);
    s.pending = { card: cardId, m, F, pair, took };
  }

  function peek(s) { return s.deck[s.deck.length - 1]; }

  // 뒤집을 패가 바닥의 같은 달 2장 중 하나를 골라야 하면 후보, 아니면 null
  function flipOptions(s) {
    const pd = s.pending;
    if (!pd || !s.deck.length) return null;
    const n = month(peek(s));
    if (n === pd.m) return null;
    const G = floorMatches(s, n);
    return G.length === 2 ? G : null;
  }

  // 뻑으로 쌓인 달을 가져가면 상대 피를 뺏는다 (자기가 싼 뻑이면 2장)
  function ppeokBonus(s, p, m, ev) {
    if (s.ppeok[m] === undefined) return 0;
    const self = s.ppeok[m] === p;
    delete s.ppeok[m];
    ev.push(self ? 'jappeok' : 'ppeokTake');
    return self ? 2 : 1;
  }

  // 2단계: 더미에서 한 장 뒤집고, 가져갈 패를 모두 정리한다
  function flip(s, choice) {
    const p = s.turn, pd = s.pending;
    if (!pd) throw new Error('먼저 패를 내야 함');
    const ev = [], take = [];
    let steal = 0;
    const d = s.deck.length ? s.deck.pop() : null;
    const n = d === null ? null : month(d);

    if (n === pd.m) {
      if (pd.F.length === 0) { ev.push('jjok'); take.push(pd.card, d); steal++; }
      else if (pd.F.length === 1) { ev.push('ppeok'); s.floor.push(d); s.ppeok[pd.m] = p; }
      else { ev.push('ttadak'); take.push(pd.card, ...pd.F, d); steal++; } // F 2장 (3장이면 같은 달 5장이라 불가능)
    } else {
      if (pd.took) { take.push(pd.card, ...pd.took); steal += ppeokBonus(s, p, pd.m, ev); }
      else if (pd.pair !== null) take.push(pd.card, pd.pair);
      if (d !== null) {
        const G = floorMatches(s, n);
        if (G.length === 0) s.floor.push(d);
        else if (G.length === 1) take.push(d, G[0]);
        else if (G.length === 2) take.push(d, G.includes(choice) ? choice : bestCard(G));
        else { take.push(d, ...G); steal += ppeokBonus(s, p, n, ev); }
      }
    }

    s.floor = s.floor.filter(id => !take.includes(id));
    s.captured[p].push(...take);
    // 싹쓸이: 바닥을 다 쓸어 가면 (마지막 차례는 제외)
    if (take.length && s.floor.length === 0 && s.deck.length > 0) { ev.push('sseul'); steal++; }
    const stolen = stealPi(s, p, steal);
    s.pending = null;
    s.last = { player: p, played: pd.card, flipped: d, taken: take, events: ev, stolen };
    return s.last;
  }

  // 상대 피를 count 장 가져온다 (보통 피부터, 없으면 쌍피)
  function stealPi(s, p, count) {
    const o = 1 - p, got = [];
    for (let k = 0; k < count; k++) {
      const pis = s.captured[o].filter(id => CARDS[id].kind === 'pi');
      if (!pis.length) break;
      const one = pis.find(id => CARDS[id].pi === 1);
      const id = one !== undefined ? one : pis[0];
      s.captured[o].splice(s.captured[o].indexOf(id), 1);
      s.captured[p].push(id);
      got.push(id);
    }
    return got;
  }

  // 3단계: 차례 마무리 - 7점 이상 새로 나면 고/스톱, 아니면 다음 차례
  function endTurn(s) {
    const p = s.turn;
    const sc = score(s.captured[p]).total;
    if (sc >= WIN_SCORE && sc > s.goScore[p]) {
      if (s.hands[p].length === 0) { finish(s, p); return s.phase; } // 마지막 패였으면 자동 스톱
      s.phase = 'gostop';
      return s.phase;
    }
    advance(s);
    return s.phase;
  }

  function advance(s) {
    if (s.hands[0].length === 0 && s.hands[1].length === 0) {
      s.phase = 'over';
      s.over = { draw: true, winner: null, points: 0, lines: [] }; // 나가리
      return;
    }
    s.turn = 1 - s.turn;
    s.phase = 'play';
  }

  // 고 / 스톱 결정
  function decide(s, go) {
    if (s.phase !== 'gostop') throw new Error('고/스톱 차례가 아님');
    const p = s.turn;
    if (go) {
      s.go[p]++;
      s.goScore[p] = score(s.captured[p]).total;
      advance(s);
    } else {
      finish(s, p);
    }
  }

  function finish(s, winner) {
    const o = 1 - winner;
    const ws = score(s.captured[winner]), ls = score(s.captured[o]);
    const k = s.go[winner];
    const lines = [['점수', `${ws.total}점`]];
    const goAdd = k === 1 ? 1 : k >= 2 ? 2 : 0;
    if (goAdd) lines.push([`${k}고`, `+${goAdd}점`]);
    let mult = 1;
    if (k >= 3) { mult *= 2 ** (k - 2); lines.push([`${k}고 보너스`, `×${2 ** (k - 2)}`]); }
    if (ws.piScore > 0 && ls.piCount <= 5) { mult *= 2; lines.push(['피박', '×2']); }
    if (ws.gwangScore > 0 && ls.gwangCount === 0) { mult *= 2; lines.push(['광박', '×2']); }
    if (s.go[o] > 0) { mult *= 2; lines.push(['고박', '×2']); }
    s.phase = 'over';
    s.over = { draw: false, winner, points: (ws.total + goAdd) * mult, lines };
  }

  // ---------------- 컴퓨터 ----------------
  function cardValue(id) {
    const c = CARDS[id];
    if (c.kind === 'gwang') return c.rain ? 4 : 6;
    if (c.kind === 'yeol') return c.bird ? 4 : 2.5;
    if (c.kind === 'tti') return c.dan ? 3 : 2;
    return c.pi === 2 ? 2.2 : 1;
  }
  function bestCard(ids) { return ids.reduce((b, id) => (cardValue(id) > cardValue(b) ? id : b), ids[0]); }

  // 낼 패 고르기: 바로 가져올 수 있는 가치가 큰 패, 없으면 가장 덜 아까운 패
  function aiPick(s, rng) {
    rng = rng || Math.random;
    const hand = s.hands[s.turn];
    let best = null, bestV = -Infinity;
    for (const id of hand) {
      const F = floorMatches(s, month(id));
      let v;
      if (F.length === 0) v = -cardValue(id) * 0.6;
      else if (F.length === 3) v = cardValue(id) + F.reduce((a, f) => a + cardValue(f), 0) + 2;
      else v = cardValue(id) + Math.max(...F.map(cardValue));
      v += rng() * 0.3;
      if (v > bestV) { bestV = v; best = id; }
    }
    const opts = handOptions(s, best);
    return { card: best, choice: opts ? bestCard(opts) : null };
  }

  // 고/스톱: 패가 넉넉하고 상대 점수가 낮으면 한두 번은 고
  function aiGoStop(s) {
    const p = s.turn, o = 1 - p;
    return s.hands[p].length >= 3 && score(s.captured[o]).total <= 3 && s.go[p] < 2;
  }

  const api = {
    CARDS, MONTH_NAME, WIN_SCORE, newRound, score, handOptions, play, peek, flipOptions, flip,
    endTurn, decide, aiPick, aiGoStop, bestCard, cardValue, month,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GS = api;
})(typeof window !== 'undefined' ? window : this);
