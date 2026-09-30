// 영어 탐험대: 영어 단어 공부 게임 (뜻 맞추기 / 철자 조립 / 듣고 고르기)
// 한 판 10문제. 틀려도 끝나지 않고 끝까지 풀고, 틀린 문제는 마지막에 '복습'으로 한 번 더 나온다.
(function () {
'use strict';
const APP_VERSION = 23; // sw.js 의 VERSION 이하, 이 게임 HTML 의 ?v= 와 같게
const SAVE_KEY = 'english.save.v1';
const ROUND = 10;       // 한 판 문제 수

const WORDS=[
// 초급
["apple","사과",1],["book","책",1],["cat","고양이",1],["dog","개",1],["water","물",1],["house","집",1],["friend","친구",1],["school","학교",1],["happy","행복한",1],["big","큰",1],["small","작은",1],["red","빨간",1],["eat","먹다",1],["run","달리다",1],["sleep","자다",1],["family","가족",1],["mother","어머니",1],["father","아버지",1],["teacher","선생님",1],["study","공부하다",1],["morning","아침",1],["night","밤",1],["sun","태양",1],["tree","나무",1],["bird","새",1],["milk","우유",1],["read","읽다",1],["write","쓰다",1],["blue","파란",1],["love","사랑",1],
// 중급
["beautiful","아름다운",2],["difficult","어려운",2],["important","중요한",2],["remember","기억하다",2],["understand","이해하다",2],["knowledge","지식",2],["adventure","모험",2],["environment","환경",2],["experience","경험",2],["difference","차이",2],["decide","결정하다",2],["prepare","준비하다",2],["culture","문화",2],["health","건강",2],["journey","여행",2],["surprise","놀라움",2],["popular","인기 있는",2],["produce","생산하다",2],["language","언어",2],["dangerous","위험한",2],["improve","향상시키다",2],["borrow","빌리다",2],["increase","증가하다",2],["choose","선택하다",2],["neighbor","이웃",2],["weather","날씨",2],["custom","관습",2],["achieve","달성하다",2],["patient","인내심 있는",2],["expensive","비싼",2]
];
const $=id=>document.getElementById(id);
const app=$("app");
let S={xp:0,best:0,level:0}; // level: 고른 난이도 (0 전체, 1 초급, 2 중급)
try{const s=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');if(s)S=Object.assign(S,s)}catch(e){}
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
function beep(ok){
  const c=audio();if(!c)return;
  try{
    const o=c.createOscillator(),g=c.createGain(),t=c.currentTime;
    o.connect(g);g.connect(c.destination);
    o.frequency.value=ok?660:180;g.gain.value=.08;
    o.start(t);o.stop(t+(ok?.15:.3));
  }catch(e){}
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
  <div class="card">
    <button class="btn" data-mode="quiz">🎯 뜻 맞추기<small>영어 단어의 뜻을 골라요</small></button>
    <button class="btn" data-mode="spell">🔤 철자 조립<small>섞인 글자로 단어를 만들어요</small></button>
    ${canSpeak?`<button class="btn" data-mode="listen">🎧 듣고 고르기<small>발음을 듣고 단어를 골라요</small></button>`:""}
    <button class="btn alt" data-mode="mix">🎲 섞어서 풀기<small>세 가지 방식이 골고루 나와요</small></button>
  </div>
  <div class="card"><b>난이도</b>
    <select id="lv" class="lv">
      <option value="0">전체</option><option value="1">초급</option><option value="2">중급</option>
    </select></div>
  <p class="howto">한 판에 ${ROUND}문제예요. 틀려도 끝까지 풀 수 있고,<br>틀린 문제는 마지막에 한 번 더 나와요.</p>
  <p class="version">버전 ${APP_VERSION}</p>`;
  $("btn-hub").onclick=toHub;
  $("lv").value=String(S.level||0);
  $("lv").onchange=e=>{S.level=+e.target.value;save()};
  app.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{unlockSound();start(b.dataset.mode)});
}

// G: 지금 판. words: 이번 판 문제 [{w,type}], wrong: 틀린 문제, review: 복습 중인지
let G;
const pickType=mode=>mode==="mix"?(canSpeak?["quiz","spell","listen"]:["quiz","spell"])[Math.random()*(canSpeak?3:2)|0]:mode;
function start(mode){
  const lv=S.level||0;
  const pool=WORDS.filter(w=>!lv||w[2]===lv);
  G={mode,pool,words:shuffle(pool).slice(0,ROUND).map(w=>({w,type:pickType(mode)})),i:0,score:0,right:0,combo:0,
     wrong:[],review:false,reviewRight:0,locked:false};
  next();
}
function next(){
  if(G.i>=G.words.length){
    if(!G.review&&G.wrong.length)return reviewIntro();
    return finish();
  }
  const q=G.words[G.i];
  const head=G.review
    ?`<div class="top"><span class="tag">📝 복습 ${G.i+1} / ${G.words.length}</span><span>${G.score}점</span></div>`
    :`<div class="top"><span>${G.i+1} / ${G.words.length}</span><span>🔥 ${G.combo}콤보</span><span>${G.score}점</span></div>`;
  const bar=`<div class="bar"><div style="width:${G.i/G.words.length*100}%"></div></div>`;
  if(q.type==="quiz")quiz(q.w,head+bar);
  else if(q.type==="spell")spell(q.w,head+bar);
  else listen(q.w,head+bar);
}
// 10문제를 다 풀고 틀린 문제가 있으면: 복습 안내 → 틀린 문제를 같은 방식으로 한 번 더
function reviewIntro(){
  app.innerHTML=`<div class="card result"><div class="big">📝</div><h2>복습 시간</h2>
  <p class="center">틀린 단어 <b>${G.wrong.length}개</b>를 한 번 더 풀어 봐요.</p>
  <ul class="wordlist">${G.wrong.map(q=>`<li><b>${q.w[0]}</b> = ${q.w[1]}</li>`).join("")}</ul>
  <button class="btn" id="go">복습 시작</button></div>`;
  $("go").onclick=()=>{unlockSound();G.review=true;G.words=shuffle(G.wrong);G.i=0;G.combo=0;next()};
}
function options(w,field){ // field: 0 영어 1 한글
  const others=shuffle(G.pool.length>=4?G.pool:WORDS).filter(x=>x[0]!==w[0]).slice(0,3);
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
  setTimeout(()=>speak(w[0]),300);
}
function spell(w,head){
  const word=w[0],letters=shuffle(word.split("").map((c,i)=>({c,i})));
  let picked=[];
  app.innerHTML=head+`<div class="card"><div class="hint">"${w[1]}" 을(를) 영어로 쓰면?</div>
  <div class="slots" id="slots"></div><div class="tiles" id="tiles"></div>
  <div class="hint small">잘못 놓은 글자는 위 칸을 눌러 빼요</div>
  ${soundBtn("🔊 힌트 (발음)","btn alt")}<div class="msg" id="msg"></div></div>`;
  if(canSpeak)$("snd").onclick=()=>speak(word);
  const draw=()=>{
    $("slots").innerHTML=word.split("").map((_,k)=>`<div class="slot" data-k="${k}">${picked[k]?picked[k].c:""}</div>`).join("");
    $("tiles").innerHTML=letters.map(l=>`<button class="tile ${picked.includes(l)?"used":""}" data-i="${l.i}">${l.c}</button>`).join("");
    $("slots").querySelectorAll(".slot").forEach(s=>s.onclick=()=>{if(G.locked)return;picked.splice(+s.dataset.k,1);draw()});
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
  beep(ok);
  const m=$("msg");
  if(ok){
    if(G.review){G.reviewRight++;G.score+=5}
    else{G.right++;G.combo++;G.score+=10+Math.min(G.combo,5)*2}
    m.className="msg ok pop";m.textContent="정답! 🎉 "+w[0]+" = "+w[1];
  }else{
    G.combo=0;
    if(!G.review)G.wrong.push(G.words[G.i]);
    m.className="msg bad";m.textContent="아쉬워요 😢 정답: "+w[0]+" = "+w[1];
  }
  speak(w[0]);
  setTimeout(()=>{G.i++;G.locked=false;next()},ok?1600:2200);
}
function finish(){
  const xp=Math.round(G.score/2);
  const oldLv=level();
  S.xp+=xp;
  if(G.score>S.best)S.best=G.score;
  save();
  const up=level()>oldLv;
  const all=G.right===ROUND;
  app.innerHTML=`<div class="card result"><div class="big">${all?"🏆":G.right>=7?"🎉":"💪"}</div>
  <h2>${all?"모두 맞혔어요!":"한 판 완료!"}</h2>
  <p class="center big-line">${ROUND}문제 중 <b>${G.right}개</b> 맞혔어요</p>
  ${G.wrong.length?`<p class="center">복습에서 <b>${G.reviewRight} / ${G.wrong.length}</b> 다시 맞혔어요</p>`:""}
  <p class="center big-line">점수 <b>${G.score}</b> · 획득 XP <b>+${xp}</b></p>
  ${up?`<p class="center levelup">⭐ 레벨 업! Lv.${level()}</p>`:""}
  <button class="btn" id="again">다시 도전</button>
  <button class="btn alt" id="goHome">처음 화면으로</button></div>`;
  $("again").onclick=()=>{unlockSound();start(G.mode)};
  $("goHome").onclick=home;
}
home();

// 확인용 (개발자 도구에서 사용)
window.__en={get G(){return G},get ac(){return ac}};

// 오프라인 실행을 위한 서비스 워커 (http(s)로 열었을 때만)
if('serviceWorker' in navigator&&location.protocol.startsWith('http')){
  navigator.serviceWorker.register('../../sw.js',{scope:'../../'}).catch(()=>{});
}
})();
