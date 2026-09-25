#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "Missing .env. Run ./scripts/setup.sh first." >&2
  exit 1
fi

if [ ! -x "$PROJECT_DIR/backend/.venv/bin/python" ] || [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
  echo "Dependencies are missing. Run ./scripts/setup.sh first." >&2
  exit 1
fi

cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(
  cd "$PROJECT_DIR/backend"
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 18011
) &
BACKEND_PID=$!

cd "$PROJECT_DIR/frontend"
BACKEND_URL=http://127.0.0.1:18011 \
NEXT_PUBLIC_BACKEND_WS_ORIGIN=ws://127.0.0.1:18011 \
npm run dev -- --hostname 127.0.0.1 --port 3000
