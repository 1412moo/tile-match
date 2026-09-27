// 화투패 그림
// 1~12월 48장: Wikimedia Commons "Category:SVG Hwatu" 의 SVG 파일을 그대로 사용 (cards/ 폴더, CC BY-SA 4.0).
//   원작자: Louie Mantia, Jr. (Hanafuda 그림) → Marcus Richert (한국 화투에 맞게 색·선 수정) → Spenĉjo (카드별로 분리·최적화)
//   자세한 출처와 라이선스: cards/ATTRIBUTION.md
// 보너스패 2장과 카드 뒷면은 원본 세트에 없어서 이 파일에서 직접 그린다 (세트와 같은 빨간 테두리 모양).
(function (root) {
  'use strict';
  const GS = root.GS;

  // 카드 id → Commons 파일 이름 (rules.js 의 DEF 순서와 같음)
  const FILES = [
    'January_Hikari', 'January_Tanzaku', 'January_Kasu_1', 'January_Kasu_2',
    'February_Tane', 'February_Tanzaku', 'February_Kasu_1', 'February_Kasu_2',
    'March_Hikari', 'March_Tanzaku', 'March_Kasu_1', 'March_Kasu_2',
    'April_Tane', 'April_Tanzaku', 'April_Kasu_1', 'April_Kasu_2',
    'May_Tane', 'May_Tanzaku', 'May_Kasu_1', 'May_Kasu_2',
    'June_Tane', 'June_Tanzaku', 'June_Kasu_1', 'June_Kasu_2',
    'July_Tane', 'July_Tanzaku', 'July_Kasu_1', 'July_Kasu_2',
    'August_Hikari', 'August_Tane', 'August_Kasu_1', 'August_Kasu_2',
    'September_Tane', 'September_Tanzaku', 'September_Kasu_1', 'September_Kasu_2',
    'October_Tane', 'October_Tanzaku', 'October_Kasu_1', 'October_Kasu_2',
    'November_Hikari', 'November_Kasu_2', 'November_Kasu_1', 'November_Kasu_3', // 11월 쌍피 = 아래가 빨간 Kasu_2
    'December_Hikari', 'December_Tane', 'December_Tanzaku', 'December_Kasu',     // 12월 쌍피 = Kasu
  ];

  // cards/ 폴더 위치: 이 스크립트(art.js)와 같은 폴더 기준 (다른 페이지에서 불러도 맞게)
  const here = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  const BASE = here ? new URL('cards/', here).href : 'cards/';

  const fileUrl = id => `${BASE}Hwatu_${FILES[id]}.svg`;

  // 세트와 같은 모양의 틀 (흰 바탕 + 빨간 테두리), 크기 103.2 × 168.2
  const frame = inner =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 103.2 168.2">` +
    `<rect x="0.6" y="0.6" width="102" height="167" rx="7" fill="#e3262d" stroke="#000" stroke-width="1.2"/>` +
    `<rect x="7" y="7" width="89.2" height="154.2" rx="4" fill="#fff" stroke="#000" stroke-width="1"/>${inner}</svg>`;
  const dataUrl = svg => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;

  function bonusSvg(pi) {
    const coins = pi === 3 ? [[51.6, 54], [30, 88], [73.2, 88]] : [[34, 70], [69.2, 70]];
    const font = "'Noto Sans KR','Malgun Gothic',sans-serif";
    return frame(
      coins.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="15" fill="#e3262d" stroke="#000" stroke-width="1"/>` +
        `<text x="${x}" y="${y + 6}" font-size="17" font-weight="900" text-anchor="middle" fill="#fff" font-family="${font}">피</text>`).join('') +
      `<text x="51.6" y="30" font-size="15" font-weight="900" text-anchor="middle" fill="#000" font-family="${font}">보너스</text>` +
      `<text x="51.6" y="${pi === 3 ? 138 : 128}" font-size="${pi === 3 ? 19 : 22}" font-weight="900" text-anchor="middle" fill="#e3262d" font-family="${font}">${pi === 3 ? '쓰리피' : '쌍피'}</text>`);
  }

  const cache = {};
  function url(id) {
    if (cache[id]) return cache[id];
    const c = GS.CARDS[id];
    cache[id] = c.bonus ? dataUrl(bonusSvg(c.pi)) : `url("${fileUrl(id)}")`;
    return cache[id];
  }

  // 뒷면: 빨간 화투 뒷면
  const BACK = dataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 103.2 168.2">` +
    `<rect x="0.6" y="0.6" width="102" height="167" rx="7" fill="#c8202a" stroke="#000" stroke-width="1.2"/>` +
    `<rect x="7" y="7" width="89.2" height="154.2" rx="4" fill="none" stroke="#8c1419" stroke-width="2"/></svg>`);

  // 쓰는 SVG 파일 목록 (미리 불러오기·오프라인 저장용)
  const files = () => FILES.map((f, id) => fileUrl(id));

  root.GSArt = { url, back: () => BACK, files, FILES };
})(typeof window !== 'undefined' ? window : this);
