#!/bin/bash
# ---------------------------------------------------------------------------
# .env file watcher for services
# ---------------------------------------------------------------------------
#
# Source this file, then call run_with_env_watch() to run a service command
# that automatically restarts when watched .env values change.
#
# This script is NOT meant to be run directly.
#
# Usage:
#   source _env-watch.sh
#   run_with_env_watch <poll_seconds> <env_keys_csv> <build_cmd_fn> [cleanup_fn]
#
#   poll_seconds   - How often to check .env (e.g., 3)
#   env_keys_csv   - Comma-separated .env keys to watch (e.g., "NOVNC_PORT")
#   build_cmd_fn   - Function name that sets CMD_TO_RUN (called each restart)
#   cleanup_fn     - Optional function called before restart (e.g., to free a port)
# ---------------------------------------------------------------------------

ENV_FILE="/home/vscode/project/.env"

BOLD="\033[1m"
DIM="\033[2m"
YELLOW="\033[33m"
GREEN="\033[32m"
RESET="\033[0m"

# Read a single value from .env
read_env_value() {
    grep "^${1}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | head -1
}

# Build a fingerprint string from all watched keys
env_fingerprint() {
    local keys="$1"
    local fingerprint=""
    local IFS=','
    for key in $keys; do
        fingerprint="${fingerprint}${key}=$(read_env_value "$key");"
    done
    echo "$fingerprint"
}

# Log current watched values
log_env_values() {
    local keys="$1"
    local IFS=','
    for key in $keys; do
        printf "  ${DIM}%s${RESET}=%s\n" "$key" "$(read_env_value "$key")"
    done
}

# Kill a process and its children, with escalation to SIGKILL
kill_tree() {
    local pid="$1"
    if ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi

    pkill -TERM -P "$pid" 2>/dev/null
    kill -TERM "$pid" 2>/dev/null

    local waited=0
    while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 3 ]]; do
        sleep 1
        ((waited++))
    done

    if kill -0 "$pid" 2>/dev/null; then
        pkill -KILL -P "$pid" 2>/dev/null
        kill -KILL "$pid" 2>/dev/null
        wait "$pid" 2>/dev/null
    fi
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

run_with_env_watch() {
    local poll_interval="$1"
    local env_keys="$2"
    local build_cmd_fn="$3"
    local cleanup_fn="${4:-}"

    local child_pid=""

    _env_watch_shutdown() {
        if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
            printf "\n[env-watch] ${DIM}Shutting down...${RESET}\n"
            kill_tree "$child_pid"
        fi
        [[ -n "$cleanup_fn" ]] && "$cleanup_fn"
        exit 0
    }
    trap _env_watch_shutdown SIGTERM SIGINT SIGHUP EXIT

    printf "[env-watch] Watching: ${BOLD}%s${RESET}\n" "$(echo "$env_keys" | tr ',' ', ')"
    echo ""

    while true; do
        local fingerprint
        fingerprint=$(env_fingerprint "$env_keys")

        "$build_cmd_fn"

        log_env_values "$env_keys"
        echo ""

        eval "$CMD_TO_RUN" &
        child_pid=$!

        local restarting=false
        while kill -0 "$child_pid" 2>/dev/null; do
            sleep "$poll_interval"

            local new_fingerprint
            new_fingerprint=$(env_fingerprint "$env_keys")

            if [[ "$fingerprint" != "$new_fingerprint" ]]; then
                echo ""
                printf "[env-watch] ${YELLOW}.env changed — restarting...${RESET}\n"
                log_env_values "$env_keys"

                kill_tree "$child_pid"
                [[ -n "$cleanup_fn" ]] && "$cleanup_fn"

                restarting=true
                break
            fi
        done

        if [[ "$restarting" == false ]]; then
            wait "$child_pid" 2>/dev/null
            local ec=$?
            echo ""
            printf "[env-watch] ${DIM}Service exited (code %d). Restarting in 2s...${RESET}\n" "$ec"
            sleep 2
        fi

        child_pid=""
        echo ""
    done
}
