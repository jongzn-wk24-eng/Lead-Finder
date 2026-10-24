import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import {
  getGetCompanyQueryKey, useGetCompany, useLogReply, useMarkDoNotContact, useRecheckCompany,
  useRefreshOsmCompany, useUpdateCompany, useUpdateCompanyStatus,
} from '@workspace/api-client-react';
import type { CompanyDetail, CompanyUpdate } from '@workspace/api-client-react';
import { EmailPanel } from '@/components/email-panel';
import { JobProgress } from '@/components/job-progress';
import {
  Button, Chip, EmptyState, ErrorState, Field, Input, Notice, PageSkeleton, STATUSES, ScoreBar, SectionHead, Select, StatusChip,
  Surface, Textarea, cx, dateLabel, dateTimeLabel, errorMessage, isLatin, mapsSearchUrl, safeHttpUrl, waDigits,
} from '@/components/kit';

const actionLabels: Record<string, string> = { imported: 'Imported', generated: 'Draft generated', copied_email: 'Email copied', copied_whatsapp: 'WhatsApp copied', marked_sent: 'Marked sent', reply_logged: 'Reply logged', status_changed: 'Status changed', marked_do_not_contact: 'Marked do not contact', note_added: 'Note added' };
const yesNo = (v?: boolean | null) => (v == null ? 'Not checked' : v ? 'Yes' : 'No');
const ext = 'text-[13px] text-primary underline-offset-2 hover:underline';

export default function CompanyPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const valid = Number.isFinite(id) && id > 0;
  const query = useGetCompany(id, { query: { queryKey: getGetCompanyQueryKey(id), enabled: valid } });
  const [panel, setPanel] = useState(false);
  const [jobs, setJobs] = useState<string[]>([]);
  if (!valid) return <Surface><EmptyState text="That company link is not valid." action={<Link href="/leads" className={ext}>Back to leads</Link>} /></Surface>;
  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !query.data) return <ErrorState message="This company could not be loaded." onRetry={() => query.refetch()} />;
  const c = query.data;
  return <CompanyView c={c} openPanel={() => setPanel(true)} jobs={jobs} addJob={jid => setJobs(j => [jid, ...j])} dropJob={jid => setJobs(j => j.filter(x => x !== jid))}>
    <EmailPanel companyId={c.id} open={panel} onClose={() => setPanel(false)} />
  </CompanyView>;
}

function CompanyView({ c, openPanel, jobs, addJob, dropJob, children }: { c: CompanyDetail; openPanel: () => void; jobs: string[]; addJob: (id: string) => void; dropJob: (id: string) => void; children: ReactNode }) {
  const qc = useQueryClient();
  const update = useUpdateCompany();
  const status = useUpdateCompanyStatus();
  const dnc = useMarkDoNotContact();
  const recheck = useRecheckCompany();
  const refreshOsm = useRefreshOsmCompany();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const blocked = c.isDoNotContact || c.status === 'Do not contact';
  const archivedGoogle = c.source === 'google_places';
  const refresh = () => qc.invalidateQueries();
  const patch = (data: CompanyUpdate, msg: string) => {
    setError(''); setSaved('');
    update.mutate({ companyId: c.id, data }, { onSuccess: () => { setSaved(msg); refresh(); }, onError: e => setError(errorMessage(e, 'Could not save.')) });
  };
  const website = safeHttpUrl(c.websiteUrl);
  const social = safeHttpUrl(c.socialUrl);
  const showEn = c.nameEn && !isLatin(c.name);

  return <div>
    <Link href="/leads" className="text-[13px] text-muted-foreground hover:text-foreground" data-testid="link-back-leads">Leads</Link>
    <div className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold" data-testid="text-company-name">{c.name}</h1>
        {showEn && <div className="text-sm text-muted-foreground">{c.nameEn}</div>}
        <div className="mt-1 text-sm text-muted-foreground">{c.keyword || 'Uncategorised'} · {c.area}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.isChain && <Chip>Large chain</Chip>}
          {(c.branchCount ?? 0) > 1 && !c.isChain && <Chip>{c.branchCount} branches in KL</Chip>}
          {archivedGoogle && <Chip data-testid="chip-archived-google">Archived Google record</Chip>}
          {c.isSampleData && <Chip tone="warn">Demo</Chip>}
          {c.osmStale && <Chip tone="warn" data-testid="chip-stale">Stale</Chip>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {blocked ? <StatusChip status="Do not contact" /> : <Select value={c.status} onChange={e => status.mutate({ companyId: c.id, data: { status: e.target.value } }, { onSuccess: refresh, onError: er => setError(errorMessage(er, 'Status could not be changed.')) })} className="w-44" aria-label="Status" data-testid="select-company-status" disabled={status.isPending}>
          {STATUSES.filter(s => s !== 'Do not contact').map(s => <option key={s}>{s}</option>)}
        </Select>}
        {!blocked && <Button variant="primary" onClick={openPanel} data-testid="button-get-email">Get email</Button>}
      </div>
    </div>

    <div className="space-y-3">
      {error && <Notice tone="risk">{error}</Notice>}
      {saved && <Notice tone="info">{saved}</Notice>}
      {c.duplicateWarning && <Notice tone="warn" data-testid="text-duplicate-warning">Possible duplicate: {c.duplicateWarning}. Records are not merged automatically.</Notice>}
      {archivedGoogle && <Notice>This record came from the old Google Places integration and is kept for history only. No Google API calls are made for it.</Notice>}
      {c.osmStale && c.osmId && <Notice tone="warn"><div className="flex flex-wrap items-center justify-between gap-3"><span>OpenStreetMap data is older than 30 days ({dateLabel(c.osmUpdatedAt || c.fetchedAt)}). Refreshing updates map fields only, never your edits, status or notes.</span><Button size="sm" disabled={refreshOsm.isPending} onClick={() => refreshOsm.mutate({ companyId: c.id }, { onSuccess: j => addJob(j.id), onError: e => setError(errorMessage(e, 'Refresh could not start.')) })} data-testid="button-refresh-osm">Refresh from OpenStreetMap</Button></div></Notice>}
      {jobs.map(j => <JobProgress key={j} jobId={j} compact onDismiss={() => dropJob(j)} />)}
    </div>

    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-6">
        <ContactSection c={c} blocked={blocked} onSave={patch} saving={update.isPending} onFindContact={() => recheck.mutate({ companyId: c.id }, { onSuccess: j => addJob(j.id), onError: e => setError(errorMessage(e, 'Check could not start.')) })} findPending={recheck.isPending} website={website} social={social} />

        <Surface>
          <SectionHead title="Manual value rating" sub="Set this after you check reviews on Google Maps." right={<a href={mapsSearchUrl(c.name, c.address)} target="_blank" rel="noreferrer" className={ext} data-testid="link-google-maps-rating">Check on Google Maps</a>} />
          <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-6" role="radiogroup" aria-label="Manual rating">
            {[0, 1, 2, 3].map(n => <button key={n} role="radio" aria-checked={(c.manualValue ?? 0) === n} disabled={update.isPending} onClick={() => patch({ manualValue: n }, n ? `Rated ${n} of 3.` : 'Rating cleared.')} data-testid={`button-rating-${n}`}
              className={cx('h-9 rounded-lg border px-3 text-sm transition-colors', (c.manualValue ?? 0) === n ? 'border-primary bg-accent text-accent-foreground' : 'border-border hover:bg-muted')}>{n === 0 ? 'Not rated' : `${n} of 3`}</button>)}
            <span className="ml-2 text-[13px] text-muted-foreground">Adds {['0', '2', '5', '8'][c.manualValue ?? 0]} value points.</span>
          </div>
        </Surface>

        <WebsiteSection c={c} onSave={patch} saving={update.isPending} onRecheck={() => recheck.mutate({ companyId: c.id }, { onSuccess: j => addJob(j.id), onError: e => setError(errorMessage(e, 'Re-check could not start.')) })} recheckPending={recheck.isPending} />
        <ScoresSection c={c} />
        <ScreenshotSection c={c} />
        <OutreachSection c={c} blocked={blocked} openPanel={openPanel} />
        <NotesSection c={c} onSave={patch} saving={update.isPending} />

        <Surface>
          <SectionHead title="Do not contact" sub="Permanent. The company is hidden from every action list and stays hidden after re-imports." />
          <div className="px-4 py-4 sm:px-6">{blocked ? <p className="text-sm text-muted-foreground">This company is marked Do not contact.</p>
            : <Button variant="danger" disabled={dnc.isPending} data-testid="button-dnc" onClick={() => { if (window.confirm(`Mark ${c.name} as Do not contact? This is permanent and cannot be undone.`)) dnc.mutate({ companyId: c.id }, { onSuccess: refresh, onError: e => setError(errorMessage(e, 'Could not mark as Do not contact.')) }); }}>Mark as Do not contact</Button>}</div>
        </Surface>
      </div>

      <aside className="space-y-6">
        <Surface>
          <SectionHead title="Record" />
          <dl className="space-y-3 px-4 py-4 text-[13px] sm:px-6">
            <Meta k="Source" v={c.source === 'openstreetmap' ? 'OpenStreetMap' : c.source === 'google_places' ? 'Google (archived)' : c.source === 'manual' ? 'Added manually' : 'Demo'} />
            {c.osmId && <Meta k="OSM element" v={<a className={ext} href={`https://www.openstreetmap.org/${c.osmType}/${c.osmId}`} target="_blank" rel="noreferrer">{c.osmType}/{c.osmId}</a>} />}
            <Meta k="Map data updated" v={dateLabel(c.osmUpdatedAt || c.fetchedAt)} />
            <Meta k="Added" v={dateLabel(c.createdAt)} />
            <Meta k="Last contacted" v={dateLabel(c.lastContactedAt)} />
            <Meta k="Next follow-up" v={dateLabel(c.nextFollowupAt)} />
            <Meta k="Emails / WhatsApp" v={`${c.emailCount} / ${c.whatsappCount}`} />
          </dl>
        </Surface>
        <Surface>
          <SectionHead title="Activity" />
          {!c.activity?.length ? <EmptyState text="No activity yet." /> : <ol className="divide-y divide-border">{c.activity.map(a => <li key={a.id} className="px-4 py-3 text-[13px] sm:px-6"><div className="flex justify-between gap-2"><span className="font-medium">{actionLabels[a.action] || a.action}</span><span className="shrink-0 text-muted-foreground">{dateTimeLabel(a.timestamp)}</span></div>{(a.channel || a.note) && <div className="mt-0.5 text-muted-foreground">{[a.channel, a.sequenceNo ? `#${a.sequenceNo}` : '', a.note].filter(Boolean).join(' · ')}</div>}</li>)}</ol>}
        </Surface>
      </aside>
    </div>
    {children}
  </div>;
}

function Meta({ k, v }: { k: string; v: ReactNode }) { return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>; }

function ContactSection({ c, blocked, onSave, saving, onFindContact, findPending, website, social }: { c: CompanyDetail; blocked: boolean; onSave: (d: CompanyUpdate, msg: string) => void; saving: boolean; onFindContact: () => void; findPending: boolean; website: string | null; social: string | null }) {
  const [editing, setEditing] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) || '').trim();
    const er: Record<string, string> = {};
    if (g('name').length < 2) er.name = 'Name needs at least 2 characters.';
    if (g('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g('email'))) er.email = 'Enter a valid email.';
    let w = g('websiteUrl');
    if (w) { if (!/^https?:\/\//i.test(w)) w = `https://${w}`; if (!safeHttpUrl(w)) er.websiteUrl = 'Enter a valid web address.'; }
    if (g('phone') && !/^[+\d][\d\s\-()]{6,}$/.test(g('phone'))) er.phone = 'Enter a valid phone number.';
    if (g('whatsapp') && !waDigits(g('whatsapp'))) er.whatsapp = 'WhatsApp must be a Malaysian mobile number (01... or +601...).';
    setErrs(er);
    if (Object.keys(er).length) return;
    onSave({ name: g('name'), firstName: g('firstName'), email: g('email') || null, whatsapp: g('whatsapp') || null, phone: g('phone') || null, websiteUrl: w || null }, 'Contact details saved. Your edits are protected from future refreshes.');
    setEditing(false);
  };
  return <Surface>
    <SectionHead title="Basic info and contact" right={!editing && <Button size="sm" onClick={() => setEditing(true)} data-testid="button-edit-contact">Edit</Button>} />
    {editing ? <form onSubmit={submit} className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-6" noValidate>
      <Field label="Company name" error={errs.name}><Input name="name" defaultValue={c.name} data-testid="input-name" /></Field>
      <Field label="First name" hint="Leave blank to greet with Hi there."><Input name="firstName" defaultValue={c.firstName} data-testid="input-first-name" /></Field>
      <Field label="Email" error={errs.email}><Input name="email" type="email" defaultValue={c.email || ''} data-testid="input-email" /></Field>
      <Field label="Phone" error={errs.phone}><Input name="phone" defaultValue={c.phone || ''} data-testid="input-phone" /></Field>
      <Field label="WhatsApp" error={errs.whatsapp}><Input name="whatsapp" defaultValue={c.whatsapp || ''} data-testid="input-whatsapp" /></Field>
      <Field label="Website" error={errs.websiteUrl} hint="Changing it queues fresh checks."><Input name="websiteUrl" defaultValue={c.websiteUrl || ''} data-testid="input-website" /></Field>
      <div className="flex gap-2 sm:col-span-2"><Button type="submit" variant="primary" disabled={saving} data-testid="button-save-contact">Save</Button><Button onClick={() => { setEditing(false); setErrs({}); }}>Cancel</Button></div>
    </form> : <div className="px-4 py-4 sm:px-6">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Row k="Address" v={c.address || c.area} />
        <Row k="First name" v={c.firstName || <span className="text-muted-foreground">Not set</span>} />
        <Row k="Email" v={c.email || <span className="text-muted-foreground">Not found</span>} />
        <Row k="Phone" v={c.phone ? `${c.phone}${c.phoneIsMobile ? ' (mobile)' : ' (landline)'}` : <span className="text-muted-foreground">Not listed</span>} />
        {(c.phones?.length ?? 0) > 1 && <Row k="Other phones" v={c.phones!.filter(p => p !== c.phone).join(', ')} />}
        <Row k="WhatsApp" v={c.whatsapp ? `${c.whatsapp}${c.whatsappDerived ? ' (derived from mobile, unconfirmed)' : ''}` : <span className="text-muted-foreground">None</span>} />
      </dl>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        <a href={mapsSearchUrl(c.name, c.address)} target="_blank" rel="noreferrer" className={ext} data-testid="link-google-maps">Check on Google Maps</a>
        {website && <a href={website} target="_blank" rel="noreferrer" className={ext} data-testid="link-open-website">Open website</a>}
        {social && <a href={social} target="_blank" rel="noreferrer" className={ext} data-testid="link-social">Open social page</a>}
        {!c.email && !blocked && (website ? <button className={ext} disabled={findPending} onClick={onFindContact} data-testid="button-find-contact">Find contact</button>
          : <a href={`https://www.google.com/search?q=${encodeURIComponent(`${c.name} Kuala Lumpur email`)}`} target="_blank" rel="noreferrer" className={ext} data-testid="link-search-google">Search on Google</a>)}
      </div>
    </div>}
  </Surface>;
}
function Row({ k, v }: { k: string; v: ReactNode }) { return <div><dt className="text-[13px] text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words">{v}</dd></div>; }

function WebsiteSection({ c, onSave, saving, onRecheck, recheckPending }: { c: CompanyDetail; onSave: (d: CompanyUpdate, msg: string) => void; saving: boolean; onRecheck: () => void; recheckPending: boolean }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const check = c.checks?.[0];
  const add = () => {
    let w = url.trim();
    if (!w) { setErr('Paste the website address.'); return; }
    if (!/^https?:\/\//i.test(w)) w = `https://${w}`;
    if (!safeHttpUrl(w)) { setErr('Enter a valid web address.'); return; }
    setErr(''); onSave({ websiteUrl: w, websiteConfirmedNone: false }, 'Website added. Checks are queued.'); setAdding(false); setUrl('');
  };
  return <Surface>
    <SectionHead title="Website status" right={c.websiteUrl && <Button size="sm" disabled={recheckPending} onClick={onRecheck} data-testid="button-recheck">{recheckPending ? 'Queuing' : 'Re-check'}</Button>} />
    <div className="px-4 py-4 text-sm sm:px-6">
      {!c.websiteUrl && !c.websiteConfirmedNone && <>
        <p data-testid="text-website-unverified">No website listed (unverified). OpenStreetMap often lacks website tags, so this is not proof there is none.{c.websiteType === 'social' ? ' A social page is listed instead.' : c.websiteType === 'unverified' || c.websiteType === 'unknown' ? ' Status: unverified.' : ''}</p>
        {adding ? <div className="mt-3 flex flex-wrap items-start gap-2"><div className="min-w-[220px] flex-1"><Input autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="example.com.my" aria-invalid={!!err} data-testid="input-add-website" />{err && <p role="alert" className="mt-1 text-xs text-[#8a2f25]">{err}</p>}</div><Button variant="primary" disabled={saving} onClick={add} data-testid="button-save-website">Save and check</Button><Button onClick={() => setAdding(false)}>Cancel</Button></div>
          : <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => setAdding(true)} data-testid="button-add-website">Add website</Button><Button disabled={saving} onClick={() => { if (window.confirm('Confirm you checked and this business has no website? Emails may then mention it.')) onSave({ websiteConfirmedNone: true }, 'Marked as confirmed: no website.'); }} data-testid="button-confirm-no-website">Confirm: no website</Button></div>}
      </>}
      {!c.websiteUrl && c.websiteConfirmedNone && <div className="flex flex-wrap items-center justify-between gap-3"><p>No website (confirmed by you).</p><Button size="sm" disabled={saving} onClick={() => onSave({ websiteConfirmedNone: false }, 'Confirmation removed.')} data-testid="button-undo-no-website">Undo confirmation</Button></div>}
      {c.websiteUrl && <>
        <p className="break-all">{c.websiteUrl}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Check status: {c.automatedCheckStatus || 'pending'}{c.automatedCheckedAt ? ` · ${dateTimeLabel(c.automatedCheckedAt)}` : ''}</p>
        {check && <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
          <Row k="Type" v={check.websiteType} />
          <Row k="Mobile speed score" v={check.psiMobileScore ?? 'Not available'} />
          <Row k="Largest paint" v={check.lcpSeconds != null ? `${check.lcpSeconds.toFixed(1)} s` : 'Not available'} />
          <Row k="HTTPS" v={yesNo(check.https)} />
          <Row k="Viewport tag" v={yesNo(check.hasViewport)} />
          <Row k="Copyright year" v={check.copyrightYear ?? 'Not found'} />
          <Row k="Call link" v={yesNo(check.hasTelLink)} />
          <Row k="WhatsApp link" v={yesNo(check.hasWhatsappLink)} />
          <Row k="Contact form or page" v={yesNo(check.hasContactForm ?? check.hasContactPage)} />
          <Row k="Site builder" v={check.siteBuilder || 'Not detected'} />
          <Row k="Design score" v={check.designScore != null ? `${check.designScore} / 10 (10 is excellent)` : check.designStatus === 'pending' ? 'Pending' : 'Not available'} />
          <Row k="Main action obvious" v={yesNo(check.ctaObvious)} />
        </dl>}
        {check?.designReason && <p className="mt-3 text-[13px] text-muted-foreground">{check.designReason}</p>}
        {check?.lastError && <Notice tone="warn" className="mt-3">{check.lastError}</Notice>}
      </>}
    </div>
  </Surface>;
}

function ScoresSection({ c }: { c: CompanyDetail }) {
  return <Surface>
    <SectionHead title="Scores and reasons" />
    <div className="grid gap-6 px-4 py-4 sm:grid-cols-3 sm:px-6">
      <div><div className="text-[13px] text-muted-foreground">Opportunity</div><ScoreBar value={c.opportunityScore} max={100} /></div>
      <div><div className="text-[13px] text-muted-foreground">Business value</div><ScoreBar value={c.valueScore} max={30} /></div>
      <div><div className="text-[13px] text-muted-foreground">Website problem</div><ScoreBar value={c.problemScore} max={70} /></div>
    </div>
    <div className="border-t border-border px-4 py-4 text-sm sm:px-6">
      <div className="text-[13px] font-medium">Why it is here</div>
      {c.reasons.length ? <ol className="mt-2 list-inside list-decimal space-y-1">{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ol> : <p className="mt-2 text-muted-foreground">No stored findings yet.</p>}
      <div className="mt-4 text-[13px] font-medium">Value breakdown</div>
      <p className="mt-1 text-[13px] text-muted-foreground">A rough guess. OpenStreetMap has no reviews, so value comes from category, branches, premium area and your manual rating.</p>
      {c.valueScoreDetails.length > 0 && <ul className="mt-2 space-y-1 text-[13px]">{c.valueScoreDetails.map((d, i) => <li key={i}>{d}</li>)}</ul>}
    </div>
  </Surface>;
}

function ScreenshotSection({ c }: { c: CompanyDetail }) {
  const check = c.checks?.find(k => k.screenshotDesktopUrl || k.screenshotMobileUrl);
  return <Surface>
    <SectionHead title="Screenshots" />
    <div className="grid gap-4 px-4 py-4 sm:grid-cols-[1fr_160px] sm:px-6">
      {[['Desktop', check?.screenshotDesktopUrl, 'aspect-[16/10]'], ['Mobile', check?.screenshotMobileUrl, 'aspect-[9/16]']].map(([label, src, ratio]) => <figure key={label as string}>
        <div className={cx('overflow-hidden rounded-lg border border-border bg-muted', ratio as string)}>{src ? <img src={src as string} alt={`${label} screenshot of ${c.name}`} className="h-full w-full object-cover object-top" loading="lazy" /> : <div className="grid h-full place-items-center p-3 text-center text-xs text-muted-foreground">Not available</div>}</div>
        <figcaption className="mt-1 text-xs text-muted-foreground">{label as string}</figcaption>
      </figure>)}
    </div>
  </Surface>;
}

function OutreachSection({ c, blocked, openPanel }: { c: CompanyDetail; blocked: boolean; openPanel: () => void }) {
  const qc = useQueryClient();
  const reply = useLogReply();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const sent = (c.outreach || []).filter(o => o.sentAt);
  return <Surface>
    <SectionHead title="Email" sub="Every message you marked as sent." right={!blocked && <Button size="sm" onClick={openPanel} data-testid="button-get-email-section">Get email</Button>} />
    {sent.length === 0 ? <EmptyState text="Nothing marked as sent yet." /> : <table className="w-full text-sm">
      <thead><tr className="h-10 border-b border-border text-left text-[13px] text-muted-foreground"><th className="px-4 font-normal sm:px-6">Sent</th><th className="px-3 font-normal">Channel</th><th className="px-3 text-right font-normal">No.</th><th className="px-4 font-normal sm:px-6">Reply</th></tr></thead>
      <tbody>{sent.map(o => <tr key={o.id} className="h-12 border-b border-border last:border-0"><td className="px-4 sm:px-6">{dateLabel(o.sentAt)}</td><td className="px-3">{o.channel === 'email' ? 'Email' : 'WhatsApp'}</td><td className="px-3 text-right tabular">{o.sequenceNo}</td><td className="px-4 text-muted-foreground sm:px-6">{o.repliedAt ? `${dateLabel(o.repliedAt)}${o.result ? ` · ${o.result}` : ''}` : '-'}</td></tr>)}</tbody>
    </table>}
    {sent.length > 0 && <div className="border-t border-border px-4 py-4 sm:px-6">
      {open ? <div className="grid gap-2"><Field label="Reply note" error={err}><Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="What did they say?" data-testid="input-reply-note" /></Field>
        <div className="flex gap-2"><Button variant="primary" disabled={reply.isPending} onClick={() => { if (!note.trim()) { setErr('Add a short note.'); return; } setErr(''); reply.mutate({ companyId: c.id, data: { note: note.trim() } }, { onSuccess: () => { setOpen(false); setNote(''); qc.invalidateQueries(); }, onError: e => setErr(errorMessage(e, 'Reply could not be logged.')) }); }} data-testid="button-save-reply">Log reply</Button><Button onClick={() => setOpen(false)}>Cancel</Button></div></div>
        : <Button size="sm" onClick={() => setOpen(true)} data-testid="button-log-reply">Log a reply</Button>}
    </div>}
  </Surface>;
}

function NotesSection({ c, onSave, saving }: { c: CompanyDetail; onSave: (d: CompanyUpdate, msg: string) => void; saving: boolean }) {
  const [notes, setNotes] = useState(c.notes);
  const dirty = notes !== c.notes;
  return <Surface>
    <SectionHead title="Notes" />
    <div className="px-4 py-4 sm:px-6"><Textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-notes" />
      <div className="mt-2 flex justify-end"><Button size="sm" disabled={!dirty || saving} onClick={() => onSave({ notes }, 'Notes saved.')} data-testid="button-save-notes">Save notes</Button></div></div>
  </Surface>;
}
