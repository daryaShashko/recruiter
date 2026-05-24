#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRAPER_DIR="$ROOT_DIR/scraper"
ENV_FILE="$ROOT_DIR/.env"
RUN_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
RUN_START_TS="$(date +%s)"
PREFLIGHT_START_TS="$RUN_START_TS"
PREFLIGHT_END_TS="$RUN_START_TS"

WEBHOOK_CHECK_STATUS="pending"
N8N_CHECK_STATUS="skipped"
OLLAMA_CHECK_STATUS="skipped"
SUMMARY_PRINTED="false"

DRY_RUN="false"
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="true"
fi

http_status() {
  local url="$1"
  curl -sS -o /dev/null -w "%{http_code}" --max-time 8 "$url" || true
}

ensure_http_200() {
  local name="$1"
  local url="$2"
  local status
  status="$(http_status "$url")"

  if [[ "$status" != "200" ]]; then
    echo "[local-run] ${name} check failed: ${url} returned HTTP ${status}"
    return 1
  fi

  return 0
}

probe_webhook() {
  local url="$1"
  local payload
  payload='{"jobs":[],"meta":{"source":"probe","count":0,"sentAt":"2026-05-24T00:00:00.000Z"}}'

  local response
  response="$(curl -sS -w $'\n%{http_code}' -X POST "$url" \
    -H "Content-Type: application/json" \
    --data "$payload" || true)"

  local status
  local body
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$status" != "200" ]]; then
    WEBHOOK_CHECK_STATUS="failed"
    echo "[local-run] Webhook preflight failed: ${url} returned HTTP ${status}"
    if [[ -n "$body" ]]; then
      echo "[local-run] Webhook response: $body"
    fi
    echo "[local-run] Ensure n8n workflow is active and URL path matches /webhook/jobs/ingest"
    exit 1
  fi

  WEBHOOK_CHECK_STATUS="ok"
}

print_health_summary() {
  local exit_code="${1:-0}"
  local now_ts
  now_ts="$(date +%s)"

  local preflight_secs
  preflight_secs="$((PREFLIGHT_END_TS - PREFLIGHT_START_TS))"
  if [[ "$preflight_secs" -lt 0 ]]; then
    preflight_secs=0
  fi

  local total_secs
  total_secs="$((now_ts - RUN_START_TS))"
  if [[ "$total_secs" -lt 0 ]]; then
    total_secs=0
  fi

  echo ""
  echo "[local-run] Health summary"
  echo "[local-run] Started at (UTC): $RUN_STARTED_AT"
  echo "[local-run] Result: $([[ "$exit_code" -eq 0 ]] && echo "success" || echo "failed (exit $exit_code)")"
  echo "[local-run] Mode: $([[ "$DRY_RUN" == "true" ]] && echo "dry" || echo "full")"
  echo "[local-run] Checks: webhook=${WEBHOOK_CHECK_STATUS}, n8n=${N8N_CHECK_STATUS}, ollama=${OLLAMA_CHECK_STATUS}"
  echo "[local-run] Preflight duration: ${preflight_secs}s"
  echo "[local-run] Total duration: ${total_secs}s"
}

on_exit() {
  local exit_code="$1"
  if [[ "$SUMMARY_PRINTED" == "true" ]]; then
    return
  fi

  SUMMARY_PRINTED="true"
  if [[ "$PREFLIGHT_END_TS" == "$PREFLIGHT_START_TS" ]]; then
    PREFLIGHT_END_TS="$(date +%s)"
  fi

  print_health_summary "$exit_code"
}

trap 'on_exit $?' EXIT

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[local-run] Missing .env at $ENV_FILE"
  exit 1
fi

WEBHOOK_URL="$(grep -E '^WEBHOOK_URL=' "$ENV_FILE" | head -1 | sed 's/^WEBHOOK_URL=//;s/[[:space:]]//g;s/^["\x27]//;s/["\x27]$//')"

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

echo "[local-run] Preflight: checking webhook endpoint..."
probe_webhook "$WEBHOOK_URL"

if [[ "$WEBHOOK_URL" == http://localhost:5678/* || "$WEBHOOK_URL" == https://localhost:5678/* ]]; then
  echo "[local-run] Checking local n8n..."
  if ! ensure_http_200 "n8n" "http://localhost:5678"; then
    N8N_CHECK_STATUS="failed"
    exit 1
  fi
  N8N_CHECK_STATUS="ok"
else
  N8N_CHECK_STATUS="not-local-url"
fi

if [[ "$DRY_RUN" != "true" ]]; then
  echo "[local-run] Checking Ollama..."
  if ! ensure_http_200 "Ollama" "http://localhost:11434/api/tags"; then
    OLLAMA_CHECK_STATUS="failed"
    exit 1
  fi
  OLLAMA_CHECK_STATUS="ok"
else
  OLLAMA_CHECK_STATUS="skipped-dry-run"
fi

PREFLIGHT_END_TS="$(date +%s)"

cd "$SCRAPER_DIR"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[local-run] Running scraper in DRY_RUN mode..."
  DRY_RUN=true npm run scrape
else
  echo "[local-run] Running scraper..."
  npm run scrape
fi
