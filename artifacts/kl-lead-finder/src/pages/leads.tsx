import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { getGetSettingsQueryKey, getListCompaniesQueryKey, useGetSettings, useListCompanies } from '@workspace/api-client-react';
import type { Company, ListCompaniesParams } from '@workspace/api-client-react';
import { EmailPanel } from '@/components/email-panel';
import { AddCompanyModal, JobList, OSM_LIMITS, OsmImportModal, PasteListModal } from '@/components/import-tools';
import { useDemoMode } from '@/components/data-mode';
import { Button, Checkbox, Chip, EmptyState, ErrorState, Input, PageHeader, STATUSES, ScoreBar, Select, Skeleton, StatusChip, Surface, waDigits } from '@/components/kit';

function ContactMarks({ c }: { c: Company }) {
  const wa = !!(waDigits(c.whatsapp) || (c.phoneIsMobile !== false && waDigits(c.phone)));
  const items: Array<[string, boolean]> = [['Email', !!c.email], ['WhatsApp', wa], ['Phone', !!c.phone]];
  return <div className="flex flex-wrap gap-x-2 text-xs">{items.map(([l, on]) => <span key={l} className={on ? 'text-foreground' : 'text-[#c4c3c1] line-through'} aria-label={`${l} ${on ? 'available' : 'missing'}`}>{l}</span>)}</div>;
}
function Flags({ c }: { c: Company }) {
  return <>
    {c.isChain && <Chip className="ml-1.5 h-5 text-[11px]">Large chain</Chip>}
    {c.source === 'google_places' && <Chip className="ml-1.5 h-5 text-[11px]">Archived Google</Chip>}
    {c.osmStale && <Chip tone="warn" className="ml-1.5 h-5 text-[11px]">Stale</Chip>}
  </>;
}
function reasonsOf(c: Company) {
  const r = c.reasons.slice(0, 2);
  if (!r.length && !c.websiteUrl && !c.websiteConfirmedNone) return ['No website listed (unverified)'];
  return r;
}

export default function LeadsPage() {
  const demo = useDemoMode();
  const [, navigate] = useLocation();
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [area, setArea] = useState('');
  const [website, setWebsite] = useState('');
  const [contact, setContact] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [panelId, setPanelId] = useState<number | null>(null);
  const [modal, setModal] = useState<'' | 'osm' | 'add' | 'paste'>('');
  const [jobs, setJobs] = useState<string[]>([]);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

  const params: ListCompaniesParams & { keyword?: string } = { showAll, ...(category ? { keyword: category } : {}), ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status } : {}), ...(area ? { area } : {}), ...(website ? { hasWebsite: website === 'yes' } : {}), ...(contact ? { hasContact: contact === 'yes' } : {}) };
  const list = useListCompanies(params, { query: { queryKey: getListCompaniesQueryKey(params) } });
  const rows = useMemo(() => (list.data || []).filter(c => !category || c.keyword === category).slice().sort((a, b) => b.opportunityScore - a.opportunityScore), [list.data, category]);
  const categories = useMemo(() => Array.from(new Set([...(settings.data?.categories || []).map(c => c.label), ...(list.data || []).map(c => c.keyword).filter(Boolean)])).sort(), [settings.data, list.data]);
  const areas = useMemo(() => [...(settings.data?.areaCentres || []).map(a => a.label), 'Other KL'], [settings.data]);
  const minValue = settings.data?.minValue ?? 10;
  const minProblem = settings.data?.minProblem ?? 25;
  const filtersOn = !!(search || status || category || area || website || contact);

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, i: number, c: Company) => {
    const move = (n: number) => { e.preventDefault(); rowRefs.current[Math.max(0, Math.min(rows.length - 1, n))]?.focus(); };
    if (e.key === 'ArrowDown' || e.key === 'j') move(i + 1);
    else if (e.key === 'ArrowUp' || e.key === 'k') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(rows.length - 1);
    else if (e.key === 'Enter') { e.preventDefault(); navigate(`/companies/${c.id}`); }
    else if (e.key === 'e' && !c.isDoNotContact) { e.preventDefault(); setPanelId(c.id); }
  };
  const clear = () => { setSearch(''); setStatus(''); setCategory(''); setArea(''); setWebsite(''); setContact(''); };

  return <div>
    <PageHeader title="Leads" sub={showAll ? 'Showing every company, including large chains. Do not contact companies never get outreach actions.' : `Value ${minValue} or more and problem ${minProblem} or more, large chains hidden.`}
      right={<div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setModal('osm')} disabled={demo} title={demo ? 'Switch to real mode to import' : undefined} data-testid="button-open-import">Import from OpenStreetMap</Button>
        <Button onClick={() => setModal('add')} disabled={demo} data-testid="button-add-company">Add company</Button>
        <Button onClick={() => setModal('paste')} disabled={demo} data-testid="button-paste-list">Paste list</Button>
      </div>} />
    <p className="-mt-3 mb-6 text-[13px] text-muted-foreground">{OSM_LIMITS}</p>

    <JobList ids={jobs} onDismiss={id => setJobs(j => j.filter(x => x !== id))} />

    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(5,1fr)]">
      <Input placeholder="Search name" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search companies" data-testid="input-search" />
      <Select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status" data-testid="select-status"><option value="">All statuses</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</Select>
      <Select value={category} onChange={e => setCategory(e.target.value)} aria-label="Category" data-testid="select-category"><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</Select>
      <Select value={area} onChange={e => setArea(e.target.value)} aria-label="Area" data-testid="select-area"><option value="">All areas</option>{areas.map(a => <option key={a}>{a}</option>)}</Select>
      <Select value={website} onChange={e => setWebsite(e.target.value)} aria-label="Website" data-testid="select-website"><option value="">Any website</option><option value="yes">Website known</option><option value="no">Website not known</option></Select>
      <Select value={contact} onChange={e => setContact(e.target.value)} aria-label="Contact" data-testid="select-contact"><option value="">Any contact</option><option value="yes">Has contact</option><option value="no">No contact</option></Select>
    </div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <Checkbox label="Show all" checked={showAll} onChange={e => setShowAll(e.target.checked)} data-testid="toggle-show-all" />
      <span className="text-[13px] text-muted-foreground tabular" data-testid="text-lead-count">{list.isLoading ? '' : `${rows.length} ${rows.length === 1 ? 'company' : 'companies'}`}<span className="ml-3 hidden lg:inline">Arrow keys to move, Enter to open, E for email</span></span>
    </div>

    {list.isError ? <ErrorState onRetry={() => list.refetch()} />
      : <Surface className="overflow-hidden">
        {list.isLoading ? <div className="divide-y divide-border">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="flex h-12 items-center gap-4 px-4"><Skeleton className="h-4 w-1/4" /><Skeleton className="h-4 w-16" /><Skeleton className="h-4 flex-1" /></div>)}</div>
          : rows.length === 0 ? <EmptyState text={filtersOn ? 'No companies match these filters.' : showAll ? 'No companies yet.' : 'No companies pass the default thresholds.'}
            action={filtersOn ? <Button size="sm" onClick={clear} data-testid="button-clear-filters">Clear filters</Button> : !showAll ? <Button size="sm" onClick={() => setShowAll(true)} data-testid="button-empty-show-all">Show all</Button> : !demo ? <Button size="sm" variant="primary" onClick={() => setModal('osm')}>Import from OpenStreetMap</Button> : undefined} />
          : <>
            <div className="hidden max-h-[70dvh] overflow-auto md:block">
              <table className="w-full table-fixed text-sm">
                <colgroup><col className="w-[28%]" /><col className="w-[11%]" /><col /><col className="w-[15%]" /><col className="w-[12%]" /><col className="w-[110px]" /></colgroup>
                <thead className="sticky top-0 z-10 bg-card"><tr className="h-12 border-b border-border text-left text-[13px] text-muted-foreground">
                  <th className="px-4 font-normal">Company</th><th className="px-3 text-right font-normal">Opportunity</th><th className="px-3 font-normal">Why it is here</th><th className="px-3 font-normal">Contact</th><th className="px-3 font-normal">Status</th><th className="px-4 text-right font-normal">Action</th>
                </tr></thead>
                <tbody>{rows.map((c, i) => <tr key={c.id} ref={el => { rowRefs.current[i] = el; }} tabIndex={0} onKeyDown={e => onRowKey(e, i, c)} data-testid={`row-company-${c.id}`}
                  className="h-12 border-b border-border outline-none last:border-0 hover:bg-[#fafaf9] focus:bg-accent/60">
                  <td className="px-4 py-2"><Link href={`/companies/${c.id}`} tabIndex={-1} className="block truncate font-medium hover:text-primary" data-testid={`link-company-${c.id}`}>{c.name}<Flags c={c} /></Link><div className="truncate text-xs text-muted-foreground">{c.area} · {c.keyword || 'Uncategorised'}</div></td>
                  <td className="px-3"><ScoreBar value={c.opportunityScore} max={100} /></td>
                  <td className="px-3 text-[13px]"><ul className="space-y-0.5">{reasonsOf(c).map((r, j) => <li key={j} className="truncate" title={r}>{r}</li>)}</ul></td>
                  <td className="px-3"><ContactMarks c={c} /></td>
                  <td className="px-3"><StatusChip status={c.isDoNotContact ? 'Do not contact' : c.status} /></td>
                  <td className="px-4 text-right">{c.isDoNotContact ? <span className="text-xs text-muted-foreground">No action</span> : <Button size="sm" tabIndex={-1} onClick={() => setPanelId(c.id)} data-testid={`button-get-email-${c.id}`}>Get email</Button>}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <ul className="divide-y divide-border md:hidden">{rows.map(c => <li key={c.id} className="p-4" data-testid={`card-company-${c.id}`}>
              <div className="flex items-start justify-between gap-3"><Link href={`/companies/${c.id}`} className="min-w-0"><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.area} · {c.keyword || 'Uncategorised'}</div></Link><StatusChip status={c.isDoNotContact ? 'Do not contact' : c.status} /></div>
              <div className="mt-1"><Flags c={c} /></div>
              <ScoreBar value={c.opportunityScore} max={100} className="mt-3" />
              <ul className="mt-3 space-y-0.5 text-[13px]">{reasonsOf(c).map((r, j) => <li key={j}>{r}</li>)}</ul>
              <div className="mt-3 flex items-center justify-between"><ContactMarks c={c} />{!c.isDoNotContact && <Button size="sm" onClick={() => setPanelId(c.id)}>Get email</Button>}</div>
            </li>)}</ul>
          </>}
      </Surface>}

    <EmailPanel companyId={panelId} open={panelId != null} onClose={() => setPanelId(null)} />
    <OsmImportModal open={modal === 'osm'} onClose={() => setModal('')} onJob={id => setJobs(j => [id, ...j])} />
    <AddCompanyModal open={modal === 'add'} onClose={() => setModal('')} />
    <PasteListModal open={modal === 'paste'} onClose={() => setModal('')} onJobs={ids => setJobs(j => [...ids, ...j])} />
  </div>;
}
