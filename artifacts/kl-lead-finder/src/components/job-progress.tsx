import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSearchJobQueryKey, useCancelSearchJob, useGetSearchJob } from '@workspace/api-client-react';
import type { ImportSummary, ResearchJob } from '@workspace/api-client-react';
import { Button, Notice, Skeleton, Surface, cx } from '@/components/kit';

const kindLabel: Record<string, string> = {
  osm_import: 'OpenStreetMap import', osm_refresh: 'OpenStreetMap refresh', recheck: 'Website check',
  search: 'Archived search job', google_refresh: 'Archived Google job',
};
const active = (job?: ResearchJob) => job?.status === 'queued' || job?.status === 'running';

export function JobProgress({ jobId, onDone, onDismiss, compact = false }: { jobId: string; onDone?: (job: ResearchJob) => void; onDismiss?: () => void; compact?: boolean }) {
  const qc = useQueryClient();
  const job = useGetSearchJob(jobId, { query: { queryKey: getGetSearchJobQueryKey(jobId), enabled: !!jobId, refetchInterval: q => (active(q.state.data) || !q.state.data ? 1500 : false) } });
  const cancel = useCancelSearchJob();
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const notified = useRef(false);
  const j = job.data;
  useEffect(() => {
    if (j && !active(j) && !notified.current) {
      notified.current = true;
      qc.invalidateQueries();
      doneRef.current?.(j);
    }
  }, [j, qc]);
  if (job.isLoading) return <Surface className="p-4"><Skeleton className="h-4 w-48" /><Skeleton className="mt-3 h-1 w-full" /></Surface>;
  if (job.isError || !j) return <Notice tone="risk">Progress for this job could not be loaded. <button className="underline" onClick={() => job.refetch()}>Retry</button></Notice>;
  const pct = j.total ? Math.min(100, (j.completed / j.total) * 100) : active(j) ? 5 : 100;
  return <Surface className={cx(compact ? 'p-3' : 'p-4 sm:p-5')} data-testid={`job-${j.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{kindLabel[j.kind] || j.kind} <span className="font-normal text-muted-foreground">· {j.status}</span></div>
        <div className="mt-0.5 truncate text-[13px] text-muted-foreground" data-testid="text-job-phase">{j.phase}{j.currentLabel ? `: ${j.currentLabel}` : ''}</div>
      </div>
      <div className="flex gap-2">
        {active(j) && <Button size="sm" disabled={cancel.isPending} data-testid="button-cancel-job" onClick={() => cancel.mutate({ jobId: j.id }, { onSuccess: () => job.refetch() })}>Cancel</Button>}
        {!active(j) && onDismiss && <Button size="sm" variant="text" onClick={onDismiss} data-testid="button-dismiss-job">Dismiss</Button>}
      </div>
    </div>
    <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#efedeb]"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
    <div className="mt-2 text-xs text-muted-foreground tabular">{j.completed} of {j.total || '?'} steps · {j.requestsMade} of at most {j.requestsEstimated} requests made</div>
    {j.error && <Notice tone={j.status === 'failed' ? 'risk' : 'warn'} className="mt-3">{j.error}{j.status === 'failed' ? ' Any results already received were saved.' : ''}</Notice>}
    {j.summary && !active(j) && <ImportSummaryCard summary={j.summary} />}
    {!j.summary && !active(j) && j.status === 'completed' && <div className="mt-3 text-[13px] text-muted-foreground">{j.newCompanies} new, {j.updatedCompanies} updated, {j.skippedCompanies} skipped{j.checksFailed ? `, ${j.checksFailed} checks failed` : ''}.</div>}
  </Surface>;
}

export function ImportSummaryCard({ summary }: { summary: ImportSummary }) {
  const reasons = Object.entries(summary.filterReasons || {}).filter(([, n]) => n > 0);
  const cells: Array<[string, number]> = [['Found', summary.found], ['New', summary.newCount], ['Duplicates skipped', summary.duplicates], ['Filtered out', summary.filtered], ['With website tag', summary.withWebsite], ['With phone', summary.withPhone], ['With email', summary.withEmail]];
  return <div className="mt-4 border-t border-border pt-4" data-testid="card-import-summary">
    <div className="mb-3 text-[13px] font-medium">Import summary {summary.cached && <span className="font-normal text-muted-foreground">· served from the 24 hour cache, no new query</span>}</div>
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      {cells.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-medium tabular" data-testid={`summary-${label.toLowerCase().replace(/\s+/g, '-')}`}>{value}</dd></div>)}
    </dl>
    {reasons.length > 0 && <div className="mt-3 text-[13px] text-muted-foreground">Filtered because: {reasons.map(([r, n]) => `${r} (${n})`).join(', ')}</div>}
    {summary.warnings?.length > 0 && <ul className="mt-3 space-y-1 text-[13px] text-[#5c4515]">{summary.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
  </div>;
}
