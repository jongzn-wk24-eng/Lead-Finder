import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSettingsQueryKey, useGetSettings, useUpdateSettings } from '@workspace/api-client-react';
import type { Settings, SettingsUpdate } from '@workspace/api-client-react';
import { DemoControls } from '@/components/data-mode';
import { Button, Checkbox, ErrorState, Field, Input, PageHeader, PageSkeleton, SectionHead, Surface, Textarea, errorMessage, safeHttpUrl } from '@/components/kit';

type Cat = { label: string; filters: string; highValue: boolean; enabled: boolean };
type Centre = { label: string; lat: string; lng: string; premium: boolean };
type Form = {
  osmContact: string; overpassEndpoint: string; minValue: string; minProblem: string; chainThreshold: string;
  emailDailyLimit: string; whatsappDailyLimit: string; followup1Days: string; followup2Days: string;
  myName: string; myTitle: string; myWhatsapp: string; portfolioUrl: string; aiInstruction: string;
  categories: Cat[]; areaCentres: Centre[];
};
const FILTER_RE = /^[a-zA-Z_:]+=[a-zA-Z0-9_:.-]+$/;

const DEFAULT_CATEGORIES: Cat[] = ([
  ['Dental clinic', 'amenity=dentist', true, true], ['Medical clinic / specialist', 'amenity=clinic, amenity=doctors', true, true],
  ['Aesthetic / beauty', 'shop=beauty', true, true], ['Law firm', 'office=lawyer', true, true],
  ['Accounting / tax', 'office=accountant, office=tax_advisor', true, true], ['Interior design / architect', 'shop=interior_decoration, office=architect', true, true],
  ['Renovation / builder', 'craft=builder, office=construction_company', true, true], ['Real estate agency', 'office=estate_agent', true, true],
  ['Private school / tuition / training', 'amenity=school, amenity=college, amenity=language_school, amenity=music_school', true, true],
  ['Car dealership', 'shop=car', true, true], ['Hotel', 'tourism=hotel', true, true], ['Wedding services', 'shop=wedding, shop=bridal', true, true],
  ['Company / trading / logistics', 'office=company, office=logistics', false, true], ['Restaurant and cafe', 'amenity=restaurant, amenity=cafe', false, false],
] as const).map(([label, filters, highValue, enabled]) => ({ label, filters, highValue, enabled }));
const DEFAULT_CENTRES: Centre[] = ([
  ['KLCC', 3.158, 101.712, true], ['Bukit Bintang', 3.147, 101.711, true], ['Bangsar', 3.130, 101.670, true], ['Mont Kiara / Sri Hartamas', 3.170, 101.650, true],
  ['Damansara Heights', 3.150, 101.662, true], ['Cheras', 3.085, 101.740, false], ['Setapak', 3.200, 101.720, false], ['Sentul', 3.185, 101.695, false],
  ['Kepong', 3.210, 101.635, false], ['Bukit Jalil', 3.060, 101.690, false],
] as const).map(([label, lat, lng, premium]) => ({ label, lat: String(lat), lng: String(lng), premium }));

function toForm(s: Settings): Form {
  return {
    osmContact: s.osmContact || '', overpassEndpoint: s.overpassEndpoint || 'https://overpass-api.de/api/interpreter',
    minValue: String(s.minValue ?? 10), minProblem: String(s.minProblem ?? 25), chainThreshold: String(s.chainThreshold ?? 8),
    emailDailyLimit: String(s.emailDailyLimit ?? 15), whatsappDailyLimit: String(s.whatsappDailyLimit ?? 10), followup1Days: String(s.followup1Days ?? 4), followup2Days: String(s.followup2Days ?? 10),
    myName: s.myName ?? 'Dylan Jong', myTitle: s.myTitle ?? 'Web Designer', myWhatsapp: s.myWhatsapp ?? '', portfolioUrl: s.portfolioUrl ?? '', aiInstruction: s.aiInstruction ?? '',
    categories: !s.categories?.length ? DEFAULT_CATEGORIES : s.categories.map(c => ({ label: c.label, filters: c.filters.join(', '), highValue: c.highValue, enabled: c.enabled })),
    areaCentres: !s.areaCentres?.length ? DEFAULT_CENTRES : s.areaCentres.map(a => ({ label: a.label, lat: String(a.lat), lng: String(a.lng), premium: a.premium })),
  };
}
function intIn(v: string, min: number, max: number) { const n = Number(v); return v.trim() !== '' && Number.isInteger(n) && n >= min && n <= max; }

function validate(f: Form) {
  const e: Record<string, string> = {};
  if (!f.osmContact.trim()) e.osmContact = 'Required before any import. Use your email or site.';
  if (!safeHttpUrl(f.overpassEndpoint) || !f.overpassEndpoint.startsWith('https://')) e.overpassEndpoint = 'Enter a full https:// address.';
  if (!intIn(f.minValue, 0, 30)) e.minValue = 'Whole number from 0 to 30.';
  if (!intIn(f.minProblem, 0, 70)) e.minProblem = 'Whole number from 0 to 70.';
  if (!intIn(f.chainThreshold, 2, 1000)) e.chainThreshold = 'Whole number, 2 or more.';
  if (!intIn(f.emailDailyLimit, 1, 100)) e.emailDailyLimit = '1 to 100.';
  if (!intIn(f.whatsappDailyLimit, 1, 100)) e.whatsappDailyLimit = '1 to 100.';
  if (!intIn(f.followup1Days, 1, 60)) e.followup1Days = '1 to 60 days.';
  if (!intIn(f.followup2Days, 1, 90)) e.followup2Days = '1 to 90 days.';
  else if (intIn(f.followup1Days, 1, 60) && Number(f.followup2Days) <= Number(f.followup1Days)) e.followup2Days = 'Must be later than the first follow-up.';
  if (f.portfolioUrl && !safeHttpUrl(f.portfolioUrl)) e.portfolioUrl = 'Enter a full web address.';
  if (!f.categories.length) e.categories = 'Keep at least one category.';
  const labels = new Set<string>();
  f.categories.forEach((c, i) => {
    if (!c.label.trim()) e[`cat-${i}-label`] = 'Label required.';
    else if (labels.has(c.label.trim().toLowerCase())) e[`cat-${i}-label`] = 'Duplicate label.';
    labels.add(c.label.trim().toLowerCase());
    const filters = c.filters.split(',').map(x => x.trim()).filter(Boolean);
    if (!filters.length) e[`cat-${i}-filters`] = 'At least one tag filter, like amenity=dentist.';
    else { const bad = filters.find(x => !FILTER_RE.test(x)); if (bad) e[`cat-${i}-filters`] = `"${bad}" is not key=value.`; }
  });
  if (!f.areaCentres.length) e.areaCentres = 'Keep at least one area centre.';
  f.areaCentres.forEach((a, i) => {
    if (!a.label.trim()) e[`area-${i}-label`] = 'Label required.';
    const lat = Number(a.lat), lng = Number(a.lng);
    if (a.lat.trim() === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) e[`area-${i}-lat`] = 'Latitude -90 to 90.';
    if (a.lng.trim() === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) e[`area-${i}-lng`] = 'Longitude -180 to 180.';
  });
  return e;
}
function toUpdate(f: Form): SettingsUpdate {
  return {
    osmContact: f.osmContact.trim(), overpassEndpoint: f.overpassEndpoint.trim(),
    minValue: Number(f.minValue), minProblem: Number(f.minProblem), chainThreshold: Number(f.chainThreshold),
    emailDailyLimit: Number(f.emailDailyLimit), whatsappDailyLimit: Number(f.whatsappDailyLimit), followup1Days: Number(f.followup1Days), followup2Days: Number(f.followup2Days),
    myName: f.myName.trim(), myTitle: f.myTitle.trim(), myWhatsapp: f.myWhatsapp.trim(), portfolioUrl: f.portfolioUrl.trim(), aiInstruction: f.aiInstruction,
    categories: f.categories.map(c => ({ label: c.label.trim(), filters: c.filters.split(',').map(x => x.trim()).filter(Boolean), highValue: c.highValue, enabled: c.enabled })),
    areaCentres: f.areaCentres.map(a => ({ label: a.label.trim(), lat: Number(a.lat), lng: Number(a.lng), premium: a.premium })),
  };
}

export default function SettingsPage() {
  const s = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  if (s.isLoading) return <PageSkeleton />;
  if (s.isError || !s.data) return <ErrorState onRetry={() => s.refetch()} />;
  return <SettingsForm initial={s.data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const qc = useQueryClient();
  const update = useUpdateSettings();
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: 'info' | 'risk'; text: string } | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => ({ ...p, [k]: v }));
  const setCat = (i: number, patch: Partial<Cat>) => set('categories', f.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setArea = (i: number, patch: Partial<Centre>) => set('areaCentres', f.areaCentres.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const save = () => {
    const e = validate(f); setErrors(e); setStatus(null);
    if (Object.keys(e).length) { setStatus({ tone: 'risk', text: `Fix ${Object.keys(e).length} ${Object.keys(e).length === 1 ? 'field' : 'fields'} before saving.` }); return; }
    update.mutate({ data: toUpdate(f) }, {
      onSuccess: next => { setF(toForm(next as unknown as Settings)); qc.invalidateQueries(); setStatus({ tone: 'info', text: 'Settings saved. Scores update on the next recalculation.' }); },
      onError: err => setStatus({ tone: 'risk', text: errorMessage(err, 'Settings could not be saved.') }),
    });
  };
  const num = (k: keyof Form, label: string, hint?: string) => <Field label={label} hint={hint} error={errors[k]}><Input inputMode="numeric" value={f[k] as string} onChange={e => set(k, e.target.value as never)} aria-invalid={!!errors[k]} data-testid={`input-${k}`} /></Field>;

  return <div className="pb-24">
    <PageHeader title="Settings" />
    <div className="space-y-6">
      <Block title="OpenStreetMap" sub="Sent with every Overpass request as the User-Agent contact.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="OSM contact" hint="Email or site. Imports are refused while this is empty." error={errors.osmContact}><Input value={f.osmContact} onChange={e => set('osmContact', e.target.value)} aria-invalid={!!errors.osmContact} data-testid="input-osmContact" /></Field>
          <Field label="Overpass endpoint" error={errors.overpassEndpoint}><Input value={f.overpassEndpoint} onChange={e => set('overpassEndpoint', e.target.value)} aria-invalid={!!errors.overpassEndpoint} data-testid="input-overpassEndpoint" /></Field>
        </div>
      </Block>

      <Surface>
        <SectionHead title="Categories" sub="Tag filters are comma separated key=value pairs. One Overpass query per enabled category." right={<Button size="sm" onClick={() => set('categories', [...f.categories, { label: '', filters: '', highValue: false, enabled: true }])} data-testid="button-add-category">Add category</Button>} />
        {errors.categories && <p role="alert" className="px-6 pt-3 text-xs text-[#8a2f25]">{errors.categories}</p>}
        <div className="divide-y divide-border">{f.categories.map((c, i) => <div key={i} className="grid gap-3 px-4 py-4 sm:px-6 md:grid-cols-[1fr_1.5fr_auto] md:items-start" data-testid={`row-category-${i}`}>
          <Field label="Label" error={errors[`cat-${i}-label`]}><Input value={c.label} onChange={e => setCat(i, { label: e.target.value })} aria-invalid={!!errors[`cat-${i}-label`]} data-testid={`input-category-label-${i}`} /></Field>
          <Field label="Tag filters" error={errors[`cat-${i}-filters`]}><Input value={c.filters} onChange={e => setCat(i, { filters: e.target.value })} placeholder="amenity=dentist" className="font-mono text-[13px]" aria-invalid={!!errors[`cat-${i}-filters`]} data-testid={`input-category-filters-${i}`} /></Field>
          <div className="flex flex-wrap items-center gap-4 md:pt-7"><Checkbox label="High value" checked={c.highValue} onChange={e => setCat(i, { highValue: e.target.checked })} data-testid={`checkbox-category-high-${i}`} /><Checkbox label="Enabled" checked={c.enabled} onChange={e => setCat(i, { enabled: e.target.checked })} data-testid={`checkbox-category-enabled-${i}`} /><Button size="sm" variant="text" onClick={() => set('categories', f.categories.filter((_, j) => j !== i))} data-testid={`button-remove-category-${i}`}>Remove</Button></div>
        </div>)}</div>
      </Surface>

      <Surface>
        <SectionHead title="Area centres" sub="Companies get the nearest centre within 3 km, else Other KL. Premium centres add value within 2 km." right={<Button size="sm" onClick={() => set('areaCentres', [...f.areaCentres, { label: '', lat: '', lng: '', premium: false }])} data-testid="button-add-area">Add centre</Button>} />
        {errors.areaCentres && <p role="alert" className="px-6 pt-3 text-xs text-[#8a2f25]">{errors.areaCentres}</p>}
        <div className="divide-y divide-border">{f.areaCentres.map((a, i) => <div key={i} className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-start" data-testid={`row-area-${i}`}>
          <Field label="Label" error={errors[`area-${i}-label`]}><Input value={a.label} onChange={e => setArea(i, { label: e.target.value })} aria-invalid={!!errors[`area-${i}-label`]} data-testid={`input-area-label-${i}`} /></Field>
          <Field label="Latitude" error={errors[`area-${i}-lat`]}><Input inputMode="decimal" value={a.lat} onChange={e => setArea(i, { lat: e.target.value })} className="tabular" aria-invalid={!!errors[`area-${i}-lat`]} data-testid={`input-area-lat-${i}`} /></Field>
          <Field label="Longitude" error={errors[`area-${i}-lng`]}><Input inputMode="decimal" value={a.lng} onChange={e => setArea(i, { lng: e.target.value })} className="tabular" aria-invalid={!!errors[`area-${i}-lng`]} data-testid={`input-area-lng-${i}`} /></Field>
          <div className="flex items-center gap-4 md:pt-7"><Checkbox label="Premium" checked={a.premium} onChange={e => setArea(i, { premium: e.target.checked })} data-testid={`checkbox-area-premium-${i}`} /><Button size="sm" variant="text" onClick={() => set('areaCentres', f.areaCentres.filter((_, j) => j !== i))} data-testid={`button-remove-area-${i}`}>Remove</Button></div>
        </div>)}</div>
      </Surface>

      <Block title="Score thresholds" sub="Default Leads filter. Show all ignores these.">
        <div className="grid gap-4 sm:grid-cols-3">{num('minValue', 'Minimum value', 'Out of 30.')}{num('minProblem', 'Minimum problem', 'Out of 70.')}{num('chainThreshold', 'Large chain at', 'Branches in KL.')}</div>
      </Block>
      <Block title="Sending limits and follow-ups">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{num('emailDailyLimit', 'Emails per day')}{num('whatsappDailyLimit', 'WhatsApp per day')}{num('followup1Days', 'Follow-up 1 after (days)')}{num('followup2Days', 'Follow-up 2 after (days)')}</div>
      </Block>
      <Block title="Sender">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name"><Input value={f.myName} onChange={e => set('myName', e.target.value)} data-testid="input-myName" /></Field>
          <Field label="Your title"><Input value={f.myTitle} onChange={e => set('myTitle', e.target.value)} data-testid="input-myTitle" /></Field>
          <Field label="Your WhatsApp" hint="Required before drafts can be generated."><Input value={f.myWhatsapp} onChange={e => set('myWhatsapp', e.target.value)} data-testid="input-myWhatsapp" /></Field>
          <Field label="Portfolio URL" error={errors.portfolioUrl}><Input value={f.portfolioUrl} onChange={e => set('portfolioUrl', e.target.value)} aria-invalid={!!errors.portfolioUrl} data-testid="input-portfolioUrl" /></Field>
        </div>
      </Block>
      <Block title="AI instruction" sub="Used for Gemini drafts. If validation fails, the plain template is used.">
        <Textarea rows={8} value={f.aiInstruction} onChange={e => set('aiInstruction', e.target.value)} data-testid="input-aiInstruction" />
      </Block>
      <DemoControls />
    </div>

    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">{status ? <span role={status.tone === 'risk' ? 'alert' : 'status'} className={status.tone === 'risk' ? 'text-[13px] text-[#8a2f25]' : 'text-[13px] text-muted-foreground'} data-testid="text-settings-status">{status.text}</span> : <span className="text-[13px] text-muted-foreground">Changes apply to future imports and drafts.</span>}</div>
        <div className="flex gap-2"><Button onClick={() => { setF(toForm(initial)); setErrors({}); setStatus(null); }} data-testid="button-reset-settings">Reset</Button><Button variant="primary" disabled={update.isPending} onClick={save} data-testid="button-save-settings">{update.isPending ? 'Saving' : 'Save settings'}</Button></div>
      </div>
    </div>
  </div>;
}

function Block({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return <Surface><SectionHead title={title} sub={sub} /><div className="px-4 py-4 sm:px-6">{children}</div></Surface>;
}
