# Руководство по обновлению скрапера

Это руководство описывает, как диагностировать и устранить поломку скрапера
при изменении API или HTML-структуры JustJoin.it или NoFluffJobs.

---

## 1. Когда нужно обновлять скрапер

### Симптомы поломки

| Симптом | Вероятная причина |
|---|---|
| Dry-run возвращает 0 вакансий с одного из источников | API endpoint сменился / HTML-структура изменилась |
| Ошибка `403 Forbidden` или `401 Unauthorized` | Cloudflare заблокировал User-Agent или куки устарели |
| `JSON.parse` падает / поле `data` или `STORE_KEY` отсутствует | Изменилась схема ответа |
| Вакансий значительно меньше обычного (было 199, стало 10) | Сменился URL-параметр фильтра или категории |
| Логи GitHub Actions содержат `WARNING: 0 offers collected` | Любой из сценариев выше |

### Как проверить вручную перед правкой кода

1. Запустить последний dry-run и проверить артефакт в GitHub Actions → `output/dry-run-*.json`.
2. Если артефакт пуст или содержит 0 из одного источника — читать дальше.
3. Проверить, есть ли одновременно записи `"source": "justjoin"` и `"source": "nofluffjobs"`.

---

## 2. JustJoin.it: обновление API endpoint

### Как устроен скрапер (текущая реализация)

Файл: `scraper/src/scrapers/justjoin.ts`

```typescript
const JUSTJOIN_API_PATH = "/api/candidate-api/offers";
```

Скрапер перехватывает GET-запрос вида:
```
GET https://justjoin.it/api/candidate-api/offers?categories=javascript&...
```

Ответ: `{ data: RawJustJoinOffer[], meta: { totalItems: number, next: { cursor: number } } }`

**Важно:** прямая навигация на страницу `/job-offers/all-locations/javascript` использует SSR
и не вызывает этот API. API срабатывает только при **клике на категорию JavaScript**
внутри SPA. Именно поэтому скрапер сначала открывает главную страницу, а затем кликает.

### Шаг 1 — проверить текущий API endpoint через DevTools

1. Открыть браузер (Chrome/Firefox), перейти на `https://justjoin.it`.
2. Открыть DevTools → вкладка **Network**, поставить фильтр `Fetch/XHR`.
3. Принять куки, кликнуть на категорию **JavaScript**.
4. Найти запрос, соответствующий паттерну `candidate-api/offers` или содержащий `data: [...]`.

```bash
# Альтернатива через debug-скрипт:
cd scraper
npx ts-node src/debug-urls.ts
# Скрипт выведет все сетевые запросы с обоих сайтов.
# Искать строки вида: GET https://justjoin.it/api/...
```

5. Проверить структуру ответа: убедиться, что в JSON есть поле `data` — массив объектов
   с полями `slug`, `title`, `companyName`, `workplaceType`, `employmentTypes`.

### Шаг 2 — обновить константы в коде

Если endpoint изменился (например, `/api/v2/offers`):

```typescript
// scraper/src/scrapers/justjoin.ts — строка ~9
const JUSTJOIN_API_PATH = "/api/v2/offers";   // новый путь
```

Если изменилось поле `data` в ответе (например, теперь `offers`):

```typescript
// В обработчике page.on("response", ...) — найти строку:
const batch: RawJustJoinOffer[] = json.data ?? [];
// Изменить на:
const batch: RawJustJoinOffer[] = json.offers ?? [];
```

Если изменился `meta.totalItems` (например, стал `meta.total`):

```typescript
// Найти строку:
if (capturedTotalItems === 0 && json.meta?.totalItems) {
// Изменить на:
if (capturedTotalItems === 0 && json.meta?.total) {
```

### Шаг 3 — проверить интерфейс `RawJustJoinOffer`

Если изменились поля объекта вакансии — обновить интерфейс в начале файла.
Обязательно проверить:

- `slug` (используется для формирования `id` и `url`)
- `companyName` (имя компании)
- `workplaceType` (определяет Remote)
- `locations[].city` (определяет Gdańsk)
- `employmentTypes` (зарплата)
- `experienceLevel` (фильтр по уровню)

### Шаг 4 — локально протестировать

```bash
cd scraper

# 1. Проверить типы
npx tsc --noEmit

# 2. Unit-тесты (без сети, быстро)
npm test -- --testPathPattern=justjoin.unit

# 3. Интеграционный тест (запускает реальный браузер, ~60 сек)
npm test -- --testPathPattern=justjoin.test

# 4. Полный dry-run (записывает output/dry-run-*.json)
DRY_RUN=true npx ts-node src/index.ts
```

Ожидаемый результат: `output/dry-run-*.json` содержит `>100` вакансий с `"source": "justjoin"`.

---

## 3. NoFluffJobs: обновление SSR-экстрактора

### Как устроен скрапер (текущая реализация)

Файл: `scraper/src/scrapers/nofluffjobs.ts`

> **История:** до 2026-05 NFJ использовал POST XHR `/api/search/posting`.
> В мае 2026 NFJ перешёл на Angular SSR — данные о вакансиях теперь встроены
> в HTML страницы внутри `<script id="serverApp-state">`.

Скрапер читает JSON из HTML:
```html
<script id="serverApp-state">{"STORE_KEY":{"searchResponse":{"postings":[...],"totalPages":3}}}</script>
```

Код извлечения в функции `extractSsrPostings()`:
```typescript
const state = JSON.parse(match[1]);
const store = state["STORE_KEY"];
const postings = store?.["searchResponse"]?.["postings"] ?? [];
```

### Шаг 1 — проверить, есть ли STORE_KEY в HTML

```bash
# Скачать HTML страницы и поискать ключ:
curl -sA "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126" \
  "https://nofluffjobs.com/pl/praca/javascript" \
  | grep -o '"STORE_KEY"' | head -3
# Если вывод пуст — ключ изменился.

# Найти все ключи верхнего уровня в serverApp-state:
curl -sA "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126" \
  "https://nofluffjobs.com/pl/praca/javascript" \
  | grep -oP '(?<=id="serverApp-state">)\{[^<]+' \
  | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(list(d.keys()))"
```

### Шаг 2 — найти новый STORE_KEY в HTML

Если ключ `STORE_KEY` изменился (например, теперь `APP_STATE` или `ngrxState`):

1. Открыть `https://nofluffjobs.com/pl/praca/javascript` в браузере.
2. DevTools → **Elements** → Ctrl+F → искать `serverApp-state`.
3. Раскрыть содержимое тега `<script id="serverApp-state">`.
4. Скопировать JSON в консоль и выполнить `Object.keys(JSON.parse(...))` — увидите все ключи.

Или через grep:

```bash
curl -sA "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126" \
  "https://nofluffjobs.com/pl/praca/javascript" \
  | grep -oP 'id="serverApp-state">\K[^<]+' \
  | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
for k, v in data.items():
    print(f'KEY={k!r}, type={type(v).__name__}')
"
```

### Шаг 3 — обновить STORE_KEY в коде

```typescript
// scraper/src/scrapers/nofluffjobs.ts — в extractSsrPostings():
const store = state["STORE_KEY"] as Record<string, unknown> | undefined;
//                  ^^^^^^^^^^^
// Заменить на новое значение ключа, например:
const store = state["APP_STATE"] as Record<string, unknown> | undefined;
```

Также проверить путь до вакансий. Если изменилась вложенность (например, теперь
`store.search.postings` вместо `store.searchResponse.postings`):

```typescript
// Найти и обновить:
const postings = (searchResponse?.["postings"] ?? []) as RawNoFluffPosting[];
const totalPages = searchResponse?.["totalPages"] as number ?? 1;
```

### Шаг 4 — проверить интерфейс `RawNoFluffPosting`

Обязательно проверить наличие полей:

- `reference` (стабильный уникальный ID, не `id` — тот меняется по локации)
- `title` (название должности)
- `name` (компания — именно `name`, не `company`)
- `url` (слаг для построения URL)
- `location.fullyRemote` (Remote-флаг)
- `location.places[].city` (Gdańsk)
- `seniority` (массив строк: `["Senior"]`)
- `salary.disclosedAt` (`"VISIBLE"`)

```bash
# Проверить живую структуру одной вакансии:
curl -sA "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126" \
  "https://nofluffjobs.com/pl/praca/javascript" \
  | python3 -c "
import json, sys, re
html = sys.stdin.read()
m = re.search(r'id=[\"\'']serverApp-state[\"\'']>([^<]+)', html)
if not m: print('serverApp-state NOT FOUND'); sys.exit(1)
d = json.loads(m.group(1))
store = d.get('STORE_KEY', {})
postings = store.get('searchResponse', {}).get('postings', [])
if postings:
    print(json.dumps(postings[0], indent=2, ensure_ascii=False))
else:
    print('No postings found')
    print('Keys in store:', list(store.keys()))
"
```

### Шаг 5 — локально протестировать

```bash
cd scraper

# Unit-тесты SSR-экстрактора (без сети):
npm test -- --testPathPattern=nofluffjobs.unit

# Интеграционный тест (реальный браузер):
npm test -- --testPathPattern=nofluffjobs.test

# Полный dry-run:
DRY_RUN=true npx ts-node src/index.ts
```

Ожидаемый результат: вакансии с `"source": "nofluffjobs"` присутствуют в `output/dry-run-*.json`.

---

## 4. Как прогнать тесты перед деплоем

Все тесты запускаются из директории `scraper/`:

```bash
cd scraper

# Шаг 1 — проверка типов (быстро, без запуска кода)
npx tsc --noEmit

# Шаг 2 — unit-тесты (без сети, ~5 сек)
npm test -- --testPathPattern=unit

# Шаг 3 — все тесты, включая интеграционные (запускает браузер, ~2-3 мин)
npm test
# или:
npm test -- --timeout=120000

# Шаг 4 — проверочный dry-run (без отправки на webhook)
DRY_RUN=true npx ts-node src/index.ts
# Результат записывается в output/dry-run-<timestamp>.json
```

### Что означает "тест прошёл"

| Тест | Ожидаемый результат |
|---|---|
| `justjoin.unit.test.ts` | 19 тестов passed |
| `nofluffjobs.unit.test.ts` | Все тесты passed |
| `sender.test.ts` | 4 теста passed |
| `justjoin.test.ts` | В dry-run файле >50 вакансий JustJoin |
| `nofluffjobs.test.ts` | В dry-run файле >5 вакансий NFJ |
| `e2e.test.ts` | Полный прогон без ошибок |

---

## 5. Чеклист деплоя

После внесения изменений — пройти следующие шаги **по порядку**:

```
[ ] 1. npx tsc --noEmit — нет ошибок типов
[ ] 2. npm test -- --testPathPattern=unit — unit-тесты прошли
[ ] 3. DRY_RUN=true npx ts-node src/index.ts — dry-run файл содержит вакансии обоих источников
[ ] 4. Проверить output/dry-run-*.json: поля id, title, company, url, body заполнены, нет null
[ ] 5. npm test — полный набор тестов прошёл
[ ] 6. git add / git commit — описать изменение в commit message:
        "fix(scraper): update JustJoin API path to /api/v2/offers"
[ ] 7. git push — GitHub Actions запустит workflow автоматически
[ ] 8. В GitHub Actions → вкладка Actions → проверить что job прошёл (зелёная галочка)
[ ] 9. Проверить артефакт dry-run в GitHub Actions:
        Actions → последний run → Artifacts → dry-run-output
[ ] 10. Если n8n запущен — убедиться что новые вакансии появились в Notion
```

### Дополнительные команды для диагностики

```bash
# Посмотреть все сетевые запросы с обоих сайтов (для обнаружения новых endpoints):
cd scraper && npx ts-node src/debug-urls.ts

# Проверить количество вакансий в последнем dry-run:
cat output/dry-run-*.json | python3 -c "
import json, sys, glob
files = sorted(glob.glob('output/dry-run-*.json'))
for f in files:
    data = json.load(open(f))
    jj = sum(1 for x in data if x['source']=='justjoin')
    nfj = sum(1 for x in data if x['source']=='nofluffjobs')
    print(f'{f}: total={len(data)}, justjoin={jj}, nofluffjobs={nfj}')
"

# Найти вакансии без зарплаты (для проверки salary-парсера):
cat output/dry-run-*.json | python3 -c "
import json, sys
data = json.load(open(sorted(__import__('glob').glob('output/dry-run-*.json'))[-1]))
no_salary = [x['title'] for x in data if not x.get('salary')]
print(f'{len(no_salary)} offers without salary out of {len(data)}')
"

# Проверить куки и заголовки (если 403):
curl -v -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126" \
  "https://justjoin.it/api/candidate-api/offers?categories=javascript&from=0" 2>&1 | head -40
```
