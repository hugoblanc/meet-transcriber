// popup.js — UI logic

const $ = (sel) => document.querySelector(sel);

const viewMain = $('#view-main');
const viewSettings = $('#view-settings');
const viewTranscript = $('#view-transcript');

const setupBanner = $('#setup-banner');
const ctrlIdle = $('#ctrl-idle');
const ctrlRecording = $('#ctrl-recording');
const ctrlTranscribing = $('#ctrl-transcribing');
const ctrlError = $('#ctrl-error');

const btnStart = $('#btn-start');
const btnStop = $('#btn-stop');
const btnRetry = $('#btn-retry');
const btnDismiss = $('#btn-dismiss');
const btnCancel = $('#btn-cancel');
const btnSettings = $('#btn-settings');
const btnSetup = $('#btn-setup');
const btnBackSettings = $('#btn-back-settings');
const btnBackTranscript = $('#btn-back-transcript');
const btnSaveSettings = $('#btn-save-settings');
const btnToggleKey = $('#btn-toggle-key');
const btnCopy = $('#btn-copy');
const btnDownload = $('#btn-download');
const btnDownloadJson = $('#btn-download-json');
const countBadge = $('#count-badge');

const inputApiKey = $('#input-apikey');
const selectLang = $('#select-lang');
const inputUsername = $('#input-username');
const settingsStatus = $('#settings-status');
const errorText = $('#error-text');
const timerEl = $('#timer');
const hintText = $('#hint-text');
const transcriptList = $('#transcript-list');
const emptyHistory = $('#empty-history');
const transcriptContent = $('#transcript-content');
const transcriptTitle = $('#transcript-title');

let timerInterval = null;
let currentTranscript = null;

// ── Views ──

function showView(view) {
  [viewMain, viewSettings, viewTranscript].forEach((v) =>
    v.classList.remove('active'),
  );
  view.classList.add('active');
}

function showControls(id) {
  [ctrlIdle, ctrlRecording, ctrlTranscribing, ctrlError].forEach(
    (c) => (c.hidden = true),
  );
  if (id) id.hidden = false;
}

// ── Waveform ──

function initWaveform() {
  var wf = document.getElementById('waveform');
  if (!wf || wf.children.length > 0) return;
  for (var i = 0; i < 36; i++) {
    var bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.animationDuration = (0.8 + Math.random() * 0.7) + 's';
    bar.style.animationDelay = (i * 0.04 + Math.random() * 0.1) + 's';
    wf.appendChild(bar);
  }
}

// ── Timer ──

function startTimer(startTime) {
  stopTimer();
  updateTimer(startTime);
  timerInterval = setInterval(function () { updateTimer(startTime); }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimer(startTime) {
  var elapsed = Math.floor((Date.now() - startTime) / 1000);
  var min = Math.floor(elapsed / 60);
  var sec = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = min + ':' + sec;
}

// ── Render ──

let renderTimeout = null;
function scheduleRender() {
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(render, 80);
}

async function render() {
  try {
    const data = await chrome.storage.local.get('apiKey');
    const apiKey = data && data.apiKey;

    if (!apiKey) {
      setupBanner.hidden = false;
      btnStart.disabled = true;
    } else {
      setupBanner.hidden = true;
      btnStart.disabled = false;
    }

    let session = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      session = res && res.session;
    } catch (_) {
      // Service worker may not be ready
    }

    if (!session || !session.status || session.status === 'idle') {
      showControls(ctrlIdle);
      stopTimer();
    } else if (session.status === 'recording') {
      showControls(ctrlRecording);
      initWaveform();
      startTimer(session.startTime);
      var micWarn = document.getElementById('mic-warning');
      if (micWarn) micWarn.hidden = session.hasMic !== false ? true : false;
    } else if (session.status === 'transcribing') {
      showControls(ctrlTranscribing);
      stopTimer();
    } else if (session.status === 'error') {
      showControls(ctrlError);
      errorText.textContent = session.error || 'Erreur inconnue';
      btnRetry.hidden = !session.canRetry;
      stopTimer();
    }

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab && tab.url && tab.url.indexOf('meet.google.com') !== -1) {
        hintText.textContent = 'Prêt à transcrire cet appel Meet';
      } else {
        hintText.textContent = "Fonctionne sur n'importe quel onglet";
      }
    } catch (_) {
      // Ignore
    }

    await renderHistory();
  } catch (e) {
    showControls(ctrlError);
    errorText.textContent = 'Erreur : ' + e.message;
    btnRetry.hidden = true;
  }
}

async function renderHistory() {
  const { transcripts } = await chrome.storage.local.get('transcripts');
  const list = transcripts || [];

  transcriptList.querySelectorAll('.transcript-card').forEach((c) => c.remove());

  if (list.length === 0) {
    emptyHistory.hidden = false;
    return;
  }

  emptyHistory.hidden = true;

  if (countBadge) {
    countBadge.textContent = list.length;
    countBadge.hidden = false;
  }

  for (const t of list) {
    const card = document.createElement('div');
    card.className = 'transcript-card';

    const date = new Date(t.date);
    const dateStr = date.toLocaleDateString('fr-FR');
    const timeStr = date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const durationMin = Math.round((t.duration || 0) / 60);
    const speakersStr = t.speakers && t.speakers.length
      ? t.speakers.join(', ')
      : '';

    card.innerHTML =
      '<div class="transcript-card-info">' +
      '<div class="transcript-card-date">' + dateStr + ' ' + timeStr + '</div>' +
      '<div class="transcript-card-meta">' + durationMin + ' min' +
      (speakersStr ? ' · ' + speakersStr : '') +
      '</div></div>' +
      '<div class="transcript-card-actions">' +
      '<button class="icon-btn btn-card-copy" title="Copier">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
      '</button>' +
      '<button class="icon-btn btn-card-delete" title="Supprimer">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
      '</button></div>';

    card
      .querySelector('.transcript-card-info')
      .addEventListener('click', function () { openTranscript(t); });

    card.querySelector('.btn-card-copy').addEventListener('click', function (e) {
      e.stopPropagation();
      copyText(t.text, e.currentTarget);
    });

    card.querySelector('.btn-card-delete').addEventListener('click', function (e) {
      e.stopPropagation();
      deleteTranscript(t.id);
    });

    transcriptList.appendChild(card);
  }
}

// ── Actions ──

async function handleStart() {
  btnStart.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'START_RECORDING' });
    if (res && res.error) {
      showControls(ctrlError);
      errorText.textContent = res.error;
      btnRetry.hidden = true;
      btnStart.disabled = false;
      return;
    }
  } catch (e) {
    showControls(ctrlError);
    errorText.textContent = e.message;
    btnRetry.hidden = true;
    btnStart.disabled = false;
    return;
  }
  await render();
}

async function handleStop() {
  btnStop.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    if (res && res.error) {
      btnStop.disabled = false;
      return;
    }
  } catch (_) {
    btnStop.disabled = false;
    return;
  }
  await render();
}

async function handleRetry() {
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'RETRY_TRANSCRIPTION',
    });
    if (res && res.error) return;
  } catch (_) {
    return;
  }
  await render();
}

async function handleDismiss() {
  try {
    await chrome.runtime.sendMessage({ type: 'DISMISS_ERROR' });
  } catch (_) {
    // Clear locally if background unreachable
    try { await chrome.storage.session.remove('session'); } catch (_e) { /* */ }
  }
  await render();
}

async function handleCancel() {
  try {
    await chrome.runtime.sendMessage({ type: 'CANCEL_OPERATION' });
  } catch (_) {
    try { await chrome.storage.session.remove('session'); } catch (_e) { /* */ }
  }
  await render();
}

function openTranscript(transcript) {
  currentTranscript = transcript;
  var date = new Date(transcript.date);
  transcriptTitle.textContent =
    date.toLocaleDateString('fr-FR') +
    ' ' +
    date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  transcriptContent.textContent = transcript.text;
  showView(viewTranscript);
}

async function copyText(text, feedbackBtn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (feedbackBtn) {
    var orig = feedbackBtn.textContent;
    feedbackBtn.textContent = 'Copié !';
    feedbackBtn.classList.add('btn-copy-ok');
    setTimeout(function () {
      feedbackBtn.textContent = orig;
      feedbackBtn.classList.remove('btn-copy-ok');
    }, 1500);
  }
}

function downloadJson(transcript) {
  var exportData = {
    id: transcript.id,
    date: transcript.date,
    duration: transcript.duration,
    speakers: transcript.speakers,
    segments: transcript.segments,
    url: transcript.url,
    title: transcript.title,
  };
  var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var date = new Date(transcript.date);
  a.download = 'transcript-' + date.toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTranscript(transcript) {
  var blob = new Blob([transcript.text], { type: 'text/markdown' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  var date = new Date(transcript.date);
  a.download = 'transcript-' + date.toISOString().slice(0, 10) + '.md';
  a.click();
  URL.revokeObjectURL(url);
}

async function deleteTranscript(id) {
  await chrome.runtime.sendMessage({ type: 'DELETE_TRANSCRIPT', id: id });
  await renderHistory();
}

// ── Settings ──

async function loadSettings() {
  var data = await chrome.storage.local.get(['apiKey', 'language', 'userName']);
  inputApiKey.value = (data && data.apiKey) || '';
  selectLang.value = (data && data.language) || 'fr';
  inputUsername.value = (data && data.userName) || '';
}

async function saveSettings() {
  var apiKey = inputApiKey.value.trim();
  var language = selectLang.value;
  var userName = inputUsername.value.trim();

  await chrome.storage.local.set({
    apiKey: apiKey,
    language: language,
    userName: userName,
  });

  settingsStatus.hidden = false;
  settingsStatus.className = 'status-msg success';
  settingsStatus.textContent = 'Réglages enregistrés';
  setTimeout(function () {
    settingsStatus.hidden = true;
  }, 2000);
}

// ── Event listeners ──

btnStart.addEventListener('click', handleStart);
btnStop.addEventListener('click', handleStop);
btnRetry.addEventListener('click', handleRetry);
btnDismiss.addEventListener('click', handleDismiss);
btnCancel.addEventListener('click', handleCancel);

btnSettings.addEventListener('click', function () {
  loadSettings();
  showView(viewSettings);
});
btnSetup.addEventListener('click', function () {
  loadSettings();
  showView(viewSettings);
});
btnBackSettings.addEventListener('click', function () {
  showView(viewMain);
  render();
});
btnBackTranscript.addEventListener('click', function () {
  showView(viewMain);
});

btnSaveSettings.addEventListener('click', saveSettings);

btnToggleKey.addEventListener('click', function () {
  inputApiKey.type = inputApiKey.type === 'password' ? 'text' : 'password';
});

btnCopy.addEventListener('click', function () {
  if (currentTranscript) copyText(currentTranscript.text, btnCopy);
});

btnDownload.addEventListener('click', function () {
  if (currentTranscript) downloadTranscript(currentTranscript);
});

btnDownloadJson.addEventListener('click', function () {
  if (currentTranscript) downloadJson(currentTranscript);
});

chrome.runtime.onMessage.addListener(function (msg) {
  var relevant = [
    'TRANSCRIPTION_COMPLETE',
    'TRANSCRIPTION_ERROR',
    'CAPTURE_ERROR',
    'CAPTURE_STARTED',
  ];
  if (relevant.indexOf(msg.type) !== -1) {
    scheduleRender();
  }
});

// ── Init ──
render();
