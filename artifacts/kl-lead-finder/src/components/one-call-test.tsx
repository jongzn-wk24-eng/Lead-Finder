import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDemoMode } from "./data-mode";

type Place = {
  id: number; placeId: string; isNew: boolean; name: string; address: string;
  phone: string | null; websiteUrl: string | null; mapsUrl: string | null;
  rating: number | null; reviewCount: number | null;
  attributions: Array<{ provider?: string; providerUri?: string }>;
};
export function OneCallTest() {
  const demo = useDemoMode();
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("dental clinic");
  const [area, setArea] = useState("Bangsar");
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (demo) return null;
  const run = async () => {
    if (!window.confirm("Run exactly one paid Google Places Text Search request now? No website checks, Gemini or Place Details calls will run.")) return;
    setBusy(true); setError(""); setResults(null);
    try {
      const response = await fetch("/api/search/test", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: [keyword.trim()], areas: [area.trim()] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Test failed.");
      setResults(body.results);
      await qc.invalidateQueries();
    } catch (err) { setError(err instanceof Error ? err.message : "Test failed."); }
    finally { setBusy(false); }
  };
  return <section className="mb-5 rounded-[24px] bg-card p-6 shadow-[0_8px_30px_rgba(15,61,30,.06)]">
    <h2 className="font-display text-lg font-bold">Find leads · one-call real test</h2>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Exactly 1 keyword × 1 area = 1 Places Text Search request. No pagination, Place Details, website checks or Gemini calls. Only Place IDs and your search context are saved; this live preview clears when you leave.</p>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs">Keyword<input className="rounded-full border border-border bg-background px-4 py-2 text-sm" value={keyword} onChange={e => setKeyword(e.target.value)} maxLength={100} /></label>
      <label className="grid gap-1 text-xs">Area<input className="rounded-full border border-border bg-background px-4 py-2 text-sm" value={area} onChange={e => setArea(e.target.value)} maxLength={100} /></label>
      <button className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={busy || !keyword.trim() || !area.trim()} onClick={run}>{busy ? "Running…" : "Run one-call test (1 Places call)"}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error} Any attempted Google request is counted, including failures.</p>}
    {results && <div className="mt-4">
      <p className="text-sm font-semibold">1 search request · {results.length} unique places · {results.filter(r => r.isNew).length} new · {results.filter(r => !r.isNew).length} already saved</p>
      <p className="mt-1 text-xs text-muted-foreground">Check the dashboard counter increased by 1. A deliberate second test costs another call and should report existing Place IDs rather than duplicates.</p>
      <div className="mt-3 max-h-96 space-y-3 overflow-auto">
        {results.map(p => <article key={p.placeId} className="rounded-2xl border border-border p-3 text-xs leading-6">
          <strong>{p.name || "No name returned"}</strong> · {p.isNew ? "New Place ID" : "Already saved (deduped)"}
          <div>Place ID: {p.placeId}</div><div>Address: {p.address || "Not provided"}</div>
          <div>Phone: {p.phone || "Not provided"}</div><div>Website: {p.websiteUrl || "Not provided"}</div>
          <div>Maps URL: {p.mapsUrl || "Not provided"}</div><div>Rating: {p.rating ?? "Not provided"} · Review count: {p.reviewCount ?? "Not provided"}</div>
          <div>Google data: fetched now · stale after 30 days</div><div>Automated checks: not available · AI: not available · My actions: self-reported, none yet</div>
          <div><a href="https://maps.google.com" target="_blank" rel="noreferrer" translate="no" className="text-[12px] font-normal text-[#5e5e5e]">Google Maps</a>{p.attributions.map((a,i) => <span key={i}> · {a.provider}</span>)}</div>
        </article>)}
      </div>
    </div>}
  </section>;
}
