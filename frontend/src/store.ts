import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "./api";
import { emptyProfile } from "./types";
import type { Exploration, ExplorationNode, Message, Profile, Scenario, Settings } from "./types";

const uid = () => Math.random().toString(36).slice(2, 10);

function newNode(parent: ExplorationNode | null, scenario: Scenario | null): ExplorationNode {
  return {
    id: uid(), parent_id: parent?.id ?? null,
    chosen_scenario_id: scenario?.id ?? null, chosen_scenario: scenario,
    phase: "intake", messages: [], turns_answered: 0, sufficiency: null,
    profile: parent ? (JSON.parse(JSON.stringify(parent.profile)) as Profile) : emptyProfile(),
    research: null, scenarios: [], weakest_dimension: null, usage: [],
  };
}

function newExploration(): Exploration {
  const root = newNode(null, null);
  return { version: 1, id: uid(), created_at: new Date().toISOString(), root_id: root.id, active_node_id: root.id, nodes: { [root.id]: root } };
}

interface State {
  exploration: Exploration;
  settings: Settings;
  busy: string | null;
  error: string | null;
  hover: Scenario | null;
  setSettings: (s: Partial<Settings>) => void;
  setHover: (s: Scenario | null) => void;
  reset: () => void;
  importJson: (e: Exploration) => void;
  setActive: (id: string) => void;
  sendMessage: (text: string | null) => Promise<void>;
  runResearchAndScenarios: () => Promise<void>;
  regenerateScenarios: () => Promise<void>;
  explore: (nodeId: string, scenarioId: string) => void;
  clearError: () => void;
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const patch = (id: string, p: Partial<ExplorationNode>) =>
        set((s) => ({
          exploration: { ...s.exploration, nodes: { ...s.exploration.nodes, [id]: { ...s.exploration.nodes[id], ...p } } },
        }));
      const node = (id: string) => get().exploration.nodes[id];
      const parentContext = (n: ExplorationNode) => {
        if (!n.chosen_scenario) return null;
        const parent = n.parent_id ? node(n.parent_id) : null;
        return {
          chosen_scenario: n.chosen_scenario,
          parent_findings_summary: parent?.research?.findings.slice(0, 6).map((f) => f.text).join(" | ") ?? null,
        };
      };
      const guard = async (label: string, fn: () => Promise<void>) => {
        set({ busy: label, error: null });
        try { await fn(); } catch (e) { set({ error: (e as Error).message }); } finally { set({ busy: null }); }
      };

      return {
        exploration: newExploration(),
        settings: { fast_model: "", strong_model: "", scenario_models: [], n_scenarios: 4 },
        busy: null, error: null, hover: null,
        setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
        setHover: (hover) => set({ hover }),
        reset: () => set({ exploration: newExploration(), error: null, hover: null }),
        importJson: (e) => {
          if (e?.version !== 1 || !e.nodes || !e.root_id) throw new Error("Not a valid exploration file");
          set({ exploration: e, error: null });
        },
        setActive: (id) => set((s) => ({ exploration: { ...s.exploration, active_node_id: id }, hover: null })),
        clearError: () => set({ error: null }),

        sendMessage: async (text) => {
          const id = get().exploration.active_node_id;
          const n = node(id);
          const messages: Message[] = text ? [...n.messages, { role: "user", content: text }] : n.messages;
          const turns = n.turns_answered + (text ? 1 : 0);
          patch(id, { messages, turns_answered: turns });
          await guard("Thinking…", async () => {
            const r = await api.intake({
              messages, profile: n.profile, parent_context: parentContext(n), settings: get().settings, turns_answered: turns,
            });
            patch(id, {
              messages: [...messages, { role: "assistant", content: r.assistant_message }],
              profile: r.profile, sufficiency: r.sufficiency, usage: [...node(id).usage, ...r.usage],
            });
          });
        },

        runResearchAndScenarios: async () => {
          const id = get().exploration.active_node_id;
          const n = node(id);
          patch(id, { phase: "research" });
          await guard("Searching the web & extracting trends…", async () => {
            const r = await api.research({ profile: n.profile, parent_context: parentContext(n), settings: get().settings });
            patch(id, { research: r.research, usage: [...node(id).usage, ...r.usage] });
          });
          if (!node(id).research) { patch(id, { phase: "intake" }); return; }
          await get().regenerateScenarios();
        },

        regenerateScenarios: async () => {
          const id = get().exploration.active_node_id;
          const n = node(id);
          const k = new Set(get().settings.scenario_models).size || 1;
          await guard(`Drafting scenarios with ${k} model${k > 1 ? "s" : ""}…`, async () => {
            const r = await api.scenarios({
              profile: n.profile, research: n.research, parent_context: parentContext(n), settings: get().settings,
            });
            patch(id, { scenarios: r.scenarios, weakest_dimension: r.weakest_dimension, phase: "scenarios", usage: [...node(id).usage, ...r.usage] });
          });
        },

        explore: (nodeId, scenarioId) => {
          const parent = node(nodeId);
          const sc = parent.scenarios.find((s) => s.id === scenarioId)!;
          const existing = Object.values(get().exploration.nodes).find((x) => x.parent_id === nodeId && x.chosen_scenario_id === scenarioId);
          if (existing) { get().setActive(existing.id); return; }
          const child = newNode(parent, sc);
          set((s) => ({
            exploration: { ...s.exploration, active_node_id: child.id, nodes: { ...s.exploration.nodes, [child.id]: child } },
            hover: null,
          }));
          void get().sendMessage(null);
        },
      };
    },
    { name: "career-futures", partialize: (s) => ({ exploration: s.exploration, settings: s.settings }) },
  ),
);
