// 영어 탐험대: 영어 단어 공부 게임 (뜻 맞추기 / 철자 조립 / 듣고 고르기)
// 한 판 10문제. 틀려도 끝나지 않고 끝까지 풀고, 틀린 문제는 마지막에 '복습'으로 한 번 더 나온다.
// 난이도(쉬움·보통·어려움): 단어 수준 + 보기 수 + 철자 조립 도움(첫 글자)/방해(헷갈리는 글자)가 함께 바뀐다.
(function () {
'use strict';
const APP_VERSION = 26; // sw.js 의 VERSION 이하, 이 게임 HTML 의 ?v= 와 같게
const SAVE_KEY = 'english.save.v1';
const ROUND = 10;       // 한 판 문제 수

const WORDS=[
// 초급
["apple","사과",1],["book","책",1],["cat","고양이",1],["dog","개",1],["water","물",1],["house","집",1],["friend","친구",1],["school","학교",1],["happy","행복한",1],["big","큰",1],["small","작은",1],["red","빨간",1],["eat","먹다",1],["run","달리다",1],["sleep","자다",1],["family","가족",1],["mother","어머니",1],["father","아버지",1],["teacher","선생님",1],["study","공부하다",1],["morning","아침",1],["night","밤",1],["sun","태양",1],["tree","나무",1],["bird","새",1],["milk","우유",1],["read","읽다",1],["write","쓰다",1],["blue","파란",1],["love","사랑",1],
// 중급
["beautiful","아름다운",2],["difficult","어려운",2],["important","중요한",2],["remember","기억하다",2],["understand","이해하다",2],["knowledge","지식",2],["adventure","모험",2],["environment","환경",2],["experience","경험",2],["difference","차이",2],["decide","결정하다",2],["prepare","준비하다",2],["culture","문화",2],["health","건강",2],["journey","여행",2],["surprise","놀라움",2],["popular","인기 있는",2],["produce","생산하다",2],["language","언어",2],["dangerous","위험한",2],["improve","향상시키다",2],["borrow","빌리다",2],["increase","증가하다",2],["choose","선택하다",2],["neighbor","이웃",2],["weather","날씨",2],["custom","관습",2],["achieve","달성하다",2],["patient","인내심 있는",2],["expensive","비싼",2],
// 고급
["opportunity","기회",3],["responsibility","책임",3],["efficient","효율적인",3],["consequence","결과",3],["persuade","설득하다",3],["available","이용 가능한",3],["necessary","필요한",3],["ancient","고대의",3],["challenge","도전",3],["atmosphere","분위기",3],["convenient","편리한",3],["establish","설립하다",3],["emergency","비상사태",3],["independent","독립적인",3],["influence","영향",3],["maintain","유지하다",3],["negotiate","협상하다",3],["obvious","명백한",3],["particular","특정한",3],["recognize","알아보다",3],["significant","상당한",3],["temporary","일시적인",3],["volunteer","자원봉사자",3],["anxious","불안한",3],["curious","호기심 많은",3],["generous","너그러운",3],["comfortable","편안한",3],["disappear","사라지다",3],["encourage","격려하다",3],["frequently","자주",3]
];
// 난이도: 단어 수준(lv), 보기 수, 철자 조립 첫 글자 미리 놓기(first), 헷갈리는 글자 수(decoy), XP 배수
const DIFF={
  1:{name:"쉬움",icon:"🌱",lv:1,opts:3,first:true,decoy:0,xp:1,desc:"초급 단어 · 보기 3개 · 철자는 첫 글자를 알려 줘요"},
  2:{name:"보통",icon:"🌿",lv:2,opts:4,first:false,decoy:0,xp:1.5,desc:"중급 단어 · 보기 4개 · XP 1.5배"},
  3:{name:"어려움",icon:"🌳",lv:3,opts:4,first:false,decoy:2,xp:2,desc:"고급 단어 · 철자에 헷갈리는 글자 2개 · XP 2배"}
};
const $=id=>document.getElementById(id);
const app=$("app");
let S={xp:0,best:0}; // diff: 고른 난이도 (1 쉬움, 2 보통, 3 어려움)
try{const s=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');if(s)S=Object.assign(S,s)}catch(e){}
if(!DIFF[S.diff])S.diff=S.level===2?2:1; // 예전 저장(level: 0 전체 / 1 초급 / 2 중급) → diff
delete S.level;
const save=()=>{try{localStorage.setItem(SAVE_KEY,JSON.stringify(S))}catch(e){}};
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
const level=()=>Math.floor(S.xp/100)+1;

// ---------- 소리 ----------
// 효과음: AudioContext 하나를 만들어 계속 씀 (답할 때마다 새로 만들면 휴대폰에서 개수 제한에 걸려 소리가 끊김)
let ac=null;
function audio(){
  try{
    if(!ac){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;ac=new AC()}
    if(ac.state==='suspended')ac.resume();
  }catch(e){return null}
  return ac;
}
// 음 하나 (부드럽게 켜졌다 꺼지는 소리)
function tone(c,f,at,dur,type,vol){
  const o=c.createOscillator(),g=c.createGain(),t=c.currentTime+at;
  o.type=type;o.frequency.setValueAtTime(f,t);
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+dur+.05);
}
// 한 판 끝: 빰빠밤~ 빠바밤! (다 맞히면 한 소절 더 높게)
function fanfare(perfect){
  const c=audio();if(!c)return;
  try{
    [[523,0],[523,.12],[523,.24],[659,.36]].forEach(([f,t])=>tone(c,f,t,.14,'triangle',.22));
    [523,659,784].forEach(f=>tone(c,f,.56,.42,'triangle',.18));
    [[784,1.0],[880,1.12]].forEach(([f,t])=>tone(c,f,t,.14,'triangle',.22));
    [659,784,1047].forEach(f=>{tone(c,f,1.26,.9,'triangle',.18);tone(c,f*2,1.26,.6,'sine',.04)});
    if(perfect){
      [1047,1175,1319,1568].forEach((f,i)=>tone(c,f,2.2+i*.09,.16,'square',.05));
      [1047,1319,1568,2093].forEach(f=>tone(c,f,2.6,1,'triangle',.12));
    }
  }catch(e){}
}
// 정답: 짧은 축하 소리 (0.5초 남짓). 세 가지 가락 중 하나를 골라 매번 같지 않게,
// 콤보가 이어질수록 한 음씩(2반음) 높아져 신나게 (최대 5단계)
const CHEERS=[
  [[523,0],[659,.07],[784,.14],[1047,.21,.34]],          // 도미솔도~
  [[784,0],[1047,.08],[988,.16],[1319,.24,.32]],         // 솔도시미~
  [[659,0],[784,.07],[880,.14],[1175,.21],[1319,.3,.3]]  // 미솔라레미~
];
function cheer(step){
  const c=audio();if(!c)return;
  try{
    const k=Math.pow(2,Math.min(step,5)*2/12);
    const notes=CHEERS[Math.random()*CHEERS.length|0];
    notes.forEach(([f,t,dur])=>{
      tone(c,f*k,t,dur||.1,'triangle',.2);
      if(dur)tone(c,f*k*2,t,dur*.8,'sine',.05); // 마지막 음: 반짝
    });
  }catch(e){}
}
// 오답: 낮게 '뿌웅'
function buzz(){
  const c=audio();if(!c)return;
  try{tone(c,220,0,.16,'triangle',.16);tone(c,165,.15,.3,'triangle',.16)}catch(e){}
}
// 발음: 휴대폰 음성 합성. 없는 기기에서는 발음 기능을 숨김
const canSpeak='speechSynthesis' in window&&'SpeechSynthesisUtterance' in window;
function speak(t){
  if(!canSpeak)return;
  try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang="en-US";u.rate=.85;speechSynthesis.speak(u)}catch(e){}
}
// 첫 터치 때 소리 준비: 아이폰 등은 사용자가 누른 순간에만 소리를 켤 수 있어서,
// 게임을 시작하는 버튼을 누를 때 효과음 장치를 깨우고 빈 발음을 한 번 해 둔다
let unlocked=false;
function unlockSound(){
  audio();
  if(unlocked||!canSpeak)return;
  unlocked=true;
  try{const u=new SpeechSynthesisUtterance(" ");u.volume=0;speechSynthesis.speak(u)}catch(e){}
}
document.addEventListener('pointerdown',()=>audio(),{passive:true});

// 게임 모음 메인 화면으로: 메인에서 들어왔으면 뒤로 가기(기록이 쌓이지 않게), 아니면 이동
function toHub(){
  let fromHub=false;
  try{fromHub=sessionStorage.getItem('hub.opened')==='1'}catch(e){}
  if(fromHub&&history.length>1)history.back();
  else location.replace('../../');
}

function home(){
  app.innerHTML=`
  <button class="hub-back" id="btn-hub">← 게임 목록</button>
  <h1>🌍 영어 탐험대</h1><div class="sub">단어를 모으며 영어 실력을 키워요!</div>
  <div class="card stats"><span>⭐ Lv.${level()}</span><span>✨ ${S.xp} XP</span><span>🏆 ${S.best}점</span></div>
  <div class="card"><b>난이도</b>
    <div class="diff">${Object.keys(DIFF).map(k=>`<button class="dbtn${+k===S.diff?" on":""}" data-d="${k}">${DIFF[k].icon}<br>${DIFF[k].name}</button>`).join("")}</div>
    <div class="ddesc">${DIFF[S.diff].desc}</div></div>
  <div class="card">
    <button class="btn" data-mode="quiz">🎯 뜻 맞추기<small>영어 단어의 뜻을 골라요</small></button>
    <button class="btn" data-mode="spell">🔤 철자 조립<small>섞인 글자로 단어를 만들어요</small></button>
    ${canSpeak?`<button class="btn" data-mode="listen">🎧 듣고 고르기<small>발음을 듣고 단어를 골라요</small></button>`:""}
    <button class="btn alt" data-mode="mix">🎲 섞어서 풀기<small>세 가지 방식이 골고루 나와요</small></button>
  </div>
  <p class="howto">한 판에 ${ROUND}문제예요. 틀려도 끝까지 풀 수 있고,<br>틀린 문제는 마지막에 한 번 더 나와요.</p>
  <p class="version">버전 ${APP_VERSION}</p>`;
  $("btn-hub").onclick=toHub;
  app.querySelectorAll("[data-d]").forEach(b=>b.onclick=()=>{S.diff=+b.dataset.d;save();home()});
  app.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{unlockSound();start(b.dataset.mode)});
}

// G: 지금 판. words: 이번 판 문제 [{w,type}], wrong: 틀린 문제, review: 복습 중인지
let G;
const pickType=mode=>mode==="mix"?(canSpeak?["quiz","spell","listen"]:["quiz","spell"])[Math.random()*(canSpeak?3:2)|0]:mode;
function start(mode){
  const diff=S.diff,pool=WORDS.filter(w=>w[2]===DIFF[diff].lv);
  G={mode,diff,pool,words:shuffle(pool).slice(0,ROUND).map(w=>({w,type:pickType(mode)})),i:0,score:0,right:0,combo:0,
     wrong:[],review:false,reviewRight:0,locked:false,done:false};
  enterGame();
  next();
}

// ---------- 그만하기 / 뒤로 가기 ----------
// 판을 시작하면 기록을 하나 쌓아 두고, 휴대폰 뒤로 가기를 누르면 바로 나가지 않고 한 번 물어본다
let skipPop=false;
function enterGame(){
  if(!(history.state&&history.state.en)){try{history.pushState({en:1},'')}catch(e){}}
}
function quit(){
  G=null;closeModal();
  try{speechSynthesis.cancel()}catch(e){}
  if(history.state&&history.state.en){skipPop=true;history.back()}
  home();
}
function closeModal(){const m=$("modal");if(m)m.remove()}
function askQuit(){
  if(!G||G.done)return quit();
  if($("modal"))return;
  const m=document.createElement("div");
  m.id="modal";m.className="modal-bg";
  m.innerHTML=`<div class="card modal"><div class="big">🚪</div><h2>그만할까요?</h2>
  <p class="center">지금 판은 점수에 들어가지 않아요.</p>
  <button class="btn" id="mq">그만하기</button><button class="btn alt" id="mc">계속 풀기</button></div>`;
  document.body.appendChild(m);
  $("mq").onclick=quit;$("mc").onclick=closeModal;
}
window.addEventListener("popstate",()=>{
  if(skipPop){skipPop=false;return}
  if(!G)return;
  if(G.done){G=null;closeModal();home();return}
  try{history.pushState({en:1},'')}catch(e){}
  if($("modal"))closeModal();else askQuit(); // 창이 떠 있을 때 뒤로 가기 = 계속 풀기
});
const gameBar=()=>`<div class="gbar"><button class="back" id="back">← 그만하기</button><span class="dtag">${DIFF[G.diff].icon} ${DIFF[G.diff].name}</span></div>`;

function next(){
  if(G.i>=G.words.length){
    if(!G.review&&G.wrong.length)return reviewIntro();
    return finish();
  }
  const q=G.words[G.i];
  const head=gameBar()+(G.review
    ?`<div class="top"><span class="tag">📝 복습 ${G.i+1} / ${G.words.length}</span><span>${G.score}점</span></div>`
    :`<div class="top"><span>${G.i+1} / ${G.words.length}</span><span>🔥 ${G.combo}콤보</span><span>${G.score}점</span></div>`);
  const bar=`<div class="bar"><div style="width:${G.i/G.words.length*100}%"></div></div>`;
  if(q.type==="quiz")quiz(q.w,head+bar);
  else if(q.type==="spell")spell(q.w,head+bar);
  else listen(q.w,head+bar);
  $("back").onclick=askQuit;
}
// 10문제를 다 풀고 틀린 문제가 있으면: 복습 안내 → 틀린 문제를 같은 방식으로 한 번 더
function reviewIntro(){
  app.innerHTML=gameBar()+`<div class="card result"><div class="big">📝</div><h2>복습 시간</h2>
  <p class="center">틀린 단어 <b>${G.wrong.length}개</b>를 한 번 더 풀어 봐요.</p>
  <ul class="wordlist">${G.wrong.map(q=>`<li><b>${q.w[0]}</b> = ${q.w[1]}</li>`).join("")}</ul>
  <button class="btn" id="go">복습 시작</button></div>`;
  $("go").onclick=()=>{unlockSound();G.review=true;G.words=shuffle(G.wrong);G.i=0;G.combo=0;next()};
  $("back").onclick=askQuit;
}
function options(w,field){ // field: 0 영어 1 한글. 보기 수는 난이도에 따라 3~4개
  const n=DIFF[G.diff].opts;
  const others=shuffle(G.pool.length>=n?G.pool:WORDS).filter(x=>x[0]!==w[0]).slice(0,n-1);
  return shuffle([w,...others]).map(x=>x[field]);
}
function optionsHTML(opts){
  return opts.map(o=>`<button class="btn opt" data-v="${o}">${o}</button>`).join("");
}
function bindOptions(w,answer){
  document.querySelectorAll(".opt").forEach(b=>b.onclick=()=>{
    if(G.locked)return;G.locked=true;
    const ok=b.dataset.v===answer;
    b.classList.add(ok?"ok":"bad");
    if(!ok)document.querySelectorAll(".opt").forEach(x=>{if(x.dataset.v===answer)x.classList.add("ok")});
    judge(ok,w);
  });
}
const soundBtn=(label,cls)=>canSpeak?`<button class="${cls}" id="snd">${label}</button>`:"";
function quiz(w,head){
  app.innerHTML=head+`<div class="card"><div class="hint">이 단어의 뜻은?</div><div class="q">${w[0]}</div>
  ${soundBtn("🔊 발음 듣기","btn alt")}
  ${optionsHTML(options(w,1))}<div class="msg" id="msg"></div></div>`;
  if(canSpeak)$("snd").onclick=()=>speak(w[0]);
  bindOptions(w,w[1]);
}
function listen(w,head){
  // 자동 발음은 기기가 막을 수 있음 (특히 아이폰) → 🔊 버튼을 크게 두고 누르면 언제든 다시 들림
  app.innerHTML=head+`<div class="card"><div class="hint">발음을 듣고 알맞은 단어를 골라요</div>
  <button class="speak" id="snd" aria-label="발음 듣기">🔊</button>
  <div class="hint small">소리가 안 들리면 🔊를 눌러 주세요</div>
  ${optionsHTML(options(w,0))}<div class="msg" id="msg"></div></div>`;
  $("snd").onclick=()=>speak(w[0]);
  bindOptions(w,w[0]);
  const g=G;
  setTimeout(()=>{if(G===g)speak(w[0])},300);
}
// 철자 조립: 쉬움은 첫 글자를 미리 놓아 주고, 어려움은 단어에 없는 글자 몇 개를 섞는다
function spell(w,head){
  const d=DIFF[G.diff],word=w[0];
  const decoys=[];
  for(let n=0;n<d.decoy;n++){
    const pool="abcdefghijklmnopqrstuvwxyz".split("").filter(c=>!word.includes(c)&&!decoys.some(x=>x.c===c));
    decoys.push({c:pool[Math.random()*pool.length|0],i:word.length+n});
  }
  const letters=shuffle([...word.split("").map((c,i)=>({c,i})),...decoys]);
  const fixed=d.first?1:0; // 앞에서부터 고정된 칸 수
  let picked=d.first?[letters.find(l=>l.i===0)]:[];
  app.innerHTML=head+`<div class="card"><div class="hint">"${w[1]}" 을(를) 영어로 쓰면?</div>
  <div class="slots" id="slots"></div><div class="tiles" id="tiles"></div>
  <div class="hint small">${d.first?"첫 글자는 미리 놓았어요 · ":""}${d.decoy?"필요 없는 글자도 섞여 있어요 · ":""}잘못 놓은 글자는 위 칸을 눌러 빼요</div>
  ${soundBtn("🔊 힌트 (발음)","btn alt")}<div class="msg" id="msg"></div></div>`;
  if(canSpeak)$("snd").onclick=()=>speak(word);
  const draw=()=>{
    $("slots").innerHTML=word.split("").map((_,k)=>`<div class="slot${k<fixed?" fixed":""}" data-k="${k}">${picked[k]?picked[k].c:""}</div>`).join("");
    $("tiles").innerHTML=letters.map(l=>`<button class="tile ${picked.includes(l)?"used":""}" data-i="${l.i}">${l.c}</button>`).join("");
    $("slots").querySelectorAll(".slot").forEach(s=>s.onclick=()=>{if(G.locked||+s.dataset.k<fixed)return;picked.splice(+s.dataset.k,1);draw()});
    $("tiles").querySelectorAll(".tile").forEach(t=>t.onclick=()=>{
      if(G.locked)return;
      picked.push(letters.find(l=>l.i==t.dataset.i));draw();
      if(picked.length===word.length){
        G.locked=true;
        judge(picked.map(l=>l.c).join("")===word,w);
      }
    });
  };
  draw();
}
// 채점: 본 문제는 콤보 점수, 틀리면 복습 목록에 넣고 다음 문제로 (판은 끝나지 않음)
// 복습 문제는 맞히면 5점 (틀려도 답을 보여 주고 넘어감)
function judge(ok,w){
  const m=$("msg");
  if(ok){
    if(G.review){G.reviewRight++;G.score+=5}
    else{G.right++;G.combo++;G.score+=10+Math.min(G.combo,5)*2}
    cheer(G.review?0:G.combo-1);
    m.className="msg ok pop";m.textContent="정답! 🎉 "+w[0]+" = "+w[1];
  }else{
    buzz();
    G.combo=0;
    if(!G.review)G.wrong.push(G.words[G.i]);
    m.className="msg bad";m.textContent="아쉬워요 😢 정답: "+w[0]+" = "+w[1];
  }
  const g=G; // 그만하고 나갔으면 다음 문제로 넘어가지 않음
  setTimeout(()=>{if(G===g)speak(w[0])},ok?550:450); // 축하 소리가 끝난 뒤 발음
  setTimeout(()=>{if(G!==g)return;G.i++;G.locked=false;next()},ok?1600:2200);
}
function finish(){
  const d=DIFF[G.diff];
  const xp=Math.round(G.score/2*d.xp);
  G.done=true;
  const oldLv=level();
  S.xp+=xp;
  if(G.score>S.best)S.best=G.score;
  save();
  const up=level()>oldLv;
  const all=G.right===ROUND;
  app.innerHTML=`<div class="card result"><div class="big">${all?"🏆":G.right>=7?"🎉":"💪"}</div>
  <div class="center dtag">${d.icon} ${d.name}</div>
  <h2>${all?"모두 맞혔어요!":"한 판 완료!"}</h2>
  <p class="center big-line">${ROUND}문제 중 <b>${G.right}개</b> 맞혔어요</p>
  ${G.wrong.length?`<p class="center">복습에서 <b>${G.reviewRight} / ${G.wrong.length}</b> 다시 맞혔어요</p>`:""}
  <p class="center big-line">점수 <b>${G.score}</b> · 획득 XP <b>+${xp}</b>${d.xp>1?` <small>(${d.name} ×${d.xp})</small>`:""}</p>
  ${up?`<p class="center levelup">⭐ 레벨 업! Lv.${level()}</p>`:""}
  <button class="btn" id="again">다시 도전</button>
  <button class="btn alt" id="goHome">처음 화면으로</button></div>`;
  $("again").onclick=()=>{unlockSound();start(G.mode)};
  $("goHome").onclick=quit;
  fanfare(all);
}
home();

// 확인용 (개발자 도구에서 사용)
window.__en={get G(){return G},get ac(){return ac}};

// 오프라인 실행을 위한 서비스 워커 (http(s)로 열었을 때만)
if('serviceWorker' in navigator&&location.protocol.startsWith('http')){
  navigator.serviceWorker.register('../../sw.js',{scope:'../../'}).catch(()=>{});
}
})();
