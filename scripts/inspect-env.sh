#!/usr/bin/env bash
set -euo pipefail

KEY_FILE="$HOME/.ssh/oci_n8n.key"
HOST="ubuntu@92.5.70.116"

ssh -i "$KEY_FILE" -o ConnectTimeout=15 "$HOST" bash -s << 'EOF'
  cd ~/n8n-stack

  echo "=== Переменные окружения (без паролей) ==="
  grep -v 'PASSWORD\|SECRET\|KEY\|TOKEN' .env || true

  echo ""
  echo "=== Проверка ответа n8n изнутри Caddy и n8n ==="
  docker compose exec -T caddy wget -q -S -O - http://n8n:5678/ || true
  docker compose exec -T caddy wget -q -S -O - http://n8n:5678/healthz || true
  docker compose exec -T caddy wget -q -S -O - http://n8n:5678/signin || true
EOF
