import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetSettingsQueryKey, useDeleteSampleData, useGetSettings, useLoadDemoData, useUpdateSettings } from '@workspace/api-client-react';
import { Button, ErrorState, Notice, PageSkeleton, SectionHead, Surface, errorMessage } from '@/components/kit';

const DemoContext = createContext(false);
export const useDemoMode = () => useContext(DemoContext);

export function DataModeBoundary({ children }: { children: ReactNode }) {
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  if (settings.isLoading) return <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6"><PageSkeleton /></div>;
  if (settings.isError || !settings.data) return <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6"><ErrorState message="Settings could not be loaded." onRetry={() => settings.refetch()} /></div>;
  return <DemoContext.Provider value={settings.data.demoMode}>{children}</DemoContext.Provider>;
}

export function DataModeBanner() {
  const demo = useDemoMode();
  if (!demo) return null;
  return <div role="status" data-testid="demo-banner" className="border-b border-[#ecdcb4] bg-[#fbf6ea] px-4 py-2 text-center text-[13px] text-[#5c4515]">
    Demo mode is on. You are looking at fictional businesses only. Nothing here was sent.
  </div>;
}

export function DemoControls() {
  const demo = useDemoMode();
  const qc = useQueryClient();
  const update = useUpdateSettings();
  const load = useLoadDemoData();
  const del = useDeleteSampleData();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const busy = update.isPending || load.isPending || del.isPending;
  const done = (text: string) => { setMessage(text); setError(''); qc.clear(); window.location.assign('/settings'); };
  return <Surface>
    <SectionHead title="Data mode" sub="Real mode is the default. Demo records stay separate from real leads, statistics and exports." />
    <div className="space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} role="switch" aria-checked={demo} data-testid="button-toggle-demo" onClick={() => update.mutate({ data: { demoMode: !demo } }, { onSuccess: () => done('Mode switched.'), onError: e => setError(errorMessage(e, 'Could not switch mode.')) })}>{demo ? 'Switch to real mode' : 'Switch to demo mode'}</Button>
        <Button disabled={busy} data-testid="button-load-demo" onClick={() => load.mutate(undefined, { onSuccess: r => done(`Loaded ${r.companies} demo companies.`), onError: e => setError(errorMessage(e, 'Could not load demo data.')) })}>Load demo data</Button>
        <Button variant="danger" disabled={busy} data-testid="button-delete-demo" onClick={() => {
          if (!window.confirm('Delete all demo companies and their demo records? Real records are not touched. This cannot be undone.')) return;
          del.mutate(undefined, { onSuccess: r => done(`Deleted ${r.deletedCompanies} demo companies.`), onError: e => setError(errorMessage(e, 'Could not delete demo data.')) });
        }}>Delete demo data</Button>
      </div>
      <p className="text-[13px] text-muted-foreground">Nothing is loaded or deleted automatically. Loading demo data does not switch modes.</p>
      {message && <Notice tone="info">{message}</Notice>}
      {error && <Notice tone="risk">{error}</Notice>}
    </div>
  </Surface>;
}
