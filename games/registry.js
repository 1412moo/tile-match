// 게임 목록 (메인 화면과 서비스 워커가 함께 읽는다)
// 새 게임 추가: games/<id>/ 폴더를 만들고 여기에 항목 하나를 추가한다.
//   - ready: false 이면 메인 화면에 '준비중'으로 표시되고 들어갈 수 없다.
//   - hidden: true 이면 메인 화면 목록에 아예 보이지 않는다 (만드는 중인 게임을 숨길 때. 폴더와 항목은 그대로 둠).
//   - files: 오프라인 저장할 파일 (path 기준 상대경로). ready 인 게임만 캐시된다.
//   - storageKey: 게임별 저장 키. 다른 게임과 겹치지 않게 '<id>.save.v1' 형식을 쓴다.
//   - summary(save): 메인 화면 카드에 보여 줄 한 줄 진행 상황 (선택)
(function (root) {
  'use strict';
  // 앱 전체 버전 (sw.js VERSION, 각 게임 APP_VERSION, HTML 의 ?v= 와 같게 - tools/test.js 가 확인)
  root.APP_VERSION = 19;
  root.GAME_REGISTRY = [
    {
      id: 'tile-match',
      name: '타일 매치',
      icon: '🍓',
      desc: '같은 그림 3개 모으기',
      path: 'games/tile-match/',
      ready: true,
      storageKey: 'tilematch.save.v1', // 기존 저장 키 그대로 (바꾸지 말 것)
      files: ['', 'index.html', 'style.css', 'levels.js', 'game.js'],
      summary: s => (s.current ? `레벨 ${s.current.level} 하던 판 있어요` : `레벨 ${s.level} 차례예요`),
    },
    {
      id: 'gostop',
      name: '고스톱',
      icon: '🃏',
      desc: '컴퓨터와 둘이 치는 맞고',
      path: 'games/gostop/',
      ready: true,
      storageKey: 'gostop.save.v1',
      files: ['', 'index.html', 'style.css', 'rules.js', 'art.js', 'fx.js', 'game.js'].concat(
        // 화투패 그림 48장 (Wikimedia Commons Hwatu SVG, CC BY-SA 4.0 - cards/ATTRIBUTION.md)
        ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
          .flatMap((m, i) => (i === 10 ? ['Hikari', 'Kasu_1', 'Kasu_2', 'Kasu_3'] : i === 11 ? ['Hikari', 'Tane', 'Tanzaku', 'Kasu']
            : [[0, 2, 7].includes(i) ? 'Hikari' : 'Tane', i === 7 ? 'Tane' : 'Tanzaku', 'Kasu_1', 'Kasu_2']).map(k => `cards/Hwatu_${m}_${k}.svg`))),
      summary: s => {
        if (s.current) return '하던 판 있어요';
        const t = s.stats || {};
        return (t.wins || t.losses || t.draws) ? `${t.wins || 0}승 ${t.losses || 0}패` : '';
      },
    },
    {
      id: 'spot-difference',
      name: '틀린그림찾기',
      icon: '🔍',
      desc: '두 그림에서 다른 곳 찾기',
      path: 'games/spot-difference/',
      ready: false,
      hidden: true, // 아직 샘플만 있음 - 완성되면 이 줄을 지우고 ready: true
      storageKey: 'spot-difference.save.v1',
      files: [],
    },
    {
      id: 'watermelon',
      name: '수박게임',
      icon: '🍉',
      desc: '같은 과일을 합쳐 수박 만들기',
      path: 'games/watermelon/',
      ready: true,
      storageKey: 'watermelon.save.v1',
      files: ['', 'index.html', 'style.css', 'physics.js', 'core.js', 'art.js', 'game.js'],
      summary: s => (s.current ? `하던 판 ${(s.current.score | 0).toLocaleString('ko-KR')}점` : s.best ? `최고 ${s.best.toLocaleString('ko-KR')}점` : ''),
    },
    {
      id: 'match-3',
      name: '보석 맞추기',
      icon: '💎',
      desc: '같은 보석 3개를 한 줄로 맞추기',
      path: 'games/match-3/',
      ready: true,
      storageKey: 'match-3.save.v1',
      files: ['', 'index.html', 'style.css', 'logic.js', 'game.js'],
      summary: s => (s.current ? `남은 ${s.current.moves}번 · ${(s.current.score | 0).toLocaleString('ko-KR')}점` : s.best ? `최고 ${s.best.toLocaleString('ko-KR')}점` : ''),
    },
  ];
})(typeof self !== 'undefined' ? self : this);
