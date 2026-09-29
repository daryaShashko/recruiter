#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/n8n/docker-compose.local.yml"

if ! command -v podman >/dev/null 2>&1; then
  if [[ -x "/opt/podman/bin/podman" ]]; then
    PATH="/opt/podman/bin:$PATH"
    export PATH
  else
    echo "Podman CLI is missing. Install Podman Desktop and initialize a Podman machine first." >&2
    exit 1
  fi
fi

if ! podman info >/dev/null 2>&1; then
  echo "Starting the Podman machine..."
  if ! podman machine start; then
    echo "No ready Podman machine. Initialize one in Podman Desktop, then retry." >&2
    exit 1
  fi
fi

if ! podman compose version >/dev/null 2>&1; then
  echo "No Compose provider found. Install/enable one in Podman Desktop, then retry." >&2
  exit 1
fi

podman compose -f "$COMPOSE_FILE" up -d

echo
echo "Local n8n is starting at http://localhost:5678"
echo "Container status: podman ps"
echo "Container logs:   podman logs -f recruiter-n8n-local"
