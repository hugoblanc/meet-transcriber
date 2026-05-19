// import.js — File import → transcribe → save → redirect to meeting page

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const progress = document.getElementById('progress');
const progressLabel = document.getElementById('progress-label');
const progressDetail = document.getElementById('progress-detail');
const errorBox = document.getElementById('error-box');
const errorMsg = document.getElementById('error-msg');

let busy = false;

dropZone.addEventListener('click', () => fileInput.click());

['dragenter', 'dragover'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-active');
  }),
);

['dragleave', 'drop'].forEach((evt) =>
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-active');
  }),
);

dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  if (busy) return;
  busy = true;
  errorBox.hidden = true;
  dropZone.style.pointerEvents = 'none';
  dropZone.style.opacity = '0.5';
  progress.hidden = false;

  try {
    const { apiKey, language } = await chrome.storage.local.get(['apiKey', 'language']);
    if (!apiKey) throw new Error('Clé API OpenAI non configurée. Ouvre les réglages depuis la popup.');

    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    progressLabel.textContent = `Décodage de ${file.name}…`;
    progressDetail.textContent = `${sizeMb} Mo`;

    const chunks = await audioFileToChunks(file, 20 * 60);

    progressLabel.textContent = `Transcription en cours — ${chunks.length} ${chunks.length > 1 ? 'sections' : 'section'}`;
    progressDetail.textContent = chunks.length > 1
      ? 'Section 1 puis le reste en parallèle (continuité des locuteurs).'
      : 'Section unique.';

    let done = 0;
    const { segments, metadata } = await transcribeChunks(chunks, {
      apiKey,
      language: language || 'fr',
      onProgress: (p) => {
        if (p.stage === 'chunk-done') {
          done++;
          progressDetail.textContent = `${done} / ${chunks.length} sections terminées`;
        }
      },
    });

    progressLabel.textContent = 'Sauvegarde…';
    progressDetail.textContent = '';

    const entry = buildEntry(file, segments, metadata);
    await saveEntry(entry);

    // Redirect to meeting page
    location.href = `meeting.html?id=${encodeURIComponent(entry.id)}`;
  } catch (e) {
    progress.hidden = true;
    errorBox.hidden = false;
    errorMsg.textContent = e.message || String(e);
    dropZone.style.pointerEvents = '';
    dropZone.style.opacity = '';
    busy = false;
  }
}

function buildEntry(file, segments, metadata) {
  const now = new Date();
  const speakers = metadata.speakers || [];
  return {
    id: now.getTime().toString(),
    date: now.toISOString(),
    duration: metadata.duration || 0,
    speakers,
    segments,
    text: formatTranscript(segments, metadata, now, file.name),
    url: '',
    title: file.name,
    imported: true,
  };
}

function formatTranscript(segments, metadata, date, filename) {
  const d = date.toLocaleDateString('fr-FR');
  const tm = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const durationMin = Math.round((metadata?.duration || 0) / 60);
  const speakers = (metadata?.speakers || []).join(', ') || 'Inconnu';

  let md = `# Transcript — ${d} ${tm}\n`;
  if (filename) md += `**Source :** ${filename}\n`;
  md += `**Durée :** ${durationMin} min · **Locuteurs :** ${speakers}\n\n`;
  for (const seg of segments) md += `[${seg.speaker || '?'}] ${seg.text}\n`;
  return md;
}

async function saveEntry(entry) {
  const { transcripts = [] } = await chrome.storage.local.get({ transcripts: [] });
  transcripts.unshift(entry);
  if (transcripts.length > 50) transcripts.length = 50;
  await chrome.storage.local.set({ transcripts });
}
