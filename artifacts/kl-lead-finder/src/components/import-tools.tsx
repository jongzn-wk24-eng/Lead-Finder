import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { getGetSettingsQueryKey, useCreateCompany, useEstimateSearch, useGetSettings, usePasteCompanies, useStartSearchJob } from '@workspace/api-client-react';
import type { PasteResult, SearchEstimate, SearchInput } from '@workspace/api-client-react';
import { JobProgress } from '@/components/job-progress';
import { Button, Checkbox, Field, Input, Modal, Notice, Skeleton, Textarea, errorMessage } from '@/components/kit';

export const OSM_LIMITS = 'OpenStreetMap has no reviews, and many businesses are missing website tags. Coverage in KL is uneven.';

export function OsmImportModal({ open, onClose, onJob }: { open: boolean; onClose: () => void; onJob: (id: string) => void }) {
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), enabled: open } });
  const estimate = useEstimateSearch();
  const start = useStartSearchJob();
  const cats = useMemo(() => (settings.data?.categories || []).filter(c => c.enabled), [settings.data]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [est, setEst] = useState<SearchEstimate | null>(null);
  const [error, setError] = useState('');
  const defaultPick = cats.some(c => c.label === 'Dental clinic') ? ['Dental clinic'] : cats.filter(c => /dental/i.test(c.label)).map(c => c.label);
  const selected = picked ?? defaultPick;
  const contact = (settings.data?.osmContact || '').trim();
  const input = (): SearchInput => ({ areas: ['Kuala Lumpur'], keywords: selected, refresh });
  const toggle = (label: string) => { setEst(null); setPicked(selected.includes(label) ? selected.filter(l => l !== label) : [...selected, label]); };
  const close = () => { setEst(null); setError(''); onClose(); };
  const doEstimate = () => { setError(''); estimate.mutate({ data: input() }, { onSuccess: setEst, onError: e => setError(errorMessage(e, 'Could not plan this import.')) }); };
  const run = () => { setError(''); start.mutate({ data: input() }, { onSuccess: job => { onJob(job.id); close(); }, onError: e => setError(errorMessage(e, 'The import could not start.')) }); };

  return <Modal open={open} title="Import from OpenStreetMap" onClose={close}>
    {settings.isLoading ? <div className="space-y-2"><Skeleton className="h-5" /><Skeleton className="h-5" /><Skeleton className="h-5" /></div>
      : settings.isError ? <Notice tone="risk">Settings could not load. <button className="underline" onClick={() => settings.refetch()}>Retry</button></Notice>
      : !contact ? <Notice tone="warn">Add your OSM contact (email or site) in <Link href="/settings" className="underline" onClick={close}>Settings</Link> first. It is sent with every Overpass request and imports are refused without it.</Notice>
      : <div className="space-y-5">
        <p className="text-[13px] text-muted-foreground">{OSM_LIMITS}</p>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Categories</legend>
          {cats.length === 0 ? <p className="text-sm text-muted-foreground">No enabled categories. Enable some in Settings.</p>
            : <div className="grid gap-2 sm:grid-cols-2">{cats.map(c => <Checkbox key={c.label} label={<span>{c.label}{c.highValue ? <span className="text-muted-foreground"> · high value</span> : null}</span>} checked={selected.includes(c.label)} onChange={() => toggle(c.label)} data-testid={`checkbox-category-${c.label}`} />)}</div>}
          <p className="mt-2 text-xs text-muted-foreground">Restaurant and cafe is off by default. Turn it on in Settings if you want it.</p>
        </fieldset>
        <Checkbox label="Refresh: ignore cached responses younger than 24 hours" checked={refresh} onChange={e => { setEst(null); setRefresh(e.target.checked); }} data-testid="checkbox-refresh" />
        {est && <div className="rounded-lg border border-border p-4 text-sm" data-testid="card-estimate">
          <div className="font-medium">Before you run</div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div><dt className="text-xs text-muted-foreground">Categories</dt><dd className="tabular">{est.pairCount}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Queries planned</dt><dd className="tabular" data-testid="text-queries-planned">{est.queriesPlanned ?? est.pairCount}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Requests, upper bound</dt><dd className="tabular" data-testid="text-requests-estimated">{est.requestsEstimated}</dd></div>
            <div><dt className="text-xs text-muted-foreground">From cache</dt><dd className="tabular">{est.cachedCategories?.length ?? 0}</dd></div>
          </dl>
          {!!est.cachedCategories?.length && <p className="mt-2 text-xs text-muted-foreground">Cached: {est.cachedCategories.join(', ')}</p>}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">One Overpass query per category, run one at a time with at least 5 seconds between them. The upper bound includes the bounding-box fallback if the Kuala Lumpur boundary returns nothing, and one retry after 30 seconds on a 429 or 504. Responses are cached for 24 hours.</p>
        </div>}
        {error && <Notice tone="risk">{error}</Notice>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={close} data-testid="button-cancel-import">Cancel</Button>
          {!est ? <Button variant="primary" disabled={!selected.length || estimate.isPending} onClick={doEstimate} data-testid="button-estimate">{estimate.isPending ? 'Planning' : 'Review queries'}</Button>
            : <Button variant="primary" disabled={start.isPending} onClick={run} data-testid="button-run-import">{start.isPending ? 'Starting' : `Run ${est.queriesPlanned ?? est.pairCount} ${(est.queriesPlanned ?? est.pairCount) === 1 ? 'query' : 'queries'}`}</Button>}
        </div>
      </div>}
  </Modal>;
}

export function AddCompanyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateCompany();
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) || '').trim();
    const errs: Record<string, string> = {};
    if (get('name').length < 2) errs.name = 'Enter the company name.';
    let website = get('websiteUrl');
    if (!website) errs.websiteUrl = 'Website is required.';
    else { if (!/^https?:\/\//i.test(website)) website = `https://${website}`; try { new URL(website); } catch { errs.websiteUrl = 'This does not look like a valid web address.'; } }
    setErrors(errs); setServerError('');
    if (Object.keys(errs).length) return;
    create.mutate({ data: { name: get('name'), websiteUrl: website, area: get('area') || undefined, keyword: get('keyword') || undefined, address: get('address') || undefined, phone: get('phone') || null } }, {
      onSuccess: () => { qc.invalidateQueries(); onClose(); },
      onError: err => setServerError(errorMessage(err, 'The company could not be created.')),
    });
  };
  return <Modal open={open} title="Add company" onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field label="Name" error={errors.name}><Input name="name" aria-invalid={!!errors.name} data-testid="input-company-name" /></Field>
      <Field label="Website" error={errors.websiteUrl} hint="Checks run in the background after saving."><Input name="websiteUrl" placeholder="example.com.my" aria-invalid={!!errors.websiteUrl} data-testid="input-company-website" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Area (optional)"><Input name="area" data-testid="input-company-area" /></Field>
        <Field label="Category (optional)"><Input name="keyword" data-testid="input-company-keyword" /></Field>
        <Field label="Phone (optional)"><Input name="phone" data-testid="input-company-phone" /></Field>
        <Field label="Address (optional)"><Input name="address" data-testid="input-company-address" /></Field>
      </div>
      {serverError && <Notice tone="risk">{serverError}</Notice>}
      <div className="flex justify-end gap-2"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" disabled={create.isPending} data-testid="button-save-company">{create.isPending ? 'Saving' : 'Add and check'}</Button></div>
    </form>
  </Modal>;
}

export function PasteListModal({ open, onClose, onJobs }: { open: boolean; onClose: () => void; onJobs: (ids: string[]) => void }) {
  const paste = usePasteCompanies();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [result, setResult] = useState<PasteResult | null>(null);
  const [error, setError] = useState('');
  const lines = text.split('\n').filter(l => l.trim()).length;
  const submit = () => {
    setError(''); setResult(null);
    if (!text.trim()) { setError('Paste at least one line.'); return; }
    if (text.length > 20000) { setError('That is too long. Keep it under 20,000 characters.'); return; }
    paste.mutate({ data: { text } }, {
      onSuccess: r => { setResult(r); qc.invalidateQueries(); if (r.jobIds.length) onJobs(r.jobIds); if (!r.errors.length) setText(''); },
      onError: e => setError(errorMessage(e, 'The list could not be imported.')),
    });
  };
  return <Modal open={open} title="Paste list" onClose={() => { setResult(null); setError(''); onClose(); }}>
    <div className="grid gap-4">
      <Field label="One company per line" hint={`Format: name, website, area. ${lines} ${lines === 1 ? 'line' : 'lines'}.`} error={error}>
        <Textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder={'Klinik Pergigian Seri, seridental.com.my, Bangsar\nTan & Partners Law, tanpartners.my, KLCC'} aria-invalid={!!error} data-testid="input-paste-list" />
      </Field>
      {result && <Notice tone={result.errors.length ? 'warn' : 'info'}>
        <div data-testid="text-paste-created">{result.created} created, {result.jobIds.length} check {result.jobIds.length === 1 ? 'job' : 'jobs'} queued.</div>
        {result.errors.length > 0 && <ul className="mt-2 list-inside list-disc">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      </Notice>}
      <div className="flex justify-end gap-2"><Button onClick={onClose}>Close</Button><Button variant="primary" disabled={paste.isPending} onClick={submit} data-testid="button-submit-paste">{paste.isPending ? 'Adding' : 'Add companies'}</Button></div>
    </div>
  </Modal>;
}

export function JobList({ ids, onDismiss }: { ids: string[]; onDismiss: (id: string) => void }) {
  if (!ids.length) return null;
  return <div className="mb-6 space-y-3">{ids.map(id => <JobProgress key={id} jobId={id} compact={ids.length > 1} onDismiss={() => onDismiss(id)} />)}</div>;
}
