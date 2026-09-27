// 수박게임 규칙 (화면과 분리 - Node 테스트에서도 사용)
// 과일 11종, 떨어뜨리기, 합체 점수, 위험선 3초 유예 게임오버, 저장/불러오기.
(function (root) {
  'use strict';
  const P = root.WMPhysics;

  // 세계 크기 (단위). 위쪽 TOP 만큼은 과일을 들고 있는 곳, 그 아래가 상자.
  const WW = 300, TOP = 70, BOX_H = 430, WH = TOP + BOX_H;
  const HOLD_Y = 34;              // 들고 있는 과일 높이
  const DANGER_Y = TOP + 8;       // 위험선: 과일 윗부분이 이 선보다 위에 있으면 위험
  const DANGER_TIME = 3;          // 위험선 위에 이만큼(초) 계속 머물면 게임 끝
  const SETTLE_AGE = 1.2;         // 방금 떨어뜨린/합쳐진 과일은 이 시간(초) 동안 위험 판정에서 뺌
  const COOLDOWN = 0.5;           // 다음 과일을 떨어뜨릴 수 있을 때까지 (초)
  const DT = 1 / 60;

  // 과일 11종 (작은 것 → 큰 것). score: 이 과일이 합체로 만들어질 때 얻는 점수
  const FRUITS = [
    { id: 'cherry',     name: '체리',     r: 12 },
    { id: 'strawberry', name: '딸기',     r: 16 },
    { id: 'grape',      name: '포도',     r: 21 },
    { id: 'tangerine',  name: '귤',       r: 26 },
    { id: 'persimmon',  name: '감',       r: 32 },
    { id: 'apple',      name: '사과',     r: 38 },
    { id: 'pear',       name: '배',       r: 44 },
    { id: 'peach',      name: '복숭아',   r: 50 },
    { id: 'pineapple',  name: '파인애플', r: 57 },
    { id: 'melon',      name: '멜론',     r: 64 },
    { id: 'watermelon', name: '수박',     r: 72 },
  ];
  FRUITS.forEach((f, t) => { f.score = t * (t + 1) / 2; }); // 딸기 1, 포도 3, … 수박 55
  const WATERMELON = FRUITS.length - 1;
  const BURST_SCORE = 100;        // 수박 두 개가 만나 터질 때
  // 떨어뜨리는 과일: 작은 5종 (작은 것이 조금 더 자주)
  const DROP_WEIGHTS = [30, 26, 22, 14, 8];

  function randDrop(rng) {
    let x = rng() * DROP_WEIGHTS.reduce((a, b) => a + b, 0);
    for (let t = 0; t < DROP_WEIGHTS.length; t++) { x -= DROP_WEIGHTS[t]; if (x < 0) return t; }
    return 0;
  }

  function newWorld() {
    return P.createWorld({ w: WW, h: WH, radii: FRUITS.map(f => f.r) });
  }

  // 새 판 또는 저장된 판(saved)으로 게임 상태 만들기
  function createGame(rng, saved) {
    const G = { rng, world: newWorld(), score: 0, held: 0, next: 0, cool: 0, dangerT: 0, over: false,
      watermelons: 0, drops: 0 };
    if (saved && Array.isArray(saved.bodies)) {
      G.score = saved.score | 0;
      G.held = clampType(saved.held, DROP_WEIGHTS.length - 1);
      G.next = clampType(saved.next, DROP_WEIGHTS.length - 1);
      G.dangerT = Math.min(Math.max(+saved.dangerT || 0, 0), DANGER_TIME - 0.5);
      G.watermelons = saved.watermelons | 0;
      G.drops = saved.drops | 0;
      for (const b of saved.bodies) {
        const [t, x, y, vx, vy, a] = b;
        const type = clampType(t, WATERMELON);
        const r = FRUITS[type].r;
        if (![x, y].every(Number.isFinite)) continue;
        const nb = P.addBody(G.world, type, Math.min(Math.max(x, r), WW - r), Math.min(y, WH - r), +vx || 0, +vy || 0);
        nb.angle = +a || 0;
        nb.born = -SETTLE_AGE - 1; // 이미 자리 잡은 과일
      }
    } else {
      G.held = randDrop(rng);
      G.next = randDrop(rng);
    }
    return G;
  }
  const clampType = (t, max) => Math.min(Math.max(t | 0, 0), max);

  function serialize(G) {
    const h = DT / G.world.substeps;
    const r3 = v => Math.round(v * 1000) / 1000;
    return {
      v: 1, score: G.score, held: G.held, next: G.next, dangerT: r3(G.dangerT), watermelons: G.watermelons, drops: G.drops,
      bodies: G.world.bodies.map(b => [b.type, r3(b.x), r3(b.y), r3((b.x - b.px) / h), r3((b.y - b.py) / h), r3(b.angle)]),
    };
  }

  const aimClamp = (t, x) => Math.max(FRUITS[t].r + 1, Math.min(WW - FRUITS[t].r - 1, x));
  const canDrop = G => !G.over && G.cool <= 0;

  // 들고 있는 과일을 x 에 떨어뜨림
  function drop(G, x) {
    if (!canDrop(G)) return false;
    P.addBody(G.world, G.held, aimClamp(G.held, x), HOLD_Y);
    G.held = G.next;
    G.next = randDrop(G.rng);
    G.cool = COOLDOWN;
    G.drops++;
    return true;
  }

  // 위험선 위에 걸친 과일이 있나 (막 떨어진/합쳐진 과일은 빼고)
  function overLine(G) {
    const t = G.world.time;
    return G.world.bodies.some(b => b.y - b.r < DANGER_Y && t - b.born > SETTLE_AGE);
  }

  // 한 프레임(1/60초) 진행. 일어난 일 목록을 돌려준다.
  function update(G) {
    if (G.over) return [];
    const out = [];
    for (const e of P.step(G.world, DT)) {
      if (e.kind === 'merge') {
        const pts = FRUITS[e.type].score;
        G.score += pts;
        out.push({ kind: 'merge', type: e.type, x: e.x, y: e.y, points: pts });
        if (e.type === WATERMELON) { G.watermelons++; out.push({ kind: 'watermelon', x: e.x, y: e.y }); }
      } else if (e.kind === 'burst') {
        G.score += BURST_SCORE;
        out.push({ kind: 'burst', type: e.type, x: e.x, y: e.y, points: BURST_SCORE });
      }
    }
    G.cool = Math.max(0, G.cool - DT);
    if (overLine(G)) {
      if (G.dangerT === 0) out.push({ kind: 'danger' });
      G.dangerT += DT;
      if (G.dangerT >= DANGER_TIME) { G.over = true; out.push({ kind: 'over', score: G.score }); }
    } else if (G.dangerT > 0) {
      G.dangerT = 0;
      out.push({ kind: 'safe' });
    }
    return out;
  }

  root.WMCore = {
    WW, TOP, BOX_H, WH, HOLD_Y, DANGER_Y, DANGER_TIME, SETTLE_AGE, COOLDOWN, DT,
    FRUITS, WATERMELON, BURST_SCORE, DROP_WEIGHTS,
    createGame, serialize, drop, update, canDrop, aimClamp, overLine, randDrop,
  };
})(typeof window !== 'undefined' ? window : globalThis);
