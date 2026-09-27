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
const tiles = [
  { x: 0.13, y: 0.36, col: [228, 60, 70] },
  { x: 0.39, y: 0.28, col: [228, 60, 70] },
  { x: 0.65, y: 0.36, col: [228, 60, 70] },
];
function pixel(u, v) {
  // 배경: 세로 그라데이션 초록
  let c = [63 - v * 30, 155 - v * 55, 114 - v * 40];
  for (const t of tiles) {
    const w = 0.22, h = 0.27, r = 0.035, d = 0.03;
    if (inRR(u, v, t.x, t.y + d, t.x + w, t.y + h + d, r)) c = [196, 150, 87];      // 두께
    if (inRR(u, v, t.x, t.y, t.x + w, t.y + h, r)) {
      const k = (v - t.y) / h; c = [255 - k * 15, 253 - k * 27, 246 - k * 52];     // 윗면
      const cx = t.x + w / 2, cy = t.y + h / 2;
      if ((u - cx) ** 2 + (v - cy) ** 2 <= 0.065 ** 2) c = t.col;                  // 빨간 구슬
      if ((u - cx + 0.02) ** 2 + (v - cy + 0.02) ** 2 <= 0.018 ** 2) c = [255, 190, 190];
    }
  }
  return c;
}
const out = path.join(__dirname, '..', 'icons');
for (const s of [192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), png(s, pixel));
console.log('icons written');
