// 보석 맞추기 (매치-3) 규칙 엔진 - 화면과 분리 (Node 테스트에서도 사용)
// 8×8 판, 보석 6종. 가로/세로로 같은 보석 3개 이상 → 사라짐 → 위에서 내려옴 → 연쇄.
// 특수 보석: 4개 한 줄 → 줄 보석, 가로·세로가 만나는 모양(ㄱ·ㅗ) → 폭탄(3×3), 5개 한 줄 → 무지개.
//   줄 보석 방향 (Candy Crush 계열 관행): 내가 밀어서 만들면 민 방향(가로로 밀면 가로 줄),
//   연쇄로 저절로 생기면 맞춘 줄과 엇갈린 방향(가로 4개 → 세로 줄, 세로 4개 → 가로 줄).
// 특수 보석 쓰기: 옆 보석과 바꾸기만 해도(맞춤이 없어도) 옮겨 간 자리에서 터짐,
//   특수 보석끼리 바꾸면 조합(십자·3줄 십자·5×5·무지개 변신·판 전체), activate() 로 제자리에서 바로 터뜨리기.
// 스테이지: createGame(rng, { moves, colors, goals }) 로 목표를 주면 목표를 모두 채우는 순간 클리어(result 'win')
//   그리고 바로 엔드 보너스: 판에 남은 특수 보석을 터뜨리고, 남은 횟수만큼 일반 보석을 줄 보석으로 바꿔 모두 터뜨림.
//   횟수를 다 쓰도록 못 채우면 실패('lose'). 옵션이 없으면 v0.1 처럼 20번 움직이면 끝.
// 모든 함수는 난수 함수 rng 를 받아 같은 rng 면 같은 결과가 난다.
(function (root) {
  'use strict';

  const N = 8;          // 판 크기
  const COLORS = 6;     // 보석 종류
  const MOVES = 20;     // 한 판에 움직일 수 있는 횟수
  const CELL_PTS = 10;  // 보석 1개 점수 (연쇄 단계만큼 곱함)
  const SPECIAL_PTS = { row: 60, col: 60, bomb: 90, rainbow: 150 }; // 특수 보석을 만들면 보너스
  // 특수 보석끼리 바꾼 조합 보너스 (지운 칸 점수와 따로)
  const COMBO_PTS = { cross: 300, cross3: 450, bomb5: 500, rbline: 600, rbbomb: 600, rbrb: 0 };
  const BONUS_PTS = 200; // 엔드 보너스로 생긴 줄 보석이 터질 때마다 (남은 횟수 1번의 가치)

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
          do col = Math.floor(rng() * st.colors);
          while ((c >= 2 && b[r][c - 1].c === col && b[r][c - 2].c === col) ||
                 (r >= 2 && b[r - 1][c].c === col && b[r - 2][c].c === col));
          b[r].push(cell(st, col));
        }
      }
      if (findMove(b)) return b;
    }
    throw new Error('판을 만들지 못함');
  }

  // opts: { moves, colors(보석 종류 수, 3~6), goals: [{ type:'score', target } | { type:'color', color, count } | { type:'special', count }] }
  function createGame(rng, opts) {
    opts = opts || {};
    const st = { v: 1, seq: 1, board: null, score: 0, moves: opts.moves || MOVES, over: false, bestCombo: 0,
      colors: Math.min(COLORS, Math.max(3, opts.colors || COLORS)),
      goals: opts.goals ? JSON.parse(JSON.stringify(opts.goals)) : null, result: null, goalMet: false,
      cleared: new Array(COLORS).fill(0), made: 0 }; // 지금까지 지운 색별 보석 수, 만든 특수 보석 수
    st.board = freshBoard(st, rng);
    return st;
  }

  // 목표별 진행도: [{ ...목표, have, need, done }]
  function goalProgress(st) {
    return (st.goals || []).map(g => {
      const have = g.type === 'score' ? st.score : g.type === 'color' ? st.cleared[g.color] : st.made;
      const need = g.type === 'score' ? g.target : g.count;
      return Object.assign({}, g, { have: Math.min(have, need), need, done: have >= need });
    });
  }
  const goalsDone = st => !!(st.goals && st.goals.length) && goalProgress(st).every(g => g.done);

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
  // dir: 내가 민 방향 ('h' | 'v', 첫 단계에서만). 없으면 연쇄 규칙 (맞춘 줄과 엇갈린 방향)
  function specialFor(group, prefer, dir) {
    const maxLen = Math.max(...group.map(r => r.cells.length));
    const hasH = group.some(r => r.dir === 'h'), hasV = group.some(r => r.dir === 'v');
    let s = null, cand;
    const longest = group.find(r => r.cells.length === maxLen);
    if (maxLen >= 5) { s = 'rainbow'; cand = longest.cells; }
    else if (hasH && hasV) {
      s = 'bomb';
      const hk = new Set(group.filter(r => r.dir === 'h').flatMap(r => r.cells.map(([a, b]) => key(a, b))));
      cand = group.filter(r => r.dir === 'v').flatMap(r => r.cells).filter(([a, b]) => hk.has(key(a, b)));
    } else if (maxLen === 4) { cand = longest.cells; s = dir ? (dir === 'h' ? 'row' : 'col') : (longest.dir === 'h' ? 'col' : 'row'); }
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
  // used: 이미 조합으로 쓰여 따로 터지지 않을 칸 번호
  function expand(b, clear, triggered, used) {
    const queue = [...clear];
    const fired = new Set(used || []);
    while (queue.length) {
      const k = queue.shift();
      const r = Math.floor(k / N), c = k % N, x = b[r][c];
      if (!x || !x.s || fired.has(k)) continue;
      fired.add(k);
      triggered.push({ r, c, s: x.s, color: x.c, bonus: !!x.bonus });
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
  // ex: { used: 따로 안 터질 칸, bonus: 조합 보너스, fx: 조합/발동 표시 { type, r, c, s } }
  function applyClear(st, clear, made, combo, ex) {
    ex = ex || {};
    const b = st.board;
    const triggered = [];
    expand(b, clear, triggered, ex.used);
    const cleared = [];
    for (const k of clear) {
      const r = Math.floor(k / N), c = k % N;
      if (b[r][c]) {
        cleared.push({ id: b[r][c].id, r, c, color: b[r][c].c, s: b[r][c].s });
        if (st.cleared && b[r][c].c >= 0) st.cleared[b[r][c].c]++;
      }
      b[r][c] = null;
    }
    const specials = [];
    for (const m of made) {
      const x = cell(st, m.s === 'rainbow' ? -1 : m.color, m.s);
      b[m.r][m.c] = x;
      specials.push({ id: x.id, r: m.r, c: m.c, color: x.c, s: x.s });
      st.made = (st.made || 0) + 1;
    }
    const bonus = (ex.bonus || 0) + triggered.filter(t => t.bonus).length * BONUS_PTS;
    const points = cleared.length * CELL_PTS * combo + made.reduce((a, m) => a + SPECIAL_PTS[m.s], 0) + bonus;
    st.score += points;
    st.bestCombo = Math.max(st.bestCombo, combo);
    return { kind: 'clear', cleared, specials, triggered, combo, points, bonus, fx: ex.fx || null };
  }

  // 지금 판의 맞춤으로 지울 칸과 새로 생길 특수 보석 (prefer: 그 자리에 우선 만듦)
  function matchClear(st, prefer, dir) {
    const clear = new Set(), made = [];
    for (const g of groupRuns(findRuns(st.board))) {
      g.forEach(run => run.cells.forEach(([r, c]) => clear.add(key(r, c))));
      const sp = specialFor(g, prefer, dir);
      if (sp) made.push(Object.assign(sp, { color: st.board[g[0].cells[0][0]][g[0].cells[0][1]].c }));
    }
    return { clear, made };
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
        const x = cell(st, Math.floor(rng() * (st.colors || COLORS)));
        b[r][c] = x;
        spawns.push({ id: x.id, c, r, fromR: r - k, color: x.c });
      }
    }
    return { kind: 'fall', moves, spawns };
  }

  // 맞춤이 없어질 때까지: 지우기 → 채우기 → (연쇄) ...  prefer 는 첫 단계에서만
  function cascade(st, rng, steps, prefer, startCombo, dir) {
    let combo = startCombo || 1;
    for (let guard = 0; guard < 100; guard++) {
      if (!findRuns(st.board).length) break;
      const { clear, made } = combo === 1 ? matchClear(st, prefer, dir) : matchClear(st, null);
      // 특수 보석이 놓일 자리의 원래 보석은 지워지되 그 자리엔 새 특수 보석이 남는다
      steps.push(applyClear(st, clear, made, combo));
      steps.push(gravity(st, rng));
      combo++;
    }
  }

  const adjacent = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

  // 특수 보석끼리 바꾸기 (둘 다 특수). 가운데 = 옮겨 간 보석이 도착한 칸(bb)
  //   줄+줄 → 십자(그 가로줄+세로줄), 줄+폭탄 → 3줄 십자(가로 3줄+세로 3줄), 폭탄+폭탄 → 5×5
  //   무지개+줄 → 그 색 보석을 모두 줄 보석(가로/세로 무작위)으로, 무지개+폭탄 → 모두 폭탄으로 바꾼 뒤 한꺼번에 터뜨림
  //   무지개+무지개 → 판 전체
  function comboSwap(st, a, bb, A, B, steps, rng) {
    const b = st.board;
    const ka = key(a.r, a.c), kb = key(bb.r, bb.c);
    const clear = new Set([ka, kb]);
    const addArea = (r, c) => { if (inside(r, c)) clear.add(key(r, c)); };
    let type, used = [ka, kb];
    const rb = A.s === 'rainbow' ? A : B.s === 'rainbow' ? B : null;
    if (A.s === 'rainbow' && B.s === 'rainbow') {
      type = 'rbrb';
      b.forEach((row, r) => row.forEach((_, c) => clear.add(key(r, c))));
    } else if (rb) {
      const other = rb === A ? B : A;
      const rbAt = rb === A ? kb : ka;
      const color = other.c, s = other.s;
      type = s === 'bomb' ? 'rbbomb' : 'rbline';
      const cells = [];
      b.forEach((row, r) => row.forEach((y, c) => {
        if (colorOf(y) !== color) return;
        // 줄 보석으로 바뀔 때 가로/세로는 무작위 (Candy Crush 계열), 폭탄이면 폭탄
        if (!y.s) { y.s = s === 'bomb' ? 'bomb' : (rng() < 0.5 ? 'row' : 'col'); cells.push({ id: y.id, r, c, s: y.s }); }
        clear.add(key(r, c));
      }));
      steps.push({ kind: 'convert', s, color, r: bb.r, c: bb.c, cells });
      used = [rbAt]; // 무지개만 따로 안 터지고, 바뀐 보석들(교환한 보석 포함)은 모두 터짐
    } else {
      const lines = [A.s, B.s].filter(x => x === 'row' || x === 'col').length;
      if (lines === 2) {
        type = 'cross';
        for (let i = 0; i < N; i++) { addArea(bb.r, i); addArea(i, bb.c); }
      } else if (lines === 1) {
        type = 'cross3';
        for (let d = -1; d <= 1; d++) for (let i = 0; i < N; i++) { addArea(bb.r + d, i); addArea(i, bb.c + d); }
      } else {
        type = 'bomb5';
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) addArea(bb.r + dr, bb.c + dc);
      }
    }
    steps.push(applyClear(st, clear, [], 1, { used, bonus: COMBO_PTS[type], fx: { type, r: bb.r, c: bb.c } }));
    steps.push(gravity(st, rng));
    cascade(st, rng, steps, null, 2);
  }

  // 한 수를 마친 뒤: 횟수 줄이기 → 목표를 다 채웠으면 클리어 + 엔드 보너스, 아니면 막혔을 때 섞기 / 횟수 끝이면 실패
  function endMove(st, rng, steps) {
    st.moves--;
    if (st.goals && goalsDone(st)) { clearStage(st, rng, steps); return; }
    if (!findMove(st.board)) steps.push(shuffle(st, rng));
    if (st.moves <= 0) { st.over = true; if (st.goals) st.result = 'lose'; }
  }

  // 판의 특수 보석을 왼쪽 위부터 읽는 순서로 하나씩 터뜨림 (떨어짐·연쇄 포함, 새로 생긴 특수 보석도)
  function fireAll(st, rng, steps) {
    for (let guard = 0; guard < 200; guard++) {
      let at = null;
      for (let r = 0; r < N && !at; r++) for (let c = 0; c < N && !at; c++) if (st.board[r][c].s) at = { r, c };
      if (!at) return;
      const x = st.board[at.r][at.c];
      delete x.hit;
      const fx = { type: 'fire', r: at.r, c: at.c, s: x.s, bonus: true };
      if (x.s === 'rainbow') fx.color = commonColor(st.board);
      steps.push(applyClear(st, new Set([key(at.r, at.c)]), [], 1, { fx }));
      steps.push(gravity(st, rng));
      cascade(st, rng, steps, null, 2);
    }
  }

  // 클리어 + 엔드 보너스 (Candy Crush 계열 관행):
  //   1) 판에 남은 특수 보석을 차례로 터뜨림
  //   2) 남은 횟수 1번마다 무작위 일반 보석 하나를 줄 보석(가로/세로 무작위)으로 바꿈 (다 바꾼 뒤)
  //   3) 읽는 순서로 차례로 터뜨림. 엔드 보너스 줄 보석은 터질 때마다 BONUS_PTS
  //   일반 보석이 모자라면 있는 만큼만 바꾸고, 남은 횟수는 0 이 됨
  function clearStage(st, rng, steps) {
    st.goalMet = true;
    st.over = true;
    st.result = 'win';
    steps.push({ kind: 'bonus', moves: st.moves });
    fireAll(st, rng, steps);
    const cells = [];
    while (st.moves > 0) {
      const free = [];
      st.board.forEach((row, r) => row.forEach((x, c) => { if (!x.s) free.push({ r, c }); }));
      if (!free.length) break;
      const p = free[Math.floor(rng() * free.length)];
      const x = st.board[p.r][p.c];
      x.s = rng() < 0.5 ? 'row' : 'col';
      x.bonus = true;
      cells.push({ id: x.id, r: p.r, c: p.c, s: x.s, color: x.c });
      st.moves--;
    }
    st.moves = 0;
    if (cells.length) steps.push({ kind: 'bonusConvert', cells });
    fireAll(st, rng, steps);
  }

  // 목표를 다 채운 채 저장된 판(v0.3 에서 '계속하기' 하던 판)을 이어할 때: 바로 클리어 + 엔드 보너스
  function settle(st, rng) {
    if (st.over || !st.goals || !goalsDone(st)) return { ok: false };
    const steps = [];
    clearStage(st, rng, steps);
    return { ok: true, steps };
  }

  // 두 칸 바꾸기. 성공하면 { ok:true, steps: [...] } (바꾸기/지우기/채우기/섞기 단계 기록)
  //   일반+일반: 맞춤이 생기지 않으면 되돌리고 { ok:false }
  //   특수+일반: 맞춤이 없어도 특수 보석이 옮겨 간 자리에서 터짐 (생긴 맞춤도 함께 지움)
  //   특수+특수: 조합 (comboSwap)
  function play(st, a, bb, rng) {
    if (st.over || !inside(a.r, a.c) || !inside(bb.r, bb.c) || !adjacent(a, bb)) return { ok: false };
    const b = st.board;
    const A = b[a.r][a.c], B = b[bb.r][bb.c];
    if (!A || !B) return { ok: false };
    b[a.r][a.c] = B; b[bb.r][bb.c] = A;
    const steps = [];
    if (A.s && B.s) comboSwap(st, a, bb, A, B, steps, rng);
    else if (A.s === 'rainbow' || B.s === 'rainbow') {
      // 무지개+일반: 바꾼 상대와 같은 색을 모두 지움
      const clear = new Set();
      const rb = A.s === 'rainbow' ? { x: A, at: bb } : { x: B, at: a };
      const other = rb.x === A ? B : A;
      rb.x.hit = other.c;
      clear.add(key(rb.at.r, rb.at.c));
      b.forEach((row, r) => row.forEach((y, c) => { if (colorOf(y) === other.c) clear.add(key(r, c)); }));
      steps.push(applyClear(st, clear, [], 1, { fx: { type: 'fire', r: rb.at.r, c: rb.at.c, s: 'rainbow', color: other.c } }));
      steps.push(gravity(st, rng));
      cascade(st, rng, steps, null, 2);
    } else if (A.s || B.s) {
      // 줄/폭탄+일반: 특수 보석이 도착한 자리에서 터짐
      const sp = A.s ? { x: A, at: bb } : { x: B, at: a };
      const { clear, made } = matchClear(st, [[a.r, a.c], [bb.r, bb.c]], a.r === bb.r ? 'h' : 'v');
      clear.add(key(sp.at.r, sp.at.c));
      steps.push(applyClear(st, clear, made, 1, { fx: { type: 'fire', r: sp.at.r, c: sp.at.c, s: sp.x.s } }));
      steps.push(gravity(st, rng));
      cascade(st, rng, steps, null, 2);
    } else {
      if (!findRuns(b).length) { b[a.r][a.c] = A; b[bb.r][bb.c] = B; return { ok: false }; }
      cascade(st, rng, steps, [[a.r, a.c], [bb.r, bb.c]], 1, a.r === bb.r ? 'h' : 'v');
    }
    endMove(st, rng, steps);
    return { ok: true, steps };
  }

  // 특수 보석을 제자리에서 바로 터뜨리기 (더블탭). 1수를 쓴다. 무지개는 판에 가장 많은 색을 지움
  function activate(st, p, rng) {
    if (st.over || !p || !inside(p.r, p.c)) return { ok: false };
    const x = st.board[p.r][p.c];
    if (!x || !x.s) return { ok: false };
    delete x.hit;
    const steps = [];
    const fx = { type: 'fire', r: p.r, c: p.c, s: x.s };
    if (x.s === 'rainbow') fx.color = commonColor(st.board);
    steps.push(applyClear(st, new Set([key(p.r, p.c)]), [], 1, { fx }));
    steps.push(gravity(st, rng));
    cascade(st, rng, steps, null, 2);
    endMove(st, rng, steps);
    return { ok: true, steps };
  }

  // 움직일 수 있는 수 하나 (없으면 null): 바꿨을 때 3개가 맞는 수가 먼저, 없으면 특수 보석을 쓰는 수
  function findMove(b) {
    let special = null;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = r + dr, c2 = c + dc;
        if (!inside(r2, c2) || !b[r][c] || !b[r2][c2]) continue;
        if (b[r][c].s || b[r2][c2].s) { if (!special) special = [{ r, c }, { r: r2, c: c2 }]; continue; }
        const t = b[r][c]; b[r][c] = b[r2][c2]; b[r2][c2] = t;
        const ok = findRuns(b).length > 0;
        b[r2][c2] = b[r][c]; b[r][c] = t;
        if (ok) return [{ r, c }, { r: r2, c: c2 }];
      }
    }
    return special;
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
  // opts: 저장이 망가졌을 때 새로 만들 판의 설정 (스테이지 설정)
  function restore(saved, rng, opts) {
    try {
      const ok = saved && Array.isArray(saved.board) && saved.board.length === N &&
        saved.board.every(row => Array.isArray(row) && row.length === N && row.every(x => x && Number.isInteger(x.id) && x.c >= -1 && x.c < COLORS));
      if (!ok) return createGame(rng, opts);
      const st = JSON.parse(JSON.stringify(saved));
      st.seq = Math.max(st.seq | 0, ...st.board.flat().map(x => x.id + 1));
      st.colors = Math.min(COLORS, Math.max(3, st.colors | 0 || COLORS));
      st.moves = Math.max(0, Math.min(99, st.moves | 0));
      if (!Array.isArray(st.cleared) || st.cleared.length !== COLORS) st.cleared = new Array(COLORS).fill(0);
      st.made = st.made | 0;
      st.goalMet = !!(st.goals && st.goals.length) && goalsDone(st); // 목표를 채운 채 저장된 판은 settle() 로 마무리
      if (st.over || st.moves <= 0) return createGame(rng, opts); // 끝난 판은 이어할 수 없음
      st.score = Math.max(0, st.score | 0);
      if (findRuns(st.board).length || !findMove(st.board)) shuffle(st, rng);
      return st;
    } catch (e) { return createGame(rng, opts); }
  }

  const api = { N, COLORS, MOVES, CELL_PTS, SPECIAL_PTS, COMBO_PTS, BONUS_PTS, createGame, findRuns, findMove, play, activate, settle, shuffle, restore, adjacent, goalProgress, goalsDone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.M3 = api;
})(typeof window !== 'undefined' ? window : this);
