#!/usr/bin/env bash
set -euo pipefail

KEY_FILE="$HOME/.ssh/oci_n8n.key"
HOST="ubuntu@92.5.70.116"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "Ошибка: файл ключа $KEY_FILE не найден."
  exit 1
fi

ssh -i "$KEY_FILE" -o ConnectTimeout=15 "$HOST" bash -s << 'EOF'
  cd ~/n8n-stack 2>/dev/null || cd ~

  echo "=== 1. Состояние контейнеров ==="
  docker compose ps

  echo ""
  echo "=== 2. Конфигурация docker-compose.yml ==="
  cat docker-compose.yml

  echo ""
  echo "=== 3. Конфигурация Caddyfile (если есть) ==="
  cat Caddyfile 2>/dev/null || cat caddy/Caddyfile 2>/dev/null || echo "Caddyfile не найден"

  echo ""
  echo "=== 4. Последние логи n8n ==="
  docker compose logs --tail=25 n8n

  echo ""
  echo "=== 5. Локальный опрос портов ==="
  curl -sI http://localhost:5678/ || true
  curl -sI http://localhost:5678/healthz || true
EOF
