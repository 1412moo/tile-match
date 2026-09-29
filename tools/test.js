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
  // 숨긴 게임(만드는 중)은 들어갈 수 없고 오프라인 파일에도 들어가지 않아야 함
  for (const g of games.filter(x => x.hidden)) if (g.ready || g.files.length) fail(`숨긴 게임 ${g.id} 가 ready 이거나 파일 목록이 있음`);
  if (!read('hub.js').includes('!x.hidden')) fail('메인 화면이 숨긴 게임을 거르지 않음');
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

  // 보너스패: 손에서 내면 먹고, 상대 피 1장 가져오고, 더미에서 1장 받고, 같은 차례 계속 (한게임 신맞고)
  s = gsBase(); s.hands[0] = [BONUS[0], keep]; s.hands[1] = [keep2]; s.deck = [filler, gsOf(8, 'pi')[0]]; s.captured[1] = opPi();
  r = GS.play(s, BONUS[0]);
  if (!r.bonus || r.stolen.length !== 1 || s.captured[1].length !== 1 || !s.captured[0].includes(r.stolen[0]) || !s.captured[0].includes(BONUS[0]) ||
    !s.hands[0].includes(gsOf(8, 'pi')[0]) || s.turn !== 0 || s.pending) fail('보너스패 손에서 사용: 먹기·피 1장·한 장 받기·같은 차례');
  // 상대에게 피가 없으면 아무것도 안 가져옴 (광·띠만 있음)
  s = gsBase(); s.hands[0] = [BONUS[1], keep]; s.hands[1] = [keep2]; s.deck = [filler, gsOf(8, 'pi')[0]]; s.captured[1] = [gsOf(1, 'gwang')[0], gsOf(2, 'tti')[0]];
  r = GS.play(s, BONUS[1]);
  if (r.stolen.length !== 0 || s.captured[1].length !== 2) fail('상대 피가 없는데 보너스패로 뭔가 가져감');
  // 일반 피가 있으면 쌍피보다 일반 피를 먼저
  s = gsBase(); s.hands[0] = [BONUS[0], keep]; s.hands[1] = [keep2]; s.deck = [filler, gsOf(8, 'pi')[0]];
  const ssang = gsOf(11, 'pi').find(id => GC[id].pi === 2); s.captured[1] = [ssang, opPi()[0]];
  r = GS.play(s, BONUS[0]);
  if (r.stolen.join() !== String(opPi()[0])) fail('보너스패: 일반 피보다 쌍피를 먼저 가져감');
  // 컴퓨터가 낸 보너스패도 똑같이 (내 피 1장)
  s = gsBase(); s.turn = 1; s.hands[1] = [BONUS[0], keep2]; s.hands[0] = [keep]; s.deck = [filler, gsOf(8, 'pi')[0]]; s.captured[0] = opPi();
  r = GS.play(s, BONUS[0]);
  if (r.stolen.length !== 1 || s.captured[0].length !== 1 || !s.captured[1].includes(r.stolen[0]) || s.turn !== 1) fail('컴퓨터 보너스패: 내 피 1장');
  // 보너스패: 더미에서 나오면 먹고 한 장 더 뒤집음
  s = gsBase(); s.hands[0] = [gsOf(3)[0], keep]; s.hands[1] = [keep2]; s.floor = [gsOf(3)[1]];
  s.deck = [filler, gsOf(5, 'pi')[0], BONUS[1]];
  if (GS.peek(s) !== gsOf(5, 'pi')[0]) fail('보너스패 아래 패 미리보기');
  s.captured[1] = opPi();
  GS.play(s, gsOf(3)[0]); r = GS.flip(s);
  if (!r.events.includes('bonusFlip') || !s.captured[0].includes(BONUS[1]) || r.flipped !== gsOf(5, 'pi')[0]) fail('보너스패 뒤집기');
  if (r.stolen.length !== 1 || s.captured[1].length !== 1) fail(`뒤집어서 먹은 보너스패: 상대 피 1장 (${r.stolen.length})`);

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

// 7-2) 고스톱 족보 완성 / 비상 판정 (화면 연출용, 점수 계산과 일치해야 함)
{
  console.log('[7-2] 고스톱 족보 완성 / 비상 판정');
  const Y = k => GS.YAKU.find(y => y.key === k);
  const names = a => a.map(y => y.name).join(',');
  // 3장 족보가 score() 와 같은 카드로 정의되어 있는지
  for (const y of GS.YAKU) {
    const sc = GS.score(y.ids, false);
    const pts = y.key === 'godori' ? sc.godori : sc[y.key];
    if (pts !== y.pts) fail(`${y.name} 카드 정의가 점수 계산과 다름 (${pts})`);
  }
  // 비상: 2장 모음 + 남은 1장을 상대가 안 먹음
  const god = Y('godori').ids, cheong = Y('cheong').ids;
  let a = GS.yakuAlerts([god[0], god[1], 2], []);
  if (names(a) !== '고도리' || a[0].missing !== god[2]) fail(`고도리 비상 ${JSON.stringify(a)}`);
  if (GS.yakuAlerts([god[0], god[1]], [god[2]]).length) fail('남은 패를 상대가 먹었는데 비상');
  if (GS.yakuAlerts([god[0]], []).length) fail('1장만 있는데 비상');
  if (GS.yakuAlerts(god.slice(), []).length) fail('이미 완성했는데 비상');
  a = GS.yakuAlerts([god[0], god[1], cheong[0], cheong[2]], []);
  if (names(a) !== '고도리,청단') fail(`비상 둘 동시 ${names(a)}`);
  // 새로 완성된 족보
  if (names(GS.newYaku([god[0], god[1]], god.slice())) !== '고도리') fail('고도리 완성 감지');
  if (GS.newYaku(god.slice(), god.concat([2])).length) fail('이미 완성된 족보를 또 알림');
  const gw = GC.filter(c => c.kind === 'gwang' && !c.rain).map(c => c.id), rain = GC.find(c => c.rain).id;
  if (names(GS.newYaku(gw.slice(0, 2), gw.slice(0, 3))) !== '삼광') fail('삼광 감지');
  if (names(GS.newYaku(gw.slice(0, 2), [gw[0], gw[1], rain])) !== '비삼광') fail('비삼광 감지');
  if (names(GS.newYaku(gw.slice(0, 3), gw.slice(0, 4))) !== '사광') fail('사광 감지');
  if (names(GS.newYaku(gw.slice(0, 4), gw.concat([rain]))) !== '오광') fail('오광 감지');
  if (GS.newYaku([gw[0]], [gw[0], rain]).length) fail('광 2장에 알림');
}

// 7-3) 컴퓨터 고/스톱 판단: 판 상황으로 판단, 유리하면 3고 이상도 가능, 불리하면 스톱
{
  console.log('[7-3] 컴퓨터 고/스톱 판단');
  const pis = GC.filter(c => c.kind === 'pi' && c.pi === 1 && !c.bonus).map(c => c.id);
  const gw3 = GC.filter(c => c.kind === 'gwang' && !c.rain).map(c => c.id).slice(0, 3);
  const god = GS.YAKU.find(y => y.key === 'godori').ids;
  // 컴퓨터(1번)가 고/스톱을 고르는 판: myCap 먹은 패, oppCap 상대 먹은 패, 남은 손패 수, 고 횟수
  function gostopState(myCap, oppCap, myLeft, oppLeft, go) {
    const used = new Set([...myCap, ...oppCap]);
    const rest = [...Array(GS.N_CARDS).keys()].filter(id => !used.has(id));
    const s = gsBase();
    s.captured = [oppCap.slice(), myCap.slice()];
    s.hands = [rest.splice(0, oppLeft), rest.splice(0, myLeft)];
    s.floor = rest.splice(0, 4); s.deck = rest;
    s.turn = 1; s.phase = 'gostop'; s.go = [0, go]; s.goScore = [0, go ? GS.bestScore(myCap).total - 1 : 0];
    return s;
  }
  const strong = [...pis.slice(0, 12), ...gw3, ...god];            // 피 12(3점) + 삼광(3) + 고도리(5) = 11점
  gsEq('강한 판 점수', GS.bestScore(strong).total, 11);
  // 유리: 상대 0점, 내 차례 넉넉 → 2고에서 3고 (예전에는 2고에서 항상 스톱)
  if (!GS.aiGoStop(gostopState(strong, [], 4, 4, 2))) fail('유리한 판에서 3고를 안 함');
  if (!GS.aiGoStop(gostopState(strong, [], 4, 4, 1))) fail('유리한 판에서 2고를 안 함');
  // 불리: 상대 5점 + 청단 1장 남음 (곧 날 수 있음) → 스톱
  const oppNear = [pis[12], pis[13], ...GC.filter(c => c.dan === 'hong').map(c => c.id), ...GC.filter(c => c.dan === 'cheong').map(c => c.id).slice(0, 2)];
  const oppMore = oppNear.concat(GC.filter(c => c.kind === 'yeol' && !c.bird).map(c => c.id).slice(0, 5)); // 홍단 3 + 열끗 5장(1) = 4점 + 청단 비상
  if (GS.aiGoStop(gostopState(strong, oppMore, 4, 4, 2))) fail('상대가 곧 날 판에서 3고를 함');
  // 내 손패가 없으면 고 불가 (규칙상 자동 스톱이지만 판단 함수도 스톱)
  if (GS.aiGoStop(gostopState(strong, [], 0, 1, 0))) fail('남은 패가 없는데 고');
  // 같은 공개 정보면 같은 판단 (난수 없음, 더미 순서·상대 손패를 보지 않음)
  const a1 = gostopState(strong, [], 3, 3, 1), a2 = JSON.parse(JSON.stringify(a1));
  a2.deck.reverse(); [a2.hands[0][0], a2.deck[0]] = [a2.deck[0], a2.hands[0][0]];
  if (GS.aiGoStop(a1) !== GS.aiGoStop(a2) || GS.aiGoStop(a1) !== GS.aiGoStop(a1)) fail('고/스톱 판단이 숨은 정보나 난수에 따라 달라짐');
  // 판단 전후로 상태를 바꾸지 않음
  const before = JSON.stringify(a1); GS.aiGoStop(a1);
  if (JSON.stringify(a1) !== before) fail('고/스톱 판단이 판 상태를 바꿈');
  // 컴퓨터끼리 2000판: 3고 이상이 실제로 나오고, 남발하지 않음 (이긴 판의 15% 미만)
  let seed = 99; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let wins = 0, three = 0, asked3 = 0, went3 = 0;
  for (let g = 0; g < 2000; g++) {
    const t = GS.newRound(rnd, g % 2, 1);
    for (let k = 0; k < 300 && t.phase !== 'over'; k++) {
      if (t.phase === 'gostop') { const go = GS.aiGoStop(t); if (t.go[t.turn] === 2) { asked3++; if (go) went3++; } GS.decide(t, go); continue; }
      const a = GS.aiPick(t, rnd);
      if (a.dummy) GS.playDummy(t); else if (GS.play(t, a.card, a).bonus) continue;
      const o = GS.flipOptions(t); GS.flip(t, o ? GS.bestCard(o) : null); GS.endTurn(t);
    }
    if (t.phase !== 'over') { fail('판이 끝나지 않음'); break; }
    if (!t.over.draw) { wins++; if (t.go[t.over.winner] >= 3) three++; }
  }
  console.log(`  2000판: 3고 결정 ${asked3}번 중 고 ${went3}번 · 3고 이상으로 이긴 판 ${(100 * three / wins).toFixed(1)}%`);
  if (!went3 || !three) fail('컴퓨터가 3고 이상을 한 번도 안 함');
  if (three / wins >= 0.15) fail(`3고 이상이 너무 잦음 (${(100 * three / wins).toFixed(1)}%)`);
}

// 8) 수박게임: 물리 / 합체 / 점수 / 게임오버 / 저장
{
  console.log('[8] 수박게임 물리 / 합체 / 점수 / 위험선 / 저장');
  require('../games/watermelon/physics.js');
  require('../games/watermelon/core.js');
  const P = globalThis.WMPhysics, WM = globalThis.WMCore;
  const { WW, WH, FRUITS, DT } = WM;
  const radii = FRUITS.map(f => f.r);
  const mkRng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
  const names = bs => bs.map(b => b.type).sort((a, b) => a - b).join(',');

  // 벽/바닥 뚫림, 숫자 깨짐, 겹침, 튕겨 나감
  function checkWorld(W, tag) {
    for (const b of W.bodies) {
      if (![b.x, b.y, b.px, b.py].every(Number.isFinite)) return fail(`${tag}: 숫자 깨짐`);
      if (b.x < b.r - 0.01 || b.x > W.w - b.r + 0.01 || b.y > W.h - b.r + 0.01) return fail(`${tag}: 벽/바닥 뚫림 (${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
    }
  }
  function maxOverlap(W) {
    let m = 0;
    const bs = W.bodies;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++)
      m = Math.max(m, bs[i].r + bs[j].r - Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y));
    return m;
  }

  // (a) 무작위로 떨어뜨리며 오래 돌리기: 뚫림 없음, 쉬고 나면 겹침·떨림 작음, 합체로 튀어 오르는 높이 제한
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const rnd = mkRng(seed);
    const W = P.createWorld({ w: WW, h: WH, radii });
    const low = new Map();
    let maxRise = 0;
    for (let f = 0; f < 60 * 60; f++) {
      if (f % 30 === 0 && f < 60 * 50) { const t = Math.floor(rnd() * 5); P.addBody(W, t, radii[t] + rnd() * (WW - 2 * radii[t]), WM.HOLD_Y); }
      P.step(W, DT);
      checkWorld(W, `물리 seed ${seed}`);
      for (const b of W.bodies) if (W.time - b.born > 1.2) {
        const m = Math.max(low.get(b.id) || 0, b.y); low.set(b.id, m);
        maxRise = Math.max(maxRise, m - b.y);
      }
    }
    for (let f = 0; f < 60 * 5; f++) P.step(W, DT);
    const ov = maxOverlap(W);
    let v = 0;
    for (const b of W.bodies) v = Math.max(v, Math.hypot(b.x - b.px, b.y - b.py) * W.substeps * 60);
    if (ov > 0.8) fail(`물리 seed ${seed}: 쉰 뒤 겹침 ${ov.toFixed(2)}`);
    if (v > 15) fail(`물리 seed ${seed}: 쉰 뒤에도 움직임 ${v.toFixed(1)}/초`);
    if (maxRise > 90) fail(`물리 seed ${seed}: 합체 때 옆 과일이 ${maxRise.toFixed(0)} 만큼 튀어 오름`);
  }

  // (b) 같은 과일 둘이 닿으면 다음 과일 하나로, 절반 크기에서 커짐
  for (let t = 0; t < FRUITS.length - 1; t++) {
    const W = P.createWorld({ w: WW, h: WH, radii });
    const r = radii[t];
    P.addBody(W, t, WW / 2 - r, WH - r); P.addBody(W, t, WW / 2 + r + 0.2, WH - r);
    const ev = [];
    for (let f = 0; f < 60; f++) ev.push(...P.step(W, DT));
    if (names(W.bodies) !== String(t + 1) || !ev.some(e => e.kind === 'merge' && e.type === t + 1)) fail(`${FRUITS[t].name} 둘 → ${FRUITS[t + 1].name} 합체 안 됨: ${names(W.bodies)}`);
    else if (Math.abs(W.bodies[0].r - radii[t + 1]) > 0.01) fail(`${FRUITS[t + 1].name}: 다 자란 크기 ${W.bodies[0].r}`);
  }
  // 다른 과일끼리는 합체하지 않음
  {
    const W = P.createWorld({ w: WW, h: WH, radii });
    P.addBody(W, 0, 100, WH - 12); P.addBody(W, 1, 128.5, WH - 16);
    for (let f = 0; f < 60; f++) P.step(W, DT);
    if (names(W.bodies) !== '0,1') fail(`다른 과일끼리 합체됨: ${names(W.bodies)}`);
  }
  // 수박 둘은 터져서 사라짐 (게임은 계속)
  {
    const W = P.createWorld({ w: WW, h: WH, radii });
    const r = radii[WM.WATERMELON];
    P.addBody(W, WM.WATERMELON, WW / 2 - r, WH - r); P.addBody(W, WM.WATERMELON, WW / 2 + r, WH - r);
    const ev = [];
    for (let f = 0; f < 30; f++) ev.push(...P.step(W, DT));
    if (W.bodies.length || !ev.some(e => e.kind === 'burst')) fail('수박 두 개가 터지지 않음');
  }
  // (c) 연쇄: 귤 하나 폭의 좁은 통에 포도·딸기·체리를 쌓고 체리 → 딸기 → 포도 → 귤
  {
    const W = P.createWorld({ w: radii[3] * 2 + 1, h: WH, radii });
    const cx = W.w / 2;
    P.addBody(W, 2, cx, WH - 21);
    P.addBody(W, 1, cx, WH - 42 - 16);
    P.addBody(W, 0, cx, WH - 42 - 32 - 12);
    for (let f = 0; f < 30; f++) P.step(W, DT);
    P.addBody(W, 0, cx, 60);
    const made = [];
    for (let f = 0; f < 180; f++) P.step(W, DT).forEach(e => e.kind === 'merge' && made.push(e.type));
    if (made.join() !== '1,2,3') fail(`연쇄 합체 순서 ${made.join()} (기대 1,2,3)`);
    checkWorld(W, '연쇄');
  }
  // (d) 한 번에 한 과일은 한 번만 합체: 체리 셋이 한꺼번에 닿으면 딸기 하나 + 체리 하나
  {
    const W = P.createWorld({ w: WW, h: WH, radii });
    P.addBody(W, 0, 100, WH - 12); P.addBody(W, 0, 124, WH - 12); P.addBody(W, 0, 112, WH - 12 - 20.8);
    for (let f = 0; f < 30; f++) P.step(W, DT);
    if (names(W.bodies) !== '0,1') fail(`체리 셋 동시 합체 결과 ${names(W.bodies)} (기대 0,1)`);
  }
  // (e) 빠르게 떨어져도 바닥을 뚫지 않음 (아주 높은 곳에서 떨어뜨리기)
  {
    const W = P.createWorld({ w: WW, h: WH, radii });
    P.addBody(W, 0, 150, -5000, 0, 3000);
    for (let f = 0; f < 240; f++) { P.step(W, DT); checkWorld(W, '높은 낙하'); }
  }

  // (f) 점수: 만들어진 과일 점수 합, 수박 터짐 100점
  {
    const G = WM.createGame(mkRng(9));
    const r = radii[4];
    P.addBody(G.world, 4, 100, WH - r); P.addBody(G.world, 4, 100 + 2 * r + 0.2, WH - r);
    for (let f = 0; f < 60; f++) WM.update(G);
    if (G.score !== FRUITS[5].score || FRUITS[5].score !== 15) fail(`감 두 개 → 사과 점수 ${G.score}`);
    const G2 = WM.createGame(mkRng(9));
    const rw = radii[WM.WATERMELON];
    P.addBody(G2.world, 9, WW / 2 - radii[9], WH - radii[9]); P.addBody(G2.world, 9, WW / 2 + radii[9] + 0.2, WH - radii[9]);
    let madeW = false;
    for (let f = 0; f < 90; f++) WM.update(G2).forEach(e => { if (e.kind === 'watermelon') madeW = true; });
    if (!madeW || G2.watermelons !== 1 || G2.over) fail('멜론 둘 → 수박 이후 게임이 계속되지 않음');
    if (!WM.drop(G2, 150)) fail('수박을 만든 뒤 과일을 떨어뜨릴 수 없음');
    const G3 = WM.createGame(mkRng(9));
    P.addBody(G3.world, 10, WW / 2 - rw, WH - rw); P.addBody(G3.world, 10, WW / 2 + rw, WH - rw);
    for (let f = 0; f < 30; f++) WM.update(G3);
    if (G3.score !== WM.BURST_SCORE || G3.over) fail(`수박 둘 터짐 점수 ${G3.score}`);
  }
  // (g) 떨어뜨리기: 대기 시간, 다음 과일, 작은 5종만
  {
    const G = WM.createGame(mkRng(3));
    const next = G.next;
    if (!WM.drop(G, 150)) fail('첫 과일을 떨어뜨릴 수 없음');
    if (WM.drop(G, 150)) fail('대기 시간 중에도 떨어짐');
    if (G.held !== next) fail('다음 과일이 들고 있는 과일로 오지 않음');
    for (let f = 0; f < 31; f++) WM.update(G);
    if (!WM.canDrop(G)) fail('0.5초 뒤에도 떨어뜨릴 수 없음');
    WM.drop(G, -100);
    const b = G.world.bodies[G.world.bodies.length - 1];
    if (b.x < b.r) fail('벽 밖을 겨눠도 상자 안으로 떨어져야 함');
    const seen = new Set();
    const rng = mkRng(77);
    for (let i = 0; i < 2000; i++) seen.add(WM.randDrop(rng));
    if ([...seen].sort().join() !== '0,1,2,3,4') fail(`떨어뜨리는 과일 종류 ${[...seen].sort().join()}`);
  }
  // (h) 위험선: 막 떨어진 과일은 무시, 3초 넘게 머물러야 게임 끝, 내려가면 초기화
  {
    // 떨어지는 중인 과일은 위험선 위를 지나가도 괜찮음
    const G = WM.createGame(mkRng(5));
    for (let i = 0; i < 6; i++) { G.cool = 0; WM.drop(G, 40 + i * 45); for (let f = 0; f < 20; f++) WM.update(G); }
    for (let f = 0; f < 240; f++) WM.update(G);
    if (G.over || G.dangerT > 0) fail('과일 몇 개 떨어뜨렸을 뿐인데 위험 판정');
    // 상자를 넘치게 채우면: 위험 시작 후 3초 지나서 끝남 (그 전에는 안 끝남)
    const H = WM.createGame(mkRng(6));
    const rnd = mkRng(8);
    for (let i = 0; i < 45; i++) P.addBody(H.world, 5 + (i % 5), 40 + rnd() * 220, WH - 40 - i * 60);
    let dangerAt = -1, overAt = -1;
    for (let f = 0; f < 60 * 40 && !H.over; f++) {
      const ev = WM.update(H);
      if (ev.some(e => e.kind === 'danger')) dangerAt = f;
      if (ev.some(e => e.kind === 'safe')) dangerAt = -1;
      if (ev.some(e => e.kind === 'over')) overAt = f;
    }
    if (!H.over) fail('넘치게 채워도 게임이 끝나지 않음');
    else if (dangerAt < 0 || Math.abs((overAt - dangerAt + 1) * DT - WM.DANGER_TIME) > 0.05) fail(`위험 시작 ${dangerAt} → 끝 ${overAt}: 3초 유예가 아님`);
    if (WM.drop(H, 150)) fail('게임이 끝났는데 떨어뜨려짐');
    // 위험선 위 과일을 치우면 시간 초기화
    const K = WM.createGame(mkRng(6));
    const nb = P.addBody(K.world, 9, 150, WM.DANGER_Y - 10);
    nb.born = -10;
    K.world.gravity = 0;
    for (let f = 0; f < 60; f++) WM.update(K);
    if (!(K.dangerT > 0.9)) fail(`위험선 위 1초: dangerT ${K.dangerT}`);
    K.world.bodies.length = 0;
    const ev = WM.update(K);
    if (K.dangerT !== 0 || !ev.some(e => e.kind === 'safe')) fail('위험선 위 과일이 없어졌는데 시간이 남음');
  }
  // (i) 저장/불러오기: JSON 으로 저장 → 다시 만들면 같은 판, 이어서 진행 가능
  {
    const G = WM.createGame(mkRng(12));
    const rnd = mkRng(13);
    for (let i = 0; i < 40; i++) { G.cool = 0; WM.drop(G, rnd() * WW); for (let f = 0; f < 25; f++) WM.update(G); }
    const saved = JSON.parse(JSON.stringify(WM.serialize(G)));
    const R = WM.createGame(mkRng(1), saved);
    if (R.score !== G.score || R.held !== G.held || R.next !== G.next || R.world.bodies.length !== G.world.bodies.length) fail('불러온 판이 저장한 판과 다름');
    const d = Math.max(0, ...R.world.bodies.map((b, i) => Math.hypot(b.x - G.world.bodies[i].x, b.y - G.world.bodies[i].y)));
    if (d > 0.01) fail(`불러온 과일 위치 차이 ${d}`);
    for (let f = 0; f < 120; f++) WM.update(R);
    checkWorld(R.world, '불러온 판');
    if (R.over) fail('불러온 판이 바로 끝남');
    // 망가진 저장 데이터도 안전하게
    const bad = WM.createGame(mkRng(1), { bodies: [[99, NaN, 5], [3, 1e9, -50, 0, 0, 0], 'x'.split('')], held: 50, next: -3, score: 'a' });
    for (let f = 0; f < 60; f++) WM.update(bad);
    checkWorld(bad.world, '망가진 저장');
    if (bad.held < 0 || bad.held > 4 || bad.next < 0 || bad.next > 4) fail('망가진 저장: 들고 있는 과일 범위');
  }
  // (j) 끝까지 자동 플레이: 판이 끝나고, 성능 확인
  {
    const t0 = Date.now();
    let frames = 0;
    for (const seed of [21, 22, 23]) {
      const rnd = mkRng(seed);
      const G = WM.createGame(rnd);
      let f = 0;
      while (!G.over && f < 60 * 60 * 15) { if (f % 40 === 0) WM.drop(G, rnd() * WW); WM.update(G); checkWorld(G.world, `자동 플레이 ${seed}`); f++; }
      frames += f;
      if (!G.over) fail(`자동 플레이 ${seed}: 15분 안에 끝나지 않음`);
    }
    const ms = (Date.now() - t0) / frames;
    console.log(`  자동 플레이 3판, 평균 ${ms.toFixed(3)}ms/프레임`);
    if (ms > 2) fail(`물리 계산이 느림: ${ms.toFixed(2)}ms/프레임`);
  }
}

// 9) 보석 맞추기 (매치-3)
{
  console.log('[9] 보석 맞추기: 시작 판 / 맞춤 / 특수 보석 / 연쇄 / 움직일 수 없는 판 / 저장');
  const M = require('../games/match-3/logic.js');
  const N = M.N;
  const mkRng = sd => () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const ids = b => b.flat().map(x => x && x.id);
  const full = b => b.every(row => row.length === N && row.every(x => x && x.c >= -1 && x.c < M.COLORS));
  // 원하는 판 만들기: 기본 무늬 (2r+c)%6 (맞춤도 움직일 수도 없음) 위에 칸을 덮어씀. set: [[r,c,색,특수]]
  function mkState(set, base = (r, c) => (2 * r + c) % 6) {
    let seq = 1;
    const board = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => ({ id: seq++, c: base(r, c), s: null })));
    for (const [r, c, col, sp] of set) board[r][c] = { id: seq++, c: col, s: sp || null };
    return { v: 1, seq, board, score: 0, moves: M.MOVES, over: false, bestCombo: 0 };
  }
  const X = 5; // 7번 줄 (7,3) 의 기본 색과 같아서 가로 4·5·ㄱ 모양에 씀
  const Y = 0; // 기본 무늬와 이어지지 않는 색 (정확히 3개짜리 판)
  const firstClear = res => res.steps.find(t => t.kind === 'clear');

  // (a) 시작 판: 이미 맞은 줄 없음, 움직일 수 있는 수 있음 (2000판)
  {
    const rng = mkRng(3);
    for (let g = 0; g < 2000; g++) {
      const st = M.createGame(rng);
      if (M.findRuns(st.board).length) { fail(`시작 판에 이미 3개가 맞아 있음 (판 ${g})`); break; }
      if (!M.findMove(st.board)) { fail(`시작 판에 움직일 수가 없음 (판 ${g})`); break; }
      if (!full(st.board) || new Set(ids(st.board)).size !== N * N || st.moves !== M.MOVES) { fail('시작 판 구성 이상'); break; }
    }
  }
  // (b) 기본 무늬 확인: 맞춤 없음 + 움직일 수 없음
  {
    const st = mkState([]);
    if (M.findRuns(st.board).length || M.findMove(st.board)) fail('테스트용 기본 무늬가 잘못됨');
  }
  // (c) 3개 맞춤: 바꾸면 지워지고, 판이 다시 가득 차고, 맞은 줄이 남지 않음
  {
    const st = mkState([[7, 0, Y], [7, 1, Y], [6, 2, Y]]);
    if (M.findRuns(st.board).length) fail('(c) 준비 판에 이미 맞춤');
    const res = M.play(st, { r: 6, c: 2 }, { r: 7, c: 2 }, mkRng(1));
    const cl = res.ok && firstClear(res);
    if (!cl || cl.cleared.length !== 3 || cl.points !== 3 * M.CELL_PTS || cl.combo !== 1) fail(`3개 맞춤 ${JSON.stringify(cl && { n: cl.cleared.length, p: cl.points })}`);
    if (!full(st.board) || M.findRuns(st.board).length || new Set(ids(st.board)).size !== N * N) fail('3개 맞춤 뒤 판 상태 이상');
    if (st.moves !== M.MOVES - 1) fail('움직인 횟수가 줄지 않음');
    // 낙하: 지운 줄 위의 보석이 내려오고 모자란 만큼 위에서 새로 생김
    const fall = res.steps.find(t => t.kind === 'fall');
    if (!fall || fall.spawns.length !== 3 || fall.moves.some(m => m.r <= m.fromR) || fall.spawns.some(sp => sp.fromR >= 0)) fail('낙하 기록 이상');
  }
  // (d) 맞춤이 안 생기는 바꾸기는 되돌림 (판·점수·횟수 그대로)
  {
    const st = mkState([[7, 0, Y], [7, 1, Y], [6, 2, Y]]);
    const before = JSON.stringify(st.board);
    const res = M.play(st, { r: 0, c: 0 }, { r: 0, c: 1 }, mkRng(1));
    if (res.ok || JSON.stringify(st.board) !== before || st.moves !== M.MOVES || st.score) fail('맞지 않는 바꾸기를 되돌리지 않음');
    if (M.play(st, { r: 0, c: 0 }, { r: 2, c: 0 }, mkRng(1)).ok) fail('붙어 있지 않은 칸끼리 바뀜');
  }
  // (e) 특수 보석 만들기: 4개 → 줄 보석(방향 = 내가 민 방향: 세로로 밀면 세로줄, 가로로 밀면 가로줄. 한 줄 4개는 늘 줄과 엇갈린 방향으로 밀어야 생기므로 연쇄 규칙과 같음), 5 → 무지개, ㄱ 모양 → 폭탄 (바꾼 자리에 생김)
  {
    const cases = [
      ['가로 4 (세로로 밀어 만듦)', [[7, 0, X], [7, 1, X], [7, 3, X], [6, 2, X]], [6, 2], [7, 2], 'col'],
      ['세로 4 (가로로 밀어 만듦)', [[0, 7, Y], [1, 7, Y], [3, 7, Y], [2, 6, Y]], [2, 6], [2, 7], 'row'],
      ['5개', [[7, 0, X], [7, 1, X], [7, 3, X], [7, 4, X], [6, 2, X]], [6, 2], [7, 2], 'rainbow'],
      ['ㄱ 모양', [[7, 0, X], [7, 1, X], [6, 2, X], [5, 2, X], [7, 3, X]], [7, 3], [7, 2], 'bomb'],
    ];
    for (const [name, set, a, b, want] of cases) {
      const st = mkState(set);
      if (M.findRuns(st.board).length) { fail(`${name}: 준비 판에 이미 맞춤`); continue; }
      const res = M.play(st, { r: a[0], c: a[1] }, { r: b[0], c: b[1] }, mkRng(2));
      const cl = res.ok && firstClear(res);
      const sp = cl && cl.specials[0];
      if (!sp || sp.s !== want || sp.r !== b[0] || sp.c !== b[1]) fail(`${name} → ${want} 특수 보석 ${JSON.stringify(sp)}`);
      else if (cl.points !== cl.cleared.length * M.CELL_PTS + M.SPECIAL_PTS[want]) fail(`${name} 점수 ${cl.points}`);
    }
  }
  // (f) 특수 보석 터뜨리기: 가로줄 보석이 맞춤에 끼면 그 줄 전체, 폭탄은 3×3
  {
    const st = mkState([[7, 0, Y], [7, 1, Y, 'row'], [6, 2, Y]]);
    const cl = firstClear(M.play(st, { r: 6, c: 2 }, { r: 7, c: 2 }, mkRng(3)));
    const row7 = cl && cl.cleared.filter(x => x.r === 7).length;
    if (!cl || row7 !== N || !cl.triggered.some(t => t.s === 'row')) fail(`가로줄 보석: 7번 줄 ${row7}칸 지움`);
    const b2 = mkState([[7, 0, Y], [7, 1, Y, 'bomb'], [6, 2, Y]]);
    const cl2 = firstClear(M.play(b2, { r: 6, c: 2 }, { r: 7, c: 2 }, mkRng(3)));
    const want = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (7 + dr < N) want.push((7 + dr) * N + 1 + dc);
    if (!cl2 || want.some(k => !cl2.cleared.some(x => x.r * N + x.c === k))) fail('폭탄 보석: 3×3 을 다 지우지 않음');
  }
  // (g) 무지개 보석: 바꾼 보석과 같은 색을 모두 지움
  {
    const st = mkState([[4, 4, -1, 'rainbow']]);
    const col = st.board[4][5].c;
    const n = st.board.flat().filter(x => x.s !== 'rainbow' && x.c === col).length;
    const res = M.play(st, { r: 4, c: 4 }, { r: 4, c: 5 }, mkRng(4));
    const cl = res.ok && firstClear(res);
    if (!cl || cl.cleared.length !== n + 1 || cl.cleared.some(x => x.s !== 'rainbow' && x.color !== col)) fail(`무지개: ${cl && cl.cleared.length} 칸 (기대 ${n + 1})`);
    if (!full(st.board) || M.findRuns(st.board).length) fail('무지개 뒤 판 상태 이상');
  }
  // (h) 움직일 수 없는 판: 섞으면 맞춤 없이 움직일 수 있게, 보석(특수 포함)은 그대로
  {
    for (const base of [(r, c) => (2 * r + c) % 6, (r, c) => (3 * r + c) % 6, (r, c) => (r + 2 * c) % 6]) {
      const st = mkState([], base);
      if (M.findMove(st.board)) { fail('섞기 테스트 판에 움직일 수가 있음'); continue; }
      st.board[3][3].s = 'bomb'; // 색은 그대로 두고 특수 보석으로 (v0.3: 특수 보석은 옆과 바꾸기만 해도 되는 수)
      if (!M.findMove(st.board)) fail('특수 보석이 있는데 움직일 수 없다고 판단');
      const before = ids(st.board).sort((a, b) => a - b).join();
      const step = M.shuffle(st, mkRng(5));
      if (step.kind !== 'shuffle' || M.findRuns(st.board).length || !M.findMove(st.board)) fail('섞은 판이 잘못됨');
      if (!step.fresh && ids(st.board).sort((a, b) => a - b).join() !== before) fail('섞으면서 보석이 바뀜');
      if (!step.fresh && !st.board.flat().some(x => x.s === 'bomb')) fail('섞으면서 특수 보석이 사라짐');
    }
    // 저장된 판이 움직일 수 없는 판이면 이어할 때 섞음
    const r = M.restore(JSON.parse(JSON.stringify(mkState([]))), mkRng(6));
    if (!M.findMove(r.board) || M.findRuns(r.board).length) fail('움직일 수 없는 저장 판을 이어할 때 섞지 않음');
  }
  // (i) 자동으로 여러 판: 매 수마다 판 가득·맞춤 없음·보석 id 중복 없음·점수 계산·연쇄·끝
  {
    const rng = mkRng(11);
    let plays = 0, combos = 0, shuffles = 0, broken = 0;
    const kinds = new Set();
    for (let g = 0; g < 400 && broken < 3; g++) {
      const st = M.createGame(rng);
      let guard = 0;
      while (!st.over && guard++ < 100) {
        const mv = M.findMove(st.board);
        if (!mv) { broken++; fail('끝나지 않았는데 움직일 수가 없음'); break; }
        const score0 = st.score, res = M.play(st, mv[0], mv[1], rng);
        if (!res.ok) { broken++; fail('findMove 가 준 수가 안 됨'); break; }
        plays++;
        let sum = 0;
        for (const t of res.steps) {
          if (t.kind === 'shuffle') shuffles++;
          if (t.kind !== 'clear') continue;
          if (t.combo >= 2) combos++;
          t.specials.forEach(x => kinds.add(x.s));
          const want = t.cleared.length * M.CELL_PTS * t.combo + t.specials.reduce((a, x) => a + M.SPECIAL_PTS[x.s], 0) + (t.bonus || 0);
          if (t.points !== want) { broken++; fail(`점수 계산 ${t.points} ≠ ${want}`); }
          sum += t.points;
        }
        if (st.score !== score0 + sum) { broken++; fail('판 점수가 단계 점수 합과 다름'); }
        if (!full(st.board) || M.findRuns(st.board).length || new Set(ids(st.board)).size !== N * N) { broken++; fail('수를 둔 뒤 판 상태 이상'); break; }
      }
      if (!st.over || st.moves !== 0) { broken++; fail('20번 움직인 뒤 판이 끝나지 않음'); }
      if (M.play(st, { r: 0, c: 0 }, { r: 0, c: 1 }, rng).ok) { broken++; fail('끝난 판에서 움직여짐'); }
    }
    console.log(`  자동 ${plays}수: 연쇄(2단계 이상) ${combos}번, 특수 보석 ${[...kinds].sort().join(',')}, 섞기 ${shuffles}번`);
    if (!combos) fail('연쇄가 한 번도 없음');
    for (const k of ['row', 'col', 'bomb', 'rainbow']) if (!kinds.has(k)) fail(`특수 보석 ${k} 가 한 번도 안 생김`);
  }
  // (j) 저장: JSON 으로 저장했다가 이어하면 같은 판, 망가진 저장은 새 판
  {
    const rng = mkRng(21);
    const st = M.createGame(rng);
    for (let i = 0; i < 5; i++) { const mv = M.findMove(st.board); M.play(st, mv[0], mv[1], rng); }
    const r = M.restore(JSON.parse(JSON.stringify(st)), rng);
    if (JSON.stringify(r.board) !== JSON.stringify(st.board) || r.score !== st.score || r.moves !== st.moves) fail('이어하기 판이 저장과 다름');
    const mv = M.findMove(r.board);
    if (!mv || !M.play(r, mv[0], mv[1], rng).ok || new Set(ids(r.board)).size !== N * N) fail('이어한 판에서 계속 둘 수 없음 (보석 id 중복 포함)');
    for (const bad of [null, {}, { board: [[1]] }, { board: 'x' }]) {
      const b = M.restore(bad, rng);
      if (!full(b.board) || M.findRuns(b.board).length || !M.findMove(b.board) || b.moves !== M.MOVES) fail('망가진 저장에서 새 판을 못 만듦');
    }
  }
  // (k) v0.3 특수 보석 쓰기: 특수+일반은 맞춤 없이도 옮겨 간 자리에서 터짐, 특수+특수 조합, 더블탭 발동
  {
    const cellsOf = cl => new Set(cl.cleared.map(x => x.r * N + x.c));
    const sameSet = (got, want) => got.size === want.size && [...want].every(k => got.has(k));
    const rowK = r => [...Array(N)].map((_, i) => r * N + i), colK = c => [...Array(N)].map((_, i) => i * N + c);
    const after = (st, name) => { if (!full(st.board) || M.findRuns(st.board).length || new Set(ids(st.board)).size !== N * N) fail(`${name}: 뒤 판 상태 이상`); };
    // 특수+일반 (맞춤 없음): 가로줄 보석이 (4,5) 로 옮겨 가 4번 줄을 지움, 세로줄은 (3,4) 로 옮겨 가 4번 세로줄
    let st = mkState([[4, 4, 0, 'row']]);
    let res = M.play(st, { r: 4, c: 4 }, { r: 4, c: 5 }, mkRng(31));
    let cl = res.ok && firstClear(res);
    if (!cl || !sameSet(cellsOf(cl), new Set(rowK(4))) || !cl.fx || cl.fx.type !== 'fire' || cl.fx.r !== 4 || cl.fx.c !== 5) fail(`특수+일반 가로줄: ${cl && cl.cleared.length}칸`);
    if (st.moves !== M.MOVES - 1) fail('특수+일반도 1수를 씀');
    after(st, '특수+일반');
    st = mkState([[4, 4, 0, 'col']]);
    cl = firstClear(M.play(st, { r: 4, c: 4 }, { r: 3, c: 4 }, mkRng(32)));
    if (!cl || !sameSet(cellsOf(cl), new Set(colK(4)))) fail('특수+일반 세로줄');
    st = mkState([[4, 4, 0, 'bomb']]);
    cl = firstClear(M.play(st, { r: 4, c: 5 }, { r: 4, c: 4 }, mkRng(33))); // 일반을 밀어도 폭탄은 (4,5) 에서 터짐
    const b33 = new Set(); for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) b33.add((4 + dr) * N + 5 + dc);
    if (!cl || !sameSet(cellsOf(cl), b33)) fail('특수+일반 폭탄 3×3 (도착 자리 기준)');
    // 일반+일반은 여전히 맞춤이 없으면 되돌림
    st = mkState([[4, 4, 0, 'row']]);
    if (M.play(st, { r: 0, c: 0 }, { r: 0, c: 1 }, mkRng(1)).ok) fail('일반+일반 맞춤 없는 바꾸기가 됨');
    // 조합: 가운데 = 옮겨 간 보석이 도착한 칸 (4,5)
    const combos = [
      ['줄+줄 십자', 'row', 'col', 'cross', () => new Set([...rowK(4), ...colK(5)])],
      ['가로+가로 십자', 'row', 'row', 'cross', () => new Set([...rowK(4), ...colK(5)])],
      ['줄+폭탄 3줄 십자', 'col', 'bomb', 'cross3', () => new Set([3, 4, 5].flatMap(r => rowK(r)).concat([4, 5, 6].flatMap(c => colK(c))))],
      ['폭탄+폭탄 5×5', 'bomb', 'bomb', 'bomb5', () => { const s = new Set(); for (let r = 2; r <= 6; r++) for (let c = 3; c <= 7; c++) s.add(r * N + c); return s; }],
    ];
    for (const [name, sa, sb, type, want] of combos) {
      st = mkState([[4, 4, 0, sa], [4, 5, 1, sb]]);
      res = M.play(st, { r: 4, c: 4 }, { r: 4, c: 5 }, mkRng(34));
      cl = res.ok && firstClear(res);
      if (!cl || !cl.fx || cl.fx.type !== type || !sameSet(cellsOf(cl), want())) { fail(`${name}: ${cl && cl.fx && cl.fx.type} ${cl && cl.cleared.length}칸 (기대 ${want().size})`); continue; }
      if (cl.bonus !== M.COMBO_PTS[type] || cl.points !== cl.cleared.length * M.CELL_PTS + M.COMBO_PTS[type]) fail(`${name} 점수 ${cl.points}`);
      after(st, name);
    }
    // 연쇄로 저절로 생긴 줄 보석: 가로 4개 → 세로줄. 3번 세로줄 5~7행 초록 3개를 지우면 (2,3) 이 (5,3) 으로 내려와 5번 줄 1~4칸이 빨강 4개
    st = mkState([[5, 1, 0], [5, 2, 0], [5, 4, 0], [2, 3, 0], [5, 3, 3], [6, 3, 3], [7, 2, 3]]);
    if (M.findRuns(st.board).length) fail('연쇄 줄 방향: 준비 판에 이미 맞춤');
    res = M.play(st, { r: 7, c: 2 }, { r: 7, c: 3 }, mkRng(61));
    const cc = res.ok && res.steps.filter(t => t.kind === 'clear')[1];
    const made5 = cc && cc.combo === 2 && cc.specials.find(x => x.r === 5);
    if (!made5 || made5.s !== 'col') fail(`연쇄로 생긴 가로 4 → 세로줄 이어야 함: ${JSON.stringify(made5)}`);
    // 판 가장자리에서는 잘림: 폭탄+폭탄 (0,1)→(0,0) → 3×3
    st = mkState([[0, 0, 0, 'bomb'], [0, 1, 1, 'bomb']]);
    cl = firstClear(M.play(st, { r: 0, c: 1 }, { r: 0, c: 0 }, mkRng(35)));
    if (!cl || cl.cleared.length !== 9) fail(`가장자리 5×5 잘림: ${cl && cl.cleared.length}`);
    // 조합 범위 안 다른 특수 보석도 연쇄로 터짐: 십자 범위 (0,5) 의 가로줄 → 0번 줄도
    st = mkState([[4, 4, 0, 'row'], [4, 5, 1, 'col'], [0, 5, 2, 'row']]);
    cl = firstClear(M.play(st, { r: 4, c: 4 }, { r: 4, c: 5 }, mkRng(36)));
    if (!cl || !rowK(0).every(k => cellsOf(cl).has(k))) fail('조합 범위 안 특수 보석 연쇄');
    // 무지개+줄: 그 색(3) 보석이 모두 줄 보석(가로/세로 무작위, Candy Crush 계열)으로 바뀌고 모두 터짐
    st = mkState([[4, 4, -1, 'rainbow'], [4, 5, 3, 'col']]);
    const n3 = st.board.flat().filter(x => !x.s && x.c === 3).length;
    res = M.play(st, { r: 4, c: 4 }, { r: 4, c: 5 }, mkRng(37));
    const cv = res.ok && res.steps.find(t => t.kind === 'convert');
    cl = res.ok && firstClear(res);
    if (!cv || cv.cells.length !== n3 || cv.cells.some(x => x.s !== 'row' && x.s !== 'col')) fail(`무지개+줄 변환 ${cv && cv.cells.length}/${n3}`);
    else if (!cl || cl.fx.type !== 'rbline' || !cv.cells.every(x => (x.s === 'row' ? rowK(x.r) : colK(x.c)).every(k => cellsOf(cl).has(k)))) fail('무지개+줄: 바뀐 줄 보석이 모두 터지지 않음');
    after(st, '무지개+줄');
    const dirs = new Set();
    for (let sd = 50; sd < 60; sd++) {
      const t = mkState([[4, 4, -1, 'rainbow'], [4, 5, 3, 'row']]);
      const cv2 = M.play(t, { r: 4, c: 4 }, { r: 4, c: 5 }, mkRng(sd)).steps.find(x => x.kind === 'convert');
      cv2.cells.forEach(x => dirs.add(x.s));
    }
    if (!dirs.has('row') || !dirs.has('col')) fail(`무지개+줄 변환 방향이 무작위가 아님: ${[...dirs]}`);
    // 무지개+폭탄: 그 색이 모두 폭탄으로 바뀌고 터짐
    st = mkState([[4, 4, -1, 'rainbow'], [4, 5, 3, 'bomb']]);
    res = M.play(st, { r: 4, c: 5 }, { r: 4, c: 4 }, mkRng(39));
    const cv3 = res.steps.find(t => t.kind === 'convert');
    cl = firstClear(res);
    if (!cv3 || cv3.s !== 'bomb' || cv3.cells.length !== n3 || cl.fx.type !== 'rbbomb' || cl.triggered.filter(t => t.s === 'bomb').length < n3) fail('무지개+폭탄');
    after(st, '무지개+폭탄');
    // 무지개+무지개: 판 전체
    st = mkState([[4, 4, -1, 'rainbow'], [4, 5, -1, 'rainbow']]);
    cl = firstClear(M.play(st, { r: 4, c: 4 }, { r: 4, c: 5 }, mkRng(40)));
    if (!cl || cl.cleared.length !== N * N || cl.fx.type !== 'rbrb') fail('무지개+무지개 판 전체');
    // 무지개+일반: 그 색만 (예전 그대로)
    st = mkState([[4, 4, -1, 'rainbow']]);
    cl = firstClear(M.play(st, { r: 4, c: 4 }, { r: 3, c: 4 }, mkRng(41)));
    const hc = cl && cl.fx && cl.fx.color;
    if (!cl || cl.fx.s !== 'rainbow' || cl.cleared.some(x => x.s !== 'rainbow' && x.color !== hc)) fail('무지개+일반');
    // 더블탭 발동: 제자리에서 터짐, 1수 차감. 일반 보석은 안 됨
    st = mkState([[4, 4, 0, 'bomb']]);
    res = M.activate(st, { r: 4, c: 4 }, mkRng(42));
    cl = res.ok && firstClear(res);
    const b44 = new Set(); for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) b44.add((4 + dr) * N + 4 + dc);
    if (!cl || !sameSet(cellsOf(cl), b44) || st.moves !== M.MOVES - 1 || cl.fx.type !== 'fire') fail('더블탭 폭탄');
    after(st, '더블탭');
    if (M.activate(st, { r: 0, c: 0 }, mkRng(1)).ok && !st.board[0][0].s) fail('일반 보석이 더블탭으로 터짐');
    st = mkState([[4, 4, 0, 'row']]);
    cl = firstClear(M.activate(st, { r: 4, c: 4 }, mkRng(43)));
    if (!cl || !sameSet(cellsOf(cl), new Set(rowK(4)))) fail('더블탭 가로줄');
    st = mkState([[4, 4, -1, 'rainbow']]);
    const cnt = new Array(6).fill(0); st.board.flat().forEach(x => { if (!x.s) cnt[x.c]++; });
    cl = firstClear(M.activate(st, { r: 4, c: 4 }, mkRng(44)));
    if (!cl || cl.cleared.length !== Math.max(...cnt) + 1) fail(`더블탭 무지개: ${cl && cl.cleared.length}칸 (기대 ${Math.max(...cnt) + 1})`);
    const done = mkState([[4, 4, 0, 'row']]); done.over = true;
    if (M.activate(done, { r: 4, c: 4 }, mkRng(1)).ok) fail('끝난 판에서 더블탭 발동');
  }
}

// 9-2) 보석 맞추기 스테이지 (v0.2)
{
  console.log('[9-2] 보석 맞추기 스테이지: 데이터 / 목표 / 성공·실패 / 별 / 해금 / 저장 정리');
  const M = require('../games/match-3/logic.js');
  const S3 = require('../games/match-3/stages.js');
  const N = M.N;
  const mkRng = sd => () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  // 기본 무늬 (2r+c)%6 판에 목표를 붙인 상태
  function goalState(set, goals, moves) {
    let seq = 1;
    const board = Array.from({ length: N }, (_, r) => Array.from({ length: N }, (_, c) => ({ id: seq++, c: (2 * r + c) % 6, s: null })));
    for (const [r, c, col, sp] of set) board[r][c] = { id: seq++, c: col, s: sp || null };
    return { v: 1, seq, board, score: 0, moves: moves || 15, over: false, bestCombo: 0, colors: 6, goals, result: null, cleared: [0, 0, 0, 0, 0, 0], made: 0 };
  }
  const three = [[7, 0, 0], [7, 1, 0], [6, 2, 0]];        // (6,2)↔(7,2) 로 빨강 3개
  const swap3 = [{ r: 6, c: 2 }, { r: 7, c: 2 }];

  // (a) 스테이지 데이터
  const ids = S3.STAGES.map(x => x.id);
  if (ids.join() !== [...Array(S3.STAGES.length)].map((_, i) => i + 1).join()) fail(`스테이지 번호가 1부터 차례대로가 아님: ${ids}`);
  if (S3.STAGES.length !== 10) fail(`스테이지 수 ${S3.STAGES.length} (기대 10)`);
  for (const x of S3.STAGES) {
    if (!(x.moves >= 5 && x.moves <= 40) || !(x.colors >= 4 && x.colors <= M.COLORS)) fail(`스테이지 ${x.id}: 횟수/색 수 이상`);
    if (!x.goals.length) fail(`스테이지 ${x.id}: 목표 없음`);
    for (const g of x.goals) {
      if (!['score', 'color', 'special'].includes(g.type)) fail(`스테이지 ${x.id}: 모르는 목표 ${g.type}`);
      if (g.type === 'color' && !(g.color >= 0 && g.color < x.colors && g.count > 0)) fail(`스테이지 ${x.id}: 이 판에 없는 색 목표`);
      if (g.type === 'score' && !(g.target > 0)) fail(`스테이지 ${x.id}: 점수 목표 이상`);
      if (g.type === 'special' && !(g.count > 0)) fail(`스테이지 ${x.id}: 특수 목표 이상`);
      if (!S3.goalText(g)) fail(`스테이지 ${x.id}: 목표 글 없음`);
    }
    const sg = x.goals.find(g => g.type === 'score');
    if (!(x.stars[0] < x.stars[1]) || (sg && x.stars[0] <= sg.target)) fail(`스테이지 ${x.id}: 별 기준 이상 ${x.stars}`);
  }
  const types = S3.STAGES.map(x => x.goals.map(g => g.type).join('+'));
  if (!types.slice(0, 3).every(t => t === 'score') || !types.slice(3, 6).every(t => t === 'color') ||
      !types.slice(6, 8).every(t => t === 'special') || !types.slice(8).every(t => t.includes('+'))) fail(`스테이지 목표 구성: ${types}`);

  // (b) v0.4: 목표를 채우는 순간 클리어 → 엔드 보너스 (판의 특수 보석 → 남은 횟수만큼 줄 보석으로 바꿔 모두 터뜨림)
  const boardOk = (s, name) => { if (s.board.flat().some(x => !x || x.s) || M.findRuns(s.board).length || new Set(s.board.flat().map(x => x.id)).size !== N * N) fail(`${name}: 보너스 뒤 판 상태 이상 (특수 보석/맞춤 남음, id 중복)`); };
  let st = goalState(three, [{ type: 'color', color: 0, count: 3 }]);
  let res = M.play(st, swap3[0], swap3[1], mkRng(1));
  if (!res.ok || !st.over || st.result !== 'win' || !st.goalMet || st.moves !== 0) fail(`색 목표 3개: over=${st.over} result=${st.result} moves=${st.moves}`);
  if (st.cleared[0] < 3) fail('지운 빨강 보석 수를 안 셈');
  const kinds = res.steps.map(t => t.kind);
  const bIdx = kinds.indexOf('bonus'), cIdx = kinds.indexOf('bonusConvert');
  if (bIdx < 0 || res.steps[bIdx].moves !== 14 || cIdx < bIdx) fail(`엔드 보너스 단계 순서: ${kinds.join(',')}`);
  const conv = res.steps[cIdx];
  if (!conv || conv.cells.length !== 14 || conv.cells.some(x => x.s !== 'row' && x.s !== 'col')) fail(`남은 14번 → 줄 보석 14개: ${conv && conv.cells.length}`);
  const bonusFired = res.steps.slice(cIdx).filter(t => t.kind === 'clear').reduce((a, t) => a + t.triggered.filter(x => x.bonus).length, 0);
  if (bonusFired !== 14) fail(`보너스 줄 보석이 다 터지지 않음: ${bonusFired}/14`);
  const sumPts = res.steps.filter(t => t.kind === 'clear').reduce((a, t) => a + t.points, 0);
  if (sumPts !== st.score) fail(`점수 합 ${sumPts} ≠ 판 점수 ${st.score}`);
  const expectB = res.steps.filter(t => t.kind === 'clear').reduce((a, t) => a + t.triggered.filter(x => x.bonus).length * M.BONUS_PTS + (t.fx && M.COMBO_PTS[t.fx.type] || 0), 0);
  if (res.steps.filter(t => t.kind === 'clear').reduce((a, t) => a + t.bonus, 0) !== expectB) fail('보너스 점수 계산');
  boardOk(st, '엔드 보너스');
  if (M.play(st, { r: 0, c: 0 }, { r: 0, c: 1 }, mkRng(1)).ok || M.activate(st, { r: 0, c: 0 }, mkRng(1)).ok) fail('클리어한 판에서 움직여짐');
  // 같은 난수면 같은 결과
  const again = goalState(three, [{ type: 'color', color: 0, count: 3 }]);
  M.play(again, swap3[0], swap3[1], mkRng(1));
  if (JSON.stringify(again) !== JSON.stringify(st)) fail('같은 난수인데 엔드 보너스 결과가 다름');
  // 남은 횟수가 많을수록 점수가 높음 (같은 판·같은 난수, 횟수만 다름)
  const at = m => { const t = goalState(three, [{ type: 'color', color: 0, count: 3 }], m); M.play(t, swap3[0], swap3[1], mkRng(1)); return t.score; };
  if (!(at(1) < at(5) && at(5) < at(15))) fail(`남은 횟수와 점수: ${at(1)} / ${at(5)} / ${at(15)}`);
  // 판에 있던 특수 보석은 보너스 변환보다 먼저 터짐
  st = goalState(three.concat([[0, 6, 4, 'bomb']]), [{ type: 'color', color: 0, count: 3 }]);
  res = M.play(st, swap3[0], swap3[1], mkRng(4));
  const afterB = res.steps.slice(res.steps.findIndex(t => t.kind === 'bonus') + 1);
  const firstB = afterB.find(t => t.kind === 'clear');
  if (!firstB || !firstB.fx || firstB.fx.s !== 'bomb' || firstB.fx.r !== 0 || firstB.fx.c !== 6) fail('판에 남은 특수 보석을 먼저 터뜨리지 않음');
  boardOk(st, '특수 보석 남은 판');
  // 마지막 수로 목표를 채우면 변환 없이 클리어
  st = goalState(three, [{ type: 'color', color: 0, count: 3 }], 1);
  res = M.play(st, swap3[0], swap3[1], mkRng(1));
  if (!st.over || st.result !== 'win' || res.steps.some(t => t.kind === 'bonusConvert') || !res.steps.some(t => t.kind === 'bonus')) fail('마지막 수로 목표 달성 → 변환 없이 클리어');
  // 일반 보석보다 남은 횟수가 많으면 있는 만큼(64개)만 바꾸고 횟수는 0
  st = goalState(three, [{ type: 'color', color: 0, count: 3 }], 71);
  res = M.play(st, swap3[0], swap3[1], mkRng(5));
  const big = res.steps.find(t => t.kind === 'bonusConvert');
  if (!big || big.cells.length !== N * N || st.moves !== 0) fail(`줄 보석 변환 수 제한: ${big && big.cells.length}`);
  boardOk(st, '변환 수 제한');
  // 점수·특수 목표도 채우는 순간 클리어
  st = goalState(three, [{ type: 'score', target: 30 }]);
  M.play(st, swap3[0], swap3[1], mkRng(1));
  if (!st.over || st.result !== 'win') fail('점수 목표 30점 → 클리어');
  st = goalState([[7, 0, 5], [7, 1, 5], [7, 3, 5], [6, 2, 5]], [{ type: 'special', count: 1 }]); // 가로 4 → 특수 1개
  M.play(st, { r: 6, c: 2 }, { r: 7, c: 2 }, mkRng(2));
  if (st.made < 1 || st.result !== 'win') fail(`특수 보석 목표: made=${st.made} result=${st.result}`);
  // 실패하면 엔드 보너스 없음
  st = goalState(three, [{ type: 'score', target: 999999 }], 1);
  res = M.play(st, swap3[0], swap3[1], mkRng(1));
  if (st.result !== 'lose' || res.steps.some(t => t.kind === 'bonus')) fail('실패했는데 엔드 보너스');
  // 복합 목표: 하나만 채우면 계속
  st = goalState(three, [{ type: 'color', color: 0, count: 3 }, { type: 'score', target: 999999 }]);
  M.play(st, swap3[0], swap3[1], mkRng(1));
  if (st.over || st.result || st.goalMet || M.settle(st, mkRng(1)).ok) fail('복합 목표 중 하나만 채웠는데 클리어');
  const gp = M.goalProgress(st);
  if (!gp[0].done || gp[1].done || gp[1].need !== 999999) fail('목표 진행도 계산 이상');
  // (c) 횟수를 다 쓰면 실패
  st = goalState(three, [{ type: 'score', target: 999999 }], 1);
  M.play(st, swap3[0], swap3[1], mkRng(1));
  if (!st.over || st.result !== 'lose') fail(`횟수를 다 써도 실패가 아님: ${st.result}`);
  if (M.play(st, { r: 0, c: 0 }, { r: 0, c: 1 }, mkRng(1)).ok) fail('끝난 스테이지에서 움직여짐');
  // 목표 없는 판(예전 방식)은 결과 없음
  const free = M.createGame(mkRng(4));
  if (free.goals !== null || free.moves !== M.MOVES || free.colors !== M.COLORS) fail('목표 없는 판 기본값이 바뀜');

  // (d) 스테이지 설정대로 판 만들기 (색 수 제한 포함)
  for (const x of S3.STAGES) {
    const g = M.createGame(mkRng(x.id), x);
    if (g.moves !== x.moves || g.colors !== x.colors || g.board.flat().some(c => c.c >= x.colors) || M.findRuns(g.board).length || !M.findMove(g.board)) fail(`스테이지 ${x.id} 시작 판 이상`);
  }
  // 5색 판에서는 새로 내려오는 보석도 5색 안
  st = M.createGame(mkRng(9), S3.byId(1));
  const rng9 = mkRng(10);
  for (let i = 0; i < 10 && !st.over; i++) { const mv = M.findMove(st.board); M.play(st, mv[0], mv[1], rng9); }
  if (st.board.flat().some(c => c.c >= 5)) fail('5색 스테이지에 6번째 색 보석이 나옴');

  // (e) 별 / 해금 / 최고 점수
  const s1 = S3.byId(1);
  if (S3.starsFor(s1, false, 99999) !== 0 || S3.starsFor(s1, true, 0) !== 1 || S3.starsFor(s1, true, s1.stars[0]) !== 2 || S3.starsFor(s1, true, s1.stars[1]) !== 3) fail('별 계산');
  let p = S3.newProgress();
  p = S3.applyResult(p, 1, false, 500);
  if (p.unlocked !== 1 || p.stars[1]) fail('실패했는데 해금/별');
  p = S3.applyResult(p, 1, true, s1.stars[1]);
  if (p.unlocked !== 2 || p.stars[1] !== 3 || p.best[1] !== s1.stars[1]) fail('성공 반영');
  p = S3.applyResult(p, 1, true, 10);
  if (p.stars[1] !== 3 || p.best[1] !== s1.stars[1]) fail('더 낮은 기록으로 별/최고 점수가 줄어듦');
  p = S3.applyResult(p, 10, true, 1);
  if (p.unlocked !== 10) fail('마지막 스테이지를 깨도 스테이지 수를 넘으면 안 됨');
  if (S3.totalStars(p) !== 4) fail(`모은 별 합계 ${S3.totalStars(p)}`);

  // (f) 저장 정리: v0.1 자유 플레이 저장 → 하던 판은 버리고 소리 설정은 유지, 최고 점수는 legacyBest 로 보관
  const oldBoard = M.createGame(mkRng(5));
  const v1 = { sound: false, best: 1234, games: 7, current: oldBoard };
  const m1 = S3.migrate(JSON.parse(JSON.stringify(v1)));
  if (m1.current !== null || m1.sound !== false || m1.legacyBest !== 1234 || m1.v !== 2 || m1.progress.unlocked !== 1 || 'best' in m1) fail(`v0.1 저장 정리 ${JSON.stringify({ c: m1.current, s: m1.sound, lb: m1.legacyBest })}`);
  const v2 = { v: 2, sound: true, progress: { unlocked: 4, stars: { 1: 3, 2: 1, 3: 2 }, best: { 1: 900 } }, current: { stage: 4, st: M.createGame(mkRng(6), S3.byId(4)) } };
  const m2 = S3.migrate(JSON.parse(JSON.stringify(v2)));
  if (m2.progress.unlocked !== 4 || m2.progress.stars[1] !== 3 || !m2.current || m2.current.stage !== 4) fail('v0.2 저장이 정리되며 바뀜');
  const bad = S3.migrate({ v: 2, progress: { unlocked: 99, stars: null }, current: { stage: 77, st: {} } });
  if (bad.progress.unlocked !== 10 || bad.current !== null || typeof bad.progress.stars !== 'object') fail('망가진 v0.2 저장 정리');
  if (S3.migrate(null).progress.unlocked !== 1) fail('저장 없음 → 1스테이지부터');
  // (g) 이어하기: 목표·진행도·색 수 유지, 끝난 판은 새로
  const cfg = S3.byId(9);
  st = M.createGame(mkRng(7), cfg);
  const r7 = mkRng(8);
  for (let i = 0; i < 4 && !st.over; i++) { const mv = M.findMove(st.board); M.play(st, mv[0], mv[1], r7); }
  const back = M.restore(JSON.parse(JSON.stringify(st)), r7, cfg);
  if (JSON.stringify(back.goals) !== JSON.stringify(cfg.goals) || back.cleared.join() !== st.cleared.join() || back.made !== st.made || back.colors !== 6 || back.moves !== st.moves || back.score !== st.score) fail('이어하기에서 목표/진행도가 바뀜');
  // v0.3 에서 목표를 채운 채 '계속하기' 하던 판 (over 아님, 횟수 남음) → 이어하면 settle 로 바로 클리어 + 엔드 보너스
  const met = goalState(three, [{ type: 'color', color: 0, count: 3 }], 9);
  met.cleared[0] = 5; met.goalMet = true;
  const back3 = M.restore(JSON.parse(JSON.stringify(met)), mkRng(2), { goals: met.goals });
  if (back3.over || back3.moves !== 9 || !back3.goalMet) fail('v0.3 목표 채운 저장을 이어하기로 못 불러옴');
  const sres = M.settle(back3, mkRng(3));
  const sconv = sres.ok && sres.steps.find(t => t.kind === 'bonusConvert');
  if (!sres.ok || !back3.over || back3.result !== 'win' || back3.moves !== 0 || !sconv || sconv.cells.length !== 9) fail('v0.3 목표 채운 저장 → settle 클리어 + 보너스 9개');
  const notMet = JSON.parse(JSON.stringify(goalState(three, [{ type: 'color', color: 0, count: 3 }]))); delete notMet.goalMet;
  const nm = M.restore(notMet, mkRng(2));
  if (nm.goalMet || M.settle(nm, mkRng(2)).ok) fail('목표 안 채운 저장이 달성으로 바뀜');
  const ended = JSON.parse(JSON.stringify(st)); ended.over = true; ended.moves = 0;
  const fresh = M.restore(ended, r7, cfg);
  if (fresh.over || fresh.moves !== cfg.moves || fresh.score !== 0) fail('끝난 판을 이어하기로 불러옴');

  // (h) 난이도: 한 수 앞을 보는 자동 플레이어가 모든 스테이지를 깰 수 있는지 (스테이지당 15판)
  function smartPlay(cfg, rng) {
    const s = M.createGame(rng, cfg);
    let guard = 0;
    while (!s.over && guard++ < 60) {
      let best = -Infinity, pick = null;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) for (const [dr, dc] of [[0, 1], [1, 0]]) {
        if (r + dr >= N || c + dc >= N) continue;
        const copy = JSON.parse(JSON.stringify(s));
        const a = { r, c }, b = { r: r + dr, c: c + dc };
        if (!M.play(copy, a, b, mkRng(guard + 1)).ok) continue;
        const v = M.goalProgress(copy).reduce((t, g) => t + (g.done ? 1.2 : g.have / g.need), 0) * 1000 + copy.score * 0.01;
        if (v > best) { best = v; pick = [a, b]; }
      }
      if (!pick) break;
      M.play(s, pick[0], pick[1], rng);
    }
    return s.result === 'win';
  }
  const rates = [];
  for (const x of S3.STAGES) {
    const rng = mkRng(1000 + x.id);
    let w = 0;
    for (let i = 0; i < 15; i++) if (smartPlay(x, rng)) w++;
    rates.push(Math.round(100 * w / 15));
  }
  console.log(`  한 수 앞 자동 플레이 클리어율(%): ${rates.map((r, i) => `${i + 1}:${r}`).join(' ')}`);
  if (rates[0] < 90) fail(`1스테이지가 너무 어려움 (${rates[0]}%)`);
  rates.forEach((r, i) => { if (r < 30) fail(`스테이지 ${i + 1} 클리어율 ${r}% (너무 어려움)`); });
}

console.log(failures ? `\n실패 ${failures}건` : '\n모든 테스트 통과');
process.exit(failures ? 1 : 0);
