import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Chat, ProfilePanel, ResearchView, ScenarioCard, Tree, UsagePanel } from "./components";
import { useStore } from "./store";
import type { Exploration } from "./types";

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useStore();
  const [models, setModels] = useState<{ id: string; provider: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.models().then((r) => setModels(r.models)).catch((e) => setErr(e.message)); }, []);
  const toggle = (id: string) => {
    const cur = settings.scenario_models;
    setSettings({ scenario_models: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const Sel = ({ k, label, hint }: { k: "fast_model" | "strong_model"; label: string; hint: string }) => (
    <label className="field">
      <span>{label} <small>{hint}</small></span>
      <select value={settings[k]} onChange={(e) => setSettings({ [k]: e.target.value })}>
        <option value="">— choose —</option>
        {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
      </select>
    </label>
  );
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Model routing</h2>
        {err && <p className="error">{err}</p>}
        <Sel k="fast_model" label="Fast model" hint="intake chat, search planning" />
        <Sel k="strong_model" label="Strong model" hint="data extraction, scenario planning, fallback" />
        <div className="field">
          <span>Scenario writers <small>each scenario is written by a different model (round-robin)</small></span>
          <div className="mlist">
            {models.map((m) => (
              <label key={m.id}><input type="checkbox" checked={settings.scenario_models.includes(m.id)} onChange={() => toggle(m.id)} /> {m.id}</label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Number of scenarios: {settings.n_scenarios}</span>
          <input type="range" min={3} max={5} value={settings.n_scenarios} onChange={(e) => setSettings({ n_scenarios: +e.target.value })} />
        </label>
        <div className="right"><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

export default function App() {
  const { exploration, settings, setSettings, reset, importJson, error, clearError, busy, regenerateScenarios } = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const node = exploration.nodes[exploration.active_node_id];

  useEffect(() => {
    if (!settings.fast_model || !settings.strong_model) {
      api.defaults().then((d) => {
        if (d.fast_model) setSettings({ ...d, ...Object.fromEntries(Object.entries(settings).filter(([, v]) => (Array.isArray(v) ? v.length : v))) });
        else setShowSettings(true);
      }).catch(() => setShowSettings(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exploration, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `career-exploration-${exploration.id}.json`;
    a.click();
  };
  const onImport = async (f: File) => {
    try { importJson(JSON.parse(await f.text()) as Exploration); } catch (e) { alert((e as Error).message); }
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Career Futures <span>Explorer</span></div>
        <div className="actions">
          <button onClick={() => { if (confirm("Start a new exploration? The current one is lost unless exported.")) reset(); }}>New</button>
          <button onClick={exportJson}>Export JSON</button>
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <button onClick={() => setShowSettings(true)} title="Model settings">⚙ Models</button>
        </div>
      </header>
      {error && <div className="error bar" onClick={clearError}>⚠ {error} <small>(click to dismiss)</small></div>}
      <main className="cols">
        <aside className="left"><Tree /></aside>
        <section className="center">
          {node.phase === "intake" && <Chat node={node} />}
          {node.phase !== "intake" && (
            <>
              {node.chosen_scenario && <div className="context">Exploring further: <b>{node.chosen_scenario.title}</b></div>}
              {busy && <div className="busy"><span className="spinner" /> {busy}</div>}
              <ResearchView node={node} />
              {node.scenarios.length > 0 && (
                <section>
                  <h2>Possible futures <small>pick one to explore further</small>
                    <button className="ghost" disabled={!!busy} onClick={regenerateScenarios}>↻ Regenerate</button></h2>
                  <div className="cards">{node.scenarios.map((s) => <ScenarioCard key={s.id} node={node} s={s} />)}</div>
                </section>
              )}
            </>
          )}
        </section>
        <aside className="right">
          <ProfilePanel node={node} />
          <UsagePanel node={node} />
        </aside>
      </main>
      <footer className="disclaimer">Exploration aid, not career or financial advice. Trends are indicative extrapolations from web data.</footer>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
