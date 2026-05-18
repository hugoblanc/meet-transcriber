#!/bin/bash
# Meet Transcriber MCP — Installation script
# Sets up the native messaging host for Chrome and the MCP server for Claude

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.meettranscriber.bridge"
DATA_DIR="$HOME/.meet-transcriber/transcripts"

echo "╔══════════════════════════════════════╗"
echo "║   Meet Transcriber MCP — Install     ║"
echo "╚══════════════════════════════════════╝"
echo ""

# 1. Install npm dependencies
echo "→ Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent 2>/dev/null
echo "  ✓ Dependencies installed"

# 2. Make scripts executable
chmod +x "$SCRIPT_DIR/mcp-server.js"
chmod +x "$SCRIPT_DIR/native-host.js"
echo "  ✓ Scripts made executable"

# 3. Create data directory
mkdir -p "$DATA_DIR"
echo "  ✓ Data directory: $DATA_DIR"

# 4. Get extension ID
echo ""
echo "→ Extension ID needed for native messaging."
echo "  Find it on chrome://extensions (enable Developer Mode)."
echo "  It looks like: abcdefghijklmnopqrstuvwxyz012345"
echo ""
read -p "  Extension ID: " EXT_ID

if [ -z "$EXT_ID" ]; then
  echo "  ✗ No extension ID provided. Aborting."
  exit 1
fi

# 5. Register native messaging host for Chrome
CHROME_NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$CHROME_NM_DIR"

cat > "$CHROME_NM_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Meet Transcriber — bridge between Chrome extension and local storage",
  "path": "$SCRIPT_DIR/native-host.js",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo "  ✓ Native messaging host registered"
echo "    $CHROME_NM_DIR/$HOST_NAME.json"

# 6. Output Claude Code MCP config
echo ""
echo "════════════════════════════════════════"
echo ""
echo "→ Add this to your Claude Code MCP settings"
echo "  (Settings → MCP Servers, or .claude/settings.json):"
echo ""
echo "  \"meet-transcriber\": {"
echo "    \"command\": \"node\","
echo "    \"args\": [\"$SCRIPT_DIR/mcp-server.js\"]"
echo "  }"
echo ""
echo "════════════════════════════════════════"
echo ""
echo "✓ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Reload the Chrome extension (chrome://extensions)"
echo "  2. Add the MCP config to Claude Code"
echo "  3. Ask Claude: \"liste mes transcripts de réunion\""
