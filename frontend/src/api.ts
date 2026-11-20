async function req<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api${path}`, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r.json();
}

export const api = {
  models: () => req<{ models: { id: string; provider: string }[] }>("/models"),
  defaults: () => req<import("./types").Settings>("/defaults"),
  intake: (body: unknown) => req<any>("/intake/turn", body),
  research: (body: unknown) => req<any>("/research", body),
  scenarios: (body: unknown) => req<any>("/scenarios", body),
};
