# CQA — Conversation Quality Analytics

ИИ оценивает диалог оператора по чек-листу, человек может оспорить оценку, проверяющий выносит решение, итог пересчитывается.
Бэкенд: FastAPI + SQLite. Если положить сайт в папку `frontend/`, сервер раздаёт его с `/`.

## Требования

Python 3.11+ (на Windows — с python.org, галочка «Add to PATH»). Интернет для импорта и записей звонков.

## Установка и запуск

Windows (PowerShell или cmd):
```
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
.venv\Scripts\python -m uvicorn backend.main:app --port 8000
```
Linux / macOS:
```
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
.venv/bin/python -m uvicorn backend.main:app --port 8000
```
Документация API: http://localhost:8000/docs.

## `.env`

```
CQA_API_URL=<адрес из кнопки «Открыть GET для DEV» в Student Guide>
DB_PATH=cqa.db
```
В адресе есть подпись `sig=`. **`.env` не коммитить** (он в `.gitignore`). Параметр `group_id` сервер подставляет сам.

## Импорт

- DEV: на сайте или `POST /api/datasets/import` с `{"group_id": "DEV"}` → `{"imported": 65, "total": 65}`.
- Контрольный набор: то же самое с новым `group_id` от организаторов. Код менять не нужно.
- Из файла: `POST /api/conversations/upload?group_id=UPLOAD`, тело — одна запись, массив записей или полный ответ API.

Повторный импорт обновляет диалоги и не трогает оценки.

Через curl (Windows 10+ тоже есть curl):
```
curl -X POST http://localhost:8000/api/datasets/import -H "Content-Type: application/json" -d "{\"group_id\":\"DEV\"}"
```

## Чек-лист и замена критерия

`POST /api/checklists` создаёт версию 1, `PUT /api/checklists/{id}` — новую версию (старые и их оценки не меняются).
Чтобы заменить критерий: взять последнюю версию (`GET /api/checklists`), поменять критерий, отправить `PUT`, затем запустить оценку
`POST /api/evaluations` с `{"group_id": "...", "all": true, "checklist_id": "..."}` — берётся последняя версия.
При пустой базе загружается `backend/seed_checklist.json`, если он заполнен. Пример чек-листа: `tests/checklist_standard.json`.

## Тесты

```
.venv\Scripts\python -m pytest -q
```
(на Linux/macOS — `.venv/bin/python -m pytest -q`).

## Записи звонков

`GET /api/audio/{group_id}/{conversation_id}` — mp3 с перемоткой (Range → 206). Ссылка организаторов ведёт на HTML-плеер,
сервер достаёт из него временную ссылку на файл (кэш 30 минут) и проксирует её. Настоящий адрес наружу не отдаётся.
Время реплик `t` у звонков приблизительное: последние реплики на 6–29 с позже конца записи.

## Оценка через ИИ

Настройки в `.env` (смена провайдера — только здесь, код не трогается):
```
LLM_PROVIDER=gemini        # gemini | groq | пусто = заглушка без сети
LLM_MODEL=                 # пусто: gemini-3.6-flash / openai/gpt-oss-120b
GEMINI_API_KEY=            # Google AI Studio → Get API key
GROQ_API_KEY=
LLM_RPM=5                  # запросов в минуту
LLM_CONCURRENCY=1
LLM_ALLOW_VOICE=           # true — отправлять и звонки (только после разрешения организаторов)
```
Один запрос на диалог со всеми критериями, `temperature = 0`, ответ строго JSON. Ответ проверяется (`backend/validator.py`):
допустимые ответы, существующие id реплик, участок для «нет», реплика оператора для «да». Цитата сверяется с текстом реплики
(`verified`), неподтверждённая не считается ошибкой. Ошибка формата — один повтор с текстом ошибки, затем `needs_review`.
429 и 5xx — до 3 повторов с паузой. Без ключа и с пустым `LLM_PROVIDER` работает заглушка (`model = "mock"`).

Стартовый чек-лист `chat-quality` грузится из `backend/seed_checklist.json` при пустой базе.

## Модель и стоимость

Модель: `gemini-3.6-flash` (бесплатный тариф Google AI Studio), стоимость одной оценки $0. Лимиты: TODO после проверки в AI Studio.
