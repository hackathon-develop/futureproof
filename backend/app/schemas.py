from typing import Literal, Optional
from pydantic import BaseModel, Field

DIMENSIONS = ["ownership", "trust", "responsibility", "judgment"]
DimensionKey = Literal["ownership", "trust", "responsibility", "judgment"]


class DimensionScore(BaseModel):
    score: float = 5
    confidence: float = 0
    evidence: str = ""


def _empty_dims() -> dict[str, DimensionScore]:
    return {d: DimensionScore() for d in DIMENSIONS}


class Profile(BaseModel):
    question: Optional[str] = None
    time_horizon_years: Optional[int] = None
    current_role: Optional[str] = None
    industry: Optional[str] = None
    years_experience: Optional[float] = None
    location: Optional[str] = None
    employment_status: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    education: Optional[str] = None
    constraints: list[str] = Field(default_factory=list)
    dimensions: dict[str, DimensionScore] = Field(default_factory=_empty_dims)


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class Settings(BaseModel):
    fast_model: str = ""
    strong_model: str = ""
    scenario_models: list[str] = Field(default_factory=list)
    n_scenarios: int = 4


class UsageRecord(BaseModel):
    step: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: Optional[float] = None
    latency_ms: int = 0
    ts: str = ""


# ---------- research ----------
class SeriesPoint(BaseModel):
    year: int
    value: float
    source_url: str = ""


class ProjectedPoint(BaseModel):
    year: int
    value: float
    low: float
    high: float


class Series(BaseModel):
    id: str
    metric: str
    unit: str = ""
    region: str = ""
    historical: list[SeriesPoint] = Field(default_factory=list)
    projected: list[ProjectedPoint] = Field(default_factory=list)
    method: str = ""
    annual_growth_pct: Optional[float] = None
    growth_source_url: Optional[str] = None


class Finding(BaseModel):
    text: str
    source_url: str = ""
    dimensions: list[str] = Field(default_factory=list)


class Research(BaseModel):
    queries: list[str] = Field(default_factory=list)
    series: list[Series] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)


# ---------- scenarios ----------
class Milestone(BaseModel):
    year: int
    text: str


class DeltaEntry(BaseModel):
    to: float
    rationale: str = ""


class SeriesRef(BaseModel):
    series_id: str
    adjustment: Optional[str] = None


class Scenario(BaseModel):
    id: str = ""
    title: str
    one_liner: str = ""
    narrative: str = ""
    archetype: str = ""
    target_dimension: str = ""
    model: str = ""
    milestones: list[Milestone] = Field(default_factory=list)
    first_steps: list[str] = Field(default_factory=list)
    profile_delta: dict[str, DeltaEntry] = Field(default_factory=dict)
    series_refs: list[SeriesRef] = Field(default_factory=list)
    upside: str = ""
    risks: list[str] = Field(default_factory=list)
    confidence: str = "med"
    sources: list[str] = Field(default_factory=list)


class ParentContext(BaseModel):
    chosen_scenario: Optional[Scenario] = None
    parent_findings_summary: Optional[str] = None


# ---------- requests ----------
class IntakeRequest(BaseModel):
    messages: list[Message]
    profile: Profile
    parent_context: Optional[ParentContext] = None
    settings: Settings
    turns_answered: int = 0


class ResearchRequest(BaseModel):
    profile: Profile
    parent_context: Optional[ParentContext] = None
    settings: Settings


class ScenariosRequest(BaseModel):
    profile: Profile
    research: Research
    parent_context: Optional[ParentContext] = None
    settings: Settings


# ---------- LLM output shapes ----------
class IntakeOut(BaseModel):
    assistant_message: str
    profile: Profile


class QueryPlanOut(BaseModel):
    queries: list[str]


class ExtractSeries(BaseModel):
    id: str
    metric: str
    unit: str = ""
    region: str = ""
    points: list[SeriesPoint]
    annual_growth_pct: Optional[float] = None
    growth_source_url: Optional[str] = None


class ExtractOut(BaseModel):
    series: list[ExtractSeries] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)


class Skeleton(BaseModel):
    title: str
    archetype: str
    target_dimension: str
    brief: str


class PlanOut(BaseModel):
    weakest_dimension: str
    skeletons: list[Skeleton]
