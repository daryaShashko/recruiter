# Setup Guide: Evaluation Log (P8 EVAL-1 + EVAL-4)

> **Что это:** Настройка базы данных Notion для логирования КАЖДОГО решения LLM
> (и match:true, и match:false). После выполнения этих шагов пайплайн начнёт
> записывать ~200 оценок/день, что даёт полную видимость в работу эвалюатора.
>
> **Что уже сделано:** `evaluate.json` обновлён — новый узел `Notion: Log to Eval Log`
> уже добавлен между `Code: Parse Ollama Response` и `IF: Match?`. Тебе нужно только
> создать базу в Notion и прописать её ID.
>
> **Время:** ~15 минут.

---

## Шаг 1 — Создать базу данных "Evaluation Log" в Notion

1. Открой Notion → создай новую страницу (или перейди в рабочее пространство AI Recruiter)
2. Нажми `+` → выбери **Table** (таблица) — это создаст базу данных
3. Переименуй базу в **`Evaluation Log`**

### Добавь следующие поля (свойства таблицы):

> По умолчанию Notion создаёт колонку `Name` (тип Title) — **оставь её, переименуй в `Title`**.

| Имя свойства | Тип | Настройки |
|---|---|---|
| `Title` | **Title** | *(уже есть — оставь как есть)* |
| `Company` | **Text** | — |
| `Fingerprint` | **Text** | FNV1a64 hash `normalizeCompany::normalizeTitle` (16 hex chars) — primary dedup key |
| `URL` | **URL** | — |
| `Source` | **Select** | Варианты: `justjoin`, `nofluffjobs`, `linkedin`, `manual` |
| `Match` | **Checkbox** | — |
| `Reason` | **Text** | — |
| `Model` | **Text** | — |
| `Batch ID` | **Text** | — |
| `Evaluated At` | **Date** | Включи "Include time" |
| `Human Verdict` | **Select** | Варианты: `Correct`, `Wrong – Should Match`, `Wrong – Should Reject`, `Pending` |
| `Tags` | **Multi-select** | — |

> **Порядок свойств:** Не важен. Важны точные имена — они должны совпадать с именами выше
> (регистр важен).

---

## Шаг 2 — Подключить интеграцию к базе

1. Открой базу `Evaluation Log` в Notion
2. Нажми кнопку `•••` (три точки) в правом верхнем углу → **Connections**
3. Найди и добавь интеграцию **"AI Recruiter"** (ту же, что используется для `AI Recruiter Board`)

Если интеграция не видна — перейди в [notion.so/my-integrations](https://www.notion.so/my-integrations),
убедись, что интеграция существует и активна.

---

## Шаг 3 — Скопировать ID базы данных

1. Открой базу `Evaluation Log` в браузере
2. URL будет выглядеть так:
   ```
   https://www.notion.so/YourName/Evaluation-Log-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX?v=...
   ```
3. Скопируй 32-символьный hex-ID из URL:
   ```
   XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```
   *(это всё что после последнего `/` и до `?`)*

---

## Шаг 4 — Добавить ID в `.env`

Открой файл `.env` в корне проекта и добавь строку:

```env
# Notion Evaluation Log (ADR-012, Phase 8)
NOTION_EVAL_LOG_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Замени `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` на реальный ID из Шага 3.

---

## Шаг 5 — Добавить ID в `.env.example`

Открой `.env.example` и добавь эту строку после блока Notion:

```env
NOTION_EVAL_LOG_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## Шаг 6 — Обновить `ingest.json` в n8n (замена плейсхолдера + импорт)

Файл `n8n/workflows/ingest.json` уже обновлён в репозитории с новым узлом.
Тебе нужно заменить плейсхолдер и импортировать в n8n.

### 6a. Заменить плейсхолдер в JSON-файле

В файле `n8n/workflows/ingest.json` найди строку:
```json
"value": "YOUR_EVAL_LOG_DB_ID_HERE",
```
Замени на реальный ID (32 символа без дефисов):
```json
"value": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
```

### 6b. Импортировать воркфлоу в n8n

1. Открой n8n → в левом меню нажми **Workflows**
2. Найди воркфлоу **"Ingest Jobs"**
3. Открой его → нажми меню `•••` в правом верхнем углу → **Import from file**
4. Выбери файл `n8n/workflows/ingest.json`
5. Подтверди замену (Yes, overwrite)
6. Нажми **Save** → **Activate**

> **Альтернатива:** Можно открыть `ingest.json`, скопировать содержимое, и
> в n8n сделать **Import from clipboard**.

### Что изменилось в воркфлоу

Добавлен узел **`Notion: Log to Eval Log`** между двумя существующими узлами
внутри `ingest.json`:

```
Code: Parse Ollama Response  →  [NEW] Notion: Log to Eval Log  →  IF: Match?
```

- Логирует **все** оценки — и `match: true`, и `match: false`
- `onError: continueRegularOutput` — если Notion API недоступен, пайплайн **не прерывается**
- `Batch ID` = ID текущего выполнения n8n (группирует записи одного батча)
- `Human Verdict` = `Pending` по умолчанию (ты проставляешь вручную после ревью)

---

## Шаг 7 — Добавить GitHub Secret (для CI)

Если ты используешь GitHub Actions для запуска скрапера и хочешь, чтобы вся
цепочка работала в облаке:

1. Перейди в **GitHub → твой репо → Settings → Secrets and variables → Actions**
2. Нажми **New repository secret**
3. Name: `NOTION_EVAL_LOG_DB_ID`
4. Value: ID из Шага 3
5. Нажми **Add secret**

> На данный момент `NOTION_EVAL_LOG_DB_ID` используется только в n8n (не в скрапере),
> поэтому для GitHub Actions этот секрет **пока не обязателен**.
> Он понадобится, если ты будешь передавать ID через переменные окружения n8n.

---

## Шаг 8 — Проверить работу

После импорта воркфлоу и настройки:

1. Отправь тестовую вакансию через Telegram команду `/scan` (ручной триггер в n8n)
   или запусти скрапер в dry-run режиме
2. Открой `Evaluation Log` в Notion
3. Убедись, что записи появляются с заполненными полями: Title, Company, Match, Reason, Model, Batch ID

### Ожидаемый результат

| Title | Company | Match | Reason | Model | Human Verdict |
|---|---|---|---|---|---|
| Senior Node.js Dev | ACME Corp | ☑ | Node.js is primary... | llama3.1:latest | Pending |
| Java Backend Dev | Corp Inc | ☐ | Primary stack Java... | llama3.1:latest | Pending |

---

## Итоговый чеклист

- [x] **Шаг 1** — Создана база `Evaluation Log` в Notion (включая поле `Fingerprint`)
- [x] **Шаг 2** — Интеграция «AI Recruiter» подключена к базе
- [x] **Шаг 3** — Скопирован ID базы данных
- [x] **Шаг 4** — `NOTION_EVAL_LOG_DB_ID=<id>` добавлен в `.env`
- [x] **Шаг 5** — Строка добавлена в `.env.example`
- [x] **Шаг 6a** — Плейсхолдер `YOUR_EVAL_LOG_DB_ID_HERE` заменён в `ingest.json`
- [x] **Шаг 6b** — Воркфлоу **Ingest Jobs** импортирован и активирован в n8n
- [ ] **Шаг 7** — *(опционально)* GitHub Secret добавлен
- [x] **Шаг 8** — Тест: записи появляются в Notion

---

> После завершения этих шагов задача **P8 EVAL-1** считается выполненной.
> Обнови `context/roadmap.yaml` → `EVAL-1: status: done` и `EVAL-4: status: done`.
