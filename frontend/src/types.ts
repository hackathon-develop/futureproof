export type DimensionKey = "ownership" | "trust" | "responsibility" | "judgment";
export const DIMENSIONS: DimensionKey[] = ["ownership", "trust", "responsibility", "judgment"];
export const DIM_LABEL: Record<DimensionKey, string> = {
  ownership: "Ownership",
  trust: "Trust & Relationships",
  responsibility: "Responsibility",
  judgment: "Judgment & Taste",
};

export interface DimensionScore { score: number; confidence: number; evidence: string }

export interface Profile {
  question: string | null;
  time_horizon_years: number | null;
  current_role: string | null;
  industry: string | null;
  years_experience: number | null;
  location: string | null;
  employment_status: string | null;
  skills: string[];
  education: string | null;
  constraints: string[];
  dimensions: Record<DimensionKey, DimensionScore>;
}

export interface SeriesPoint { year: number; value: number; source_url: string }
export interface Series {
  id: string; metric: string; unit: string; region: string;
  historical: SeriesPoint[];
  projected: { year: number; value: number; low: number; high: number }[];
  method: string;
  annual_growth_pct?: number | null; growth_source_url?: string | null;
}
export interface Finding { text: string; source_url: string; dimensions: DimensionKey[] }
export interface Research { queries: string[]; series: Series[]; findings: Finding[] }

export interface Scenario {
  id: string; title: string; one_liner: string; narrative: string;
  archetype: string; target_dimension: string; model: string;
  milestones: { year: number; text: string }[];
  first_steps: string[];
  profile_delta: Record<DimensionKey, { to: number; rationale: string }>;
  series_refs: { series_id: string; adjustment?: string | null }[];
  upside: string; risks: string[]; confidence: string;
  sources: string[];
}

export interface UsageRecord {
  step: string; model: string; prompt_tokens: number; completion_tokens: number;
  cost_usd: number | null; latency_ms: number; ts: string;
}

export interface Sufficiency { ready: boolean; missing: string[]; can_force: boolean }

export interface Message { role: "user" | "assistant"; content: string }

export interface ExplorationNode {
  id: string; parent_id: string | null; chosen_scenario_id: string | null;
  chosen_scenario: Scenario | null;
  phase: "intake" | "research" | "scenarios";
  messages: Message[];
  turns_answered: number;
  sufficiency: Sufficiency | null;
  profile: Profile;
  research: Research | null;
  scenarios: Scenario[];
  weakest_dimension: string | null;
  usage: UsageRecord[];
}

export interface Settings {
  fast_model: string; strong_model: string; scenario_models: string[]; n_scenarios: number;
}

export interface Exploration {
  version: 1; id: string; created_at: string;
  root_id: string; active_node_id: string;
  nodes: Record<string, ExplorationNode>;
}

export const emptyProfile = (): Profile => ({
  question: null, time_horizon_years: null, current_role: null, industry: null,
  years_experience: null, location: null, employment_status: null, skills: [],
  education: null, constraints: [],
  dimensions: {
    ownership: { score: 5, confidence: 0, evidence: "" },
    trust: { score: 5, confidence: 0, evidence: "" },
    responsibility: { score: 5, confidence: 0, evidence: "" },
    judgment: { score: 5, confidence: 0, evidence: "" },
  },
});
