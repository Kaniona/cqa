"""Весь вызов модели. Смена провайдера — только через .env (LLM_PROVIDER, LLM_MODEL, ключ)."""
import httpx

from . import config

DEFAULT_MODELS = {"gemini": "gemini-3.6-flash", "groq": "openai/gpt-oss-120b", "mock": "mock"}


class LLMError(Exception):
    def __init__(self, message, retryable=False, retry_after=None, status=None):
        super().__init__(message)
        self.status = status
        self.retryable = retryable
        self.retry_after = retry_after


def model_name():
    return config.LLM_MODEL or DEFAULT_MODELS.get(config.LLM_PROVIDER, config.LLM_PROVIDER)


def _post(url, headers, body):
    try:
        resp = httpx.post(url, headers=headers, json=body, timeout=180)
    except httpx.HTTPError as e:
        raise LLMError(f"сеть: {type(e).__name__}", retryable=True)
    if resp.status_code == 429 or resp.status_code >= 500:
        retry_after = resp.headers.get("retry-after")
        raise LLMError(f"провайдер ответил {resp.status_code}", retryable=True, status=resp.status_code,
                       retry_after=float(retry_after) if retry_after and retry_after.replace(".", "").isdigit() else None)
    if resp.status_code != 200:
        raise LLMError(f"провайдер ответил {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def generate_json(system: str, user: str, schema: dict) -> str:
    """Один запрос к модели, temperature 0, ответ — строка JSON."""
    if config.LLM_PROVIDER == "gemini":
        if not config.GEMINI_API_KEY:
            raise LLMError("GEMINI_API_KEY не задан в .env")
        data = _post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name()}:generateContent",
            {"x-goog-api-key": config.GEMINI_API_KEY},  # ключ в заголовке, а не в адресе: не попадёт в логи
            {"systemInstruction": {"parts": [{"text": system}]},
             "contents": [{"role": "user", "parts": [{"text": user}]}],
             "generationConfig": {"temperature": 0, "responseMimeType": "application/json",
                                  "responseJsonSchema": schema}})
        try:
            return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError):
            raise LLMError(f"пустой ответ модели: {str(data)[:300]}")
    if config.LLM_PROVIDER == "groq":
        if not config.GROQ_API_KEY:
            raise LLMError("GROQ_API_KEY не задан в .env")
        data = _post(
            "https://api.groq.com/openai/v1/chat/completions",
            {"Authorization": f"Bearer {config.GROQ_API_KEY}"},
            {"model": model_name(), "temperature": 0, "response_format": {"type": "json_object"},
             "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError):
            raise LLMError(f"пустой ответ модели: {str(data)[:300]}")
    raise LLMError(f"неизвестный LLM_PROVIDER: {config.LLM_PROVIDER}")
