import asyncio
import json
import re
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env", override=True)
load_dotenv(Path(__file__).parent.parent / ".env")

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from tavily import AsyncTavilyClient  # noqa: E402

from . import prompts  # noqa: E402
from .extrapolate import extrapolate  # noqa: E402
from .llm import call_json, default_settings, is_chat, list_models, provider_of  # noqa: E402
from .schemas import (  # noqa: E402
    DIMENSIONS,
    DeltaEntry,
    ExtractOut,
    IntakeOut,
    IntakeRequest,
    PlanOut,
    Profile,
    QueryPlanOut,
    Research,
    ResearchRequest,
    Scenario,
    ScenariosRequest,
    Series,
    Skeleton,
)

app = FastAPI(title="Career Futures Explorer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ctx(req) -> str:
    pc = req.parent_context.model_dump(exclude_none=True) if req.parent_context else None
    return json.dumps(pc) if pc else "none"


def _need(model: str, name: str) -> str:
    if not model:
        raise HTTPException(400, f"No {name} configured - open settings and pick a model.")
    return model


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/models")
async def models():
    try:
        ids = await list_models()
    except Exception as e:
        raise HTTPException(502, f"Could not list models from otari gateway: {e}")
    return {"models": [{"id": m, "provider": provider_of(m)} for m in ids if is_chat(m)]}


@app.get("/api/defaults")
async def defaults():
    try:
        ids = await list_models()
    except Exception:
        ids = []
    return default_settings(ids)


# ---------------- intake ----------------
def sufficiency(p: Profile, turns: int) -> dict:
    missing = []
    if not p.question:
        missing.append("your question / what to explore")
    if not p.time_horizon_years:
        missing.append("time horizon")
    if not p.current_role:
        missing.append("current role")
    if len(p.skills) < 2:
        missing.append("key skills")
    if not p.location:
        missing.append("location")
    for d in DIMENSIONS:
        ds = p.dimensions.get(d)
        if not ds or ds.confidence < 0.6:
            missing.append(f"evidence for {d}")
    return {"ready": not missing or turns >= 10, "missing": missing, "can_force": turns >= 3}


@app.post("/api/intake/turn")
async def intake_turn(req: IntakeRequest):
    model = _need(req.settings.fast_model, "fast model")
    convo = "\n".join(f"{m.role.upper()}: {m.content}" for m in req.messages) or "(no messages yet - greet briefly and ask the first question)"
    user = f"PARENT CONTEXT: {_ctx(req)}\n\nCURRENT PROFILE:\n{req.profile.model_dump_json()}\n\nCONVERSATION:\n{convo}"
    out, usage = await call_json("intake", model, prompts.INTAKE, user, IntakeOut)
    p = out.profile
    for d in DIMENSIONS:  # make sure all dims exist and are clamped
        if d not in p.dimensions:
            p.dimensions[d] = req.profile.dimensions.get(d) or p.dimensions.get(d)
        ds = p.dimensions[d]
        ds.score = max(1, min(10, ds.score))
        ds.confidence = max(0, min(1, ds.confidence))
    p.dimensions = {d: p.dimensions[d] for d in DIMENSIONS}
    return {
        "assistant_message": out.assistant_message,
        "profile": p,
        "sufficiency": sufficiency(p, req.turns_answered),
        "usage": usage,
    }


# ---------------- research ----------------
_tavily: AsyncTavilyClient | None = None


def tavily() -> AsyncTavilyClient:
    global _tavily
    if _tavily is None:
        _tavily = AsyncTavilyClient(api_key=os.environ["TAVILY_API_KEY"])
    return _tavily


_YEAR = re.compile(r"\b(19[89]\d|20[0-4]\d)\b")


def _numeric_excerpts(text: str, limit: int = 2500) -> str:
    paras = [p for p in re.split(r"\n+", text or "") if _YEAR.search(p) and re.search(r"\d[\d.,]{2,}", p)]
    return "\n".join(p[:600] for p in paras)[:limit]


async def _search(q: str) -> list[dict]:
    try:
        r = await tavily().search(query=q, search_depth="advanced", max_results=5, include_raw_content=True)
        return r.get("results", [])
    except Exception as e:
        print("tavily error", q, e)
        return []


@app.post("/api/research")
async def research(req: ResearchRequest):
    fast = _need(req.settings.fast_model, "fast model")
    strong = _need(req.settings.strong_model, "strong model")
    usage = []
    profile_json = req.profile.model_dump_json(exclude={"dimensions"})
    plan, u = await call_json(
        "query_plan", fast, prompts.QUERY_PLAN,
        f"PROFILE:\n{profile_json}\n\nPARENT CONTEXT: {_ctx(req)}", QueryPlanOut,
    )
    usage += u
    role = req.profile.current_role or "this occupation"
    loc = req.profile.location or ""
    fixed = [
        f"{role} employment forecast {loc} percent change per year statistics",
        f"{role} number employed {loc} statistics trend 2015 2020 2024",
    ]
    queries = plan.queries[:5] + fixed
    results_nested = await asyncio.gather(*[_search(q) for q in queries])
    seen, results = set(), []
    for rs in results_nested:
        for r in rs:
            if r.get("url") and r["url"] not in seen:
                seen.add(r["url"])
                results.append({
                    "title": r.get("title", ""), "url": r["url"], "content": (r.get("content") or "")[:1000],
                    "numeric_excerpts": _numeric_excerpts(r.get("raw_content") or ""),
                })
    if not results:
        raise HTTPException(502, "Web search returned no results (check TAVILY_API_KEY).")

    ex, u = await call_json(
        "extract", strong, prompts.EXTRACT,
        f"USER QUESTION: {req.profile.question}\nPROFILE:\n{profile_json}\n\nSEARCH RESULTS:\n{json.dumps(results)}",
        ExtractOut,
    )
    usage += u
    valid_urls = {r["url"] for r in results}
    horizon = req.profile.time_horizon_years or 5
    series = []
    for s in ex.series:
        pts = [p for p in s.points if p.source_url in valid_urls]
        growth = s.annual_growth_pct if (s.growth_source_url in valid_urls and s.annual_growth_pct is not None and abs(s.annual_growth_pct) < 50) else None
        if not pts or (len({p.year for p in pts}) < 2 and growth is None):
            continue
        ser = extrapolate(Series(id=s.id, metric=s.metric, unit=s.unit, region=s.region, historical=pts,
                                 annual_growth_pct=growth, growth_source_url=s.growth_source_url if growth is not None else None), horizon)
        if ser.projected:
            series.append(ser)
    findings = [f for f in ex.findings if f.source_url in valid_urls]
    return {"research": Research(queries=queries, series=series, findings=findings), "usage": usage}


# ---------------- scenarios ----------------
def _research_brief(r: Research) -> str:
    return json.dumps({
        "series": [
            {"id": s.id, "metric": s.metric, "unit": s.unit, "region": s.region,
             "historical": [(p.year, p.value) for p in s.historical],
             "projected": [(p.year, p.value) for p in s.projected], "method": s.method}
            for s in r.series
        ],
        "findings": [f.model_dump() for f in r.findings],
    })


async def _write(sk: Skeleton, model: str, base: str, valid_urls: set[str], profile: Profile, fallback: str):
    user = f"{base}\n\nSCENARIO SKELETON TO ELABORATE:\n{sk.model_dump_json()}"
    usage = []
    try:
        sc, usage = await asyncio.wait_for(
            call_json("scenario_write", model, prompts.SCENARIO_WRITE, user, Scenario), timeout=75)
    except (Exception, asyncio.TimeoutError) as e:
        print("scenario writer failed", model, e)
        if fallback == model:
            return None, usage
        model = fallback
        sc, usage = await call_json("scenario_write", model, prompts.SCENARIO_WRITE, user, Scenario)
    sc.id = uuid.uuid4().hex[:8]
    sc.model = model
    sc.title = sc.title or sk.title
    sc.archetype = sc.archetype or sk.archetype
    sc.target_dimension = sc.target_dimension or sk.target_dimension
    sc.sources = [s for s in sc.sources if s in valid_urls]
    for d in DIMENSIONS:
        cur = profile.dimensions[d].score
        e = sc.profile_delta.get(d) or DeltaEntry(to=cur, rationale="unchanged")
        e.to = max(1, min(10, e.to))
        sc.profile_delta[d] = e
    sc.profile_delta = {d: sc.profile_delta[d] for d in DIMENSIONS}
    return sc, usage


@app.post("/api/scenarios")
async def scenarios(req: ScenariosRequest):
    strong = _need(req.settings.strong_model, "strong model")
    writers = req.settings.scenario_models or [strong]
    n = max(3, min(5, req.settings.n_scenarios))
    base = (
        f"PROFILE:\n{req.profile.model_dump_json()}\n\nPARENT CONTEXT: {_ctx(req)}\n\n"
        f"RESEARCH:\n{_research_brief(req.research)}"
    )
    plan, usage = await call_json("scenario_plan", strong, prompts.SCENARIO_PLAN, f"N = {n}\n\n{base}", PlanOut)
    sks = plan.skeletons[:n]
    valid_urls = {f.source_url for f in req.research.findings} | {
        p.source_url for s in req.research.series for p in s.historical
    }
    results = await asyncio.gather(
        *[_write(sk, writers[i % len(writers)], base, valid_urls, req.profile, strong) for i, sk in enumerate(sks)],
        return_exceptions=True,
    )
    out = []
    for r in results:
        if isinstance(r, Exception):
            print("scenario failed", r)
            continue
        sc, u = r
        usage += u
        if sc:
            out.append(sc)
    if not out:
        raise HTTPException(502, "All scenario writers failed.")
    return {"weakest_dimension": plan.weakest_dimension, "scenarios": out, "usage": usage}
