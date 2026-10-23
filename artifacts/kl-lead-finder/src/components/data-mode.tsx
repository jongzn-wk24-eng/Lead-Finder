import { createContext, useContext, useState, type ReactNode } from "react";
import { useGetSettings } from "@workspace/api-client-react";

const DemoContext = createContext(false);
export const useDemoMode = () => useContext(DemoContext);

export function DataModeBoundary({ children }: { children: ReactNode }) {
  const settings = useGetSettings();
  if (settings.isLoading) return <p className="p-8">Loading data mode…</p>;
  if (settings.isError || !settings.data) return <div role="alert" className="p-8">Could not load data mode. <button className="underline" onClick={() => settings.refetch()}>Retry</button></div>;
  return <DemoContext.Provider value={settings.data.demoMode}>{children}</DemoContext.Provider>;
}

export function DataModeBanner() {
  const demo = useDemoMode();
  return demo ? <div role="alert" data-testid="demo-banner" className="border-b border-red-800 bg-red-700 px-5 py-3 text-center font-bold text-white">DEMO DATA — fictional businesses, checks and self-reported actions. No messages were sent.</div> : null;
}

export function DemoControls() {
  const demo = useDemoMode();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async (action: "toggle" | "load" | "delete") => {
    if (action === "delete" && !window.confirm("Delete all demo businesses and their demo records? Real records will not be deleted. This cannot be undone.")) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(action === "toggle" ? "/api/settings" : action === "load" ? "/api/demo-data" : "/api/sample-data", {
        method: action === "toggle" ? "PATCH" : action === "load" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: action === "toggle" ? JSON.stringify({ demoMode: !demo }) : undefined,
      });
      if (!response.ok) throw new Error((await response.json()).error || "Could not update demo data.");
      // Full navigation clears all previous-mode query caches, drafts and previews.
      window.location.assign("/settings");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Update failed."); setBusy(false); }
  };
  return <section className="mb-5 rounded-[24px] bg-card p-6 shadow-[0_8px_30px_rgba(15,61,30,.06)]">
    <h2 className="font-display text-lg font-bold">Data mode</h2>
    <p className="mt-2 text-sm text-muted-foreground">Real mode is the default. Demo records are isolated from real leads, statistics and exports. Demo mode makes no external research or AI calls.</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button role="switch" aria-checked={demo} disabled={busy} onClick={() => run("toggle")} className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold">Demo mode: {demo ? "ON" : "OFF"}</button>
      <button disabled={busy} onClick={() => run("load")} className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold">Load demo data</button>
      <button disabled={busy} onClick={() => run("delete")} className="rounded-full border border-red-300 px-4 py-2 text-sm font-semibold text-red-700">Delete all demo data</button>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">Loading is explicit and repeatable; it does not enable Demo mode. Deleting demo data never empties real records. Records use persistent PostgreSQL; screenshots use private App Storage.</p>
    {message && <p role="alert" className="mt-3 text-sm text-red-700">{message}</p>}
  </section>;
}

export function RealEmptyState() {
  const demo = useDemoMode();
  return <div className="my-5 rounded-[24px] bg-card p-6 shadow-[0_8px_30px_rgba(15,61,30,.06)]" data-testid="real-empty-state">
    <h2 className="font-display text-xl font-bold">{demo ? "No demo leads. Load demo data in Settings." : "No real leads yet. Run Find leads"}</h2>
    {!demo && <p className="mt-2 text-sm text-muted-foreground">1 keyword × 1 area = 1 Places Text Search call. The one-call test does not run Place Details or website checks. The full research flow may use additional Places and Gemini calls.</p>}
  </div>;
}
