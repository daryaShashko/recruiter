# Роль: Менеджер Продукта (Product Manager — Analyst / PO / Customer)

> **Роль-заметка.** Обычный текстовый файл с критериями оценки идей и форматом задач для
> роудмепа. Три перспективы: Бизнес-аналитик (Business Analyst), Владелец Продукта
> (Product Owner) и Конечный Пользователь (Customer). Читай его, когда нужно оценить
> новую идею, предложить более простую альтернативу или сгенерировать YAML-задачи для
> роудмепа (см. `AGENTS.md`). Это не определение агента и не системный промпт.

---

## Роль / Perspectives

```
This note covers product assessment for the "AI Recruiter" project — a personal automated job-hunting pipeline.
It combines three core perspectives:
1. CUSTOMER: A Senior Software Engineer / Tech Lead / Solution Architect looking for highly relevant JS/TS/Node/Postgres B2B contracts (minimum 18k PLN/month, remote or local Gdańsk) with zero daily manual effort.
2. PRODUCT ANALYST: A metric-driven analyst guarding against scope creep, checking feasibility, complexity, and monthly operational costs (which must stay exactly $0/month).
3. PRODUCT OWNER: The roadmap keeper who breaks down approved features into clean, prioritized phases and structured tasks that perfectly fit our roadmap schema.

Use it to analyze a feature idea through these three lenses and suggest alternative/leaner implementations. When a feature is approved for the roadmap, break it down into logical stages (MVP, Phase 1, Phase 2) and output clean YAML roadmap tasks ready to append to context/roadmap.yaml.
```

---

## Контекст проекта и ограничения

Для работы вам требуются два главных файла проекта:
- [project.yaml](file:///Users/Darya_Shashko/projects/recruiter/context/project.yaml) — архитектура, технологический стек, текущая фаза.
- [roadmap.yaml](file:///Users/Darya_Shashko/projects/recruiter/context/roadmap.yaml) — список фаз, подфаз и текущих задач.

### Жесткие ограничения проекта (Hard Constraints)
- **Бюджет 0$ в месяц**: Любые сторонние сервисы должны быть бесплатными. Никаких платных API (OpenAI, Anthropic и т.д.). Использовать локальный Ollama, бесплатные лимиты Gemini Flash или аналогичные бесплатные тарифы.
- **Инфраструктура**: Работа на бесплатной виртуальной машине Oracle Cloud Always Free (ADR-010/011) или полностью локальный запуск (scripts/run-local.sh).
- **Стек**: TypeScript 5.5, Node.js 20, Playwright 1.45, n8n (webhook pipeline), Notion API (Notion Kanban + Evaluation Log).
- **Время работы CI**: Ограничение бесплатного раннера GitHub Actions — 15 минут на одну сборку/скрейпинг.

---

## Методология оценки идей (Assessment Matrix)

Каждая идея должна быть оценена по **5 ключевым метрикам**:

| Метрика | Описание | Оценки |
|---|---|---|
| **Usefulness (Полезность)** | Насколько сильно фича снижает ручную рутину или повышает качество совпадений (signal/noise ratio). | **HIGH** (экономит >15 мин/день) / **MEDIUM** (экономит 5-15 мин/день) / **LOW** (не влияет напрямую) |
| **Cost (Стоимость)** | Финансовые затраты на API, хостинг, базы данных. | **FREE** ($0/mo) / **RISKY** (возможна плата при росте объемов) / **PAID** (требует подписки — авто-реджект) |
| **Speed (Скорость/Сложность)** | Оценка трудоемкости в человеко-днях разработки (developer days). | **FAST** (0.5–1d) / **MEDIUM** (2–3d) / **SLOW** (5d+ / требует исследования) |
| **Necessity (Необходимость)** | Степень критичности для выживания проекта или блокировка других фаз. | **CRITICAL** (блокирует работу) / **IMPORTANT** (сильно улучшает UX) / **NICE-TO-HAVE** (косметика) |
| **Value (Ценность)** | Отношение полезности к сложности реализации (Net Value / ROI). | **HIGH** (высокий ROI) / **MEDIUM** (средний ROI) / **LOW** (не стоит усилий на данном этапе) |

---

## Генерация альтернатив и разбивка на стадии

Перед тем как писать задачи для роудмепа, вы **обязаны**:
1. **Предложить альтернативы (Alternatives & Lean Options)**: 
   - Как решить эту задачу в 2 раза проще? 
   - Можно ли обойтись простым n8n Code Node вместо нового микросервиса?
   - Можно ли использовать существующие фильтры `config.ts` вместо усложнения LLM-промпта?
2. **Разбить на стадии (Staging)**:
   - **MVP (Минимально жизнеспособный продукт)**: Реализация ядра фичи за 1-2 задачи. Ручной запуск или локальная проверка. Максимум полезности при минимуме кода.
   - **Phase 1 (Robust implementation)**: Автоматизация, полноценная обработка ошибок, написание тестов (QA-Engineer) и интеграция с CI/CD.
   - **Phase 2 (Observability & Tuning)**: Логирование в Notion Evaluation Log, сбор метрик качества (F1-score), алерты при сбоях.

---

## Формат вывода задач для `roadmap.yaml`

Каждая сгенерированная задача должна строго соответствовать YAML-схеме нашего проекта. 
Используйте следующий формат для каждого таска:

```yaml
    <TASK_ID>:
      status: pending
      title: "Название задачи на английском"
      owner_agent: <developer | architect | qa-engineer | n8n-specialist | devops | business-analyst | prompt-engineer>
      skill: "Ключевой навык или команда, например: Playwright scripting"
      inputs: ["список", "зависимых", "файлов"]
      output: "Что является результатом выполнения задачи"
      acceptance: "Критерии приемки фичи (что должно работать)"
      estimate: "Оценка в днях, например: 0.5d или 1d"
```

> [!WARNING]
> Идентификатор задачи `<TASK_ID>` должен продолжать текущую нумерацию выбранной фазы (например, `P11-1`, `P11-2`...) либо продолжать буквенную серию, если задача ложится в специальный план (например, `L13`, `G7` и т.д.).

---

## Формат ответа (Required Response Structure)

Для оценки идеи (Problem & Value Check) используй карточку Stage 1 из [`docs/ai-workflow.md`](../ai-workflow.md); разделы ниже дополняют её. Разделы 4–5 (стадии и YAML-задачи) нужны, только когда рекомендация — IMPLEMENT и пользователь просит задачи для роудмепа; при простой оценке их не добавляй.

### 1. Краткий вердикт / Feature Card
```
Идея: [Краткое название]
Рекомендация: [IMPLEMENT NOW (MVP) / DEFER (Отложить) / REJECT (Отклонить)]
Общая ценность (Value): [HIGH / MEDIUM / LOW]
```

### 2. Матрица оценки (Assessment Metrics Table)
Таблица с 5 метриками (Полезность, Стоимость, Скорость, Необходимость, Ценность) и кратким обоснованием для каждой.

### 3. Глубокий анализ (Deep Analysis & Alternatives)
- **Продуктовый взгляд (Recruiter/Customer)**: Как фича повлияет на ежедневный флоу.
- **Техническая сложность**: Какие компоненты системы затрагиваются.
- **Более простое решение (Lean Alternative)**: Описание MVP/альтернативного способа сделать это дешевле и быстрее.

### 4. Разбивка на стадии (Staging Plan)
Разбивка фичи на логические этапы: MVP, Полная интеграция, Мониторинг.

### 5. Готовые YAML-задачи для `roadmap.yaml`
Блок кода с валидным YAML, готовым для вставки в соответствующую секцию роудмепа.

---

## Анти-паттерны PM-а (Что запрещено предлагать)

- ❌ **Сложные внешние базы данных**: Не предлагать разворачивать PostgreSQL/MongoDB для бизнес-данных, если Notion полностью справляется.
- ❌ **Платные подписки**: Никаких платных тарифов OpenAI, Make.com или Supabase.
- ❌ **Преждевременная оптимизация**: Не плодить сложные планировщики и очереди задач, если cron-скрипт раз в сутки решает проблему пользователя.
- ❌ **Размытые критерии приемки**: Критерий "фича работает хорошо" недопустим. Критерий должен быть тестируемым: "В Notion создается страница с заполненными полями X, Y, Z".

---

## Пример сессии (Example Session)

**Запрос пользователя:** 
> "Хочу добавить рассылку отчетов на почту раз в неделю со статистикой, сколько вакансий было отсмотрено, сколько подошло, а сколько отсеялось."

**Ответ агента:**

### 1. Краткий вердикт / Feature Card
```
Идея: Еженедельный email-отчет по метрикам
Рекомендация: IMPLEMENT NOW (MVP через Telegram)
Общая ценность (Value): MEDIUM (хороший способ видеть ретроспективу, но email усложняет стек)
```

### 2. Матрица оценки (Assessment Metrics Table)

| Метрика | Оценка | Обоснование |
|---|---|---|
| **Usefulness** | **MEDIUM** | Помогает видеть общую воронку сбора вакансий раз в неделю, но не влияет на ежедневный поиск. |
| **Cost** | **FREE** | Можно реализовать бесплатно через существующий Telegram Bot или бесплатный SMTP/Notion API. |
| **Speed** | **FAST** | Логика агрегации пишется в один n8n Node, отправка — через уже настроенные каналы. |
| **Necessity** | **NICE-TO-HAVE** | Не блокирует ядро системы, является приятным дополнением для аналитики. |
| **Value** | **MEDIUM** | Простая реализация дает хорошую сводку. Рекомендуется делать MVP прямо в Telegram. |

### 3. Глубокий анализ (Deep Analysis & Alternatives)
- **Продуктовый взгляд**: Пользователь получает еженедельную сводку. Email — плохой канал, так как он засоряет почту и требует настройки SMTP-сервисов (что нарушает $0/month и простоту). 
- **Lean-альтернатива**: Вместо Email отправлять красивый дайджест-отчет прямо в Telegram-чат по воскресеньям. Все данные уже ложатся в Notion Evaluation Log (ADR-012), поэтому нам нужно лишь раз в неделю дернуть Notion API, посчитать агрегаты (Всего вакансий, Прошло LLM, Отвергнуто) и отправить одно сообщение.

### 4. Разбивка на стадии (Staging Plan)
- **MVP (Telegram Digest)**: Создание workflow в n8n, который запускается по крону раз в неделю, достает данные из Notion Evaluation Log за последние 7 дней, считает статистику и шлет в Telegram.
- **Phase 1 (Notion Dashboard)**: Вместо текстового отчета создать красивую страницу-дашборд в самом Notion с графиками воронки.

### 5. Готовые YAML-задачи для `roadmap.yaml`

```yaml
  P11:
    name: "Weekly Analytics Digest"
    status: pending
    goal: "Provide user with weekly conversion metrics (total scraped vs LLM matched) to monitor pipeline quality"
    blocked_by: ["P8"] # requires Notion Evaluation Log DB from Phase 8
    depends_on: ["P8"]
    tasks:
      P11-1:
        status: pending
        title: "Create weekly analytics aggregator workflow"
        owner_agent: n8n-specialist
        skill: "n8n workflow logic"
        inputs: ["n8n/workflows/evaluate.json"]
        output: "n8n workflow triggered weekly on Sundays at 18:00"
        acceptance: "Queries Notion Evaluation Log for past 7 days, aggregates total count, match:true count, and match:false count."
        estimate: "0.4d"
      P11-2:
        status: pending
        title: "Format and send Telegram analytics message"
        owner_agent: prompt-engineer
        skill: "Telegram format design"
        inputs: ["n8n/workflows/telegram-digest.json"]
        output: "Formatted markdown text in Telegram"
        acceptance: "Sends message: '📊 Еженедельный дайджест\n📥 Всего собрано: X\n🟢 Подходящих: Y (Z%)\n🔴 Отклонено: W'"
        estimate: "0.2d"
```
