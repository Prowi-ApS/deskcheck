#!/usr/bin/env bash
# Generic Playwright MCP server launcher — multi-session edition
#
# Runs the generic Playwright MCP server (playwright-server.cjs) that provides
# vanilla Playwright tools with multi-session support via session_id.
#
# When the desktop service is running (service:desktop start), sets DISPLAY=:1
# so Chromium launches in headed (visible) mode on noVNC.
#
# Start desktop:  service:desktop start
# noVNC viewer:   http://localhost:6080

# Resolve project root from script location (devtools/mcp/playwright/playwright.sh → project root)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Use headed mode when the desktop service is running (Xvfb creates /tmp/.X1-lock)
if [[ -f /tmp/.X1-lock ]]; then
    export DISPLAY=:1
    echo "[playwright] Headed mode — DISPLAY=:1, noVNC at http://localhost:6080" >&2
else
    # VS Code injects DISPLAY=:0 which points to an inaccessible X server
    # (requires Xauthority not available in-container). Unset it to force
    # true headless mode when the desktop service is not running.
    unset DISPLAY
    echo "[playwright] Headless mode (desktop not running)" >&2
fi

# Run from .playwright-mcp so relative screenshot filenames land there automatically.
OUTPUT_DIR="$PROJECT_ROOT/.playwright-mcp"
mkdir -p "$OUTPUT_DIR"
cd "$OUTPUT_DIR"

export PLAYWRIGHT_OUTPUT_DIR="$OUTPUT_DIR"

# Resolve @playwright/mcp location.
# 1. Check global install first (pre-installed in Dockerfile via npm install -g)
# 2. Fall back to npx cache (installed via npx in previous sessions)
# 3. Bootstrap as last resort (completely fresh environment)
GLOBAL_ROOT="$(npm root -g 2>/dev/null)"
GLOBAL_MCP="$GLOBAL_ROOT/@playwright/mcp/index.js"

if [[ -f "$GLOBAL_MCP" ]]; then
    MCP_MODULES="$(dirname "$GLOBAL_MCP")"
    # Global install bundles playwright-core inside @playwright/mcp/node_modules/
    MCP_NODE_MODULES="$MCP_MODULES/node_modules"
    echo "[playwright] Using global @playwright/mcp" >&2
else
    MCP_CACHE="$(npm config get cache)/_npx"
    MCP_MODULES=$(find "$MCP_CACHE" -path "*/node_modules/@playwright/mcp/index.js" -exec dirname {} \; 2>/dev/null | head -1)

    if [[ -z "$MCP_MODULES" ]]; then
        echo "[playwright] Bootstrapping @playwright/mcp..." >&2
        if ! npx @playwright/mcp@0.0.68 --version >&2; then
            echo "[playwright] Error: Failed to install @playwright/mcp" >&2
            exit 1
        fi
        MCP_MODULES=$(find "$MCP_CACHE" -path "*/node_modules/@playwright/mcp/index.js" -exec dirname {} \; 2>/dev/null | head -1)
        if [[ -z "$MCP_MODULES" ]]; then
            echo "[playwright] Error: @playwright/mcp not found after bootstrap" >&2
            exit 1
        fi
    fi

    MCP_NODE_MODULES=$(dirname "$(dirname "$MCP_MODULES")")
    echo "[playwright] Using npx-cached @playwright/mcp" >&2
fi

export PLAYWRIGHT_MCP_NODE_MODULES="$MCP_NODE_MODULES"

exec node "$SCRIPT_DIR/playwright-server.cjs"
