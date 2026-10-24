import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { getGetAuthSessionQueryKey, getListFollowupsQueryKey, useGetAuthSession, useListFollowups, useLogin, useLogout } from '@workspace/api-client-react';
import { DataModeBanner } from '@/components/data-mode';
import { Button, Field, Footer, Input, Notice, Skeleton, cx, dueByToday } from '@/components/kit';

const tabs = [
  { href: '/', label: 'Data Center' },
  { href: '/leads', label: 'Leads' },
  { href: '/activity', label: 'Activity' },
  { href: '/settings', label: 'Settings' },
];

export function AuthGate({ children }: { children: ReactNode }) {
  const session = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey() } });
  if (session.isLoading) return <div className="grid min-h-[100dvh] place-items-center"><div className="w-72 space-y-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div></div>;
  if (session.isError) return <Centered><h1 className="text-xl font-semibold">Workspace unavailable</h1><p className="mt-2 text-sm text-muted-foreground">The session could not be checked. The API may be down.</p><Button className="mt-5" onClick={() => session.refetch()} data-testid="button-retry-session">Try again</Button></Centered>;
  if (!session.data?.configured) return <Centered><h1 className="text-xl font-semibold">Setup required</h1><p className="mt-2 text-sm text-muted-foreground">Add an <code className="rounded bg-muted px-1">APP_PASSWORD</code> secret to the API server, then reload this page.</p></Centered>;
  if (!session.data.authenticated) return <Login />;
  return <>{children}</>;
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col"><div className="grid flex-1 place-items-center p-4"><div className="w-full max-w-sm rounded-lg border border-border bg-card p-8">{children}</div></div><Footer /></div>;
}

function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const login = useLogin();
  const qc = useQueryClient();
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    login.mutate({ data: { password } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }), onError: () => setError('That password did not work.') });
  };
  return <Centered>
    <form onSubmit={submit}>
      <div className="text-sm font-semibold">KL Lead Finder</div>
      <h1 className="mt-6 text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">Private workspace. Enter your password.</p>
      <Field label="Password" className="mt-6"><Input type="password" autoComplete="current-password" autoFocus value={password} onChange={e => setPassword(e.target.value)} data-testid="input-password" /></Field>
      {error && <Notice tone="risk" className="mt-3">{error}</Notice>}
      <Button type="submit" variant="primary" className="mt-5 w-full" disabled={!password || login.isPending} data-testid="button-login">{login.isPending ? 'Signing in' : 'Sign in'}</Button>
    </form>
  </Centered>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const qc = useQueryClient();
  const logout = useLogout();
  const followups = useListFollowups({ query: { queryKey: getListFollowupsQueryKey() } });
  const due = (followups.data || []).filter(f => dueByToday(f.dueAt)).length;
  return <div className="flex min-h-[100dvh] flex-col">
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="hidden shrink-0 text-sm font-semibold sm:block" data-testid="link-home">KL Lead Finder</Link>
        <nav className="-mb-px flex h-full min-w-0 flex-1 items-stretch gap-4 overflow-x-auto sm:gap-6" aria-label="Main">
          {tabs.map(t => {
            const on = t.href === '/' ? path === '/' : path.startsWith(t.href) || (t.href === '/leads' && path.startsWith('/companies'));
            return <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined} data-testid={`link-nav-${t.label.toLowerCase().replace(' ', '-')}`}
              className={cx('flex shrink-0 items-center border-b-2 text-sm transition-colors', on ? 'border-primary font-medium text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {t.label}{t.href === '/activity' && due > 0 && <span className="ml-1.5 rounded bg-accent px-1.5 text-xs text-accent-foreground tabular" data-testid="badge-followups-due">{due}</span>}
            </Link>;
          })}
        </nav>
        <Button variant="text" size="sm" data-testid="button-logout" onClick={() => logout.mutate(undefined, { onSuccess: () => { qc.clear(); qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }); } })}>Sign out</Button>
      </div>
    </header>
    <DataModeBanner />
    <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6">{children}</main>
    <Footer />
  </div>;
}
