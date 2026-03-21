#!/bin/bash
# Shared library for tmux-managed development services
#
# Usage: Source this file and call the functions
#   source "$(dirname "$0")/_lib.sh"
#
# Each service script should define:
#   SERVICE_NAME    - tmux session name (e.g., "dev-desktop")
#   SERVICE_CMD     - command to run
#   READY_PATTERN   - pattern that indicates service is ready

# Note: We don't use 'set -e' here because grep returns 1 when no match,
# which would cause premature exit in our pattern detection loops.

PROJECT_ROOT="/home/vscode/project"

# Check if a tmux session exists
session_exists() {
    tmux has-session -t "$SERVICE_NAME" 2>/dev/null
}

# Check if the process inside the session is still running
# Returns 0 if running, 1 if session exists but process died
session_healthy() {
    if ! session_exists; then
        return 1
    fi

    # Check if there's an active process (not just a dead shell)
    local pane_pid
    pane_pid=$(tmux list-panes -t "$SERVICE_NAME" -F '#{pane_pid}' 2>/dev/null | head -1)

    if [[ -z "$pane_pid" ]]; then
        return 1
    fi

    # Check if that process has children (the actual service)
    if pgrep -P "$pane_pid" > /dev/null 2>&1; then
        return 0
    fi

    return 1
}

# Wait for the service's ready pattern to appear in the tmux pane output.
_wait_for_ready() {
    local timeout=30
    local elapsed=0
    local output=""

    while [[ $elapsed -lt $timeout ]]; do
        sleep 1
        output=$(tmux capture-pane -t "$SERVICE_NAME" -p 2>/dev/null || echo "")

        if [[ -n "$READY_PATTERN" ]] && echo "$output" | grep -qF "$READY_PATTERN"; then
            echo "$output"
            echo "[$SERVICE_NAME] Ready"
            return 0
        fi

        ((elapsed++)) || true
    done

    echo "$output"
    echo "[$SERVICE_NAME] Started (timeout waiting for ready pattern)"
    return 0
}

# Start the service in a tmux session.
# Usage: do_start [--attach]
do_start() {
    local attach=false
    if [[ "$1" == "--attach" ]]; then
        attach=true
    fi

    if session_healthy; then
        echo "[$SERVICE_NAME] Already running"
        [[ -n "$READY_PATTERN" ]] && echo "$READY_PATTERN"
    elif session_exists; then
        echo "[$SERVICE_NAME] Restarting inside existing session..."
        tmux send-keys -t "$SERVICE_NAME" "$SERVICE_CMD" Enter
        _wait_for_ready
    else
        echo "[$SERVICE_NAME] Starting..."
        tmux new-session -d -s "$SERVICE_NAME" -c "$PROJECT_ROOT"
        tmux send-keys -t "$SERVICE_NAME" "$SERVICE_CMD" Enter
        _wait_for_ready
    fi

    if [[ "$attach" == true ]]; then
        sleep 0.5
        tmux attach-session -t "$SERVICE_NAME"
    fi

    return 0
}

# Stop the service and kill the tmux session entirely
do_stop() {
    if ! session_exists; then
        echo "[$SERVICE_NAME] Not running"
        return 0
    fi

    echo "[$SERVICE_NAME] Stopping..."
    tmux send-keys -t "$SERVICE_NAME" C-c
    sleep 1
    tmux kill-session -t "$SERVICE_NAME" 2>/dev/null || true
    echo "[$SERVICE_NAME] Stopped"
}

# Restart the service.
# Usage: do_restart [--attach]
do_restart() {
    local attach=""
    [[ "$1" == "--attach" ]] && attach="--attach"

    if ! session_exists; then
        do_start $attach
        return
    fi

    echo "[$SERVICE_NAME] Restarting..."
    tmux send-keys -t "$SERVICE_NAME" C-c
    sleep 1
    tmux send-keys -t "$SERVICE_NAME" "$SERVICE_CMD" Enter
    _wait_for_ready
    echo "[$SERVICE_NAME] Restarted"

    if [[ -n "$attach" ]]; then
        sleep 0.5
        tmux attach-session -t "$SERVICE_NAME"
    fi
}

# Check status
do_status() {
    if session_healthy; then
        echo "[$SERVICE_NAME] Running"
        return 0
    elif session_exists; then
        echo "[$SERVICE_NAME] Stale (session exists but process died)"
        return 1
    else
        echo "[$SERVICE_NAME] Stopped"
        return 1
    fi
}

# Show recent logs
# Usage: do_logs [N] [--watch]
do_logs() {
    local lines=50
    local watch=false

    for arg in "$@"; do
        case "$arg" in
            --watch|-f)
                watch=true
                ;;
            [0-9]*)
                lines="$arg"
                ;;
        esac
    done

    if ! session_exists; then
        echo "[$SERVICE_NAME] Not running - no logs available"
        return 1
    fi

    if [[ "$watch" == true ]]; then
        echo "=== $SERVICE_NAME logs (watching, Ctrl+C to exit) ==="
        while true; do
            clear
            echo "=== $SERVICE_NAME logs (last $lines lines, watching) ==="
            tmux capture-pane -t "$SERVICE_NAME" -p -S -"$lines"
            sleep 1
        done
    else
        echo "=== $SERVICE_NAME logs (last $lines lines) ==="
        tmux capture-pane -t "$SERVICE_NAME" -p -S -"$lines"
    fi
}

# Attach to the session (interactive)
do_attach() {
    if ! session_exists; then
        echo "[$SERVICE_NAME] Not running"
        return 1
    fi

    echo "Attaching to $SERVICE_NAME (Ctrl+B, D to detach)..."
    tmux attach-session -t "$SERVICE_NAME"
}

# Main command dispatcher
run_service_command() {
    local cmd="${1:-start}"
    shift || true

    case "$cmd" in
        start)
            do_start "$@"
            ;;
        stop)
            do_stop "$@"
            ;;
        restart)
            do_restart "$@"
            ;;
        status)
            do_status "$@"
            ;;
        logs)
            do_logs "$@"
            ;;
        attach)
            do_attach "$@"
            ;;
        *)
            echo "Usage: $0 <command> [options]"
            echo ""
            echo "Commands:"
            echo "  start [--attach]     Start the service (--attach to follow output)"
            echo "  stop                 Stop the service"
            echo "  restart [--attach]   Restart the service"
            echo "  status               Check if service is running"
            echo "  logs [N] [--watch]   Show last N lines (default: 50, --watch to follow)"
            echo "  attach               Attach to tmux session (interactive)"
            exit 1
            ;;
    esac
}
