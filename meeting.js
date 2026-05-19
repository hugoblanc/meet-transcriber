// meeting.js — Full-page transcript view

const $ = (sel) => document.querySelector(sel);

const viewTranscript = $('#view-transcript');
const viewTemplates = $('#view-templates');
const transcriptTitle = $('#transcript-title');
const transcriptMeta = $('#transcript-meta');
const transcriptContent = $('#transcript-content');
const pageEmpty = $('#page-empty');
const speakersSection = $('#speakers-section');
const speakersGrid = $('#speakers-grid');

let currentTranscript = null;

const DEFAULT_TEMPLATES = [
  {
    id: 'summary',
    name: 'Résumé',
    icon: '📋',
    builtin: true,
    enabled: true,
    prompt: 'You are a meeting assistant. Analyze this meeting transcript and provide a structured summary in the SAME LANGUAGE as the transcript.\n\nFormat:\n## Résumé\n[2-3 sentence overview of what was discussed and concluded]\n\n## Points clés\n- [key point 1]\n- [key point 2]\n- ...\n\n## Prochaines étapes\n- [next step 1]\n- [next step 2]',
  },
  {
    id: 'actions',
    name: 'Actions & Décisions',
    icon: '✅',
    builtin: true,
    enabled: true,
    prompt: 'Extract all action items and key decisions from this meeting transcript. Be specific about WHO is responsible and WHEN something is due if mentioned. Write in the SAME LANGUAGE as the transcript.\n\nFormat:\n## Action Items\n- [ ] [Owner]: [Task description] (deadline if mentioned)\n- ...\n\n## Décisions prises\n- [Decision 1]\n- [Decision 2]\n\n## Questions ouvertes\n- [Open question 1, if any]',
  },
  {
    id: 'email',
    name: 'Email de suivi',
    icon: '✉️',
    builtin: true,
    enabled: true,
    prompt: 'Draft a professional follow-up email summarizing this meeting. Write in the SAME LANGUAGE as the transcript. The email should:\n- Thank participants briefly\n- Recap key discussion points (2-3 bullets)\n- List agreed action items with owners\n- Mention next steps or next meeting if discussed\n\nKeep the tone professional but warm. Output ONLY the email body (no subject line metadata).',
  },
  {
    id: 'highlights',
    name: 'Moments clés',
    icon: '⭐',
    builtin: true,
    enabled: false,
    prompt: 'Identify the 5 most important moments in this meeting transcript. For each moment, write in the SAME LANGUAGE as the transcript:\n- Quote or paraphrase what the speaker said\n- Explain briefly why this moment matters\n- Note the speaker name\n\nFormat as a numbered list. Focus on decisions, disagreements, commitments, and surprises.',
  },
];

let aiTemplates = null;

// ── Views ──
function showView(view) {
  [viewTranscript, viewTemplates].forEach((v) => v.classList.remove('active'));
  view.classList.add('active');
}

// ── Load ──
async function loadTranscript() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) return showEmpty();

  const { transcripts = [] } = await chrome.storage.local.get({ transcripts: [] });
  const t = transcripts.find((x) => String(x.id) === String(id));
  if (!t) return showEmpty();

  currentTranscript = t;
  renderTranscript(t);
}

function showEmpty() {
  pageEmpty.hidden = false;
  document.querySelector('.export-row').hidden = true;
  document.querySelector('.transcript-body').hidden = true;
  document.querySelector('.ai-section').hidden = true;
  speakersSection.hidden = true;
  transcriptTitle.textContent = 'Transcript introuvable';
  transcriptMeta.textContent = '';
}

function renderTranscript(t) {
  const date = new Date(t.date);
  const dateStr = date.toLocaleDateString('fr-FR');
  const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const durationMin = Math.round((t.duration || 0) / 60);
  const speakers = t.speakers && t.speakers.length ? t.speakers.join(', ') : '—';

  transcriptTitle.textContent = `${dateStr} ${timeStr}`;
  transcriptMeta.innerHTML =
    `<span>${durationMin} min</span>` +
    `<span class="dot">·</span>` +
    `<span>Locuteurs : ${speakers}</span>`;
  document.title = `Transcript — ${dateStr} ${timeStr}`;

  transcriptContent.textContent = t.text;
  renderSpeakers(t);
  renderAiPills();
  renderChat();
}

// ── Speaker renaming ──
// Source of truth: `t.segments[].speaker` holds the ORIGINAL diarize labels (A, B, C…).
// `t.speakerAliases` is an overlay {originalLabel: humanName}.
// `t.text` and `t.speakers` are derived from segments + aliases.

function getUniqueOriginalSpeakers(t) {
  if (!t.segments) return [];
  const seen = new Set();
  const out = [];
  for (const s of t.segments) {
    if (s.speaker && !seen.has(s.speaker)) {
      seen.add(s.speaker);
      out.push(s.speaker);
    }
  }
  return out;
}

function renderSpeakers(t) {
  const speakers = getUniqueOriginalSpeakers(t);
  if (speakers.length < 2) {
    speakersSection.hidden = true;
    return;
  }
  speakersSection.hidden = false;
  speakersGrid.innerHTML = '';

  const aliases = t.speakerAliases || {};

  for (const original of speakers) {
    const row = document.createElement('div');
    row.className = 'speaker-row';

    const tag = document.createElement('span');
    tag.className = 'speaker-tag';
    tag.textContent = original;
    row.appendChild(tag);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'speaker-input';
    input.placeholder = 'Nom (ex: Lionel)';
    input.value = aliases[original] || '';
    input.dataset.original = original;
    input.addEventListener('change', onSpeakerRename);
    input.addEventListener('blur', onSpeakerRename);
    row.appendChild(input);

    speakersGrid.appendChild(row);
  }
}

async function onSpeakerRename(e) {
  if (!currentTranscript) return;
  const original = e.target.dataset.original;
  const newName = e.target.value.trim();
  const aliases = { ...(currentTranscript.speakerAliases || {}) };

  if (newName) aliases[original] = newName;
  else delete aliases[original];

  if (JSON.stringify(aliases) === JSON.stringify(currentTranscript.speakerAliases || {})) return;

  const updated = applyAliases(currentTranscript, aliases);
  currentTranscript = updated;
  await persistTranscript(updated);

  // Refresh display (text + meta) — DON'T rebuild inputs (user might still be typing)
  transcriptContent.textContent = updated.text;
  const durationMin = Math.round((updated.duration || 0) / 60);
  const speakersDisplay = updated.speakers && updated.speakers.length ? updated.speakers.join(', ') : '—';
  transcriptMeta.innerHTML =
    `<span>${durationMin} min</span>` +
    `<span class="dot">·</span>` +
    `<span>Locuteurs : ${speakersDisplay}</span>`;
}

function applyAliases(t, aliases) {
  // Segments are NEVER mutated — keep original labels. Aliases overlay drives display.
  const mapLabel = (label) => (label && aliases[label]) ? aliases[label] : label;

  const speakers = [];
  const seen = new Set();
  for (const s of t.segments || []) {
    const m = mapLabel(s.speaker);
    if (m && !seen.has(m)) {
      seen.add(m);
      speakers.push(m);
    }
  }
  const text = formatTranscriptWithAliases(t.segments || [], aliases, speakers, t.duration, new Date(t.date));
  return {
    ...t,
    speakers,
    text,
    speakerAliases: aliases,
  };
}

function formatTranscriptWithAliases(segments, aliases, speakers, duration, date) {
  const mapLabel = (label) => (label && aliases[label]) ? aliases[label] : (label || '?');
  const d = date.toLocaleDateString('fr-FR');
  const tm = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const durationMin = Math.round((duration || 0) / 60);
  const speakersStr = speakers && speakers.length ? speakers.join(', ') : 'Inconnu';

  let md = `# Transcript — ${d} ${tm}\n`;
  md += `**Durée :** ${durationMin} min · **Locuteurs :** ${speakersStr}\n\n`;
  for (const seg of segments) {
    md += `[${mapLabel(seg.speaker)}] ${seg.text}\n`;
  }
  return md;
}

async function persistTranscript(t) {
  const { transcripts = [] } = await chrome.storage.local.get({ transcripts: [] });
  const idx = transcripts.findIndex((x) => String(x.id) === String(t.id));
  if (idx === -1) return;
  transcripts[idx] = t;
  await chrome.storage.local.set({ transcripts });
}

// ── Chat with meeting ──

const chatThread = $('#chat-thread');
const chatForm = $('#chat-form');
const chatInput = $('#chat-input');
const chatSend = $('#chat-send');
const chatClearBtn = $('#btn-chat-clear');

const CHAT_SYSTEM_PROMPT_PREFIX =
  "You are a precise assistant answering questions about a meeting transcript. " +
  "Cite speakers when relevant. If the answer is not in the transcript, say so clearly — do not invent. " +
  "Reply in the same language as the user's question.";

let chatBusy = false;

function renderChat() {
  if (!currentTranscript) return;
  const history = currentTranscript.chatHistory || [];
  chatThread.innerHTML = '';
  for (const msg of history) appendChatMessage(msg.role, msg.content);
  chatClearBtn.hidden = history.length === 0;
}

function appendChatMessage(role, content) {
  const wrap = document.createElement('div');
  wrap.className = `chat-msg chat-msg--${role}`;
  const roleEl = document.createElement('div');
  roleEl.className = 'chat-msg-role';
  roleEl.textContent = role === 'user' ? 'Toi' : 'Assistant';
  const body = document.createElement('div');
  body.className = 'chat-msg-body';
  body.textContent = content;
  wrap.appendChild(roleEl);
  wrap.appendChild(body);
  chatThread.appendChild(wrap);
  chatThread.scrollTop = chatThread.scrollHeight;
  return body;
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

async function persistChatHistory() {
  if (!currentTranscript) return;
  await persistTranscript(currentTranscript);
}

async function sendChatMessage(question) {
  if (!currentTranscript || chatBusy) return;
  chatBusy = true;
  chatSend.disabled = true;

  const history = currentTranscript.chatHistory || [];
  history.push({ role: 'user', content: question });
  currentTranscript.chatHistory = history;
  appendChatMessage('user', question);
  chatClearBtn.hidden = false;

  const assistantBody = appendChatMessage('assistant', '');
  assistantBody.classList.add('streaming');

  try {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const apiKey = settings && settings.apiKey;
    if (!apiKey) throw new Error('Clé API non configurée');

    const systemContent =
      `${CHAT_SYSTEM_PROMPT_PREFIX}\n\n--- TRANSCRIPT START ---\n${currentTranscript.text}\n--- TRANSCRIPT END ---`;

    // Keep last 10 turns to bound context cost
    const recent = history.slice(-10);
    const messages = [
      { role: 'system', content: systemContent },
      ...recent,
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        temperature: 0.3,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI ${response.status}: ${errText.slice(0, 150)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) {
            full += delta;
            assistantBody.textContent = full;
            chatThread.scrollTop = chatThread.scrollHeight;
          }
        } catch (_) {
          /* ignore parse errors on partial chunks */
        }
      }
    }

    assistantBody.classList.remove('streaming');

    if (!full) full = '(Pas de réponse)';
    history.push({ role: 'assistant', content: full });
    currentTranscript.chatHistory = history;
    await persistChatHistory();
  } catch (e) {
    assistantBody.classList.remove('streaming');
    assistantBody.textContent = 'Erreur : ' + e.message;
    // Roll back the user message from history so they can retry
    history.pop();
    currentTranscript.chatHistory = history;
  } finally {
    chatBusy = false;
    chatSend.disabled = false;
    chatInput.focus();
  }
}

chatInput.addEventListener('input', () => autoGrow(chatInput));
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || chatBusy) return;
  chatInput.value = '';
  autoGrow(chatInput);
  sendChatMessage(text);
});

chatClearBtn.addEventListener('click', async () => {
  if (!currentTranscript) return;
  if (!confirm('Effacer toute la conversation ?')) return;
  currentTranscript.chatHistory = [];
  await persistChatHistory();
  renderChat();
});

// ── Copy / download ──
async function copyText(text, feedbackBtn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (feedbackBtn) {
    const orig = feedbackBtn.textContent;
    feedbackBtn.textContent = 'Copié !';
    feedbackBtn.classList.add('btn-copy-ok');
    setTimeout(() => {
      feedbackBtn.textContent = orig;
      feedbackBtn.classList.remove('btn-copy-ok');
    }, 1500);
  }
}

function downloadTranscript(t) {
  const blob = new Blob([t.text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date(t.date);
  a.download = `transcript-${d.toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson(t) {
  const exportData = {
    id: t.id,
    date: t.date,
    duration: t.duration,
    speakers: t.speakers,
    segments: t.segments,
    url: t.url,
    title: t.title,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date(t.date);
  a.download = `transcript-${d.toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleDelete() {
  if (!currentTranscript) return;
  if (!confirm('Supprimer définitivement ce transcript ?')) return;
  await chrome.runtime.sendMessage({ type: 'DELETE_TRANSCRIPT', id: currentTranscript.id });
  window.close();
}

// ── AI templates ──
async function loadTemplates() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_TEMPLATES' });
  aiTemplates = (res && res.templates)
    ? res.templates
    : DEFAULT_TEMPLATES.map((t) => Object.assign({}, t));
}

async function saveTemplates() {
  await chrome.runtime.sendMessage({ type: 'SAVE_TEMPLATES', templates: aiTemplates });
}

function renderAiPills() {
  const container = $('#ai-pills');
  if (!container || !aiTemplates) return;
  container.innerHTML = '';

  const enabled = aiTemplates.filter((t) => t.enabled);
  for (const t of enabled) {
    const pill = document.createElement('button');
    pill.className = 'ai-pill';
    pill.dataset.id = t.id;
    pill.innerHTML = `<span class="ai-pill-icon">${t.icon}</span>${t.name}`;
    pill.addEventListener('click', () => runTemplate(t));
    container.appendChild(pill);
  }

  const manage = document.createElement('button');
  manage.className = 'ai-pill ai-pill-manage';
  manage.textContent = '+ Templates';
  manage.addEventListener('click', openTemplateManager);
  container.appendChild(manage);
}

const MULTI_STAGE_THRESHOLD_SEC = 25 * 60; // 25 min
const STAGE_CHUNK_SEC = 10 * 60; // 10 min per chunk in stage 1

async function runTemplate(template) {
  if (!currentTranscript) return;

  document.querySelectorAll('.ai-pill').forEach((p) => p.classList.remove('active'));
  const activePill = document.querySelector(`.ai-pill[data-id="${template.id}"]`);
  if (activePill) activePill.classList.add('active');

  const loading = $('#ai-loading');
  const loadingLabel = $('#ai-loading-label');
  const result = $('#ai-result');
  const resultTitle = $('#ai-result-title');
  const resultContent = $('#ai-result-content');

  loadingLabel.textContent = 'Analyse en cours…';
  loading.hidden = false;
  result.hidden = true;

  try {
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    const apiKey = settings && settings.apiKey;
    if (!apiKey) throw new Error('Clé API non configurée');

    const duration = currentTranscript.duration || 0;
    const segments = currentTranscript.segments || [];
    const isLong = duration > MULTI_STAGE_THRESHOLD_SEC && segments.length > 0;

    let text;
    if (isLong) {
      text = await runMultiStage(template, segments, apiKey, loadingLabel);
    } else {
      text = await callOpenAI(template.prompt, currentTranscript.text, apiKey);
    }

    loading.hidden = true;
    resultTitle.textContent = `${template.icon} ${template.name}`;
    resultContent.textContent = text;
    result.hidden = false;
  } catch (e) {
    loading.hidden = true;
    resultTitle.textContent = 'Erreur';
    resultContent.textContent = e.message;
    result.hidden = false;
  }
}

async function callOpenAI(systemPrompt, userContent, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
    }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI ${response.status}: ${errText.slice(0, 150)}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

function chunkSegmentsByDuration(segments, chunkSec) {
  if (segments.length === 0) return [];
  const chunks = [];
  let current = [];
  let currentStart = segments[0].start || 0;
  for (const s of segments) {
    if ((s.start || 0) - currentStart >= chunkSec && current.length > 0) {
      chunks.push(current);
      current = [];
      currentStart = s.start || 0;
    }
    current.push(s);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function segmentsToText(segments, aliases) {
  const hasSpeakers = segments.some((s) => s.speaker);
  if (!hasSpeakers) return segments.map((s) => s.text).join('\n');
  const mapLabel = (label) => (label && aliases && aliases[label]) ? aliases[label] : (label || '?');
  return segments.map((s) => `[${mapLabel(s.speaker)}] ${s.text}`).join('\n');
}

async function runMultiStage(template, segments, apiKey, loadingLabel) {
  const aliases = currentTranscript.speakerAliases || {};
  const chunks = chunkSegmentsByDuration(segments, STAGE_CHUNK_SEC);

  loadingLabel.textContent = `Étape 1/2 — analyse de ${chunks.length} sections en parallèle…`;
  const stage1Prompt =
    template.prompt +
    "\n\n--- CONTEXT: this is ONE section of a longer meeting. Extract relevant content for the requested format, even partial. Do not write conclusions yet.";

  const partials = await Promise.all(
    chunks.map((c) => callOpenAI(stage1Prompt, segmentsToText(c, aliases), apiKey)),
  );

  loadingLabel.textContent = 'Étape 2/2 — synthèse finale…';
  const combined = partials
    .map((p, i) => `### Section ${i + 1}\n${p}`)
    .join('\n\n');

  const stage2Prompt =
    template.prompt +
    "\n\n--- CONTEXT: below are partial analyses of consecutive sections of one long meeting. " +
    "Merge them into a single coherent final response following the exact format above. " +
    "Eliminate duplicates, consolidate overlapping points, and produce one polished output (not a section-by-section recap).";

  return callOpenAI(stage2Prompt, combined, apiKey);
}

function openTemplateManager() {
  const list = $('#templates-list');
  list.innerHTML = '';

  for (let i = 0; i < aiTemplates.length; i++) {
    const t = aiTemplates[i];
    const item = document.createElement('div');
    item.className = 'tpl-item';
    item.innerHTML =
      `<div class="tpl-item-info">` +
      `<span class="tpl-item-icon">${t.icon}</span>` +
      `<span class="tpl-item-name">${t.name}</span>` +
      (t.builtin ? `<span class="tpl-item-builtin">défaut</span>` : '') +
      `</div>` +
      `<div style="display:flex;gap:4px">` +
      `<button class="icon-btn tpl-toggle" data-idx="${i}" title="${t.enabled ? 'Désactiver' : 'Activer'}">` +
      (t.enabled
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--green)" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`) +
      `</button>` +
      (!t.builtin
        ? `<button class="icon-btn tpl-delete" data-idx="${i}" title="Supprimer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>`
        : '') +
      `</div>`;
    list.appendChild(item);
  }

  list.querySelectorAll('.tpl-toggle').forEach((btn) => {
    btn.addEventListener('click', function () {
      const idx = parseInt(this.dataset.idx, 10);
      aiTemplates[idx].enabled = !aiTemplates[idx].enabled;
      saveTemplates();
      openTemplateManager();
    });
  });

  list.querySelectorAll('.tpl-delete').forEach((btn) => {
    btn.addEventListener('click', function () {
      const idx = parseInt(this.dataset.idx, 10);
      aiTemplates.splice(idx, 1);
      saveTemplates();
      openTemplateManager();
    });
  });

  showView(viewTemplates);
}

// ── Event listeners ──
$('#btn-copy').addEventListener('click', function () {
  if (currentTranscript) copyText(currentTranscript.text, this);
});
$('#btn-download').addEventListener('click', () => {
  if (currentTranscript) downloadTranscript(currentTranscript);
});
$('#btn-download-json').addEventListener('click', () => {
  if (currentTranscript) downloadJson(currentTranscript);
});
$('#btn-delete').addEventListener('click', handleDelete);

$('#btn-copy-ai').addEventListener('click', function () {
  const content = $('#ai-result-content');
  if (content) copyText(content.textContent, this);
});

$('#btn-back-templates').addEventListener('click', () => {
  showView(viewTranscript);
  renderAiPills();
});

$('#btn-add-template').addEventListener('click', () => {
  const nameInput = $('#new-tpl-name');
  const promptInput = $('#new-tpl-prompt');
  const name = nameInput.value.trim();
  const prompt = promptInput.value.trim();
  if (!name || !prompt) return;

  aiTemplates.push({
    id: `custom_${Date.now()}`,
    name,
    icon: '🔧',
    builtin: false,
    enabled: true,
    prompt,
  });
  saveTemplates();
  nameInput.value = '';
  promptInput.value = '';
  openTemplateManager();
});

// ── Init ──
(async () => {
  await loadTemplates();
  await loadTranscript();
})();
