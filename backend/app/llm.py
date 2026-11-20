"""otari gateway client (OpenAI-compatible) with JSON output + usage tracking."""
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeVar

import yaml
from openai import AsyncOpenAI
from pydantic import BaseModel, ValidationError

from .schemas import UsageRecord

T = TypeVar("T", bound=BaseModel)

_client: AsyncOpenAI | None = None
_PRICING = yaml.safe_load((Path(__file__).parent.parent / "pricing.yaml").read_text()) or {}


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            base_url=os.environ["OTARI_BASE_URL"],
            api_key=os.environ["OTARI_API_KEY"],
            timeout=120,
        )
    return _client


def estimate_cost(model: str, pt: int, ct: int) -> float | None:
    m = model.lower()
    # longest matching key wins
    best = None
    for key, price in _PRICING.items():
        if key.lower() in m and (best is None or len(key) > len(best[0])):
            best = (key, price)
    if not best:
        return None
    p = best[1]
    return round(pt / 1e6 * p["input"] + ct / 1e6 * p["output"], 6)


def _extract_json(text: str) -> str:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        return fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if start != -1 and end != -1 else text


async def call_json(step: str, model: str, system: str, user: str, out: type[T]) -> tuple[T, list[UsageRecord]]:
    """Call model, parse into `out`. One retry on invalid JSON. Returns (obj, usage records)."""
    schema = json.dumps(out.model_json_schema())
    sys_full = (
        f"{system}\n\nRespond ONLY with a single JSON object matching this JSON schema "
        f"(no prose, no markdown):\n{schema}"
    )
    messages = [{"role": "system", "content": sys_full}, {"role": "user", "content": user}]
    usage: list[UsageRecord] = []
    last_err: Exception | None = None
    for attempt in range(2):
        t0 = time.perf_counter()
        kwargs = dict(model=model, messages=messages)
        try:
            resp = await client().chat.completions.create(**kwargs, response_format={"type": "json_object"})
        except Exception:
            # some providers reject response_format -> plain call
            resp = await client().chat.completions.create(**kwargs)
        latency = int((time.perf_counter() - t0) * 1000)
        u = resp.usage
        pt = getattr(u, "prompt_tokens", 0) or 0
        ct = getattr(u, "completion_tokens", 0) or 0
        gw_cost = getattr(u, "cost", None) if u else None
        usage.append(
            UsageRecord(
                step=step,
                model=model,
                prompt_tokens=pt,
                completion_tokens=ct,
                cost_usd=gw_cost if isinstance(gw_cost, (int, float)) else estimate_cost(model, pt, ct),
                latency_ms=latency,
                ts=datetime.now(timezone.utc).isoformat(),
            )
        )
        content = resp.choices[0].message.content or ""
        try:
            return out.model_validate_json(_extract_json(content)), usage
        except (ValidationError, ValueError) as e:
            last_err = e
            messages += [
                {"role": "assistant", "content": content},
                {"role": "user", "content": f"That was not valid JSON for the schema: {str(e)[:500]}. Return only the corrected JSON object."},
            ]
    raise RuntimeError(f"{step}: model {model} returned invalid JSON: {last_err}")


_models_cache: tuple[float, list[str]] | None = None


async def list_models() -> list[str]:
    global _models_cache
    if _models_cache and time.time() - _models_cache[0] < 600:
        return _models_cache[1]
    resp = await client().models.list()
    ids = sorted({m.id for m in resp.data})
    _models_cache = (time.time(), ids)
    return ids


def provider_of(model_id: str) -> str:
    for sep in (":", "/"):
        if sep in model_id:
            return model_id.split(sep, 1)[0]
    return "default"


NON_CHAT = ("embed", "whisper", "tts", "dall-e", "image", "moderation", "asr", "transcribe", "video", "flux", "veo",
            "seedance", "seedream", "rerank", "guard", "banana", "stable-", "sdxl", "bria", "kling", "pixverse", "vidu",
            "wan2", "ltx", "hailuo", "sonic", "kokoro", "orpheus", "chatterbox", "voxtral", "clip", "bge", "e5-", "gte-",
            "minilm", "mpnet", "text2vec", "ideogram", "happyhorse", "safety", "parakeet", "csm-1b", "audio", "upscale")


def is_chat(model_id: str) -> bool:
    m = model_id.lower()
    return not any(x in m for x in NON_CHAT)


FAST_HINTS = ["mini", "haiku", "flash", "small", "nano", "lite"]
STRONG_HINTS = ["opus", "sonnet", "gpt-5", "gpt-4.1", "gpt-4o", "pro", "large", "claude"]


def default_settings(models: list[str]) -> dict:
    env_fast, env_strong = os.getenv("DEFAULT_FAST_MODEL"), os.getenv("DEFAULT_STRONG_MODEL")
    chat = [m for m in models if is_chat(m)] or models

    def pick(hints: list[str], avoid: list[str] = []) -> str:
        for h in hints:
            for m in chat:
                ml = m.lower()
                if h in ml and not any(a in ml for a in avoid):
                    return m
        return chat[0] if chat else ""

    fast = env_fast or pick(FAST_HINTS)
    strong = env_strong or pick(STRONG_HINTS, avoid=FAST_HINTS)
    # one strong-ish model per provider for scenario diversity
    by_provider: dict[str, str] = {}
    for m in chat:
        p = provider_of(m)
        ml = m.lower()
        if p not in by_provider or (any(h in ml for h in STRONG_HINTS) and not any(h in ml for h in FAST_HINTS)):
            by_provider[p] = m
    scen = list(by_provider.values())[:4]
    env_scen = [m.strip() for m in os.getenv("DEFAULT_SCENARIO_MODELS", "").split(",") if m.strip()]
    if env_scen:
        scen = env_scen
    if len(scen) < 3:
        scen = list(dict.fromkeys(scen + [strong, fast] + chat))[:4]
    return {"fast_model": fast, "strong_model": strong, "scenario_models": scen, "n_scenarios": 4}
