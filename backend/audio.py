"""Прокси записи звонка с перемоткой (Range). Адрес берётся только из базы."""
from contextlib import closing

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from . import db

PASS_HEADERS = ("content-type", "content-length", "content-range", "accept-ranges")
client = httpx.AsyncClient(timeout=60, follow_redirects=True)


async def stream(group_id, conversation_id, range_header=None):
    with closing(db.connect()) as conn:
        r = db.row(conn, "SELECT audio_url FROM conversations WHERE group_id=? AND conversation_id=?",
                   (group_id, conversation_id))
    if not r or not r["audio_url"]:
        raise HTTPException(404, "у диалога нет записи")
    req = client.build_request("GET", r["audio_url"], headers={"Range": range_header} if range_header else {})
    try:
        resp = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"запись недоступна: {type(e).__name__}")  # без адреса: в нём подпись
    if resp.status_code not in (200, 206):
        await resp.aclose()
        raise HTTPException(502, f"источник записи ответил {resp.status_code}")
    headers = {h: resp.headers[h] for h in PASS_HEADERS if h in resp.headers}
    return StreamingResponse(resp.aiter_raw(), status_code=resp.status_code, headers=headers,
                             background=BackgroundTask(resp.aclose))
