// transcribe.js — Pure transcription pipeline. Shared by offscreen.js and import.js.
// No top-level state. Exposes globals via window.* assignments at the bottom.

const TRANSCRIBE_MAX_REFS = 4;
const TRANSCRIBE_REF_MIN_SEC = 2;
const TRANSCRIBE_REF_MAX_SEC = 8;

async function transcribeChunks(chunks, { apiKey, language, onProgress } = {}) {
  const validChunks = chunks.filter((c) => c.blob && c.blob.size > 1000);
  if (validChunks.length === 0) throw new Error('Aucun audio à transcrire.');

  if (onProgress) onProgress({ stage: 'start', totalChunks: validChunks.length });

  let merged;

  if (validChunks.length === 1) {
    const r = await transcribeOneChunk(validChunks[0].blob, { apiKey, language });
    if (onProgress) onProgress({ stage: 'chunk-done', chunkIndex: 0 });
    merged = offsetSegments(r.segments, (validChunks[0].startMs || 0) / 1000);
  } else {
    // Chunk 0 first — discover speakers
    const first = await transcribeOneChunk(validChunks[0].blob, { apiKey, language });
    if (onProgress) onProgress({ stage: 'chunk-done', chunkIndex: 0 });

    let references = [];
    try {
      references = await extractReferenceClips(validChunks[0].blob, first.segments);
    } catch (refErr) {
      console.warn('Reference clip extraction failed:', refErr);
    }

    const restPromises = validChunks.slice(1).map((c, i) =>
      transcribeOneChunk(c.blob, { apiKey, language, references }).then((r) => {
        if (onProgress) onProgress({ stage: 'chunk-done', chunkIndex: i + 1 });
        return r;
      }),
    );
    const restResults = await Promise.all(restPromises);

    merged = offsetSegments(first.segments, (validChunks[0].startMs || 0) / 1000);
    for (let i = 0; i < restResults.length; i++) {
      const offsetSec = (validChunks[i + 1].startMs || 0) / 1000;
      merged = merged.concat(offsetSegments(restResults[i].segments, offsetSec));
    }
  }

  const speakers = [...new Set(merged.map((s) => s.speaker).filter(Boolean))];
  const duration = merged.length > 0 ? Math.max(...merged.map((s) => s.end || 0)) : 0;

  return { segments: merged, metadata: { speakers, duration } };
}

function offsetSegments(segments, offsetSec) {
  if (!offsetSec) return segments.slice();
  return segments.map((s) => ({
    ...s,
    start: (s.start || 0) + offsetSec,
    end: (s.end || 0) + offsetSec,
  }));
}

async function transcribeOneChunk(blob, { apiKey, language, references }) {
  const fd = new FormData();
  fd.append('file', blob, 'chunk.webm');
  fd.append('model', 'gpt-4o-transcribe-diarize');
  fd.append('response_format', 'diarized_json');
  fd.append('chunking_strategy', 'auto');
  fd.append('language', language || 'fr');

  if (references && references.length > 0) {
    for (const ref of references) {
      fd.append('known_speaker_names[]', ref.name);
      fd.append('known_speaker_references[]', ref.dataUrl);
    }
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey },
    body: fd,
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401) throw new Error('Clé API invalide. Vérifiez vos réglages.');
    if (response.status === 429) throw new Error('Limite de requêtes atteinte. Réessayez dans quelques instants.');
    throw new Error('Erreur OpenAI (' + response.status + ') : ' + text.slice(0, 200));
  }

  const data = await response.json();
  return { segments: data.segments || [] };
}

async function extractReferenceClips(blob, segments) {
  const ctx = new AudioContext();
  try {
    const arr = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arr);

    const speakerToBest = new Map();
    for (const s of segments) {
      if (!s.speaker) continue;
      const dur = (s.end || 0) - (s.start || 0);
      if (dur < TRANSCRIBE_REF_MIN_SEC) continue;
      const existing = speakerToBest.get(s.speaker);
      if (!existing || dur > existing.dur) {
        speakerToBest.set(s.speaker, { seg: s, dur });
      }
    }

    const refs = [];
    for (const [speaker, { seg }] of speakerToBest) {
      if (refs.length >= TRANSCRIBE_MAX_REFS) break;
      const start = seg.start || 0;
      const end = Math.min(seg.end || 0, start + TRANSCRIBE_REF_MAX_SEC);
      if (end - start < TRANSCRIBE_REF_MIN_SEC) continue;
      const dataUrl = encodeSliceToWavDataUrl(audioBuffer, start, end);
      refs.push({ name: speaker, dataUrl });
    }
    return refs;
  } finally {
    ctx.close();
  }
}

function encodeSliceToWavDataUrl(audioBuffer, startSec, endSec) {
  const sampleRate = audioBuffer.sampleRate;
  const targetRate = 24000;
  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.min(Math.floor(endSec * sampleRate), audioBuffer.length);
  const length = endSample - startSample;

  const mono = new Float32Array(length);
  const numChannels = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < numChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[startSample + i] / numChannels;
  }

  const ratio = sampleRate / targetRate;
  const newLength = Math.floor(length / ratio);
  const resampled = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const src = i * ratio;
    const idx = Math.floor(src);
    const frac = src - idx;
    resampled[i] = mono[idx] * (1 - frac) + (mono[idx + 1] || 0) * frac;
  }

  const wavBytes = encodeWav(resampled, targetRate);
  return 'data:audio/wav;base64,' + bytesToBase64(wavBytes);
}

function encodeWav(samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buf);
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ── File import helper: decode any audio file, split into ~N-min PCM chunks, re-encode each as WAV ──
async function audioFileToChunks(file, chunkDurationSec = 20 * 60) {
  const ctx = new AudioContext();
  try {
    const arr = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arr);
    const targetRate = 16000;

    // Downmix to mono Float32 at sourceRate
    const sourceRate = audioBuffer.sampleRate;
    const totalSamples = audioBuffer.length;
    const monoSource = new Float32Array(totalSamples);
    const numChannels = audioBuffer.numberOfChannels;
    for (let ch = 0; ch < numChannels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < totalSamples; i++) monoSource[i] += data[i] / numChannels;
    }

    // Linear resample to targetRate
    const ratio = sourceRate / targetRate;
    const resampledLength = Math.floor(totalSamples / ratio);
    const monoResampled = new Float32Array(resampledLength);
    for (let i = 0; i < resampledLength; i++) {
      const src = i * ratio;
      const idx = Math.floor(src);
      const frac = src - idx;
      monoResampled[i] = monoSource[idx] * (1 - frac) + (monoSource[idx + 1] || 0) * frac;
    }

    const chunkSamples = Math.floor(chunkDurationSec * targetRate);
    const chunks = [];
    for (let start = 0; start < monoResampled.length; start += chunkSamples) {
      const end = Math.min(start + chunkSamples, monoResampled.length);
      const slice = monoResampled.subarray(start, end);
      const wavBytes = encodeWav(slice, targetRate);
      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      chunks.push({
        blob,
        startMs: (start / targetRate) * 1000,
        endMs: (end / targetRate) * 1000,
      });
    }
    return chunks;
  } finally {
    ctx.close();
  }
}

// Make available as globals (loaded before offscreen.js / import.js)
self.transcribeChunks = transcribeChunks;
self.audioFileToChunks = audioFileToChunks;
