import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetCompanyQueryKey, getGetDashboardQueryKey, useGenerateMessageDraft, useGetCompany, useGetDashboard,
  useLogCopiedMessage, useMarkMessageSent,
} from '@workspace/api-client-react';
import type { MessageDraft } from '@workspace/api-client-react';
import { Button, Notice, SidePanel, Skeleton, StatusChip, dateLabel, errorMessage, isTodayKL, waDigits, wordCount } from '@/components/kit';

type Channel = 'email' | 'whatsapp';

export function EmailPanel({ companyId, open, onClose }: { companyId: number | null; open: boolean; onClose: () => void }) {
  const id = companyId ?? 0;
  const qc = useQueryClient();
  const company = useGetCompany(id, { query: { queryKey: getGetCompanyQueryKey(id), enabled: open && id > 0 } });
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), enabled: open } });
  const gen = useGenerateMessageDraft();
  const copy = useLogCopiedMessage();
  const sent = useMarkMessageSent();
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const genRef = useRef(gen.mutate); genRef.current = gen.mutate;

  useEffect(() => {
    if (!open || !id) return;
    setDraft(null); setError(''); setNote(''); setAcknowledged(false);
    genRef.current({ companyId: id }, { onSuccess: setDraft, onError: e => setError(errorMessage(e, 'The draft could not be generated.')) });
  }, [open, id]);

  const c = company.data;
  const blocked = !!c && (c.isDoNotContact || c.status === 'Do not contact');
  const history = (c?.outreach || []).filter(o => o.sentAt);
  const needsAck = !!c && (c.status === 'Claimed' || history.length > 0 || c.status.startsWith('Sent'));
  const locked = blocked || (needsAck && !acknowledged);
  const wa = c ? waDigits(c.whatsapp) || (c.phoneIsMobile !== false ? waDigits(c.phone) : null) : null;
  const waWords = draft ? wordCount(draft.whatsappBody) : 0;
  const waTooLong = waWords > 40;
  const emailSeq = (c?.emailCount ?? 0) + 1;
  const d = dashboard.data;

  const refresh = () => { qc.invalidateQueries(); };
  const doCopy = async (channel: Channel) => {
    if (!draft || !c || locked) return;
    const text = channel === 'email' ? `Subject: ${draft.subject}\n\n${draft.emailBody}` : draft.whatsappBody;
    try { await navigator.clipboard.writeText(text); } catch { setError('Clipboard access was blocked. Select the text and copy it manually.'); return; }
    copy.mutate({ companyId: c.id, data: { channel } }, {
      onSuccess: () => { setNote(`${channel === 'email' ? 'Email' : 'WhatsApp'} copied and logged. Status is now Claimed until you mark it sent.`); refresh(); },
      onError: e => setError(errorMessage(e, 'Copied, but the activity could not be logged.')),
    });
  };
  const doSent = (channel: Channel) => {
    if (!draft || !c || locked) return;
    if (d && d.sentToday[channel] >= d.limits[channel] && !window.confirm(`You have reached today's ${channel} limit (${d.sentToday[channel]} / ${d.limits[channel]}). Log this as sent anyway?`)) return;
    const other = c.outreach?.find(o => o.channel !== channel && isTodayKL(o.sentAt));
    if (other && !window.confirm(`Warning: a ${other.channel === 'email' ? 'email' : 'WhatsApp message'} was already sent to ${c.name} today (Malaysia time). Sending by both email and WhatsApp on the same day can feel pushy. Log this ${channel === 'email' ? 'email' : 'WhatsApp message'} as sent anyway?`)) return;
    const seq = channel === 'email' ? emailSeq : (c.whatsappCount ?? 0) + 1;
    sent.mutate({ companyId: c.id, data: { channel, sequenceNo: Math.max(1, Math.min(3, seq)), subject: channel === 'email' ? draft.subject : undefined, body: channel === 'email' ? draft.emailBody : draft.whatsappBody } }, {
      onSuccess: () => { setNote(`Logged as sent. The next follow-up has been scheduled.`); refresh(); },
      onError: e => setError(errorMessage(e, 'Could not log this message as sent.')),
    });
  };
  const openWa = () => {
    if (!draft || !wa || locked || waTooLong) return;
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(draft.whatsappBody)}`, '_blank', 'noopener,noreferrer');
  };

  return <SidePanel open={open} onClose={onClose} title={c ? <span className="flex items-center gap-2"><span className="truncate">{c.name}</span><StatusChip status={c.status} /></span> : 'Email draft'}>
    {company.isLoading && <div className="space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-40" /></div>}
    {company.isError && <Notice tone="risk">This company could not be loaded. <button className="underline" onClick={() => company.refetch()}>Retry</button></Notice>}
    {c && <div className="space-y-5">
      {blocked && <Notice tone="risk">This company is marked Do not contact. Outreach actions are permanently hidden.</Notice>}
      {!blocked && needsAck && <Notice tone="warn">
        <div className="font-medium">This company already has outreach history.</div>
        {history.length > 0 ? <ul className="mt-2 space-y-1">{history.map(o => <li key={o.id}>{o.channel === 'email' ? 'Email' : 'WhatsApp'} #{o.sequenceNo} sent {dateLabel(o.sentAt)}{o.repliedAt ? `, replied ${dateLabel(o.repliedAt)}` : ''}</li>)}</ul> : <p className="mt-1">A draft was copied (status Claimed) but nothing is marked sent yet.</p>}
        {!acknowledged && <Button size="sm" className="mt-3" onClick={() => setAcknowledged(true)} data-testid="button-ack-history">I have checked the history, continue</Button>}
      </Notice>}
      {d && <div className="flex gap-6 text-[13px] text-muted-foreground tabular">
        <span data-testid="text-email-today">Emails today {d.sentToday.email} / {d.limits.email}</span>
        <span data-testid="text-whatsapp-today">WhatsApp today {d.sentToday.whatsapp} / {d.limits.whatsapp}</span>
      </div>}
      {d && d.sentToday.email >= d.limits.email && <Notice tone="warn">Daily email limit reached. Consider stopping for today.</Notice>}
      {gen.isPending && <div className="space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-48" /><Skeleton className="h-20" /></div>}
      {error && <Notice tone="risk">{error}</Notice>}
      {note && <Notice tone="info">{note}</Notice>}
      {draft && <>
        <div className="text-xs text-muted-foreground">Finding used: <span className="text-foreground">{draft.finding}</span> · {draft.draftMode === 'gemini' ? `AI draft${draft.aiModel ? ` (${draft.aiModel})` : ''}` : 'Template draft'}</div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium">Email {Math.min(emailSeq, 3)} of 3</div>
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2 text-sm" data-testid="text-draft-subject"><span className="text-muted-foreground">Subject: </span>{draft.subject}</div>
            <pre className="whitespace-pre-wrap px-3 py-3 font-sans text-sm leading-6" data-testid="text-draft-email">{draft.emailBody}</pre>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={locked || copy.isPending} onClick={() => doCopy('email')} data-testid="button-copy-email">Copy email</Button>
            <Button disabled={locked || sent.isPending || emailSeq > 3} onClick={() => doSent('email')} data-testid="button-mark-sent-email">Mark email as sent</Button>
          </div>
          {emailSeq > 3 && <p className="mt-2 text-[13px] text-muted-foreground">Three emails already sent. No more emails for this company.</p>}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[13px] font-medium"><span>WhatsApp version</span><span className={waTooLong ? 'text-[#7a3128]' : 'text-muted-foreground'}>{waWords} / 40 words</span></div>
          <pre className="whitespace-pre-wrap rounded-lg border border-border px-3 py-3 font-sans text-sm leading-6" data-testid="text-draft-whatsapp">{draft.whatsappBody}</pre>
          {waTooLong && <p className="mt-2 text-[13px] text-[#7a3128]">This WhatsApp draft is over 40 words. Regenerate before using it.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={locked || waTooLong || copy.isPending} onClick={() => doCopy('whatsapp')} data-testid="button-copy-whatsapp">Copy WhatsApp</Button>
            {wa && draft.canOpenWhatsapp && <Button disabled={locked || waTooLong} onClick={openWa} data-testid="button-open-whatsapp">Open WhatsApp</Button>}
            <Button disabled={locked || sent.isPending || waTooLong} onClick={() => doSent('whatsapp')} data-testid="button-mark-sent-whatsapp">Mark WhatsApp as sent</Button>
          </div>
          {!wa && <p className="mt-2 text-[13px] text-muted-foreground">No Malaysian mobile number (+601 or 01) on file, so there is no WhatsApp link.</p>}
          {wa && c.whatsappDerived && <p className="mt-2 text-[13px] text-muted-foreground">WhatsApp number derived from the mobile phone, not confirmed.</p>}
        </div>
        <Button variant="text" size="sm" disabled={gen.isPending} onClick={() => { setError(''); gen.mutate({ companyId: c.id }, { onSuccess: setDraft, onError: e => setError(errorMessage(e, 'The draft could not be generated.')) }); }} data-testid="button-regenerate">Regenerate draft</Button>
        <p className="text-xs text-muted-foreground">Nothing is sent from here. Copy, send it yourself, then mark it sent.</p>
      </>}
    </div>}
  </SidePanel>;
}
