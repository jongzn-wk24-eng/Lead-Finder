import type { Company } from "@workspace/api-client-react";

function date(value?: string | null) {
  return value ? new Date(value).toLocaleDateString("en-MY") : "no date";
}
export function actionLabel(value: string) {
  return value.replace(/^Sent #/, "Marked sent #").replace(/^Hero sent$/, "Hero marked sent");
}
export function DataLayers({ company: c }: { company: Company }) {
  const fetched = c.googleUpdatedAt ? new Date(c.googleUpdatedAt).getTime() : NaN;
  const days = Number.isFinite(fetched) ? Math.max(0, Math.floor((Date.now() - fetched) / 86400000)) : null;
  const status = c.automatedCheckStatus;
  const check = status === "completed" ? "ok" : status === "failed" ? "failed" : status === "pending" ? "pending" : "not available";
  return <div className="mt-3 grid gap-1 text-[11px] leading-5 text-muted-foreground" data-testid={`data-layers-${c.id}`}>
    <div><strong>Google data:</strong> {c.source === "google_places" ? `${days == null ? "not fetched" : `fetched ${days} days ago`}${days != null && days >= 30 ? " · Stale" : ""} · stale after 30 days · live-only fields` : c.source === "demo" ? "demo, not a Google listing" : c.osmId ? "not Google · legacy OpenStreetMap" : "not available · manual record"}</div>
    <div><strong>Automated checks:</strong> {check} · {date(c.automatedCheckedAt)}{c.source === "demo" ? " · simulated" : ""}</div>
    <div><span className="mr-1 rounded border border-border px-1 font-bold text-primary">AI</span><strong>AI results:</strong> {c.aiModel ? `${c.aiModel} · ${date(c.aiGeneratedAt)}` : c.source === "demo" ? "simulated; no model used" : "not available; no recorded model"}{c.aiStatus === "pending" ? " · pending" : c.aiStatus === "failed" ? " · failed" : ""}</div>
    <div><strong>My actions:</strong> self-reported · {actionLabel(c.status)} · not a delivery receipt</div>
  </div>;
}

function Pill({ label, tone, title }: { label: string; tone: "google" | "check" | "ai" | "self"; title: string }) {
  const tones = { google: "bg-[#e8eef9] text-[#2c4f8a]", check: "bg-[#eaf6da] text-[#0F3D1E]", ai: "bg-[#0F3D1E] text-[#B6F06E]", self: "bg-[#f4ece0] text-[#7a5a22]" };
  return <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.06em] ${tones[tone]}`}>{label}</span>;
}
export function SourceBadges({ company: c }: { company: Company }) {
  return <div className="mt-1 flex flex-wrap gap-1" data-testid={`badges-source-${c.id}`}>
    {c.source === "google_places" && <Pill label="Google" tone="google" title="Live-only Google Places fields" />}
    {c.automatedCheckStatus === "completed" && <Pill label="Checked" tone="check" title="Automated website check completed" />}
    {c.aiModel && <Pill label="AI" tone="ai" title={`AI result from ${c.aiModel}`} />}
    <Pill label="Self-reported" tone="self" title="Your actions are self-reported, not delivery receipts" />
  </div>;
}
