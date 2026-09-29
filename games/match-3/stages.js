// 보석 맞추기 스테이지 (데이터 + 진행 저장 도우미)
// 스테이지 추가: STAGES 에 한 줄만 더 넣으면 된다.
//   moves  : 움직일 수 있는 횟수
//   colors : 보석 종류 수 (5 = 쉬움, 6 = 보통)
//   goals  : 목표 (모두 채우면 성공 확정, 남은 횟수로 점수를 더 모을 수 있음)
//            { type: 'score', target }       점수 target 점
//            { type: 'color', color, count } color 색 보석 count 개 지우기 (0 빨강 1 주황 2 노랑 3 초록 4 파랑 5 보라)
//            { type: 'special', count }      특수 보석(줄·폭탄·무지개) count 개 만들기
//   stars  : [★2 점수, ★3 점수]  (★1 은 성공하면, 최종 점수로 판정)
//            v0.3: 목표를 채워도 끝까지 두므로 사람처럼 두는 자동 플레이어의 최종 점수 상위 40% / 10% 로 다시 잼
(function (root) {
  'use strict';

  const STAGES = [
    { id: 1, moves: 15, colors: 5, goals: [{ type: 'score', target: 800 }], stars: [3900, 5600] },
    { id: 2, moves: 15, colors: 5, goals: [{ type: 'score', target: 1500 }], stars: [4100, 6500] },
    { id: 3, moves: 16, colors: 5, goals: [{ type: 'score', target: 2200 }], stars: [4200, 6500] },
    { id: 4, moves: 15, colors: 5, goals: [{ type: 'color', color: 0, count: 12 }], stars: [3400, 5300] },
    { id: 5, moves: 15, colors: 5, goals: [{ type: 'color', color: 4, count: 18 }], stars: [3900, 5700] },
    { id: 6, moves: 18, colors: 6, goals: [{ type: 'color', color: 3, count: 18 }], stars: [2700, 3800] },
    { id: 7, moves: 16, colors: 5, goals: [{ type: 'special', count: 2 }], stars: [4400, 6300] },
    { id: 8, moves: 18, colors: 5, goals: [{ type: 'special', count: 3 }], stars: [4700, 7400] },
    { id: 9, moves: 18, colors: 6, goals: [{ type: 'color', color: 2, count: 15 }, { type: 'score', target: 2500 }], stars: [3400, 4400] },
    { id: 10, moves: 20, colors: 6, goals: [{ type: 'color', color: 5, count: 18 }, { type: 'special', count: 2 }, { type: 'score', target: 3000 }], stars: [3900, 4800] },
  ];

  const byId = id => STAGES.find(s => s.id === id) || null;

  // 받은 별: 실패 0, 성공 1, 점수가 기준을 넘으면 2·3
  function starsFor(stage, won, score) {
    if (!won) return 0;
    return 1 + (score >= stage.stars[0] ? 1 : 0) + (score >= stage.stars[1] ? 1 : 0);
  }

  // 진행 저장: { unlocked: 열린 가장 높은 스테이지, stars: {id: 별}, best: {id: 최고 점수} }
  function newProgress() { return { unlocked: 1, stars: {}, best: {} }; }

  // 스테이지 결과 반영 (새 객체를 돌려줌). 성공하면 다음 스테이지 열림, 별·최고 점수는 더 좋을 때만
  function applyResult(prog, stageId, won, score) {
    const p = JSON.parse(JSON.stringify(prog || newProgress()));
    const stage = byId(stageId);
    if (!stage) return p;
    if (won) {
      p.unlocked = Math.max(p.unlocked, Math.min(stageId + 1, STAGES.length));
      p.stars[stageId] = Math.max(p.stars[stageId] || 0, starsFor(stage, true, score));
      p.best[stageId] = Math.max(p.best[stageId] || 0, score);
    }
    return p;
  }

  const totalStars = prog => Object.values((prog && prog.stars) || {}).reduce((a, b) => a + b, 0);
  const allCleared = prog => !!(prog && prog.stars && prog.stars[STAGES.length]);

  // 저장 데이터 정리 (v0.1 → v0.2)
  //   - v0.1 의 '20번 자유 플레이' 하던 판(current 에 stage 가 없음)은 스테이지와 맞지 않아 버린다
  //   - v0.1 최고 점수(best)는 legacyBest 로 옮겨 보관만 한다 (화면에는 안 씀)
  //   - 소리 설정은 그대로
  function migrate(save) {
    const s = Object.assign({ sound: true }, save || {});
    if (s.v !== 2) {
      if (typeof s.best === 'number' && s.best > 0) s.legacyBest = s.best;
      delete s.best; delete s.games;
      s.v = 2;
    }
    if (s.current && !(s.current.stage && byId(s.current.stage) && s.current.st)) s.current = null;
    const p = s.progress || {};
    s.progress = {
      unlocked: Math.min(STAGES.length, Math.max(1, p.unlocked | 0)),
      stars: typeof p.stars === 'object' && p.stars ? p.stars : {},
      best: typeof p.best === 'object' && p.best ? p.best : {},
    };
    return s;
  }

  // 목표 글 (화면용)
  const COLOR_NAME = ['빨강', '주황', '노랑', '초록', '파랑', '보라'];
  function goalText(g) {
    if (g.type === 'score') return `${g.target.toLocaleString('ko-KR')}점 만들기`;
    if (g.type === 'color') return `${COLOR_NAME[g.color]} 보석 ${g.count}개 없애기`;
    return `특별한 보석 ${g.count}개 만들기`;
  }

  const api = { STAGES, byId, starsFor, newProgress, applyResult, totalStars, allCleared, migrate, goalText, COLOR_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.M3S = api;
})(typeof window !== 'undefined' ? window : this);
