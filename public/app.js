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
  formula: document.querySelector("#formula"),
  sourceCard: document.querySelector("#source-card"),
  modeBadge: document.querySelector("#mode-badge"),
  postLink: document.querySelector("#post-link"),
  postNumber: document.querySelector("#post-number"),
  postTitle: document.querySelector("#post-title"),
  viewCount: document.querySelector("#view-count"),
  trackedPages: document.querySelector("#tracked-pages"),
  pollPeriod: document.querySelector("#poll-period"),
  clientCount: document.querySelector("#client-count"),
  dataAge: document.querySelector("#data-age"),
  audioToggle: document.querySelector("#audio-toggle"),
  audioFile: document.querySelector("#audio-file"),
  audioCaption: document.querySelector("#audio-caption"),
  eventLog: document.querySelector("#event-log"),
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

function apiUrl(pathname) {
  return usePublicApi && configuredApiBase ? `${configuredApiBase}${pathname}` : pathname;
}

class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.timer = null;
    this.audio = null;
    this.mediaSource = null;
    this.objectUrl = null;
    this.playing = false;
    this.volume = 0;
    this.step = 0;
  }

  async start() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("오디오를 재생할 수 없는 브라우저입니다.");
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
    this.playing = true;
    this.startTone();
    this.updateButton();
  }

  startTone() {
    if (this.timer || this.audio) return;
    this.playTone();
    this.timer = window.setInterval(() => this.playTone(), 420);
  }

  stopTone() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  playTone() {
    if (!this.playing || !this.context || this.audio) return;
    const notes = [220, 277.18, 329.63, 277.18];
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.value = notes[this.step % notes.length];
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
    this.step += 1;
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(100, Number(volume) || 0));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume / 100, this.context.currentTime, 0.025);
    }
  }

  async toggle() {
    if (!this.context) return;
    this.playing = !this.playing;
    if (this.audio) {
      if (this.playing) await this.audio.play();
      else this.audio.pause();
    } else if (this.playing) {
      await this.context.resume();
      this.startTone();
    } else {
      this.stopTone();
    }
    this.updateButton();
  }

  async useFile(file) {
    if (!file || !this.context) return;
    this.stopTone();
    if (this.audio) this.audio.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.audio = new Audio(this.objectUrl);
    this.audio.loop = true;
    this.mediaSource = this.context.createMediaElementSource(this.audio);
    this.mediaSource.connect(this.master);
    this.playing = true;
    await this.audio.play();
    elements.audioCaption.textContent = file.name;
    this.updateButton();
  }

  updateButton() {
    elements.audioToggle.setAttribute("aria-pressed", String(this.playing));
    elements.audioToggle.textContent = this.playing ? "일시정지" : "재생";
  }
}

const audio = new AudioEngine();
let selectedMode = "boost";
let eventSource = null;
let fallbackTimer = null;
let eventRetryTimer = null;
let fallbackAbortController = null;
let eventRetryAttempt = 0;
let fallbackRetryAttempt = 0;
let fallbackGeneration = 0;
let latestSnapshot = null;
let lastRenderedVolume = null;
let started = false;

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function setConnection(kind, label) {
  elements.connectionPill.classList.remove("live", "degraded");
  if (kind) elements.connectionPill.classList.add(kind);
  elements.connectionLabel.textContent = label;
}

function addLog(message) {
  const item = document.createElement("li");
  const time = document.createElement("time");
  const copy = document.createElement("span");
  time.textContent = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
  copy.textContent = message;
  item.append(time, copy);
  elements.eventLog.prepend(item);
  while (elements.eventLog.children.length > 3) elements.eventLog.lastElementChild.remove();
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
  elements.formula.textContent = Number.isFinite(mode.views)
    ? `${formatNumber(mode.views)} mod ${mode.modulus} = ${volume}`
    : "—";
  elements.modeBadge.textContent = "부스트";
  elements.sourceCard.classList.toggle("is-boost", selectedMode === "boost");
  document.body.classList.toggle("boost-active", selectedMode === "boost");
  elements.postNumber.textContent = String(mode.postNo);
  elements.postTitle.textContent = mode.title;
  elements.postLink.href = mode.url;
  elements.trackedPages.textContent = `페이지 ${snapshot.trackedPages.join(", ") || "—"}`;
  elements.pollPeriod.textContent = `주기 ${(snapshot.upstream.nextPollMs / 1000).toFixed(0)}초`;
  elements.clientCount.textContent = String(snapshot.connectedClients);
  elements.discordStatus.textContent = snapshot.discordConfigured ? "알림 설정됨" : "알림 미설정";

  if (snapshot.upstream.status === "live") setConnection("live", "업데이트됨");
  else if (snapshot.upstream.status === "degraded") setConnection("degraded", "연결 확인 중");
  else setConnection("", "연결 중");

  showAlert(mode, snapshot);
  audio.setVolume(volume);
  if (lastRenderedVolume !== null && lastRenderedVolume !== mode.volume && Number.isFinite(mode.volume)) {
    addLog(`조회수 ${formatNumber(mode.views)}, 볼륨 ${mode.volume}%`);
  }
  lastRenderedVolume = mode.volume;
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
  try {
    await audio.start();
  } catch (error) {
    addLog(error.message);
  }
  started = true;
  elements.entry.hidden = true;
  elements.dashboard.hidden = false;
  lastRenderedVolume = null;
  await fetchState().catch(() => setConnection("degraded", "연결 확인 중"));
  connectEvents();
});

elements.reselectButton.addEventListener("click", () => {
  disconnectEvents();
  started = false;
  elements.dashboard.hidden = true;
  elements.entry.hidden = false;
  elements.boostChoice.checked = selectedMode === "boost";
});

elements.audioToggle.addEventListener("click", () => audio.toggle().catch((error) => addLog(error.message)));
elements.audioFile.addEventListener("change", () => {
  audio.useFile(elements.audioFile.files?.[0]).catch((error) => addLog(error.message));
});

document.addEventListener("visibilitychange", () => {
  if (!started || document.hidden) return;
  fetchState().catch(() => {
    scheduleFallback();
    scheduleEventReconnect();
  });
  if (!eventSource && !eventRetryTimer) scheduleEventReconnect();
});

window.setInterval(() => {
  if (!latestSnapshot?.observedAt) {
    elements.dataAge.textContent = "—";
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(latestSnapshot.observedAt)) / 1000));
  elements.dataAge.textContent = seconds < 5 ? "방금 전" : `${seconds}초 전`;
}, 1000);
