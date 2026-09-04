'use client';

/*
 * Customer Unreachable — the rows behind the Home tile.
 *
 * Jobs where the customer could not be reached on THREE DIFFERENT DAYS inside
 * a three-day span. Three calls in one afternoon is one bad afternoon and does
 * not qualify; one call across three days is a single attempt and does not
 * either. The server counts it — tbl_job.call_later is a bit(1) flag with no
 * count and no dates, so it cannot express a pattern.
 *
 * ⚠ OPEN JOBS ONLY. A completed or cancelled job carries the same unreachable
 * history forever, and listing it would put work nobody can act on in front of
 * a client. The route applies job_status NOT IN (3,5,6,7), the SAME predicate
 * the tile's count uses, so the number and this list cannot disagree.
 *
 * TWO ACTIONS, added 2026-09-04 — this is the "later decision" the previous
 * version of this comment was waiting on.
 *
 * NEITHER ONE CANCELS ANYTHING. Per ops a client cannot cancel a booking: they
 * raise a REQUEST and ops acts on it. So the button says "Request
 * Cancellation", and the server writes a remark that surfaces to ops as a chip
 * on My Orders -> Unconfirmed. A control labelled Cancel that does not cancel
 * would be worse than the nothing that used to be here.
 *
 * A row that has already been asked about states so instead of offering the
 * button again: the request cannot be withdrawn from here, so a second one
 * would only add a duplicate remark for ops to read. That state comes from the
 * SERVER, not from local memory — otherwise a reload makes the request
 * invisible and the client sends it twice.
 */
import { PhoneOff, AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetchOnce } from '@/lib/hooks';
import { openJobDrawer } from '@/components/job-drawer';
import { formatIst } from '@/lib/format';
import { api } from '@/lib/api';
import {
  PageHeader, SectionLabel, Panel, DataTable, Row, Cell, Pill,
  ActionButton, EmptyState,
} from '@/components/ui/console';

type UnreachableJob = {
  jobId: number;
  reference: string | null;
  jobStatus: number;
  city: string;
  category: string;
  ageDays: number;
  unreachableDays: number;
  attempts: number;
  lastAttempt: string | null;
  /*
   * What THIS client has already asked for on this job: 'cancel' | 'retry'.
   * Server-provided rather than remembered locally, because the only feedback a
   * client otherwise has that their request worked is that nothing happened —
   * which reliably produces the same request twice.
   */
  clientRequest: 'cancel' | 'retry' | null;
};

/*
 * The two things a client can ask ops to do here. NEITHER CANCELS ANYTHING:
 * per ops a client raises a request and ops acts on it, so the wording is
 * "Request Cancellation", never "Cancel". A button that says Cancel and does
 * not cancel is worse than no button.
 */
const REQUESTS = {
  cancel: { label: 'Request Cancellation', done: 'Cancellation requested', hint: 'Ops will review and cancel the booking.' },
  retry: { label: 'Ask to Retry', done: 'Retry requested', hint: 'Ops will try the customer again.' },
} as const;
type RequestKind = keyof typeof REQUESTS;

const num = (n: number) => n.toLocaleString('en-IN');

export default function UnreachablePage() {
  const router = useRouter();
  const { data, loading, error, reload } =
    useFetchOnce<{ items: UnreachableJob[]; total: number }>('/unreachable-jobs?limit=200');

  const items = data?.items ?? [];
  const [pending, setPending] = useState<{ jobId: number; kind: RequestKind } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function send() {
    if (!pending || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await api.post(`/jobs/${pending.jobId}/client-request`, {
        kind: pending.kind,
        comment: note.trim(),
      });
      setPending(null);
      setNote('');
      // Refetch rather than patching the row: the server decides what a job's
      // request state is, and a locally-patched row would disagree with it the
      // moment anything else changes.
      await reload();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not send the request. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Customer Unreachable"
        sub={
          data
            ? `${num(data.total)} open job${data.total === 1 ? '' : 's'} · unreachable on 3 different days within 3 days`
            : 'Unreachable on 3 different days within 3 days'
        }
      />

      <SectionLabel>Repeatedly unreachable</SectionLabel>

      {loading && !data ? (
        <Panel>
          <div className="py-10 text-center">
            <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
            <div className="mt-2 text-sm text-ink-500">Loading unreachable jobs…</div>
          </div>
        </Panel>
      ) : error ? (
        <Panel accent="brand">
          <EmptyState
            icon={AlertTriangle}
            title="Could not load unreachable jobs"
            sub={error}
            action={<ActionButton onClick={() => void reload()}>Try Again</ActionButton>}
          />
        </Panel>
      ) : items.length === 0 ? (
        <Panel>
          {/* A genuinely good state, and it says so — an empty list here means
              nobody has been chased three days running, not that a filter is
              hiding rows. */}
          <EmptyState
            icon={PhoneOff}
            title="No repeatedly unreachable jobs"
            sub="No open job has an unreachable outcome on three different days inside a three-day span."
            action={<ActionButton onClick={() => router.push('/jobs')}>Open Jobs →</ActionButton>}
          />
        </Panel>
      ) : (
        <Panel bodyClassName="px-0 py-0">
          {/*
            * Inline, not a modal: this page's other affordances are inline and
            * the row stays visible behind it, so the operator can still see
            * WHICH job they are asking about while typing.
            */}
          {pending && (
            <div className="px-4 py-3 border-b border-ink-100 bg-surface-alt">
              <div className="text-sm font-medium text-ink-900">
                {REQUESTS[pending.kind].label} · {items.find((x) => x.jobId === pending.jobId)?.reference || `Job ${pending.jobId}`}
              </div>
              <p className="mt-0.5 text-xs text-ink-500">{REQUESTS[pending.kind].hint}</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Anything ops should know (optional)"
                className="mt-2 w-full rounded-md border border-ink-100 bg-surface px-2.5 py-1.5 text-sm"
              />
              {failed && <p className="mt-1 text-xs text-brand">{failed}</p>}
              <div className="mt-2 flex items-center gap-2">
                <ActionButton onClick={() => void send()} disabled={busy}>
                  {busy ? 'Sending…' : 'Send Request'}
                </ActionButton>
                <ActionButton variant="ghost" onClick={() => { setPending(null); setFailed(null); }} disabled={busy}>
                  Cancel
                </ActionButton>
              </div>
            </div>
          )}
          <DataTable
            className="rounded-none border-0"
            columns={[
              { key: 'ref', label: 'Order' },
              { key: 'city', label: 'City · work' },
              { key: 'days', label: 'Days unreachable', align: 'right' },
              { key: 'attempts', label: 'Attempts', align: 'right' },
              { key: 'last', label: 'Last attempt', align: 'right' },
              { key: 'age', label: 'Age', align: 'right' },
              { key: 'action', label: '', align: 'right' },
            ]}
          >
            {items.map((j) => (
              <Row key={j.jobId} edge={j.unreachableDays >= 5 ? 'brand' : 'warning'}>
                <Cell className="font-medium text-ink-900">{j.reference || `Job ${j.jobId}`}</Cell>
                <Cell>
                  <span className="block text-ink-900">{j.city}</span>
                  <span className="block text-xs text-ink-500">{j.category}</span>
                </Cell>
                {/* The DAYS are the finding, not the attempts: three calls in
                    one afternoon is one bad afternoon. Attempts sit beside it
                    so a reader can tell persistence from repetition. */}
                <Cell align="right">
                  <Pill accent={j.unreachableDays >= 5 ? 'brand' : 'warning'}>{num(j.unreachableDays)} days</Pill>
                </Cell>
                <Cell align="right" className="tabular-nums text-ink-500">{num(j.attempts)}</Cell>
                <Cell align="right" className="tabular-nums text-ink-500">
                  {formatIst(j.lastAttempt, { day: 'numeric', month: 'short', year: 'numeric' }, { fallback: '—' })}
                </Cell>
                <Cell align="right" className="tabular-nums">{num(j.ageDays)}d</Cell>
                <Cell align="right">
                  <div className="flex items-center justify-end gap-1.5">
                    {j.clientRequest ? (
                      /* Already asked. The row states what was requested rather
                         than offering the button again — the request is not
                         withdrawable from here, so a second one would only
                         add a duplicate remark for ops to read. */
                      <Pill accent="info">{REQUESTS[j.clientRequest].done}</Pill>
                    ) : (
                      <>
                        <ActionButton onClick={() => { setPending({ jobId: j.jobId, kind: 'retry' }); setNote(''); setFailed(null); }}>
                          {REQUESTS.retry.label}
                        </ActionButton>
                        <ActionButton onClick={() => { setPending({ jobId: j.jobId, kind: 'cancel' }); setNote(''); setFailed(null); }}>
                          {REQUESTS.cancel.label}
                        </ActionButton>
                      </>
                    )}
                    <ActionButton variant="ghost" onClick={() => openJobDrawer(j.jobId)}>View</ActionButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>
      )}
    </>
  );
}
