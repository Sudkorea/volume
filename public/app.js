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

async function fetchState() {
  const response = await fetch(apiUrl("/api/state"), { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  applySnapshot(await response.json());
}

function startFallback() {
  if (fallbackTimer) return;
  fallbackTimer = window.setInterval(() => fetchState().catch(() => {}), 2500);
}

function stopFallback() {
  if (fallbackTimer) window.clearInterval(fallbackTimer);
  fallbackTimer = null;
}

function connectEvents() {
  if (!started || document.hidden || eventSource) return;
  setConnection("", "연결 중");
  eventSource = new EventSource(apiUrl("/api/events"));
  eventSource.addEventListener("oracle", (event) => {
    stopFallback();
    applySnapshot(JSON.parse(event.data));
  });
  eventSource.onerror = () => {
    setConnection("degraded", "다시 연결 중");
    startFallback();
  };
}

function disconnectEvents() {
  eventSource?.close();
  eventSource = null;
  stopFallback();
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
  if (!started) return;
  if (document.hidden) disconnectEvents();
  else connectEvents();
});

window.setInterval(() => {
  if (!latestSnapshot?.observedAt) {
    elements.dataAge.textContent = "—";
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(latestSnapshot.observedAt)) / 1000));
  elements.dataAge.textContent = seconds < 5 ? "방금 전" : `${seconds}초 전`;
}, 1000);
