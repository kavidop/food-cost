from fastapi import APIRouter

from ..config import settings

router = APIRouter(tags=["providers"])

ANTHROPIC_MODELS = [
    {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6  (fast)"},
    {"id": "claude-opus-4-6",   "label": "Claude Opus 4.6    (best)"},
]
GEMINI_MODELS = [
    {"id": "gemini-2.5-pro",   "label": "Gemini 2.5 Pro    (best)"},
    {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash  (fast)"},
]


@router.get("/providers")
def get_providers():
    return {
        "anthropic": {"available": bool(settings.anthropic_api_key), "models": ANTHROPIC_MODELS},
        "gemini":    {"available": bool(settings.google_api_key),    "models": GEMINI_MODELS},
    }
