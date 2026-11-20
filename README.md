# Career Futures Explorer

Explore future career paths along four power dimensions (Ownership, Trust & Relationships, Responsibility, Judgment & Taste).
Chat intake → Tavily web research + trend extrapolation → 3–5 scenarios written by different LLMs via the Mozilla otari gateway → pick a path, explore further.

See [SPEC.md](SPEC.md) for the full spec.

## Setup
1. `cp .env.example .env` and fill in `OTARI_BASE_URL` (OpenAI-compatible, usually ending in `/v1`), `OTARI_API_KEY`, `TAVILY_API_KEY`.
2. Backend (Python 3.11+):
   ```
   cd backend
   python -m venv .venv
   .venv/Scripts/pip install fastapi "uvicorn[standard]" openai tavily-python numpy pydantic python-dotenv pyyaml pytest
   .venv/Scripts/python -m uvicorn app.main:app --port 8000 --reload
   ```
3. Frontend:
   ```
   cd frontend
   npm install
   npm run dev
   ```
4. Open http://localhost:5173 → ⚙ Models to check the model routing.

Tests: `cd backend && .venv/Scripts/python -m pytest -q tests`

Cost estimates come from `backend/pricing.yaml` (substring match on model id) unless the gateway reports cost.
State lives in the browser (localStorage); use Export/Import JSON to keep explorations.
