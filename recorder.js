// recorder.js - EchoParrot v1.9.7
// タブ名ファイル名 / 30分時間制限 / シリアルキー認証

// ---- GitHub 更新チェック設定 ----
// 無印（公開版）リポジトリのAPIエンドポイント
const GITHUB_RELEASE_API = 'https://api.github.com/repos/anchuu315/EchoParrot/releases/latest';
const GITHUB_RELEASES_URL = 'https://github.com/anchuu315/EchoParrot/releases/latest';

// ---- シリアルキー設定 ----
// ハッシュを分割して格納（難読化）
const _h1 = '862ef010'; const _h2 = 'c4a16461';
const _h3 = '214b0c30'; const _h4 = '4eda5d92';
const _h5 = '3f6ba021'; const _h6 = '18717926';
const _h7 = 'f0a8f4d2'; const _h8 = '41fcc002';
const FREE_LIMIT_SEC = 30 * 60; // 30分 = 1800秒

// ---- DOM参照 ----
const canvas            = document.getElementById('waveform');
const ctx               = canvas.getContext('2d');
const btnStart          = document.getElementById('btnStart');
const btnPause          = document.getElementById('btnPause');
const btnStop           = document.getElementById('btnStop');
const statusDot         = document.getElementById('statusDot');
const statusText        = document.getElementById('statusText');
const timerEl           = document.getElementById('timer');
const timerLimitEl      = document.getElementById('timerLimit');
const savedMsg          = document.getElementById('savedMsg');
const errorMsg          = document.getElementById('errorMsg');
const waveformLabel     = document.getElementById('waveformLabel');
const waveformContainer = document.getElementById('waveformContainer');
const targetTabEl       = document.getElementById('targetTab');
const chkMp3            = document.getElementById('chkMp3');
const optionMp3         = document.getElementById('optionMp3');
const formatInfo        = document.getElementById('formatInfo');
const btnDiscard        = document.getElementById('btnDiscard');
const progressWrap      = document.getElementById('progressWrap');
const progressFill      = document.getElementById('progressFill');
const progressPct       = document.getElementById('progressPct');
const progressLabel     = document.getElementById('progressLabel');
const tabAudio          = document.getElementById('tabAudio');
const tabVideo          = document.getElementById('tabVideo');
const videoPreviewWrap  = document.getElementById('videoPreviewWrap');
const videoNote         = document.getElementById('videoNote');
const previewEl         = document.getElementById('preview');
const planBadge         = document.getElementById('planBadge');
const btnSettings       = document.getElementById('btnSettings');
const settingsPanel     = document.getElementById('settingsPanel');
const keyInput          = document.getElementById('keyInput');
const btnKeyApply       = document.getElementById('btnKeyApply');
const btnKeyClear       = document.getElementById('btnKeyClear');
const keyStatus         = document.getElementById('keyStatus');
const btnMonitor        = document.getElementById('btnMonitor');
const monitorStatus     = document.getElementById('monitorStatus');

// ---- 状態変数 ----
let mediaRecorder  = null;
let recordedChunks = [];
let audioContext   = null;
let analyser       = null;
let animationId    = null;
let timerInterval  = null;
let startTime      = null;
let pausedTime     = 0;
let pauseStart     = null;
let localStream    = null;
let isPaused        = false;
let currentMode     = 'audio'; // 'audio' | 'video'
let isPro           = false;   // PRO認証済みか
let currentTabTitle = '';      // 録音対象のタブ名
let gainNode        = null;    // モニタリング音量制御
let isMonitoring    = true;    // モニタリング状態

// ---- ライセンス認証 ----

// SHA-256ハッシュ計算（Web Crypto API）
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ハッシュを結合して検証（分割格納されているため直接比較不可）
function _vk() { return _h1+_h2+_h3+_h4+_h5+_h6+_h7+_h8; }

// キーを検証
async function verifyKey(plainKey) {
  const hash = await sha256(plainKey.trim().toUpperCase());
  return hash === _vk();
}

// 認証済みハッシュをstorageに保存（平文キーは保存しない）
async function saveVerifiedHash(plainKey) {
  const hash = await sha256(plainKey.trim().toUpperCase());
  chrome.storage.local.set({ epLicHash: hash });
}

// 起動時にライセンス確認
async function initLicense() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['epLicHash'], async (result) => {
      if (result.epLicHash && result.epLicHash === _vk()) {
        isPro = true;
        updatePlanBadge();
      }
      resolve();
    });
  });
}

function updatePlanBadge() {
  if (isPro) {
    planBadge.textContent = 'PRO';
    planBadge.className   = 'plan-badge pro';
  } else {
    planBadge.textContent = 'FREE';
    planBadge.className   = 'plan-badge free';
  }
}

// ---- 設定パネル ----
btnSettings.addEventListener('click', () => {
  settingsPanel.classList.toggle('show');
  keyStatus.textContent = '';
});

btnKeyApply.addEventListener('click', async () => {
  const input = keyInput.value.trim();
  if (!input) { keyStatus.textContent = 'キーを入力してください'; keyStatus.className = 'key-status err'; return; }

  const valid = await verifyKey(input);
  if (valid) {
    await saveVerifiedHash(input);
    isPro = true;
    updatePlanBadge();
    keyInput.value = '';
    keyStatus.textContent = '✓ PRO版が有効になりました！';
    keyStatus.className = 'key-status ok';
    updateTimerLimit();
  } else {
    keyStatus.textContent = '✗ 無効なシリアルキーです';
    keyStatus.className = 'key-status err';
  }
});

btnKeyClear.addEventListener('click', () => {
  chrome.storage.local.remove('epLicHash');
  isPro = false;
  updatePlanBadge();
  keyInput.value = '';
  keyStatus.textContent = 'ライセンスを解除しました';
  keyStatus.className = 'key-status err';
  updateTimerLimit();
});

// ---- 設定の永続化 ----
chrome.storage.local.get(['mp3Mode', 'recorderMode'], (result) => {
  chkMp3.checked = result.mp3Mode === true;
  if (result.recorderMode === 'video') switchMode('video');
  else switchMode('audio');
});

chkMp3.addEventListener('change', () => {
  chrome.storage.local.set({ mp3Mode: chkMp3.checked });
  updateFormatInfo();
});

// ---- モード切替 ----
tabAudio.addEventListener('click', () => { if (currentMode !== 'audio') switchMode('audio'); });
tabVideo.addEventListener('click', () => { if (currentMode !== 'video') switchMode('video'); });

function switchMode(mode) {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') return;

  currentMode = mode;
  chrome.storage.local.set({ recorderMode: mode });

  if (mode === 'audio') {
    tabAudio.classList.add('active');
    tabVideo.classList.remove('active');
    waveformContainer.classList.remove('hidden');
    videoPreviewWrap.classList.remove('show');
    videoNote.classList.remove('show');
    optionMp3.classList.remove('hidden');
    btnStart.textContent = '● 録音開始';
  } else {
    tabVideo.classList.add('active');
    tabAudio.classList.remove('active');
    waveformContainer.classList.add('hidden');
    videoPreviewWrap.classList.add('show');
    videoNote.classList.add('show');
    optionMp3.classList.add('hidden');
    btnStart.textContent = '● 録画開始';
  }
  updateFormatInfo();
  drawIdle();
}

function updateFormatInfo() {
  if (currentMode === 'video') {
    formatInfo.textContent = '保存形式: WebM（映像+音声）';
  } else if (chkMp3.checked) {
    formatInfo.textContent = '保存形式: MP3 (128kbps) — 変換後WebMは削除';
  } else {
    formatInfo.textContent = '保存形式: WebM — Google Gemini API 対応';
  }
}

// ---- 残り時間表示 ----
function updateTimerLimit() {
  if (isPro) {
    timerLimitEl.textContent = '';
    timerLimitEl.className = 'timer-limit';
  } else {
    timerLimitEl.textContent = '上限: 30:00';
    timerLimitEl.className = 'timer-limit';
  }
}

// ---- 波形描画 ----
function drawWaveform() {
  if (!analyser) { drawIdle(); return; }
  const bufferLength = analyser.frequencyBinCount;
  const dataArray    = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d0d20'); bg.addColorStop(1, '#1a1a2e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#2a2a4a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#6c63ff'); grad.addColorStop(0.5, '#3ecfcf'); grad.addColorStop(1, '#6c63ff');
  ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  const sliceWidth = W / bufferLength;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0, y = (v * H) / 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.lineTo(W, H/2); ctx.stroke();
  animationId = requestAnimationFrame(drawWaveform);
}

function drawIdle() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d0d20'); bg.addColorStop(1, '#1a1a2e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3a3a6a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
}
drawIdle();

// ---- タイマー ----
function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getElapsedSec() {
  if (!startTime) return 0;
  return Math.floor((Date.now() - startTime - pausedTime) / 1000);
}

function startTimer() {
  startTime = Date.now(); pausedTime = 0;
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime - pausedTime;
    timerEl.textContent = formatTime(elapsed);

    if (!isPro) {
      const remaining = FREE_LIMIT_SEC - Math.floor(elapsed / 1000);
      if (remaining <= 0) {
        // 30分到達 → 自動停止
        autoStopByLimit();
        return;
      }
      const remMin = Math.floor(remaining / 60).toString().padStart(2, '0');
      const remSec = (remaining % 60).toString().padStart(2, '0');
      timerLimitEl.textContent = `残り ${remMin}:${remSec}`;
      timerLimitEl.className = remaining <= 60 ? 'timer-limit warn' : 'timer-limit';
    }
  }, 500);
}

function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

// 30分制限による自動停止
function autoStopByLimit() {
  stopTimer();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (animationId)  { cancelAnimationFrame(animationId); animationId = null; }
  if (analyser)     { analyser.disconnect(); analyser = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (previewEl.srcObject) { previewEl.srcObject = null; }
  isPaused = false;
  setUI('idle');
  drawIdle();
  timerLimitEl.textContent = '';

  // ダイアログ（少し遅延させてUIが更新されてから表示）
  setTimeout(() => {
    alert('⏱ 無料版は30分までです。\n録音データは自動保存されました。\nPRO版にアップグレードすると無制限でご利用いただけます。');
  }, 300);
}

// ---- UI状態 ----
function setUI(state) {
  statusDot.className  = 'status-dot';
  statusText.className = 'status-text';
  const isVideo = currentMode === 'video';

  if (state === 'recording') {
    statusDot.classList.add('recording');
    statusText.classList.add('recording');
    statusText.textContent = isVideo ? '録画中...' : '録音中...';
    waveformLabel.textContent = isVideo ? '映像+音声を録画しています' : '音声を録音しています';
    btnStart.disabled = true; btnPause.disabled = false; btnStop.disabled = false; btnDiscard.disabled = false;
    btnPause.textContent = '⏸ 一時停止';
    if (isVideo) { tabAudio.disabled = true; tabVideo.disabled = true; }
  } else if (state === 'paused') {
    statusDot.classList.add('paused');
    statusText.classList.add('paused');
    statusText.textContent = '一時停止中';
    waveformLabel.textContent = '一時停止中 — 再開を押してください';
    btnStart.disabled = true; btnPause.disabled = false; btnStop.disabled = false; btnDiscard.disabled = false;
    btnPause.textContent = '▶ 再開';
  } else {
    statusText.textContent = '待機中';
    waveformLabel.textContent = '録音待機中...';
    btnStart.disabled = false; btnPause.disabled = true; btnStop.disabled = true; btnDiscard.disabled = true;
    btnPause.textContent = '⏸ 一時停止';
    timerEl.textContent = '00:00';
    tabAudio.disabled = false; tabVideo.disabled = false;
    updateTimerLimit();
  }
}

function showError(msg) { errorMsg.textContent = '⚠ ' + msg; errorMsg.classList.add('show'); }
function clearMessages() {
  savedMsg.classList.remove('show');
  errorMsg.classList.remove('show');
}

// ---- ファイル名生成（タブ名 + 日時） ----
function buildFileName(ext) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  let tabPart = 'echoparrot';
  if (currentTabTitle) {
    // ファイル名に使えない文字を置換
    tabPart = currentTabTitle
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 40)
      .replace(/_$/, '');
  }
  return `${tabPart}-${datePart}.${ext}`;
}

// ---- 録音/録画 開始 ----
btnStart.addEventListener('click', async () => {
  clearMessages();
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'startCapture',
      video: currentMode === 'video'
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'ストリームIDの取得に失敗しました');
    }

    const { streamId, tabTitle } = response;
    currentTabTitle = tabTitle || '';
    if (tabTitle) {
      targetTabEl.innerHTML = `<span>対象タブ:</span> ${tabTitle.slice(0, 40)}${tabTitle.length > 40 ? '…' : ''}`;
    }

    // getUserMedia でストリーム取得
    const constraints = {
      audio: {
        mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId }
      },
      video: currentMode === 'video'
        ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
        : false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    localStream = stream;

    // AudioContext — 波形解析 + GainNode経由スピーカーパススルー
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    // GainNodeでモニタリングON/OFFを制御
    gainNode = audioContext.createGain();
    gainNode.gain.value = isMonitoring ? 1.0 : 0.0;
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // 映像プレビュー
    if (currentMode === 'video') {
      previewEl.srcObject = stream;
      previewEl.play().catch(() => {});
    }

    // MIMEタイプ選択
    let mimeType;
    if (currentMode === 'video') {
      mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm';
    } else {
      mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
    }

    recordedChunks = [];
    isPaused       = false;
    mediaRecorder  = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => saveRecording();
    mediaRecorder.start(100);

    setUI('recording');
    startTimer();
    if (currentMode === 'audio') drawWaveform();

  } catch (err) {
    console.error(err);
    showError(err.message || '開始に失敗しました');
  }
});

// ---- 一時停止 / 再開 ----
btnPause.addEventListener('click', () => {
  if (!mediaRecorder) return;
  if (!isPaused) {
    mediaRecorder.pause();
    isPaused = true; pauseStart = Date.now();
    if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
    if (currentMode === 'audio') drawIdle();
    setUI('paused');
  } else {
    mediaRecorder.resume();
    isPaused = false; pausedTime += Date.now() - pauseStart; pauseStart = null;
    if (currentMode === 'audio') drawWaveform();
    setUI('recording');
  }
});

// ---- 破棄 ----
btnDiscard.addEventListener('click', () => {
  if (!mediaRecorder && recordedChunks.length === 0) return;
  if (!confirm('録音データを破棄しますか？\nこの操作は取り消せません。')) return;

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
    mediaRecorder = null;
  }

  recordedChunks = [];
  stopTimer();
  if (animationId)  { cancelAnimationFrame(animationId); animationId = null; }
  if (gainNode)     { gainNode.disconnect(); gainNode = null; }
  if (analyser)     { analyser.disconnect(); analyser = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (previewEl.srcObject) { previewEl.srcObject = null; }

  isPaused = false;
  clearMessages();
  errorMsg.textContent = '🗑 録音データを破棄しました';
  errorMsg.style.background = '#1a1a2e';
  errorMsg.style.borderColor = '#3a3a5a';
  errorMsg.style.color = '#888';
  errorMsg.classList.add('show');
  setTimeout(() => { errorMsg.classList.remove('show'); errorMsg.style = ''; }, 3000);

  setUI('idle');
  drawIdle();
});

// ---- 停止 ----
btnStop.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  stopTimer();
  if (animationId)  { cancelAnimationFrame(animationId); animationId = null; }
  if (gainNode)     { gainNode.disconnect(); gainNode = null; }
  if (analyser)     { analyser.disconnect(); analyser = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (localStream)  { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (previewEl.srcObject) { previewEl.srcObject = null; }
  isPaused = false;
  setUI('idle');
  drawIdle();
  timerLimitEl.textContent = '';
});

// ---- ファイル保存 ----
async function saveRecording() {
  if (recordedChunks.length === 0) { showError('録音データがありません'); return; }

  if (currentMode === 'video') {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    recordedChunks = [];
    const filename = buildFileName('webm');
    downloadBlob(blob, filename);
    savedMsg.textContent = `✓ 保存完了: ${filename}`;
    savedMsg.classList.add('show');
  } else {
    const webmBlob = new Blob(recordedChunks, { type: 'audio/webm' });
    recordedChunks = [];

    if (chkMp3.checked) {
      progressWrap.classList.add('show');
      progressFill.style.width = '0%';
      progressPct.textContent  = '0%';
      progressLabel.textContent = '⏳ MP3に変換中...';
      try {
        const mp3Blob = await convertToMp3(webmBlob, (pct) => {
          progressFill.style.width = pct + '%';
          progressPct.textContent  = pct + '%';
        });
        progressFill.style.width = '100%';
        progressPct.textContent  = '100%';
        progressLabel.textContent = '✓ 変換完了';
        setTimeout(() => { progressWrap.classList.remove('show'); }, 800);
        const filename = buildFileName('mp3');
        downloadBlob(mp3Blob, filename);
        savedMsg.textContent = `✓ 保存完了: ${filename}`;
        savedMsg.classList.add('show');
      } catch (err) {
        progressWrap.classList.remove('show');
        showError('MP3変換に失敗しました: ' + err.message);
      }
    } else {
      const filename = buildFileName('webm');
      downloadBlob(webmBlob, filename);
      savedMsg.textContent = `✓ 保存完了: ${filename}`;
      savedMsg.classList.add('show');
    }
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- WebM → MP3 変換 (lamejs) — 進捗コールバック付き ----
async function convertToMp3(webmBlob, onProgress) {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const offlineCtx  = new OfflineAudioContext(2, 44100 * 600, 44100);
  const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

  const sampleRate   = audioBuffer.sampleRate;
  const numChannels  = audioBuffer.numberOfChannels;
  const leftChannel  = audioBuffer.getChannelData(0);
  const rightChannel = numChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

  const mp3Encoder  = new lamejs.Mp3Encoder(numChannels > 1 ? 2 : 1, sampleRate, 128);
  const mp3Data     = [];
  const blockSize   = 1152;

  const toInt16 = (f32) => {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return i16;
  };

  const leftInt16   = toInt16(leftChannel);
  const rightInt16  = toInt16(rightChannel);
  const totalBlocks = Math.ceil(leftInt16.length / blockSize);

  await new Promise((resolve) => {
    let blockIndex = 0;
    const CHUNK = 20;

    function processChunk() {
      const end = Math.min(blockIndex + CHUNK, totalBlocks);
      for (let b = blockIndex; b < end; b++) {
        const i  = b * blockSize;
        const lc = leftInt16.subarray(i, i + blockSize);
        const rc = rightInt16.subarray(i, i + blockSize);
        const encoded = numChannels > 1
          ? mp3Encoder.encodeBuffer(lc, rc)
          : mp3Encoder.encodeBuffer(lc);
        if (encoded.length > 0) mp3Data.push(new Int8Array(encoded));
      }
      blockIndex = end;

      if (onProgress) {
        const pct = Math.floor((blockIndex / totalBlocks) * 100);
        onProgress(Math.min(pct, 99));
      }

      if (blockIndex < totalBlocks) {
        setTimeout(processChunk, 0);
      } else {
        const flushed = mp3Encoder.flush();
        if (flushed.length > 0) mp3Data.push(new Int8Array(flushed));
        resolve();
      }
    }
    setTimeout(processChunk, 0);
  });

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

// ---- モニタリングON/OFF ----
function updateMonitorUI() {
  if (isMonitoring) {
    monitorStatus.textContent = 'ON';
    monitorStatus.className   = 'monitor-status on';
    btnMonitor.className      = 'btn-monitor on';
  } else {
    monitorStatus.textContent = 'OFF';
    monitorStatus.className   = 'monitor-status off';
    btnMonitor.className      = 'btn-monitor off';
  }
}

btnMonitor.addEventListener('click', () => {
  isMonitoring = !isMonitoring;
  // GainNodeで即時切替（録音中でも有効）
  if (gainNode) {
    gainNode.gain.setTargetAtTime(isMonitoring ? 1.0 : 0.0, gainNode.context.currentTime, 0.05);
  }
  chrome.storage.local.set({ monitoring: isMonitoring });
  updateMonitorUI();
});

// ---- 初期化 ----
initLicense().then(() => {
  updatePlanBadge();
  updateTimerLimit();
});

// モニタリング設定の復元
chrome.storage.local.get(['monitoring'], (result) => {
  isMonitoring = result.monitoring !== false; // デフォルトON
  updateMonitorUI();
});

// ---- GitHub 更新チェック ----
async function checkForUpdate() {
  try {
    const currentVersion = chrome.runtime.getManifest().version; // 例: "1.9.0"
    const res = await fetch(GITHUB_RELEASE_API, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
      cache: 'no-cache'
    });
    if (!res.ok) return;
    const data = await res.json();
    const latestTag = (data.tag_name || '').replace(/^v/, ''); // "v1.10.0" → "1.10.0"
    if (latestTag && isNewerVersion(latestTag, currentVersion)) {
      const badge = document.getElementById('updateBadge');
      const text  = document.getElementById('updateText');
      text.textContent = `🆕 Update Available (v${latestTag})`;
      badge.href = GITHUB_RELEASES_URL;
      badge.classList.add('show');
    }
  } catch (e) {
    // ネットワークエラーは無視
  }
}

function isNewerVersion(latest, current) {
  const parse = v => v.split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

// 起動時に更新チェック実行
checkForUpdate();
