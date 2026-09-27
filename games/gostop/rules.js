// 고스톱(맞고) 규칙 엔진 - 화면과 무관한 순수 로직 (브라우저: window.GS, Node: module.exports)
// 상태(state)는 JSON 으로 그대로 저장/복원할 수 있는 평범한 객체다. 플레이어 0 = 나, 1 = 컴퓨터.
//
// 규칙 기준: 표준 맞고 (한게임 신맞고 게임 방법 기준, 7점 기준)
//  - 48장 + 보너스패 2장(보너스 쌍피, 보너스 쓰리피) = 50장. 손 10장씩, 바닥 8장, 나머지 더미
//  - 보너스패: 손에서 내면 먹고 더미에서 1장 더 받아 계속(상대 피는 안 뺏음), 뒤집어 나오면 먹고 한 장 더
//  - 7점부터 고/스톱. 고 할 때마다 +1점, 3고부터는 고마다 최종 점수 2배 (3고 ×2, 4고 ×4 …)
//  - 쪽·따닥·싹쓸이·뻑 먹기·폭탄: 상대 피 1장 (자뻑 2장). 마지막 턴은 뺏지 않음
//  - 흔들기·폭탄 ×2, 피박(피로 났을 때 상대 피 7장 이하) ×2, 광박 ×2, 멍따(열끗 7장 이상) ×2, 고박(독박) ×2
//  - 총통(손에 같은 달 4장) 10점으로 끝 / 바닥에 같은 달 4장이면 나가리
//  - 첫뻑 +7, 연뻑(두 번 연속) +14, 첫따닥 +7 (상대에게서 바로 받음), 삼연뻑 21점으로 끝
//  - 나가리: 다음 판 점수 2배 (누적), 선 유지
//  - 9월 국진: 열끗/쌍피 중 점수가 높은 쪽으로 자동 계산
//  - 2장 폭탄(피망 뉴맞고 변형)과 쇼당(3인 고스톱 규칙)은 표준 맞고에 없어 넣지 않음
(function (root) {
  'use strict';

  const MONTH_NAME = [null, '송학', '매조', '벚꽃', '흑싸리', '난초', '모란', '홍싸리', '공산', '국화', '단풍', '오동', '비'];

  // [월, 종류, 추가정보]  종류: gwang 광 / yeol 열끗 / tti 띠 / pi 피.  id 0~47 순서는 저장 호환을 위해 바꾸지 않는다.
  const DEF = [
    [1, 'gwang'], [1, 'tti', { dan: 'hong' }], [1, 'pi'], [1, 'pi'],
    [2, 'yeol', { bird: true }], [2, 'tti', { dan: 'hong' }], [2, 'pi'], [2, 'pi'],
    [3, 'gwang'], [3, 'tti', { dan: 'hong' }], [3, 'pi'], [3, 'pi'],
    [4, 'yeol', { bird: true }], [4, 'tti', { dan: 'cho' }], [4, 'pi'], [4, 'pi'],
    [5, 'yeol'], [5, 'tti', { dan: 'cho' }], [5, 'pi'], [5, 'pi'],
    [6, 'yeol'], [6, 'tti', { dan: 'cheong' }], [6, 'pi'], [6, 'pi'],
    [7, 'yeol'], [7, 'tti', { dan: 'cho' }], [7, 'pi'], [7, 'pi'],
    [8, 'gwang'], [8, 'yeol', { bird: true }], [8, 'pi'], [8, 'pi'],
    [9, 'yeol', { gukjin: true }], [9, 'tti', { dan: 'cheong' }], [9, 'pi'], [9, 'pi'],
    [10, 'yeol'], [10, 'tti', { dan: 'cheong' }], [10, 'pi'], [10, 'pi'],
    [11, 'gwang'], [11, 'pi', { pi: 2 }], [11, 'pi'], [11, 'pi'],
    [12, 'gwang', { rain: true }], [12, 'yeol'], [12, 'tti'], [12, 'pi', { pi: 2 }],
    // 보너스패 (월 없음)
    [0, 'pi', { pi: 2, bonus: true }], [0, 'pi', { pi: 3, bonus: true }],
  ];
  const CARDS = DEF.map(([month, kind, x = {}], id) => ({
    id, month, kind,
    pi: kind === 'pi' ? (x.pi || 1) : 0,
    dan: x.dan || null,
    bird: !!x.bird,
    rain: !!x.rain,
    gukjin: !!x.gukjin,
    bonus: !!x.bonus,
  }));
  const N_CARDS = CARDS.length; // 50
  const GUKJIN = CARDS.find(c => c.gukjin).id;

  const WIN_SCORE = 7;
  const PTS = { chongtong: 10, samyeon: 21, firstPpeok: 7, yeonPpeok: 14, firstTtadak: 7 };

  const month = id => CARDS[id].month;
  const isBonus = id => CARDS[id].bonus;

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 같은 달 4장이 있으면 그 달, 없으면 0 (보너스패 제외)
  function fourMonth(ids) {
    const c = {};
    for (const id of ids) {
      const m = month(id);
      if (m && (c[m] = (c[m] || 0) + 1) === 4) return m;
    }
    return 0;
  }

  function blankState(first, mult) {
    return {
      v: 2,
      deck: [], floor: [], hands: [[], []], captured: [[], []],
      turn: first, first, mult: mult || 1,
      go: [0, 0], goScore: [0, 0],
      shake: [0, 0], bomb: [0, 0], dummies: [0, 0], shook: [[], []],
      turnNo: [0, 0], ppeokRun: [0, 0], bonusPts: [0, 0],
      ppeok: {},          // 뻑으로 바닥에 쌓인 달 -> 뻑을 낸 사람
      pending: null,      // 패를 내고 뒤집기 전 상태
      phase: 'play',      // play | gostop | over
      over: null,
      last: null,         // 직전 차례 결과 (화면 표시용)
    };
  }

  // 새 판: 손 10장씩, 바닥 8장, 나머지 더미.  first = 선, mult = 나가리로 쌓인 배수
  function newRound(rng, first, mult) {
    rng = rng || Math.random;
    first = first || 0;
    const ids = shuffle([...Array(N_CARDS).keys()], rng);
    const s = blankState(first, mult);
    s.hands = [ids.slice(0, 10), ids.slice(10, 20)];
    s.floor = ids.slice(20, 28);
    s.deck = ids.slice(28);
    // 바닥에 깔린 보너스패는 선이 가져가고 더미에서 채운다
    for (let i = 0; i < s.floor.length; i++) {
      while (isBonus(s.floor[i])) {
        s.captured[first].push(s.floor[i]);
        s.floor[i] = s.deck.pop();
      }
    }
    const fm = fourMonth(s.floor);
    if (fm) { // 바닥 총통 → 나가리
      s.phase = 'over';
      s.over = { draw: true, winner: null, points: 0, reason: `바닥에 ${fm}월 4장 (나가리)`, lines: [], bonusPts: [0, 0] };
      return s;
    }
    for (const p of [first, 1 - first]) { // 손 총통 → 즉시 승리 (선 우선)
      const m = fourMonth(s.hands[p]);
      if (m) { s.turn = p; finish(s, p, { chongtong: m }); return s; }
    }
    return s;
  }

  // 예전 버전(v1) 저장 상태를 새 형식으로 (카드 id 0~47 은 같음)
  function upgradeState(s) {
    if (!s || s.v === 2) return s;
    const b = blankState(s.first || 0, 1);
    for (const k of Object.keys(b)) if (s[k] === undefined) s[k] = b[k];
    s.turnNo = [10 - s.hands[0].length, 10 - s.hands[1].length];
    s.v = 2;
    return s;
  }

  // ---------------- 점수 ----------------
  // gukjinAsPi: 9월 국진을 쌍피로 계산할지
  function score(ids, gukjinAsPi) {
    const cs = ids.map(i => CARDS[i]);
    const gw = cs.filter(c => c.kind === 'gwang');
    const g = gw.length, rain = gw.some(c => c.rain);
    const gwangScore = g === 5 ? 15 : g === 4 ? 4 : g === 3 ? (rain ? 2 : 3) : 0;
    const ye = cs.filter(c => c.kind === 'yeol' && !(gukjinAsPi && c.gukjin));
    const yeolScore = ye.length >= 5 ? ye.length - 4 : 0;
    const godori = ye.filter(c => c.bird).length === 3 ? 5 : 0;
    const ti = cs.filter(c => c.kind === 'tti');
    const ttiScore = ti.length >= 5 ? ti.length - 4 : 0;
    const dan = d => (ti.filter(c => c.dan === d).length === 3 ? 3 : 0);
    const hong = dan('hong'), cheong = dan('cheong'), cho = dan('cho');
    const piCount = cs.reduce((s, c) => s + c.pi, 0) + (gukjinAsPi && ids.includes(GUKJIN) ? 2 : 0);
    const piScore = piCount >= 10 ? piCount - 9 : 0;
    return {
      total: gwangScore + yeolScore + godori + ttiScore + hong + cheong + cho + piScore,
      gwangCount: g, gwangScore, yeolCount: ye.length, yeolScore, godori,
      ttiCount: ti.length, ttiScore, hong, cheong, cho, piCount, piScore,
      gukjinAsPi: !!(gukjinAsPi && ids.includes(GUKJIN)),
    };
  }
  // 국진을 유리한 쪽으로 계산한 점수
  function bestScore(ids) {
    const a = score(ids, false);
    if (!ids.includes(GUKJIN)) return a;
    const b = score(ids, true);
    return b.total > a.total ? b : a;
  }

  // ---------------- 한 차례 진행 ----------------
  function floorMatches(s, m) { return s.floor.filter(id => month(id) === m); }
  function countMonth(ids, m) { return ids.filter(id => month(id) === m).length; }

  // 낼 패와 같은 달이 바닥에 2장이면 고를 수 있는 후보, 아니면 null
  function handOptions(s, cardId) {
    if (isBonus(cardId)) return null;
    const F = floorMatches(s, month(cardId));
    return F.length === 2 ? F : null;
  }
  // 폭탄: 같은 달 3장을 들고 있고 바닥에 나머지 1장
  function canBomb(s, cardId) {
    const m = month(cardId);
    return !!m && countMonth(s.hands[s.turn], m) === 3 && floorMatches(s, m).length === 1;
  }
  // 흔들기: 같은 달 3장을 들고 있을 때 (그 달에 대해 한 번만 물어봄, 폭탄이 되는 경우는 폭탄으로)
  function canShake(s, cardId) {
    const m = month(cardId), p = s.turn;
    return !!m && countMonth(s.hands[p], m) === 3 && !s.shook[p].includes(m) && floorMatches(s, m).length !== 1;
  }

  // 1단계: 손에서 패를 낸다. opt = { choice, shake, bomb }
  // 보너스패면 바로 먹고 더미에서 1장을 가져온 뒤 같은 차례가 계속된다 ({bonus:true} 반환).
  function play(s, cardId, opt) {
    opt = opt || {};
    const p = s.turn;
    const hand = s.hands[p];
    if (s.phase !== 'play' || s.pending || !hand.includes(cardId)) throw new Error('낼 수 없는 패');
    const rm = id => hand.splice(hand.indexOf(id), 1);

    if (isBonus(cardId)) {
      rm(cardId);
      s.captured[p].push(cardId);
      const stolen = []; // 표준 맞고: 보너스패로는 상대 피를 뺏지 않음
      const drawn = s.deck.length ? s.deck.pop() : null;
      if (drawn !== null) hand.push(drawn);
      s.last = { player: p, played: cardId, flipped: null, taken: [cardId], events: ['bonus'], stolen, drawn };
      return { bonus: true, stolen, drawn };
    }

    const m = month(cardId);
    const F = floorMatches(s, m);
    if (opt.bomb && canBomb(s, cardId)) {
      const three = hand.filter(id => month(id) === m);
      three.forEach(rm);
      s.floor.push(...three);
      s.bomb[p]++;
      s.shook[p].push(m);
      s.dummies[p] += 2; // 폭탄 후 뒤집기만 하는 차례 2번
      s.pending = { card: cardId, cards: three, m, F, pair: null, took: F.slice(), bomb: true };
      return { bomb: true };
    }
    if (canShake(s, cardId)) {
      s.shook[p].push(m);          // 물어본 달은 다시 묻지 않음
      if (opt.shake) s.shake[p]++;
    }
    rm(cardId);
    let pair = null, took = null;
    if (F.length === 1) pair = F[0];
    else if (F.length === 2) pair = F.includes(opt.choice) ? opt.choice : bestCard(F);
    else if (F.length === 3) took = F.slice();
    s.floor.push(cardId);
    s.pending = { card: cardId, cards: [cardId], m, F, pair, took };
    return {};
  }

  // 폭탄패(빈 패): 손패를 내지 않고 뒤집기만
  function playDummy(s) {
    const p = s.turn;
    if (s.phase !== 'play' || s.pending || !s.dummies[p]) throw new Error('폭탄패가 없음');
    s.dummies[p]--;
    s.pending = { card: null, cards: [], m: null, F: [], pair: null, took: null, dummy: true };
  }

  // 다음에 뒤집힐 (보너스패가 아닌) 패
  function peek(s) {
    for (let i = s.deck.length - 1; i >= 0; i--) if (!isBonus(s.deck[i])) return s.deck[i];
    return null;
  }
  // 그 위에 쌓인 보너스패들 (먼저 뒤집혀 나옴)
  function peekBonus(s) {
    const out = [];
    for (let i = s.deck.length - 1; i >= 0 && isBonus(s.deck[i]); i--) out.push(s.deck[i]);
    return out;
  }

  // 뒤집을 패가 바닥의 같은 달 2장 중 하나를 골라야 하면 후보, 아니면 null
  function flipOptions(s) {
    const pd = s.pending;
    const d = peek(s);
    if (!pd || d === null) return null;
    const n = month(d);
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

  const handsLeft = (s, p) => s.hands[p].length + s.dummies[p];

  // 2단계: 더미에서 뒤집고, 가져갈 패를 모두 정리한다
  function flip(s, choice) {
    const p = s.turn, pd = s.pending;
    if (!pd) throw new Error('먼저 패를 내야 함');
    const ev = [], take = [];
    let steal = 0;
    // 보너스패가 먼저 나오면 먹고 한 장 더 뒤집는다
    const bonusGot = [];
    while (s.deck.length && isBonus(s.deck[s.deck.length - 1])) {
      const b = s.deck.pop();
      s.captured[p].push(b);
      bonusGot.push(b);
    }
    if (bonusGot.length) ev.push('bonusFlip');
    const d = s.deck.length ? s.deck.pop() : null;
    const n = d === null ? null : month(d);
    const lastTurn = handsLeft(s, 0) + handsLeft(s, 1) === 0;

    if (!pd.dummy && n === pd.m) {
      if (pd.F.length === 0) { ev.push('jjok'); take.push(pd.card, d); steal++; }
      else if (pd.F.length === 1) { ev.push('ppeok'); s.floor.push(d); s.ppeok[pd.m] = p; }
      else { ev.push('ttadak'); take.push(pd.card, ...pd.F, d); steal++; } // F 2장 (3장이면 같은 달 5장이라 불가능)
    } else {
      if (pd.took) {
        take.push(...pd.cards, ...pd.took);
        if (pd.bomb) { ev.push('bomb'); steal++; }
        steal += ppeokBonus(s, p, pd.m, ev);
      } else if (pd.pair !== null) take.push(pd.card, pd.pair);
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
    if (take.length && s.floor.length === 0 && !lastTurn) { ev.push('sseul'); steal++; }
    if (lastTurn) steal = 0; // 마지막 턴에는 쪽·따닥·싹쓸이·뻑 먹기로 피를 뺏지 않음

    // 첫뻑·연뻑·삼연뻑·첫따닥
    let samyeon = false;
    if (ev.includes('ppeok')) {
      s.ppeokRun[p]++;
      if (s.turnNo[p] === 0) { ev.push('firstPpeok'); s.bonusPts[p] += PTS.firstPpeok; }
      else if (s.ppeokRun[p] === 2) { ev.push('yeonPpeok'); s.bonusPts[p] += PTS.yeonPpeok; }
      if (s.ppeokRun[p] >= 3) { ev.push('samyeonPpeok'); samyeon = true; }
    } else {
      s.ppeokRun[p] = 0;
    }
    if (ev.includes('ttadak') && s.turnNo[p] === 0) { ev.push('firstTtadak'); s.bonusPts[p] += PTS.firstTtadak; }
    s.turnNo[p]++;

    const stolen = stealPi(s, p, steal);
    s.pending = null;
    s.last = { player: p, played: pd.card, cards: pd.cards, flipped: d, bonusGot, taken: take, events: ev, stolen };
    if (samyeon) finish(s, p, { samyeon: true });
    return s.last;
  }

  // 상대 피를 count 장 가져온다 (보통 피부터, 없으면 쌍피·쓰리피)
  function stealPi(s, p, count) {
    const o = 1 - p, got = [];
    for (let k = 0; k < count; k++) {
      const pis = s.captured[o].filter(id => CARDS[id].kind === 'pi').sort((a, b) => CARDS[a].pi - CARDS[b].pi);
      if (!pis.length) break;
      const id = pis[0];
      s.captured[o].splice(s.captured[o].indexOf(id), 1);
      s.captured[p].push(id);
      got.push(id);
    }
    return got;
  }

  // 3단계: 차례 마무리 - 7점 이상 새로 나면 고/스톱, 아니면 다음 차례
  function endTurn(s) {
    if (s.phase === 'over') return s.phase;
    const p = s.turn;
    const sc = bestScore(s.captured[p]).total;
    if (sc >= WIN_SCORE && sc > s.goScore[p]) {
      if (handsLeft(s, p) === 0) { finish(s, p); return s.phase; } // 마지막 패였으면 자동 스톱
      s.phase = 'gostop';
      return s.phase;
    }
    advance(s);
    return s.phase;
  }

  function advance(s) {
    if (handsLeft(s, 0) === 0 && handsLeft(s, 1) === 0) {
      s.phase = 'over';
      s.over = {
        draw: true, winner: null, points: 0, lines: [], bonusPts: s.bonusPts.slice(),
        reason: s.go[0] || s.go[1] ? '고 한 뒤 점수를 더 못 냈어요' : '아무도 7점을 못 냈어요',
      };
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
      s.goScore[p] = bestScore(s.captured[p]).total;
      advance(s);
    } else {
      finish(s, p);
    }
  }

  function finish(s, winner, special) {
    const o = 1 - winner;
    const lines = [];
    let base, goAdd = 0, mult = 1, reason = '';
    if (special && special.chongtong) {
      base = PTS.chongtong; reason = '총통';
      lines.push([`총통 (${special.chongtong}월 4장)`, `${base}점`]);
    } else if (special && special.samyeon) {
      base = PTS.samyeon; reason = '삼연뻑';
      lines.push(['삼연뻑', `${base}점`]);
    } else {
      const ws = bestScore(s.captured[winner]);
      const lPi = score(s.captured[o], true).piCount;      // 진 쪽도 국진을 유리하게 (피박 면하려면 피로)
      const lGwang = score(s.captured[o], false).gwangCount;
      base = ws.total;
      lines.push(['점수', `${ws.total}점`]);
      if (ws.gukjinAsPi) lines.push(['국진', '쌍피로 계산']);
      const k = s.go[winner];
      goAdd = k; // 고 할 때마다 +1점
      if (goAdd) lines.push([`${k}고`, `+${goAdd}점`]);
      if (k >= 3) { mult *= 2 ** (k - 2); lines.push([`${k}고 배수`, `×${2 ** (k - 2)}`]); }
      const sb = s.shake[winner] + s.bomb[winner];
      if (sb) { mult *= 2 ** sb; lines.push([s.bomb[winner] ? '흔들기·폭탄' : '흔들기', `×${2 ** sb}`]); }
      if (ws.piScore > 0 && lPi <= 7) { mult *= 2; lines.push(['피박', '×2']); }
      if (ws.gwangScore > 0 && lGwang === 0) { mult *= 2; lines.push(['광박', '×2']); }
      if (ws.yeolCount >= 7) { mult *= 2; lines.push(['멍따', '×2']); }
      if (s.go[o] > 0) { mult *= 2; lines.push(['고박', '×2']); }
    }
    if ((s.mult || 1) > 1) { mult *= s.mult; lines.push(['나가리 다음 판', `×${s.mult}`]); }
    s.phase = 'over';
    s.over = { draw: false, winner, points: (base + goAdd) * mult, lines, reason, bonusPts: s.bonusPts.slice() };
  }

  // 판이 끝났을 때 나(0) 기준 정산 점수 (보너스 점수 포함)
  function netForPlayer(over) {
    const bp = over.bonusPts || [0, 0];
    const bonus = bp[0] - bp[1];
    if (over.draw) return bonus;
    return (over.winner === 0 ? over.points : -over.points) + bonus;
  }

  // ---------------- 컴퓨터 ----------------
  function cardValue(id) {
    const c = CARDS[id];
    if (c.kind === 'gwang') return c.rain ? 4 : 6;
    if (c.kind === 'yeol') return c.bird ? 4 : c.gukjin ? 3 : 2.5;
    if (c.kind === 'tti') return c.dan ? 3 : 2;
    return c.pi >= 3 ? 3 : c.pi === 2 ? 2.2 : 1;
  }
  function bestCard(ids) { return ids.reduce((b, id) => (cardValue(id) > cardValue(b) ? id : b), ids[0]); }

  // 낼 패 고르기: 보너스패 먼저, 폭탄 가능하면 폭탄, 아니면 바로 가져올 가치가 큰 패.
  // 가져올 게 없으면 폭탄패(뒤집기만)를 쓰거나 가장 덜 아까운 패
  function aiPick(s, rng) {
    rng = rng || Math.random;
    const p = s.turn, hand = s.hands[p];
    const bonus = hand.find(isBonus);
    if (bonus !== undefined) return { card: bonus };
    let best = null, bestV = -Infinity;
    for (const id of hand) {
      const F = floorMatches(s, month(id));
      let v;
      if (canBomb(s, id)) v = 20;
      else if (F.length === 0) v = -cardValue(id) * 0.6;
      else if (F.length === 3) v = cardValue(id) + F.reduce((a, f) => a + cardValue(f), 0) + 2;
      else v = cardValue(id) + Math.max(...F.map(cardValue));
      v += rng() * 0.3;
      if (v > bestV) { bestV = v; best = id; }
    }
    if (bestV < 0 && s.dummies[p] > 0) return { dummy: true };
    const opts = handOptions(s, best);
    return { card: best, choice: opts ? bestCard(opts) : null, shake: true, bomb: canBomb(s, best) };
  }

  // 고/스톱: 패가 넉넉하고 상대 점수가 낮으면 한두 번은 고
  function aiGoStop(s) {
    const p = s.turn, o = 1 - p;
    return handsLeft(s, p) >= 3 && bestScore(s.captured[o]).total <= 3 && s.go[p] < 2;
  }

  const api = {
    CARDS, N_CARDS, GUKJIN, MONTH_NAME, WIN_SCORE, PTS,
    newRound, upgradeState, score, bestScore, handOptions, canBomb, canShake, play, playDummy,
    peek, peekBonus, flipOptions, flip, endTurn, decide, netForPlayer, handsLeft,
    aiPick, aiGoStop, bestCard, cardValue, month, isBonus,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GS = api;
})(typeof window !== 'undefined' ? window : this);
