#!/bin/bash
# Task Manager Control Script
# Usage: ./control.sh {start|stop|restart|status}

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/taskmanager.pid"
WEB_PORT=8080

cd "$PROJECT_DIR"

get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    fi
}

is_running() {
    local pid=$(get_pid)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    return 1
}

start() {
    if is_running; then
        echo "Task Manager is already running (PID: $(get_pid))"
        exit 1
    fi

    echo "Starting Task Manager on port $WEB_PORT..."

    if [ -f "$PROJECT_DIR/.venv/bin/python3" ]; then
        PYTHON="$PROJECT_DIR/.venv/bin/python3"
    elif command -v python3 &> /dev/null; then
        PYTHON=python3
    elif command -v python &> /dev/null; then
        PYTHON=python
    else
        echo "Error: Python is not installed"
        exit 1
    fi

    nohup $PYTHON server.py > /dev/null 2>&1 &
    echo $! > "$PID_FILE"

    sleep 1

    if is_running; then
        echo "Task Manager started (PID: $(get_pid))"
        echo "Open http://localhost:$WEB_PORT in your browser"
    else
        echo "Failed to start Task Manager"
        rm -f "$PID_FILE"
        exit 1
    fi
}

stop() {
    if ! is_running; then
        echo "Task Manager is not running"
        rm -f "$PID_FILE"
        return 0
    fi

    local pid=$(get_pid)
    echo "Stopping Task Manager (PID: $pid)..."

    kill "$pid"

    local count=0
    while is_running && [ $count -lt 10 ]; do
        sleep 1
        count=$((count + 1))
    done

    if is_running; then
        echo "Force killing..."
        kill -9 "$pid" 2>/dev/null
    fi

    rm -f "$PID_FILE"
    echo "Task Manager stopped"
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if is_running; then
        echo "Task Manager is running (PID: $(get_pid))"
        echo "http://localhost:$WEB_PORT"
    else
        echo "Task Manager is not running"
    fi
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac