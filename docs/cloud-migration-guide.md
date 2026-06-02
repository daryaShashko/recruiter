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

> Примечание: на текущем шаге VCN уже создан с CIDR `10.0.0.0/24`. Ниже — объяснение последствий этого выбора и рекомендации по разбиению сети (public/private) и проверке пересечений.

1. Menu → **Networking** → **Virtual Cloud Networks**
2. **Start VCN Wizard** → 'Create VCN with Internet Connectivity'
3. Имя: `n8n-vcn`
4. CIDR: `10.0.0.0/24` (уже создано)

Если вы только планируете один VM, который будет запускать весь docker-compose стек (Caddy, n8n, Postgres) — можно оставить `/24` и разместить инстанс в публичной подсети (с публичным IP). Это самый быстрый путь. Если хотите лучше изолировать базу данных и подготовиться к масштабированию — рекомендую создать отдельные подсети (пример ниже).

Рекомендации по разбиению (варианты)

- Вариант A — Быстро и просто (одна подсеть):
  - Оставляем одну публичную подсеть: `10.0.0.0/24`. Всё запускается на одном VM. Закрываем порты для БД на уровне firewall/iptables, раскрываем только 80/443/SSH.

- Вариант B — Рекомендуемый (минимум: public + private):
  - Public subnet (Caddy, bastion): `10.0.0.0/26`
  - App subnet (n8n / приложение): `10.0.0.64/26`
  - DB subnet (Postgres, internal): `10.0.0.128/26`
  - Management / future: `10.0.0.192/26`

  Почему: отдельная приватная подсеть для БД позволяет не давать ей публичный IP и ограничить доступ по Security Lists / NSG только из app-подсети.

- Вариант C — Если потребуется масштабирование (лучше для `/16`):
  - Ресайз VCN до `/16` нельзя — нужно пересоздать VCN с `10.0.0.0/16` и затем использовать /24 подсети (10.0.0.0/24, 10.0.1.0/24 и т.д.).

Как создать подсети через Web Console (UI)

1. В VCN → вкладка **Subnets** → **Create Subnet**
2. Выберите: Name, Compartment, CIDR block (например `10.0.0.0/26`), тип — **Regional** (рекомендуется). Для публичной подсети отметьте, что VNIC может получать Public IPv4.
3. Создайте Internet Gateway (IG) для публичных подсетей: VCN → Internet Gateways → Create Internet Gateway, затем добавьте route rule `0.0.0.0/0` → IG в таблицу маршрутизации публичной подсети.
4. Для private подсетей не давайте public IP и используйте NAT Gateway (если они должны выходить в интернет).

Примеры Security Lists / NSG

- Public subnet (ingress):
  - TCP 80, TCP 443 от 0.0.0.0/0
  - SSH TCP 22 от вашего статического IP (или узкого диапазона)
- Private subnet (ingress):
  - TCP 5432 (Postgres) только от App subnet CIDR
  - Разрешить внутренний трафик VCN: source = `10.0.0.0/16` (или конкретные подсети)

Рекомендация: используйте Network Security Groups (NSG), если планируете гибко привязывать правила к VNIC; Security Lists применяются на уровне подсети и проще, но менее гибки.

Почему нужно проверять локальную сеть на пересечение (и с чем)

- "Пересечение" означает, что CIDR вашей VCN совпадает или перекрывается с диапазоном IP, который уже используется в другой сети, с которой вы планируете устанавливать связь:
  - Локальная сеть (домашний/офисный роутер) — например, если ваш ноутбук или офис использует `10.0.0.0/24`.
  - Сеть компании (on-prem) или VPN — если вы собираетесь делать Site-to‑Site VPN или подключаться через корпоративную сеть.
  - Другая VCN в той же или в другой учётной записи, если вы будете делать VCN peering.

- Почему это проблема:
  - При перекрытии маршрутов трафик может не идти туда, куда вы ожидаете: запрос к `10.0.0.5` может оставаться локальным вместо того, чтобы идти в облако. Это ломает VPN, peering и удалённый доступ.

Как проверить локальную сеть (без CLI):
- macOS: System Preferences → Network → выбранное соединение → Advanced → TCP/IP → см. IPv4 address и Subnet Mask.
- Windows: Пуск → cmd → `ipconfig` — смотрите IPv4 и Mask.
- Router admin page: зайдите в веб-интерфейс роутера и посмотрите LAN settings.
- VPN: проверьте у IT или в настройках VPN-адаптера, какие range назначаются.

Как проверить в OCI Console:
- Networking → Virtual Cloud Networks → убедитесь, что нет других VCN с CIDR, который перекрывается с вашим (в списке видно CIDR у каждой VCN).

Что делать при конфликте:
- Если конфликт с домашней/офисной сетью — смените CIDR VCN (пересоздайте VCN) на другой приватный диапазон (например `10.1.0.0/16` или `10.8.0.0/16`).
- Если уже создали VCN и планируете VPN — лучше пересоздать VCN с другим CIDR (изменить CIDR у существующего VCN нельзя).

Краткое резюме — что рекомендую для этого проекта

- Если всё будет на одном VM (docker-compose): оставьте `10.0.0.0/24` и продолжайте → создайте публичную подсеть и откройте 80/443; базу держите внутри Docker и не пробрасывайте порт 5432 наружу.
- Если хотите минимальную безопасность и готовитесь к масштабированию: добавьте как минимум private subnet и поместите БД туда (вариант B).
- Если планируете VPN/peering с офисом — пересоздайте VCN с `/16` заранее.

---


### 2.2. Создание подсетей и шлюзов (public + private)

Мы делаем Вариант B — минимум public + private в рамках VCN `10.0.0.0/24`.

Шаги в Console (UI):
1. Networking → Virtual Cloud Networks → `n8n-vcn` → Subnets → Create Subnet
   - Public subnet:
     - Name: `public-subnet`
     - CIDR block: `10.0.0.0/26`
     - Type: Regional
     - Public IPv4: Allow
   - Private subnet:
     - Name: `private-subnet`
     - CIDR block: `10.0.0.128/26`
     - Type: Regional
     - Public IPv4: Do NOT allow

2. Internet Gateway (IG) для публичного трафика
   - VCN → Internet Gateways → Create Internet Gateway → Name: `igw-n8n` → Create
   - VCN → Route Tables → create/update public route table → Add Route Rule: Destination 0.0.0.0/0 → Target Type: Internet Gateway → Target: `igw-n8n`
   - Associate public route table with `public-subnet` (Subnet → Edit → Route Table)

3. NAT Gateway (если private VM должен уметь выходить в интернет для обновлений)
   - VCN → NAT Gateways → Create NAT Gateway → Name: `nat-n8n` → Create
   - Создать/выбрать route table для `private-subnet` → Add Route Rule: Destination 0.0.0.0/0 → Target Type: NAT Gateway → Target: `nat-n8n` → Associate с `private-subnet`

Примечание: NAT необходим, если на private VM будете запускать `apt update`, скачивать пакеты и т.д. Без NAT private VM не сможет выходить в интернет.

---

### 2.3. Security Lists / Network Security Groups (NSG)

Лучше использовать NSG (гибче), но ниже — шаги через Security Lists (UI) которые работают сразу.

A) Security Lists (быстро через UI)
1. Networking → Virtual Cloud Networks → `n8n-vcn` → Security Lists → Create Security List

- `sl-public`
  - Ingress:
    - TCP 80 from 0.0.0.0/0
    - TCP 443 from 0.0.0.0/0
    - TCP 22 from <YOUR_PUBLIC_IP>/32 (или временно 0.0.0.0/0 — потом сузить)
  - Egress: Allow all

- `sl-private`
  - Ingress:
    - TCP 5432 from `10.0.0.0/26` (public-subnet CIDR)
    - (опционально) SSH TCP 22 from `10.0.0.0/26` если будете подключаться к private VM только через public
  - Egress: Allow all

2. Attach `sl-public` к `public-subnet`, `sl-private` к `private-subnet`.

B) Network Security Groups (рекомендуется в прод)
- Create → Network Security Groups → `nsg-app` и `nsg-db`
- В `nsg-app` добавьте правила: ingress 80/443 0.0.0.0/0; ingress 22 от вашего IP
- В `nsg-db` добавьте правило: ingress 5432 только от `10.0.0.0/26`
- При создании instance указывайте NSG вместо Security List (Primary VNIC → Use Network Security Groups)

Как узнать свой public IP
- Открой в браузере `https://ifconfig.me` или `https://icanhazip.com` — это ваш текущий public IP. Используйте его в правилах SSH.

---

### 2.4. Создание инстансов (Public + Private)

A) Public VM — `n8n-app` (Caddy + n8n)
1. Compute → Instances → Create instance
2. Name: `n8n-app`
3. Image: Ubuntu 22.04
4. Shape: VM.Standard.A1.Flex (2 OCPU / 12 GB) — или 1 OCPU/6GB если capacity problem
5. Primary VNIC: VCN=`n8n-vcn`, Subnet=`public-subnet`, Automatically assign public IPv4 address = Yes
6. SSH Keys: вставь свой public key или сгенерируй
7. Create

B) Private VM — `n8n-db` (Postgres)
1. Compute → Instances → Create instance
2. Name: `n8n-db`
3. Image: Ubuntu 22.04
4. Shape: VM.Standard.A1.Flex (или меньший по capacity)
5. Primary VNIC: VCN=`n8n-vcn`, Subnet=`private-subnet`, Automatically assign public IPv4 address = No
6. SSH Keys: тот же public key
7. Create

После создания: запомни Public IP `n8n-app` и Private IP `n8n-db` (пример `10.0.0.128`).

---

### 2.5. Подключение к private VM через public VM (SSH jump)

Если `n8n-db` не имеет public IP, подключаемся через `n8n-app`:

- На локальной машине:
  - `ssh -i ~/Downloads/ssh-key-*.key -J ubuntu@<PUBLIC_IP> ubuntu@10.0.0.128`
  - Или сначала `ssh ubuntu@<PUBLIC_IP>` затем `ssh ubuntu@10.0.0.128`

Для копирования файлов через jump:
- `scp -i key -o ProxyJump=ubuntu@<PUBLIC_IP> localfile ubuntu@10.0.0.128:/home/ubuntu/`

---

## Шаг 3: Первичная настройка серверов (public + private)

Резюме: public VM держит Caddy + n8n (docker-compose), private VM — Postgres (docker-compose-db). Общие шаги — установка Docker, swap, базовое hardening.

### 3.1. На обеих машинах (общие)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git htop unzip
# swap 4GB
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker
```

### 3.2. Настройка iptables / firewall

- Public VM: откройте 80 и 443 и SSH (ограничьте SSH по IP как можно скорее).
- Private VM: откройте 5432 только от public-subnet CIDR `10.0.0.0/26`.

Пример (public VM):
```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 22 -j ACCEPT
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

Пример (private VM): разрешить 5432 через Security List/NSG и в iptables:
```bash
sudo iptables -I INPUT -p tcp -s 10.0.0.0/26 --dport 5432 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 22 -s 10.0.0.0/26 -j ACCEPT
sudo netfilter-persistent save
```

### 3.3. Подготовка Postgres на private VM

Создай `docker-compose-db.yml` (см. раздел 5.4) и запусти:
```bash
docker compose up -d
```
Проверь что порт 5432 слушает и доступен только из public-subnet:
```bash
# с public VM
nc -zv 10.0.0.128 5432
```

### 3.4. Подготовка n8n + Caddy на public VM

1. Создай `~/n8n-stack` и помести туда `.env`, `docker-compose.yml`, `Caddyfile` (см. раздел 5)
2. Отредактируй `.env`: `POSTGRES_HOST=10.0.0.128` (private IP)
3. `docker compose up -d`
4. Проверка логов:
```bash
docker compose logs -f n8n
docker compose logs -f caddy
```

---

## Шаг 4: Настройка домена (DuckDNS)

Ты уже добавил `n8n-recruiter.duckdns.org` — убедись, что DNS указывает на Public IP `n8n-app`.

На public VM настроен cron-скрипт для авто-обновления DuckDNS (см. раздел 4.2).

---

## Шаг 5: Docker Compose файлы (готовые шаблоны)

Public VM (`~/n8n-stack/docker-compose.yml`):

```yaml
version: '3.8'
services:
  n8n:
    image: n8nio/n8n:${N8N_VERSION}
    restart: unless-stopped
    environment:
      - N8N_HOST=${N8N_HOST}
      - N8N_PROTOCOL=${N8N_PROTOCOL}
      - WEBHOOK_URL=${WEBHOOK_URL}
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_DATABASE=${POSTGRES_DB}
      - DB_POSTGRESDB_HOST=${POSTGRES_HOST}
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_USER=${POSTGRES_USER}
      - DB_POSTGRESDB_PASSWORD=${POSTGRES_PASSWORD}
      - NODE_ENV=production
      - GENERIC_TIMEZONE=${GENERIC_TIMEZONE}
      - N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY}
    expose:
      - '5678'
    volumes:
      - n8n_data:/home/node/.n8n
    networks:
      - n8nnet

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - n8nnet

volumes:
  n8n_data:
  caddy_data:
  caddy_config:

networks:
  n8nnet:
```

`Caddyfile`:
```
# Caddy автоматом возьмёт TLS
n8n-recruiter.duckdns.org {
  reverse_proxy n8n:5678
}
```

Private VM (`~/n8n-db/docker-compose-db.yml`):
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - '5432:5432'

volumes:
  pgdata:
```

Примечание: порт 5432 в private VM не будет доступен из интернета, только из VCN (security lists/NSG).

---

## Шаг 6: Импорт/миграция БД и воркфлоу

1. Сделай дамп локальной БД: `pg_dump -Fc -U local_user local_db -f n8n.dump`
2. Скопируй дамп на public VM, затем через ProxyJump на private VM:
```bash
scp -i key -o ProxyJump=ubuntu@<PUBLIC_IP> n8n.dump ubuntu@10.0.0.128:/home/ubuntu/
```
3. На private VM: `pg_restore -U ${POSTGRES_USER} -d ${POSTGRES_DB} /home/ubuntu/n8n.dump`
4. На public VM обнови `.env` → `POSTGRES_HOST=10.0.0.128` → `docker compose down && docker compose up -d`

---

## Шаг 7–12: Остальные шаги (без серьёзных изменений)

- Перенос воркфлоу и credentials — как в разделе 7 (UI import + recreate credentials).
- LLM/Gemini — раздел 8 остался релевантным.
- GitHub Secrets — обнови `WEBHOOK_URL` на `https://n8n-recruiter.duckdns.org/webhook/jobs/ingest`.
- Бэкапы: делаем дампы на private VM и выгружаем в Object Storage (или копируем на public и оттуда в Object Storage).
- Heartbeat/cron: ставим на public VM.

---

## Troubleshooting (distributed)

- n8n не стартует → `docker compose logs n8n` на public VM; проверь connection to Postgres (`telnet 10.0.0.128 5432`)
- Postgres не принимает → проверь security list/NSG и iptables на private VM
- Caddy не получает TLS → проверь что DuckDNS резолвится точно на Public IP
- SSH access issues → проверь SSH rule в Security List и свой текущий public IP (ifconfig.me)

---

## Чеклист (обновлённый для 2 VM)

- [ ] Созданы `public-subnet` и `private-subnet` и сопоставлены route tables
- [ ] Созданы IG и (опционально) NAT
- [ ] Security Lists/NSG настроены (80/443 публично, 5432 только из public-subnet)
- [ ] Запущены `n8n-app` (public) и `n8n-db` (private)
- [ ] n8n подключается к Postgres (проверить из логов)
- [ ] DuckDNS резолвит на Public IP
- [ ] Docker Compose запущен на обеих машинах
- [ ] E2E: scraper → webhook → n8n → Notion → Telegram

---

Если хочешь, я могу:
1) Вставить текст `docker-compose.yml`, `docker-compose-db.yml` и `Caddyfile` как файлы в репо (в том числе поддиректории `deploy/`),
2) Подготовить пошаговый чеклист с GUI-кликами + командной строкой для каждой операции (copy-paste команды),
3) Сделать оба пункта.

Напиши, что добавить: `1`, `2` или `3` — и я выполню.
