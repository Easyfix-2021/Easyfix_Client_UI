/**
 * My action queue — the full-page version of Home's "Jobs waiting on you".
 *
 * Home shows the four oldest items and a "View All →". This is where that link
 * lands: the same rows, the same grammar, nothing truncated. One brand-accented
 * Panel, one ListRow per item, in the server's own order (oldest first).
 *
 * WHERE THE ROWS COME FROM
 *
 *   GET /action-queue?limit=100 — and that is the ONLY source on this page.
 *   The endpoint returns work that is blocked ON THE CLIENT: a job with at
 *   least one approval-pending billing line that the client has neither
 *   approved nor rejected. That is the exact condition
 *   PATCH /jobs/:id/estimate/approve clears, so the queue and the action that
 *   empties it cannot drift apart.
 *
 * WHAT THIS PAGE DELIBERATELY DOES NOT DO
 *
 *   It does not approve. Clicking a row opens the read-only job drawer, which
 *   carries the job's customer, lifecycle, checklist and photos — but NOT the
 *   estimate lines (GET /jobs/:id returns no charges). The approve/reject
 *   decision lives on Open jobs, where the lines and the value are on screen
 *   next to the button. Two places that can both approve is two places that can
 *   disagree about what was approved.
 *
 *   It does not aggregate. Every figure below is either a field off a returned
 *   row or a count of the rows themselves. Where the mock implied a number this
 *   endpoint cannot source, the line says what it actually measures and is
 *   marked SUBSTITUTED.
 */
'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, CheckCircle2, Building2, ClipboardCheck, ArrowDownWideNarrow, Loader2,
} from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import { useAccess } from '@/lib/spoc-context';
import { openJobDrawer } from '@/components/job-drawer';
import {
  PageHeader, SectionLabel, Panel, ListRow, Pill, FilterChip,
  ActionButton, EmptyState,
} from '@/components/ui/console';
import type { Accent } from '@/components/ui/console';

/* ─── contract ──────────────────────────────────────────────────────────────
 * Mirrors the mapper at the bottom of GET /api/client/action-queue, field for
 * field. `action` is the endpoint that clears the row (PATCH .../estimate/approve);
 * it is typed here for completeness but deliberately NOT called or labelled from
 * this page — see the note on the row button below.
 */
type QueueItem = {
  type: string;
  jobId: number;
  reference: string | null;
  city: string | null;
  category: string | null;
  ageDays: number;
  estimateValue: number | null;
  action: { label: string; method: string; path: string };
};

type Queue = { items: QueueItem[]; total: number; types: string[] };

/*
 * The endpoint's own ceiling (?limit=1..100, default 25). Home takes the
 * default and shows four; this page asks for the maximum, because "view all"
 * that quietly stops at 25 is the worst of both.
 */
const LIMIT = 100;

/*
 * The queue carries one type today — the backend is explicit that site access,
 * PO-pending and QC sign-off have no column in tbl_job yet and are absent
 * rather than approximated. Mapping type → wording HERE means a second type
 * arriving later renders as itself instead of silently reading "Estimate
 * approval".
 */
const TYPE_LABEL: Record<string, string> = {
  approval: 'Estimate approval',
};

/*
 * Severity by age, using the SAME bands as the Open jobs ageing strip
 * (> 5 days brand, 4–5 warning, below that informational) so one job does not
 * look urgent on this screen and calm on that one.
 */
function ageAccent(days: number): Accent {
  if (days > 5) return 'brand';
  if (days >= 4) return 'warning';
  return 'info';
}

/** Rounded for display only — the estimate itself is stored to two decimals. */
const rupees = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function ActionQueuePage() {
  const router = useRouter();
  const access = useAccess();
  const { data, loading, error, reload } = useFetchOnce<Queue>(`/action-queue?limit=${LIMIT}`);

  const items = useMemo(() => data?.items ?? [], [data]);

  const summary = useMemo(() => {
    const priced = items.filter((i) => i.estimateValue != null);
    return {
      count: items.length,
      oldest: items.reduce((a, i) => Math.max(a, i.ageDays), 0),
      pricedCount: priced.length,
      pricedValue: priced.reduce((a, i) => a + (i.estimateValue ?? 0), 0),
      // The server LIMITs rather than paginating, so a full page is the signal
      // that there may be more behind it.
      capped: items.length >= LIMIT,
    };
  }, [items]);

  if (loading) {
    return (
      <div className="bg-surface rounded-xl border border-ink-100 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
        <div className="mt-2 text-sm text-ink-500">Loading your action queue…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load your action queue"
          sub={error || 'The action-queue service did not respond.'}
          action={<ActionButton onClick={() => void reload()}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  return (
    <>
      <PageHeader
        title="My action queue"
        sub={
          summary.count === 0
            ? 'Nothing is waiting on you'
            : /* SUBSTITUTED: the mock's header counts the whole queue. This
                 endpoint returns `total = items.length`, i.e. the rows it just
                 sent under ?limit — it never counts past the limit. So the line
                 says "shown", and says so plainly when the page is full. */
              `${summary.count} item${summary.count === 1 ? '' : 's'} shown · oldest ${summary.oldest}d waiting${
                summary.capped ? ` · the ${LIMIT} oldest` : ''
              }`
        }
        filters={
          <>
            {/* Readouts of the scope the SERVER applied, not controls. The
                store scope is the same `allStores` flag the query is filtered
                by, and the type chip names the one queue type the endpoint
                emits — both are facts about the rows below, so showing them
                beats offering a filter that would change nothing. */}
            <FilterChip icon={Building2}>{access.allStores ? 'All stores' : 'Your stores'}</FilterChip>
            <FilterChip icon={ClipboardCheck}>
              {(data.types ?? []).map((t) => TYPE_LABEL[t] ?? t).join(' · ') || 'Estimate approvals'}
            </FilterChip>
            <FilterChip icon={ArrowDownWideNarrow}>Oldest first</FilterChip>
          </>
        }
      />

      <SectionLabel>Waiting on you</SectionLabel>
      <Panel
        accent="brand"
        title={
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-primary" aria-hidden />
            Jobs waiting on you
          </span>
        }
        action={summary.count ? <Pill accent="brand">{summary.count} item{summary.count === 1 ? '' : 's'}</Pill> : null}
      >
        {summary.count ? (
          <>
            {items.map((it) => (
              <ListRow
                key={it.jobId}
                title={`${TYPE_LABEL[it.type] ?? 'Action needed'} — ${it.reference || `Job ${it.jobId}`}`}
                sub={
                  [
                    it.city,
                    it.category,
                    it.estimateValue != null ? `Estimate ${rupees(it.estimateValue)}` : null,
                  ].filter(Boolean).join(' · ')
                }
                /* ageDays is TIMESTAMPDIFF(HOUR, created, NOW()) DIV 24 — a 0 means
                   under 24 hours elapsed, which can still be yesterday evening. So it
                   reads "under a day", not "today". */
                age={it.ageDays === 0 ? 'under a day' : `${it.ageDays}d waiting`}
                ageAccent={ageAccent(it.ageDays)}
                action={
                  /* SUBSTITUTED: the row arrives labelled "Approve" (its
                     action is PATCH /jobs/:id/estimate/approve), but this page
                     opens the job drawer instead of calling it, and the drawer
                     carries no approve control. A button reading "Approve"
                     would promise an effect this click cannot deliver, so it
                     says what it does; the row TITLE still carries the
                     decision that is pending. */
                  <ActionButton onClick={() => openJobDrawer(it.jobId)}>Review</ActionButton>
                }
              />
            ))}

            {summary.pricedCount > 0 && (
              <div className="flex items-center justify-between gap-3 pt-2.5 text-xs">
                <span className="text-ink-500">
                  {/* Sum over the ROWS ON THIS PAGE that carry a value — not a
                      queue-wide exposure figure, and labelled as such. */}
                  Combined value of the {summary.pricedCount} priced estimate
                  {summary.pricedCount === 1 ? '' : 's'} shown
                </span>
                <span className="font-semibold text-ink-900 tabular-nums">{rupees(summary.pricedValue)}</span>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing waiting on you"
            sub="Every estimate we have sent you has been approved or rejected."
            action={<ActionButton onClick={() => router.push('/jobs')}>View Open Jobs</ActionButton>}
          />
        )}
      </Panel>
    </>
  );
}
