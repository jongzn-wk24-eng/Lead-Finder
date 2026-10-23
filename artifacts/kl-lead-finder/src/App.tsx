import { useEffect, useMemo, useState } from 'react';
import type { ButtonHTMLAttributes, FormEvent, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Activity, ArrowRight, BadgeCheck, Bell,
  Building2, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert,
  Copy, ExternalLink, FileDown, Filter, Globe2, LayoutDashboard,
  LoaderCircle, LogOut, Mail, MapPin, Menu, MessageCircle,
  Plus, Search, Settings as SettingsIcon, Shield, SlidersHorizontal, Sparkles, Star,
  Store, UserRound, X, Database, RefreshCw, PauseCircle, MapPinned,
} from 'lucide-react';
import {
  getGetAuthSessionQueryKey, getGetCompanyQueryKey, getGetDashboardQueryKey,
  getGetSearchJobQueryKey,
  getGetSettingsQueryKey, getListActivityQueryKey, getListCompaniesQueryKey,
  getListFollowupsQueryKey, useCancelSearchJob, useCreateCompany, useDeleteSampleData,
  useEstimateSearch, useGenerateMessageDraft, useGetAuthSession,
  useGetCompany, useGetDashboard, useGetSettings, useListActivity, useListCompanies,
  useGetSearchJob, useListFollowups, useLogCopiedMessage, useLogReply, useLogin, useLogout,
  useMarkDoNotContact, useMarkMessageSent, useUpdateCompany, useUpdateCompanyStatus,
  useRecheckCompany, useRefreshGoogleCompany, useStartSearchJob, useUpdateSettings,
} from '@workspace/api-client-react';
import type {
  ActivityItem, CompanyInput, ListActivityParams, ListCompaniesParams, MessageDraft,
  SearchInput, SettingsUpdate,
} from '@workspace/api-client-react';
import googleMapsLogo from '@/assets/google-maps-logo-dark-gray.svg';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, retry: 1 } } });
const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/leads', label: 'Leads', icon: Building2 },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];
const statuses = ['New', 'Claimed', 'Sent #1', 'Sent #2', 'Sent #3', 'Replied', 'Wants hero', 'Hero sent', 'Won', 'Not interested', 'Do not contact', 'Closed: no reply'];
const activityActions = [
  { value: 'generated', label: 'Draft generated' },
  { value: 'copied_email', label: 'Email copied' },
  { value: 'copied_whatsapp', label: 'WhatsApp copied' },
  { value: 'marked_sent', label: 'Marked sent' },
  { value: 'reply_logged', label: 'Reply logged' },
  { value: 'status_changed', label: 'Status changed' },
  { value: 'marked_do_not_contact', label: 'Marked do not contact' },
  { value: 'note_added', label: 'Note added' },
];
function activityActionLabel(action: string) {
  return activityActions.find(item => item.value === action)?.label || action;
}

function cx(...classes: Array<string | false | null | undefined>) { return classes.filter(Boolean).join(' '); }
function dateLabel(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(value?: string | null) {
  if (!value) return '—';
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}
function liveWarning(company: object): string | null {
  const value = (company as { googleDataWarning?: unknown }).googleDataWarning;
  return typeof value === 'string' && value ? value : null;
}
function LiveWarning({ message, compact = false }: { message: string; compact?: boolean }) {
  return <div role="alert" data-testid="status-google-live-warning" className={cx('flex items-start gap-2 rounded-lg border border-[#e1c990] bg-[#fbf2df] text-[#775c28]', compact ? 'mt-1 px-2 py-1 text-[9px]' : 'mb-4 px-4 py-2.5 text-xs')}><CircleAlert size={compact ? 11 : 14} className="mt-0.5 shrink-0" /><span>{compact ? 'Live Google details unavailable' : `Live Google details could not be loaded: ${message} Nothing from Google is stored, so details may be missing until the next successful request.`}</span></div>;
}
function safeHttpUrl(value?: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
function GoogleAttribution({ attributions, className }: { attributions?: Array<{ provider?: string; providerUri?: string }>; className?: string }) {
  const items = (attributions || []).filter(item => item.provider);
  return <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground', className)} data-testid="google-attribution">
    <a href="https://maps.google.com" target="_blank" rel="noreferrer" aria-label="Google Maps" className="inline-block pb-[5px] pl-[10px] pr-[10px] pt-[10px]"><img src={googleMapsLogo} alt="Google Maps" className="h-[16px] w-auto" /></a>
    {items.map((item, i) => { const href = safeHttpUrl(item.providerUri); return <span key={`${item.provider}-${i}`}>{href ? <a href={href} target="_blank" rel="noreferrer" className="underline">{item.provider}</a> : item.provider}</span>; })}
  </div>;
}
function initials(name = '') { return name.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function errorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  const normalized = message.toLowerCase();
  if (normalized.includes('need a real finding first')) return 'Need a real finding first. Add a specific, verified website observation before generating a draft.';
  if (normalized.includes('whatsapp') && (normalized.includes('setting') || normalized.includes('required') || normalized.includes('missing'))) return 'Your WhatsApp setting is missing. Add your number in Settings before creating a WhatsApp draft.';
  return message || fallback;
}
function isToday(value?: string | null) {
  if (!value) return false;
  const date = new Date(value);
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
}
function downloadCsv(rows: ActivityItem[]) {
  const esc = (v: unknown) => {
    let text = String(v ?? '');
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [['Timestamp', 'Company ID', 'Action', 'Channel', 'Sequence', 'Note'], ...rows.map(r => [r.timestamp, r.companyId, r.action, r.channel, r.sequenceNo, r.note])].map(row => row.map(esc).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `kl-lead-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click(); URL.revokeObjectURL(link.href);
}
async function downloadEndpointCsv(type: 'companies' | 'outreach') {
  const response = await fetch(`/api/export.csv?type=${type}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kl-lead-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Button({ children, variant = 'primary', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return <button {...props} className={cx('inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50', variant === 'primary' && 'bg-primary text-primary-foreground hover:brightness-110', variant === 'secondary' && 'border border-border bg-card text-foreground hover:bg-muted', variant === 'quiet' && 'text-muted-foreground hover:bg-muted hover:text-foreground', variant === 'danger' && 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100', className)}>{children}</button>;
}
function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <label className={cx('grid gap-1.5 text-xs font-semibold text-muted-foreground', className)}>{label}{children}</label>;
}
function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx('h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-accent/40', props.className)} />;
}
function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx('h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-accent/40', props.className)}>{children}</select>;
}
function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx('w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-accent/40', props.className)} />;
}
function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-xl border border-card-border bg-card shadow-[0_3px_14px_rgba(50,56,44,.035)]', className)}>{children}</section>;
}
function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
    <div><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-muted-foreground"><span className="h-px w-5 bg-accent" />{eyebrow}</div><h1 className="font-display text-[30px] font-bold leading-tight tracking-[-.04em] text-foreground sm:text-[36px]">{title}</h1>{subtitle && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{subtitle}</p>}</div>
    {action}
  </div>;
}
function LoadingView() {
  return <div className="space-y-5 page-enter"><div className="h-9 w-52 animate-pulse rounded-lg bg-muted" /><div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0,1,2,3].map(n => <div key={n} className="h-32 animate-pulse rounded-xl bg-muted" />)}</div><div className="h-72 animate-pulse rounded-xl bg-muted" /></div>;
}
function QueryError({ onRetry }: { onRetry: () => void }) {
  return <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-card p-8 text-center"><div><div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-red-50 text-red-700"><CircleAlert size={20} /></div><h3 className="font-semibold">Could not load this view</h3><p className="mt-1 text-sm text-muted-foreground">The workspace could not reach the API. Try again in a moment.</p><Button variant="secondary" className="mt-4" onClick={onRetry}>Retry</Button></div></div>;
}
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="grid min-h-56 place-items-center p-8 text-center"><div className="max-w-sm"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#e9ede4] text-primary"><MapPin size={21} /></div><h3 className="font-display text-lg font-bold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>{action && <div className="mt-4">{action}</div>}</div></div>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const session = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey() } });
  if (session.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-background"><div className="w-64 space-y-3"><div className="h-4 w-32 animate-pulse rounded bg-muted" /><div className="h-10 animate-pulse rounded-lg bg-muted" /><div className="h-10 animate-pulse rounded-lg bg-muted" /></div></div>;
  if (session.isError) return <div className="grid min-h-[100dvh] place-items-center bg-background p-6"><div className="max-w-md text-center"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-700"><CircleAlert /></div><h1 className="font-display text-2xl font-bold">Workspace unavailable</h1><p className="mt-2 text-sm text-muted-foreground">We could not confirm the secure session. Check the API connection and retry.</p><Button variant="secondary" className="mt-5" onClick={() => session.refetch()}>Try again</Button></div></div>;
  if (!session.data?.configured) return <SetupRequired />;
  if (!session.data.authenticated) return <Login />;
  return <>{children}</>;
}
function BrandMark({ light = false }: { light?: boolean }) {
  return <div className="flex items-center gap-3"><div className={cx('grid h-9 w-9 place-items-center rounded-xl', light ? 'bg-accent text-primary' : 'bg-primary text-primary-foreground')}><span className="font-display text-[17px] font-extrabold">K</span></div><div><div className={cx('font-display text-[14px] font-extrabold tracking-[-.04em]', light ? 'text-sidebar-foreground' : 'text-foreground')}>KL Lead Finder</div><div className={cx('font-mono-ui text-[9px] uppercase tracking-[.17em]', light ? 'text-sidebar-foreground/55' : 'text-muted-foreground')}>Field workspace</div></div></div>;
}
function SetupRequired() {
  return <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#f2efe5] p-5">
    <div className="absolute -right-24 -top-20 h-96 w-96 rounded-full border border-[#d9d4c5]" /><div className="absolute -right-8 -top-5 h-64 w-64 rounded-full border border-[#d9d4c5]" />
    <Card className="relative w-full max-w-lg p-7 sm:p-10"><BrandMark /><div className="mt-9 inline-flex items-center gap-2 rounded-full bg-[#fbefda] px-3 py-1.5 text-xs font-bold text-[#7a5921]"><Shield size={14} /> Setup required</div><h1 className="mt-4 font-display text-3xl font-extrabold tracking-[-.045em]">This workspace is<br />not ready yet.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">The password gate has not been configured. Add the app password secret to the API server environment, then reload this page.</p><div className="mt-6 rounded-lg border border-border bg-[#f5f1e8] p-4"><div className="font-mono-ui text-xs font-medium text-primary">APP_PASSWORD</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Keep this value private. It is never stored in the browser.</p></div><div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><LockGlyph /> No outreach is sent by this workspace.</div></Card>
  </div>;
}
function LockGlyph() { return <Shield size={14} className="text-primary" />; }
function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const login = useLogin();
  const qc = useQueryClient();
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    login.mutate({ data: { password } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }); }, onError: () => setError('That password did not unlock the workspace. Please try again.') });
  };
  return <div className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#f2efe5] p-5">
    <div className="absolute left-[-140px] top-[-120px] h-[480px] w-[480px] rounded-full border border-[#d9d4c5]" /><div className="absolute left-[-85px] top-[-65px] h-[370px] w-[370px] rounded-full border border-[#d9d4c5]" /><div className="absolute bottom-[-260px] right-[-90px] h-[580px] w-[580px] rounded-full bg-[#e8e3d5]" />
    <div className="relative grid w-full max-w-[900px] overflow-hidden rounded-2xl border border-[#d8d2c4] bg-card shadow-[0_24px_80px_rgba(35,52,45,.12)] md:grid-cols-[1fr_.9fr]">
      <div className="relative hidden min-h-[520px] flex-col justify-between overflow-hidden bg-primary p-10 text-[#f5f1e7] md:flex"><div className="absolute -right-20 top-20 h-72 w-72 rounded-full border border-white/10" /><div className="absolute -right-6 top-36 h-44 w-44 rounded-full border border-white/10" /><BrandMark light /><div className="relative"><div className="mb-4 font-mono-ui text-[10px] uppercase tracking-[.22em] text-accent">A quieter kind of prospecting</div><h2 className="font-display text-[42px] font-bold leading-[1.1] tracking-[-.05em]">Good work<br />starts with<br /><span className="text-accent">good noticing.</span></h2><p className="mt-5 max-w-xs text-sm leading-6 text-white/65">A private field notebook for finding local businesses with real, fixable website issues.</p></div><div className="font-mono-ui text-[10px] uppercase tracking-[.15em] text-white/45">Kuala Lumpur · Malaysia</div></div>
      <form onSubmit={submit} className="p-7 sm:p-10 md:py-14"><div className="md:hidden"><BrandMark /></div><div className="mt-8 md:mt-0"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#e9ede4] px-3 py-1.5 text-xs font-bold text-primary"><Shield size={14} /> Private workspace</div><h1 className="font-display text-3xl font-extrabold tracking-[-.045em]">Welcome back.</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your workspace password to continue.</p></div><Field label="Workspace password" className="mt-8"><Input type="password" autoComplete="current-password" placeholder="Enter password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<Button type="submit" disabled={login.isPending || !password} className="mt-5 w-full">{login.isPending ? <LoaderCircle className="animate-spin" size={16} /> : null} Unlock workspace <ArrowRight size={16} /></Button><div className="mt-6 flex gap-2 rounded-lg bg-muted/70 p-3 text-xs leading-5 text-muted-foreground"><Shield size={15} className="mt-0.5 shrink-0 text-primary" />Your leads and drafts stay private. This tool only prepares outreach for you to copy and send manually.</div></form>
    </div>
  </div>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const logout = useLogout();
  const qc = useQueryClient();
  const title = navItems.find(n => n.href === path)?.label || (path.startsWith('/companies/') ? 'Company' : 'Workspace');
  const sidebar = <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar text-sidebar-foreground transition-transform duration-200 md:translate-x-0', mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0')}>
    <div className="flex h-[76px] items-center justify-between border-b border-sidebar-border px-6"><BrandMark light /><button className="md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
    <div className="px-4 pt-7"><div className="mb-3 px-3 font-mono-ui text-[9px] font-medium uppercase tracking-[.19em] text-sidebar-foreground/40">Workspace</div><nav className="space-y-1">{navItems.map(item => { const Icon = item.icon; const active = item.href === path || (item.href === '/leads' && path.startsWith('/companies/')); return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={cx('group flex h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-semibold transition-colors', active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground')}><Icon size={17} strokeWidth={active ? 2.2 : 1.8} /><span className="flex-1">{item.label}</span>{item.label === 'Leads' && <span className="font-mono-ui text-[10px] text-sidebar-foreground/45">›</span>}</Link>; })}</nav></div>
    <div className="mt-auto p-4"><div className="mb-4 rounded-xl border border-sidebar-border bg-[#1e4a43] p-4"><div className="mb-2 flex items-center gap-2 text-accent"><MapPin size={14} /><span className="font-mono-ui text-[9px] uppercase tracking-[.16em]">Field area</span></div><div className="font-display text-[15px] font-bold">Kuala Lumpur</div><div className="mt-1 text-[11px] text-sidebar-foreground/55">Local businesses, thoughtfully found.</div></div><div className="flex items-center gap-3 border-t border-sidebar-border pt-4"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#e7bd70] text-xs font-bold text-primary">FD</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">Freelance designer</div><div className="text-[10px] text-sidebar-foreground/50">Personal workspace</div></div><button aria-label="Sign out" title="Sign out" className="rounded-md p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={() => logout.mutate(undefined, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetAuthSessionQueryKey() }) })}><LogOut size={16} /></button></div></div>
  </aside>;
  return <div className="min-h-[100dvh] bg-background">
    {mobileOpen && <button className="fixed inset-0 z-30 bg-[#142d29]/50 md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
     {sidebar}<div className="min-h-[100dvh] md:pl-[248px]"><header className="sticky top-0 z-20 flex h-[66px] items-center justify-between border-b border-border bg-[#f7f4ec]/95 px-4 backdrop-blur-md sm:px-7 lg:px-10"><div className="flex items-center gap-3"><button className="rounded-lg p-2 text-muted-foreground hover:bg-muted md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><span className="text-xs text-muted-foreground">KL Lead Finder</span><ChevronRight size={13} className="text-muted-foreground/50" /><span className="text-xs font-semibold">{title}</span></div><div className="flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-[#d9e0d4] bg-[#edf2e9] px-3 py-1.5 text-[10px] font-semibold text-[#42674e] sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-[#6f9a69]" />Private & local</span><button className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50" title="Notifications are not configured" aria-label="Notifications" disabled><Bell size={16} /></button></div></header><main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-7 lg:px-10 lg:py-9"><div className="page-enter">{children}</div></main><footer className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-4 pb-7 text-[10px] text-muted-foreground sm:px-7 lg:px-10"><span>KL Lead Finder <span className="mx-1 text-border">/</span> Research with care.</span><span>Legacy map data © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · Open Database License (ODbL)</span><GoogleAttribution /><span>Draft, copy, open link. Never auto-send.</span></footer></div>
  </div>;
}

function DashboardPage() {
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });
  const followups = useListFollowups({ query: { queryKey: getListFollowupsQueryKey() } });
  const qc = useQueryClient();
  if (dashboard.isLoading) return <LoadingView />;
  if (dashboard.isError || !dashboard.data) return <QueryError onRetry={() => { dashboard.refetch(); followups.refetch(); }} />;
  const d = dashboard.data;
  const due = followups.data || [];
  const maxStatus = Math.max(1, ...d.byStatus.map(x => x.count));
  const maxSeq = Math.max(1, ...d.bySequence.map(x => x.count));
  return <div>
    <PageTitle eyebrow="Field notes · Kuala Lumpur" title="A clear view of the work." subtitle="Find the next thoughtful conversation. Keep every outreach grounded in what you actually observed." action={<Link href="/leads" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:brightness-110">Browse leads <ArrowRight size={16} /></Link>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard label="Businesses found" value={d.totals.companies} foot="Across your KL search areas" icon={<Store size={17} />} accent="sage" />
      <MetricCard label="In conversation" value={d.totals.contacted} foot={`${d.totals.replies} replies · ${d.totals.replyRate}% reply rate`} icon={<MessageCircle size={17} />} accent="gold" />
      <MetricCard label="Hero concepts shared" value={d.totals.heroSent} foot={`${d.totals.wantsHero} expressed interest`} icon={<Sparkles size={17} />} accent="blue" />
      <MetricCard label="Work won" value={d.totals.won} foot={`${d.totals.whatsappSent} WhatsApp messages logged`} icon={<BadgeCheck size={17} />} accent="rose" />
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Card className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Outreach pulse</div><h2 className="mt-1 font-display text-xl font-bold tracking-[-.03em]">A steady, human pace.</h2></div><div className="rounded-md bg-[#e9ede4] px-2.5 py-1 font-mono-ui text-[10px] text-primary">Today so far</div></div>
        <div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-lg border border-border bg-[#f8f6ef] p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Mail size={14} /> Email notes</div><div className="mt-3 flex items-end justify-between"><strong className="font-display text-3xl tracking-tight">{d.sentToday.email}<span className="ml-1 text-sm font-medium text-muted-foreground">/ {d.limits.email}</span></strong><span className="font-mono-ui text-[10px] text-muted-foreground">{d.limits.email ? Math.round(d.sentToday.email / d.limits.email * 100) : 0}%</span></div><QuotaBar value={d.sentToday.email} max={d.limits.email} /></div><div className="rounded-lg border border-border bg-[#f8f6ef] p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><MessageCircle size={14} /> WhatsApp</div><div className="mt-3 flex items-end justify-between"><strong className="font-display text-3xl tracking-tight">{d.sentToday.whatsapp}<span className="ml-1 text-sm font-medium text-muted-foreground">/ {d.limits.whatsapp}</span></strong><span className="font-mono-ui text-[10px] text-muted-foreground">{d.limits.whatsapp ? Math.round(d.sentToday.whatsapp / d.limits.whatsapp * 100) : 0}%</span></div><QuotaBar value={d.sentToday.whatsapp} max={d.limits.whatsapp} /></div></div>
        <div className="mt-6 grid grid-cols-2 gap-6"><div><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">By status</span><span className="text-[10px] text-muted-foreground">Current pipeline</span></div><div className="space-y-2.5">{d.byStatus.slice(0, 5).map(row => <div key={row.status} className="grid grid-cols-[82px_1fr_25px] items-center gap-2 text-[10px]"><span className="truncate text-muted-foreground">{row.status}</span><div className="h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${row.count / maxStatus * 100}%` }} /></div><span className="text-right font-mono-ui">{row.count}</span></div>)}</div></div><div><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">By sequence</span><span className="text-[10px] text-muted-foreground">Messages logged</span></div><div className="flex h-[92px] items-end gap-3 border-b border-border px-1">{[1,2,3].map(num => { const n = d.bySequence.find(x => x.sequenceNo === num)?.count || 0; return <div key={num} className="flex flex-1 flex-col items-center gap-1.5"><span className="font-mono-ui text-[10px] text-muted-foreground">{n}</span><div className="w-full max-w-9 rounded-t bg-[#668178]" style={{ height: `${Math.max(5, n / maxSeq * 48)}px`, opacity: .45 + .17 * num }} /><span className="pb-1 text-[10px] text-muted-foreground">#{num}</span></div>; })}</div></div></div>
      </Card>
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Next on your list</div><h2 className="mt-1 font-display text-lg font-bold">Due & upcoming</h2></div><Link href="/activity" className="text-xs font-semibold text-primary hover:underline">Activity <ArrowRight size={13} className="inline" /></Link></div>
        {followups.isLoading ? <div className="space-y-3 p-5">{[1,2,3].map(n => <div key={n} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div> : due.length ? <div className="divide-y divide-border">{due.slice(0, 5).map((item, i) => <Link key={`${item.companyId}-${item.sequenceNo}`} href={`/companies/${item.companyId}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-muted/60"><div className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold', i % 2 ? 'bg-[#f3ead9] text-[#7c5924]' : 'bg-[#e8ede5] text-primary')}>{initials(item.companyName)}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{item.companyName}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.area} <span className="mx-1">·</span> {item.channel} <span className="mx-1">·</span> #{item.sequenceNo}</div></div><div className="text-right"><div className="font-mono-ui text-[10px] text-primary">{dateLabel(item.dueAt)}</div><div className="mt-1 text-[9px] text-muted-foreground">{item.status}</div></div><ChevronRight size={15} className="text-muted-foreground/60" /></Link>)}</div> : <EmptyState title="Nothing due or upcoming" body="No overdue follow-ups and none planned in the next 30 days. Logged messages schedule follow-ups from your Settings timing." />}
        <div className="flex items-center justify-between border-t border-border bg-[#f8f6ef] px-5 py-3 text-[10px] text-muted-foreground"><span>Google Places requests · this month</span><span className="font-mono-ui text-foreground">{d.googlePlacesRequestsCount} requests</span></div>
      </Card>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4"><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">What earns a reply</div><h2 className="mt-1 font-display text-lg font-bold">Reply rate by finding</h2></div>
        {d.replyRatesByFindingType.length ? <div className="divide-y divide-border">{d.replyRatesByFindingType.map((row, i) => <div key={row.findingType} className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3"><div className="min-w-0"><div className="truncate text-xs font-semibold">{row.findingType}</div><div className="mt-1 text-[10px] text-muted-foreground">{row.replied} replies from {row.sent} sent</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#668178]" style={{ width: `${Math.min(100, row.replyRate)}%`, opacity: .7 + (i % 3) * .1 }} /></div></div><div className="font-mono-ui text-lg font-semibold">{row.replyRate}%</div></div>)}</div> : <EmptyState title="No finding data yet" body="Reply rates will appear once outreach is logged against a specific website finding." />}
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border px-5 py-4"><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Channel comparison</div><h2 className="mt-1 font-display text-lg font-bold">Reply rate by channel</h2></div>
        {d.replyRatesByChannel.length ? <div className="divide-y divide-border">{d.replyRatesByChannel.map(row => <div key={row.channel} className="flex items-center justify-between gap-4 px-5 py-4"><div><div className="text-sm font-semibold capitalize">{row.channel}</div><div className="mt-1 text-[10px] text-muted-foreground">{row.replied} replies · {row.sent} messages logged</div></div><div className="font-mono-ui text-2xl font-semibold text-primary">{row.replyRate}<span className="ml-0.5 text-sm">%</span></div></div>)}</div> : <EmptyState title="No channel data yet" body="Log a manually sent email or WhatsApp message to begin comparing response." />}
      </Card>
    </div>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d9ddce] bg-[#eaf0e7] px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-card text-primary"><Shield size={17} /></div><div><div className="text-sm font-semibold">Human-first outreach, by design.</div><div className="text-xs text-muted-foreground">Drafts never send themselves. You decide what to share and when.</div></div></div><Link href="/settings" className="text-xs font-bold text-primary hover:underline">Review your limits <ArrowRight size={13} className="inline" /></Link></div>
  </div>;
}
function MetricCard({ label, value, foot, icon, accent }: { label: string; value: number; foot: string; icon: ReactNode; accent: string }) {
  const colors: Record<string,string> = { sage: 'bg-[#e7ede4] text-[#42684f]', gold: 'bg-[#f4ebd9] text-[#8a652b]', blue: 'bg-[#e3ecee] text-[#456d76]', rose: 'bg-[#f1e5de] text-[#875b4c]' };
  return <Card className="p-4 sm:p-5"><div className="flex items-start justify-between gap-2"><span className="text-[11px] font-semibold text-muted-foreground">{label}</span><span className={cx('grid h-8 w-8 place-items-center rounded-lg', colors[accent])}>{icon}</span></div><div className="mt-2 font-display text-[29px] font-extrabold leading-none tracking-[-.05em]">{value}</div><div className="mt-2 truncate text-[10px] text-muted-foreground">{foot}</div></Card>;
}
function QuotaBar({ value, max }: { value: number; max: number }) {
  return <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e6e3d8]"><div className="h-full rounded-full bg-[#c2964d] transition-all" style={{ width: `${max ? Math.min(100, value / max * 100) : 0}%` }} /></div>;
}
function SampleDataBanner() {
  return <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#d8c798] bg-[#f8f0dd] px-4 py-3.5 text-[#6e5528] sm:items-center"><div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#efdfb9]"><CircleAlert size={16} /></div><div><div className="text-xs font-bold">Fictional sample data</div><p className="mt-0.5 text-[11px] leading-5">Seeded company, contact and outreach information is fictional sample data. No messages were sent as part of this sample.</p></div></div>;
}

function ResearchJobPanel({ jobId, onDismiss }: { jobId: string; onDismiss?: () => void }) {
  const jobQuery = useGetSearchJob(jobId, { query: { queryKey: getGetSearchJobQueryKey(jobId), refetchInterval: 2000 } });
  const cancel = useCancelSearchJob();
  const qc = useQueryClient();
  const job = jobQuery.data;
  const running = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!job || running) return;
    qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
    qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    qc.invalidateQueries({ queryKey: getListActivityQueryKey() });
    qc.invalidateQueries({ queryKey: getListFollowupsQueryKey() });
    qc.invalidateQueries({ queryKey: ['/api/companies'] });
  }, [job?.status, jobId, running, qc]);
  if (jobQuery.isLoading) return <div className="rounded-xl border border-border bg-card p-4"><div className="h-4 w-40 animate-pulse rounded bg-muted" /><div className="mt-3 h-2 animate-pulse rounded bg-muted" /></div>;
  if (jobQuery.isError || !job) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load research progress. <button className="font-semibold underline" onClick={() => jobQuery.refetch()}>Retry</button></div>;
  const pct = job.total > 0 ? Math.min(100, Math.round(job.completed / job.total * 100)) : running ? 8 : 100;
  return <section className="rounded-xl border border-[#cad6c8] bg-[#edf2e9] p-4" aria-live="polite" data-testid={`panel-job-${job.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-card text-primary"><RefreshCw size={16} className={running ? 'animate-spin' : ''} /></div><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{job.kind === 'search' ? 'Google Places search' : job.kind === 'recheck' ? 'Website re-check' : 'Google Places refresh'}</h3><span className="rounded-full bg-card px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">{job.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{job.currentLabel || job.phase || (running ? 'Working through the queue' : 'Research job finished')}</p></div></div>
      <div className="flex gap-2">{running && <Button variant="secondary" className="min-h-8 px-3 text-xs" data-testid="button-cancel-job" disabled={cancel.isPending} onClick={() => cancel.mutate({ jobId }, { onSuccess: () => jobQuery.refetch() })}><PauseCircle size={14} />Cancel</Button>}{!running && onDismiss && <Button variant="quiet" className="min-h-8 px-2 text-xs" onClick={onDismiss}>Dismiss</Button>}</div>
    </div>
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#d9e2d6]"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
    <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-muted-foreground"><span>{job.kind === 'recheck' ? `${job.completed} / ${job.total} checks complete` : `${job.completed} / ${job.total} complete · ${job.requestsMade} / ${job.requestsEstimated} Google Places requests`}</span><span>{pct}%</span></div>
    {job.error && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{job.error}</p>}
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[['New',job.newCompanies],['Updated',job.updatedCompanies],['Skipped',job.skippedCompanies],['Checks failed',job.checksFailed]].map(([label,value]) => <div key={String(label)} className="rounded-lg bg-card/75 px-3 py-2"><div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-0.5 font-mono-ui text-sm font-semibold">{value}</div></div>)}</div>
  </section>;
}

function LeadsPage() {
  const [searchInputValue, setSearchInputValue] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => { const t = window.setTimeout(() => setSearch(searchInputValue.trim()), 500); return () => window.clearTimeout(t); }, [searchInputValue]);
  const [status, setStatus] = useState('');
  const [area, setArea] = useState('');
  const [hasWebsite, setHasWebsite] = useState('');
  const [hasContact, setHasContact] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [estimateInput, setEstimateInput] = useState<SearchInput | null>(null);
  const [jobId, setJobId] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const params: ListCompaniesParams = useMemo(() => ({ ...(search ? { search } : {}), ...(status ? { status } : {}), ...(area ? { area } : {}), ...(hasWebsite ? { hasWebsite: hasWebsite === 'yes' } : {}), ...(hasContact ? { hasContact: hasContact === 'yes' } : {}), ...(showAll ? { showAll: true } : {}) }), [search, status, area, hasWebsite, hasContact, showAll]);
  const list = useListCompanies(params);
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const create = useCreateCompany();
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });
  const estimate = useEstimateSearch();
  const startJob = useStartSearchJob();
  const deleteSamples = useDeleteSampleData();
  const qc = useQueryClient();
  useEffect(() => {
    if (list.isSuccess) qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  }, [list.dataUpdatedAt, list.isSuccess, qc]);
  const [form, setForm] = useState<CompanyInput>({ name: '', area: '', keyword: '', address: '', rating: 0, reviewCount: 0, findingType: '', phone: '', websiteUrl: '' });
  const save = (e: FormEvent) => {
    e.preventDefault(); setError('');
    create.mutate({ data: form }, { onSuccess: () => { setAddOpen(false); setForm({ name: '', area: '', keyword: '', address: '', rating: 0, reviewCount: 0, findingType: '', phone: '', websiteUrl: '' }); qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); }, onError: () => setError('Could not add this business. Check the required fields and try again.') });
  };
  const areas = settings.data?.areas || [];
  const keywords = settings.data?.keywords || [];
  useEffect(() => {
    if (!searchOpen || !settings.data) return;
    setSelectedAreas(settings.data.areas);
    setSelectedKeywords(settings.data.keywords);
    setEstimateInput(null);
    estimate.reset();
  }, [searchOpen, settings.data]);
  const searchInput: SearchInput = { areas: selectedAreas, keywords: selectedKeywords };
  const estimateMatches = estimateInput && estimateInput.areas.join('\u0000') === selectedAreas.join('\u0000') && estimateInput.keywords.join('\u0000') === selectedKeywords.join('\u0000');
  const requestEstimate = () => {
    setError('');
    const input = { areas: selectedAreas, keywords: selectedKeywords };
    estimate.mutate({ data: input }, { onSuccess: () => setEstimateInput(input), onError: err => setError(errorMessage(err, 'Could not estimate Google Places requests. Please try again.')) });
  };
  const launchSearch = () => {
    if (!estimateMatches || !selectedAreas.length || !selectedKeywords.length) return;
    startJob.mutate({ data: searchInput }, { onSuccess: job => { setJobId(job.id); setSearchOpen(false); setError(''); }, onError: err => setError(errorMessage(err, 'Could not start the search. Please try again.')) });
  };
  const confirmDeleteSamples = () => {
    deleteSamples.mutate(undefined, { onSuccess: result => {
      setDeleteOpen(false);
      qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
      qc.invalidateQueries({ queryKey: getListActivityQueryKey() });
      qc.invalidateQueries({ queryKey: getListFollowupsQueryKey() });
      setError(`${result.deletedCompanies} fictional sample businesses deleted.`);
    }, onError: () => setError('Sample data could not be deleted. Please try again.') });
  };
  const exportCompanies = async () => {
    setError('');
    try { await downloadEndpointCsv('companies'); }
    catch { setError('Company export failed. Check your connection and try again.'); }
  };
  const leads = (list.data || []).filter(company => !company.isDoNotContact && company.status !== 'Do not contact');
  return <div>
    <PageTitle eyebrow="Your prospect fieldbook" title="Local leads, with a reason." subtitle="Filter for real opportunities, then take a closer look before you reach out." action={<div className="flex flex-wrap items-center gap-2"><Button variant="secondary" onClick={exportCompanies} data-testid="button-export-companies"><FileDown size={15} />Export companies</Button><Button onClick={() => setSearchOpen(true)} disabled={settings.isLoading || !areas.length || !keywords.length} data-testid="button-find-leads"><Search size={15} />Find leads</Button><Button variant="secondary" onClick={() => setAddOpen(true)}><Plus size={16} /> Add business</Button></div>} />
    <SampleDataBanner />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e2d7c4] bg-[#fbf7ed] px-4 py-3"><p className="text-xs text-muted-foreground">Google Places requests this month: <span className="font-mono-ui text-foreground" data-testid="text-google-requests-month">{dashboard.data?.googlePlacesRequestsCount ?? '...'}</span>. Company CSV includes Place ID and your own research, status and outreach fields; Google names, addresses, contacts and ratings are excluded. Remove fictional seed businesses and their related records when you are ready to work with live research.</p><Button variant="danger" className="min-h-9" onClick={() => setDeleteOpen(true)} data-testid="button-delete-sample-data"><Database size={14} />Delete sample data</Button></div>
    {error && <div role="status" className="mb-4 rounded-lg border border-[#e2d7c4] bg-[#fbf7ed] px-4 py-3 text-xs text-foreground">{error}</div>}
    {jobId && <div className="mb-5"><ResearchJobPanel jobId={jobId} onDismiss={() => setJobId('')} /></div>}
    <Card className="mb-4 p-4"><div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_170px_170px_150px_150px]"><div className="relative"><Search className="absolute left-3 top-3 text-muted-foreground" size={16} /><Input data-testid="input-search-leads" className="pl-9" placeholder="Search name, address, keyword…" value={searchInputValue} onChange={e => setSearchInputValue(e.target.value)} /></div><Select aria-label="Filter by status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(s => <option value={s} key={s}>{s}</option>)}</Select><Select aria-label="Filter by area" value={area} onChange={e => setArea(e.target.value)}><option value="">All areas</option>{areas.map(a => <option key={a}>{a}</option>)}</Select><Select aria-label="Website filter" value={hasWebsite} onChange={e => setHasWebsite(e.target.value)}><option value="">Any website</option><option value="yes">Has website</option><option value="no">No website</option></Select><Select aria-label="Contact filter" value={hasContact} onChange={e => setHasContact(e.target.value)}><option value="">Any contact</option><option value="yes">Contact found</option><option value="no">No contact yet</option></Select></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-[10px] text-muted-foreground"><SlidersHorizontal size={13} />Filters apply as you type</div><button className={cx('rounded-full border px-3 py-1.5 text-[10px] font-semibold transition', showAll ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted')} onClick={() => setShowAll(!showAll)}>{showAll ? 'Opportunity filter on' : 'Show all scores'}</button></div></Card>
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-bold">Business list</h2><div className="mt-0.5 text-[10px] text-muted-foreground">{list.isLoading ? 'Loading records…' : `${leads.length} matched records`}</div></div><div className="hidden items-center gap-2 text-[10px] text-muted-foreground sm:flex"><Filter size={13} /> KL field list</div></div>
      {list.isLoading ? <div className="space-y-3 p-5">{[1,2,3,4].map(n => <div key={n} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div> : list.isError ? <QueryError onRetry={() => list.refetch()} /> : leads.length ? <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left"><thead className="bg-[#f6f3eb] text-[9px] uppercase tracking-[.15em] text-muted-foreground"><tr><th className="px-5 py-3 font-semibold">Business</th><th className="px-4 py-3 font-semibold">Area</th><th className="px-4 py-3 font-semibold">Finding</th><th className="px-4 py-3 font-semibold">Value signal</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-5 py-3 text-right font-semibold">Action</th></tr></thead><tbody className="divide-y divide-border">{leads.map(company => <tr key={company.id} className="group transition hover:bg-[#f9f7f1]"><td className="px-5 py-4"><Link href={`/companies/${company.id}`} className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e8ede5] text-[10px] font-bold text-primary">{initials(company.name)}</div><div className="min-w-0"><div className="max-w-[250px] truncate text-sm font-semibold text-foreground group-hover:text-primary">{company.name}</div><div className="mt-0.5 max-w-[280px] truncate text-[10px] text-muted-foreground">{company.address || 'Address not recorded'}</div>{liveWarning(company) && <LiveWarning compact message={liveWarning(company) || ''} />}<div className="mt-1 text-[9px] font-semibold text-primary">{company.source === 'google_places' ? 'Google Places' : company.source === 'openstreetmap' ? 'OpenStreetMap · legacy' : company.source === 'sample' ? 'Fictional sample' : 'Manual entry'}</div></div></Link>{company.source === 'google_places' && <GoogleAttribution attributions={company.googleAttributions} className="ml-[38px]" />}</td><td className="px-4 py-4"><div className="text-xs font-medium">{company.area}</div><div className="mt-1 text-[10px] text-muted-foreground">{company.keyword}</div></td><td className="px-4 py-4"><div className="max-w-[185px] truncate text-xs">{company.findingType || (company.websiteUrl ? 'Website review pending' : 'No website found')}</div><div className="mt-1 text-[10px] text-muted-foreground">{company.reasons?.[0] || (company.websiteUrl ? company.websiteUrl.replace(/^https?:\/\//, '') : 'Opportunity to build a first site')}</div></td><td className="px-4 py-4"><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#c2964d]" style={{ width: `${Math.min(100, company.valueScore / 30 * 100)}%` }} /></div><span className="font-mono-ui text-[10px]">{company.valueScore}</span></div><div className="mt-1 text-[9px] text-muted-foreground">{company.source === 'openstreetmap' ? 'Legacy OSM estimate' : company.valueScoreMethod || 'Value score'} / 30</div></td><td className="px-4 py-4"><StatusBadge status={company.status} /></td><td className="px-5 py-4 text-right"><Link href={`/companies/${company.id}`} className="inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-xs font-bold text-primary hover:bg-[#e9ede4]">Inspect <ArrowRight size={13} /></Link></td></tr>)}</tbody></table></div> : <EmptyState title="No businesses in this view" body={search || status || area || hasWebsite || hasContact ? 'Try widening your filters, or add a business you have researched. Do-not-contact companies are always excluded from leads.' : 'Find businesses with Google Places or add a researched business to start your private KL lead list.'} action={<Button onClick={() => setSearchOpen(true)}><Search size={15} /> Find leads</Button>} />}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-[#f8f6ef] px-5 py-3 text-[10px] text-muted-foreground"><span>Leads are researched and reviewed by you.</span><span>{leads.length} records shown <ChevronDown className="inline" size={12} /></span></div>
    </Card>
    {searchOpen && <Modal title="Find local businesses" onClose={() => setSearchOpen(false)}><div className="space-y-5">
       <p className="text-sm leading-6 text-muted-foreground">Choose configured neighbourhoods and categories for a Google Places search. Review the request count before launch; it is not a dollar estimate, and Google usage may incur billing. This app deduplicates results by Place ID before saving; only the Place ID and your own research are stored.</p>
      {settings.isError && <div role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-800">Configured search defaults could not load. <button className="underline" onClick={() => settings.refetch()}>Retry</button></div>}
      <fieldset><legend className="mb-2 text-xs font-bold">Areas <span className="font-normal text-muted-foreground">({selectedAreas.length} selected)</span></legend><div className="grid max-h-36 gap-2 overflow-y-auto rounded-lg border border-border bg-[#f8f6ef] p-3 sm:grid-cols-2">{areas.map(value => <label key={value} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedAreas.includes(value)} onChange={e => { setSelectedAreas(previous => e.target.checked ? [...previous, value] : previous.filter(item => item !== value)); setEstimateInput(null); }} />{value}</label>)}</div>{!areas.length && <p className="mt-2 text-xs text-muted-foreground">Add search areas in Settings to begin.</p>}</fieldset>
      <fieldset><legend className="mb-2 text-xs font-bold">Business keywords <span className="font-normal text-muted-foreground">({selectedKeywords.length} selected)</span></legend><div className="grid max-h-36 gap-2 overflow-y-auto rounded-lg border border-border bg-[#f8f6ef] p-3 sm:grid-cols-2">{keywords.map(value => <label key={value} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedKeywords.includes(value)} onChange={e => { setSelectedKeywords(previous => e.target.checked ? [...previous, value] : previous.filter(item => item !== value)); setEstimateInput(null); }} />{value}</label>)}</div>{!keywords.length && <p className="mt-2 text-xs text-muted-foreground">Add keywords in Settings to begin.</p>}</fieldset>
       <div className="rounded-lg border border-[#d8d8c7] bg-[#f4f2e8] p-3 text-[11px] leading-5 text-muted-foreground"><div className="flex items-center gap-2 font-semibold text-foreground"><MapPinned size={14} /> Google Places · request count before launch</div><p className="mt-1">Google business details are fetched live on every page view and are never stored. Requests this month: {dashboard.data ? dashboard.data.googlePlacesRequestsCount : 'loading'}. Existing OpenStreetMap records remain labeled as legacy sources.</p></div>
       {estimate.data && estimateMatches && <div className="rounded-lg border border-[#d4decf] bg-[#edf2e9] p-4" aria-live="polite" data-testid="status-search-estimate"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold">Google Places request estimate</div><p className="mt-1 text-[10px] leading-5 text-muted-foreground">Covers Text Search calls for the selected area and keyword pairs only. It is a request count, not a dollar estimate. Each saved Google lead also makes one live Details call every time it is viewed.</p></div><span className="rounded-md bg-card px-2.5 py-1 font-mono-ui text-[10px]">{estimate.data.strategy}</span></div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{[['Area × keyword pairs',estimate.data.pairCount],['Estimated requests',estimate.data.requestsEstimated],['Max results / pair',estimate.data.maxResultsPerPair],['Maximum pairs',estimate.data.maximumPairs]].map(([label,value]) => <div key={String(label)} className="rounded-md bg-card px-3 py-2"><div className="text-[9px] leading-4 text-muted-foreground">{label}</div><div className="font-mono-ui text-lg font-semibold">{value}</div></div>)}</div></div>}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2"><Button variant="quiet" onClick={() => setSearchOpen(false)}>Close</Button><div className="flex gap-2"><Button variant="secondary" data-testid="button-estimate-search" disabled={!selectedAreas.length || !selectedKeywords.length || estimate.isPending} onClick={requestEstimate}>{estimate.isPending ? <LoaderCircle size={15} className="animate-spin" /> : null}Estimate requests</Button><Button data-testid="button-start-search" disabled={!estimateMatches || startJob.isPending} onClick={launchSearch}>{startJob.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />}Start search</Button></div></div>
    </div></Modal>}
    {deleteOpen && <Modal title="Delete fictional sample data?" onClose={() => setDeleteOpen(false)}><div className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">This permanently removes only fictional sample businesses and their related records. Live OpenStreetMap findings and manually added businesses are not included.</p>{deleteSamples.isError && <p role="alert" className="text-xs text-red-700">Deletion failed. You can try again.</p>}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDeleteOpen(false)}>Keep sample data</Button><Button variant="danger" disabled={deleteSamples.isPending} onClick={confirmDeleteSamples}>{deleteSamples.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Database size={15} />}Delete fictional records</Button></div></div></Modal>}
    {addOpen && <Modal title="Add a business" onClose={() => setAddOpen(false)}><form onSubmit={save} className="space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Business name *"><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field><Field label="Area *"><Input required placeholder="e.g. Bangsar" value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} /></Field><Field label="Search keyword"><Input placeholder="e.g. florist" value={form.keyword} onChange={e => setForm({ ...form, keyword: e.target.value })} /></Field><Field label="Address"><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field><Field label="Website URL"><Input type="url" value={form.websiteUrl || ''} onChange={e => setForm({ ...form, websiteUrl: e.target.value })} /></Field><Field label="Phone"><Input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field></div><Field label="Observed opportunity"><Textarea rows={3} value={form.findingType || ''} onChange={e => setForm({ ...form, findingType: e.target.value })} placeholder="A specific issue you personally observed" /></Field>{error && <p className="text-sm text-red-700">{error}</p>}<div className="flex justify-end gap-2 pt-2"><Button variant="secondary" type="button" onClick={() => setAddOpen(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending && <LoaderCircle size={15} className="animate-spin" />}Save business</Button></div></form></Modal>}
  </div>;
}
function StatusBadge({ status }: { status: string }) {
  const style: Record<string,string> = {
    'New': 'bg-[#e9ede4] text-[#3f674d]',
    'Claimed': 'bg-[#e5edef] text-[#456a71]',
    'Sent #1': 'bg-[#f4ecd9] text-[#856328]',
    'Sent #2': 'bg-[#eee8de] text-[#756149]',
    'Sent #3': 'bg-[#eee8de] text-[#756149]',
    'Replied': 'bg-[#e4eddf] text-[#456442]',
    'Wants hero': 'bg-[#f4e6d6] text-[#885b2c]',
    'Hero sent': 'bg-[#e5edef] text-[#456a71]',
    'Won': 'bg-[#dcebe2] text-[#316648]',
    'Not interested': 'bg-muted text-muted-foreground',
    'Do not contact': 'bg-red-50 text-red-700',
    'Closed: no reply': 'bg-muted text-muted-foreground',
  };
  return <span className={cx('inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold', style[status] || 'bg-muted text-muted-foreground')}>{status}</span>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15342f]/45 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"><div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-5 py-4"><h2 className="font-display text-xl font-bold">{title}</h2><button onClick={onClose} aria-label="Close dialog" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><X size={17} /></button></div><div className="p-5">{children}</div></div></div>;
}

function CompanyPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const query = useGetCompany(id, { query: { queryKey: getGetCompanyQueryKey(id), enabled: Number.isFinite(id) && id > 0 } });
  const qc = useQueryClient();
  const update = useUpdateCompany();
  const statusMutation = useUpdateCompanyStatus();
  const dncMutation = useMarkDoNotContact();
  const genDraft = useGenerateMessageDraft();
  const logCopy = useLogCopiedMessage();
  const sentMutation = useMarkMessageSent();
  const logReply = useLogReply();
  const recheckMutation = useRecheckCompany();
  const googleRefreshMutation = useRefreshGoogleCompany();
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [draftChannel, setDraftChannel] = useState<'email'|'whatsapp'>('email');
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState('');
  const [replyNote, setReplyNote] = useState('');
  const [replyOpen, setReplyOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [researchJobId, setResearchJobId] = useState('');
  if (query.isLoading) return <LoadingView />;
  if (query.isError || !query.data) return <QueryError onRetry={() => query.refetch()} />;
  const c = { ...query.data, isDoNotContact: query.data.isDoNotContact || query.data.status === 'Do not contact' };
  const outreachBlocked = c.isDoNotContact || c.status === 'Do not contact';
  const osmRecord = c.source === 'openstreetmap';
  const googleRecord = c.source === 'google_places';
    const googleWarning = liveWarning(c);
  const refresh = () => { qc.invalidateQueries({ queryKey: getGetCompanyQueryKey(id) }); qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); qc.invalidateQueries({ queryKey: getListActivityQueryKey() }); };
  const saveContact = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const data = new FormData(e.currentTarget); setFormError(''); update.mutate({ companyId: id, data: { firstName: String(data.get('firstName') || ''), email: String(data.get('email') || '') || null, whatsapp: String(data.get('whatsapp') || '') || null, notes: String(data.get('notes') || '') } }, { onSuccess: () => { setEditing(false); setSaved(true); refresh(); setTimeout(() => setSaved(false), 2200); }, onError: () => setFormError('Could not save changes. Please try again.') }); };
  const generate = () => {
    setFormError('');
    genDraft.mutate({ companyId: id }, { onSuccess: value => { setDraft(value); setDraftChannel('email'); }, onError: error => setFormError(errorMessage(error, 'Draft generation failed. Please try again.')) });
  };
  const copyDraft = async (channel: 'email'|'whatsapp') => {
    if (!draft || outreachBlocked) return;
    const text = channel === 'email' ? `${draft.subject ? `Subject: ${draft.subject}\n\n` : ''}${draft.emailBody}` : draft.whatsappBody;
    await navigator.clipboard?.writeText(text);
    logCopy.mutate({ companyId: id, data: { channel } }, { onSuccess: refresh });
  };
  const openWhatsApp = () => {
    if (!draft?.canOpenWhatsapp || !c.whatsapp || outreachBlocked) return;
    const url = `https://wa.me/${c.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(draft.whatsappBody)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const markSent = (channel: 'email'|'whatsapp') => {
    if (!draft || outreachBlocked) return;
    const otherChannelSentToday = c.outreach?.find(item => item.channel !== channel && isToday(item.sentAt));
    if (otherChannelSentToday && !window.confirm(`A ${otherChannelSentToday.channel} message is already logged as sent to this business today. Are you sure you manually sent this ${channel} message too?`)) return;
    setFormError('');
    const body = channel === 'email' ? draft.emailBody : draft.whatsappBody;
    sentMutation.mutate({ companyId: id, data: { channel, sequenceNo: Math.max(1, Math.min(3, channel === 'email' ? c.emailCount + 1 : c.whatsappCount + 1)), subject: draft.subject, body } }, { onSuccess: refresh, onError: () => setFormError('Could not log this message as sent.') });
  };
  return <div>
    <div className="mb-5"><Link href="/leads" className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary"><ChevronLeft size={15} /> Back to leads</Link></div>
    <SampleDataBanner />
     <div className="mb-7 flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-4"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#e4ebe1] font-display text-xl font-extrabold text-primary">{initials(c.name)}</div><div><div className="mb-1 flex flex-wrap items-center gap-2"><StatusBadge status={outreachBlocked ? 'Do not contact' : c.status} /><span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{c.source === 'google_places' ? 'Google Places' : c.source === 'openstreetmap' ? 'OpenStreetMap · legacy' : c.source === 'sample' ? 'Fictional sample' : 'Manual'}</span>{outreachBlocked && <span className="text-[10px] text-red-700">Outreach blocked</span>}</div><h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-.045em] sm:text-[34px]">{c.name}</h1><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><MapPin size={12} />{c.area}</span><span>{c.address || 'Address not recorded'}</span>{c.ratingAvailable && c.rating > 0 && <span className="inline-flex items-center gap-1 text-[#956e2e]"><Star size={12} fill="currentColor" />{c.rating} <span className="text-muted-foreground">({c.reviewCount} reviews)</span></span>}</div></div></div><div className="flex flex-wrap gap-2"><Select aria-label="Change company status" className="w-[185px]" value={outreachBlocked ? 'Do not contact' : c.status} disabled={outreachBlocked || statusMutation.isPending} onChange={e => statusMutation.mutate({ companyId: id, data: { status: e.target.value } }, { onSuccess: refresh })}>{statuses.map(s => <option value={s} key={s}>{s}</option>)}</Select><Button variant="secondary" data-testid="button-recheck-company" disabled={recheckMutation.isPending} onClick={() => recheckMutation.mutate({ companyId: id }, { onSuccess: job => setResearchJobId(job.id), onError: () => setFormError('Could not start a website re-check.') })}><RefreshCw size={14} />Re-check</Button>{googleRecord && <Button variant="secondary" data-testid="button-refresh-google-company" disabled={googleRefreshMutation.isPending} title="Fetch live Google Places details again. They are displayed only and never stored." onClick={() => googleRefreshMutation.mutate({ companyId: id }, { onSuccess: job => setResearchJobId(job.id), onError: () => setFormError('Could not refresh Google Places details.') })}><MapPinned size={14} />Refresh Google details</Button>}<Button variant="secondary" onClick={() => setEditing(!editing)}><UserRound size={15} /> Edit details</Button></div></div>
     {googleWarning && <LiveWarning message={googleWarning} />}
     {googleRecord && <div data-testid="status-google-live" className="mb-4 flex items-center gap-2 rounded-lg border border-[#cad6c8] bg-[#edf2e9] px-4 py-2.5 text-xs text-[#45634b]"><MapPinned size={14} />Name, address, phone, website and rating are live from Google Places for this view only and are not stored. Only the Place ID and your own research are saved.</div>}
     {googleRecord && <GoogleAttribution attributions={c.googleAttributions} className="-mt-3 mb-4" />}
     {researchJobId && <div className="mb-5"><ResearchJobPanel jobId={researchJobId} onDismiss={() => setResearchJobId('')} /></div>}
      {osmRecord && <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-[10px] text-muted-foreground"><span>Legacy OSM {c.osmType || 'feature'} {c.osmId || 'identifier unavailable'}</span><span>Listing update {dateLabel(c.osmUpdatedAt)}</span>{c.mapsUrl && <a href={c.mapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary underline"><MapPin size={12} />View map listing <ExternalLink size={11} /></a>}</div>}
    {saved && <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#cdddc9] bg-[#edf3e9] px-4 py-2.5 text-xs font-semibold text-[#42684f]"><CheckCircle2 size={15} />Changes saved.</div>}
    {formError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{formError}</div>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,.8fr)]">
      <div className="space-y-5">
        <Card className="overflow-hidden"><div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4"><div><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Opportunity brief</div><h2 className="mt-1 font-display text-lg font-bold">The reason to reach out</h2></div><div className="flex gap-3 text-center">{[['Value',c.valueScore],['Problem',c.problemScore],['Opportunity',c.opportunityScore]].map(([label,val]) => <div key={label}><div className="font-mono-ui text-[15px] font-medium">{val}</div><div className="text-[8px] uppercase tracking-[.12em] text-muted-foreground">{label}</div></div>)}</div></div><div className="border-b border-border bg-[#f8f6ef] px-5 py-3 text-[10px] leading-5 text-muted-foreground"><strong className="text-foreground">Value score{c.source === 'openstreetmap' ? ' is a legacy OSM estimate' : ''}.</strong> {c.source === 'openstreetmap' ? 'This legacy estimate reflects category and listing completeness, not measured business value.' : `Method: ${c.valueScoreMethod || 'workspace estimate'}.`} {c.ratingAvailable ? `Google rating ${c.rating} from ${c.reviewCount} reviews.` : 'No rating or review count is available for this record.'}</div><div className="p-5"><div className="rounded-lg border-l-[3px] border-accent bg-[#f7f2e7] p-4"><div className="mb-1.5 text-[9px] font-bold uppercase tracking-[.15em] text-[#86642c]">{c.findingType || 'Observed finding'}</div><p className="text-sm leading-6">{c.reasons?.[0] || 'No specific observation has been recorded yet. Review the site before writing a message.'}</p></div>{c.reasons?.length > 1 && <ul className="mt-4 space-y-2">{c.reasons.slice(1, 3).map((r,i) => <li key={i} className="flex gap-2 text-xs leading-5 text-muted-foreground"><span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[#8f9d7c]" />{r}</li>)}</ul>}<div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground"><span>Found {dateLabel(c.fetchedAt)}</span><span className="text-border">·</span><span>Added {dateLabel(c.createdAt)}</span></div></div></Card>
        <Card><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Website check</div><h2 className="mt-1 font-display text-lg font-bold">What the site tells us</h2></div>{c.websiteUrl && <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"><Globe2 size={14} /> Visit site <ExternalLink size={12} /></a>}</div>{c.checks?.length ? <div className="divide-y divide-border">{c.checks.map((check, i) => <div key={`${check.checkedAt}-${i}`} className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold">{check.websiteType} review · {check.checkStatus || 'status unavailable'}</div><div className="mt-1 text-[10px] text-muted-foreground">Checked {dateLabel(check.checkedAt)} · {check.retryCount || 0} retries</div></div><span className={cx('rounded-full px-2.5 py-1 text-[9px] font-bold uppercase', check.designStatus === 'completed' ? 'bg-[#e5efe4] text-[#45634b]' : check.designStatus === 'failed' ? 'bg-red-50 text-red-700' : 'bg-[#f4ecd9] text-[#856328]')}>Design {check.designStatus || 'pending'}</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[['Mobile PSI',check.psiMobileScore == null ? 'Not checked' : `${check.psiMobileScore}/100`],['Largest contentful paint',check.lcpSeconds == null ? '—' : `${check.lcpSeconds}s`],['Secure connection',yesNo(check.https)],['Mobile viewport',yesNo(check.hasViewport)],['Copyright year',check.copyrightYear || '—'],['Tap-to-call',yesNo(check.hasTelLink)],['WhatsApp link',yesNo(check.hasWhatsappLink)],['Contact form',yesNo(check.hasContactForm)],['Contact page',yesNo(check.hasContactPage)],['Design score',check.designStatus === 'pending' || check.designStatus == null ? 'Pending' : check.designScore == null ? 'Unavailable' : `${check.designScore}/100`],['Clear next step',yesNo(check.ctaObvious)]].map(([label,value]) => <div key={String(label)} className={cx('rounded-lg p-3', label === 'Clear next step' ? check.ctaObvious ? 'bg-[#e8efe5]' : 'bg-[#f8f1e5]' : 'bg-[#f6f4ed]')}><div className="text-[9px] text-muted-foreground">{label}</div><div className="mt-1 text-xs font-semibold">{value}</div>{label === 'Clear next step' && <div className="mt-1 text-[9px] leading-4 text-muted-foreground">{check.ctaObvious ? 'CTA is obvious' : check.ctaObvious === false ? 'CTA is not obvious' : 'Not evaluated'}</div>}</div>)}</div>{check.designReason && <p className="text-xs leading-5 text-muted-foreground">{check.designReason}</p>}{(check.screenshotDesktopUrl || check.screenshotMobileUrl) && <div className="grid gap-3 sm:grid-cols-2">{check.screenshotDesktopUrl && <a href={check.screenshotDesktopUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border border-border bg-[#f6f4ed]"><img src={check.screenshotDesktopUrl} alt={`${c.name} desktop website screenshot`} className="h-36 w-full object-cover object-top transition duration-200 group-hover:scale-[1.02]" /><span className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-semibold text-primary">Desktop capture <ExternalLink size={11} /></span></a>}{check.screenshotMobileUrl && <a href={check.screenshotMobileUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-lg border border-border bg-[#f6f4ed]"><img src={check.screenshotMobileUrl} alt={`${c.name} mobile website screenshot`} className="h-36 w-full object-cover object-top transition duration-200 group-hover:scale-[1.02]" /><span className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-semibold text-primary">Mobile capture <ExternalLink size={11} /></span></a>}</div>}{check.lastError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-800">Check error: {check.lastError}</p>}</div>)}</div> : <div className="p-5"><div className="rounded-lg border border-dashed border-border bg-[#f8f6ef] p-4"><div className="font-display text-sm font-bold">No website check yet</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{c.websiteUrl ? 'Run a re-check to capture the latest site signals and available screenshots.' : 'No website URL was found for this business. Confirm this before making it part of your outreach.'}</p></div></div>}</Card>
        <Card><div className="border-b border-border px-5 py-4"><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Your field notes</div><h2 className="mt-1 font-display text-lg font-bold">Notes & context</h2></div>{editing ? <form onSubmit={saveContact} className="space-y-4 p-5">{googleRecord && <p className="rounded-lg bg-muted px-3 py-2 text-[10px] leading-5 text-muted-foreground">Google-provided name, address, phone, website and rating are read-only and never saved. Only your contact name, email, WhatsApp and notes are editable.</p>}<div className="grid gap-4 sm:grid-cols-3"><Field label="Contact first name"><Input name="firstName" defaultValue={c.firstName} /></Field><Field label="Email address"><Input name="email" type="email" defaultValue={c.email || ''} /></Field><Field label="WhatsApp number"><Input name="whatsapp" defaultValue={c.whatsapp || ''} /></Field></div><Field label="Private notes"><Textarea name="notes" rows={4} defaultValue={c.notes} placeholder="What did you notice? Anything to remember before reaching out?" /></Field><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button><Button type="submit" disabled={update.isPending}>{update.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}Save details</Button></div></form> : <div className="p-5"><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{c.notes || 'Nothing noted yet. Add context that will help you write a respectful, specific message.'}</p><div className="mt-4 flex flex-wrap gap-2 text-[10px]"><span className="rounded-md bg-muted px-2.5 py-1.5">{c.email || 'No email on file'}</span><span className="rounded-md bg-muted px-2.5 py-1.5">{c.whatsapp || 'No WhatsApp on file'}</span>{c.phone && <span className="rounded-md bg-muted px-2.5 py-1.5">{c.phone}</span>}</div></div>}</Card>
      </div>
      <div className="space-y-5 xl:sticky xl:top-[82px]">
        <Card className="overflow-hidden border-[#d4d9c9]"><div className="flex items-center justify-between border-b border-border bg-[#eef1e9] px-5 py-4"><div><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-[#667862]">Draft studio</div><h2 className="mt-1 font-display text-lg font-bold">A note worth sending.</h2></div><div className="grid h-9 w-9 place-items-center rounded-full bg-card text-primary"><Sparkles size={17} /></div></div><div className="p-5"><p className="text-xs leading-5 text-muted-foreground">Create a fact-based draft from your notes and site checks. Nothing is sent from here.</p><Button className="mt-4 w-full" onClick={generate} disabled={genDraft.isPending || c.isDoNotContact}>{genDraft.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}Generate a draft</Button>{c.isDoNotContact && <p className="mt-2 text-[10px] text-red-700">Outreach is blocked for this business.</p>}{draft && <div className="mt-5 border-t border-border pt-4"><div className="mb-3 flex rounded-lg bg-muted p-1"><button onClick={() => setDraftChannel('email')} className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold', draftChannel === 'email' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}><Mail size={13} /> Email</button><button onClick={() => setDraftChannel('whatsapp')} className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-semibold', draftChannel === 'whatsapp' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}><MessageCircle size={13} /> WhatsApp</button></div>{draft.finding && <div className="mb-3 rounded-lg border border-[#e3d7bd] bg-[#faf4e6] p-3"><div className="mb-1 text-[9px] font-bold uppercase tracking-[.13em] text-[#89652e]">Based on this finding</div><p className="text-xs leading-5">{draft.finding}</p></div>}{draftChannel === 'email' && draft.subject && <div className="mb-2 rounded-lg border border-border bg-[#f8f6ef] p-3"><div className="mb-1 text-[9px] font-bold uppercase tracking-[.13em] text-muted-foreground">Subject</div><div className="text-xs font-semibold">{draft.subject}</div></div>}<div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-[#f8f6ef] p-3.5 text-xs leading-5 text-foreground">{draftChannel === 'email' ? draft.emailBody : draft.whatsappBody}</div><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="secondary" className="text-xs" onClick={() => copyDraft(draftChannel)} disabled={logCopy.isPending}><Copy size={14} />Copy draft</Button>{draftChannel === 'whatsapp' ? <Button variant="secondary" className="text-xs" onClick={openWhatsApp} disabled={!draft.canOpenWhatsapp || !c.whatsapp}><ExternalLink size={14} />Open WhatsApp</Button> : <Button variant="secondary" className="text-xs" onClick={() => window.open(`mailto:${encodeURIComponent(c.email || '')}?subject=${encodeURIComponent(draft.subject)}`, '_blank')} disabled={!c.email}><Mail size={14} />Open email</Button>}</div><Button className="mt-2 w-full" variant="quiet" onClick={() => markSent(draftChannel)} disabled={sentMutation.isPending}><CheckCircle2 size={14} />I sent this manually — log it</Button><p className="mt-2 text-center text-[9px] leading-4 text-muted-foreground">This only records your action. It never sends a message.</p></div>}</div></Card>
        <Card><div className="border-b border-border px-5 py-4"><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Contact & history</div><h2 className="mt-1 font-display text-lg font-bold">Keep the context.</h2></div><div className="divide-y divide-border">{[['Email',c.email,<Mail size={14} />],['WhatsApp',c.whatsapp,<MessageCircle size={14} />],['Website',c.websiteUrl,<Globe2 size={14} />]].map(([label,value,icon]) => <div key={String(label)} className="flex items-center gap-3 px-5 py-3"><span className="text-muted-foreground">{icon}</span><span className="w-16 text-[10px] text-muted-foreground">{label}</span>{typeof value === 'string' && value ? <span className="truncate text-xs font-medium">{value}</span> : <span className="text-xs text-muted-foreground">Not recorded</span>}</div>)}</div><div className="border-t border-border px-5 py-4"><div className="mb-3 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">Recent activity</div>{c.activity?.length ? <div className="space-y-3">{c.activity.slice(0,4).map(item => <div key={item.id} className="flex gap-2.5"><div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /><div className="min-w-0"><div className="text-[11px] font-semibold">{item.action.replaceAll('_',' ')}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{timeAgo(item.timestamp)}{item.channel && ` · ${item.channel}`}{item.note && ` · ${item.note}`}</div></div></div>)}</div> : <p className="text-xs text-muted-foreground">No activity recorded yet.</p>}</div><div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3"><Button variant="quiet" className="min-h-8 px-2.5 text-[10px]" onClick={() => setReplyOpen(!replyOpen)}><MessageCircle size={13} />Log reply</Button><Button variant="quiet" className="min-h-8 px-2.5 text-[10px] text-red-700" onClick={() => { if (window.confirm(`Block future outreach to ${c.name}?`)) dncMutation.mutate({ companyId: id }, { onSuccess: refresh }); }} disabled={c.isDoNotContact || dncMutation.isPending}><Shield size={13} />Do not contact</Button></div>{replyOpen && <form className="space-y-2 border-t border-border bg-[#f8f6ef] p-4" onSubmit={e => { e.preventDefault(); logReply.mutate({ companyId: id, data: { note: replyNote } }, { onSuccess: () => { setReplyOpen(false); setReplyNote(''); refresh(); } }); }}><Field label="Reply note"><Input required value={replyNote} onChange={e => setReplyNote(e.target.value)} placeholder="What did they say?" /></Field><Button type="submit" className="w-full" disabled={logReply.isPending}>Save reply note</Button></form>}</Card>
        <Card className="p-4"><div className="flex items-start gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f3ebdc] text-[#856328]"><Shield size={15} /></div><div><div className="text-xs font-semibold">Consent & restraint</div><p className="mt-1 text-[10px] leading-5 text-muted-foreground">Use public business contact details only. Keep the message relevant, accurate, and easy to decline.</p></div></div></Card>
      </div>
    </div>
  </div>;
}
function yesNo(value?: boolean | null) { return value == null ? 'Not checked' : value ? 'Yes' : 'No'; }

function ActivityPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [channel, setChannel] = useState('');
  const [date, setDate] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const params: ListActivityParams = useMemo(() => ({ ...(search ? { search } : {}), ...(action ? { action } : {}), ...(channel ? { channel } : {}), ...(date ? { date } : {}) }), [search, action, channel, date]);
  const activity = useListActivity(params);
  const followups = useListFollowups({ query: { queryKey: getListFollowupsQueryKey() } });
  const claimed = useListCompanies({ status: 'Claimed', showAll: true });
  const exportOutreach = async () => {
    setExportError('');
    setExporting(true);
    try { await downloadEndpointCsv('outreach'); }
    catch { setExportError('Outreach export failed. Check your connection and try again.'); }
    finally { setExporting(false); }
  };
  return <div><PageTitle eyebrow="A record of the work" title="Activity, in context." subtitle="A simple audit trail of research, drafts, copies, and messages you chose to send." action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => downloadCsv(activity.data || [])} disabled={!activity.data?.length}><FileDown size={15} />Export activity</Button><Button variant="secondary" onClick={exportOutreach} disabled={exporting}><FileDown size={15} />{exporting ? 'Preparing…' : 'Export outreach'}</Button></div>} />
    {exportError && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{exportError}</div>}
    <Card className="mb-4 p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_190px_160px_170px]"><div className="relative"><Search size={15} className="absolute left-3 top-3 text-muted-foreground" /><Input className="pl-9" placeholder="Search company or note" value={search} onChange={e => setSearch(e.target.value)} /></div><Select value={action} onChange={e => setAction(e.target.value)} aria-label="Filter action"><option value="">All activity</option>{activityActions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select><Select value={channel} onChange={e => setChannel(e.target.value)} aria-label="Filter channel"><option value="">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></Select><Input type="date" aria-label="Filter by date" value={date} onChange={e => setDate(e.target.value)} /></div></Card>
    <div className="mb-4 grid gap-4 xl:grid-cols-2">
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Follow-up queue</div><h2 className="mt-1 font-display text-lg font-bold">Due & upcoming follow-ups</h2></div><span className="rounded-full bg-muted px-2.5 py-1 font-mono-ui text-[10px]">{followups.data?.length ?? '—'}</span></div>{followups.isLoading ? <div className="space-y-3 p-5">{[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div> : followups.isError ? <div className="p-5 text-xs text-muted-foreground">Follow-ups could not load. <button className="font-semibold text-primary underline" onClick={() => followups.refetch()}>Retry</button></div> : followups.data?.length ? <div className="max-h-72 divide-y divide-border overflow-y-auto">{followups.data.map((item, i) => <Link key={`${item.companyId}-${item.sequenceNo}-${i}`} href={`/companies/${item.companyId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50"><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{item.companyName}</div><div className="mt-1 text-[10px] text-muted-foreground">{item.area} · {item.channel} · #{item.sequenceNo}</div></div><div className="shrink-0 text-right"><div className="font-mono-ui text-[10px]">{dateLabel(item.dueAt)}</div><div className="mt-1 text-[9px] text-muted-foreground">{item.status}</div></div><ChevronRight size={14} className="text-muted-foreground" /></Link>)}</div> : <div className="p-5 text-xs text-muted-foreground">No overdue follow-ups and none in the next 30 days.</div>}</Card>
      <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Awaiting your next step</div><h2 className="mt-1 font-display text-lg font-bold">Claimed, not marked sent</h2></div><span className="rounded-full bg-muted px-2.5 py-1 font-mono-ui text-[10px]">{claimed.data?.filter(item => !item.isDoNotContact && item.status !== 'Do not contact').length ?? '—'}</span></div>{claimed.isLoading ? <div className="space-y-3 p-5">{[1,2,3].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div> : claimed.isError ? <div className="p-5 text-xs text-muted-foreground">Claimed businesses could not load. <button className="font-semibold text-primary underline" onClick={() => claimed.refetch()}>Retry</button></div> : claimed.data?.filter(item => !item.isDoNotContact && item.status !== 'Do not contact').length ? <div className="max-h-72 divide-y divide-border overflow-y-auto">{claimed.data.filter(item => !item.isDoNotContact && item.status !== 'Do not contact').map(item => <Link key={item.id} href={`/companies/${item.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e8ede5] text-[10px] font-bold text-primary">{initials(item.name)}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{item.name}</div><div className="mt-1 text-[10px] text-muted-foreground">{item.area} · {item.keyword || 'No category'}</div></div><StatusBadge status="Claimed" /><ChevronRight size={14} className="text-muted-foreground" /></Link>)}</div> : <div className="p-5 text-xs text-muted-foreground">No claimed businesses are waiting to be marked sent.</div>}</Card>
    </div>
    <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-display text-lg font-bold">Recent actions</h2><p className="mt-0.5 text-[10px] text-muted-foreground">Activity CSV contains the filtered rows. Outreach CSV includes Place ID and your messages, excluding Google identity, contact and rating fields.</p></div><span className="rounded-full bg-muted px-2.5 py-1 font-mono-ui text-[10px]">{activity.data?.length ?? '—'} entries</span></div>{activity.isLoading ? <div className="space-y-3 p-5">{[1,2,3,4].map(i => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div> : activity.isError ? <QueryError onRetry={() => activity.refetch()} /> : activity.data?.length ? <div className="divide-y divide-border">{activity.data.map(item => <ActivityRow key={item.id} item={item} />)}</div> : <EmptyState title="Nothing in the log yet" body="As you research, draft, copy, and manually send messages, your activity will appear here." />}</Card>
  </div>;
}
function ActivityRow({ item }: { item: ActivityItem }) {
  const actionText = activityActionLabel(item.action);
  return <div className="flex items-start gap-3 px-5 py-4"><div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#e9ede4] text-primary"><Activity size={16} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><Link href={`/companies/${item.companyId}`} className="text-sm font-semibold hover:text-primary hover:underline">{item.companyName}</Link><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium capitalize text-muted-foreground">{actionText}</span>{item.channel && <span className="text-[10px] capitalize text-muted-foreground">{item.channel}{item.sequenceNo ? ` · sequence ${item.sequenceNo}` : ''}</span>}</div>{item.note && <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.note}</p>}</div><div className="shrink-0 text-right"><div className="font-mono-ui text-[10px]">{dateLabel(item.timestamp)}</div><div className="mt-1 text-[9px] text-muted-foreground">{new Date(item.timestamp).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}</div></div></div>;
}

function SettingsPage() {
  const settings = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (settings.isLoading) return <LoadingView />;
  if (settings.isError || !settings.data) return <QueryError onRetry={() => settings.refetch()} />;
  const s = settings.data;
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const data = new FormData(e.currentTarget); setMessage(''); setError('');
    const payload: SettingsUpdate = {
      areas: String(data.get('areas')).split('\n').map(x => x.trim()).filter(Boolean),
      keywords: String(data.get('keywords')).split('\n').map(x => x.trim()).filter(Boolean),
      emailDailyLimit: Number(data.get('emailDailyLimit')), whatsappDailyLimit: Number(data.get('whatsappDailyLimit')),
      followup1Days: Number(data.get('followup1Days')), followup2Days: Number(data.get('followup2Days')),
      myName: String(data.get('myName')), myTitle: String(data.get('myTitle')), myWhatsapp: String(data.get('myWhatsapp')),
      portfolioUrl: String(data.get('portfolioUrl')), aiInstruction: String(data.get('aiInstruction')),
    };
    update.mutate({ data: payload }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); setMessage('Your defaults are saved.'); }, onError: () => setError('Could not save these settings. Please review the limits and try again.') });
  };
  return <div><PageTitle eyebrow="Make the workspace yours" title="Defaults with good boundaries." subtitle="Tune your search focus, daily pace, follow-up timing, and the details that shape a draft." />
    {message && <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#cdddc9] bg-[#edf3e9] px-4 py-3 text-xs font-semibold text-[#42684f]"><CheckCircle2 size={15} />{message}</div>}{error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
    <form onSubmit={save} className="space-y-5"><div className="grid gap-5 xl:grid-cols-2"><Card><div className="border-b border-border px-5 py-4"><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Search ground</div><h2 className="mt-1 font-display text-lg font-bold">Where you look.</h2></div><div className="grid gap-4 p-5 sm:grid-cols-2"><Field label="Areas · one per line"><Textarea name="areas" rows={8} defaultValue={s.areas.join('\n')} placeholder="Bangsar&#10;TTDI&#10;Kuala Lumpur City Centre" /><span className="font-normal leading-4">Keep the field manageable; choose places you can understand and serve.</span></Field><Field label="Business keywords · one per line"><Textarea name="keywords" rows={8} defaultValue={s.keywords.join('\n')} placeholder="Independent café&#10;Physiotherapy&#10;Florist" /><span className="font-normal leading-4">Specific categories make for more useful research.</span></Field></div></Card>
    <Card><div className="border-b border-border px-5 py-4"><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Sustainable cadence</div><h2 className="mt-1 font-display text-lg font-bold">How often you reach out.</h2></div><div className="grid gap-4 p-5 sm:grid-cols-2"><Field label="Email messages per day"><Input name="emailDailyLimit" type="number" min="1" max="100" defaultValue={s.emailDailyLimit} /></Field><Field label="WhatsApp messages per day"><Input name="whatsappDailyLimit" type="number" min="1" max="100" defaultValue={s.whatsappDailyLimit} /></Field><Field label="First follow-up after · days"><Input name="followup1Days" type="number" min="1" max="60" defaultValue={s.followup1Days} /></Field><Field label="Second follow-up after · days"><Input name="followup2Days" type="number" min="1" max="90" defaultValue={s.followup2Days} /></Field><div className="sm:col-span-2 flex gap-3 rounded-lg bg-[#edf1e9] p-3.5 text-xs leading-5 text-[#526b54]"><Shield size={16} className="mt-0.5 shrink-0" /><p>Daily limits are reminders, not automations. Every message is reviewed and sent manually by you.</p></div></div></Card>
    <Card><div className="border-b border-border px-5 py-4"><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Your signature</div><h2 className="mt-1 font-display text-lg font-bold">Who the message comes from.</h2></div><div className="grid gap-4 p-5 sm:grid-cols-2"><Field label="Your name"><Input name="myName" defaultValue={s.myName} /></Field><Field label="Your title"><Input name="myTitle" defaultValue={s.myTitle} /></Field><Field label="Your WhatsApp"><Input name="myWhatsapp" defaultValue={s.myWhatsapp} /></Field><Field label="Portfolio URL"><Input name="portfolioUrl" type="url" defaultValue={s.portfolioUrl} /></Field></div></Card>
    <Card><div className="border-b border-border px-5 py-4"><div className="font-mono-ui text-[9px] uppercase tracking-[.18em] text-muted-foreground">Draft guidance</div><h2 className="mt-1 font-display text-lg font-bold">A consistent, respectful voice.</h2></div><div className="p-5"><Field label="Extra instruction for draft generation"><Textarea name="aiInstruction" rows={6} defaultValue={s.aiInstruction} placeholder="Keep it brief and specific. Mention one observable issue. Never imply an audit or relationship that did not happen. Give the business an easy way to decline." /><span className="font-normal leading-4">Use this to guide wording. Always verify every detail before you copy a draft.</span></Field></div></Card></div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d9ddce] bg-[#eaf0e7] px-5 py-4"><div><div className="text-sm font-semibold">Changes take effect on future drafts.</div><div className="mt-0.5 text-xs text-muted-foreground">Existing drafts and logged messages are not changed.</div></div><Button type="submit" disabled={update.isPending}>{update.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}Save preferences</Button></div>
    </form>
  </div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><AuthGate><AppShell><Switch><Route path="/" component={DashboardPage} /><Route path="/leads" component={LeadsPage} /><Route path="/companies/:id" component={CompanyPage} /><Route path="/activity" component={ActivityPage} /><Route path="/settings" component={SettingsPage} /><Route component={() => <div className="grid min-h-[60vh] place-items-center"><div className="text-center"><div className="font-mono-ui text-[10px] uppercase tracking-[.18em] text-muted-foreground">404 · Off the map</div><h1 className="mt-2 font-display text-3xl font-bold">This page isn't in the fieldbook.</h1><Link href="/" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary">Return to overview <ArrowRight size={15} /></Link></div></div>} /></Switch></AppShell></AuthGate></ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><Router /><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
