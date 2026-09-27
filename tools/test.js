// 게임 로직 자동 테스트: node tools/test.js
const L = require('../games/tile-match/levels.js');
const SLOT = 7;
let failures = 0;
const fail = msg => { failures++; console.log('  FAIL ' + msg); };

// 정확한 풀이 탐색 (DFS + 메모). tiles: {x,y,z,type}, gone: 이미 없어진 타일 표시, slot: 슬롯 그림 목록
function solvable(tiles, slotTypes, limit = 300000) {
  const n = tiles.length;
  const above = tiles.map(t => tiles.map((o, j) => (o.z > t.z && L.overlaps(o, t) ? j : -1)).filter(j => j >= 0));
  const gone = new Array(n).fill(false);
  const seen = new Set();
  let nodes = 0;
  function rec(slot, left) {
    if (++nodes > limit) return null;
    if (left === 0) return true;
    const key = gone.map(g => (g ? 1 : 0)).join('') + '|' + Object.keys(slot).sort().map(k => k + ':' + slot[k]).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    const inSlot = Object.values(slot).reduce((a, b) => a + b, 0);
    const free = [];
    for (let i = 0; i < n; i++) if (!gone[i] && above[i].every(j => gone[j])) free.push(i);
    free.sort((a, b) => (slot[tiles[b].type] || 0) - (slot[tiles[a].type] || 0));
    for (const i of free) {
      const ty = tiles[i].type, c = (slot[ty] || 0) + 1;
      if (c < 3 && inSlot + 1 >= SLOT) continue;
      const s2 = Object.assign({}, slot);
      if (c === 3) delete s2[ty]; else s2[ty] = c;
      gone[i] = true;
      const r = rec(s2, left - 1);
      gone[i] = false;
      if (r !== false) return r;
    }
    return false;
  }
  const slot = {};
  slotTypes.forEach(t => { slot[t] = (slot[t] || 0) + 1; });
  return rec(slot, n);
}

function countTypes(types) {
  const c = {};
  types.forEach(t => { c[t] = (c[t] || 0) + 1; });
  return JSON.stringify(Object.keys(c).sort().map(k => [k, c[k]]));
}

// 0) 앱 구조 검사: 문법, 버전 일치, 게임 목록의 파일 존재
console.log('[0] 문법 / 버전 일치 / 게임 목록 파일 검사');
{
  const fs = require('fs'), path = require('path');
  const ROOT = path.join(__dirname, '..');
  const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  global.self = global;
  require('../games/registry.js');
  const games = global.GAME_REGISTRY;
  const jsFiles = ['sw.js', 'hub.js', 'games/registry.js'];
  games.filter(g => g.ready).forEach(g => g.files.filter(f => f.endsWith('.js')).forEach(f => jsFiles.push(g.path + f)));
  for (const f of jsFiles) {
    try { new Function(read(f)); } catch (e) { fail(`${f}: ${e.message}`); }
  }
  const swV = (read('sw.js').match(/const VERSION = (\d+)/) || [])[1];
  if (String(global.APP_VERSION) !== swV) fail(`버전 불일치: registry APP_VERSION=${global.APP_VERSION}, sw.js VERSION=${swV}`);
  // 버전 규칙: 메인 화면(index.html)의 ?v= 는 sw.js VERSION 과 같고,
  // 각 게임은 자기 파일을 고칠 때만 자기 APP_VERSION 을 올린다 (그 게임 HTML 의 ?v= 는 모두 자기 APP_VERSION, sw.js VERSION 이하).
  // 그래서 한 게임을 고쳐도 다른 게임 파일은 건드리지 않아도 된다.
  const htmls = ['index.html'];
  const tagVersion = { 'index.html': swV };
  const ids = new Set();
  for (const g of games) {
    if (ids.has(g.id)) fail(`게임 id 중복: ${g.id}`);
    ids.add(g.id);
    if (!g.name || !g.icon || !g.path || !g.storageKey) fail(`게임 항목 정보 부족: ${g.id}`);
    if (!g.ready) continue;
    for (const f of g.files) if (f && !fs.existsSync(path.join(ROOT, g.path, f))) fail(`${g.id}: 파일 없음 ${g.path + f}`);
    htmls.push(g.path + 'index.html');
    const gameJs = path.join(ROOT, g.path, 'game.js');
    if (fs.existsSync(gameJs)) {
      const v = (fs.readFileSync(gameJs, 'utf8').match(/APP_VERSION = (\d+)/) || [])[1];
      if (!v || +v > +swV) fail(`${g.id}: game.js APP_VERSION=${v} 가 sw.js VERSION=${swV} 보다 큼`);
      tagVersion[g.path + 'index.html'] = v;
    }
  }
  const keys = games.map(g => g.storageKey);
  if (new Set(keys).size !== keys.length) fail('게임 저장 키 중복');
  if (games[0].storageKey !== 'tilematch.save.v1') fail('타일 매치 기존 저장 키(tilematch.save.v1)가 바뀜');
  for (const h of htmls) {
    const want = tagVersion[h] || swV;
    const tags = read(h).match(/\?v=\d+/g) || [];
    if (!tags.length || tags.some(t => t !== `?v=${want}`)) fail(`${h} 버전 태그 불일치: ${tags.join(',')} (기대 ?v=${want})`);
  }
  // 홈 화면에 설치되는 앱 이름은 모든 곳에서 '엄마 게임천국'
  const APP_NAME = '엄마 게임천국';
  const mf = JSON.parse(read('manifest.webmanifest'));
  if (mf.name !== APP_NAME || mf.short_name !== APP_NAME) fail(`manifest 앱 이름: ${mf.name} / ${mf.short_name}`);
  // 아이콘 주소의 ?v= 도 현재 버전 (아이콘을 바꿨을 때 예전 그림이 캐시에서 나오지 않게)
  for (const ic of mf.icons) {
    const [file, q] = ic.src.split('?');
    if (q !== `v=${swV}`) fail(`manifest 아이콘 버전 태그: ${ic.src} (sw.js VERSION=${swV})`);
    if (!fs.existsSync(path.join(ROOT, file))) fail(`manifest 아이콘 파일 없음: ${file}`);
  }
  for (const h of htmls) {
    const html = read(h);
    for (const meta of ['application-name', 'apple-mobile-web-app-title']) {
      if (!html.includes(`<meta name="${meta}" content="${APP_NAME}">`)) fail(`${h}: ${meta} 가 '${APP_NAME}' 이 아님`);
    }
  }
  for (const f of ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'hub.css']) {
    if (!fs.existsSync(path.join(ROOT, f))) fail(`파일 없음: ${f}`);
  }
}

// 1) 레벨 무결성
console.log('[1] 레벨 1~100 생성 / 3의 배수 / 결정성');
for (let lv = 1; lv <= 100; lv++) {
  const t = L.generateLevel(lv);
  if (t.length % 3) fail(`L${lv} 타일 수 ${t.length}`);
  const c = {};
  t.forEach(x => { c[x.type] = (c[x.type] || 0) + 1; });
  if (Object.values(c).some(v => v % 3)) fail(`L${lv} 그림 개수가 3의 배수가 아님`);
  if (JSON.stringify(L.generateLevel(lv)) !== JSON.stringify(t)) fail(`L${lv} 매번 다르게 생성됨`);
}

// 2) 레벨 풀이 가능
console.log('[2] 레벨 1~40 풀이 가능 여부 (정확 탐색)');
let unknown = 0;
for (let lv = 1; lv <= 40; lv++) {
  const r = solvable(L.generateLevel(lv), []);
  if (r === false) fail(`L${lv} 풀 수 없음`);
  if (r === null) unknown++;
}
console.log(`  탐색 한도 초과(판정 보류): ${unknown}`);

// 3) 섞기 후 풀이 가능 + 그림 개수 유지
console.log('[3] 게임 도중 섞기 → 항상 풀 수 있어야 함');
let rngSeed = 42;
const rnd = () => { rngSeed = (rngSeed * 16807) % 2147483647; return rngSeed / 2147483647; };
let shuffles = 0, refused = 0, shuffleUnknown = 0;
for (let lv = 1; lv <= 60; lv++) {
  for (let trial = 0; trial < 5; trial++) {
    const tiles = L.generateLevel(lv).map(t => Object.assign({}, t));
    // 무작위로 몇 수 둬서 게임 도중 상태 만들기 (슬롯이 차서 지면 그 전에서 멈춤)
    const slot = [];
    const moves = Math.floor(rnd() * tiles.length * 0.7);
    for (let m = 0; m < moves; m++) {
      const board = tiles.filter(t => t.state === 'board');
      const free = board.filter(t => !board.some(o => o.z > t.z && L.overlaps(o, t)));
      if (!free.length) break;
      const t = free[Math.floor(rnd() * free.length)];
      const same = slot.filter(s => s.type === t.type);
      if (same.length < 2 && slot.length >= SLOT - 1) break;
      t.state = 'slot';
      slot.push(t);
      if (same.length === 2) { [...same, t].forEach(s => { s.state = 'gone'; slot.splice(slot.indexOf(s), 1); }); }
    }
    const board = tiles.filter(t => t.state === 'board');
    if (board.length < 2) continue;
    const slotTypes = slot.map(s => s.type);
    const res = L.solvableShuffle(board, slotTypes, L.levelParams(lv).maxOpen, rnd, SLOT);
    if (!res) { refused++; continue; }
    shuffles++;
    if (countTypes(res) !== countTypes(board.map(t => t.type))) fail(`L${lv} 섞기 후 그림 개수 변경`);
    const after = board.map((t, i) => ({ x: t.x, y: t.y, z: t.z, type: res[i] }));
    const r = solvable(after, slotTypes);
    if (r === false) fail(`L${lv} 섞기 후 풀 수 없음`);
    if (r === null) shuffleUnknown++;
  }
}
console.log(`  섞기 ${shuffles}회 검증, 판정 보류 ${shuffleUnknown}, 불가 상태라 거절 ${refused}`);

// 4) 구조적으로 불가능한 상태에서는 섞기를 거절해야 함 (슬롯 6칸이 전부 다른 그림)
console.log('[4] 섞어도 풀 수 없는 상태 → 거절');
{
  const board = [];
  for (let i = 0; i < 12; i++) board.push({ x: i * 2, y: 0, z: 0, type: i % 6 });
  const res = L.solvableShuffle(board, [0, 1, 2, 3, 4, 5], 2, rnd, SLOT);
  if (res !== null) fail('불가능한 상태인데 섞기 결과를 돌려줌');
}

// ================= 고스톱 =================
const GS = require('../games/gostop/rules.js');
const GC = GS.CARDS;
const gsOf = (m, k) => GC.filter(c => c.month === m && (!k || c.kind === k)).map(c => c.id);
const BONUS = GC.filter(c => c.bonus).map(c => c.id);
// 빈 판 (원하는 상황을 직접 구성)
const gsBase = () => ({
  v: 2, deck: [], floor: [], hands: [[], []], captured: [[], []], turn: 0, first: 0, mult: 1,
  go: [0, 0], goScore: [0, 0], shake: [0, 0], bomb: [0, 0], dummies: [0, 0], shook: [[], []],
  turnNo: [1, 1], ppeokRun: [0, 0], bonusPts: [0, 0], ppeok: {}, pending: null, phase: 'play', over: null, last: null,
});
const gsEq = (name, got, want) => { if (got !== want) fail(`${name}: ${got} (기대 ${want})`); };
{
  console.log('[5] 고스톱 패 구성 / 점수 계산');
  const count = k => GC.filter(c => c.kind === k && !c.bonus).length;
  gsEq('전체 패 수(보너스 포함)', GC.length, 50);
  for (let m = 1; m <= 12; m++) if (GC.filter(c => c.month === m).length !== 4) fail(`${m}월 패가 4장이 아님`);
  if (count('gwang') !== 5 || count('yeol') !== 9 || count('tti') !== 10 || count('pi') !== 24) fail('광/열끗/띠/피 장수 이상');
  gsEq('보너스패', BONUS.map(id => GC[id].pi).join(','), '2,3');
  gsEq('국진', GC[GS.GUKJIN].month + GC[GS.GUKJIN].kind, '9yeol');
  gsEq('11월 쌍피', GC.filter(c => c.month === 11 && c.pi === 2).length, 1);
  gsEq('12월 쌍피', GC.filter(c => c.month === 12 && c.pi === 2).length, 1);
  const ids = f => GC.filter(f).map(c => c.id);
  gsEq('3광(비광 없음)', GS.score(ids(c => c.kind === 'gwang' && !c.rain).slice(0, 3)).total, 3);
  gsEq('비삼광', GS.score([...ids(c => c.kind === 'gwang' && !c.rain).slice(0, 2), ...ids(c => c.rain)]).total, 2);
  gsEq('4광', GS.score(ids(c => c.kind === 'gwang').slice(0, 4)).total, 4);
  gsEq('5광', GS.score(ids(c => c.kind === 'gwang')).total, 15);
  gsEq('고도리', GS.score(ids(c => c.bird)).total, 5);
  gsEq('홍단', GS.score(ids(c => c.dan === 'hong')).total, 3);
  gsEq('띠 5장 + 청단', GS.score([...ids(c => c.dan === 'cheong'), ...ids(c => c.dan === 'cho').slice(0, 2)]).total, 4);
  gsEq('피 10장', GS.score(ids(c => c.kind === 'pi' && c.pi === 1).slice(0, 10)).total, 1);
  gsEq('보너스 쓰리피 포함', GS.score([BONUS[1], ...ids(c => c.pi === 1).slice(0, 8)]).piCount, 11);
  // 국진: 피 8장 + 국진 → 쌍피로 치면 피 10장 1점, 열끗으로 치면 0점
  const g = [GS.GUKJIN, ...ids(c => c.pi === 1).slice(0, 8)];
  gsEq('국진 쌍피 선택', GS.bestScore(g).total, 1);
  gsEq('국진 쌍피 표시', GS.bestScore(g).gukjinAsPi, true);
  // 열끗 4장 + 국진 → 열끗으로 쳐야 5장 1점
  const y = [GS.GUKJIN, ...ids(c => c.kind === 'yeol' && !c.gukjin && !c.bird).slice(0, 4)];
  gsEq('국진 열끗 선택', GS.bestScore(y).total, 1);
}
{
  console.log('[6] 고스톱 특수 상황');
  const opPi = () => gsOf(11, 'pi').filter(id => GC[id].pi === 1); // 상대가 가진 피 2장
  const filler = gsOf(10, 'pi')[0];
  const keep = gsOf(5)[0], keep2 = gsOf(5)[1]; // 마지막 턴이 아니게 남겨 둘 손패

  // 쪽
  let s = gsBase(); s.hands[0] = [gsOf(3, 'gwang')[0], keep]; s.hands[1] = [keep2]; s.floor = [gsOf(1, 'pi')[0]];
  s.deck = [filler, gsOf(3, 'pi')[0]]; s.captured[1] = opPi();
  GS.play(s, gsOf(3, 'gwang')[0]); let r = GS.flip(s);
  if (!r.events.includes('jjok') || r.stolen.length !== 1) fail(`쪽 ${JSON.stringify(r)}`);

  // 뻑 → 뻑 먹기 (피 1장)
  s = gsBase(); const m4 = gsOf(4); s.hands[0] = [m4[1], keep]; s.hands[1] = [m4[3], gsOf(6)[0]]; s.floor = [m4[0], gsOf(1, 'pi')[0]];
  s.deck = [filler, gsOf(9, 'pi')[0], m4[2]]; s.captured[0] = opPi();
  GS.play(s, m4[1]); r = GS.flip(s);
  if (!r.events.includes('ppeok') || s.ppeok[4] !== 0) fail('뻑');
  GS.endTurn(s);
  GS.play(s, m4[3]); r = GS.flip(s);
  if (!r.events.includes('ppeokTake') || r.stolen.length !== 1) fail(`뻑 먹기 ${JSON.stringify(r)}`);

  // 첫뻑 +7, 연뻑 +14, 삼연뻑 즉시 승리
  s = gsBase(); s.turnNo = [0, 0];
  const mk = m => gsOf(m);
  s.hands[0] = [mk(1)[0], mk(2)[0], mk(3)[0], keep]; s.hands[1] = [gsOf(6)[0], gsOf(6)[1], gsOf(7)[0], keep2];
  s.floor = [mk(1)[1], mk(2)[1], mk(3)[1]];
  s.deck = [filler, gsOf(10, 'pi')[1], mk(3)[2], gsOf(9, 'pi')[0], mk(2)[2], gsOf(9, 'pi')[1], mk(1)[2]];
  for (const m of [1, 2, 3]) {
    GS.play(s, mk(m)[0]); r = GS.flip(s);
    if (m === 1 && !r.events.includes('firstPpeok')) fail('첫뻑');
    if (m === 2 && !r.events.includes('yeonPpeok')) fail('연뻑');
    if (m === 3) {
      if (!r.events.includes('samyeonPpeok') || s.phase !== 'over' || s.over.winner !== 0 || s.over.points !== 21) fail(`삼연뻑 ${JSON.stringify(s.over)}`);
      break;
    }
    GS.endTurn(s);
    GS.play(s, s.hands[1][0]); GS.flip(s); GS.endTurn(s);
  }
  gsEq('첫뻑+연뻑 보너스', s.bonusPts[0], 21);

  // 따닥, 첫따닥
  s = gsBase(); s.turnNo = [0, 0]; const m7 = gsOf(7); s.hands[0] = [m7[2], keep]; s.hands[1] = [keep2]; s.floor = [m7[0], m7[1], gsOf(1, 'pi')[0]];
  s.deck = [filler, m7[3]]; s.captured[1] = opPi();
  GS.play(s, m7[2], { choice: m7[0] }); r = GS.flip(s);
  if (!r.events.includes('ttadak') || !r.events.includes('firstTtadak') || r.stolen.length !== 1 || s.bonusPts[0] !== 7) fail('따닥/첫따닥');

  // 싹쓸이
  s = gsBase(); s.hands[0] = [gsOf(2)[0], keep]; s.hands[1] = [keep2]; s.floor = [gsOf(2)[1], gsOf(9)[0]];
  s.deck = [filler, gsOf(9)[1]]; s.captured[1] = opPi();
  GS.play(s, gsOf(2)[0]); r = GS.flip(s);
  if (!r.events.includes('sseul') || r.stolen.length !== 1) fail(`싹쓸이 ${JSON.stringify(r)}`);

  // 마지막 턴에는 싹쓸이여도 피를 뺏지 않음
  s = gsBase(); s.hands[0] = [gsOf(2)[0]]; s.hands[1] = []; s.floor = [gsOf(2)[1], gsOf(9)[0]];
  s.deck = [gsOf(9)[1]]; s.captured[1] = opPi();
  GS.play(s, gsOf(2)[0]); r = GS.flip(s);
  if (r.events.includes('sseul') || r.stolen.length) fail('마지막 턴 피 뺏기');

  // 같은 달 2장 중 고르기
  s = gsBase(); const m6 = gsOf(6); s.hands[0] = [m6[0], keep]; s.hands[1] = [keep2]; s.floor = [m6[1], m6[2]];
  s.deck = [filler, gsOf(12, 'gwang')[0]];
  GS.play(s, m6[0], { choice: m6[2] }); GS.flip(s);
  if (!s.captured[0].includes(m6[2]) || !s.floor.includes(m6[1])) fail('고른 패를 가져가지 않음');

  // 보너스패: 손에서 내면 먹고, 더미에서 1장 가져오고, 같은 차례 계속 (표준 맞고: 상대 피는 안 뺏음)
  s = gsBase(); s.hands[0] = [BONUS[0], keep]; s.hands[1] = [keep2]; s.deck = [filler, gsOf(8, 'pi')[0]]; s.captured[1] = opPi();
  r = GS.play(s, BONUS[0]);
  if (!r.bonus || r.stolen.length !== 0 || s.captured[1].length !== 2 || !s.hands[0].includes(gsOf(8, 'pi')[0]) || s.turn !== 0 || s.pending) fail('보너스패 손에서 사용');
  // 보너스패: 더미에서 나오면 먹고 한 장 더 뒤집음
  s = gsBase(); s.hands[0] = [gsOf(3)[0], keep]; s.hands[1] = [keep2]; s.floor = [gsOf(3)[1]];
  s.deck = [filler, gsOf(5, 'pi')[0], BONUS[1]];
  if (GS.peek(s) !== gsOf(5, 'pi')[0]) fail('보너스패 아래 패 미리보기');
  GS.play(s, gsOf(3)[0]); r = GS.flip(s);
  if (!r.events.includes('bonusFlip') || !s.captured[0].includes(BONUS[1]) || r.flipped !== gsOf(5, 'pi')[0]) fail('보너스패 뒤집기');

  // 흔들기: 같은 달 3장 → ×2, 같은 달은 다시 묻지 않음
  s = gsBase(); const m10 = gsOf(10); s.hands[0] = [m10[0], m10[1], m10[2], keep]; s.hands[1] = [keep2]; s.floor = [gsOf(1)[0]];
  s.deck = [filler, gsOf(9, 'pi')[0]];
  if (!GS.canShake(s, m10[0]) || GS.canBomb(s, m10[0])) fail('흔들기 조건');
  GS.play(s, m10[0], { shake: true }); GS.flip(s);
  gsEq('흔들기 횟수', s.shake[0], 1);
  if (GS.canShake(s, m10[1])) fail('같은 달을 다시 흔들기 물어봄');

  // 폭탄: 3장 + 바닥 1장 → 4장, 피 1장, 폭탄패 2장
  s = gsBase(); const m11 = gsOf(11); s.hands[0] = [m11[0], m11[1], m11[2], keep]; s.hands[1] = [keep2, gsOf(5)[2]]; s.floor = [m11[3], gsOf(1)[0]];
  s.deck = [filler, gsOf(10, 'pi')[1], gsOf(9, 'pi')[1], gsOf(9, 'pi')[0]]; s.captured[1] = gsOf(3, 'pi'); // 11월과 겹치지 않는 피
  if (!GS.canBomb(s, m11[0])) fail('폭탄 조건');
  GS.play(s, m11[0], { bomb: true }); r = GS.flip(s);
  if (!r.events.includes('bomb') || r.stolen.length !== 1 || s.captured[0].filter(id => GC[id].month === 11).length !== 4 || s.dummies[0] !== 2 || s.hands[0].length !== 1) fail(`폭탄 ${JSON.stringify(r)}`);
  GS.endTurn(s); GS.play(s, s.hands[1][0]); GS.flip(s); GS.endTurn(s);
  GS.playDummy(s); r = GS.flip(s);
  if (s.dummies[0] !== 1 || r.played !== null) fail('폭탄패(뒤집기만)');

  // 총통: 손에 같은 달 4장 → 10점으로 끝 / 바닥 4장 → 나가리
  const found = { hand: false, floor: false };
  for (let sd = 1; sd < 20000 && !(found.hand && found.floor); sd++) {
    let x = sd; const rng = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const t = GS.newRound(rng, 0, 1);
    if (t.over && t.over.reason === '총통') { found.hand = true; if (t.over.points !== 10) fail('총통 점수'); }
    if (t.over && t.over.draw) found.floor = true;
  }
  if (!found.hand || !found.floor) fail(`총통/바닥 총통 판이 안 나옴 ${JSON.stringify(found)}`);

  // 보너스패가 처음 바닥에 깔리면 선이 가져감
  for (let sd = 1; sd < 3000; sd++) {
    let x = sd; const rng = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const t = GS.newRound(rng, 1, 1);
    if (t.floor.some(GS.isBonus)) { fail('바닥에 보너스패가 남음'); break; }
    if (t.captured[0].length) { fail('보너스패를 선이 아닌 사람이 가져감'); break; }
  }

  // 박 계산
  const fin = (cap0, cap1, extra) => {
    const t = Object.assign(gsBase(), extra || {});
    t.hands[0] = [keep]; t.captured = [cap0, cap1]; t.phase = 'gostop';
    GS.decide(t, false); return t.over;
  };
  const pi12 = [1, 2, 3, 4, 5, 6].flatMap(m => gsOf(m, 'pi')); // 피 12장 = 3점
  let o = fin(pi12, [gsOf(7, 'pi')[0]]);
  if (!o.lines.some(l => l[0] === '피박')) fail('피박(상대 1장)');
  o = fin(pi12, []);
  if (!o.lines.some(l => l[0] === '피박')) fail('피박(상대 0장도 피박)');
  o = fin(pi12, [...gsOf(7, 'pi'), ...gsOf(8, 'pi'), ...gsOf(9, 'pi'), gsOf(10, 'pi')[0]]); // 상대 7장
  if (!o.lines.some(l => l[0] === '피박')) fail('피박(상대 7장)');
  o = fin(pi12, [...gsOf(7, 'pi'), ...gsOf(8, 'pi'), ...gsOf(9, 'pi'), ...gsOf(10, 'pi')]); // 상대 8장
  if (o.lines.some(l => l[0] === '피박')) fail('피박 아님(상대 8장)');
  const yeol7 = GC.filter(c => c.kind === 'yeol' && !c.bird).map(c => c.id).concat(gsOf(2, 'yeol')); // 7장
  o = fin(yeol7, [gsOf(4, 'yeol')[0]]); // 상대가 열끗을 가지고 있어도 멍따
  if (!o.lines.some(l => l[0] === '멍따')) fail(`멍따 ${JSON.stringify(o)}`);
  // 고 점수: 고마다 +1, 3고부터 ×2씩  (피 12장 3점, 상대 피 8장이라 피박 없음)
  const pi8 = [...gsOf(7, 'pi'), ...gsOf(8, 'pi'), ...gsOf(9, 'pi'), ...gsOf(10, 'pi')];
  gsEq('1고', fin(pi12, pi8, { go: [1, 0] }).points, 4);
  gsEq('2고', fin(pi12, pi8, { go: [2, 0] }).points, 5);
  gsEq('3고', fin(pi12, pi8, { go: [3, 0] }).points, 12);  // (3+3)×2
  gsEq('4고', fin(pi12, pi8, { go: [4, 0] }).points, 28);  // (3+4)×4
  gsEq('5고', fin(pi12, pi8, { go: [5, 0] }).points, 64);  // (3+5)×8
  o = fin([...gsOf(1, 'gwang'), ...gsOf(3, 'gwang'), ...gsOf(8, 'gwang'), ...gsOf(2, 'yeol'), ...gsOf(4, 'yeol')], [gsOf(1, 'pi')[0]], { go: [0, 1], shake: [1, 0] });
  gsEq('3광 + 광박·고박·흔들기', o.points, 24); // 3 × 2 × 2 × 2
  o = fin(pi12, [gsOf(7, 'pi')[0]], { mult: 2 });
  gsEq('나가리 다음 판 ×2', o.points, 12); // 3점 × 피박 2 × 나가리 2
  gsEq('정산(보너스 포함)', GS.netForPlayer({ draw: false, winner: 1, points: 10, bonusPts: [7, 0] }), -3);

  // 예전 저장(v1) 상태 불러오기
  const v1 = { deck: [1, 2], floor: [3], hands: [[4, 5], [6, 7]], captured: [[8], [9]], turn: 0, first: 0, go: [0, 0], goScore: [0, 0], ppeok: {}, pending: null, phase: 'play', over: null, last: null };
  const up = GS.upgradeState(JSON.parse(JSON.stringify(v1)));
  if (up.v !== 2 || up.dummies.join() !== '0,0' || up.mult !== 1 || up.turnNo.join() !== '8,8' || up.hands[0].join() !== '4,5') fail(`예전 저장 변환 ${JSON.stringify(up)}`);
}
{
  console.log('[7] 고스톱 컴퓨터끼리 3000판: 패 보존 / 종료 / 규칙 상황 발생');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const seen = {}, results = { win0: 0, win1: 0, draw: 0, chongtong: 0 };
  let broken = 0, mult = 1;
  for (let g = 0; g < 3000 && broken < 5; g++) {
    const s = GS.newRound(rnd, g % 2, mult);
    for (let step = 0; step < 200 && s.phase !== 'over'; step++) {
      if (s.phase === 'gostop') { GS.decide(s, GS.aiGoStop(s)); continue; }
      const a = GS.aiPick(s, rnd);
      if (a.dummy) GS.playDummy(s);
      else {
        const r0 = GS.play(s, a.card, a);
        if (r0.bonus) { seen.bonus = (seen.bonus || 0) + 1; continue; }
      }
      const opts = GS.flipOptions(s);
      const r = GS.flip(s, opts ? GS.bestCard(opts) : null);
      r.events.forEach(e => { seen[e] = (seen[e] || 0) + 1; });
      GS.endTurn(s);
      const all = [...s.deck, ...s.floor, ...s.hands[0], ...s.hands[1], ...s.captured[0], ...s.captured[1]];
      if (all.length !== GS.N_CARDS || new Set(all).size !== GS.N_CARDS) { broken++; fail(`패 보존 깨짐 (판 ${g})`); break; }
      const fc = {};
      s.floor.forEach(id => { fc[GS.month(id)] = (fc[GS.month(id)] || 0) + 1; });
      if (Object.values(fc).some(v => v >= 4) || s.floor.some(GS.isBonus)) { broken++; fail(`바닥 이상 (판 ${g})`); break; }
      if (Math.abs(GS.handsLeft(s, 0) - GS.handsLeft(s, 1)) > 1) { broken++; fail(`남은 차례 수 불균형 (판 ${g})`); break; }
    }
    if (s.phase !== 'over') { broken++; fail(`판이 끝나지 않음 (판 ${g})`); continue; }
    if (s.over.draw) { results.draw++; mult = Math.min(mult * 2, 8); }
    else { results['win' + s.over.winner]++; mult = 1; if (s.over.reason === '총통') results.chongtong++; }
    if (!s.over.draw && !(s.over.points >= GS.WIN_SCORE)) fail(`이긴 점수가 7점 미만 (판 ${g}): ${s.over.points}`);
  }
  console.log(`  결과 ${JSON.stringify(results)}`);
  console.log(`  발생 ${JSON.stringify(seen)}`);
  for (const e of ['jjok', 'ppeok', 'ttadak', 'sseul', 'ppeokTake', 'bomb', 'bonus', 'bonusFlip', 'firstPpeok']) if (!seen[e]) fail(`3000판 동안 '${e}' 가 한 번도 없음`);
}

console.log(failures ? `\n실패 ${failures}건` : '\n모든 테스트 통과');
process.exit(failures ? 1 : 0);
