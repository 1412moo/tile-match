// 수박게임 물리 (샘플)
// 원(과일)만 있는 상자 안 물리: Verlet 적분 + 작은 단계(substep) 나누기 + 겹침 밀어내기.
// 외부 라이브러리 없음. 브라우저/Node 둘 다에서 동작 (Node 에서 테스트용).
(function (root) {
  'use strict';

  const DEFAULTS = {
    gravity: 1500,      // 단위/초²
    substeps: 8,        // 한 프레임을 몇 번 나눠 계산할지 (뚫림 방지)
    iterations: 3,      // 한 단계에서 겹침을 몇 번 풀지 (쌓임 안정)
    damping: 0.9993,    // 공기 저항 (단계마다)
    friction: 0.06,     // 과일끼리 미끄러짐 줄임
    wallFriction: 0.12, // 바닥/벽 마찰
    growTime: 0.15,     // 합체 후 커지는 시간(초) — 한 번에 커지면 옆 과일이 튕겨 나가서
    maxStep: 0.4,       // 한 단계 최대 이동 = 가장 작은 반지름 × 이 값 (뚫림 방지)
    pushMax: 0.25,      // 겹침을 풀며 밀려난 과일이 얻는 바깥쪽 속도 한도 (단계당 이동, 튕겨 나감 방지)
  };

  function createWorld(opts) {
    const W = Object.assign({}, DEFAULTS, opts);
    W.bodies = [];
    W.seq = 1;
    W.time = 0;
    W.minR = Math.min(...W.radii);
    return W;
  }

  function addBody(W, type, x, y, vx = 0, vy = 0, r0) {
    const h = 1 / 60 / W.substeps;
    const tr = W.radii[type];
    const r = r0 == null ? tr : r0;
    const b = {
      id: W.seq++, type, x, y, px: x - vx * h, py: y - vy * h,
      r, tr, grow: r < tr ? (tr - r) / W.growTime : 0,
      angle: 0, contact: false, dead: false, born: W.time,
    };
    W.bodies.push(b);
    return b;
  }

  // 한 프레임 진행. 합체 등 일어난 일 목록을 돌려준다.
  function step(W, dt) {
    const events = [];
    const n = W.substeps;
    const h = dt / n;
    const g = W.gravity * h * h;
    const maxD = W.minR * W.maxStep;
    let bs = W.bodies;

    for (const b of bs) b.contact = false;

    for (let s = 0; s < n; s++) {
      // 1) 이동
      for (const b of bs) {
        let vx = (b.x - b.px) * W.damping;
        let vy = (b.y - b.py) * W.damping;
        const sp = Math.hypot(vx, vy);
        if (sp > maxD) { vx *= maxD / sp; vy *= maxD / sp; }
        b.px = b.x; b.py = b.y;
        b.x += vx; b.y += vy + g;
        b.sx = b.x; b.sy = b.y;
        if (b.grow) {
          b.r = Math.min(b.tr, b.r + b.grow * h);
          if (b.r >= b.tr) b.grow = 0;
        }
      }

      // 2) 겹침 풀기 + 벽
      const pairs = [];
      for (let it = 0; it < W.iterations; it++) {
        const last = it === W.iterations - 1;
        for (let i = 0; i < bs.length; i++) {
          const a = bs[i];
          for (let j = i + 1; j < bs.length; j++) {
            const b = bs[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const rr = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) {
              // 거의 닿은 같은 과일도 합체 (살짝 떨어진 채로 멈추는 것 방지)
              if (last && a.type === b.type && d2 < (rr + 0.6) * (rr + 0.6)) pairs.push([a, b]);
              continue;
            }
            const d = Math.sqrt(d2) || 1e-6;
            const nx = dx / d, ny = dy / d;
            const over = rr - d;
            const ma = a.r * a.r, mb = b.r * b.r;
            const ia = mb / (ma + mb), ib = ma / (ma + mb);
            a.x -= nx * over * ia; a.y -= ny * over * ia;
            b.x += nx * over * ib; b.y += ny * over * ib;
            a.contact = b.contact = true;
            if (last) {
              // 접선 방향 상대 움직임을 조금 줄임 (마찰)
              const tx = -ny, ty = nx;
              const rvx = (b.x - b.px) - (a.x - a.px);
              const rvy = (b.y - b.py) - (a.y - a.py);
              const vt = (rvx * tx + rvy * ty) * W.friction;
              a.px -= tx * vt * ia; a.py -= ty * vt * ia;
              b.px += tx * vt * ib; b.py += ty * vt * ib;
              if (a.type === b.type) pairs.push([a, b]);
            }
          }
        }
        for (const b of bs) walls(W, b);
      }
      // 겹침을 풀면서 생긴 속도도 한도 안으로
      for (const b of bs) {
        // 밀려난 방향으로 얻은 속도는 pushMax 까지만 (합체로 커질 때 옆 과일이 튀어 오르지 않게)
        const cx = b.x - b.sx, cy = b.y - b.sy, cl = Math.hypot(cx, cy);
        if (cl > 1e-9) {
          const nx = cx / cl, ny = cy / cl;
          const vn = (b.x - b.px) * nx + (b.y - b.py) * ny;
          if (vn > W.pushMax) { b.px += nx * (vn - W.pushMax); b.py += ny * (vn - W.pushMax); }
        }
        const vx = b.x - b.px, vy = b.y - b.py, sp = Math.hypot(vx, vy);
        if (sp > maxD) { b.px = b.x - vx * maxD / sp; b.py = b.y - vy * maxD / sp; }
      }

      // 3) 굴러가는 모양 (닿아 있을 때만 회전)
      for (const b of bs) if (b.contact) b.angle += (b.x - b.px) / b.r;

      // 4) 합체
      if (pairs.length) { merge(W, pairs, events); bs = W.bodies; }
      W.time += h;
    }
    return events;
  }

  function walls(W, b) {
    if (b.x < b.r) { b.x = b.r; b.py += (b.y - b.py) * W.wallFriction; b.contact = true; }
    else if (b.x > W.w - b.r) { b.x = W.w - b.r; b.py += (b.y - b.py) * W.wallFriction; b.contact = true; }
    if (b.y > W.h - b.r) { b.y = W.h - b.r; b.px += (b.x - b.px) * W.wallFriction; b.contact = true; }
  }

  function merge(W, pairs, events) {
    const top = W.radii.length - 1;
    for (const [a, b] of pairs) {
      if (a.dead || b.dead) continue; // 한 과일은 한 번에 한 번만 합체
      a.dead = b.dead = true;
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      const vx = ((a.x - a.px) + (b.x - b.px)) / 2;
      const vy = ((a.y - a.py) + (b.y - b.py)) / 2;
      if (a.type === top) {
        events.push({ kind: 'burst', type: a.type, x, y });
        continue;
      }
      const h = 1 / 60 / W.substeps;
      // 두 과일 사이 홈에 끼어 있던 과일과 겹치지 않도록 절반 크기에서 시작해 커짐
      const nb = addBody(W, a.type + 1, x, y, vx / h, vy / h, a.tr * 0.5);
      events.push({ kind: 'merge', type: nb.type, x, y, id: nb.id });
    }
    W.bodies = W.bodies.filter(b => !b.dead);
  }

  root.WMPhysics = { createWorld, addBody, step };
})(typeof window !== 'undefined' ? window : globalThis);
