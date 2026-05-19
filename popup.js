// popup.js — Recording controls + history list. Transcript detail lives in meeting.html.

const $ = (sel) => document.querySelector(sel);

const viewMain = $('#view-main');
const viewSettings = $('#view-settings');

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
const btnSaveSettings = $('#btn-save-settings');
const btnToggleKey = $('#btn-toggle-key');
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

let timerInterval = null;

// ── Views ──

function showView(view) {
  [viewMain, viewSettings].forEach((v) => {
    if (v) v.classList.remove('active');
  });
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
    if (countBadge) countBadge.hidden = true;
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
      '<button class="icon-btn btn-card-copy" title="Copier le texte">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
      '</button>' +
      '<button class="icon-btn btn-card-delete" title="Supprimer">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>' +
      '</button></div>';

    card
      .querySelector('.transcript-card-info')
      .addEventListener('click', function () { openTranscriptPage(t.id); });

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

function openTranscriptPage(id) {
  const url = chrome.runtime.getURL('meeting.html') + '?id=' + encodeURIComponent(id);
  chrome.tabs.create({ url });
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
    feedbackBtn.classList.add('btn-copy-ok');
    setTimeout(() => feedbackBtn.classList.remove('btn-copy-ok'), 1500);
  }
}

async function deleteTranscript(id) {
  await chrome.runtime.sendMessage({ type: 'DELETE_TRANSCRIPT', id: id });
  await renderHistory();
}

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

document.getElementById('btn-import').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('import.html') });
});

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

btnSaveSettings.addEventListener('click', saveSettings);

btnToggleKey.addEventListener('click', function () {
  inputApiKey.type = inputApiKey.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-sync-disk').addEventListener('click', async function () {
  const btn = this;
  const status = document.getElementById('sync-status');
  btn.disabled = true;
  const origLabel = btn.textContent;
  btn.textContent = 'Synchronisation…';
  status.hidden = true;

  try {
    const res = await chrome.runtime.sendMessage({ type: 'SYNC_ALL_TO_DISK' });
    status.hidden = false;
    if (res && res.errors && res.errors.length > 0) {
      status.className = 'status-msg';
      status.style.background = 'rgba(255,160,60,.06)';
      status.style.border = '1px solid rgba(255,160,60,.18)';
      status.style.color = '#e8a040';
      status.textContent =
        res.synced + ' / ' + res.total + ' synchronisé(s). Erreurs : ' +
        res.errors.map(function (e) { return e.id + ' → ' + e.error; }).join('; ');
    } else {
      status.className = 'status-msg success';
      status.style = '';
      status.textContent = res.synced + ' / ' + res.total + ' transcripts écrits sur disque.';
    }
  } catch (e) {
    status.hidden = false;
    status.className = 'status-msg';
    status.style.background = 'rgba(255,90,58,.06)';
    status.style.border = '1px solid rgba(255,90,58,.12)';
    status.style.color = '#ff8a6a';
    status.textContent = 'Erreur : ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = origLabel;
  }
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
