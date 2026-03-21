#!/bin/bash
# Desktop service — Xvfb + Fluxbox + x11vnc + noVNC
#
# Provides a virtual X11 display accessible via a web browser using noVNC.
# Used by the Playwright MCP server to run Chromium in headed (visible) mode.
#
# Usage:
#   ./desktop.sh start      Start the desktop
#   ./desktop.sh stop       Stop the desktop
#   ./desktop.sh restart    Restart the desktop
#   ./desktop.sh status     Check if running
#   ./desktop.sh logs [N]   Show last N lines of output
#   ./desktop.sh attach     Attach to tmux session

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"

# ---------------------------------------------------------------------------
# Watched runner mode (runs INSIDE the tmux session)
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--run-watched" ]]; then
    source "$SCRIPT_DIR/_env-watch.sh"

    build_desktop_cmd() {
        CMD_TO_RUN="bash /home/vscode/project/devtools/services/desktop.sh --run"
    }

    run_with_env_watch 3 "NOVNC_PORT" build_desktop_cmd
    exit $?
fi

# ---------------------------------------------------------------------------
# Run mode (runs INSIDE the tmux session)
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--run" ]]; then
    # VS Code sets WAYLAND_DISPLAY which causes x11vnc to think it's a Wayland
    # session and refuse to start. We're explicitly using Xvfb, so unset it.
    unset WAYLAND_DISPLAY

    NOVNC_PORT=$(grep -oP '^NOVNC_PORT=\K.+' /home/vscode/project/.env 2>/dev/null || echo "6080")
    VNC_PORT=5900
    DISPLAY_NUM=":1"

    export DISPLAY="$DISPLAY_NUM"

    cleanup() {
        echo "[desktop] Shutting down..."
        kill "$NOVNC_PID" "$X11VNC_PID" "$WM_PID" "$XVFB_PID" 2>/dev/null || true
    }
    trap cleanup EXIT

    # Start Xvfb (virtual framebuffer X server)
    Xvfb "$DISPLAY_NUM" -screen 0 1280x720x24 -ac &
    XVFB_PID=$!
    sleep 0.5

    # Start a lightweight window manager so browser windows have decorations
    fluxbox -display "$DISPLAY_NUM" &
    WM_PID=$!

    # Start VNC server attached to the display (localhost only — websockify proxies it)
    x11vnc -display "$DISPLAY_NUM" -nopw -listen localhost -rfbport "$VNC_PORT" -forever -shared -quiet &
    X11VNC_PID=$!
    sleep 0.5

    # Start noVNC websockify: proxies the VNC port to a WebSocket for browser access
    websockify --web=/usr/share/novnc/ "$NOVNC_PORT" "localhost:${VNC_PORT}" &
    NOVNC_PID=$!

    echo "[desktop] noVNC ready at http://localhost:${NOVNC_PORT}"
    echo "[desktop] Display: $DISPLAY_NUM — VNC on localhost:${VNC_PORT}"

    # Keep alive until Xvfb exits
    wait "$XVFB_PID"
    exit 0
fi

# ---------------------------------------------------------------------------
# Normal service management mode
# ---------------------------------------------------------------------------

SERVICE_NAME="dev-desktop"
READY_PATTERN="noVNC ready at http://localhost"
SERVICE_CMD="bash /home/vscode/project/devtools/services/desktop.sh --run-watched"

source "$SCRIPT_DIR/_lib.sh"

run_service_command "$@"
