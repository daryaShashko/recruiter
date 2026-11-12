#!/usr/bin/env bash
set -euo pipefail

KEY_FILE="$HOME/.ssh/oci_n8n.key"
HOST="ubuntu@92.5.70.116"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "Ошибка: файл ключа $KEY_FILE не найден."
  exit 1
fi

echo "=== Подключение к серверу Oracle VM ($HOST) ==="
echo "Введите пароль от SSH ключа при запросе..."

ssh -i "$KEY_FILE" -o ConnectTimeout=15 "$HOST" bash -s << 'EOF'
  set -euo pipefail

  echo ""
  echo "1. Проверка и настройка Swap (защита от нехватки памяти OOM)..."
  if [ ! -f /swapfile ]; then
    echo "Создаем swapfile 2GB..."
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    if ! grep -q '/swapfile' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    fi
    echo "✅ Swap 2GB успешно создан и активирован."
  else
    sudo swapon /swapfile 2>/dev/null || true
    echo "✅ Swap уже настроен."
  fi
  free -h

  echo ""
  echo "2. Настройка сетевой маршрутизации к базе данных (10.0.0.173)..."
  sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null
  sudo iptables -t nat -C POSTROUTING -o ens3 -j MASQUERADE 2>/dev/null || sudo iptables -t nat -I POSTROUTING -o ens3 -j MASQUERADE
  echo "✅ IP forwarding и MASQUERADE активны."

  echo ""
  echo "3. Проверка DNS для Docker (/etc/docker/daemon.json)..."
  sudo mkdir -p /etc/docker
  if [ ! -f /etc/docker/daemon.json ] || ! grep -q '8.8.8.8' /etc/docker/daemon.json; then
    echo '{"dns": ["8.8.8.8", "1.1.1.1"]}' | sudo tee /etc/docker/daemon.json >/dev/null
    sudo systemctl restart docker
    sleep 3
  fi
  sudo iptables -I FORWARD -p udp --dport 53 -j ACCEPT 2>/dev/null || true
  sudo iptables -I FORWARD -p tcp --dport 53 -j ACCEPT 2>/dev/null || true

  echo ""
  echo "4. Запуск Docker стека n8n + Caddy..."
  cd ~/n8n-stack 2>/dev/null || cd ~
  docker compose up -d

  echo "Ждем 5 секунд готовности сервисов..."
  sleep 5

  echo ""
  echo "5. Проверка состояния контейнеров:"
  docker compose ps

  echo ""
  echo "6. Проверка связи с БД PostgreSQL (10.0.0.173:5432):"
  docker compose exec -T n8n node -e '
    const net = require("net");
    const s = net.createConnection(5432, "10.0.0.173", () => {
      console.log("✅ Доступ к PostgreSQL (10.0.0.173:5432) успешен!");
      s.end();
    });
    s.on("error", (e) => {
      console.log("❌ Ошибка соединения с БД: " + e.message);
      process.exit(1);
    });
  '

  echo ""
  echo "7. Проверка внешнего DNS изнутри n8n:"
  docker compose exec -T n8n node -e '
    const dns = require("dns");
    ["api.telegram.org", "api.notion.com", "generativelanguage.googleapis.com"].forEach(h => {
      dns.lookup(h, (err, ip) => {
        if (err) console.log("❌ " + h + " -> " + err.message);
        else console.log("✅ " + h + " -> " + ip);
      });
    });
  '

  echo ""
  echo "8. Проверка локального веб-сервера n8n:"
  curl -s -o /dev/null -w "n8n HTTP статус: %{http_code}\n" http://localhost:5678/healthz || true
EOF
