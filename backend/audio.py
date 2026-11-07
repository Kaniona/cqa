"""Прокси записи звонка с перемоткой (Range). Адрес берётся только из базы.

audio_url организаторов отдаёт HTML-плеер; в нём <source src> — временная (~1 час) ссылка на mp3.
Достаём её и проксируем уже файл, пробрасывая Range.
"""
import html
import re
import time
from contextlib import closing

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from . import db

PASS_HEADERS = ("content-type", "content-length", "content-range", "accept-ranges")
CACHE_SECONDS = 30 * 60  # ссылка из плеера живёт около часа
client = httpx.AsyncClient(timeout=60, follow_redirects=True)
_file_urls = {}  # audio_url -> (ссылка на файл, когда получена)


async def _file_url(page_url):
    cached = _file_urls.get(page_url)
    if cached and time.time() - cached[1] < CACHE_SECONDS:
        return cached[0]
    try:
        resp = await client.get(page_url)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"запись недоступна: {type(e).__name__}")  # без адреса: в нём подпись
    if resp.status_code != 200:
        raise HTTPException(502, f"источник записи ответил {resp.status_code}")
    if "text/html" not in resp.headers.get("content-type", ""):
        url = page_url  # уже файл
    else:
        m = re.search(r'<(?:source|audio)[^>]*\ssrc="(https://[^"]+)"', resp.text)
        if not m:
            raise HTTPException(502, "в плеере записи не найдена ссылка на файл")
        url = html.unescape(m.group(1))
    _file_urls[page_url] = (url, time.time())
    return url


async def stream(group_id, conversation_id, range_header=None):
    with closing(db.connect()) as conn:
        r = db.row(conn, "SELECT audio_url FROM conversations WHERE group_id=? AND conversation_id=?",
                   (group_id, conversation_id))
    if not r or not r["audio_url"]:
        raise HTTPException(404, "у диалога нет записи")
    for attempt in range(2):
        url = await _file_url(r["audio_url"])
        req = client.build_request("GET", url, headers={"Range": range_header} if range_header else {})
        try:
            resp = await client.send(req, stream=True)
        except httpx.HTTPError as e:
            raise HTTPException(502, f"запись недоступна: {type(e).__name__}")
        if resp.status_code in (200, 206):
            break
        await resp.aclose()
        _file_urls.pop(r["audio_url"], None)  # ссылка могла истечь: берём свежую один раз
    else:
        raise HTTPException(502, f"источник записи ответил {resp.status_code}")
    headers = {h: resp.headers[h] for h in PASS_HEADERS if h in resp.headers}
    headers.setdefault("accept-ranges", "bytes")  # источник отвечает 206, но заголовок не шлёт
    return StreamingResponse(resp.aiter_raw(), status_code=resp.status_code, headers=headers,
                             background=BackgroundTask(resp.aclose))
