// background.js — Service worker: orchestration, state, message routing

async function getSession() {
  const { session } = await chrome.storage.session.get('session');
  return session || null;
}

async function setSession(session) {
  if (session) {
    await chrome.storage.session.set({ session });
  } else {
    await chrome.storage.session.remove('session');
  }
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture audio pour transcription de réunion',
    });
  }
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'START_RECORDING':
      handleStartRecording()
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'STOP_RECORDING':
      handleStopRecording()
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'GET_STATE':
      getSession().then((session) => sendResponse({ session }));
      return true;

    case 'GET_SETTINGS':
      chrome.storage.local
        .get(['apiKey', 'language', 'userName'])
        .then(sendResponse);
      return true;

    case 'SAVE_SETTINGS':
      chrome.storage.local.set(msg.settings).then(function () {
        sendResponse({ success: true });
      });
      return true;

    case 'GET_TRANSCRIPTS':
      chrome.storage.local.get({ transcripts: [] }).then(sendResponse);
      return true;

    case 'DELETE_TRANSCRIPT':
      handleDeleteTranscript(msg.id).then(sendResponse);
      return true;

    case 'RETRY_TRANSCRIPTION':
      handleRetry()
        .then(sendResponse)
        .catch((e) => sendResponse({ error: e.message }));
      return true;

    case 'DISMISS_ERROR':
      handleDismissError().then(sendResponse);
      return true;

    case 'CANCEL_OPERATION':
      handleDismissError().then(sendResponse);
      return true;

    case 'CAPTURE_STARTED':
      handleCaptureStarted(msg.hasMic);
      break;

    case 'TRANSCRIPTION_COMPLETE':
      handleTranscriptionComplete(msg.segments, msg.metadata);
      break;

    case 'TRANSCRIPTION_ERROR':
      handleTranscriptionError(msg.error, true);
      break;

    case 'CAPTURE_ERROR':
      handleTranscriptionError(msg.error, false);
      break;
  }
});

async function handleStartRecording() {
  const existing = await getSession();
  if (existing && existing.status === 'recording') {
    throw new Error('Enregistrement déjà en cours');
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('Aucun onglet actif');

  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id,
  });

  await ensureOffscreen();

  const session = {
    tabId: tab.id,
    tabTitle: tab.title || '',
    tabUrl: tab.url || '',
    startTime: Date.now(),
    status: 'recording',
  };
  await setSession(session);

  await chrome.action.setBadgeText({ text: 'REC' });
  await chrome.action.setBadgeBackgroundColor({ color: '#e53935' });

  chrome.runtime.sendMessage({ type: 'START_CAPTURE', streamId });

  return { success: true, session };
}

async function handleStopRecording() {
  const session = await getSession();
  if (!session || session.status !== 'recording') {
    throw new Error('Aucun enregistrement en cours');
  }

  session.status = 'transcribing';
  session.stopTime = Date.now();
  await setSession(session);

  await chrome.action.setBadgeText({ text: '···' });
  await chrome.action.setBadgeBackgroundColor({ color: '#fb8c00' });

  chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });

  try {
    await chrome.tabs.sendMessage(session.tabId, {
      type: 'RECORDING_STOPPED',
    });
  } catch (_) {
    /* tab may be closed */
  }

  return { success: true };
}

async function handleDeleteTranscript(id) {
  const { transcripts = [] } = await chrome.storage.local.get({
    transcripts: [],
  });
  const filtered = transcripts.filter((t) => t.id !== id);
  await chrome.storage.local.set({ transcripts: filtered });
  return { success: true };
}

async function handleRetry() {
  const session = await getSession();
  if (!session || session.status !== 'error') {
    throw new Error('Rien à réessayer');
  }

  session.status = 'transcribing';
  delete session.error;
  await setSession(session);

  await chrome.action.setBadgeText({ text: '···' });
  await chrome.action.setBadgeBackgroundColor({ color: '#fb8c00' });

  chrome.runtime.sendMessage({ type: 'RETRY_TRANSCRIPTION' });

  return { success: true };
}

async function handleDismissError() {
  await setSession(null);
  await chrome.action.setBadgeText({ text: '' });
  await closeOffscreen();
  return { success: true };
}

async function handleCaptureStarted(hasMic) {
  const session = await getSession();
  if (session) {
    session.hasMic = !!hasMic;
    await setSession(session);
    try {
      await chrome.tabs.sendMessage(session.tabId, {
        type: 'RECORDING_STARTED',
      });
    } catch (_) {
      /* content script may not be loaded (non-Meet tab) */
    }
  }
}

async function handleTranscriptionComplete(segments, metadata) {
  const session = await getSession();

  const now = new Date();
  const entry = {
    id: now.getTime().toString(),
    date: now.toISOString(),
    duration:
      metadata?.duration ||
      (session ? (session.stopTime - session.startTime) / 1000 : 0),
    speakers: metadata?.speakers || [],
    segments,
    text: formatTranscript(segments, metadata, now),
    url: session?.tabUrl || '',
    title: session?.tabTitle || '',
  };

  const { transcripts = [] } = await chrome.storage.local.get({
    transcripts: [],
  });
  transcripts.unshift(entry);
  if (transcripts.length > 50) transcripts.length = 50;
  await chrome.storage.local.set({ transcripts });

  syncTranscriptToDisk(entry);

  await setSession(null);

  await chrome.action.setBadgeText({ text: '✓' });
  await chrome.action.setBadgeBackgroundColor({ color: '#0d904f' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);

  const durationMin = Math.round(entry.duration / 60);
  chrome.notifications.create('transcript-ready', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Transcript prêt',
    message: `Réunion du ${now.toLocaleDateString('fr-FR')} — ${durationMin} min`,
  });

  await closeOffscreen();
}

async function handleTranscriptionError(error, canRetry) {
  const session = await getSession();
  if (session) {
    session.status = 'error';
    session.error = error;
    session.canRetry = !!canRetry;
    await setSession(session);
  }

  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#e53935' });

  if (!canRetry) {
    await closeOffscreen();
  }
}

const NATIVE_HOST = 'com.meettranscriber.bridge';

function syncTranscriptToDisk(entry) {
  try {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      type: 'SAVE_TRANSCRIPT',
      transcript: entry,
    });
  } catch (_) {
    // Native host not installed — silent fail, transcripts still in chrome.storage
  }
}

function formatTranscript(segments, metadata, date) {
  const d = date.toLocaleDateString('fr-FR');
  const t = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const durationMin = Math.round((metadata?.duration || 0) / 60);
  const speakers = metadata?.speakers?.join(', ') || 'Inconnu';

  let md = `# Transcript — ${d} ${t}\n`;
  md += `**Durée :** ${durationMin} min · **Locuteurs :** ${speakers}\n\n`;

  for (const seg of segments) {
    md += `[${seg.speaker}] ${seg.text}\n`;
  }

  return md;
}
