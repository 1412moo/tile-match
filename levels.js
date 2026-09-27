// 레벨 생성기: 레벨 번호 -> 항상 같은 보드 (시드 고정 난수)
// 브라우저(window.TM_Levels)와 Node(module.exports) 양쪽에서 사용 가능.
(function (root) {
  'use strict';

  // 타일 그림 (시스템 이모지 사용 - 외부 이미지 없음)
  const EMOJIS = ['🍎', '🍌', '🍇', '🍓', '🥕', '🌽', '🍄', '🌸', '🌻', '🍀', '⭐', '🐱',
    '🐶', '🐰', '🐻', '🐸', '🐟', '🦋', '🎈', '🔔', '🍉', '🍒', '🥝', '🐧'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 좌표 단위: 타일 반 칸. 타일 하나는 2x2 단위를 차지한다.
  function overlaps(a, b) {
    return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
  }

  // t 위에 겹친 타일이 list 안에 있으면 가려진 것
  function isCovered(t, list) {
    for (const o of list) {
      if (o !== t && o.z > t.z && overlaps(o, t)) return true;
    }
    return false;
  }

  function levelParams(level) {
    const d = Math.min(level, 45);
    const maxTiles = Math.min(108, 9 + d * 4);
    // 바닥층은 전체의 절반 이하로 두어 위로 여러 층이 쌓이게 한다
    const base = Math.max(9, maxTiles * (d < 4 ? 0.6 : 0.42));
    const cols = Math.max(3, Math.min(7, Math.round(Math.sqrt(base * 0.85))));
    const rows = Math.max(3, Math.min(8, Math.ceil(base / cols)));
    return {
      cols, rows, maxTiles,
      layers: Math.min(8, 2 + Math.floor(d / 3)),
      nTypes: Math.min(10, 3 + Math.floor(d / 3.5)),
      // 동시에 "진행 중"일 수 있는 그림 종류 수 (클수록 어려움, 3이어도 슬롯 7칸 안에서 풀림)
      maxOpen: d < 4 ? 1 : d < 40 ? 2 : 3,
      fill: Math.min(0.95, 0.7 + d * 0.01),
      stack: d >= 15, // 바로 위에 겹쳐 완전히 가리는 층 허용
    };
  }

  // 좌우 대칭 도형. cx, cy 는 -1..1 로 정규화된 타일 중심
  const SHAPES = {
    rect: () => true,
    diamond: (cx, cy) => Math.abs(cx) + Math.abs(cy) <= 1.25,
    ring: (cx, cy) => !(Math.abs(cx) < 0.35 && Math.abs(cy) < 0.3),
    cross: (cx, cy) => Math.abs(cx) < 0.45 || Math.abs(cy) < 0.4,
    cutCorners: (cx, cy) => !(Math.abs(cx) > 0.6 && Math.abs(cy) > 0.6),
    hourglass: (cx, cy) => Math.abs(cx) <= 0.35 + 0.75 * Math.abs(cy),
    arch: (cx, cy) => !(Math.abs(cx) < 0.4 && cy > 0.2),
  };
  const SHAPE_NAMES = Object.keys(SHAPES);

  function buildLayout(p, rng, shapeName) {
    const inShape = SHAPES[shapeName];
    const W = p.cols * 2, H = p.rows * 2;
    const tiles = [];
    let prevOcc = null;
    let prevOff = [0, 0];
    const supported = (x, y) =>
      prevOcc.has(x + ',' + y) && prevOcc.has(x + 1 + ',' + y) &&
      prevOcc.has(x + ',' + (y + 1)) && prevOcc.has(x + 1 + ',' + (y + 1));

    for (let z = 0; z < p.layers; z++) {
      let off = [0, 0];
      if (z > 0) {
        const opts = [[0, 0], [1, 0], [0, 1], [1, 1]]
          .filter(o => p.stack || o[0] !== prevOff[0] || o[1] !== prevOff[1]);
        off = opts[Math.floor(rng() * opts.length)];
      }
      const layer = [];
      for (let y = off[1]; y + 2 <= H; y += 2) {
        for (let x = off[0]; x + 2 <= W; x += 2) {
          const mx = W - 2 - x; // 좌우 대칭 위치
          if (mx < x) continue;
          let ok;
          if (z === 0) {
            ok = inShape((x + 1) / W * 2 - 1, (y + 1) / H * 2 - 1);
          } else {
            ok = supported(x, y) && supported(mx, y) && rng() < p.fill;
          }
          if (!ok) continue;
          layer.push({ x, y, z });
          if (mx !== x) layer.push({ x: mx, y, z });
        }
      }
      if (!layer.length) break;
      tiles.push(...layer);
      prevOcc = new Set();
      for (const t of layer) {
        for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) prevOcc.add(t.x + dx + ',' + (t.y + dy));
      }
      prevOff = off;
    }
    return tiles;
  }

  // 위에서부터 타일을 빼서 개수를 maxTiles 이하, 3의 배수로 맞춘다
  function trim(tiles, maxTiles, rng) {
    while (tiles.length > maxTiles || tiles.length % 3 !== 0) {
      const free = tiles.filter(t => !isCovered(t, tiles));
      const maxZ = Math.max(...free.map(t => t.z));
      const top = free.filter(t => t.z === maxZ);
      tiles.splice(tiles.indexOf(top[Math.floor(rng() * top.length)]), 1);
    }
  }

  // 풀 수 있는 순서를 먼저 만들고, 그 순서대로 3개씩 같은 그림을 배정한다.
  // maxOpen 개의 그룹까지 동시에 진행되도록 섞으므로 슬롯에는 최대 2*maxOpen+1 개만 쌓인다(<=7).
  function assignTypes(tiles, rng, types, maxOpen) {
    const remaining = tiles.slice();
    const order = [];
    while (remaining.length) {
      const free = remaining.filter(t => !isCovered(t, remaining));
      const pick = free[Math.floor(rng() * free.length)];
      remaining.splice(remaining.indexOf(pick), 1);
      order.push(pick);
    }

    let pool = [];
    const nextType = () => {
      if (!pool.length) pool = shuffle(types.slice(), rng);
      return pool.pop();
    };

    const open = [];
    for (let i = 0; i < order.length; i++) {
      const left = order.length - i;
      const need = open.reduce((s, g) => s + 3 - g.n, 0);
      const canOpen = open.length < maxOpen && left >= need + 3;
      let g;
      if (open.length === 0 || (canOpen && rng() < 0.5)) {
        g = { type: nextType(), n: 0 };
        open.push(g);
      } else {
        g = open[Math.floor(rng() * open.length)];
      }
      order[i].type = g.type;
      if (++g.n === 3) open.splice(open.indexOf(g), 1);
    }
  }

  // 레벨별 목표 난이도: 단순한 전략으로 이길 확률 (부스터 없이). 1~5레벨은 거의 100%, 30레벨 이후 약 35%
  function targetWinRate(level) {
    return Math.max(0.35, Math.min(1, 1 - (level - 5) * 0.022));
  }

  // 사람처럼 두는 단순 전략으로 n번 플레이해 본 승률
  function simulateWinRate(tiles, rng, n) {
    const above = tiles.map(t => tiles.filter(o => o.z > t.z && overlaps(o, t)).map(o => o.id));
    let wins = 0;
    for (let g = 0; g < n; g++) {
      const state = tiles.map(() => 0); // 0 보드, 1 슬롯, 2 제거
      const slot = [];
      let left = tiles.length, lost = false;
      while (left > 0) {
        const cnt = {}, fc = {};
        slot.forEach(i => { cnt[tiles[i].type] = (cnt[tiles[i].type] || 0) + 1; });
        const free = [];
        for (const t of tiles) {
          if (state[t.id] === 0 && above[t.id].every(a => state[a] !== 0)) {
            free.push(t); fc[t.type] = (fc[t.type] || 0) + 1;
          }
        }
        let pick = null, best = -1;
        for (const t of free) {
          const c = cnt[t.type] || 0, f = fc[t.type];
          const sc = c + f >= 3 ? 100 + c * 10 : c ? 50 + c : f * 5 + rng() * 4;
          if (sc > best) { best = sc; pick = t; }
        }
        state[pick.id] = 1; slot.push(pick.id); left--;
        const same = slot.filter(i => tiles[i].type === pick.type);
        if (same.length === 3) {
          same.forEach(i => { state[i] = 2; slot.splice(slot.indexOf(i), 1); });
        } else if (slot.length >= 7) { lost = true; break; }
      }
      if (!lost) wins++;
    }
    return wins / n;
  }

  function generateLevel(level) {
    const rng = mulberry32(level * 9973 + 12345);
    const p = levelParams(level);
    const shapeName = level <= 2 ? 'rect' : SHAPE_NAMES[Math.floor(rng() * SHAPE_NAMES.length)];
    const types = shuffle(EMOJIS.map((_, i) => i), rng).slice(0, p.nTypes);
    const target = targetWinRate(level);
    let best = null, bestDiff = Infinity;

    // 배치를 만들고, 그림 배정을 여러 번 해 본 뒤 모의 플레이 승률이 목표 난이도에 가장 가까운 것을 고른다.
    // 어떤 배정으로도 목표에 못 미치면 배치 자체를 새로 만든다.
    for (let layoutTry = 0; layoutTry < 4 && bestDiff > 0.12; layoutTry++) {
      let tiles = [], score = -1;
      for (let attempt = 0; attempt < 12; attempt++) {
        const cand = buildLayout(p, rng, attempt < 8 ? shapeName : 'rect');
        trim(cand, p.maxTiles, rng);
        const sc = cand.length * 10 + new Set(cand.map(t => t.z)).size;
        if (sc > score) { score = sc; tiles = cand; }
      }
      tiles.forEach((t, i) => { t.id = i; });
      for (let k = 0; k < 12; k++) {
        // 목표보다 계속 어려우면 뒤쪽 시도에서는 그룹을 덜 섞어서 쉽게 만든다
        const open = k < 4 ? p.maxOpen : k < 8 ? Math.max(1, p.maxOpen - 1) : 1;
        assignTypes(tiles, rng, types, open);
        const diff = Math.abs(simulateWinRate(tiles, rng, 30) - target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = tiles.map(t => ({ x: t.x, y: t.y, z: t.z, type: t.type }));
        }
        if (diff <= 0.08) break;
      }
    }

    // 그리기 순서(아래층 먼저)로 정렬 후 id 부여
    best.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
    best.forEach((t, i) => { t.id = i; t.state = 'board'; });
    return best;
  }

  // 섞기: 보드에 남은 타일의 그림을 다시 배정하되, 반드시 풀 수 있는 배치만 만든다.
  // boardTiles: 보드에 남은 타일들 {x,y,z,type}, slotTypes: 슬롯에 있는 그림들
  // 각 그림의 개수는 그대로 유지한다. 성공하면 boardTiles 순서대로 새 그림 배열, 불가능하면 null.
  function solvableShuffle(boardTiles, slotTypes, maxOpen, rng, slotSize) {
    rng = rng || Math.random;
    slotSize = slotSize || 7;
    const above = boardTiles.map(t => boardTiles.filter(o => o.z > t.z && overlaps(o, t)));
    const idx = new Map(boardTiles.map((t, i) => [t, i]));

    for (let attempt = 0; attempt < 400; attempt++) {
      const pool = {};
      boardTiles.forEach(t => { pool[t.type] = (pool[t.type] || 0) + 1; });
      const inSlot = {};
      slotTypes.forEach(ty => { inSlot[ty] = (inSlot[ty] || 0) + 1; });
      // 슬롯에 이미 있는 그림은 진행 중인 그룹
      const open = [];
      for (const ty in inSlot) {
        open.push({ type: +ty, n: inSlot[ty] });
        pool[ty] -= 3 - inSlot[ty];
      }
      const fresh = []; // 새로 시작할 수 있는 그룹 (그림 종류별 3개 묶음)
      for (const ty in pool) for (let k = 0; k < pool[ty] / 3; k++) fresh.push(+ty);
      shuffle(fresh, rng);

      let slotCount = slotTypes.length;
      const limit = Math.max(maxOpen, open.length);
      const removed = new Array(boardTiles.length).fill(false);
      const result = new Array(boardTiles.length);
      let ok = true;

      for (let step = 0; step < boardTiles.length; step++) {
        const free = [];
        boardTiles.forEach((t, i) => {
          if (!removed[i] && above[i].every(o => removed[idx.get(o)])) free.push(i);
        });
        const i = free[Math.floor(rng() * free.length)];
        const completing = open.filter(g => g.n === 2);
        let g = null;
        if (slotCount >= slotSize - 1) {
          // 슬롯이 한 칸 남았으면 반드시 3개를 완성해야 한다
          if (!completing.length) { ok = false; break; }
          g = completing[Math.floor(rng() * completing.length)];
        } else {
          const canOpen = fresh.length > 0 && open.length < limit;
          if (!open.length || (canOpen && rng() < 0.5)) {
            if (!fresh.length) { ok = false; break; }
            g = { type: fresh.pop(), n: 0 };
            open.push(g);
          } else {
            g = open[Math.floor(rng() * open.length)];
          }
        }
        result[i] = g.type;
        removed[i] = true;
        g.n++;
        if (g.n === 3) { open.splice(open.indexOf(g), 1); slotCount -= 2; } else slotCount++;
      }
      if (ok && open.length === 0) return result;
    }
    return null;
  }

  const api = { EMOJIS, generateLevel, levelParams, isCovered, overlaps, targetWinRate, solvableShuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TM_Levels = api;
})(typeof window !== 'undefined' ? window : this);
