// 수박게임 과일 그림 (전부 코드로 직접 그림 - 외부 그림 파일 없음)
// drawFruit(ctx, t, r): 원점(0,0)에 반지름 r 인 t 번째 과일을 그린다. 원 밖으로는 꼭지/잎만 조금 나온다.
(function (root) {
  'use strict';

  // 색: c 가운데, hi 밝은 쪽, lo 어두운 가장자리
  const COLORS = [
    { c: '#e5344a', hi: '#ff7d8a', lo: '#a91d31' }, // 체리
    { c: '#ff5a5f', hi: '#ff9a92', lo: '#cf2f3c' }, // 딸기
    { c: '#8d5fd3', hi: '#b996ee', lo: '#5f3aa0' }, // 포도
    { c: '#ffa726', hi: '#ffd27a', lo: '#ee8200' }, // 귤
    { c: '#ef5a1c', hi: '#ff8f5a', lo: '#b83a08' }, // 감
    { c: '#8cc63f', hi: '#d2ef8a', lo: '#5b9423' }, // 사과 (연두 풋사과 - 빨간 과일들과 구분)
    { c: '#e8c468', hi: '#fbeaa8', lo: '#c2963a' }, // 배
    { c: '#ffa9b6', hi: '#ffe1d8', lo: '#ec7189' }, // 복숭아
    { c: '#ffc933', hi: '#ffe89a', lo: '#dc9410' }, // 파인애플
    { c: '#b5d98f', hi: '#e8f6cf', lo: '#80ad5a' }, // 멜론
    { c: '#3f9d4a', hi: '#86d27a', lo: '#1f6b2c' }, // 수박
  ];

  // 얼굴 자리를 부드럽게 비운 무늬 그리기 (줄무늬/그물이 눈을 가리지 않게)
  function patternExceptFace(ctx, r, draw) {
    const cv = ctx.canvas;
    const tmp = document.createElement('canvas');
    tmp.width = cv.width; tmp.height = cv.height;
    const x = tmp.getContext('2d');
    x.setTransform(ctx.getTransform());
    x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.clip();
    draw(x);
    x.globalCompositeOperation = 'destination-out';
    x.save(); x.translate(0, r * 0.16); x.scale(1, 0.62);
    const g = x.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.65, 'rgba(0,0,0,.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, r * 0.62, 0, Math.PI * 2); x.fill();
    x.restore();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(tmp, 0, 0); ctx.restore();
  }

  // 가장자리가 부드러운 물든 자국
  function softSpot(ctx, x, y, rad, col) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }

  function leaf(ctx, x, y, w, h, rot, col = '#4caf50') {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,60,0,.35)'; ctx.lineWidth = Math.max(0.6, h * 0.15);
    ctx.beginPath(); ctx.moveTo(-w * 0.8, 0); ctx.lineTo(w * 0.8, 0); ctx.stroke();
    ctx.restore();
  }
  function stem(ctx, r, x2, y2, col = '#7a5a2e', w = 0.09) {
    ctx.strokeStyle = col; ctx.lineWidth = r * w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -r * 0.86); ctx.quadraticCurveTo(0, -r * 1.02, x2 * r, y2 * r); ctx.stroke();
  }
  // 흩어진 점 (결정적 - 매번 같은 모양)
  function dots(ctx, r, n, size, col, seed) {
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996 + seed, d = r * Math.sqrt((i + 0.5) / n) * 0.92;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (Math.abs(x) < r * 0.55 && y > -r * 0.12 && y < r * 0.4) continue; // 얼굴 자리
      ctx.beginPath(); ctx.arc(x, y, r * size, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawFruit(ctx, t, r) {
    const f = COLORS[t];
    ctx.save();
    ctx.lineCap = 'round';

    // 몸통
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, f.hi); g.addColorStop(0.55, f.c); g.addColorStop(1, f.lo);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // 과일별 무늬 (몸통 안쪽)
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    switch (t) {
      case 1: // 딸기 씨
        ctx.fillStyle = '#ffe59a';
        for (let i = 0; i < 16; i++) {
          const a = i * 2.4, d = r * (0.35 + 0.5 * ((i * 37) % 10) / 10);
          const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.9 + r * 0.1;
          if (Math.abs(x) < r * 0.5 && y > -r * 0.05 && y < r * 0.35) continue;
          ctx.beginPath(); ctx.ellipse(x, y, r * 0.045, r * 0.07, a, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 2: // 포도: 은은한 윤기 곡선
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = r * 0.05;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0.15 * Math.PI, 0.55 * Math.PI); ctx.stroke();
        break;
      case 3: dots(ctx, r, 34, 0.028, 'rgba(200,90,0,.25)', 0.3); break;      // 귤 껍질 점
      case 5: // 사과: 볼 쪽이 살짝 붉게 물든 풋사과
        softSpot(ctx, r * 0.5, r * 0.4, r * 0.6, 'rgba(255,110,70,.22)');
        break;
      case 6: dots(ctx, r, 40, 0.022, 'rgba(140,90,30,.35)', 1.1); break;   // 배 껍질 점
      case 7: // 복숭아: 옅은 노란 기운 + 가운데 골
        softSpot(ctx, -r * 0.45, r * 0.5, r * 0.65, 'rgba(255,236,170,.4)');
        ctx.strokeStyle = 'rgba(200,70,100,.35)'; ctx.lineWidth = r * 0.04;
        ctx.beginPath(); ctx.moveTo(r * 0.05, -r * 0.92); ctx.bezierCurveTo(r * 0.45, -r * 0.7, r * 0.62, -r * 0.35, r * 0.6, -r * 0.05); ctx.stroke();
        break;
      case 8: // 파인애플: 격자 비늘
        patternExceptFace(ctx, r, x => {
          x.strokeStyle = 'rgba(160,90,0,.45)'; x.lineWidth = r * 0.035;
          const s = r * 0.34;
          for (let k = -6; k <= 6; k++) {
            x.beginPath(); x.moveTo(k * s - r * 1.2, -r * 1.2); x.lineTo(k * s + r * 1.2, r * 1.2); x.stroke();
            x.beginPath(); x.moveTo(k * s + r * 1.2, -r * 1.2); x.lineTo(k * s - r * 1.2, r * 1.2); x.stroke();
          }
          x.fillStyle = 'rgba(150,80,0,.5)';
          for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
            const px = (i + j + 1) * s / 2, py = (j - i) * s / 2; // 마름모 한가운데
            x.beginPath(); x.arc(px, py, r * 0.035, 0, Math.PI * 2); x.fill();
          }
        });
        break;
      case 9: // 멜론: 하얀 그물
        patternExceptFace(ctx, r, x => {
          x.strokeStyle = 'rgba(255,255,245,.75)'; x.lineWidth = r * 0.028;
          for (let k = 0; k < 9; k++) {
            const y0 = -r + k * r * 0.25;
            x.beginPath();
            for (let i = 0; i <= 12; i++) {
              const xx = -r + i * r / 6, yy = y0 + Math.sin(i * 1.7 + k * 2.1) * r * 0.06;
              i ? x.lineTo(xx, yy) : x.moveTo(xx, yy);
            }
            x.stroke();
          }
          for (let k = 0; k < 9; k++) {
            const x0 = -r + k * r * 0.25;
            x.beginPath();
            for (let i = 0; i <= 12; i++) {
              const yy = -r + i * r / 6, xx = x0 + Math.sin(i * 1.9 + k * 1.3) * r * 0.06;
              i ? x.lineTo(xx, yy) : x.moveTo(xx, yy);
            }
            x.stroke();
          }
        });
        break;
      case 10: // 수박: 진한 초록 물결 줄무늬
        patternExceptFace(ctx, r, x => {
          x.fillStyle = '#17561f';
          for (let k = -3; k <= 3; k++) {
            const cx = k * r * 0.34, w = r * 0.075;
            x.beginPath();
            for (let i = 0; i <= 16; i++) {
              const yy = -r + i * r / 8, xx = cx + Math.sin(i * 1.4) * r * 0.05 + cx * 0.15 * Math.cos(yy / r * 1.5);
              i ? x.lineTo(xx - w, yy) : x.moveTo(xx - w, yy);
            }
            for (let i = 16; i >= 0; i--) {
              const yy = -r + i * r / 8, xx = cx + Math.sin(i * 1.4) * r * 0.05 + cx * 0.15 * Math.cos(yy / r * 1.5);
              x.lineTo(xx + w, yy);
            }
            x.fill();
          }
        });
        break;
    }
    // 반짝임
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.ellipse(-r * 0.42, -r * 0.45, r * 0.2, r * 0.11, -0.7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(1, r * 0.04); ctx.strokeStyle = 'rgba(70,30,10,.25)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();

    // 꼭지 / 잎 / 왕관
    switch (t) {
      case 0: // 체리: 가는 꼭지 + 잎
        ctx.strokeStyle = '#6d8b2f'; ctx.lineWidth = r * 0.12;
        ctx.beginPath(); ctx.moveTo(0, -r * 0.8); ctx.quadraticCurveTo(r * 0.1, -r * 1.2, r * 0.45, -r * 1.3); ctx.stroke();
        leaf(ctx, r * 0.55, -r * 1.2, r * 0.32, r * 0.15, -0.5);
        break;
      case 1: { // 딸기: 초록 꽃받침
        ctx.fillStyle = '#3fa34d';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.55;
          ctx.moveTo(0, -r * 0.8);
          ctx.quadraticCurveTo(Math.cos(a - 0.3) * r * 0.5, -r * 0.85, Math.cos(a) * r * 0.62, -r * 0.62 + Math.abs(i - 2) * r * 0.08);
          ctx.quadraticCurveTo(Math.cos(a + 0.3) * r * 0.5, -r * 0.75, 0, -r * 0.8);
        }
        ctx.fill();
        ctx.strokeStyle = '#3f7d2a'; ctx.lineWidth = r * 0.1;
        ctx.beginPath(); ctx.moveTo(0, -r * 0.82); ctx.lineTo(0, -r * 1.05); ctx.stroke();
        break;
      }
      case 2: // 포도: 꼭지 + 잎 + 덩굴손
        ctx.strokeStyle = '#7a5a2e'; ctx.lineWidth = r * 0.09;
        ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(-r * 0.05, -r * 1.12); ctx.stroke();
        leaf(ctx, r * 0.25, -r * 0.98, r * 0.3, r * 0.14, -0.35, '#5cb85c');
        ctx.strokeStyle = '#6aa84f'; ctx.lineWidth = r * 0.05;
        ctx.beginPath(); ctx.moveTo(-r * 0.05, -r * 1.05); ctx.bezierCurveTo(-r * 0.4, -r * 1.2, -r * 0.45, -r * 0.9, -r * 0.28, -r * 0.92); ctx.stroke();
        break;
      case 3: // 귤: 작은 꼭지 + 잎
        ctx.fillStyle = '#6b8e23';
        ctx.beginPath(); ctx.arc(0, -r * 0.9, r * 0.08, 0, Math.PI * 2); ctx.fill();
        leaf(ctx, r * 0.24, -r * 0.94, r * 0.26, r * 0.11, -0.3);
        break;
      case 4: // 감: 네 잎 꽃받침
        ctx.fillStyle = '#4e7a2a';
        for (let i = 0; i < 4; i++) {
          ctx.save(); ctx.translate(0, -r * 0.8); ctx.rotate(i * Math.PI / 2 + Math.PI / 4);
          ctx.beginPath(); ctx.ellipse(r * 0.17, 0, r * 0.2, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = '#5b4020';
        ctx.beginPath(); ctx.arc(0, -r * 0.8, r * 0.06, 0, Math.PI * 2); ctx.fill();
        break;
      case 5: // 사과: 오목한 꼭지 자리 + 갈색 꼭지 + 잎
        ctx.strokeStyle = 'rgba(60,100,20,.4)'; ctx.lineWidth = r * 0.04;
        ctx.beginPath(); ctx.arc(0, -r * 0.98, r * 0.16, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
        stem(ctx, r, 0.08, -1.18, '#7a4f25', 0.08);
        leaf(ctx, r * 0.3, -r * 1.02, r * 0.26, r * 0.11, -0.4);
        break;
      case 6: // 배: 짧고 굵은 갈색 꼭지
        stem(ctx, r, -0.1, -1.14, '#8a5a2b', 0.07);
        break;
      case 7: // 복숭아: 잎 두 장
        stem(ctx, r, 0, -1.02, '#7a5a2e', 0.06);
        leaf(ctx, -r * 0.22, -r * 0.98, r * 0.24, r * 0.1, 0.35, '#5aa24a');
        leaf(ctx, r * 0.22, -r * 1.0, r * 0.26, r * 0.1, -0.45, '#4caf50');
        break;
      case 8: { // 파인애플: 뾰족한 초록 잎 왕관
        const leaves = [[-0.42, 0.95, -0.5], [-0.22, 1.2, -0.25], [0, 1.35, 0], [0.22, 1.2, 0.25], [0.42, 0.95, 0.5]];
        leaves.forEach(([x0, h, rot], i) => {
          ctx.save(); ctx.translate(x0 * r * 0.5, -r * 0.8); ctx.rotate(rot);
          ctx.fillStyle = i % 2 ? '#3f9a3a' : '#57b847';
          ctx.beginPath(); ctx.moveTo(-r * 0.1, 0); ctx.quadraticCurveTo(-r * 0.06, -h * r * 0.35, 0, -h * r * 0.5);
          ctx.quadraticCurveTo(r * 0.06, -h * r * 0.35, r * 0.1, 0); ctx.closePath(); ctx.fill();
          ctx.restore();
        });
        break;
      }
      case 9: // 멜론: T자 꼭지
        ctx.strokeStyle = '#7d6a3a'; ctx.lineWidth = r * 0.05;
        ctx.beginPath(); ctx.moveTo(0, -r * 0.92); ctx.lineTo(0, -r * 1.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 0.1, -r * 1.1); ctx.lineTo(r * 0.1, -r * 1.1); ctx.stroke();
        break;
      case 10: // 수박: 돌돌 말린 꼭지
        ctx.strokeStyle = '#2e6b2a'; ctx.lineWidth = r * 0.035;
        ctx.beginPath(); ctx.moveTo(0, -r * 0.94); ctx.bezierCurveTo(r * 0.05, -r * 1.1, r * 0.2, -r * 1.1, r * 0.18, -r * 1.02);
        ctx.bezierCurveTo(r * 0.16, -r * 0.96, r * 0.1, -r * 1.0, r * 0.13, -r * 1.05); ctx.stroke();
        break;
    }

    // 얼굴 (작고 단정하게) - 큰 과일은 얼굴이 너무 커지지 않게 조금 작게
    const k = t >= 7 ? 0.8 : t >= 5 ? 0.9 : 1;
    const ey = r * 0.08, ex = r * 0.27 * (0.6 + 0.4 * k);
    const dark = t === 10 ? '#12200f' : '#3b2418';
    ctx.fillStyle = t === 10 ? 'rgba(255,150,160,.45)' : 'rgba(255,120,130,.35)';
    ctx.beginPath(); ctx.ellipse(-r * 0.43 * k, r * 0.25, r * 0.13 * k, r * 0.08 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.43 * k, r * 0.25, r * 0.13 * k, r * 0.08 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(-ex, ey, r * 0.065 * k, r * 0.09 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.065 * k, r * 0.09 * k, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-ex + r * 0.02 * k, ey - r * 0.035 * k, r * 0.025 * k, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ex + r * 0.02 * k, ey - r * 0.035 * k, r * 0.025 * k, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(0.8, r * 0.05 * k);
    ctx.beginPath(); ctx.arc(0, r * 0.2, r * 0.09 * k, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.restore();
  }

  // 과일 그림을 미리 캔버스에 그려 둔다 (scale = 화면 배율 × 기기 픽셀 비율)
  function sprites(radii, scale) {
    return radii.map((r, t) => {
      const half = r * 1.45;                 // 꼭지/잎이 원 밖으로 조금 나옴
      const size = Math.ceil(half * 2 * scale);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d');
      x.setTransform(scale, 0, 0, scale, size / 2, size / 2);
      drawFruit(x, t, r);
      return { c, half: size / 2 / scale };
    });
  }

  // 작은 아이콘 캔버스 (다음 과일, 과일 순서표)
  function icon(t, cssSize, dpr) {
    const c = document.createElement('canvas');
    const px = Math.round(cssSize * dpr);
    c.width = c.height = px;
    c.style.width = c.style.height = cssSize + 'px';
    const x = c.getContext('2d');
    const r = cssSize * 0.36;
    x.setTransform(dpr, 0, 0, dpr, cssSize / 2 * dpr, cssSize * 0.54 * dpr);
    drawFruit(x, t, r);
    return c;
  }

  root.WMArt = { COLORS, drawFruit, sprites, icon };
})(typeof window !== 'undefined' ? window : globalThis);
