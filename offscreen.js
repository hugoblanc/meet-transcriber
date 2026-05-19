// offscreen.js — Audio capture + chunked recording. Transcription logic lives in transcribe.js.

const CHUNK_DURATION_MS = 20 * 60 * 1000; // 20 min — under the 1500s/25min hard limit of gpt-4o-transcribe-diarize

let recorder = null;
let audioContext = null;
let mixDest = null;
let streams = [];
let currentChunkData = [];
let recordedChunks = []; // { blob, startMs, endMs }
let recordingStartTime = 0;
let chunkStartTime = 0;
let chunkTimer = null;
let stopping = false;
let lastChunks = null;

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'START_CAPTURE':
      startCapture(msg.streamId);
      break;
    case 'STOP_CAPTURE':
      stopCapture();
      break;
    case 'RETRY_TRANSCRIPTION':
      if (lastChunks) {
        runTranscription(lastChunks);
      } else {
        chrome.runtime.sendMessage({
          type: 'CAPTURE_ERROR',
          error: 'Aucun enregistrement disponible. Relancez la capture.',
        });
      }
      break;
  }
});

async function startCapture(streamId) {
  try {
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });

    streams = [tabStream];
    audioContext = new AudioContext();
    mixDest = audioContext.createMediaStreamDestination();
    const tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(mixDest);
    tabSource.connect(audioContext.destination);

    let hasMic = false;
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(mixDest);
      streams.push(micStream);
      hasMic = true;
    } catch (micErr) {
      console.warn('Mic not available, recording tab audio only:', micErr.message);
    }

    tabStream.getAudioTracks().forEach((track) => {
      track.onended = () => stopCapture();
    });

    recordedChunks = [];
    recordingStartTime = Date.now();
    stopping = false;
    startChunkRecorder();

    chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED', hasMic });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      error: 'Erreur de capture : ' + err.message,
    });
  }
}

function startChunkRecorder() {
  currentChunkData = [];
  chunkStartTime = Date.now();

  recorder = new MediaRecorder(mixDest.stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 32000,
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) currentChunkData.push(e.data);
  };

  recorder.onstop = () => {
    if (chunkTimer) {
      clearTimeout(chunkTimer);
      chunkTimer = null;
    }

    const blob = new Blob(currentChunkData, { type: 'audio/webm' });
    recordedChunks.push({
      blob,
      startMs: chunkStartTime - recordingStartTime,
      endMs: Date.now() - recordingStartTime,
    });

    if (stopping) {
      runTranscription(recordedChunks);
    } else {
      startChunkRecorder();
    }
  };

  recorder.start();

  chunkTimer = setTimeout(() => {
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
  }, CHUNK_DURATION_MS);
}

function stopCapture() {
  stopping = true;
  if (chunkTimer) {
    clearTimeout(chunkTimer);
    chunkTimer = null;
  }
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
  }
  for (const stream of streams) {
    stream.getTracks().forEach((t) => t.stop());
  }
  streams = [];
}

async function runTranscription(chunks) {
  try {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const apiKey = settings && settings.apiKey;
    const language = (settings && settings.language) || 'fr';
    if (!apiKey) throw new Error('Clé API OpenAI non configurée');

    lastChunks = chunks;

    const { segments, metadata } = await transcribeChunks(chunks, {
      apiKey,
      language,
      onProgress: (p) => chrome.runtime.sendMessage({ type: 'TRANSCRIPTION_PROGRESS', ...p }),
    });

    // Fallback duration from wall clock if model returned nothing
    if (!metadata.duration && recordingStartTime) {
      metadata.duration = (Date.now() - recordingStartTime) / 1000;
    }

    lastChunks = null;
    cleanup();

    chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_COMPLETE',
      segments,
      metadata,
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_ERROR',
      error: err.message,
    });
  }
}

function cleanup() {
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
  mixDest = null;
  recorder = null;
  currentChunkData = [];
  recordedChunks = [];
}
