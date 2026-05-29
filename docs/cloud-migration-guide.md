# Гайд: Миграция на Oracle Cloud Always Free

> **Цель:** Перенести n8n с локального ноутбука на стабильный 24/7 облачный сервер.  
> **Результат:** Стабильный HTTPS-эндпоинт, без tunnel, без локального Ollama, с Gemini как LLM.  
> **ADR:** [ADR-010](adr/ADR-010-cloud-migration-oracle.md) · [ADR-011](adr/ADR-011-cloud-llm-migration.md)  
> **Дата обновления гайда:** 2026-05-29

---

## Предварительные требования

Перед стартом у тебя должно быть готово:

| Что | Статус |
|-----|--------|
| Аккаунт Google (для Gemini API) | ✅ нужен |
| Банковская карта (Visa/Mastercard, не предоплаченная) | ✅ нужна для Oracle — **не будет реальных списаний** |
| Экспортированные JSON воркфлоу из локального n8n | ✅ нужны |
| Значение `N8N_ENCRYPTION_KEY` из локального n8n | ✅ **критично** |
| SSH-ключ (или создадим в процессе) | ✅ нужен |

### Как получить N8N_ENCRYPTION_KEY с локальной машины

```bash
# Вариант 1: если n8n запущен через docker
docker inspect n8n | grep ENCRYPTION_KEY

# Вариант 2: если запущен как npm/npx — ищи в файле конфига
cat ~/.n8n/config | grep encryptionKey

# Вариант 3: env переменная текущего процесса
ps aux | grep n8n
# затем смотри .env файл из которого запускался
```

> ⚠️ **Сохрани это значение** — без него Notion/Telegram credentials не расшифруются при переносе.

---

## Лимиты Oracle Always Free — что важно знать

| Ресурс | Лимит | Примечание для нас |
|--------|-------|--------------------|
| VM.Standard.A1.Flex (ARM) | 4 OCPU + 24 GB RAM | Всё на один инстанс — этого избыточно |
| Boot Volume | 200 GB суммарно | 50 GB на инстанс, остальное как block volume |
| Outbound трафик | 10 TB/месяц | Нам хватит с огромным запасом |
| Load Balancer | 1 шт × 10 Mbps | Не нужен, используем Caddy |
| Object Storage | 20 GB | Можно использовать для бэкапов |

### ⚠️ Главные подводные камни

**1. Out of host capacity (самая частая проблема)**
- A1 Flex очень популярен и часто нет свободных слотов
- **Решение:** пробовать все Availability Domains (AD-1, AD-2, AD-3) в регионе + пробовать в разное время суток + можно создавать несколько маленьких инстансов по 1 OCPU вместо одного на 4 OCPU

**2. Reclamation (рекламация) — Oracle может удалить ВМ**
- Условие: CPU < 20%, Network < 20%, Memory < 20% — **все три одновременно** в течение 7 дней
- **Решение:** n8n + postgres держат baseline нагрузку. Дополнительно можно поставить cron с `curl` на себя каждый час

**3. Iptables на Ubuntu (самый скрытый камень)**
- Oracle Ubuntu образы имеют **встроенные iptables правила** которые блокируют порты
- Одного открытия порта в Security List недостаточно — нужно также пробить `iptables`

**4. Карта для регистрации**
- Oracle делает тестовое списание ~$1 которое возвращается через 3–5 дней
- Prepaid, виртуальные и PIN-карты **не принимаются**

---

## Шаг 1: Регистрация Oracle Cloud

1. Зайди на [cloud.oracle.com/free](https://cloud.oracle.com/free) → **Start for free**
2. Заполни:
   - Email → верификация
   - Страна → **выбирай регион** (хорошие для EU: Germany Central (Frankfurt), Netherlands Northwest (Amsterdam), UK South (London))
   - Имя, фамилия
3. Пароль и верификация телефона
4. **Выбор Home Region** → выбирай **Germany Central (Frankfurt)** или **Netherlands Northwest (Amsterdam)** — потом не изменить
5. Данные карты → ждёшь активации (обычно 10–30 минут, иногда до суток)

> 💡 **Важно про Home Region:** все Always Free ресурсы создаются ТОЛЬКО в home region. Выбери регион поближе к Poland. Frankfurt — оптимально.

---

## Шаг 2: Создание VM (ARM Ampere A1)

### 2.1. Сначала создай VCN (Virtual Cloud Network)

1. Menu → **Networking** → **Virtual Cloud Networks**
2. **Start VCN Wizard** → "Create VCN with Internet Connectivity"
3. Имя: `n8n-vcn`
4. CIDR: `10.0.0.0/16` (default)
5. Нажми **Create** → дождись завершения

### 2.2. Открой порты в Security List

1. Menu → Networking → Virtual Cloud Networks → `n8n-vcn`
2. Слева: **Security Lists** → Default Security List
3. **Add Ingress Rules** → добавь эти правила:

| Stateless | Source CIDR | Protocol | Source Port | Dest Port | Описание |
|-----------|-------------|----------|-------------|-----------|----------|
| ❌ | 0.0.0.0/0 | TCP | All | 80 | HTTP (Caddy ACME challenge) |
| ❌ | 0.0.0.0/0 | TCP | All | 443 | HTTPS (n8n webhook) |
| ❌ | 0.0.0.0/0 | ICMP | - | Type 3, Code 4 | Path MTU discovery (не трогай default) |

> SSH (port 22) уже есть в default rules — не удаляй.

### 2.3. Создай инстанс

1. Menu → **Compute** → **Instances** → **Create instance**
2. **Name:** `n8n-server`
3. **Placement → Availability Domain:** AD-1 (если нет места — пробуй AD-2, AD-3)
4. **Image:** нажми **Change image** → Ubuntu → **Ubuntu 22.04** (Always Free eligible)
5. **Shape:** нажми **Change shape** → Ampere → **VM.Standard.A1.Flex**
   - OCPUs: **2** (оставь 2 в запасе на случай нужды)
   - Memory: **12 GB**
6. **Networking:** VCN `n8n-vcn` → public subnet → ✅ "Automatically assign public IPv4 address"
7. **SSH Keys:**
   - Если нет ключа: **Generate a key pair for me** → скачай приватный ключ
   - Если есть: **Paste public keys** → вставь свой `~/.ssh/id_rsa.pub` (или ed25519)
8. **Boot Volume:** 50 GB (default) → OK
9. **Create**

> 🔴 **Если получаешь "Out of host capacity":**
> - Попробуй другой AD
> - Попробуй 1 OCPU + 6 GB вместо 2+12
> - Попробуй в 2–5 часов ночи по Frankfurt
> - Жди 20–30 минут и повторяй

### 2.4. Запиши публичный IP

После того как инстанс перешёл в статус **Running:**
- Menu → Compute → Instances → `n8n-server`
- Запиши **Public IP address**: `<INSTANCE_IP>`

---

## Шаг 3: Первичная настройка сервера

### 3.1. Подключись по SSH

```bash
# Если скачивал OCI-ключ:
chmod 400 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<INSTANCE_IP>

# Если использовал свой ключ:
ssh ubuntu@<INSTANCE_IP>
```

### 3.2. Базовая настройка системы

```bash
# Обновление пакетов
sudo apt update && sudo apt upgrade -y

# Установка утилит
sudo apt install -y curl wget git nano htop unzip

# Проверка времени (должно быть UTC или Europe/Warsaw)
timedatectl
```

### 3.3. Настройка swap (4 GB)

Swap нужен для стабильности при пиках нагрузки:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Сделать постоянным
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Проверка
free -h
```

### 3.4. Открыть порты в iptables (ОБЯЗАТЕЛЬНО)

Oracle Ubuntu образы по умолчанию блокируют всё кроме SSH через iptables. Это **второй уровень** firewall поверх OCI Security List:

```bash
# Открыть порт 80 (HTTP)
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT

# Открыть порт 443 (HTTPS)
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT

# Сохранить правила чтобы не слетели после перезагрузки
sudo apt install -y iptables-persistent
sudo netfilter-persistent save

# Проверить
sudo iptables -L INPUT -n | grep -E "80|443"
```

### 3.5. Установка Docker

```bash
# Официальный скрипт установки Docker
curl -fsSL https://get.docker.com | sudo sh

# Добавить пользователя ubuntu в группу docker (без sudo)
sudo usermod -aG docker ubuntu

# Применить без перелогина
newgrp docker

# Проверка
docker --version
docker compose version
```

---

## Шаг 4: Настройка домена (DuckDNS — бесплатно)

### 4.1. Создай поддомен на DuckDNS

1. Зайди на [duckdns.org](https://duckdns.org) → Login через Google/GitHub
2. Выбери имя поддомена: например `my-n8n` → будет `my-n8n.duckdns.org`
3. В поле IP введи `<INSTANCE_IP>` → **Update IP**
4. Запиши свой **token** (он нужен для авто-обновления)

### 4.2. Авто-обновление IP через cron

```bash
# Создай скрипт обновления (замени YOUR_TOKEN и YOUR_SUBDOMAIN)
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh << 'EOF'
echo url="https://www.duckdns.org/update?domains=YOUR_SUBDOMAIN&token=YOUR_TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
EOF

chmod +x ~/duckdns/duck.sh

# Добавь в cron каждые 5 минут
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -

# Тест
~/duckdns/duck.sh && cat ~/duckdns/duck.log
# должно вернуть "OK"
```

### 4.3. Проверь DNS резолвинг

```bash
# Подожди 1–2 минуты
dig +short my-n8n.duckdns.org
# должен вернуть <INSTANCE_IP>
```

> ⚠️ **Caddy не получит Let's Encrypt сертификат, пока DNS не разрезолвится на правильный IP.** Убедись в этом перед следующим шагом.

---

## Шаг 5: Установка Docker Compose стека

### 5.1. Создай рабочую директорию

```bash
mkdir -p ~/n8n-stack && cd ~/n8n-stack
```

### 5.2. Создай `.env` файл

```bash
cat > .env << 'EOF'
# ── Домен ──────────────────────────────────────────────────
DOMAIN=my-n8n.duckdns.org
N8N_HOST=my-n8n.duckdns.org
N8N_PROTOCOL=https
WEBHOOK_URL=https://my-n8n.duckdns.org/webhook/jobs/ingest

# ── n8n безопасность ───────────────────────────────────────
# ВАЖНО: скопируй значение из локального ~/.n8n/config (encryptionKey)
# или сгенерируй новое: openssl rand -hex 24
N8N_ENCRYPTION_KEY=ВСТАВЬ_СЮДА_СВОЙ_КЛЮЧ

# ── PostgreSQL ─────────────────────────────────────────────
POSTGRES_DB=n8n
POSTGRES_USER=n8n
POSTGRES_PASSWORD=ПРИДУМАЙ_СЛОЖНЫЙ_ПАРОЛЬ
POSTGRES_NON_ROOT_USER=n8n_user
POSTGRES_NON_ROOT_PASSWORD=ДРУГОЙ_СЛОЖНЫЙ_ПАРОЛЬ

# ── n8n версия ─────────────────────────────────────────────
N8N_VERSION=latest

# ── Таймзона ───────────────────────────────────────────────
GENERIC_TIMEZONE=Europe/Warsaw
TZ=Europe/Warsaw
EOF
```

> 🔐 **Безопасность:** никогда не коммить этот файл. Убедись что `~/n8n-stack/.env` в `.gitignore` если ты клонируешь репо на сервер.

### 5.3. Создай `docker-compose.yml`

```bash
# Этот файл также лежит в репо: n8n/docker-compose.yml
# Скопируй его на сервер или создай здесь:
cat > docker-compose.yml << 'COMPOSE'
# (содержимое — смотри файл n8n/docker-compose.yml в репо)
COMPOSE
```

Файл `docker-compose.yml` уже подготовлен в репо по пути `n8n/docker-compose.yml` — скопируй его на сервер.

### 5.4. Создай `Caddyfile`

```bash
cat > Caddyfile << 'EOF'
{
  # Email для Let's Encrypt уведомлений (необязательно но рекомендуется)
  email твой@email.com
}

my-n8n.duckdns.org {
  reverse_proxy n8n:5678
}
EOF
```

### 5.5. Запуск стека

```bash
cd ~/n8n-stack

# Первый запуск
docker compose up -d

# Проверить логи (первый старт PostgreSQL занимает ~30 сек)
docker compose logs -f --tail=50

# Дождись строки: "n8n ready on 0.0.0.0, port 5678"
```

### 5.6. Проверь HTTPS

```bash
# С локальной машины (не с сервера!)
curl -I https://my-n8n.duckdns.org
# ожидаем: HTTP/2 200 или 301
```

Если всё прошло — открой `https://my-n8n.duckdns.org` в браузере. Должна открыться страница настройки n8n.

---

## Шаг 6: Первичная настройка n8n

### 6.1. Создай аккаунт в n8n

При первом открытии `https://my-n8n.duckdns.org`:
- Введи email и пароль (это будет admin-аккаунт)

### 6.2. Проверь настройки

В n8n → Settings → General:
- **Webhook URL:** должен показывать `https://my-n8n.duckdns.org/`

---

## Шаг 7: Перенос воркфлоу и credentials

### 7.1. Экспорт из локального n8n

На **локальной машине** открой n8n → Settings → **Export All Workflows** (JSON).

Или через CLI:
```bash
# Если n8n в docker
docker exec -it n8n n8n export:workflow --all --output=/tmp/workflows.json
docker cp n8n:/tmp/workflows.json ~/workflows-backup.json
```

### 7.2. Импорт на облачный n8n

На **облачном сервере** или через браузер:

**Вариант A: через UI (рекомендуется)**
1. Открой `https://my-n8n.duckdns.org`
2. Нажми **+** в левом меню → **Import from file**
3. Загружай каждый JSON из `n8n/workflows/`:
   - `ingest.json`
   - `evaluate.json`
   - `feedback-handler.json`
   - `notify.json`
   - `telegram-trigger.json`

**Вариант B: через CLI**
```bash
# Скопируй воркфлоу на сервер
scp -i ~/Downloads/ssh-key-*.key /path/to/recruiter/n8n/workflows/*.json ubuntu@<INSTANCE_IP>:~/workflows/

# Импортируй
docker exec -it n8n n8n import:workflow --separate --input=/home/node/.n8n/workflows/
# Или смонтируй volume (см. docker-compose.yml)
```

### 7.3. Воссоздай credentials (ВАЖНО)

Credentials не экспортируются из соображений безопасности. Нужно воссоздать вручную:

1. **Notion API:**
   - Settings → Credentials → New → "Notion API"
   - Вставь свой Notion Internal Integration Token

2. **Telegram Bot:**
   - New → "Telegram API"
   - Вставь Bot Token

После добавления credentials — открой каждый воркфлоу и переподключи nodes к новым credentials.

### 7.4. Обнови переменные окружения в воркфлоу

Для воркфлоу которые используют `NOTION_DB_ID`, `TELEGRAM_CHAT_ID`:
- Либо хардкодь в воркфлоу (не в репо)
- Либо используй n8n Variables (Settings → Variables)

---

## Шаг 8: Переключение LLM на Gemini

### 8.1. Получи Gemini API ключ

1. Зайди на [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. **Create API Key** → выбери проект Google Cloud
3. Скопируй ключ

> 💡 Gemini 2.0 Flash **бесплатно** на free tier: 15 RPM, 1M TPM, 1500 запросов/день

### 8.2. Добавь credentials в n8n

- Settings → Credentials → New → "HTTP Request" или используй header auth
- Или добавь в Variables: `LLM_API_KEY = <твой_ключ>`

### 8.3. Проверь провайдер в воркфлоу

В `evaluate.json` воркфлоу найди ноду **Code: LLM Router** (ADR-016):
- Убедись что `LLM_PROVIDER` = `"gemini"` или настроен через env variable
- Модель: `gemini-2.0-flash`

> 📖 Подробная инструкция по переключению: `docs/llm-provider-switching.md`

---

## Шаг 9: Обновление GitHub Secrets

На локальной машине или в GitHub UI:

```
Repo → Settings → Secrets and variables → Actions → Secrets
```

Обнови:

| Secret | Новое значение |
|--------|----------------|
| `WEBHOOK_URL` | `https://my-n8n.duckdns.org/webhook/jobs/ingest` |

Добавь новые (если ещё нет):

| Secret | Значение |
|--------|----------|
| `LLM_API_KEY` | Gemini API key |
| `NOTION_EVAL_LOG_DB_ID` | ID базы Evaluation Log |

---

## Шаг 10: End-to-End тест

### 10.1. Ручной запуск scraper

```bash
# На локальной машине
cd /path/to/recruiter/scraper

# DRY_RUN=false чтобы отправить на реальный webhook
WEBHOOK_URL=https://my-n8n.duckdns.org/webhook/jobs/ingest npm run scrape
```

Ожидаемый результат:
- Логи scraper: `Sent X jobs to webhook`
- Логи n8n (cloud): воркфлоу выполнился
- Notion: новые записи в AI Recruiter Board
- Telegram: алерты по подходящим вакансиям

### 10.2. Тест через GitHub Actions

```
Repo → Actions → Scraper → Run workflow
```

Наблюдай логи. После успеха — проверь Notion и Telegram.

### 10.3. Тест webhook URL напрямую

```bash
curl -X POST https://my-n8n.duckdns.org/webhook/jobs/ingest \
  -H "Content-Type: application/json" \
  -d '{"jobs":[{"id":"test-1","title":"Senior TS Dev","company":"Test Co","url":"https://example.com/1","body":"TypeScript Node.js React","source":"manual","scrapedAt":"2026-05-29T10:00:00Z"}],"meta":{"source":"manual","count":1,"sentAt":"2026-05-29T10:00:00Z"}}'

# Ожидаем: HTTP 200 {"message":"success"} или аналогичный ответ
```

---

## Шаг 11: Бэкапы (опционально но рекомендуется)

### 11.1. Автоматический дамп PostgreSQL в файл

```bash
cat > ~/backup-n8n.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=~/backups

mkdir -p "$BACKUP_DIR"

# Дамп PostgreSQL
docker exec n8n-stack-postgres-1 pg_dump -U n8n n8n > "$BACKUP_DIR/n8n_db_$DATE.sql"

# Бэкап n8n data volume (encryption key, etc.)
docker run --rm -v n8n-stack_n8n_storage:/data -v "$BACKUP_DIR":/backup ubuntu \
  tar czf "/backup/n8n_data_$DATE.tar.gz" /data

# Удалить старые бэкапы (хранить 7 дней)
find "$BACKUP_DIR" -name "*.sql" -mtime +7 -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
EOF

chmod +x ~/backup-n8n.sh

# Добавь в cron: каждый день в 03:00
(crontab -l 2>/dev/null; echo "0 3 * * * ~/backup-n8n.sh >> ~/backup.log 2>&1") | crontab -
```

### 11.2. Загрузка бэкапов в Oracle Object Storage (бесплатно — 20 GB)

Опционально. Инструкция в официальной документации OCI.

---

## Шаг 12: Защита от idle reclamation

Oracle может рекламировать инстанс если CPU < 20% + Network < 20% + Memory < 20% **одновременно 7 дней**.

n8n + postgres + Caddy уже дают baseline нагрузку. Для страховки:

```bash
# Добавь heartbeat: curl на себя каждые 30 минут
(crontab -l 2>/dev/null; echo "*/30 * * * * curl -s https://my-n8n.duckdns.org/healthz > /dev/null 2>&1") | crontab -
```

---

## Итоговая архитектура после миграции

```
GitHub Actions (08:00 UTC)
    └─> POST https://my-n8n.duckdns.org/webhook/jobs/ingest
               │
         Caddy (443/HTTPS, Let's Encrypt)
               │
           n8n (5678, Docker)
               │
         ┌─────┴──────┐
      PostgreSQL    Gemini API
     (n8n internal)  (LLM eval)
               │
          ┌────┴────┐
        Notion    Telegram
```

**Сервер:** Oracle Cloud A1 Flex (ARM) · 2 OCPU · 12 GB RAM · Ubuntu 22.04  
**Домен:** my-n8n.duckdns.org (DuckDNS, бесплатно)  
**HTTPS:** Caddy + Let's Encrypt (автообновление)  
**Стоимость:** $0/месяц

---

## Troubleshooting

### n8n не запускается
```bash
docker compose logs n8n
# Частая причина: postgres ещё не готов → подождать
# Или: неверный N8N_ENCRYPTION_KEY формат → должен быть hex строка
```

### Caddy не получает сертификат
```bash
docker compose logs caddy
# Проверь DNS резолвинг:
dig +short my-n8n.duckdns.org
# Должен вернуть твой IP
# Порт 80 должен быть открыт (нужен для ACME challenge)
```

### Webhook возвращает 404
```bash
# Проверь что воркфлоу активирован (не просто сохранён)
# В n8n UI: воркфлоу должен иметь toggle "Active" = ON
# URL должен совпадать с путём в Webhook ноде
```

### "Out of host capacity" при создании VM
- Попробуй AD-2 или AD-3
- Уменьши до 1 OCPU + 6 GB
- Попробуй в другое время суток
- Создай support ticket в Oracle (иногда помогает)

### Credentials не работают после переноса
```bash
# N8N_ENCRYPTION_KEY на облаке должен совпадать с локальным
# если создавал новый ключ — нужно вручную воссоздать все credentials
```

---

## Чеклист успешной миграции

- [ ] Oracle VM создан и доступен по SSH
- [ ] Порты 80/443 открыты и в Security List, и в iptables
- [ ] DuckDNS домен резолвится на IP сервера
- [ ] Docker Compose стек запущен (`docker compose ps` — все `Up`)
- [ ] HTTPS работает: `curl -I https://my-n8n.duckdns.org` → 200
- [ ] Все 5 воркфлоу импортированы и активированы в n8n
- [ ] Credentials (Notion API, Telegram Bot) воссозданы
- [ ] Gemini API Key настроен в n8n
- [ ] `WEBHOOK_URL` в GitHub Secrets обновлён
- [ ] E2E тест прошёл: scraper → n8n → Notion → Telegram
- [ ] Бэкап настроен (cron)
