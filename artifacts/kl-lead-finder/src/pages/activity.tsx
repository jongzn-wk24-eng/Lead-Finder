import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { getListActivityQueryKey, getListCompaniesQueryKey, getListFollowupsQueryKey, useListActivity, useListCompanies, useListFollowups } from '@workspace/api-client-react';
import type { ActivityItem, ListActivityParams } from '@workspace/api-client-react';
import { ATTRIBUTION, Button, EmptyState, ErrorState, Input, Notice, PageHeader, SectionHead, Select, Skeleton, Surface, dateLabel, dateTimeLabel, dueByToday } from '@/components/kit';

const actions = [['imported', 'Imported'], ['generated', 'Draft generated'], ['copied_email', 'Email copied'], ['copied_whatsapp', 'WhatsApp copied'], ['marked_sent', 'Marked sent'], ['reply_logged', 'Reply logged'], ['status_changed', 'Status changed'], ['marked_do_not_contact', 'Marked do not contact'], ['note_added', 'Note added']] as const;
const label = (a: string) => actions.find(x => x[0] === a)?.[1] || a;

function csvCell(v: unknown) {
  let t = String(v ?? '');
  if (/^[\s]*[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportActivity(rows: ActivityItem[]) {
  const lines = [`# ${ATTRIBUTION}`, ['Timestamp', 'Company ID', 'Company', 'Action', 'Channel', 'Sequence', 'Note'].map(csvCell).join(','),
    ...rows.map(r => [r.timestamp, r.companyId, r.companyName, label(r.action), r.channel, r.sequenceNo, r.note].map(csvCell).join(','))];
  saveBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), `kl-lead-activity-${new Date().toISOString().slice(0, 10)}.csv`);
}
export async function exportEndpoint(type: 'companies' | 'outreach') {
  const res = await fetch(`/api/export.csv?type=${type}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Export failed (${res.status}).`);
  saveBlob(await res.blob(), `kl-lead-${type}-${new Date().toISOString().slice(0, 10)}.csv`);
}

export default function ActivityPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [channel, setChannel] = useState('');
  const [date, setDate] = useState('');
  const [exportErr, setExportErr] = useState('');
  const params: ListActivityParams = { ...(search.trim() ? { search: search.trim() } : {}), ...(action ? { action } : {}), ...(channel ? { channel } : {}), ...(date ? { date } : {}) };
  const activity = useListActivity(params, { query: { queryKey: getListActivityQueryKey(params) } });
  const followups = useListFollowups({ query: { queryKey: getListFollowupsQueryKey() } });
  const claimedParams = { status: 'Claimed', showAll: true };
  const claimed = useListCompanies(claimedParams, { query: { queryKey: getListCompaniesQueryKey(claimedParams) } });
  const due = useMemo(() => (followups.data || []).filter(f => dueByToday(f.dueAt)), [followups.data]);
  const rows = activity.data || [];
  const refs = useRef<Array<HTMLTableRowElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, i: number, r: ActivityItem) => {
    const go = (n: number) => { e.preventDefault(); refs.current[Math.max(0, Math.min(rows.length - 1, n))]?.focus(); };
    if (e.key === 'ArrowDown' || e.key === 'j') go(i + 1); else if (e.key === 'ArrowUp' || e.key === 'k') go(i - 1);
    else if (e.key === 'Enter') { e.preventDefault(); navigate(`/companies/${r.companyId}`); }
  };
  const runExport = (t: 'companies' | 'outreach') => { setExportErr(''); exportEndpoint(t).catch(e => setExportErr(e instanceof Error ? e.message : 'Export failed.')); };

  return <div>
    <PageHeader title="Activity" sub="Exactly whose message you copied, and whom you actually sent to."
      right={<div className="flex flex-wrap gap-2"><Button variant="primary" disabled={!rows.length} onClick={() => exportActivity(rows)} data-testid="button-export-activity">Export CSV</Button><Button onClick={() => runExport('companies')} data-testid="button-export-companies">Companies CSV</Button><Button onClick={() => runExport('outreach')} data-testid="button-export-outreach">Outreach CSV</Button></div>} />
    {exportErr && <Notice tone="risk" className="mb-4">{exportErr}</Notice>}

    <div className="mb-6 grid gap-6 lg:grid-cols-2">
      <Surface>
        <SectionHead title="Due today" sub="Follow-ups are never sent automatically." />
        {followups.isLoading ? <div className="space-y-2 p-6"><Skeleton className="h-4" /><Skeleton className="h-4" /></div> : followups.isError ? <div className="p-6 text-sm">Could not load. <button className="text-primary underline" onClick={() => followups.refetch()}>Retry</button></div>
          : due.length === 0 ? <EmptyState text="No follow-ups due today." /> : <ul className="divide-y divide-border">{due.map(f => <li key={`${f.companyId}-${f.sequenceNo}`}><Link href={`/companies/${f.companyId}`} className="flex h-12 items-center justify-between gap-3 px-4 text-sm hover:bg-muted sm:px-6" data-testid={`link-due-${f.companyId}`}><span className="truncate">{f.companyName}</span><span className="shrink-0 text-[13px] text-muted-foreground">{f.channel} #{f.sequenceNo} · {dateLabel(f.dueAt)}</span></Link></li>)}</ul>}
      </Surface>
      <Surface>
        <SectionHead title="Claimed but not marked sent" sub="Confirm what you really sent." />
        {claimed.isLoading ? <div className="space-y-2 p-6"><Skeleton className="h-4" /><Skeleton className="h-4" /></div> : claimed.isError ? <div className="p-6 text-sm">Could not load. <button className="text-primary underline" onClick={() => claimed.refetch()}>Retry</button></div>
          : !(claimed.data || []).length ? <EmptyState text="Nothing waiting for confirmation." /> : <ul className="divide-y divide-border">{(claimed.data || []).filter(c => !c.isDoNotContact).map(c => <li key={c.id}><Link href={`/companies/${c.id}`} className="flex h-12 items-center justify-between gap-3 px-4 text-sm hover:bg-muted sm:px-6" data-testid={`link-claimed-${c.id}`}><span className="truncate">{c.name}</span><span className="shrink-0 text-[13px] text-muted-foreground">{c.area}</span></Link></li>)}</ul>}
      </Surface>
    </div>

    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Input placeholder="Search company" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search company" data-testid="input-activity-search" />
      <Select value={action} onChange={e => setAction(e.target.value)} aria-label="Action" data-testid="select-activity-action"><option value="">All actions</option>{actions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      <Select value={channel} onChange={e => setChannel(e.target.value)} aria-label="Channel" data-testid="select-activity-channel"><option value="">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></Select>
      <Input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" data-testid="input-activity-date" />
    </div>

    {activity.isError ? <ErrorState onRetry={() => activity.refetch()} /> : <Surface className="overflow-hidden">
      {activity.isLoading ? <div className="divide-y divide-border">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="flex h-12 items-center gap-4 px-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-40" /><Skeleton className="h-4 flex-1" /></div>)}</div>
        : rows.length === 0 ? <EmptyState text="No activity matches." action={(search || action || channel || date) ? <Button size="sm" onClick={() => { setSearch(''); setAction(''); setChannel(''); setDate(''); }}>Clear filters</Button> : undefined} />
        : <>
          <div className="hidden max-h-[70dvh] overflow-auto md:block"><table className="w-full table-fixed text-sm">
            <colgroup><col className="w-[150px]" /><col className="w-[26%]" /><col className="w-[18%]" /><col className="w-[110px]" /><col /></colgroup>
            <thead className="sticky top-0 bg-card"><tr className="h-12 border-b border-border text-left text-[13px] text-muted-foreground"><th className="px-4 font-normal">Time</th><th className="px-3 font-normal">Company</th><th className="px-3 font-normal">Action</th><th className="px-3 font-normal">Channel</th><th className="px-4 font-normal">Note</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={r.id} ref={el => { refs.current[i] = el; }} tabIndex={0} onKeyDown={e => onKey(e, i, r)} className="h-12 border-b border-border outline-none last:border-0 hover:bg-[#fafaf9] focus:bg-accent/60" data-testid={`row-activity-${r.id}`}>
              <td className="px-4 text-[13px] text-muted-foreground tabular">{dateTimeLabel(r.timestamp)}</td>
              <td className="truncate px-3"><Link href={`/companies/${r.companyId}`} tabIndex={-1} className="hover:text-primary">{r.companyName}</Link></td>
              <td className="px-3">{label(r.action)}</td>
              <td className="px-3 text-muted-foreground">{r.channel ? `${r.channel === 'email' ? 'Email' : 'WhatsApp'}${r.sequenceNo ? ` #${r.sequenceNo}` : ''}` : '-'}</td>
              <td className="truncate px-4 text-muted-foreground" title={r.note}>{r.note || '-'}</td>
            </tr>)}</tbody>
          </table></div>
          <ul className="divide-y divide-border md:hidden">{rows.map(r => <li key={r.id} className="p-4"><div className="flex justify-between gap-3 text-sm"><Link href={`/companies/${r.companyId}`} className="font-medium">{r.companyName}</Link><span className="shrink-0 text-xs text-muted-foreground">{dateTimeLabel(r.timestamp)}</span></div><div className="mt-1 text-[13px]">{label(r.action)}{r.channel ? ` · ${r.channel}` : ''}{r.sequenceNo ? ` #${r.sequenceNo}` : ''}</div>{r.note && <div className="mt-1 text-[13px] text-muted-foreground">{r.note}</div>}</li>)}</ul>
        </>}
    </Surface>}
  </div>;
}
