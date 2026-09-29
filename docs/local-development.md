# Локальный запуск

> **Статус: черновик.** Podman machine и n8n запущены; создание локального пользователя
> подтверждает работу интерфейса и SQLite. Доступ к Ollama и запуск workflow ещё не проверены.

## Что запускается

- n8n работает в Podman-контейнере и слушает только `127.0.0.1:5678`.
- Для состояния n8n используется встроенная SQLite; данные сохраняются в именованном Podman volume `recruiter_n8n_local_data`.
- Ollama остаётся нативным приложением macOS, чтобы использовать Apple Metal. В workflow n8n адрес Ollama должен быть `http://host.containers.internal:11434`.
- Этот профиль не запускает PostgreSQL, Caddy, туннель или облачные интеграции.

## Подготовка (один раз)

1. Установить Podman Desktop для macOS и инициализировать Podman machine в приложении.
2. Убедиться, что CLI и Compose доступны:

   ```zsh
   podman --version
   podman compose version
   ```

3. Установить Node.js 24 — эту версию использует GitHub Actions для скрапера.
4. Установить зависимости скрапера и браузер Playwright:

   ```zsh
   cd scraper
   npm ci
   npx playwright install chromium
   ```

Никакие значения из `.env.example` для старта локального n8n не требуются. Не копируй этот файл в `.env` без проверки: пример содержит адрес облачного webhook и интеграционные секреты.

## Запустить n8n

Из корня репозитория:

```zsh
./scripts/start-local.sh
```

Скрипт запускает Podman machine, если она создана, и поднимает только сервис из `n8n/docker-compose.local.yml`. При первом запуске Podman скачает образ n8n. Затем открыть <http://localhost:5678>.

Если Docker Hub сообщает о лимите анонимных скачиваний, войди бесплатным аккаунтом Docker Hub. Предпочтительно использовать Personal Access Token: команда запросит его скрыто, токен сохранится локально в хранилище Podman и не попадёт в репозиторий:

```zsh
/opt/podman/bin/podman login docker.io
```

После успешного входа повтори `./scripts/start-local.sh`.

Остановить контейнер, сохранив данные и credentials:

```zsh
podman compose -f n8n/docker-compose.local.yml down
```

Не добавляй `-v`: эта опция удалит локальный volume с базой n8n.

## Сборка и проверка скрапера

Команды ниже запускаются из `scraper/`:

```zsh
npm run build
npm run typecheck
npm test
```

`npm run scrape:dry` обращается к публичным сайтам вакансий, но не отправляет результаты в webhook; JSON сохраняется в `scraper/output/`:

```zsh
npm run scrape:dry
```

Это локальная обработка без вызова Notion, Telegram или облачной LLM, но скрапер делает реальные сетевые запросы к сайтам вакансий.

## Текущий предел end-to-end проверки

В репозитории пока нет экспортированных n8n workflow JSON. Их нужно экспортировать из существующего n8n и импортировать вручную в локальный экземпляр. Сначала импортировать неактивными, проверить URL Ollama и credentials, и только потом запускать вручную.

Не используй пока `scripts/run-local.sh` для проверки: он отправляет probe-запрос на `WEBHOOK_URL` даже с `--dry-run`, а пример `.env` указывает на облачный webhook. Обычный `npm run scrape` тоже отправляет собранные данные на настроенный webhook.
