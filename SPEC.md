# Career Futures Explorer: Spec & Implementation Plan

A web app that helps a user explore future career paths. The user describes their situation and their question. The app researches the labour market on the web, extrapolates relevant trends, and drafts 3–5 future scenarios. The user picks one and explores it further, so the exploration grows into a tree.

Each person is profiled and each scenario evaluated on four **power dimensions** (from `dimensionenDerMacht.md`, dimensions 1–4 only):

| Key | Dimension | What it means |
|---|---|---|
| `ownership` | Ownership over labour | Capital, equity, own products, own audience. Selling only time loses; owning benefits from automation. |
| `trust` | Trust & relationships | Network, reputation, people who buy from you because they trust you. Not copyable. |
| `responsibility` | Taking responsibility | Signing, approving, being liable, holding licences. AI can't take the blame. |
| `judgment` | Judgment & taste | Knowing what matters, asking the right questions, prioritising, saying no. |

Guiding principle (from `theorie.md`): the biggest marginal gain is in the **weakest** dimension. At least one scenario must target it explicitly.

---

## 1. Decisions (fixed)

| Topic | Decision |
|---|---|
| Domain | Career / employment only |
| Language | English (UI and LLM output) |
| Dimensions | 1–4 only; 5–8 are out of scope |
| Stack | Python **FastAPI** backend + **React** (Vite, TypeScript) frontend, built with Claude Code |
| LLM access | Existing hosted **Mozilla otari gateway** (URL + key); the backend calls it, and the frontend never sees keys |
| Model selection | Settings panel, prefilled with task-based routing defaults; model list fetched from gateway |
| Token monitoring | Live usage panel in UI: tokens + estimated cost per step and per session |
| Web search | **Tavily** |
| Time series | Tavily results → LLM extracts numbers with source URLs → backend extrapolates → charts labelled *indicative* |
| Persistence | None server-side. State lives in browser (localStorage), with export/import as JSON |
| Exploration view | Visual tree of all nodes/scenarios; user can branch from any node |
| Timebox | **Hard deadline today 15:00** (~1.5 h). Build the "15:00 cut" in §8 first; everything else is stretch |

---

## 2. User flow

```
 ┌──────────── START (Intake) ────────────┐
 │ chat: background, skills, question     │
 │ live 4-axis power profile (radar)      │
 │ sufficiency check after every turn     │
 └───────────────┬────────────────────────┘
                 │ ready (or user clicks "Proceed anyway")
 ┌───────────────▼────────────────────────┐
 │ RESEARCH                               │
 │ query plan → Tavily → extract series   │
 │ → extrapolate → findings w/ citations  │
 └───────────────┬────────────────────────┘
 ┌───────────────▼────────────────────────┐
 │ SCENARIOS (3–5, different models)      │
 │ cards: summary, profile delta, charts, │
 │ milestones, risks, sources             │
 └───────────────┬────────────────────────┘
                 │ TURNING POINT: user picks a scenario
                 └──► new child node → START (context carried over,
                      intake asks scenario-specific follow-ups)
```

### 2.1 Intake (START)
- The chat assistant asks **one or two questions per turn**. It focuses on whatever is missing, with this priority:
  1. The user's question / what they want to explore, and the time horizon
  2. Current role, industry, years of experience, location, employment status
  3. Key skills and education
  4. Constraints: financial runway, mobility, family, risk appetite
  5. Evidence for each power dimension. The assistant asks concrete, answerable questions, for example:
     - *ownership*: "Do you own anything that earns without your hours: equity, side product, audience, IP?"
     - *trust*: "Who would hire or refer you tomorrow without a CV? How do people find you?"
     - *responsibility*: "What do you sign off on? Any licences, budget or people responsibility?"
     - *judgment*: "Describe a decision where you said no or set a priority others disagreed with."
- After each turn the backend returns an updated **profile**: background fields, plus for each dimension a 1–10 score, a 0–1 confidence and a one-line evidence note. It also returns a **sufficiency** verdict.
- **Sufficiency rule** (computed in the backend from LLM output, not just trusted):
  - required fields set: `question`, `current_role`, `skills` (≥2), `location`, `time_horizon_years`
  - every dimension has `confidence ≥ 0.6`
  - OR the user has answered 10 turns, OR the user clicks **Proceed anyway** (the button appears after 3 turns).
- In child nodes (after a turning point), intake starts with the parent profile and the chosen scenario. It asks 2–4 follow-up questions that deepen that path, for example: "Which certification would you consider?" or "How much could you invest?"

### 2.2 Research
1. **Query planner** (LLM): generates 4–6 Tavily queries from the profile. The queries must be generic and must never include the user's name or other personal identifiers. Examples: "employment projections software developers Germany 2030", "AI automation exposure accountants", "median salary data engineer Berlin trend".
2. **Tavily search**: `search_depth="advanced"`, `max_results=5` per query, `include_answer=false`, `include_raw_content=false`. The backend deduplicates results by URL.
3. **Extractor** (LLM, structured output) turns the results into:
   - `series[]`: numeric time series, e.g. employment count, demand index, salary or automation exposure. Each point carries a `source_url`. A series needs **≥3 points** to be kept.
   - `findings[]`: 5–10 qualitative findings, each with `source_url`, and tagged with the dimension(s) it touches.
4. **Extrapolation** (Python, deterministic, no LLM):
   - fit linear and log-linear models with `numpy.polyfit`, and keep the one with the lower residual error
   - project to `last_year + time_horizon_years` (capped at 10)
   - uncertainty band = ±1.96 × residual std, widening with √(years ahead)
   - output `historical[]`, `projected[]`, `band_low[]`, `band_high[]`, `method`
5. Progress is streamed to the UI via SSE (`planning → searching (n/N) → extracting → extrapolating → done`).

### 2.3 Scenarios
1. **Scenario planner** (strong model): from profile + research, defines **N skeletons** (default 4, min 3, max 5). Each skeleton has a title, an archetype and a target dimension. Rules:
   - The skeletons must be clearly distinct, e.g. stay & deepen, upskill/pivot, go independent/build ownership, move into a responsibility role, or a wildcard.
   - At least one targets the user's **weakest** dimension.
   - At least one is low-risk/conservative.
2. **Scenario writers**: each skeleton is elaborated **in parallel by a different model**, taken round-robin from `settings.scenario_models`. Each card shows which model wrote it.
3. Each scenario contains:
   - `title` and `one_liner`; a `narrative` of at most 150 words, written in second person
   - `milestones[]` at year 1, 3 and 5 (or within the horizon)
   - `first_steps[]`: 3 concrete actions for the next 90 days
   - `profile_delta` per dimension: projected score after the horizon, plus a one-line rationale
   - `series_refs[]`: which research series support it. An optional `adjustment` explains how the path relates to the trend, e.g. "you'd ride the +4%/yr demand growth".
   - `upside`, `risks[]`, `confidence` (low/med/high), `sources[]` (only URLs from the research)
4. The backend validates the output: `sources` must be a subset of the research URLs, scores are clamped to 1–10, and a failed scenario is retried once with the fallback model.

### 2.4 Turning point
- Each scenario card has an **"Explore this path"** button. Clicking it creates a child node under the current node with `chosen_scenario_id` set, then starts intake there.
- Unchosen scenarios stay visible in the tree as leaves. The user can click any node to view it, or choose a different scenario from an old node, which creates a new branch.

---

## 3. UI

Three-column layout on desktop; on mobile it stacks into tabs.

| Left (narrow) | Center (main) | Right (narrow) |
|---|---|---|
| **Exploration tree** (React Flow). Nodes = iterations, children = scenarios; chosen path highlighted. | Active node's phase: **Chat** → **Research progress + findings** → **Scenario cards** | **Power profile radar** (current; on scenario hover: before/after overlay) + **Usage panel** |

- **Scenario card**: title, model badge, one-liner, mini radar (before/after), sparkline of the main supporting series, confidence chip, and the "Explore this path" button. Clicking the card expands it to show the narrative, milestones, first steps, risks, a full chart and the sources.
- **Time-series chart** (Recharts): solid line for historical data, dashed line for the projection, shaded uncertainty band, and source links in the footer. A fixed label reads *"Indicative extrapolation from web data, not a forecast."*
- **Usage panel**: table of calls (step, model, prompt/completion tokens, est. cost, latency) with totals for the node and the session. The "scenarios" step has a mini bar per model.
- **Settings panel** (gear icon): dropdowns for each role (see §5) populated from `/api/models`, a multi-select for `scenario_models`, a scenario count slider (3–5), and the horizon default. Settings are saved in localStorage.
- **Header**: New exploration, Export JSON, Import JSON.
- **Footer disclaimer**: "Exploration aid, not career or financial advice."

---

## 4. Architecture

```
React (Vite, TS, Tailwind, Zustand+persist, Recharts, React Flow)
        │  REST + SSE (JSON)
FastAPI (Python 3.12, pydantic v2, httpx, numpy)
   ├── llm.py      → otari gateway (OpenAI-compatible: /v1/chat/completions, /v1/models)
   ├── search.py   → Tavily (tavily-python)
   ├── extrapolate.py (pure numpy)
   └── usage.py    → wraps every LLM call, returns UsageRecord
```

- The **backend is stateless**. The frontend sends the relevant context (profile, research, chosen scenario) with every request, which is enough for browser-only persistence.
- **otari client**: uses the `openai` Python SDK with `base_url=OTARI_BASE_URL` and `api_key=OTARI_API_KEY`. Structured outputs use `response_format={"type":"json_schema",...}` where the model supports it. Otherwise the client falls back to JSON mode with a pydantic validation retry. Model IDs are passed through exactly as the gateway lists them (e.g. `openai:gpt-…`, `anthropic:claude-…`).
- **Usage**: every LLM call returns `usage` from the response plus a measured latency. Cost is estimated from `backend/pricing.yaml` (USD per 1M input/output tokens per model; unknown models are marked `cost: null`). If the gateway reports cost itself, the backend uses that value instead.
- **Env**: `OTARI_BASE_URL`, `OTARI_API_KEY`, `TAVILY_API_KEY`, `CORS_ORIGINS`. These go in `.env` (git-ignored); the repo has a `.env.example`.

### 4.1 API

| Method & path | Request | Response |
|---|---|---|
| `GET /api/models` | – | `{models: [{id, provider}]}` (proxied from gateway, cached 10 min) |
| `GET /api/defaults` | – | default routing settings |
| `POST /api/intake/turn` | `{messages, profile, parent_context?, settings}` | `{assistant_message, profile, sufficiency:{ready, missing[]}, usage[]}` |
| `POST /api/research` (SSE) | `{profile, parent_context?, settings}` | events `progress` …, final `result: {series[], findings[], queries[], usage[]}` |
| `POST /api/scenarios` (SSE) | `{profile, research, n, parent_context?, settings}` | events `skeletons`, `scenario` (one per finished card, streamed as they complete), `done: {usage[]}` |

`parent_context` = `{chosen_scenario, parent_profile, parent_findings_summary}`.

### 4.2 Data model (pydantic ⇄ TypeScript, keep names identical)

```ts
type DimensionKey = "ownership" | "trust" | "responsibility" | "judgment";

interface DimensionScore { score: number /*1-10*/; confidence: number /*0-1*/; evidence: string }

interface Profile {
  question: string | null;
  time_horizon_years: number | null;        // default 5
  current_role: string | null;
  industry: string | null;
  years_experience: number | null;
  location: string | null;                  // country/city
  employment_status: string | null;
  skills: string[];
  education: string | null;
  constraints: string[];                    // runway, mobility, risk appetite...
  dimensions: Record<DimensionKey, DimensionScore>;
}

interface SeriesPoint { year: number; value: number; source_url: string }
interface Series {
  id: string; metric: string; unit: string; region: string;
  historical: SeriesPoint[];
  projected: { year: number; value: number; low: number; high: number }[];
  method: "linear" | "loglinear";
}
interface Finding { text: string; source_url: string; dimensions: DimensionKey[] }
interface Research { queries: string[]; series: Series[]; findings: Finding[] }

interface Scenario {
  id: string; title: string; one_liner: string; narrative: string;
  archetype: string; target_dimension: DimensionKey; model: string;
  milestones: { year: number; text: string }[];
  first_steps: string[];
  profile_delta: Record<DimensionKey, { to: number; rationale: string }>;
  series_refs: { series_id: string; adjustment?: string }[];
  upside: string; risks: string[]; confidence: "low" | "med" | "high";
  sources: string[];
}

interface UsageRecord {
  step: "intake" | "query_plan" | "extract" | "scenario_plan" | "scenario_write";
  model: string; prompt_tokens: number; completion_tokens: number;
  cost_usd: number | null; latency_ms: number; ts: string;
}

interface ExplorationNode {
  id: string; parent_id: string | null; chosen_scenario_id: string | null;
  phase: "intake" | "research" | "scenarios";
  messages: { role: "user" | "assistant"; content: string }[];
  profile: Profile; research: Research | null; scenarios: Scenario[];
  usage: UsageRecord[];
}

interface Exploration {
  version: 1; id: string; created_at: string;
  root_id: string; active_node_id: string;
  nodes: Record<string, ExplorationNode>;
  settings: Settings;
}
```

Export/Import = serialize/validate `Exploration` (check `version`).

---

## 5. Model routing (settings defaults)

The defaults are resolved at startup against `/api/models`. A preferred model that isn't available falls back to the first available model.

| Role | Purpose | Default preference |
|---|---|---|
| `intake_model` | Chat + profile update + sufficiency | fast/cheap (e.g. a "mini"/"haiku"/"small" class model) |
| `query_model` | Tavily query planning | fast/cheap |
| `extract_model` | Structured extraction of series/findings | mid-tier with reliable JSON output |
| `planner_model` | Scenario skeletons | strongest available |
| `scenario_models[]` | Writers, round-robin across scenarios | 3–5 models from **different providers** if available |
| `fallback_model` | Retry on failure / invalid JSON | reliable mid-tier |

---

## 6. Prompt outlines

The system prompts live in `backend/prompts/*.md` and are versioned. All of them:
- answer in English
- never invent sources: cite only URLs that appear in the provided research
- use the four dimension definitions from the top of this file verbatim

- **intake.md**: You are a career exploration interviewer. Given the conversation and current profile JSON, return `{assistant_message, profile}`. Ask at most 2 short questions, targeting the highest-priority missing info (§2.1). Update dimension scores only with evidence from the user's words, and lower the confidence when you infer. Be warm and concise. Don't give advice yet.
- **query_plan.md**: Produce 4–6 web search queries about labour-market trends, demand, salaries and automation exposure relevant to this profile and question. Never include personal names or identifiers.
- **extract.md**: From the search results, extract numeric time series (≥3 years each, the same metric/unit/region within a series) and 5–10 findings. Every number needs its source URL. Omit anything uncertain.
- **scenario_plan.md**: Create N distinct scenario skeletons following the rules in §2.3. Identify the weakest dimension and target it in at least one skeleton.
- **scenario_write.md**: Elaborate this one skeleton into the `Scenario` schema. Ground it in the given series and findings. The `profile_delta` must be realistic for the horizon, and the rationale has to name the mechanism.

---

## 7. Repository layout

```
/backend
  app/main.py            FastAPI app, CORS, routers
  app/routers/{models,intake,research,scenarios}.py
  app/llm.py             otari client, structured-output helper, usage wrapper
  app/search.py          Tavily wrapper (parallel queries, dedupe)
  app/extrapolate.py
  app/sufficiency.py
  app/schemas.py         pydantic models (§4.2)
  app/prompts/*.md
  pricing.yaml
  tests/                 pytest; gateway + Tavily mocked via fixtures
  pyproject.toml         (uv) fastapi, uvicorn, openai, tavily-python, numpy, pydantic, sse-starlette, pytest
/frontend
  src/api/               typed client + SSE helper
  src/store/exploration.ts  Zustand + persist (localStorage)
  src/components/{Chat,ProfileRadar,ResearchView,SeriesChart,ScenarioCard,ExplorationTree,UsagePanel,SettingsPanel}.tsx
  src/types.ts           mirrors schemas.py
.env.example
README.md                setup + run (uv run uvicorn …, npm run dev)
```

---

## 8. Implementation plan

### 8.0 The 15:00 cut (build this first, in this order)

Deadline is 15:00 today, so the MVP simplifies the full spec as follows:

| Full spec | 15:00 cut |
|---|---|
| SSE streaming for research/scenarios | Plain `POST` + loading spinner with step text; scenario writers still run in parallel (`asyncio.gather`) |
| React Flow tree | Simple nested list / breadcrumb of nodes in the left column (still clickable and branchable) |
| Settings panel with every role | One dropdown for `intake/planner` model + a multi-select for `scenario_models`; other roles use defaults |
| Usage panel with latency, per-model bars | Table of step / model / tokens / est. cost + session total |
| pytest suite | Only `extrapolate.py` unit test; manual demo run with the persona |
| Retry / fallback model | One retry with the same model on invalid JSON |

Time plan (assuming start ~13:30):

| Until | What |
|---|---|
| 13:45 | M0 scaffold + M1 `llm.py` (one real otari call works, usage captured) |
| 14:05 | M2 intake chat + radar + sufficiency |
| 14:25 | M3 research: Tavily + extract + extrapolate + chart |
| 14:45 | M4 scenarios (multi-model) + M5 "Explore this path" → child node |
| 14:55 | Usage table, model dropdowns, Export JSON |
| 15:00 | Demo run with the persona; freeze |

If you're behind at 14:25: skip the time-series extrapolation and show findings only, then go straight to scenarios. The full scenario loop with the turning point matters more for the demo than the charts.

### 8.1 Full milestones (post-hackathon / stretch)

The milestones are ordered so the app can be demoed after each one.

| # | Milestone | Done when |
|---|---|---|
| M0 | **Scaffold**: repo layout, FastAPI hello, Vite+React+Tailwind, `.env.example`, dev proxy | `npm run dev` + `uvicorn` run; frontend calls `/api/health` |
| M1 | **Gateway & usage**: `llm.py` with structured-output helper + fallback, `UsageRecord`, `pricing.yaml`, `GET /api/models`, `/api/defaults` | pytest: mocked completion returns parsed object + usage; real call works against otari |
| M2 | **Intake**: `/api/intake/turn`, sufficiency logic, Chat + ProfileRadar, Zustand store with persist | Can chat; radar fills in; "ready" state shows a "Start research" button |
| M3 | **Research**: query plan → Tavily (parallel) → extract → extrapolate, SSE progress, ResearchView + SeriesChart | Demo persona yields ≥1 chart with band + findings with working links |
| M4 | **Scenarios**: planner + parallel multi-model writers, validation/retry, SSE streaming of cards, ScenarioCard with before/after radar | 3–5 cards from different models appear progressively |
| M5 | **Turning point & tree**: child nodes, parent_context in all endpoints, ExplorationTree with branching from any node | Pick a scenario → follow-up intake → new research/scenarios; tree shows both levels |
| M6 | **Settings & usage panel**: SettingsPanel from `/api/models`, UsagePanel per node/session | Changing scenario models changes card badges; totals update live |
| M7 | **Export/import, polish, demo**: JSON export/import with version check, empty/error/loading states, disclaimer, README, demo script | Fresh clone → README steps → full demo in < 5 min |

**Testing**
- Unit tests: `extrapolate.py` (known inputs), `sufficiency.py`, and source-subset validation.
- Router tests use recorded fixture responses for the gateway and Tavily, so tests don't spend tokens.
- Manual end-to-end run with the demo persona.

**Demo persona** (for fixtures and the live demo): a mid-level accountant in Germany, 8 yrs of experience, strong Excel/ERP skills, asking "Will my job survive AI in the next 5 years and what should I do?" Expected weak dimension: *ownership*.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Web data too sparse for series | Keep series only with ≥3 points; if none, show findings only and an explicit "no reliable numeric trend found" note |
| Models hallucinate numbers/sources | Extraction needs a source URL for every point; the backend drops scenario sources that aren't in the research set |
| Some gateway models lack JSON-schema mode | JSON-mode fallback + pydantic validation + one retry via `fallback_model` |
| Latency (many calls) | Parallel Tavily queries and scenario writers; SSE streaming so the UI fills progressively |
| Privacy | No server storage; search queries contain no personal identifiers; keys stay in the backend |
| localStorage loss | Prominent Export button; auto-save on every state change |

## 10. Assumptions to verify early
- The otari gateway exposes OpenAI-compatible `/v1/chat/completions` (with `usage` in responses) and `/v1/models`. Check this in M1. If the paths or model ID format differ, adapt only `llm.py`.
- Whether the gateway reports per-call cost. If it does, use it instead of `pricing.yaml`.
