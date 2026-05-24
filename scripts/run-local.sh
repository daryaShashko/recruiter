#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRAPER_DIR="$ROOT_DIR/scraper"
ENV_FILE="$ROOT_DIR/.env"

DRY_RUN="false"
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="true"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[local-run] Missing .env at $ENV_FILE"
  exit 1
fi

WEBHOOK_URL="$(node -e "require('dotenv').config({path: process.argv[1]}); process.stdout.write(process.env.WEBHOOK_URL || '')" "$ENV_FILE")"

if [[ -z "$WEBHOOK_URL" ]]; then
  echo "[local-run] WEBHOOK_URL is empty in .env"
  exit 1
fi

if [[ "$WEBHOOK_URL" != http://* && "$WEBHOOK_URL" != https://* ]]; then
  echo "[local-run] WEBHOOK_URL must start with http:// or https://"
  exit 1
fi

echo "[local-run] Mode: $([[ "$DRY_RUN" == "true" ]] && echo "dry" || echo "full")"
echo "[local-run] WEBHOOK_URL: $WEBHOOK_URL"

if [[ "$WEBHOOK_URL" == http://localhost:5678/* || "$WEBHOOK_URL" == https://localhost:5678/* ]]; then
  echo "[local-run] Checking local n8n..."
  curl -fsS "http://localhost:5678" >/dev/null

  echo "[local-run] Probing local webhook path..."
  probe_payload='{"jobs":[],"meta":{"source":"probe","count":0,"sentAt":"2026-05-24T00:00:00.000Z"}}'
  curl -fsS -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    --data "$probe_payload" >/dev/null
fi

if [[ "$DRY_RUN" != "true" ]]; then
  echo "[local-run] Checking Ollama..."
  curl -fsS "http://localhost:11434/api/tags" >/dev/null
fi

cd "$SCRAPER_DIR"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[local-run] Running scraper in DRY_RUN mode..."
  DRY_RUN=true npm run scrape
else
  echo "[local-run] Running scraper..."
  npm run scrape
fi
