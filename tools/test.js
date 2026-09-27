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
  for (const f of ['sw.js', 'hub.js', 'games/registry.js', 'games/tile-match/game.js']) {
    try { new Function(read(f)); } catch (e) { fail(`${f}: ${e.message}`); }
  }
  global.self = global;
  require('../games/registry.js');
  const games = global.GAME_REGISTRY;
  const swV = (read('sw.js').match(/const VERSION = (\d+)/) || [])[1];
  if (String(global.APP_VERSION) !== swV) fail(`버전 불일치: registry APP_VERSION=${global.APP_VERSION}, sw.js VERSION=${swV}`);
  // 각 게임의 APP_VERSION 과 모든 HTML 의 ?v= 도 같아야 새 버전이 캐시에 가려지지 않는다
  const htmls = ['index.html'];
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
      if (v !== swV) fail(`${g.id}: game.js APP_VERSION=${v}, sw.js VERSION=${swV}`);
    }
  }
  const keys = games.map(g => g.storageKey);
  if (new Set(keys).size !== keys.length) fail('게임 저장 키 중복');
  if (games[0].storageKey !== 'tilematch.save.v1') fail('타일 매치 기존 저장 키(tilematch.save.v1)가 바뀜');
  for (const h of htmls) {
    const tags = read(h).match(/\?v=\d+/g) || [];
    if (!tags.length || tags.some(t => t !== `?v=${swV}`)) fail(`${h} 버전 태그 불일치: ${tags.join(',')} (sw.js VERSION=${swV})`);
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
{
  console.log('[5] 고스톱 패 구성 / 점수 계산');
  const C = GS.CARDS;
  const count = k => C.filter(c => c.kind === k).length;
  if (C.length !== 48) fail(`패 수 ${C.length}`);
  for (let m = 1; m <= 12; m++) if (C.filter(c => c.month === m).length !== 4) fail(`${m}월 패가 4장이 아님`);
  if (count('gwang') !== 5 || count('yeol') !== 9 || count('tti') !== 10 || count('pi') !== 24) fail('광/열/띠/피 장수 이상');
  if (C.filter(c => c.bird).length !== 3) fail('고도리 새 3장이 아님');
  for (const d of ['hong', 'cheong', 'cho']) if (C.filter(c => c.dan === d).length !== 3) fail(`${d}단 3장이 아님`);
  const ids = f => C.filter(f).map(c => c.id);
  const eq = (name, got, want) => { if (got !== want) fail(`${name}: ${got} (기대 ${want})`); };
  eq('3광(비광 없음)', GS.score(ids(c => c.kind === 'gwang' && !c.rain).slice(0, 3)).total, 3);
  eq('3광(비광 포함)', GS.score([...ids(c => c.kind === 'gwang' && !c.rain).slice(0, 2), ...ids(c => c.rain)]).total, 2);
  eq('4광', GS.score(ids(c => c.kind === 'gwang').slice(0, 4)).total, 4);
  eq('5광', GS.score(ids(c => c.kind === 'gwang')).total, 15);
  eq('고도리', GS.score(ids(c => c.bird)).total, 5);
  eq('홍단', GS.score(ids(c => c.dan === 'hong')).total, 3);
  eq('띠 5장 + 청단', GS.score([...ids(c => c.dan === 'cheong'), ...ids(c => c.dan === 'cho').slice(0, 2)]).total, 3 + 1);
  eq('열끗 6장(고도리 없음)', GS.score(ids(c => c.kind === 'yeol' && !c.bird).slice(0, 6)).total, 2);
  eq('피 10장', GS.score(ids(c => c.kind === 'pi' && c.pi === 1).slice(0, 10)).total, 1);
  eq('쌍피 포함 피 12', GS.score([...ids(c => c.pi === 2), ...ids(c => c.pi === 1).slice(0, 8)]).total, 3);
  eq('피 9장', GS.score(ids(c => c.pi === 1).slice(0, 9)).total, 0);
}
{
  console.log('[6] 고스톱 특수 상황 (쪽/뻑/따닥/싹쓸이/뻑 먹기/고박)');
  const C = GS.CARDS;
  const of = (m, k) => C.filter(c => c.month === m && (!k || c.kind === k)).map(c => c.id);
  // 빈 판을 만들어 원하는 상황을 구성
  const base = () => ({ deck: [], floor: [], hands: [[], []], captured: [[], []], turn: 0, first: 0, go: [0, 0], goScore: [0, 0], ppeok: {}, pending: null, phase: 'play', over: null, last: null });
  const opPi = () => of(11, 'pi').filter(id => C[id].pi === 1).slice(0, 2); // 상대가 가진 피 2장
  const filler = of(10, 'pi')[0]; // 더미가 비지 않게 (싹쓸이 판정용)

  // 쪽: 바닥에 3월 없음, 3월 광을 내고 3월 피를 뒤집음
  let s = base(); s.hands[0] = [of(3, 'gwang')[0]]; s.hands[1] = [of(5)[0]]; s.floor = [of(1, 'pi')[0]];
  s.deck = [filler, of(3, 'pi')[0]]; s.captured[1] = opPi();
  GS.play(s, of(3, 'gwang')[0]); let r = GS.flip(s);
  if (!r.events.includes('jjok') || r.stolen.length !== 1 || s.captured[0].length !== 3) fail(`쪽 처리 이상 ${JSON.stringify(r)}`);

  // 뻑: 바닥 4월 1장, 4월 패를 내고 4월을 뒤집음 → 3장 바닥에 남음, 이후 4번째 4월로 가져가면 피 1장
  s = base(); const m4 = of(4); s.hands[0] = [m4[1]]; s.hands[1] = [m4[3], of(6)[0]]; s.floor = [m4[0], of(1, 'pi')[0]];
  s.deck = [filler, of(9, 'pi')[0], m4[2]]; s.captured[0] = opPi();
  GS.play(s, m4[1]); r = GS.flip(s);
  if (!r.events.includes('ppeok') || s.floor.filter(id => C[id].month === 4).length !== 3 || s.ppeok[4] !== 0) fail('뻑 처리 이상');
  GS.endTurn(s); // 컴퓨터 차례
  GS.play(s, m4[3]); r = GS.flip(s);
  if (!r.events.includes('ppeokTake') || r.stolen.length !== 1 || s.captured[1].filter(id => C[id].month === 4).length !== 4) fail(`뻑 먹기 이상 ${JSON.stringify(r)}`);

  // 따닥: 바닥 7월 2장, 7월을 내고 7월을 뒤집음 → 4장 + 피 1장
  s = base(); const m7 = of(7); s.hands[0] = [m7[2]]; s.hands[1] = [of(6)[0]]; s.floor = [m7[0], m7[1], of(1, 'pi')[0]];
  s.deck = [filler, m7[3]]; s.captured[1] = opPi();
  GS.play(s, m7[2], m7[0]); r = GS.flip(s);
  if (!r.events.includes('ttadak') || s.captured[0].filter(id => C[id].month === 7).length !== 4 || r.stolen.length !== 1) fail('따닥 처리 이상');

  // 싹쓸이: 바닥 2장을 모두 가져감
  s = base(); s.hands[0] = [of(2)[0]]; s.hands[1] = [of(6)[0]]; s.floor = [of(2)[1], of(9)[0]];
  s.deck = [filler, of(9)[1]]; s.captured[1] = opPi();
  GS.play(s, of(2)[0]); r = GS.flip(s);
  if (!r.events.includes('sseul') || s.floor.length !== 0 || r.stolen.length !== 1) fail(`싹쓸이 처리 이상 ${JSON.stringify(r)}`);

  // 같은 달 2장 중 고르기: 낸 패로 띠를 고르면 띠를 가져감
  s = base(); const m6 = of(6); s.hands[0] = [m6[0]]; s.hands[1] = [of(5)[0]]; s.floor = [m6[1], m6[2]];
  s.deck = [filler, of(12, 'gwang')[0]];
  if (!GS.handOptions(s, m6[0])) fail('고르기 후보가 없음');
  GS.play(s, m6[0], m6[2]); GS.flip(s);
  if (!s.captured[0].includes(m6[2]) || !s.floor.includes(m6[1])) fail('고른 패를 가져가지 않음');

  // 고박: 컴퓨터가 고를 했는데 내가 이기면 ×2
  s = base(); s.go = [0, 1]; s.hands[0] = [of(5)[0]]; s.phase = 'gostop';
  s.captured[0] = [...of(1, 'gwang'), ...of(3, 'gwang'), ...of(8, 'gwang'), ...of(2, 'yeol'), ...of(4, 'yeol')];
  s.captured[1] = [of(11, 'gwang')[0], ...of(1, 'pi')];
  GS.decide(s, false);
  if (!s.over || s.over.winner !== 0 || !s.over.lines.some(l => l[0] === '고박') || s.over.points !== 6) fail(`고박/점수 이상 ${JSON.stringify(s.over)}`);
}
{
  console.log('[7] 고스톱 컴퓨터끼리 2000판: 패 보존 / 종료 / 규칙 상황 발생');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const seen = {}, results = { win0: 0, win1: 0, draw: 0 };
  let broken = 0;
  for (let g = 0; g < 2000 && broken < 5; g++) {
    const s = GS.newRound(rnd, g % 2);
    for (let step = 0; step < 100 && s.phase !== 'over'; step++) {
      if (s.phase === 'gostop') { GS.decide(s, GS.aiGoStop(s)); continue; }
      const { card, choice } = GS.aiPick(s, rnd);
      GS.play(s, card, choice);
      const opts = GS.flipOptions(s);
      const r = GS.flip(s, opts ? GS.bestCard(opts) : null);
      r.events.forEach(e => { seen[e] = (seen[e] || 0) + 1; });
      GS.endTurn(s);
      // 48장이 정확히 한 번씩 있어야 함
      const all = [...s.deck, ...s.floor, ...s.hands[0], ...s.hands[1], ...s.captured[0], ...s.captured[1]];
      if (all.length !== 48 || new Set(all).size !== 48) { broken++; fail(`패 보존 깨짐 (판 ${g})`); break; }
      // 바닥에 같은 달이 4장 이상 쌓이면 안 됨
      const fc = {};
      s.floor.forEach(id => { fc[GS.month(id)] = (fc[GS.month(id)] || 0) + 1; });
      if (Object.values(fc).some(v => v >= 4)) { broken++; fail(`바닥에 같은 달 4장 (판 ${g})`); break; }
    }
    if (s.phase !== 'over') { broken++; fail(`판이 끝나지 않음 (판 ${g})`); continue; }
    if (s.over.draw) results.draw++; else results['win' + s.over.winner]++;
    if (!s.over.draw && !(s.over.points >= GS.WIN_SCORE)) fail(`이긴 점수가 7점 미만 (판 ${g}): ${s.over.points}`);
  }
  console.log(`  결과 ${JSON.stringify(results)}  발생: ${JSON.stringify(seen)}`);
  for (const e of ['jjok', 'ppeok', 'ttadak', 'sseul', 'ppeokTake']) if (!seen[e]) fail(`2000판 동안 '${e}' 가 한 번도 없음`);
}

console.log(failures ? `\n실패 ${failures}건` : '\n모든 테스트 통과');
process.exit(failures ? 1 : 0);
