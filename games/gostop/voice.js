// 같이 치기 음성대화 - 방에 들어가면 계속 연결되는 통화 (눌러서 말하기 아님). 브라우저: window.GSVoice, Node: module.exports
//   게임 데이터(DataConnection)와 같은 PeerJS Peer 위에 음성(MediaConnection)을 따로 하나 연다.
//   음성이 실패해도 게임 연결과 기록 동기화에는 영향이 없다. 서버에 음성을 보내거나 저장하지 않는다 (두 폰끼리 직접).
//
//   - 전화는 상대(guest)만 건다: 게임 연결이 열릴 때마다 예전 통화를 닫고 새로 건다. 방장은 받기만 하고,
//     새 전화가 오면 예전 통화를 닫는다 → 다시 연결·다음 판에서도 통화는 늘 하나.
//   - 마이크 권한을 거부해도(또는 마이크가 없어도) 무음 소리로 통화를 열어 상대 목소리는 들린다.
//     나중에 마이크를 켜면 보내는 소리만 마이크로 바꿔 끼운다 (통화를 다시 걸지 않음).
//   - 내 마이크 끄기 = 보내는 소리 끄기(track.enabled), 상대 소리 끄기 = 받는 소리 음소거(audio.muted)
//   - 휴대폰 자동재생 제한으로 상대 소리가 안 나오면 needTap → 화면의 '소리 켜기'를 한 번 누르면 재생
(function (root) {
  'use strict';

  const RETRY_MS = 3000;       // 통화가 끊기면 다시 걸기까지 (상대 쪽)
  const CONNECT_LIMIT = 15000; // 이 시간 안에 안 붙으면 '음성 연결 실패' 표시 (다시 걸기는 계속)
  const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };

  // env: { media(getUserMedia 가진 객체), makeAudio(), makeSilent() → MediaStream, now(), setTimeout, clearTimeout }
  // o: { role: 'host'|'guest', peer: () => 지금 Peer, send(msg) 데이터 통로로 보내기, onChange() 화면 다시 그리기 }
  class Voice {
    constructor(o, env) {
      this.o = o;
      this.env = env;
      this.state = 'off';       // off | connecting | on | lost | failed
      this.micWant = true;      // 내 마이크 켜기 (사용자가 끄면 false)
      this.micReady = false;    // 실제 마이크 소리를 받고 있음
      this.micDenied = false;   // 권한 거부 / 마이크 없음
      this.spkOn = true;        // 상대 소리 듣기
      this.volume = 1;
      this.oppMic = null;       // 상대 마이크 켜짐 여부 (상대가 알려 줌)
      this.needTap = false;     // 자동재생이 막혀 한 번 눌러야 함
      this.call = null;
      this.remoteId = null;     // 상대: 지금 게임 연결된 방장 id
      this.local = null;        // 보내는 소리 (마이크 또는 무음)
      this.silent = null;
      this.audio = null;
      this.stopped = false;
      this.timer = null;
      this.since = 0;
      this.localReady = null;
    }

    changed() { if (this.o.onChange) this.o.onChange(); }
    get micOn() { return this.micWant && this.micReady; }

    // 방에 들어갈 때: 마이크 권한을 묻고 보낼 소리를 준비 (통화는 게임 연결이 열린 뒤)
    start() {
      if (this.stopped) return Promise.resolve();
      if (!this.localReady) this.localReady = this.prepareLocal();
      return this.localReady;
    }
    async prepareLocal() {
      const m = this.env.media;
      if (m && m.getUserMedia) {
        try {
          const s = await m.getUserMedia(MIC);
          if (this.stopped) { stopStream(s); return; }
          this.useStream(s, true);
          return;
        } catch (e) {
          this.micDenied = true; // 거부·마이크 없음 → 무음으로라도 통화 (상대 소리는 들림)
        }
      } else this.micDenied = true;
      if (this.stopped) return;
      this.useStream(this.silentStream(), false);
    }
    silentStream() {
      if (!this.silent) this.silent = this.env.makeSilent();
      return this.silent;
    }
    useStream(s, isMic) {
      const old = this.local;
      this.local = s;
      this.micReady = isMic;
      if (isMic) this.micDenied = false;
      const t = s.getAudioTracks()[0];
      if (t) t.enabled = isMic ? this.micWant : true;
      // 이미 통화 중이면 보내는 소리만 바꿔 끼움
      if (this.call && this.call.peerConnection && t) {
        for (const sn of this.call.peerConnection.getSenders()) {
          if (!sn.track || sn.track.kind === 'audio') Promise.resolve(sn.replaceTrack(t)).catch(() => { /* 다음 통화에서 새 소리로 */ });
        }
      }
      if (old && old !== s && old !== this.silent) stopStream(old);
      this.tellMic();
      this.changed();
    }
    tellMic() { if (this.o.send) this.o.send({ t: 'voice', mic: this.micOn }); }

    // 게임 연결이 열림 (remoteId = 상대 Peer id). 상대(guest)만 전화를 건다
    async linked(remoteId) {
      if (this.stopped) return;
      this.remoteId = remoteId;
      this.tellMic();
      if (this.o.role !== 'guest') { if (!this.call) this.setState('connecting'); return; }
      await this.start();
      if (this.stopped || this.remoteId !== remoteId) return;
      this.dial();
    }
    unlinked() {
      this.remoteId = null;
      this.env.clearTimeout(this.timer);
      if (this.state === 'connecting') this.setState('lost');
    }
    dial() {
      this.env.clearTimeout(this.timer);
      const peer = this.o.peer();
      if (this.stopped || !this.remoteId || !peer || peer.destroyed || !this.local) return;
      this.closeCall();
      let call = null;
      try { call = peer.call(this.remoteId, this.local); } catch (e) { call = null; }
      if (!call) { this.failedSoon(); return; }
      this.adopt(call);
    }
    // 방장: 전화가 옴 → 예전 통화는 닫고 이 통화만 받는다
    async incoming(call) {
      if (this.stopped) { safeClose(call); return; }
      this.closeCall();
      this.adopt(call);
      await this.start();
      if (this.stopped || this.call !== call) return;
      try { call.answer(this.local); } catch (e) { this.dropped(call); return; }
      this.watchIce(call);
    }
    adopt(call) {
      this.call = call;
      this.since = this.env.now();
      if (this.state !== 'failed') this.setState('connecting'); // 실패 표시는 다시 걸어서 붙을 때까지 유지
      call.on('stream', s => { if (call === this.call) this.playRemote(s); });
      call.on('close', () => this.dropped(call));
      call.on('error', () => this.dropped(call));
      if (call.peerConnection) this.watchIce(call);
      this.env.clearTimeout(this.timer);
      this.timer = this.env.setTimeout(() => this.checkSlow(), CONNECT_LIMIT);
    }
    watchIce(call) {
      const pc = call.peerConnection;
      if (!pc || pc.__gsWatch) return;
      pc.__gsWatch = true;
      const onIce = () => {
        if (call !== this.call) return;
        const st = pc.iceConnectionState;
        if (st === 'connected' || st === 'completed') this.setState('on');
        else if (st === 'disconnected') this.setState('lost');   // 잠깐 끊김 (저절로 돌아오기도 함)
        else if (st === 'failed' || st === 'closed') this.dropped(call);
      };
      if (pc.addEventListener) pc.addEventListener('iceconnectionstatechange', onIce);
    }
    checkSlow() {
      if (this.stopped || this.state === 'on') return;
      this.setState('failed');
      if (this.o.role === 'guest' && this.remoteId) this.dial(); // 상대 쪽은 계속 다시 걸어 봄
    }
    // 통화가 끊김: 상대 소리 정리. 상대(guest)는 게임 연결이 살아 있으면 잠시 뒤 다시 건다
    dropped(call) {
      if (call !== this.call) return;
      this.closeCall();
      if (this.stopped) return;
      this.setState(this.remoteId ? 'lost' : 'failed');
      this.failedSoon();
    }
    failedSoon() {
      if (this.o.role !== 'guest' || !this.remoteId || this.stopped) return;
      this.env.clearTimeout(this.timer);
      this.timer = this.env.setTimeout(() => this.dial(), RETRY_MS);
    }
    closeCall() {
      const c = this.call;
      this.call = null;
      if (c) safeClose(c);
      if (this.audio) { try { this.audio.pause(); } catch (e) { /* 무시 */ } this.audio.srcObject = null; }
      this.needTap = false;
    }

    playRemote(stream) {
      if (!this.audio) this.audio = this.env.makeAudio();
      const a = this.audio;
      a.srcObject = stream;
      a.muted = !this.spkOn;
      a.volume = this.volume;
      this.setState('on');
      this.tryPlay();
    }
    tryPlay() {
      const a = this.audio;
      if (!a || !a.srcObject) return Promise.resolve();
      let p;
      try { p = a.play(); } catch (e) { p = Promise.reject(e); }
      return Promise.resolve(p).then(() => { if (this.needTap) { this.needTap = false; this.changed(); } },
        () => { if (a === this.audio && a.srcObject) { this.needTap = true; this.changed(); } });
    }
    // '소리 켜기' 버튼 (사용자 터치 안에서 부름)
    tap() { this.needTap = false; return this.tryPlay(); }

    // 내 마이크 켜기/끄기. 권한이 없었으면 켤 때 다시 묻는다
    async setMic(on) {
      this.micWant = !!on;
      if (on && !this.micReady && !this.stopped) {
        const m = this.env.media;
        try {
          const s = await m.getUserMedia(MIC);
          if (this.stopped) { stopStream(s); return 'ok'; }
          this.useStream(s, true);
        } catch (e) {
          this.micDenied = true;
          this.micWant = false;
          this.changed();
          return 'denied';
        }
      }
      const t = this.local && this.micReady && this.local.getAudioTracks()[0];
      if (t) t.enabled = this.micWant;
      this.tellMic();
      this.changed();
      return 'ok';
    }
    setSpeaker(on) {
      this.spkOn = !!on;
      if (this.audio) {
        this.audio.muted = !this.spkOn;
        if (this.spkOn) this.tryPlay(); // 켜는 터치로 자동재생 제한도 풀림
      }
      this.changed();
    }
    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.audio) this.audio.volume = this.volume;
      this.changed();
    }
    remote(m) { // 상대가 알려 준 마이크 상태
      this.oppMic = !!(m && m.mic);
      this.changed();
    }
    // 화면이 다시 보일 때 (휴대폰 화면 꺼짐·앱 전환 뒤): 멈춘 소리 다시 재생, 끊긴 통화 다시 걸기
    wake() {
      if (this.stopped) return;
      if (this.audio && this.audio.srcObject && this.audio.paused) this.tryPlay();
      if (this.o.role === 'guest' && this.remoteId && (!this.call || this.state === 'failed' || this.state === 'lost')) this.dial();
    }

    setState(st) {
      if (this.state === st) return;
      this.state = st;
      if (st === 'on') this.env.clearTimeout(this.timer);
      this.changed();
    }

    // 방을 나감: 통화 닫고 마이크·무음 소리 모두 멈춤 (마이크 사용 표시가 남지 않게)
    stop() {
      if (this.stopped) return;
      this.stopped = true;
      this.env.clearTimeout(this.timer);
      this.closeCall();
      if (this.local) stopStream(this.local);
      if (this.silent && this.silent !== this.local) stopStream(this.silent);
      if (this.env.closeSilent) this.env.closeSilent();
      this.local = null;
      this.silent = null;
      if (this.audio && this.audio.remove) this.audio.remove();
      this.audio = null;
      this.micReady = false;
      this.state = 'off';
      this.changed();
    }
  }

  function stopStream(s) { try { s.getTracks().forEach(t => t.stop()); } catch (e) { /* 무시 */ } }
  function safeClose(c) { try { c.close(); } catch (e) { /* 무시 */ } }

  // 브라우저용 기본 환경
  function browserEnv() {
    let ctx = null;
    return {
      media: root.navigator && root.navigator.mediaDevices,
      now: () => Date.now(),
      setTimeout: (f, ms) => root.setTimeout(f, ms),
      clearTimeout: t => root.clearTimeout(t),
      makeAudio: () => {
        const a = root.document.createElement('audio');
        a.autoplay = true;
        a.setAttribute('playsinline', '');
        a.className = 'voice-audio';
        root.document.body.appendChild(a);
        return a;
      },
      // 마이크가 없을 때 보낼 무음 소리 (전화를 걸려면 소리 통로가 하나 있어야 함)
      makeSilent: () => {
        const AC = root.AudioContext || root.webkitAudioContext;
        ctx = new AC();
        return ctx.createMediaStreamDestination().stream;
      },
      closeSilent: () => { if (ctx) { try { ctx.close(); } catch (e) { /* 무시 */ } ctx = null; } },
    };
  }

  const api = { Voice, browserEnv, RETRY_MS, CONNECT_LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GSVoice = api;
})(typeof window !== 'undefined' ? window : this);
