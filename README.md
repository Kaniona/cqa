# CQA — Conversation Quality Analytics

ИИ оценивает диалог оператора по чек-листу, человек может оспорить оценку, проверяющий выносит решение, итог пересчитывается.
Бэкенд: FastAPI + SQLite. Сайт (`frontend/`) раздаётся сервером с `/`.

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
Сайт: http://localhost:8000, документация API: http://localhost:8000/docs.

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

## Модель и стоимость

Сейчас работает заглушка (`model = "mock"`, без вызова ИИ). Модель и стоимость одной оценки — TODO (человек 2).
