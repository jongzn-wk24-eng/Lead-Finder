import { Link } from 'wouter';
import {
  getGetDashboardQueryKey, getListActivityQueryKey, getListFollowupsQueryKey,
  useGetDashboard, useListActivity, useListFollowups,
} from '@workspace/api-client-react';
import { useDemoMode } from '@/components/data-mode';
import { EmptyState, ErrorState, PageHeader, PageSkeleton, STATUSES, SectionHead, Surface, cx, dateLabel, dueByToday, klDay } from '@/components/kit';

function pct(n: number | null | undefined) { return n == null ? null : `${(n * 100).toFixed(1)}%`; }

function Quota({ label, value, max }: { label: string; value: number; max: number }) {
  const reached = max > 0 && value >= max;
  return <div data-testid={`quota-${label.toLowerCase()}`}>
    <div className="flex items-baseline justify-between"><span className="text-[13px] text-muted-foreground">{label} sent today</span><span className="text-2xl font-medium tabular">{value}<span className="text-sm text-muted-foreground"> / {max}</span></span></div>
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#efedeb]"><div className={cx('h-full rounded-full', reached ? 'bg-[#b8863a]' : 'bg-primary')} style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>
    {reached && <p role="alert" className="mt-2 text-[13px] text-[#5c4515]">Daily limit reached. Stop sending {label.toLowerCase()} for today.</p>}
  </div>;
}

const statusShade = ['#2F5BEA', '#5f80ef', '#8fa6f3', '#b7c6f7', '#d7e0fb', '#6B6B70', '#9a9a9e', '#c4c3c1', '#e0dedb', '#ece9e6', '#a8857d', '#d6d3d1'];

export default function DataCenterPage() {
  const demo = useDemoMode();
  const dash = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });
  const followups = useListFollowups({ query: { queryKey: getListFollowupsQueryKey() } });
  const imports = useListActivity({ action: 'imported' }, { query: { queryKey: getListActivityQueryKey({ action: 'imported' }) } });
  if (dash.isLoading) return <PageSkeleton />;
  if (dash.isError || !dash.data) return <ErrorState onRetry={() => dash.refetch()} />;
  const d = dash.data;
  const due = (followups.data || []).filter(f => dueByToday(f.dueAt));
  const weekAgo = klDay(new Date(Date.now() - 6 * 86400000));
  const serverImports = (d as { importsThisWeek?: number }).importsThisWeek;
  const importsWeek = typeof serverImports === 'number' ? serverImports : (imports.data || []).filter(a => klDay(new Date(a.timestamp)) >= weekAgo).length;
  const statusRows = STATUSES.map((s, i) => ({ status: s, color: statusShade[i], count: d.byStatus.find(b => b.status === s)?.count ?? 0 })).filter(r => r.count > 0);
  const statusTotal = statusRows.reduce((a, r) => a + r.count, 0);
  const seq = [1, 2, 3].map(n => d.bySequence.find(b => b.sequenceNo === n)?.count ?? 0);

  return <div>
    <PageHeader title="Data Center" sub={demo ? 'Demo data only.' : 'Today, at a glance.'} right={<Link href="/leads" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-[#2850d4]" data-testid="link-open-leads">Open leads</Link>} />
    {d.totals.companies === 0 && <Surface className="mb-6"><EmptyState text={demo ? 'No demo companies. Load demo data in Settings.' : 'No companies yet. Import from OpenStreetMap to start.'} action={<Link href={demo ? '/settings' : '/leads'} className="text-sm font-medium text-primary underline-offset-2 hover:underline" data-testid="link-empty-action">{demo ? 'Go to Settings' : 'Go to Leads'}</Link>} /></Surface>}

    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Surface><SectionHead title="Today" sub="Malaysia time" /><div className="grid gap-6 p-4 sm:p-6"><Quota label="Emails" value={d.sentToday.email} max={d.limits.email} /><Quota label="WhatsApp" value={d.sentToday.whatsapp} max={d.limits.whatsapp} /></div></Surface>
      <Surface>
        <SectionHead title="Follow-ups due today" sub="Nothing is sent automatically." right={<Link href="/activity" className="text-[13px] text-primary hover:underline" data-testid="link-all-followups">Activity</Link>} />
        {followups.isLoading ? <div className="space-y-2 p-6"><div className="h-4 animate-pulse rounded bg-[#efedeb]" /><div className="h-4 animate-pulse rounded bg-[#efedeb]" /></div>
          : followups.isError ? <div className="p-6 text-sm">Follow-ups could not load. <button className="text-primary underline" onClick={() => followups.refetch()}>Retry</button></div>
          : due.length === 0 ? <EmptyState text="Nothing due today." />
          : <ul className="divide-y divide-border">{due.slice(0, 8).map(f => <li key={`${f.companyId}-${f.sequenceNo}`}><Link href={`/companies/${f.companyId}`} className="flex h-12 items-center justify-between gap-3 px-4 text-sm hover:bg-muted sm:px-6" data-testid={`link-followup-${f.companyId}`}><span className="truncate">{f.companyName} <span className="text-muted-foreground">· {f.area}</span></span><span className="shrink-0 text-[13px] text-muted-foreground">{f.channel} #{f.sequenceNo} · {dateLabel(f.dueAt)}</span></Link></li>)}</ul>}
      </Surface>
    </div>

    <Surface className="mt-6">
      <SectionHead title="Totals" />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 p-4 sm:grid-cols-4 sm:p-6">
        {([
          ['Companies collected', d.totals.companies], ['Contacted', d.totals.contacted], ['Replies', d.totals.replies], ['Reply rate', pct(d.totals.replyRate) ?? 'Not enough data'],
          ['Wants hero', d.totals.wantsHero], ['Hero sent', d.totals.heroSent], ['Won', d.totals.won], ['WhatsApp sent', d.totals.whatsappSent],
        ] as Array<[string, number | string]>).map(([l, v]) => <div key={l}><dt className="text-[13px] text-muted-foreground">{l}</dt><dd className="mt-1 text-xl font-medium tabular" data-testid={`total-${l.toLowerCase().replace(/\s+/g, '-')}`}>{v}</dd></div>)}
      </dl>
      <div className="border-t border-border p-4 sm:p-6">
        <div className="mb-2 text-[13px] text-muted-foreground">By status</div>
        {statusTotal === 0 ? <p className="text-sm text-muted-foreground">No companies yet.</p> : <>
          <div className="flex h-2 overflow-hidden rounded-full" role="img" aria-label="Companies by status">{statusRows.map(r => <div key={r.status} style={{ width: `${(r.count / statusTotal) * 100}%`, background: r.color }} />)}</div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">{statusRows.map(r => <li key={r.status} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />{r.status} <span className="text-muted-foreground tabular">{r.count}</span></li>)}</ul>
        </>}
      </div>
      <div className="grid gap-6 border-t border-border p-4 sm:grid-cols-2 sm:p-6">
        <div><div className="mb-2 text-[13px] text-muted-foreground">Emails sent by sequence</div><div className="flex gap-8">{seq.map((n, i) => <div key={i}><div className="text-xs text-muted-foreground">Email {i + 1}</div><div className="text-lg font-medium tabular">{n}</div></div>)}</div></div>
        <div><div className="mb-2 text-[13px] text-muted-foreground">Usage</div><div className="flex gap-8"><div><div className="text-xs text-muted-foreground">Imports this week</div><div className="text-lg font-medium tabular" data-testid="text-imports-week">{typeof serverImports !== 'number' && imports.isLoading ? '-' : importsWeek}</div></div><div><div className="text-xs text-muted-foreground">AI calls today</div><div className="text-lg font-medium tabular" data-testid="text-ai-calls">{d.aiCallsToday}</div></div></div></div>
      </div>
    </Surface>

    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <RateTable title="Reply rate by finding type" rows={d.replyRatesByFindingType.map(r => ({ key: r.findingType, sent: r.sent, replied: r.replied, rate: r.replyRate }))} />
      <RateTable title="Reply rate by channel" rows={d.replyRatesByChannel.map(r => ({ key: r.channel, sent: r.sent, replied: r.replied, rate: r.replyRate }))} />
    </div>
  </div>;
}

function RateTable({ title, rows }: { title: string; rows: Array<{ key: string; sent: number; replied: number; rate: number | null }> }) {
  const enough = rows.some(r => r.sent > 0);
  return <Surface>
    <SectionHead title={title} />
    {!enough ? <EmptyState text="Not enough data yet." /> : <table className="w-full text-sm">
      <thead><tr className="h-10 border-b border-border text-left text-[13px] text-muted-foreground"><th className="px-4 font-normal sm:px-6">Group</th><th className="px-3 text-right font-normal">Sent</th><th className="px-3 text-right font-normal">Replied</th><th className="px-4 text-right font-normal sm:px-6">Rate</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.key} className="h-12 border-b border-border last:border-0"><td className="px-4 sm:px-6">{r.key || 'Unknown'}</td><td className="px-3 text-right tabular">{r.sent}</td><td className="px-3 text-right tabular">{r.replied}</td><td className="px-4 text-right tabular sm:px-6">{pct(r.rate) ?? '-'}</td></tr>)}</tbody>
    </table>}
  </Surface>;
}
