// 오프라인 캐시 (서비스 워커)
// - 온라인: 항상 서버의 최신 파일을 먼저 사용(최대 3초 대기), 받은 파일은 캐시에 저장
// - 오프라인/응답 없음: 캐시에 저장된 파일로 바로 실행
// - 게임 진행 데이터(localStorage)는 여기서 절대 건드리지 않는다. 지우는 것은 예전 버전의 파일 캐시뿐.
const VERSION = 21; // games/registry.js 의 APP_VERSION, 각 게임 APP_VERSION, HTML 의 ?v= 와 함께 올린다
const CACHE = 'tilematch-v' + VERSION; // 이름 앞부분은 예전 캐시 정리를 위해 그대로 유지

// 게임 목록에서 준비된 게임의 파일을 가져와 함께 저장한다
importScripts('games/registry.js');
const READY_GAMES = (self.GAME_REGISTRY || []).filter(g => g.ready);
const ASSETS = ['./', 'index.html', 'hub.css', 'hub.js', 'games/registry.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']
  .concat(...READY_GAMES.map(g => g.files.map(f => g.path + f)));
// 예전 방식(캐시 우선)으로 화면을 띄운 버전들 - 이 버전에서 올라오면 열린 화면을 한 번 새로고침
const LEGACY_CACHES = ['tilematch-v1', 'tilematch-v2', 'tilematch-v3'];
const NETWORK_TIMEOUT = 3000;

self.addEventListener('install', e => {
  // cache: 'reload' - 브라우저 HTTP 캐시(GitHub Pages 10분)를 거치지 않고 서버에서 새로 받는다
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k.startsWith('tilematch-') && k !== CACHE);
    const fromLegacy = old.some(k => LEGACY_CACHES.includes(k));
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // 예전 버전 화면이 캐시로 떠 있다면 새 버전으로 한 번 다시 연다 (저장 데이터는 그대로)
    // navigate 완료를 기다리면 안 된다: 새로고침 요청은 활성화가 끝나야 처리되므로 서로 기다리며 멈춘다
    if (fromLegacy) {
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach(w => { w.navigate(w.url).catch(() => null); });
    }
  })());
});

function cacheKey(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.href;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = cacheKey(req.url);
    // 'no-cache': HTTP 캐시가 있어도 서버에 최신 여부를 확인(변경 없으면 304로 가볍게)
    const network = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(res => {
        if (res.ok) cache.put(key, res.clone());
        return res;
      });
    const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT, null));
    try {
      const res = await Promise.race([network, timeout]);
      if (res) return res;
    } catch (err) { /* 오프라인 - 아래에서 캐시 사용 */ }
    e.waitUntil(network.catch(() => null)); // 늦게라도 도착하면 캐시 갱신
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      // 게임 폴더 안의 주소면 그 게임 첫 화면, 아니면 메인 화면
      const path = new URL(req.url).pathname;
      const game = READY_GAMES.find(g => path.includes('/' + g.path));
      const page = (game && await cache.match(game.path + 'index.html')) ||
        await cache.match('index.html') || await cache.match('./');
      if (page) return page;
    }
    return network; // 캐시에도 없으면 네트워크 결과(또는 오류) 그대로
  })());
});
