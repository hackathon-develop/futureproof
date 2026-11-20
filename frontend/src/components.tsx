import { useEffect, useRef, useState } from "react";
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useStore } from "./store";
import { DIMENSIONS, DIM_LABEL } from "./types";
import type { DimensionKey, ExplorationNode, Profile, Scenario, Series, UsageRecord } from "./types";

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const shortModel = (m: string) => m.split(/[:/]/).pop() ?? m;

/* ---------------- Radar ---------------- */
export function ProfileRadar({ profile, after, small }: { profile: Profile; after?: Scenario | null; small?: boolean }) {
  const data = DIMENSIONS.map((d) => ({
    dim: small ? DIM_LABEL[d].split(" ")[0] : DIM_LABEL[d],
    now: profile.dimensions[d]?.score ?? 5,
    after: after?.profile_delta?.[d]?.to,
  }));
  return (
    <ResponsiveContainer width="100%" height={small ? 160 : 240}>
      <RadarChart data={data} outerRadius={small ? "65%" : "70%"}>
        <PolarGrid stroke="var(--grid)" />
        <PolarAngleAxis dataKey="dim" tick={{ fill: "var(--muted)", fontSize: small ? 10 : 12 }} />
        <PolarRadiusAxis domain={[0, 10]} tick={false} axisLine={false} />
        <Radar name="Now" dataKey="now" stroke="var(--c1)" fill="var(--c1)" fillOpacity={0.25} />
        {after && <Radar name="After path" dataKey="after" stroke="var(--c2)" fill="var(--c2)" fillOpacity={0.2} />}
        {after && !small && <Legend />}
      </RadarChart>
    </ResponsiveContainer>
  );
}

export function ProfilePanel({ node }: { node: ExplorationNode }) {
  const hover = useStore((s) => s.hover);
  const p = node.profile;
  return (
    <section className="panel">
      <h3>Power profile</h3>
      <ProfileRadar profile={p} after={hover} />
      <ul className="dims">
        {DIMENSIONS.map((d) => (
          <li key={d} title={p.dimensions[d]?.evidence}>
            <span>{DIM_LABEL[d]}</span>
            <span className="score">{p.dimensions[d]?.score ?? "–"}<small> /10</small></span>
            <span className="conf" style={{ width: `${(p.dimensions[d]?.confidence ?? 0) * 100}%` }} />
          </li>
        ))}
      </ul>
      <dl className="facts">
        {p.question && <><dt>Question</dt><dd>{p.question}</dd></>}
        {p.current_role && <><dt>Role</dt><dd>{p.current_role}{p.years_experience ? ` · ${p.years_experience} yrs` : ""}</dd></>}
        {p.location && <><dt>Location</dt><dd>{p.location}</dd></>}
        {p.skills.length > 0 && <><dt>Skills</dt><dd>{p.skills.join(", ")}</dd></>}
        {p.time_horizon_years && <><dt>Horizon</dt><dd>{p.time_horizon_years} years</dd></>}
      </dl>
    </section>
  );
}

/* ---------------- Usage ---------------- */
function sum(u: UsageRecord[]) {
  return u.reduce((a, r) => ({ t: a.t + r.prompt_tokens + r.completion_tokens, c: a.c + (r.cost_usd ?? 0), unk: a.unk || r.cost_usd == null }), { t: 0, c: 0, unk: false });
}
export function UsagePanel({ node }: { node: ExplorationNode }) {
  const nodes = useStore((s) => s.exploration.nodes);
  const all = Object.values(nodes).flatMap((n) => n.usage);
  const rows = new Map<string, { step: string; model: string; pt: number; ct: number; c: number; ms: number; n: number }>();
  for (const r of node.usage) {
    const k = r.step + "|" + r.model;
    const e = rows.get(k) ?? { step: r.step, model: r.model, pt: 0, ct: 0, c: 0, ms: 0, n: 0 };
    e.pt += r.prompt_tokens; e.ct += r.completion_tokens; e.c += r.cost_usd ?? 0; e.ms += r.latency_ms; e.n++;
    rows.set(k, e);
  }
  const ns = sum(node.usage), ss = sum(all);
  return (
    <section className="panel">
      <h3>Token usage</h3>
      <table className="usage">
        <thead><tr><th>Step</th><th>Model</th><th>Tokens</th><th>$</th></tr></thead>
        <tbody>
          {[...rows.values()].map((r) => (
            <tr key={r.step + r.model} title={`${r.n} call(s), ${(r.ms / 1000).toFixed(1)}s, in ${r.pt} / out ${r.ct}`}>
              <td>{r.step}</td><td>{shortModel(r.model)}</td><td>{(r.pt + r.ct).toLocaleString()}</td><td>{r.c.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals">
        <div>This step: <b>{ns.t.toLocaleString()}</b> tok · <b>${ns.c.toFixed(4)}</b></div>
        <div>Session: <b>{ss.t.toLocaleString()}</b> tok · <b>${ss.c.toFixed(4)}</b>{ss.unk && <small> (some costs unknown)</small>}</div>
      </div>
    </section>
  );
}

/* ---------------- Tree ---------------- */
export function Tree() {
  const { exploration, setActive, explore } = useStore();
  const nodes = exploration.nodes;
  const children = (id: string) => Object.values(nodes).filter((n) => n.parent_id === id);
  const render = (n: ExplorationNode, depth: number): React.ReactNode => {
    const kids = children(n.id);
    return (
      <li key={n.id}>
        <button className={"tnode" + (n.id === exploration.active_node_id ? " active" : "")} onClick={() => setActive(n.id)}>
          {n.chosen_scenario ? n.chosen_scenario.title : "Start"}
          <small>{n.phase}</small>
        </button>
        {(n.scenarios.length > 0 || kids.length > 0) && (
          <ul>
            {n.scenarios.map((s) => {
              const child = kids.find((k) => k.chosen_scenario_id === s.id);
              return child ? render(child, depth + 1) : (
                <li key={s.id}>
                  <button className="tleaf" onClick={() => explore(n.id, s.id)} title="Explore this path">{s.title}</button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };
  return (
    <section className="panel">
      <h3>Exploration tree</h3>
      <ul className="tree">{render(nodes[exploration.root_id], 0)}</ul>
    </section>
  );
}

/* ---------------- Chat ---------------- */
export function Chat({ node }: { node: ExplorationNode }) {
  const { sendMessage, runResearchAndScenarios, busy } = useStore();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [node.messages.length, busy]);
  const suff = node.sufficiency;
  const canGo = suff && (suff.ready || suff.can_force);
  const submit = () => { if (!text.trim() || busy) return; void sendMessage(text.trim()); setText(""); };
  return (
    <div className="chat">
      {node.chosen_scenario && (
        <div className="context">Exploring further: <b>{node.chosen_scenario.title}</b> — {node.chosen_scenario.one_liner}</div>
      )}
      <div className="msgs">
        {node.messages.length === 0 && !busy && (
          <div className="empty">
            <p>Tell me about your work situation and what you want to explore about your future career.</p>
            <button onClick={() => sendMessage(null)}>Start interview</button>
          </div>
        )}
        {node.messages.map((m, i) => <div key={i} className={"msg " + m.role}>{m.content}</div>)}
        {busy && <div className="msg assistant typing">{busy}</div>}
        <div ref={endRef} />
      </div>
      {suff && (
        <div className="suff">
          {suff.ready ? <span className="ok">Enough information to research.</span>
            : <span>Still useful: {suff.missing.slice(0, 4).join(", ")}{suff.missing.length > 4 ? "…" : ""}</span>}
          {canGo && (
            <button className={suff.ready ? "primary" : ""} disabled={!!busy} onClick={runResearchAndScenarios}>
              {suff.ready ? "Research & draft futures →" : "Proceed anyway →"}
            </button>
          )}
        </div>
      )}
      <div className="composer">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer…" rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button className="primary" disabled={!!busy || !text.trim()} onClick={submit}>Send</button>
      </div>
    </div>
  );
}

/* ---------------- Series chart ---------------- */
export function SeriesChart({ s, height = 220, mini }: { s: Series; height?: number; mini?: boolean }) {
  const last = s.historical[s.historical.length - 1];
  const data = [
    ...s.historical.map((p) => ({ year: p.year, hist: p.value, proj: p === last ? p.value : undefined, band: p === last ? [p.value, p.value] : undefined })),
    ...s.projected.map((p) => ({ year: p.year, proj: p.value, band: [p.low, p.high] })),
  ];
  return (
    <div className="series">
      {!mini && <div className="stitle">{s.metric} <small>{s.unit}{s.region ? ` · ${s.region}` : ""} · {s.method}</small></div>}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: mini ? -30 : 0, bottom: 0 }}>
          {!mini && <CartesianGrid stroke="var(--grid)" strokeDasharray="3 3" />}
          <XAxis dataKey="year" tick={{ fill: "var(--muted)", fontSize: 11 }} hide={mini} />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} hide={mini} width={60} domain={["auto", "auto"]} />
          {!mini && <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)" }} />}
          <Area dataKey="band" stroke="none" fill="var(--c2)" fillOpacity={0.18} name="Uncertainty" isAnimationActive={false} />
          <Line dataKey="hist" stroke="var(--c1)" strokeWidth={2} dot={!mini || s.historical.length < 3} name="Historical" isAnimationActive={false} />
          <Line dataKey="proj" stroke="var(--c2)" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Extrapolated" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {!mini && (
        <div className="srcs">
          Sources: {[...new Set([...s.historical.map((p) => p.source_url), ...(s.growth_source_url ? [s.growth_source_url] : [])])].map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{host(u)}</a>)}
          <em> Indicative extrapolation from web data, not a forecast.</em>
        </div>
      )}
    </div>
  );
}

/* ---------------- Research ---------------- */
export function ResearchView({ node }: { node: ExplorationNode }) {
  const r = node.research;
  const [open, setOpen] = useState(node.phase !== "scenarios");
  if (!r) return null;
  return (
    <section className="research">
      <h2 onClick={() => setOpen(!open)} className="toggle">{open ? "▾" : "▸"} Research grounding <small>{r.series.length} trends · {r.findings.length} findings</small></h2>
      {open && (
        <>
          <div className="queries">{r.queries.map((q) => <span key={q} className="chip">{q}</span>)}</div>
          {r.series.length === 0 && <p className="muted">No reliable numeric trend found in web results — scenarios are based on qualitative findings.</p>}
          <div className="grid2">{r.series.map((s) => <SeriesChart key={s.id} s={s} />)}</div>
          <ul className="findings">
            {r.findings.map((f, i) => (
              <li key={i}>{f.text} <a href={f.source_url} target="_blank" rel="noreferrer">{host(f.source_url)}</a>
                {f.dimensions.map((d) => <span key={d} className="chip small">{DIM_LABEL[d as DimensionKey]?.split(" ")[0] ?? d}</span>)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ---------------- Scenarios ---------------- */
export function ScenarioCard({ node, s }: { node: ExplorationNode; s: Scenario }) {
  const { explore, setHover, busy } = useStore();
  const [open, setOpen] = useState(false);
  const series = node.research?.series.find((x) => s.series_refs.some((r) => r.series_id === x.id));
  return (
    <article className={"card" + (open ? " open" : "")} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(null)}>
      <header>
        <span className="badge">{shortModel(s.model)}</span>
        <span className={"chip conf-" + s.confidence}>{s.confidence} confidence</span>
        {node.weakest_dimension === s.target_dimension && <span className="chip weak">targets weakest: {DIM_LABEL[s.target_dimension as DimensionKey]?.split(" ")[0]}</span>}
      </header>
      <h3>{s.title}</h3>
      <p className="one">{s.one_liner}</p>
      <div className="cardviz">
        <div><ProfileRadar profile={node.profile} after={s} small /></div>
        {series && <div><SeriesChart s={series} height={110} mini /><small className="muted">{series.metric}</small></div>}
      </div>
      {open && (
        <div className="detail">
          <p>{s.narrative}</p>
          <h4>Milestones</h4>
          <ol className="miles">{s.milestones.map((m, i) => <li key={i}><b>Year {m.year}</b> {m.text}</li>)}</ol>
          <h4>First 90 days</h4>
          <ul>{s.first_steps.map((x, i) => <li key={i}>{x}</li>)}</ul>
          <h4>Power shift</h4>
          <ul className="delta">
            {DIMENSIONS.map((d) => {
              const from = node.profile.dimensions[d]?.score ?? 5, to = s.profile_delta[d]?.to ?? from;
              return <li key={d}><b>{DIM_LABEL[d]}</b> {from} → {to} <span className={to > from ? "up" : to < from ? "down" : ""}>{to > from ? "▲" : to < from ? "▼" : "•"}</span> <small>{s.profile_delta[d]?.rationale}</small></li>;
            })}
          </ul>
          <h4>Upside</h4><p>{s.upside}</p>
          <h4>Risks</h4><ul>{s.risks.map((x, i) => <li key={i}>{x}</li>)}</ul>
          {s.series_refs.filter((r) => r.adjustment).map((r) => <p key={r.series_id} className="muted"><b>{r.series_id}:</b> {r.adjustment}</p>)}
          {series && <SeriesChart s={series} />}
          {s.sources.length > 0 && <p className="srcs">Sources: {s.sources.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{host(u)}</a>)}</p>}
        </div>
      )}
      <footer>
        <button onClick={() => setOpen(!open)}>{open ? "Less" : "Details"}</button>
        <button className="primary" disabled={!!busy} onClick={() => explore(node.id, s.id)}>Explore this path →</button>
      </footer>
    </article>
  );
}
