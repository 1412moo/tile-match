// 게임 목록 (메인 화면과 서비스 워커가 함께 읽는다)
// 새 게임 추가: games/<id>/ 폴더를 만들고 여기에 항목 하나를 추가한다.
//   - ready: false 이면 메인 화면에 '준비중'으로 표시되고 들어갈 수 없다.
//   - files: 오프라인 저장할 파일 (path 기준 상대경로). ready 인 게임만 캐시된다.
//   - storageKey: 게임별 저장 키. 다른 게임과 겹치지 않게 '<id>.save.v1' 형식을 쓴다.
//   - summary(save): 메인 화면 카드에 보여 줄 한 줄 진행 상황 (선택)
(function (root) {
  'use strict';
  // 앱 전체 버전 (sw.js VERSION, 각 게임 APP_VERSION, HTML 의 ?v= 와 같게 - tools/test.js 가 확인)
  root.APP_VERSION = 8;
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
      desc: '화투로 즐기는 맞고',
      path: 'games/gostop/',
      ready: false,
      storageKey: 'gostop.save.v1',
      files: [],
    },
    {
      id: 'spot-difference',
      name: '틀린그림찾기',
      icon: '🔍',
      desc: '두 그림에서 다른 곳 찾기',
      path: 'games/spot-difference/',
      ready: false,
      storageKey: 'spot-difference.save.v1',
      files: [],
    },
    {
      id: 'watermelon',
      name: '수박게임',
      icon: '🍉',
      desc: '같은 과일을 합쳐 수박 만들기',
      path: 'games/watermelon/',
      ready: false,
      storageKey: 'watermelon.save.v1',
      files: [],
    },
  ];
})(typeof self !== 'undefined' ? self : this);
