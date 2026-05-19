# Meet Transcriber

**Free meeting transcription for Google Meet — no bot, no subscription, BYOK.**

A Chrome extension that captures your meeting audio (tab + microphone), transcribes it with speaker labels via OpenAI, and makes your transcripts searchable from Claude via MCP.

[Landing Page](https://hugoblanc.github.io/meet-transcriber/) · [Install](#install) · [MCP Bridge](#mcp-bridge)

---

## Why

Meeting transcription SaaS tools charge $8–20/month to wrap the same OpenAI API you already have a key for. They require accounts, store your data on their servers, and inject bots into your calls.

Meet Transcriber does the same job for **~$0.36/hour** (API cost), with:
- No bot joining your call
- No account or server
- No data leaving your machine (except to OpenAI directly)
- Full speaker diarization
- A native MCP bridge so Claude can read your meeting notes

## How it works

1. Click the extension icon on any tab → **Start**
2. Have your meeting — audio is captured locally (tab + mic)
3. Click **Stop** — audio is sent to OpenAI `gpt-4o-transcribe-diarize`
4. Get a speaker-labeled transcript in seconds

The extension captures both the tab audio (remote participants) and your microphone. If mic permission isn't granted, it gracefully falls back to tab-only capture.

## Comparison

| | Meet Transcriber | Otter.ai | Fireflies | Fathom | Tactiq |
|---|---|---|---|---|---|
| **Price** | **Free (BYOK)** | $8/mo | $10/mo | $19/mo | $8/mo |
| **No bot joins** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Speaker labels** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **MCP / AI bridge** | ✅ Native | ❌ | ❌ | ❌ | ❌ |
| **Open source** | MIT | ❌ | ❌ | ❌ | ❌ |
| **Data stays local** | ✅ | Cloud | Cloud | Cloud | Partial |
| **Unlimited recordings** | ✅ | 300 min/mo | 800 min/mo | ✅ | 10/mo |

## Install

### Chrome Extension

1. Clone or download this repo
2. Open `chrome://extensions` → enable **Developer mode**
3. Click **Load unpacked** → select the `meet-transcriber` folder
4. Click the extension icon → **Settings** → enter your OpenAI API key

> Requires Chrome 116+. Your API key stays in local browser storage and is never sent anywhere except OpenAI.

### MCP Bridge (optional)

Connect your transcripts to Claude (or any MCP-compatible agent) so you can ask questions about your meetings.

```bash
cd mcp
./install.sh
```

The script installs Node deps, registers the native messaging host with Chrome, then prints the MCP client config to paste into Claude Code / Claude Desktop / Cursor.

Then in your agent, you can say:
- *"Summarize my last meeting"*
- *"What did Marie say about the cache?"*
- *"List all my transcripts from this week"*

| Tool | Description |
|---|---|
| `list_transcripts` | List all transcripts (metadata + 200-char preview, no full text) |
| `get_transcript` | Full markdown of one transcript by `id` |
| `get_latest_transcript` | Full markdown of the most recent transcript |
| `search_transcripts` | Case-insensitive substring search across all transcripts |

**Full setup guide with client-specific configs:** [MCP.md](MCP.md).

### For AI agents

If you're an AI agent looking at this repo, start with [llms.txt](llms.txt) — it has a structured overview of the architecture and the MCP API surface, written for you.

Raw URLs (once pushed):
- `https://raw.githubusercontent.com/hugoblanc/meet-transcriber/main/llms.txt`
- `https://raw.githubusercontent.com/hugoblanc/meet-transcriber/main/MCP.md`

## Architecture

```
Chrome Extension
├── background.js        Service worker: orchestration, state, native messaging
├── offscreen.js         Audio capture, Web Audio mixing, MediaRecorder, API call
├── popup.html/js/css    Dark theme UI with waveform animation
├── content.js           Floating REC indicator on Meet pages
└── manifest.json        MV3, permissions: tabCapture, offscreen, storage

MCP Bridge
├── mcp-server.js        MCP stdio server (Claude connects here)
├── native-host.js       Chrome native messaging host (writes transcripts to disk)
└── install.sh           Registration script

Data flow:
  Tab audio ─┐
              ├─ Web Audio mix ─→ MediaRecorder ─→ OpenAI API ─→ Transcript
  Microphone ─┘                                                     │
                                                                    ├─→ chrome.storage (popup)
                                                                    └─→ ~/.meet-transcriber/ (MCP)
```

## Key design decisions

- **Offscreen document** for audio: MV3 service workers can't use getUserMedia/Web Audio/MediaRecorder
- **Tab audio re-routed to speakers**: `tabCapture` mutes playback — we reconnect it via `AudioContext.destination`
- **Mic with echoCancellation**: prevents double-capture of remote audio through speakers
- **Graceful mic fallback**: if mic permission is denied, records tab audio only (remote participants)
- **Settings via service worker**: offscreen documents don't have access to `chrome.storage` — all storage ops go through `chrome.runtime.sendMessage`

## Privacy

- Audio is sent directly from your browser to the OpenAI API. No intermediary server.
- Audio is not stored after transcription.
- Your API key lives in `chrome.storage.local` — never synced, never exported.
- Transcripts are stored locally (browser storage + `~/.meet-transcriber/` if MCP is installed).
- No telemetry, no analytics, no third-party services beyond OpenAI.
- Open source — read every line.

## Cost

| Meeting duration | Cost |
|---|---|
| 15 min | ~$0.09 |
| 30 min | ~$0.18 |
| 1 hour | ~$0.36 |

Uses `gpt-4o-transcribe-diarize` at ~$0.006/min.

## Tech stack

- Chrome Extension Manifest V3
- Web Audio API + MediaRecorder (opus/webm)
- OpenAI Audio Transcription API
- MCP (Model Context Protocol) over stdio
- Chrome Native Messaging
- Zero backend, zero dependencies (extension side)

## License

MIT — do whatever you want with it.

## Credits

Built in Lyon by [Hugo Blanc](https://github.com/hugoblanc) with Claude.
Part of the [Whisper Voice](https://hugoblanc.github.io/whisper-voice/) ecosystem.
