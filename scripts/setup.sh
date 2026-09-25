#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for command_name in python3.12 node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

if [ ! -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
  echo "Created .env from .env.example. Fill in your own credentials before starting the app."
fi

python3.12 -m venv "$PROJECT_DIR/backend/.venv"
"$PROJECT_DIR/backend/.venv/bin/pip" install -r "$PROJECT_DIR/backend/requirements.txt"
npm ci --prefix "$PROJECT_DIR/frontend"

echo "Setup complete. Edit .env, then run ./scripts/dev.sh"
