#!/usr/bin/env bash
set -euo pipefail

KEY_FILE="$HOME/.ssh/oci_n8n.key"
HOST="ubuntu@92.5.70.116"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "Ошибка: файл ключа $KEY_FILE не найден."
  exit 1
fi

ssh -i "$KEY_FILE" -o ConnectTimeout=10 "$HOST" bash -s << 'EOF'
  cd ~/n8n-stack 2>/dev/null || cd ~
  echo "=== Логи n8n при обработке 295 вакансий ==="
  docker compose logs --tail=30 n8n
EOF
