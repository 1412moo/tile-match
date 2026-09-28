// 보석 맞추기 (매치-3) 규칙 엔진 - 화면과 분리 (Node 테스트에서도 사용)
// 8×8 판, 보석 6종. 가로/세로로 같은 보석 3개 이상 → 사라짐 → 위에서 내려옴 → 연쇄.
// 특수 보석: 4개 한 줄 → 줄 지우기(가로/세로), 가로·세로가 만나는 모양(ㄱ·ㅗ) → 폭탄(3×3),
//           5개 한 줄 → 무지개(바꾼 보석과 같은 색을 모두 지움).
// 모든 함수는 난수 함수 rng 를 받아 같은 rng 면 같은 결과가 난다.
(function (root) {
  'use strict';

  const N = 8;          // 판 크기
  const COLORS = 6;     // 보석 종류
  const MOVES = 20;     // 한 판에 움직일 수 있는 횟수
  const CELL_PTS = 10;  // 보석 1개 점수 (연쇄 단계만큼 곱함)
  const SPECIAL_PTS = { row: 60, col: 60, bomb: 90, rainbow: 150 }; // 특수 보석을 만들면 보너스

  // 칸: { id, c: 색(0~5, 무지개는 -1), s: null | 'row' | 'col' | 'bomb' | 'rainbow' }
  function cell(st, c, s) { return { id: st.seq++, c, s: s || null }; }
  const colorOf = x => (x && x.s !== 'rainbow' ? x.c : -1);
  const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const key = (r, c) => r * N + c;

  // ---------- 판 만들기 ----------
  // 처음부터 3개가 맞아 있지 않고, 움직일 수 있는 수가 하나 이상 있는 판
  function freshBoard(st, rng) {
    for (let tries = 0; tries < 200; tries++) {
      const b = [];
      for (let r = 0; r < N; r++) {
        b.push([]);
        for (let c = 0; c < N; c++) {
          let col;
          do col = Math.floor(rng() * COLORS);
          while ((c >= 2 && b[r][c - 1].c === col && b[r][c - 2].c === col) ||
                 (r >= 2 && b[r - 1][c].c === col && b[r - 2][c].c === col));
          b[r].push(cell(st, col));
        }
      }
      if (findMove(b)) return b;
    }
    throw new Error('판을 만들지 못함');
  }

  function createGame(rng) {
    const st = { v: 1, seq: 1, board: null, score: 0, moves: MOVES, over: false, bestCombo: 0 };
    st.board = freshBoard(st, rng);
    return st;
  }

  // ---------- 맞춤 찾기 ----------
  // 가로/세로로 같은 색 3개 이상인 줄 목록: { dir: 'h'|'v', cells: [[r,c],...] }
  function findRuns(b) {
    const runs = [];
    for (let r = 0; r < N; r++) {
      let c = 0;
      while (c < N) {
        const col = colorOf(b[r][c]);
        let e = c + 1;
        if (col >= 0) while (e < N && colorOf(b[r][e]) === col) e++;
        if (col >= 0 && e - c >= 3) runs.push({ dir: 'h', cells: Array.from({ length: e - c }, (_, i) => [r, c + i]) });
        c = e;
      }
    }
    for (let c = 0; c < N; c++) {
      let r = 0;
      while (r < N) {
        const col = colorOf(b[r][c]);
        let e = r + 1;
        if (col >= 0) while (e < N && colorOf(b[e][c]) === col) e++;
        if (col >= 0 && e - r >= 3) runs.push({ dir: 'v', cells: Array.from({ length: e - r }, (_, i) => [r + i, c]) });
        r = e;
      }
    }
    return runs;
  }

  // 서로 칸을 나눠 가진 줄끼리 한 묶음으로 (ㄱ·ㅗ·十 모양)
  function groupRuns(runs) {
    const parent = runs.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const owner = new Map();
    runs.forEach((run, i) => run.cells.forEach(([r, c]) => {
      const k = key(r, c);
      if (owner.has(k)) parent[find(i)] = find(owner.get(k)); else owner.set(k, i);
    }));
    const groups = new Map();
    runs.forEach((run, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(run); });
    return [...groups.values()];
  }

  // 묶음에서 만들어질 특수 보석과 그 자리. prefer: 방금 바꾼 두 칸 (거기에 우선 만든다)
  function specialFor(group, prefer) {
    const maxLen = Math.max(...group.map(r => r.cells.length));
    const hasH = group.some(r => r.dir === 'h'), hasV = group.some(r => r.dir === 'v');
    let s = null, cand;
    const longest = group.find(r => r.cells.length === maxLen);
    if (maxLen >= 5) { s = 'rainbow'; cand = longest.cells; }
    else if (hasH && hasV) {
      s = 'bomb';
      const hk = new Set(group.filter(r => r.dir === 'h').flatMap(r => r.cells.map(([a, b]) => key(a, b))));
      cand = group.filter(r => r.dir === 'v').flatMap(r => r.cells).filter(([a, b]) => hk.has(key(a, b)));
    } else if (maxLen === 4) { s = longest.dir === 'h' ? 'row' : 'col'; cand = longest.cells; }
    if (!s) return null;
    const pick = cand.find(([r, c]) => prefer && prefer.some(p => p[0] === r && p[1] === c)) || cand[Math.floor((cand.length - 1) / 2)];
    return { s, r: pick[0], c: pick[1] };
  }

  // 가장 많은 색 (무지개가 다른 특수 보석에 맞았을 때 지울 색)
  function commonColor(b) {
    const cnt = new Array(COLORS).fill(0);
    b.forEach(row => row.forEach(x => { if (colorOf(x) >= 0) cnt[x.c]++; }));
    return cnt.indexOf(Math.max(...cnt));
  }

  // 지울 칸 집합에 들어간 특수 보석을 터뜨려 범위를 넓힌다 (특수 보석끼리 연쇄)
  function expand(b, clear, triggered) {
    const queue = [...clear];
    const fired = new Set();
    while (queue.length) {
      const k = queue.shift();
      const r = Math.floor(k / N), c = k % N, x = b[r][c];
      if (!x || !x.s || fired.has(k)) continue;
      fired.add(k);
      triggered.push({ r, c, s: x.s, color: x.c });
      let area = [];
      if (x.s === 'row') for (let i = 0; i < N; i++) area.push([r, i]);
      else if (x.s === 'col') for (let i = 0; i < N; i++) area.push([i, c]);
      else if (x.s === 'bomb') for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) area.push([r + dr, c + dc]);
      else if (x.s === 'rainbow') { const col = x.hit != null ? x.hit : commonColor(b); b.forEach((row, rr) => row.forEach((y, cc) => { if (colorOf(y) === col) area.push([rr, cc]); })); }
      for (const [rr, cc] of area) {
        if (!inside(rr, cc) || !b[rr][cc]) continue;
        const kk = key(rr, cc);
        if (!clear.has(kk)) { clear.add(kk); queue.push(kk); }
      }
    }
  }

  // 한 번 지우기: clear(칸 번호 집합)를 지우고 made(새 특수 보석)를 놓는다. 한 단계 기록을 돌려준다
  function applyClear(st, clear, made, combo) {
    const b = st.board;
    const triggered = [];
    expand(b, clear, triggered);
    const cleared = [];
    for (const k of clear) {
      const r = Math.floor(k / N), c = k % N;
      if (b[r][c]) cleared.push({ id: b[r][c].id, r, c, color: b[r][c].c, s: b[r][c].s });
      b[r][c] = null;
    }
    const specials = [];
    for (const m of made) {
      const x = cell(st, m.s === 'rainbow' ? -1 : m.color, m.s);
      b[m.r][m.c] = x;
      specials.push({ id: x.id, r: m.r, c: m.c, color: x.c, s: x.s });
    }
    const points = cleared.length * CELL_PTS * combo + made.reduce((a, m) => a + SPECIAL_PTS[m.s], 0);
    st.score += points;
    st.bestCombo = Math.max(st.bestCombo, combo);
    return { kind: 'clear', cleared, specials, triggered, combo, points };
  }

  // 빈 칸 채우기: 위에 있던 보석이 내려오고, 모자란 만큼 위에서 새 보석
  function gravity(st, rng) {
    const b = st.board, moves = [], spawns = [];
    for (let c = 0; c < N; c++) {
      let w = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        if (!b[r][c]) continue;
        if (r !== w) { b[w][c] = b[r][c]; b[r][c] = null; moves.push({ id: b[w][c].id, c, fromR: r, r: w }); }
        w--;
      }
      const k = w + 1; // 새로 채울 칸 수 (0 ~ w)
      for (let r = w; r >= 0; r--) {
        const x = cell(st, Math.floor(rng() * COLORS));
        b[r][c] = x;
        spawns.push({ id: x.id, c, r, fromR: r - k, color: x.c });
      }
    }
    return { kind: 'fall', moves, spawns };
  }

  // 맞춤이 없어질 때까지: 지우기 → 채우기 → (연쇄) ...  prefer 는 첫 단계에서만
  function cascade(st, rng, steps, prefer, startCombo) {
    let combo = startCombo || 1;
    for (let guard = 0; guard < 100; guard++) {
      const runs = findRuns(st.board);
      if (!runs.length) break;
      const clear = new Set();
      const made = [];
      for (const g of groupRuns(runs)) {
        g.forEach(run => run.cells.forEach(([r, c]) => clear.add(key(r, c))));
        const sp = specialFor(g, combo === 1 ? prefer : null);
        if (sp) {
          made.push(Object.assign(sp, { color: st.board[g[0].cells[0][0]][g[0].cells[0][1]].c }));
        }
      }
      // 특수 보석이 놓일 자리의 원래 보석은 지워지되 그 자리엔 새 특수 보석이 남는다
      steps.push(applyClear(st, clear, made, combo));
      steps.push(gravity(st, rng));
      combo++;
    }
  }

  const adjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

  // 두 칸 바꾸기. 맞춤이 생기지 않으면 되돌리고 { ok:false }.
  // 성공하면 { ok:true, steps: [...] } (지우기/채우기/섞기 단계 기록)
  function play(st, a, bb, rng) {
    if (st.over || !inside(a.r, a.c) || !inside(bb.r, bb.c) || !adjacent(a, bb)) return { ok: false };
    const b = st.board;
    const A = b[a.r][a.c], B = b[bb.r][bb.c];
    if (!A || !B) return { ok: false };
    b[a.r][a.c] = B; b[bb.r][bb.c] = A;
    const steps = [];
    if (A.s === 'rainbow' || B.s === 'rainbow') {
      // 무지개: 바꾼 상대와 같은 색을 모두 지움 (무지개끼리면 판 전체)
      const clear = new Set();
      const rb = A.s === 'rainbow' ? { x: A, at: bb } : { x: B, at: a };
      const other = rb.x === A ? B : A;
      if (other.s === 'rainbow') b.forEach((row, r) => row.forEach((_, c) => clear.add(key(r, c))));
      else {
        rb.x.hit = other.c;
        clear.add(key(rb.at.r, rb.at.c));
        b.forEach((row, r) => row.forEach((y, c) => { if (colorOf(y) === other.c) clear.add(key(r, c)); }));
      }
      steps.push(applyClear(st, clear, [], 1));
      steps.push(gravity(st, rng));
      cascade(st, rng, steps, null, 2);
    } else {
      if (!findRuns(b).length) { b[a.r][a.c] = A; b[bb.r][bb.c] = B; return { ok: false }; }
      cascade(st, rng, steps, [[a.r, a.c], [bb.r, bb.c]]);
    }
    st.moves--;
    if (!findMove(st.board)) steps.push(shuffle(st, rng));
    if (st.moves <= 0) st.over = true;
    return { ok: true, steps };
  }

  // 움직일 수 있는 수 하나 (없으면 null): 바꿨을 때 3개가 맞거나 무지개를 쓰는 수
  function findMove(b) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (!inside(r2, c2) || !b[r][c] || !b[r2][c2]) continue;
        if (b[r][c].s === 'rainbow' || b[r2][c2].s === 'rainbow') return [{ r, c }, { r: r2, c: c2 }];
        const t = b[r][c]; b[r][c] = b[r2][c2]; b[r2][c2] = t;
        const ok = findRuns(b).length > 0;
        b[r2][c2] = b[r][c]; b[r][c] = t;
        if (ok) return [{ r, c }, { r: r2, c: c2 }];
      }
    }
    return null;
  }

  // 더 움직일 수 없을 때: 보석 자리를 섞는다 (특수 보석 포함 그대로, 맞춤 없고 움직일 수 있게)
  function shuffle(st, rng) {
    const b = st.board;
    const all = b.flat();
    for (let tries = 0; tries < 300; tries++) {
      for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) b[r][c] = all[r * N + c];
      if (!findRuns(b).length && findMove(b)) {
        return { kind: 'shuffle', cells: all.map((x, i) => ({ id: x.id, r: Math.floor(i / N), c: i % N })) };
      }
    }
    st.board = freshBoard(st, rng); // 섞어도 안 되면 새 판 (드묾)
    return { kind: 'shuffle', fresh: true, cells: st.board.flat().map((x, i) => ({ id: x.id, r: Math.floor(i / N), c: i % N, color: x.c, s: x.s })) };
  }

  // 저장본에서 이어하기 (망가진 저장은 새 판)
  function restore(saved, rng) {
    try {
      const ok = saved && Array.isArray(saved.board) && saved.board.length === N &&
        saved.board.every(row => Array.isArray(row) && row.length === N && row.every(x => x && Number.isInteger(x.id) && x.c >= -1 && x.c < COLORS));
      if (!ok) return createGame(rng);
      const st = JSON.parse(JSON.stringify(saved));
      st.seq = Math.max(st.seq | 0, ...st.board.flat().map(x => x.id + 1));
      st.moves = Math.max(0, Math.min(MOVES, st.moves | 0));
      st.score = Math.max(0, st.score | 0);
      if (findRuns(st.board).length || !findMove(st.board)) shuffle(st, rng);
      return st;
    } catch (e) { return createGame(rng); }
  }

  const api = { N, COLORS, MOVES, CELL_PTS, SPECIAL_PTS, createGame, findRuns, findMove, play, shuffle, restore, adjacent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.M3 = api;
})(typeof window !== 'undefined' ? window : this);
