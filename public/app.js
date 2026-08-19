import { shareUrl } from "./share.js?v=20260820-share1";

const elements = {
  entry: document.querySelector("#entry"),
  dashboard: document.querySelector("#dashboard"),
  boostChoice: document.querySelector("#boost-choice"),
  delegateButton: document.querySelector("#delegate-button"),
  reselectButton: document.querySelector("#reselect-button"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionLabel: document.querySelector("#connection-label"),
  volumeDial: document.querySelector("#volume-dial"),
  volumeNumber: document.querySelector("#volume-number"),
  sourceCard: document.querySelector("#source-card"),
  modeBadge: document.querySelector("#mode-badge"),
  postLink: document.querySelector("#post-link"),
  postTitle: document.querySelector("#post-title"),
  viewCount: document.querySelector("#view-count"),
  shareButton: document.querySelector("#share-button"),
  audioToggle: document.querySelector("#audio-toggle"),
  audioCaption: document.querySelector("#audio-caption"),
  youtubeFrame: document.querySelector("#youtube-frame"),
  youtubePlayer: document.querySelector("#youtube-player"),
  alertBanner: document.querySelector("#alert-banner"),
  alertTitle: document.querySelector("#alert-title"),
  alertCopy: document.querySelector("#alert-copy"),
  discordStatus: document.querySelector("#discord-status"),
};

const configuredApiBase = document
  .querySelector('meta[name="volume-api-base"]')
  ?.content.trim()
  .replace(/\/+$/, "");
const usePublicApi = window.location.hostname.endsWith(".github.io");
const FETCH_TIMEOUT_MS = 5000;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
const FALLBACK_SUCCESS_MS = 3000;
const YOUTUBE_API_TIMEOUT_MS = 15_000;
const YOUTUBE_API_URL = "https://www.youtube.com/iframe_api";
const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
const YOUTUBE_VIDEO_ID = "XsStb0xbF9Q";

function apiUrl(pathname) {
  return usePublicApi && configuredApiBase ? `${configuredApiBase}${pathname}` : pathname;
}

let youtubeApiPromise = null;

function resetYouTubeApiBootstrap() {
  if (window.YT?.Player) return;
  document.querySelector('#www-widgetapi-script[src^="https://www.youtube.com/"]')?.remove();
  window.YT = undefined;
  window.YTConfig = undefined;
  try {
    delete window.onYTReady;
  } catch {
    window.onYTReady = undefined;
  }
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    let script = null;
    let timeout = null;
    let settled = false;

    const cleanup = () => {
      if (timeout) window.clearTimeout(timeout);
      script?.removeEventListener("error", fail);
      if (window.onYouTubeIframeAPIReady === ready) {
        if (previousReady) window.onYouTubeIframeAPIReady = previousReady;
        else delete window.onYouTubeIframeAPIReady;
      }
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script?.remove();
      resetYouTubeApiBootstrap();
      reject(new Error("영상을 불러올 수 없습니다."));
    };
    const ready = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (typeof previousReady === "function") {
        try {
          previousReady();
        } catch {
          // The YouTube API itself is ready even if another consumer failed.
        }
      }
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        script?.remove();
        resetYouTubeApiBootstrap();
        reject(new Error("영상을 불러올 수 없습니다."));
      }
    };

    script = document.querySelector(`script[src="${YOUTUBE_API_URL}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = YOUTUBE_API_URL;
      script.async = true;
      document.head.append(script);
    }
    script.addEventListener("error", fail, { once: true });
    window.onYouTubeIframeAPIReady = ready;
    timeout = window.setTimeout(fail, YOUTUBE_API_TIMEOUT_MS);
  });

  youtubeApiPromise = youtubeApiPromise.catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });
  return youtubeApiPromise;
}

class YouTubeAudioEngine {
  constructor() {
    this.player = null;
    this.playerPromise = null;
    this.ready = false;
    this.playing = false;
    this.playRequested = false;
    this.soundRequested = false;
    this.unmuteAttempted = false;
    this.autoplayBlocked = false;
    this.errorMessage = null;
    this.volume = 0;
    this.soundCheckTimer = null;
    this.playerGeneration = 0;
    this.visible = !("IntersectionObserver" in window);
    this.visibilityObserver = null;

    if (!this.visible) {
      this.visibilityObserver = new IntersectionObserver(([entry]) => {
        this.visible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0.5);
        if (this.visible) this.applyPlayback();
      }, { threshold: [0, 0.51, 1] });
      this.visibilityObserver.observe(elements.youtubeFrame);
    }
  }

  createIframe() {
    const parameters = new URLSearchParams({
      controls: "0",
      disablekb: "1",
      enablejsapi: "1",
      iv_load_policy: "3",
      loop: "1",
      origin: window.location.origin,
      playlist: YOUTUBE_VIDEO_ID,
      playsinline: "1",
      rel: "0",
    });
    const iframe = document.createElement("iframe");
    iframe.id = "youtube-player-iframe";
    iframe.src = `${YOUTUBE_EMBED_ORIGIN}/embed/${YOUTUBE_VIDEO_ID}?${parameters}`;
    iframe.title = "볼륨 테스트 영상";
    iframe.allow = "autoplay; encrypted-media";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.loading = "eager";
    return iframe;
  }

  ensurePlayer() {
    if (this.playerPromise) return this.playerPromise;

    this.playerPromise = loadYouTubeApi().then((YT) => new Promise((resolve, reject) => {
      const generation = ++this.playerGeneration;
      const iframe = this.createIframe();
      let ready = false;
      let expired = false;
      let playerInstance = null;
      let loadTimeout = null;
      let playerTimeout = null;

      const clearAttemptTimers = () => {
        if (loadTimeout) window.clearTimeout(loadTimeout);
        if (playerTimeout) window.clearTimeout(playerTimeout);
        loadTimeout = null;
        playerTimeout = null;
      };
      const expireAttempt = () => {
        if (expired || ready) return;
        expired = true;
        clearAttemptTimers();
        try {
          playerInstance?.destroy?.();
        } catch {
          // The iframe can already be detached by a failed YouTube handshake.
        }
        if (this.player === playerInstance) this.player = null;
        if (iframe.isConnected) iframe.remove();
        reject(new Error("영상을 불러올 수 없습니다."));
      };

      loadTimeout = window.setTimeout(expireAttempt, YOUTUBE_API_TIMEOUT_MS);
      iframe.addEventListener("load", () => {
        if (expired) return;
        window.clearTimeout(loadTimeout);
        loadTimeout = null;
        playerTimeout = window.setTimeout(expireAttempt, YOUTUBE_API_TIMEOUT_MS);
        try {
          playerInstance = new YT.Player(iframe, {
            events: {
              onReady: (event) => {
                if (expired || generation !== this.playerGeneration) {
                  event.target.destroy();
                  return;
                }
                ready = true;
                clearAttemptTimers();
                this.player = event.target;
                this.ready = true;
                this.player.setVolume(this.volume);
                this.player.mute();
                resolve(this.player);
              },
              onStateChange: (event) => {
                if (!expired && generation === this.playerGeneration) {
                  this.handleStateChange(event, YT, generation);
                }
              },
              onError: (event) => {
                if (expired || generation !== this.playerGeneration) return;
                const error = new Error(this.errorForCode(event.data));
                if (!ready) {
                  expired = true;
                  clearAttemptTimers();
                  reject(error);
                } else {
                  this.handleError(error);
                }
              },
              onAutoplayBlocked: () => {
                if (!expired && generation === this.playerGeneration) {
                  this.handleAutoplayBlocked(YT);
                }
              },
            },
          });
          if (!expired && generation === this.playerGeneration) this.player = playerInstance;
        } catch {
          expireAttempt();
        }
      }, { once: true });
      elements.youtubePlayer.replaceChildren(iframe);
    })).catch((error) => {
      this.playerPromise = null;
      this.handleError(error);
      throw error;
    });

    return this.playerPromise;
  }

  async start() {
    if (this.errorMessage) this.resetAfterError();
    this.clearSoundCheck();
    this.playRequested = true;
    this.soundRequested = true;
    this.unmuteAttempted = false;
    this.autoplayBlocked = false;
    this.errorMessage = null;
    this.setStatus("영상 준비 중");
    this.updateButton();
    await this.ensurePlayer();
    this.applyPlayback();
  }

  setVolume(volume) {
    this.volume = Math.round(Math.max(0, Math.min(100, Number(volume) || 0)));
    if (this.ready) this.player.setVolume(this.volume);
  }

  applyPlayback() {
    if (!this.ready || !this.playRequested) return;
    if (!this.visible) {
      this.setStatus("영상이 보이면 재생됩니다.");
      return;
    }
    if (this.playing || this.autoplayBlocked) return;

    this.player.setVolume(this.volume);
    this.player.mute();
    this.player.playVideo();
    this.setStatus("불러오는 중");
    this.updateButton();
  }

  handleStateChange(event, YT, generation) {
    if (event.data === YT.PlayerState.PLAYING) {
      this.playing = true;
      this.autoplayBlocked = false;
      if (this.soundRequested && !this.unmuteAttempted) {
        this.unmuteAttempted = true;
        this.player.setVolume(this.volume);
        this.player.unMute();
        this.scheduleSoundCheck(YT, generation);
      }
      this.setStatus("재생 중");
    } else if (event.data === YT.PlayerState.PAUSED) {
      this.playing = false;
      if (this.playRequested && this.soundRequested && this.unmuteAttempted) {
        this.autoplayBlocked = true;
        this.setStatus("소리 켜기 필요");
      } else {
        this.setStatus("일시정지");
      }
    } else if (event.data === YT.PlayerState.BUFFERING) {
      this.setStatus("불러오는 중");
    }
    this.updateButton();
  }

  scheduleSoundCheck(YT, generation) {
    this.clearSoundCheck();
    this.soundCheckTimer = window.setTimeout(() => {
      this.soundCheckTimer = null;
      if (
        generation !== this.playerGeneration
        || !this.ready
        || !this.playRequested
        || !this.soundRequested
      ) return;
      const state = this.player.getPlayerState();
      if (this.player.isMuted() || state === YT.PlayerState.PAUSED) {
        this.autoplayBlocked = true;
        this.playing = state === YT.PlayerState.PLAYING;
        this.setStatus("소리 켜기 필요");
        this.updateButton();
      }
    }, 500);
  }

  clearSoundCheck() {
    if (this.soundCheckTimer) window.clearTimeout(this.soundCheckTimer);
    this.soundCheckTimer = null;
  }

  handleAutoplayBlocked(YT) {
    this.clearSoundCheck();
    this.autoplayBlocked = true;
    this.playing = this.ready && this.player.getPlayerState() === YT.PlayerState.PLAYING;
    this.setStatus("소리 켜기 필요");
    this.updateButton();
  }

  handleError(error) {
    this.clearSoundCheck();
    this.discardPlayer();
    this.errorMessage = error.message;
    this.playing = false;
    this.playRequested = false;
    this.soundRequested = false;
    this.unmuteAttempted = false;
    this.autoplayBlocked = false;
    this.setStatus(error.message);
    this.updateButton();
  }

  errorForCode(code) {
    if (code === 100) return "영상을 찾을 수 없습니다.";
    if (code === 101 || code === 150) return "이 영상은 여기서 재생할 수 없습니다.";
    if (code === 153) return "영상 연결을 확인할 수 없습니다.";
    return "영상을 재생할 수 없습니다.";
  }

  resetAfterError() {
    this.clearSoundCheck();
    this.discardPlayer();
    this.errorMessage = null;
    this.unmuteAttempted = false;
    elements.youtubePlayer.replaceChildren();
  }

  discardPlayer() {
    this.playerGeneration += 1;
    const player = this.player;
    this.player = null;
    this.playerPromise = null;
    this.ready = false;
    try {
      player?.destroy?.();
    } catch {
      // A failed player may already have detached its iframe.
    }
    elements.youtubePlayer.replaceChildren();
  }

  async toggle() {
    if (this.errorMessage) this.resetAfterError();
    if (!this.ready) {
      if (this.playRequested) {
        this.playRequested = false;
        this.playing = false;
        this.setStatus("일시정지");
        this.updateButton();
        return;
      }
      await this.start();
      return;
    }

    if (this.playing && !this.autoplayBlocked) {
      this.pause();
      return;
    }

    this.playRequested = true;
    this.soundRequested = true;
    this.unmuteAttempted = true;
    this.autoplayBlocked = false;
    this.clearSoundCheck();
    this.player.setVolume(this.volume);
    this.player.unMute();
    this.player.playVideo();
    this.playing = true;
    this.setStatus("재생 중");
    this.updateButton();
  }

  pause() {
    this.clearSoundCheck();
    this.playRequested = false;
    this.soundRequested = false;
    this.unmuteAttempted = false;
    this.autoplayBlocked = false;
    if (this.ready) this.player.pauseVideo();
    this.playing = false;
    this.setStatus("일시정지");
    this.updateButton();
  }

  setStatus(message) {
    elements.audioCaption.textContent = message;
  }

  updateButton() {
    elements.audioToggle.setAttribute("aria-pressed", String(this.playing && !this.autoplayBlocked));
    if (this.errorMessage) elements.audioToggle.textContent = "다시 시도";
    else if (this.autoplayBlocked) elements.audioToggle.textContent = "소리 켜기";
    else elements.audioToggle.textContent = this.playRequested ? "일시정지" : "재생";
  }
}

const audio = new YouTubeAudioEngine();
let selectedMode = "normal";
let eventSource = null;
let fallbackTimer = null;
let eventRetryTimer = null;
let fallbackAbortController = null;
let eventRetryAttempt = 0;
let fallbackRetryAttempt = 0;
let fallbackGeneration = 0;
let latestSnapshot = null;
let started = false;
let shareFeedbackTimer = null;

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function setConnection(kind, label) {
  elements.connectionPill.classList.remove("live", "degraded");
  if (kind) elements.connectionPill.classList.add(kind);
  elements.connectionLabel.textContent = label;
}

function showShareFeedback(label) {
  if (shareFeedbackTimer) window.clearTimeout(shareFeedbackTimer);
  elements.shareButton.textContent = label;
  shareFeedbackTimer = window.setTimeout(() => {
    shareFeedbackTimer = null;
    elements.shareButton.textContent = "공유";
  }, 1600);
}

async function shareCurrentPost() {
  const mode = latestSnapshot?.modes?.[selectedMode];
  if (!mode?.url) return;
  const result = await shareUrl({ title: mode.title, url: mode.url });
  if (result === "shared") showShareFeedback("공유됨");
  else if (result === "copied") showShareFeedback("복사됨");
  else if (result === "unavailable") showShareFeedback("공유 실패");
}

function showAlert(mode, snapshot) {
  if (mode.status === "deleted") {
    elements.alertBanner.hidden = false;
    elements.alertTitle.textContent = "게시글을 확인할 수 없습니다.";
    if (mode.alertStatus === "delivered") {
      elements.alertCopy.textContent = "마지막 음량을 유지하고 관리자에게 알렸습니다.";
    } else if (!snapshot.discordConfigured) {
      elements.alertCopy.textContent = "마지막 음량을 유지합니다. 알림 설정이 필요합니다.";
    } else {
      elements.alertCopy.textContent = "마지막 음량을 유지합니다. 알림을 다시 보내는 중입니다.";
    }
  } else if (["stale", "suspected-deleted", "locating"].includes(mode.status)) {
    elements.alertBanner.hidden = false;
    elements.alertTitle.textContent = "게시글 위치를 확인하고 있습니다.";
    elements.alertCopy.textContent = "확인이 끝날 때까지 마지막 음량을 유지합니다.";
  } else {
    elements.alertBanner.hidden = true;
  }
}

function applySnapshot(snapshot) {
  latestSnapshot = snapshot;
  const mode = snapshot.modes[selectedMode];
  if (!mode) return;

  const volume = Number.isFinite(mode.volume) ? mode.volume : 0;
  elements.volumeDial.style.setProperty("--volume", volume);
  elements.volumeDial.setAttribute("aria-valuenow", String(volume));
  elements.volumeNumber.textContent = Number.isFinite(mode.volume) ? String(volume) : "—";
  elements.viewCount.textContent = formatNumber(mode.views);
  elements.modeBadge.textContent = "부스트";
  elements.sourceCard.classList.toggle("is-boost", selectedMode === "boost");
  document.body.classList.toggle("boost-active", selectedMode === "boost");
  elements.postTitle.textContent = mode.title;
  elements.postLink.href = mode.url;
  elements.shareButton.disabled = false;
  elements.discordStatus.textContent = snapshot.discordConfigured ? "알림 설정됨" : "알림 미설정";

  if (snapshot.upstream.status === "live") setConnection("live", "연결됨");
  else if (snapshot.upstream.status === "degraded") setConnection("degraded", "연결 확인 중");
  else setConnection("", "연결 중");

  showAlert(mode, snapshot);
  audio.setVolume(volume);
}

function retryDelay(attempt, baseMs = RETRY_BASE_MS, maximumMs = RETRY_MAX_MS) {
  const exponent = Math.min(Math.max(0, attempt), 8);
  const ceiling = Math.min(maximumMs, baseMs * (2 ** exponent));
  const jitter = 0.75 + (Math.random() * 0.5);
  return Math.max(250, Math.round(ceiling * jitter));
}

async function fetchState({ timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(apiUrl("/api/state"), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applySnapshot(await response.json());
  } finally {
    window.clearTimeout(timeout);
  }
}

function stopFallback() {
  fallbackGeneration += 1;
  if (fallbackTimer) window.clearTimeout(fallbackTimer);
  fallbackTimer = null;
  fallbackAbortController?.abort();
  fallbackAbortController = null;
  fallbackRetryAttempt = 0;
}

function scheduleFallback(delay = retryDelay(fallbackRetryAttempt)) {
  if (!started || fallbackTimer) return;
  const generation = fallbackGeneration;
  fallbackTimer = window.setTimeout(async () => {
    fallbackTimer = null;
    const controller = new AbortController();
    fallbackAbortController = controller;
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(apiUrl("/api/state"), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json();
      if (generation !== fallbackGeneration) return;
      applySnapshot(snapshot);
      fallbackRetryAttempt = 0;
      scheduleFallback(retryDelay(0, FALLBACK_SUCCESS_MS, FALLBACK_SUCCESS_MS));
    } catch {
      if (generation !== fallbackGeneration) return;
      fallbackRetryAttempt += 1;
      scheduleFallback(retryDelay(fallbackRetryAttempt));
    } finally {
      window.clearTimeout(timeout);
      if (fallbackAbortController === controller) fallbackAbortController = null;
    }
  }, delay);
}

function stopEventRetry() {
  if (eventRetryTimer) window.clearTimeout(eventRetryTimer);
  eventRetryTimer = null;
}

function scheduleEventReconnect() {
  if (!started || eventSource || eventRetryTimer) return;
  const delay = retryDelay(eventRetryAttempt);
  eventRetryAttempt += 1;
  eventRetryTimer = window.setTimeout(() => {
    eventRetryTimer = null;
    connectEvents();
  }, delay);
}

function connectEvents() {
  if (!started || eventSource) return;
  stopEventRetry();
  setConnection("", "연결 중");
  const source = new EventSource(apiUrl("/api/events"));
  eventSource = source;
  source.addEventListener("oracle", (event) => {
    if (eventSource !== source) return;
    try {
      applySnapshot(JSON.parse(event.data));
      eventRetryAttempt = 0;
      stopFallback();
    } catch {
      source.close();
      eventSource = null;
      setConnection("degraded", "다시 연결 중");
      scheduleFallback();
      scheduleEventReconnect();
    }
  });
  source.onerror = () => {
    if (eventSource !== source) return;
    source.close();
    eventSource = null;
    setConnection("degraded", "다시 연결 중");
    scheduleFallback();
    scheduleEventReconnect();
  };
}

function disconnectEvents() {
  eventSource?.close();
  eventSource = null;
  stopEventRetry();
  stopFallback();
  eventRetryAttempt = 0;
}

elements.delegateButton.addEventListener("click", async () => {
  selectedMode = elements.boostChoice.checked ? "boost" : "normal";
  started = true;
  elements.entry.hidden = true;
  elements.dashboard.hidden = false;
  audio.start().catch(() => {});
  await fetchState().catch(() => setConnection("degraded", "연결 확인 중"));
  connectEvents();
});

elements.reselectButton.addEventListener("click", () => {
  disconnectEvents();
  started = false;
  audio.pause();
  elements.dashboard.hidden = true;
  elements.entry.hidden = false;
  elements.boostChoice.checked = selectedMode === "boost";
});

elements.audioToggle.addEventListener("click", () => audio.toggle().catch(() => {}));
elements.shareButton.addEventListener("click", () => shareCurrentPost());

document.addEventListener("visibilitychange", () => {
  if (!started || document.hidden) return;
  fetchState().catch(() => {
    scheduleFallback();
    scheduleEventReconnect();
  });
  if (!eventSource && !eventRetryTimer) scheduleEventReconnect();
});
