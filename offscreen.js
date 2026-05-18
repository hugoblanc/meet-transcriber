// offscreen.js — Audio capture, Web Audio mixing, MediaRecorder, OpenAI API

let recorder = null;
let audioContext = null;
let streams = [];
let chunks = [];
let lastBlob = null;

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'START_CAPTURE':
      startCapture(msg.streamId);
      break;
    case 'STOP_CAPTURE':
      stopCapture();
      break;
    case 'RETRY_TRANSCRIPTION':
      if (lastBlob) {
        transcribe(lastBlob);
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
    const mixDest = audioContext.createMediaStreamDestination();
    const tabSource = audioContext.createMediaStreamSource(tabStream);

    tabSource.connect(mixDest);
    // tabCapture mutes speaker output — re-route so user still hears the call
    tabSource.connect(audioContext.destination);

    // Mic capture: graceful fallback if permission not granted
    let hasMic = false;
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(mixDest);
      // Never connect mic to audioContext.destination (user would hear themselves)
      streams.push(micStream);
      hasMic = true;
    } catch (micErr) {
      console.warn('Mic not available, recording tab audio only:', micErr.message);
    }

    tabStream.getAudioTracks().forEach((track) => {
      track.onended = () => stopCapture();
    });

    chunks = [];
    recorder = new MediaRecorder(mixDest.stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 32000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      lastBlob = blob;
      chunks = [];
      transcribe(blob);
    };

    recorder.start();
    chrome.runtime.sendMessage({ type: 'CAPTURE_STARTED', hasMic });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_ERROR',
      error: 'Erreur de capture : ' + err.message,
    });
  }
}

function stopCapture() {
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
  }
  for (const stream of streams) {
    stream.getTracks().forEach((t) => t.stop());
  }
  streams = [];
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
}

async function transcribe(blob) {
  try {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const apiKey = settings && settings.apiKey;
    const language = (settings && settings.language) || 'fr';

    if (!apiKey) {
      throw new Error('Clé API OpenAI non configurée');
    }

    if (blob.size > 25 * 1024 * 1024) {
      throw new Error(
        'Fichier trop volumineux (' +
          Math.round(blob.size / 1024 / 1024) +
          ' Mo). Limite : 25 Mo. Essayez un enregistrement plus court.',
      );
    }

    const fd = new FormData();
    fd.append('file', blob, 'meeting.webm');
    fd.append('model', 'gpt-4o-transcribe-diarize');
    fd.append('response_format', 'diarized_json');
    fd.append('chunking_strategy', 'auto');
    fd.append('language', language || 'fr');

    const response = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey },
        body: fd,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401) {
        throw new Error('Clé API invalide. Vérifiez vos réglages.');
      }
      if (response.status === 429) {
        throw new Error(
          'Limite de requêtes atteinte. Réessayez dans quelques instants.',
        );
      }
      throw new Error(
        'Erreur OpenAI (' + response.status + ') : ' + text.slice(0, 200),
      );
    }

    const data = await response.json();
    const segments = data.segments || [];

    const speakers = [
      ...new Set(segments.map((s) => s.speaker).filter(Boolean)),
    ];
    const duration =
      segments.length > 0 ? Math.max(...segments.map((s) => s.end || 0)) : 0;

    lastBlob = null;

    chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_COMPLETE',
      segments,
      metadata: { speakers, duration },
    });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_ERROR',
      error: err.message,
    });
  }
}
