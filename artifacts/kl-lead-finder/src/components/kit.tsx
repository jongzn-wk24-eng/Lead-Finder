import { useEffect } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function cx(...classes: Array<string | false | null | undefined>) { return classes.filter(Boolean).join(' '); }

export const STATUSES = ['New', 'Claimed', 'Sent #1', 'Sent #2', 'Sent #3', 'Replied', 'Wants hero', 'Hero sent', 'Won', 'Not interested', 'Do not contact', 'Closed: no reply'];
export const ATTRIBUTION = 'Map data © OpenStreetMap contributors (ODbL)';

export function klDay(date: Date) { return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }); }
export function isTodayKL(value?: string | null) { return !!value && klDay(new Date(value)) === klDay(new Date()); }
export function dueByToday(value?: string | null) {
  if (!value) return false;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && klDay(new Date(t)) <= klDay(new Date());
}
export function dateLabel(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' });
}
export function dateTimeLabel(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });
}
export function errorMessage(error: unknown, fallback: string) {
  const anyErr = error as { data?: { error?: string; message?: string }; message?: string } | null;
  const message = anyErr?.data?.error || anyErr?.data?.message || (error instanceof Error ? error.message : '');
  const n = message.toLowerCase();
  if (n.includes('need a real finding first')) return 'Need a real finding first. A stored website check result is required before a draft can be written.';
  if (n.includes('whatsapp') && (n.includes('setting') || n.includes('required') || n.includes('missing'))) return 'Your WhatsApp number is missing. Add it in Settings before generating a draft.';
  return message || fallback;
}
export function safeHttpUrl(value?: string | null) {
  if (!value) return null;
  try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
}
/** Returns digits for wa.me only for Malaysian mobile numbers (+601 / 01). */
export function waDigits(value?: string | null) {
  if (!value) return null;
  const raw = value.replace(/[\s\-()]/g, '');
  if (/^\+601\d{7,9}$/.test(raw)) return raw.slice(1);
  if (/^601\d{7,9}$/.test(raw)) return raw;
  if (/^01\d{7,9}$/.test(raw)) return `6${raw}`;
  return null;
}
export function wordCount(text: string) { return text.trim() ? text.trim().split(/\s+/).length : 0; }
export function mapsSearchUrl(name: string, address?: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(' '))}`;
}
export function isLatin(text: string) { return /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}&+]*$/u.test(text); }

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'text' | 'danger'; size?: 'sm' | 'md' }) {
  return <button type="button" {...props} className={cx(
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50',
    size === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-[13px]',
    variant === 'primary' && 'bg-primary text-primary-foreground hover:bg-[#2850d4]',
    variant === 'secondary' && 'border border-border bg-card text-foreground hover:bg-muted',
    variant === 'text' && 'px-2 text-primary hover:bg-accent',
    variant === 'danger' && 'border border-[#ead3d0] bg-card text-[#8a2f25] hover:bg-[#fbf3f2]',
    className)} />;
}
export function Field({ label, hint, error, className, children }: { label: string; hint?: string; error?: string; className?: string; children: ReactNode }) {
  return <label className={cx('grid content-start gap-1.5 text-[13px] font-medium text-foreground', className)}>
    {label}{children}
    {error ? <span role="alert" className="text-xs font-normal text-[#8a2f25]">{error}</span> : hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
  </label>;
}
const control = 'w-full rounded-lg border border-border bg-card text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15 aria-[invalid=true]:border-[#c98a82]';
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={cx(control, 'h-10 px-3', props.className)} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={cx(control, 'h-10 px-2.5', props.className)} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={cx(control, 'px-3 py-2 leading-6', props.className)} />; }
export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className="inline-flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" {...props} className="h-4 w-4 accent-[#2F5BEA]" />{label}</label>;
}

export function Surface({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) {
  return <section {...rest} className={cx('rounded-lg border border-border bg-card', className)}>{children}</section>;
}
export function SectionHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
    <div><h2 className="text-[15px] font-semibold">{title}</h2>{sub && <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p>}</div>{right}
  </div>;
}
export function PageHeader({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div><h1 className="text-2xl font-semibold tracking-[-.01em]">{title}</h1>{sub && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{sub}</p>}</div>{right}
  </div>;
}

const chipTone: Record<string, string> = {
  New: 'bg-[#f1f0ee] text-[#3a3a3e]', Claimed: 'bg-[#f7efdc] text-[#5c4515]',
  'Sent #1': 'bg-[#e8eefc] text-[#23408f]', 'Sent #2': 'bg-[#e8eefc] text-[#23408f]', 'Sent #3': 'bg-[#e8eefc] text-[#23408f]',
  Replied: 'bg-[#e6f1ec] text-[#24533f]', 'Wants hero': 'bg-[#e6f1ec] text-[#24533f]', 'Hero sent': 'bg-[#e6f1ec] text-[#24533f]', Won: 'bg-[#e1efe7] text-[#1d4a33]',
  'Not interested': 'bg-[#f1f0ee] text-[#6B6B70]', 'Closed: no reply': 'bg-[#f1f0ee] text-[#6B6B70]', 'Do not contact': 'bg-[#f6eceb] text-[#7a3128]',
};
export function Chip({ children, tone, className, ...rest }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'info' | 'risk'; className?: string } & Record<string, unknown>) {
  const t = tone === 'warn' ? 'bg-[#f7efdc] text-[#5c4515]' : tone === 'info' ? 'bg-accent text-accent-foreground' : tone === 'risk' ? 'bg-[#f6eceb] text-[#7a3128]' : 'bg-[#f1f0ee] text-[#3a3a3e]';
  return <span {...rest} className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium', t, className)}>{children}</span>;
}
export function StatusChip({ status }: { status: string }) {
  return <span data-testid={`status-${status}`} className={cx('inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 text-xs font-medium', chipTone[status] || chipTone.New)}>{status}</span>;
}
export function ScoreBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className={cx('w-full min-w-[56px]', className)}>
    <div className="text-right text-sm font-medium tabular">{Math.round(value)}<span className="text-xs text-muted-foreground"> / {max}</span></div>
    <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[#efedeb]"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
  </div>;
}
export function Skeleton({ className }: { className?: string }) { return <div className={cx('animate-pulse rounded-md bg-[#efedeb]', className)} />; }
export function PageSkeleton() {
  return <div className="space-y-4"><Skeleton className="h-8 w-56" /><div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-64" /></div>;
}
export function ErrorState({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return <Surface className="px-6 py-12 text-center" data-testid="state-error">
    <p className="text-sm font-medium">This view could not be loaded.</p>
    <p className="mt-1 text-[13px] text-muted-foreground">{message || 'The workspace could not reach the API.'}</p>
    <Button className="mt-4" onClick={onRetry} data-testid="button-retry">Try again</Button>
  </Surface>;
}
export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="px-6 py-12 text-center" data-testid="state-empty"><p className="text-sm text-muted-foreground">{text}</p>{action && <div className="mt-4">{action}</div>}</div>;
}
export function Notice({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'warn' | 'risk' | 'info'; children: ReactNode; className?: string }) {
  const t = tone === 'warn' ? 'border-[#ecdcb4] bg-[#fbf6ea] text-[#5c4515]' : tone === 'risk' ? 'border-[#ead3d0] bg-[#fbf3f2] text-[#7a3128]' : tone === 'info' ? 'border-[#d5def9] bg-[#f3f6fe] text-[#23408f]' : 'border-border bg-muted text-foreground';
  return <div role={tone === 'risk' || tone === 'warn' ? 'alert' : undefined} className={cx('rounded-lg border px-4 py-3 text-[13px] leading-5', t, className)}>{children}</div>;
}

export function SidePanel({ open, title, onClose, children, footer }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
    <div className="absolute inset-0 bg-[#1C1C1E]/20" onClick={onClose} />
    <aside className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0 text-[15px] font-semibold">{title}</div>
        <Button variant="text" size="sm" onClick={onClose} data-testid="button-close-panel">Close</Button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      {footer && <div className="border-t border-border px-6 py-4">{footer}</div>}
    </aside>
  </div>;
}
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
    <div className="absolute inset-0 bg-[#1C1C1E]/20" onClick={onClose} />
    <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4"><h2 className="text-[15px] font-semibold">{title}</h2><Button variant="text" size="sm" onClick={onClose}>Close</Button></div>
      <div className="px-6 py-5">{children}</div>
    </div>
  </div>;
}
export function Footer() {
  return <footer className="mx-auto max-w-[1200px] px-4 pb-8 pt-4 text-xs text-muted-foreground sm:px-6" data-testid="text-osm-attribution">
    Map data © <a className="underline underline-offset-2 hover:text-foreground" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL)
  </footer>;
}
