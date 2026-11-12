#!/usr/bin/env bash
set -euo pipefail

KEY_FILE="$HOME/.ssh/oci_n8n.key"
HOST="ubuntu@92.5.70.116"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "Ошибка: файл ключа $KEY_FILE не найден."
  exit 1
fi

echo "=== Применение оптимизации памяти для n8n на сервере ==="

ssh -i "$KEY_FILE" -o ConnectTimeout=15 "$HOST" bash -s << 'EOF'
  set -euo pipefail
  cd ~/n8n-stack

  # 1. Проверяем наличие swapfile
  echo "1. Проверка Swap..."
  free -h

  # 2. Обновляем docker-compose.yml добавляя NODE_OPTIONS и флаги экономии памяти
  echo ""
  echo "2. Настройка NODE_OPTIONS=--max-old-space-size=1536 и очистки памяти..."
  
  # Проверяем, есть ли уже NODE_OPTIONS
  if ! grep -q "NODE_OPTIONS" docker-compose.yml; then
    # Делаем бэкап
    cp docker-compose.yml docker-compose.yml.bak
    
    # Вставляем переменные после NODE_ENV=production
    sed -i '/NODE_ENV=production/a \      - NODE_OPTIONS=--max-old-space-size=1536\n      - EXECUTIONS_DATA_SAVE_ON_ERROR=all\n      - EXECUTIONS_DATA_PRUNE=true\n      - EXECUTIONS_DATA_MAX_AGE=168\n      - N8N_DEFAULT_BINARY_DATA_MODE=filesystem\n      - N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true' docker-compose.yml
    echo "✅ Переменные оптимизации памяти успешно добавлены в docker-compose.yml!"
  else
    echo "ℹ️ Переменные памяти уже присутствуют в docker-compose.yml"
  fi

  echo ""
  echo "3. Перезапуск n8n с увеличенным лимитом памяти до 1.5 GB..."
  docker compose up -d

  echo ""
  echo "4. Проверка запущенного контейнера n8n:"
  sleep 4
  docker compose ps
  docker compose logs --tail=15 n8n
EOF
