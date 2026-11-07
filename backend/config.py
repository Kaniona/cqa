"""Настройки из .env (без сторонних библиотек)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

_env = ROOT / ".env"
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())

CQA_API_URL = os.environ.get("CQA_API_URL", "")
DB_PATH = str(ROOT / os.environ.get("DB_PATH", "cqa.db"))
FRONTEND_DIR = ROOT / "frontend"
SEED_CHECKLIST = Path(__file__).resolve().parent / "seed_checklist.json"
