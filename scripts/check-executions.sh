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

  echo "=== 1. Последние логи n8n ==="
  docker compose logs --tail=30 n8n

  echo ""
  echo "=== 2. Статус последних выполнений из базы данных ==="
  docker compose exec -T n8n node -e '
    const { Client } = require("pg");
    const client = new Client({
      host: process.env.DB_POSTGRESDB_HOST || "10.0.0.173",
      port: 5432,
      database: process.env.DB_POSTGRESDB_DATABASE || "n8n",
      user: process.env.DB_POSTGRESDB_USER || "n8n",
      password: process.env.DB_POSTGRESDB_PASSWORD,
    });
    client.connect().then(async () => {
      const res = await client.query(`
        SELECT id, status, mode, "startedAt", "stoppedAt" 
        FROM "execution_entity" 
        ORDER BY id DESC LIMIT 5;
      `);
      console.table(res.rows);
      client.end();
    }).catch(err => {
      console.error("DB error:", err.message);
      process.exit(1);
    });
  '
EOF
