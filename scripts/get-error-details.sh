#!/usr/bin/env bash
set -u

KEY_FILE="$HOME/.ssh/oci_n8n.key"
HOST="ubuntu@92.5.70.116"

ssh -i "$KEY_FILE" -o ConnectTimeout=15 "$HOST" bash -s << 'EOF'
  cd ~/n8n-stack 2>/dev/null || cd ~

  echo "=== 1. Последние 100 строк логов n8n ==="
  docker compose logs --tail=100 n8n

  echo ""
  echo "=== 2. Поиск ошибки через встроенный в n8n модуль БД ==="
  docker compose exec -T n8n node -e '
    let pgPath = "";
    try {
      const fs = require("fs");
      const path = require("path");
      function findPg(dir) {
        if (!fs.existsSync(dir)) return "";
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const full = path.join(dir, f);
          if (f === "pg" && fs.existsSync(path.join(full, "package.json"))) return full;
          if (f === ".pnpm" || f === "node_modules") {
            const res = findPg(full);
            if (res) return res;
          }
        }
        return "";
      }
      pgPath = findPg("/usr/local/lib/node_modules/n8n/node_modules");
    } catch(e) {}

    if (!pgPath) pgPath = "pg";
    try {
      const { Client } = require(pgPath);
      const client = new Client({
        host: process.env.DB_POSTGRESDB_HOST || "10.0.0.173",
        port: 5432,
        database: process.env.DB_POSTGRESDB_DATABASE || "n8n",
        user: process.env.DB_POSTGRESDB_USER || "n8n",
        password: process.env.DB_POSTGRESDB_PASSWORD,
      });
      client.connect().then(async () => {
        const last = await client.query(`
          SELECT id, status, "startedAt", "stoppedAt" 
          FROM "execution_entity" 
          ORDER BY id DESC LIMIT 5;
        `);
        console.log("Последние 5 запусков:", last.rows);

        const errExec = last.rows.find(r => r.status === "error" || r.status === "crashed");
        if (errExec) {
          console.log(`\nДетали ошибки для execution ID ${errExec.id}:`);
          let dataRes = await client.query(`SELECT "data" FROM "execution_data" WHERE "executionId" = $1;`, [errExec.id]).catch(() => ({ rows: [] }));
          let d = dataRes.rows[0]?.data;
          if (!d) {
            let entRes = await client.query(`SELECT "data" FROM "execution_entity" WHERE id = $1;`, [errExec.id]).catch(() => ({ rows: [] }));
            d = entRes.rows[0]?.data;
          }
          if (typeof d === "string") {
            try { d = JSON.parse(d); } catch(e) {}
          }
          if (d?.resultData?.error) {
            console.log("❌ Нода:", d.resultData.error.node?.name);
            console.log("❌ Ошибка:", d.resultData.error.message);
            console.log("❌ Стек:", d.resultData.error.stack || d.resultData.error.description);
          }
        }
        client.end();
      }).catch(err => {
        console.log("Ошибка подключения к БД:", err.message);
      });
    } catch(e) {
      console.log("pg модуль:", e.message);
    }
  '
EOF
