#!/usr/bin/env node
// MCP server — exposes meeting transcripts to Claude via stdio transport

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TRANSCRIPTS_DIR = path.join(os.homedir(), '.meet-transcriber', 'transcripts');

function ensureDir() {
  if (!fs.existsSync(TRANSCRIPTS_DIR)) {
    fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  }
}

function readAllTranscripts() {
  ensureDir();
  const files = fs.readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(TRANSCRIPTS_DIR, f), 'utf-8'));
    } catch (_) {
      return null;
    }
  }).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));
}

const server = new McpServer({
  name: 'meet-transcriber',
  version: '0.1.0',
});

server.tool(
  'list_transcripts',
  'List all meeting transcripts with metadata (date, duration, speakers). Returns a summary without the full text.',
  {},
  async () => {
    const transcripts = readAllTranscripts().map(t => ({
      id: t.id,
      date: t.date,
      duration_seconds: t.duration,
      duration_display: Math.round((t.duration || 0) / 60) + ' min',
      speakers: t.speakers || [],
      title: t.title || '',
      url: t.url || '',
      preview: (t.text || '').slice(0, 200),
    }));

    if (transcripts.length === 0) {
      return { content: [{ type: 'text', text: 'Aucun transcript disponible.' }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(transcripts, null, 2) }] };
  },
);

server.tool(
  'get_transcript',
  'Get the full text of a specific meeting transcript by its ID.',
  { id: z.string().describe('Transcript ID (timestamp-based)') },
  async ({ id }) => {
    const filePath = path.join(TRANSCRIPTS_DIR, id + '.json');
    if (!fs.existsSync(filePath)) {
      return { content: [{ type: 'text', text: 'Transcript ' + id + ' introuvable.' }] };
    }

    const t = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { content: [{ type: 'text', text: t.text || 'Transcript vide.' }] };
  },
);

server.tool(
  'get_latest_transcript',
  'Get the full text of the most recent meeting transcript.',
  {},
  async () => {
    const transcripts = readAllTranscripts();
    if (transcripts.length === 0) {
      return { content: [{ type: 'text', text: 'Aucun transcript disponible.' }] };
    }

    const t = transcripts[0];
    const header = '# ' + new Date(t.date).toLocaleDateString('fr-FR') +
      ' — ' + Math.round((t.duration || 0) / 60) + ' min\n\n';
    return { content: [{ type: 'text', text: header + (t.text || '') }] };
  },
);

server.tool(
  'search_transcripts',
  'Search across all meeting transcripts for a keyword or phrase. Returns matching excerpts.',
  { query: z.string().describe('Search query (case-insensitive)') },
  async ({ query }) => {
    const transcripts = readAllTranscripts();
    const q = query.toLowerCase();
    const results = [];

    for (const t of transcripts) {
      const text = (t.text || '').toLowerCase();
      const idx = text.indexOf(q);
      if (idx === -1) continue;

      const start = Math.max(0, idx - 80);
      const end = Math.min(text.length, idx + query.length + 80);
      const excerpt = '...' + (t.text || '').slice(start, end) + '...';

      results.push({
        id: t.id,
        date: t.date,
        speakers: t.speakers || [],
        excerpt,
      });
    }

    if (results.length === 0) {
      return { content: [{ type: 'text', text: 'Aucun résultat pour "' + query + '".' }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
