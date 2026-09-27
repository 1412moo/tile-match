// 앱 아이콘 PNG 생성 (외부 라이브러리 없이): 초록 배경 위 3D 타일 3개
const fs = require('fs'), zlib = require('zlib'), path = require('path');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const SS = 3; // 안티앨리어싱 샘플
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = pixel((x + (sx + .5) / SS) / size, (y + (sy + .5) / SS) / size);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r / SS / SS; raw[o + 1] = g / SS / SS; raw[o + 2] = b / SS / SS; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const inRR = (u, v, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(u, x1 - r)), cy = Math.max(y0 + r, Math.min(v, y1 - r));
  return u >= x0 && u <= x1 && v >= y0 && v <= y1 && (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
};
// 앱 아이콘 '엄마 게임천국': 초록 배경 위 카드 4장 (게임 하나에 한 장)
//   왼쪽 위 딸기(타일 매치) / 오른쪽 위 빨간 패(고스톱) / 왼쪽 아래 돋보기(틀린그림찾기) / 오른쪽 아래 수박(수박게임)
// 안드로이드가 동그랗게 잘라도 보이도록 모든 그림은 가운데 원(반지름 0.4) 안에 둔다.
const CARD = 0.26, GAP = 0.04, THICK = 0.02, RAD = 0.04;
const START = 0.5 - (CARD * 2 + GAP) / 2;
const TOP = START - THICK / 2; // 두께만큼 살짝 위로
const cards = [
  { x: START, y: TOP, draw: strawberry },
  { x: START + CARD + GAP, y: TOP, draw: hwatu },
  { x: START, y: TOP + CARD + GAP, draw: magnifier },
  { x: START + CARD + GAP, y: TOP + CARD + GAP, draw: watermelon },
];
const d2 = (u, v, x, y) => (u - x) ** 2 + (v - y) ** 2;
function segDist(u, v, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(u - (x0 + t * dx), v - (y0 + t * dy));
}
function strawberry(u, v, cx, cy, c) {
  // 딸기 몸통: 아래로 좁아지는 모양 (원 + 아래쪽 타원)
  const body = d2(u, v, cx, cy + 0.005) <= 0.062 ** 2 ||
    ((u - cx) / 0.045) ** 2 + ((v - cy - 0.04) / 0.05) ** 2 <= 1;
  if (body) {
    c = [226, 48, 72];
    for (const [sx, sy] of [[-0.028, -0.005], [0.028, -0.005], [0, 0.02], [-0.018, 0.045], [0.018, 0.045], [0, -0.03]]) {
      if (d2(u, v, cx + sx, cy + sy) <= 0.0075 ** 2) c = [255, 222, 120]; // 씨
    }
  }
  // 꼭지 잎
  for (const [lx, ly] of [[-0.025, -0.06], [0.025, -0.06], [0, -0.068]]) {
    if (((u - cx - lx) / 0.028) ** 2 + ((v - cy - ly) / 0.014) ** 2 <= 1) c = [60, 160, 70];
  }
  return c;
}
function hwatu(u, v, cx, cy, c) {
  if (inRR(u, v, cx - 0.06, cy - 0.085, cx + 0.06, cy + 0.085, 0.014)) {
    c = [214, 44, 52];                                                       // 빨간 패
    if (d2(u, v, cx, cy - 0.025) <= 0.034 ** 2) c = [255, 244, 225];        // 둥근 달
    if (v > cy + 0.035 && v < cy + 0.06 && Math.abs(u - cx) < 0.045) c = [40, 40, 48]; // 아래 띠
  }
  return c;
}
function magnifier(u, v, cx, cy, c) {
  const lx = cx - 0.018, ly = cy - 0.018;
  if (segDist(u, v, lx + 0.04, ly + 0.04, cx + 0.07, cy + 0.07) <= 0.014) c = [120, 78, 40]; // 손잡이
  const r2 = d2(u, v, lx, ly);
  if (r2 <= 0.058 ** 2) c = [46, 80, 140];                                  // 테
  if (r2 <= 0.042 ** 2) c = [196, 228, 255];                                // 렌즈
  if (d2(u, v, lx - 0.015, ly - 0.015) <= 0.011 ** 2) c = [255, 255, 255];  // 반짝
  return c;
}
function watermelon(u, v, cx, cy, c) {
  const oy = cy - 0.03; // 반달 모양 조각 (윗변이 평평)
  if (v < oy) return c;
  const r = Math.sqrt(d2(u, v, cx, oy));
  if (r <= 0.085) c = [58, 150, 64];                                        // 껍질
  if (r <= 0.072) c = [240, 250, 225];                                      // 흰 부분
  if (r <= 0.064) {
    c = [236, 64, 72];                                                      // 빨간 속
    for (const [sx, sy] of [[-0.028, 0.016], [0.028, 0.016], [0, 0.034], [-0.012, 0.012], [0.012, 0.012]]) {
      if (((u - cx - sx) / 0.006) ** 2 + ((v - oy - sy) / 0.009) ** 2 <= 1) c = [40, 30, 30]; // 씨
    }
  }
  return c;
}
function pixel(u, v) {
  // 배경: 세로 그라데이션 초록 (앱 색과 같음)
  let c = [63 - v * 30, 155 - v * 55, 114 - v * 40];
  for (const k of cards) {
    const x1 = k.x + CARD, y1 = k.y + CARD;
    if (inRR(u, v, k.x, k.y + THICK, x1, y1 + THICK, RAD)) c = [196, 150, 87];   // 두께
    if (inRR(u, v, k.x, k.y, x1, y1, RAD)) {
      const t = (v - k.y) / CARD;
      c = [255 - t * 15, 253 - t * 27, 246 - t * 52];                           // 윗면
      c = k.draw(u, v, k.x + CARD / 2, k.y + CARD / 2, c);
    }
  }
  return c;
}
const out = path.join(__dirname, '..', 'icons');
for (const s of [192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s, pixel));
console.log('icons written');
