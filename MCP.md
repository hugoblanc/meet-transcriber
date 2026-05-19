# MCP Server — Setup for AI Agents

This document is for users who want their AI agents (Claude, Cursor, ChatGPT, etc.) to read the meeting transcripts produced by the Chrome extension.

If you only want the extension itself, see [README.md](README.md). This document covers the **optional** MCP bridge that lets agents query your transcripts.

## What it does

The MCP server (`mcp/mcp-server.js`) is a stdio-based [Model Context Protocol](https://modelcontextprotocol.io) server. It reads transcripts from `~/.meet-transcriber/transcripts/` and exposes four tools to any MCP client:

| Tool | Purpose | Arguments |
|---|---|---|
| `list_transcripts` | Lists all transcripts (metadata + 200-char preview, no full text) | _none_ |
| `get_transcript` | Returns the full markdown of one transcript | `id` (string) |
| `get_latest_transcript` | Returns the full markdown of the most recent transcript | _none_ |
| `search_transcripts` | Case-insensitive substring search across all transcripts | `query` (string) |

The server is read-only — no agent can create, modify, or delete transcripts through it. Writes happen exclusively through the Chrome extension via the native messaging host.

## Install

```bash
cd mcp/
./install.sh
```

The installer:
1. Runs `npm install` to fetch `@modelcontextprotocol/sdk` and `zod`
2. Registers the Chrome native messaging host at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.meettranscriber.bridge.json` (macOS — adjust path for Linux/Windows)
3. Asks for your Chrome extension ID (find it on `chrome://extensions` with Developer Mode on)
4. Prints the MCP client config snippet for the next step

## Client configuration

After install, register the MCP server in your AI agent's config.

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "meet-transcriber": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/meet-transcriber/mcp/mcp-server.js"]
    }
  }
}
```

Restart Claude Code. Verify with `/mcp` — you should see `meet-transcriber` listed with 4 tools.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent path on Windows/Linux:

```json
{
  "mcpServers": {
    "meet-transcriber": {
      "command": "node",
      "args": ["/absolute/path/to/meet-transcriber/mcp/mcp-server.js"]
    }
  }
}
```

Quit and reopen Claude Desktop.

### Cursor

Add to `~/.cursor/mcp.json` or use the Settings UI → MCP Servers:

```json
{
  "mcpServers": {
    "meet-transcriber": {
      "command": "node",
      "args": ["/absolute/path/to/meet-transcriber/mcp/mcp-server.js"]
    }
  }
}
```

### Generic JSON (other clients)

The server speaks vanilla stdio MCP. Any compliant client works with:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/meet-transcriber/mcp/mcp-server.js"]
}
```

If your client needs to invoke a specific Node version (e.g., when `node` is not in `PATH`), use the absolute path to the node binary — for example with `fnm`:

```json
{
  "command": "/Users/you/.local/share/fnm/node-versions/v22.14.0/installation/bin/node",
  "args": ["/absolute/path/to/meet-transcriber/mcp/mcp-server.js"]
}
```

## Verification

Test the server outside of any client with two stdio messages:

```bash
(printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_transcripts","arguments":{}}}' \
) | node mcp/mcp-server.js
```

Expected output: two JSON-RPC responses, the second containing your transcripts metadata.

## Example agent prompts

Once configured, ask your agent things like:

- *"Liste mes transcripts de réunion."*
- *"Donne-moi le compte-rendu de mon dernier meeting."*
- *"Cherche 'roadmap Q3' dans toutes mes réunions."*
- *"Qu'est-ce que Marie a dit sur l'optimisation du cache dans la sprint review du 18/05 ?"*

The agent will call `list_transcripts` to discover available meetings, then `get_transcript` / `search_transcripts` as needed.

## Transcript schema

Each transcript file under `~/.meet-transcriber/transcripts/*.json` has this shape:

```json
{
  "id": "1779123425376",
  "date": "2026-05-18T14:30:00.000Z",
  "duration": 1920,
  "speakers": ["Hugo", "Marie"],
  "segments": [
    {"speaker": "Hugo", "start": 0, "end": 5.2, "text": "Bonjour Marie..."},
    {"speaker": "Marie", "start": 5.5, "end": 12.1, "text": "Oui parfait..."}
  ],
  "text": "# Transcript — 18/05/2026 14:30\n**Durée :** 32 min · **Locuteurs :** Hugo, Marie\n\n[Hugo] Bonjour Marie...\n[Marie] Oui parfait...",
  "url": "https://meet.google.com/abc-defg-hij",
  "title": "Sprint Review — Sprint 42"
}
```

Field details:

- `id`: Unix timestamp in ms, as a string. Used by `get_transcript`.
- `date`: ISO-8601 UTC.
- `duration`: Seconds.
- `speakers`: Distinct labels found in the segments. Either raw diarize letters (`A`, `B`, ...) or human names if the user renamed them.
- `segments`: Per-utterance breakdown with timestamps in seconds. Always preserves original diarize labels — renaming is applied at display time via a `speakerAliases` overlay (not present in the on-disk export — agents see the final renamed names directly).
- `text`: Pre-formatted markdown used by the agent. Agents should generally prefer this field over reconstructing from segments.
- `url`: Source tab URL (Google Meet URL or other).
- `title`: Tab title at recording time, or filename for imported audio.

## Troubleshooting

**The server is listed but returns no transcripts.**
Transcripts are only synced to disk when a recording finishes after the native messaging host is installed. If you have transcripts in the extension's history that don't appear on disk, they predate the install (or the native host failed silently). The extension's `background.js → syncTranscriptToDisk()` catches all errors silently — to debug, inspect the service worker console at `chrome://extensions`.

**Agent doesn't see the `meet-transcriber` tools after install.**
Most clients only load MCP servers at startup. Fully quit the client (Cmd+Q on macOS — not just close the window) and reopen.

**Native messaging host fails.**
Check that the extension ID in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.meettranscriber.bridge.json` matches the actual extension ID on `chrome://extensions`. Reinstall via `mcp/install.sh` if needed.

## Privacy

- Transcripts never leave your machine except to `api.openai.com` during the transcription itself.
- The MCP server is fully local — stdio only, no network.
- Your OpenAI API key is stored in `chrome.storage.local` and is never read by the MCP server.
