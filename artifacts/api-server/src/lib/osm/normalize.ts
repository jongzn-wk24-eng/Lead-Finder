import type { AreaCentre, Category } from "./defaults";
export type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
export type NormalizedBusiness = {
  osmType: string; osmId: string; name: string; nameEn: string | null; websiteUrl: string | null;
  socialUrl: string | null; websiteType: string; email: string | null; phone: string | null;
  phones: string[]; phoneIsMobile: boolean; whatsapp: string | null; whatsappDerived: boolean;
  address: string; area: string; keyword: string; lat: number; lng: number; premium: boolean;
  brand: string; operator: string; groupName: string; openingHours: string | null;
  tags: Record<string, string>;
};
export function normalizePhone(value: string) {
  const raw = value.trim().replace(/[^\d+]/g, "");
  const phone = raw.startsWith("+60") ? raw : raw.startsWith("60") ? `+${raw}` : raw.startsWith("0") ? `+60${raw.slice(1)}` : "";
  return /^\+60[1-9]\d{7,9}$/.test(phone) ? phone : null;
}
export function isMobile(value: string | null | undefined) { return /^\+601\d{7,9}$/.test(value ?? ""); }
export function normalizeWebsite(value: string | null | undefined) {
  if (!value?.trim()) return { websiteUrl: null, socialUrl: null, websiteType: "unknown" };
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) throw new Error();
    const social = /(^|\.)(facebook\.com|fb\.com|instagram\.com|linktr\.ee|wa\.me|whatsapp\.com|tiktok\.com|youtube\.com|linkedin\.com)$/i.test(u.hostname);
    return { websiteUrl: social ? null : u.href, socialUrl: social ? u.href : null, websiteType: social ? "social" : "own" };
  } catch { return { websiteUrl: null, socialUrl: null, websiteType: "unknown" }; }
}
export function groupName(value: string) {
  return value.toLowerCase().replace(/\b(sdn\s*bhd|bhd|plt|pllc|enterprise)\b/g, "").replace(/[^\p{L}\p{N}]/gu, " ").replace(/\s+/g, " ").trim();
}
export function distance(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (n: number) => n * Math.PI / 180;
  const x = Math.sin(rad(b.lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
export function normalizeElement(e: Element, category: Category, centres: AreaCentre[]): { business?: NormalizedBusiness; skipped?: string } {
  const t = e.tags ?? {};
  if (!["node","way","relation"].includes(e.type) || !Number.isSafeInteger(e.id)) return { skipped: "Invalid OSM identity" };
  const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  if (lat == null || lng == null || lat < 3.04 || lat > 3.27 || lng < 101.60 || lng > 101.80) return { skipped: "Outside KL bounding box" };
  if (Object.keys(t).some(k => /^(disused:|abandoned:|was:|closed(:|$))/.test(k)) || t.opening_hours === "off") return { skipped: "Closed or disused" };
  const name = t.name?.trim() ?? "";
  if (name.length < 2 || /^\d+$/.test(name)) return { skipped: "Missing or invalid name" };
  if (/school|tuition|training/i.test(category.label) && (/^(government|public)$/i.test(t["operator:type"] ?? "") || /^(SK |SMK |SJK|SMJK|Sekolah Kebangsaan|Sekolah Menengah Kebangsaan)/i.test(name))) return { skipped: "Government school" };
  const nearest = centres.map(c => ({ ...c, metres: distance({lat,lng},c) })).sort((a,b)=>a.metres-b.metres)[0];
  const area = nearest && nearest.metres <= 3000 ? nearest.label : "Other KL";
  const phones = [...new Set([t.phone,t["contact:phone"],t["contact:mobile"],t.mobile].filter(Boolean).flatMap(v=>v!.split(";")).map(normalizePhone).filter((v): v is string=>Boolean(v)))];
  const phone = phones[0] ?? null;
  const explicitWa = normalizePhone(t["contact:whatsapp"] ?? "");
  const whatsapp = explicitWa ?? (isMobile(phone) ? phone : null);
  const email = (t.email ?? t["contact:email"] ?? "").split(";").map(v=>v.trim().toLowerCase()).find(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) ?? null;
  const web = normalizeWebsite([t.website,t["contact:website"],t.url].find(v=>v?.trim()));
  return { business: { osmType:e.type,osmId:String(e.id),name,nameEn:t["name:en"] ?? null,...web,email,phone,phones,phoneIsMobile:isMobile(phone),whatsapp,whatsappDerived:!explicitWa&&Boolean(whatsapp),
    address:[t["addr:housenumber"],t["addr:street"],t["addr:suburb"],t["addr:city"],t["addr:postcode"]].filter(Boolean).join(", ") || area,
    area,keyword:category.label,lat,lng,premium:centres.some(c=>c.premium&&distance({lat,lng},c)<=2000),
    brand:t.brand ?? t["brand:wikidata"] ?? "",operator:t.operator ?? "",groupName:groupName(t.brand || t.operator || name),
    openingHours:t.opening_hours ?? null,tags:t } };
}
