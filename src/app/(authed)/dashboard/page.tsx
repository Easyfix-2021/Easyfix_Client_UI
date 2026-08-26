/**
 * Home — the client console's landing screen.
 *
 * Built to the design the client team shared, block for block: a dated header
 * with scope filters, TODAY'S PULSE, then the two-column ACTION QUEUE / OPEN
 * BREAKDOWN pair, then the three-column PERFORMANCE HEALTH / PLANNED TODAY /
 * CANCELLATIONS row. Every piece of chrome comes from src/components/ui/console,
 * so this file holds composition and arithmetic — not styling.
 *
 * WHERE THE NUMBERS COME FROM, AND WHERE THEY DO NOT
 *
 * Three sources, deliberately:
 *   /dashboard-summary  aggregates the server can do far better than we can —
 *                       ageing buckets, attention counts, 30-day trend.
 *   /action-queue       the rows in "Jobs waiting on you", with the endpoint
 *                       that clears each one carried on the row itself.
 *   useRecentJobs       a 60-day job window, for the cuts that need an
 *                       APPOINTMENT date. /dashboard-summary has no notion of
 *                       "planned today" or "closed yesterday", and adding one
 *                       would mean a server round trip per filter change.
 *
 * The mock was drawn against a richer dataset than this API exposes. Where a
 * tile had no honest source it is labelled for what it actually measures rather
 * than made to read like the mock — a dashboard that displays a number nobody
 * can trace is worse than one that admits a gap. Each substitution is marked
 * SUBSTITUTED below.
 */
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FolderOpen, CheckCircle2, CalendarDays, CalendarRange,
  AlertTriangle, MapPin, Building2, User, Loader2,
} from 'lucide-react';
import { useFetchOnce, useRecentJobs } from '@/lib/hooks';
import { useAccess } from '@/lib/spoc-context';
import { openJobDrawer } from '@/components/job-drawer';
import {
  PageHeader, SectionLabel, StatRow, StatCard, Panel, ListRow, Pill,
  FilterChip, RankedList, ProportionBar, MetricRow, ActionButton, EmptyState,
} from '@/components/ui/console';

/* ─── contracts ─────────────────────────────────────────────────────────── */

type Summary = {
  boxes: { newTickets: number; waitingForAllocation: number; runningLate: number; estimateApproved: number; estimateRejected: number };
  slaAging: { d01: number; d23: number; d47: number; d7plus: number };
  attention: {
    invoicesDue: { count: number; amount: number };
    estimatePending: number; noResponse: number; onHold: number; revisit: number; qcDone: number;
  };
  counts: { newTickets: number; inProgress: number; completed: number; cancelled: number; escalated: number };
  categoryBreakdown?: Array<{ label: string; count: number }>;
  teamSize: number;
};

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

/** Only the columns this page actually reads off the 60-day job window. */
type DashJob = {
  job_id?: number;
  job_status?: number | null;
  requested_date_time?: string | null;
  checkout_date_time?: string | null;
};

/* ─── date helpers ──────────────────────────────────────────────────────── */

const parse = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Monday-anchored week bounds, because the mock's tile says "Mon–Sun". */
function weekBounds(now: Date) {
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  const mon = addDays(now, -dow);
  return { from: mon, to: addDays(mon, 7) };
}

/* ─── the range control ─────────────────────────────────────────────────────
 *
 * Presets only, no custom picker: these are the cuts the rest of the console
 * reports on, and a free date pair invites windows wide enough to make the
 * three cards below slow for no analytical gain.
 *
 * The bounds are LOCAL calendar dates on purpose. They are constructed here,
 * not read off the wire, so they must NOT go through the IST helpers in
 * lib/format — see the calendar-date warning there. `to` is inclusive; the
 * server turns it into `< to + 1 day`.
 */
type RangeKey = 'd7' | 'd30' | 'd60' | 'd90' | 'month' | 'lastMonth';

const RANGE_PRESETS: Array<{ key: RangeKey; label: string }> = [
  { key: 'd7',        label: 'Last 7 days' },
  { key: 'd30',       label: 'Last 30 days' },
  { key: 'd60',       label: 'Last 60 days' },
  { key: 'd90',       label: 'Last 90 days' },
  { key: 'month',     label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeFor(key: RangeKey, now: Date): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === 'month')     return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
  if (key === 'lastMonth') return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
  const days = key === 'd7' ? 7 : key === 'd30' ? 30 : key === 'd90' ? 90 : 60;
  return { from: ymd(addDays(now, -(days - 1))), to: ymd(now) };
}

/** GET /dashboard-range — the three cards below Today's Pulse. */
type RangeData = {
  window: { from: string; to: string };
  performance: {
    total: number; completed: number; inProgress: number;
    runningLate: number; escalated: number; cancelled: number;
  };
  cities: Array<{ name: string; jobs: number; completed: number }>;
  cancellations: {
    cancelled: number; total: number; sharePct: number;
    topReasons: Array<{ reason: string; count: number; pct: number }>;
    reasonCount: number;
    categories: Array<{ label: string; count: number; pct: number }>;
  };
};

const COMPLETED = new Set([3, 5]);
const CANCELLED = new Set([6, 7]);
const OPEN = new Set([0, 1, 2, 20]);

export default function HomePage() {
  const router = useRouter();
  const access = useAccess();
  const { data, loading, error, reload } = useFetchOnce<Summary>('/dashboard-summary');
  const { data: queue } = useFetchOnce<{ items: QueueItem[]; total: number }>('/action-queue');
  const { jobs } = useRecentJobs<DashJob>();

  const now = useMemo(() => new Date(), []);

  /*
   * The range drives the THREE CARDS BELOW ONLY. Today's Pulse, the action
   * queue and the open breakdown are live figures — "how many orders are open"
   * has no date range, so the control sits with the cards it governs rather
   * than looking like it filters the whole page.
   */
  const [rangeKey, setRangeKey] = useState<RangeKey>('d60');
  const range = useMemo(() => rangeFor(rangeKey, now), [rangeKey, now]);
  const rangeLabel = RANGE_PRESETS.find((r) => r.key === rangeKey)?.label ?? '';
  // The path carries from/to, so changing the preset refetches — useFetchOnce
  // re-issues on a PATH change (its lastPathRef guard), which is exactly what
  // makes this work without a manual reload.
  const { data: rangeData, loading: rangeLoading } =
    useFetchOnce<RangeData>(`/dashboard-range?from=${range.from}&to=${range.to}`);

  /*
   * The appointment-derived cuts. Memoised on `jobs` because this walks up to
   * 4,000 rows four times and the page re-renders on every filter chip.
   */
  const derived = useMemo(() => {
    const todayKey = dayKey(now);
    const yKey = dayKey(addDays(now, -1));
    const dbKey = dayKey(addDays(now, -2));
    const { from, to } = weekBounds(now);

    let dueToday = 0, ahead = 0, plannedToday = 0, weekPlanned = 0, weekDone = 0;
    let closedYesterday = 0, closedDayBefore = 0;

    for (const j of jobs) {
      const appt = parse(j.requested_date_time);
      const out = parse(j.checkout_date_time);
      const status = Number(j.job_status);

      if (out) {
        if (dayKey(out) === yKey) closedYesterday += 1;
        if (dayKey(out) === dbKey) closedDayBefore += 1;
      }
      if (!appt) continue;

      const k = dayKey(appt);
      if (OPEN.has(status)) {
        if (k === todayKey) dueToday += 1;
        else if (appt > now) ahead += 1;
      }
      if (k === todayKey) plannedToday += 1;
      if (appt >= from && appt < to) {
        weekPlanned += 1;
        if (COMPLETED.has(status)) weekDone += 1;
      }
    }

    return { dueToday, ahead, plannedToday, weekPlanned, weekDone, closedYesterday, closedDayBefore };
  }, [jobs, now]);

  if (loading) {
    return (
      <div className="bg-surface rounded-xl border border-ink-100 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
        <div className="mt-2 text-sm text-ink-500">Loading your dashboard…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load your dashboard"
          sub={error || 'The summary service did not respond.'}
          /*
           * reload(), NOT router.refresh(). This is a 'use client' page whose
           * data comes from useFetchOnce, which re-issues only when its PATH
           * changes (the lastPathRef guard in src/lib/hooks.ts). router.refresh()
           * re-renders the RSC tree without remounting the client component, so
           * the hook never fires again and the button did nothing at all.
           */
          action={<ActionButton onClick={() => void reload()}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  const { counts, slaAging, attention, boxes } = data;
  const totalOpen = counts.newTickets + counts.inProgress;
  const closedDelta = derived.closedYesterday - derived.closedDayBefore;
  /* Pending on YOU vs pending with EasyFix — the split the mock's bar shows. */
  const onYou = attention.estimatePending + attention.noResponse;
  const withUs = Math.max(0, totalOpen - onYou);

  const longDate = now.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <>
      <PageHeader
        title={longDate}
        sub={`Across ${data.teamSize} SPOC${data.teamSize === 1 ? '' : 's'} · live`}
        filters={
          <>
            {/* The first three remain READOUTS of the current scope until those
                filters ship — a chip that looks interactive but changes nothing
                is worse than one that says what it is. The fourth is now real,
                and is a native <select> rather than a popover: one control, the
                current value always visible, and no dropdown to build. */}
            <FilterChip icon={MapPin}>All cities</FilterChip>
            <FilterChip icon={Building2}>All zones</FilterChip>
            <FilterChip icon={User}>All SPOCs</FilterChip>
            <label className="inline-flex items-center gap-1.5 rounded-full border border-ink-100 bg-surface pl-3 pr-2 py-1.5 text-xs font-medium text-ink-700 focus-within:border-primary">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span className="sr-only">Date range for the performance, city and cancellation cards</span>
              <select
                value={rangeKey}
                onChange={(e) => setRangeKey(e.target.value as RangeKey)}
                className="bg-transparent pr-1 text-xs font-medium text-ink-700 focus:outline-none cursor-pointer"
              >
                {RANGE_PRESETS.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </label>
          </>
        }
      />

      <SectionLabel>Today&rsquo;s pulse</SectionLabel>
      <StatRow className="mb-6">
        <StatCard
          icon={FolderOpen}
          accent="info"
          label="Total open"
          value={totalOpen.toLocaleString('en-IN')}
          sub={`${derived.dueToday} due today · ${derived.ahead} scheduled ahead`}
          onClick={() => router.push('/jobs')}
        />
        <StatCard
          icon={CheckCircle2}
          accent="success"
          label="Closed yesterday"
          value={derived.closedYesterday.toLocaleString('en-IN')}
          sub={closedDelta === 0 ? 'Level with the prior day' : `${closedDelta > 0 ? '↑' : '↓'} ${Math.abs(closedDelta)} vs prior day`}
          onClick={() => router.push('/completed')}
        />
        <StatCard
          icon={CalendarDays}
          accent="info"
          label="Planned today"
          value={derived.plannedToday.toLocaleString('en-IN')}
          // SUBSTITUTED: the mock splits this "allocated · unallocated". The
          // summary exposes waiting-for-allocation for the whole book, not for
          // today, so the sub-line says which figure it actually is.
          sub={`${boxes.waitingForAllocation} awaiting allocation overall`}
        />
        <StatCard
          icon={CalendarRange}
          accent="warning"
          label="Plan this week"
          value={derived.weekPlanned.toLocaleString('en-IN')}
          sub={`Mon–Sun · ${derived.weekDone} already done`}
        />
      </StatRow>

      <div className="grid gap-x-6 gap-y-2 grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] mb-6 items-stretch">
        <div className="flex flex-col min-w-0">
          <SectionLabel>Your action queue</SectionLabel>
          <Panel
            className="flex-1"
            accent="brand"
            title={
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-primary" aria-hidden />
                Jobs waiting on you
              </span>
            }
            action={queue?.total ? <Pill accent="brand">{queue.total} items</Pill> : null}
          >
            {queue?.items?.length ? (
              <>
                {queue.items.slice(0, 4).map((it) => (
                  <ListRow
                    key={it.jobId}
                    title={`Estimate approval — ${it.reference || `Job ${it.jobId}`}${it.city ? ` ${it.city}` : ''}`}
                    sub={[it.category, it.estimateValue != null ? `Estimate ₹${it.estimateValue.toLocaleString('en-IN')}` : null]
                      .filter(Boolean).join(' · ')}
                    age={`${it.ageDays}d waiting`}
                    ageAccent={it.ageDays >= 7 ? 'brand' : 'warning'}
                    action={
                      <ActionButton onClick={() => openJobDrawer(it.jobId)}>{it.action.label}</ActionButton>
                    }
                  />
                ))}
                <div className="flex items-center justify-between pt-2.5 text-xs">
                  <span className="text-ink-500">
                    {queue.total > 4 ? `+ ${queue.total - 4} more item${queue.total - 4 === 1 ? '' : 's'}` : ' '}
                  </span>
                  <button
                    type="button"
                    onClick={() => router.push('/action-queue')}
                    className="text-info hover:text-info-text font-medium"
                  >
                    View All →
                  </button>
                </div>
              </>
            ) : (
              <EmptyState icon={CheckCircle2} title="Nothing waiting on you" sub="Every estimate and access request is answered." />
            )}
          </Panel>
        </div>

        <div className="flex flex-col min-w-0">
          <SectionLabel>Open breakdown</SectionLabel>
          <Panel className="flex-1" title="Pending with EasyFix vs with you">
            <ProportionBar
              segments={[
                { label: `EasyFix (${withUs} jobs)`, value: withUs, accent: 'info' },
                { label: `Pending on you (${onYou} jobs)`, value: onYou, accent: 'brand' },
              ]}
              className="mb-4"
            />
            <div className="text-sm font-semibold text-ink-900 mb-1">Age of open jobs</div>
            <RankedList
              rows={[
                { label: 'Future (not yet due)', value: derived.ahead, accent: 'success' },
                { label: '0–1 days', value: slaAging.d01, accent: 'info' },
                { label: '2–3 days', value: slaAging.d23, accent: 'warning' },
                { label: '4–5 days', value: slaAging.d47, accent: 'warning' },
                { label: '> 5 days', value: slaAging.d7plus, accent: 'brand' },
              ]}
            />
          </Panel>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-2 grid-cols-1 lg:grid-cols-3 items-stretch">
        <div className="flex flex-col min-w-0">
          <SectionLabel>Performance health</SectionLabel>
          <Panel className="flex-1" title={rangeLabel}>
            {access?.grants?.includes('performance') ? (
              <RangeBody loading={rangeLoading} data={rangeData}>
                {(r) => (
                  <>
                    {/*
                      One cohort: the jobs RAISED in the window. Completed,
                      still open, now overdue and escalated are all slices of
                      that same set, so the bars share a denominator and the
                      card reads as "of the work raised here, this is where it
                      stands". Each metric on its own most natural date would
                      make the shares stop reconciling.

                      SLA / first-time-fix / revisit still live behind
                      /performance, which runs the TAT engine — duplicating that
                      maths here is the surest way to have two numbers disagree,
                      so the link stays.
                    */}
                    <MetricRow label="Completed"    value={r.performance.completed.toLocaleString('en-IN')}   bar={r.performance.completed / Math.max(1, r.performance.total)}   barAccent="success" />
                    <MetricRow label="In progress"  value={r.performance.inProgress.toLocaleString('en-IN')}  bar={r.performance.inProgress / Math.max(1, r.performance.total)}  barAccent="info" />
                    <MetricRow label="Running late" value={r.performance.runningLate.toLocaleString('en-IN')} bar={r.performance.runningLate / Math.max(1, r.performance.total)} barAccent="warning" />
                    <MetricRow label="Escalated"    value={r.performance.escalated.toLocaleString('en-IN')}   bar={r.performance.escalated / Math.max(1, r.performance.total)}   barAccent="brand" />
                    <div className="pt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-ink-500">
                        {r.performance.total.toLocaleString('en-IN')} raised in this window
                      </span>
                      <button type="button" onClick={() => router.push('/performance')} className="text-xs text-info hover:text-info-text font-medium">
                        Full Performance Book →
                      </button>
                    </div>
                  </>
                )}
              </RangeBody>
            ) : (
              <EmptyState
                title="Performance is not enabled for you"
                sub="An administrator can grant it against your SPOC record."
              />
            )}
          </Panel>
        </div>

        <div className="flex flex-col min-w-0">
          <SectionLabel>Work done — by city</SectionLabel>
          <Panel
            className="flex-1"
            title={rangeData
              ? `${rangeData.performance.total.toLocaleString('en-IN')} job${rangeData.performance.total === 1 ? '' : 's'} across ${rangeData.cities.length} cit${rangeData.cities.length === 1 ? 'y' : 'ies'}`
              : rangeLabel}
          >
            <RangeBody loading={rangeLoading} data={rangeData} empty={(r) => r.cities.length === 0} emptyTitle="No work in this window">
              {(r) => (
                <>
                  {/* Server-ordered by job count desc; the slice is presentation
                      only, and the remainder line below accounts for the rest so
                      the visible four never read as the whole picture. */}
                  <RankedList
                    rows={r.cities.slice(0, 4).map((c) => ({
                      label: (
                        <span className="block">
                          <span className="block text-ink-900">{c.name}</span>
                          <span className="block text-xs text-ink-500 truncate">
                            {c.completed.toLocaleString('en-IN')} completed
                          </span>
                        </span>
                      ),
                      value: c.jobs,
                      accent: 'info' as const,
                    }))}
                  />
                  {r.cities.length > 4 && (
                    <div className="flex items-center justify-between pt-2 text-xs text-ink-500">
                      <span>+ {r.cities.length - 4} more cities</span>
                      <span className="tabular-nums">
                        {r.cities.slice(4).reduce((a, c) => a + c.jobs, 0).toLocaleString('en-IN')}
                      </span>
                    </div>
                  )}
                </>
              )}
            </RangeBody>
          </Panel>
        </div>

        <div className="flex flex-col min-w-0">
          <SectionLabel>Cancellations</SectionLabel>
          <Panel
            className="flex-1"
            title={rangeData ? `${rangeData.cancellations.cancelled.toLocaleString('en-IN')} cancelled` : 'Cancellations'}
            action={<Pill accent="warning">{rangeLabel.toLowerCase()}</Pill>}
          >
            <RangeBody loading={rangeLoading} data={rangeData}>
              {(r) => (
                <>
                  {/*
                    The reason breakdown the design asked for is finally real.
                    It used to be impossible: /dashboard-summary carried no
                    reason dimension, and an earlier cut filled the gap with the
                    category mix of ALL work under a "N cancelled" title — which
                    read as "89 carpentry CANCELLATIONS", a number both false and
                    larger than the total it appeared to be a share of.
                    /dashboard-range joins action_taken_reason, so the reasons
                    below are the recorded ones.
                  */}
                  <MetricRow
                    label="Cancelled"
                    value={r.cancellations.cancelled.toLocaleString('en-IN')}
                    bar={r.cancellations.cancelled / Math.max(1, r.cancellations.total)}
                    barAccent="warning"
                  />
                  <MetricRow label="Share of all work" value={`${r.cancellations.sharePct}%`} />

                  <div className="mt-3 pt-3 border-t border-ink-100">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500 mb-1">
                      Top reasons
                    </div>
                    {r.cancellations.topReasons.length ? (
                      <>
                        {/* % is of CANCELLED jobs, not of all work — the card is
                            answering "of these cancellations, why". */}
                        <RankedList
                          rows={r.cancellations.topReasons.map((x) => ({
                            label: <span className="truncate">{x.reason}</span>,
                            value: `${x.count.toLocaleString('en-IN')} · ${x.pct}%`,
                            accent: 'warning' as const,
                          }))}
                        />
                        {r.cancellations.reasonCount > r.cancellations.topReasons.length && (
                          <div className="pt-2 text-xs text-ink-500">
                            + {r.cancellations.reasonCount - r.cancellations.topReasons.length} other reason
                            {r.cancellations.reasonCount - r.cancellations.topReasons.length === 1 ? '' : 's'}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-xs text-ink-500 italic">No cancellations in this window.</div>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t border-ink-100">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500 mb-1">
                      All work by category
                    </div>
                    {/* Neutral, not warning — these are NOT cancellations, and
                        the tint is what made the earlier version misread. */}
                    {r.cancellations.categories.length ? (
                      <RankedList
                        rows={r.cancellations.categories.slice(0, 3).map((c) => ({
                          label: <span className="truncate">{c.label}</span>,
                          value: `${c.count.toLocaleString('en-IN')} · ${c.pct}%`,
                          accent: 'info' as const,
                        }))}
                      />
                    ) : (
                      <EmptyState title="No work in this window" />
                    )}
                  </div>
                </>
              )}
            </RangeBody>
          </Panel>
        </div>
      </div>
    </>
  );
}

/*
 * Loading / empty frame shared by the three range-scoped cards.
 *
 * A render prop rather than three copies of the same two guards: without it
 * each card repeats "spinner while loading, EmptyState when the window is
 * empty, otherwise render", and they drift — which is how one card ends up
 * showing a confident 0 while its neighbour shows a dash for the same window.
 */
function RangeBody<T>({
  loading, data, empty, emptyTitle = 'No data for this window', children,
}: {
  loading: boolean;
  data: T | null;
  empty?: (d: T) => boolean;
  emptyTitle?: string;
  children: (d: T) => React.ReactNode;
}) {
  if (loading && !data) {
    return (
      <div className="py-6 text-center">
        <Loader2 className="w-5 h-5 mx-auto animate-spin text-ink-300" aria-hidden />
      </div>
    );
  }
  if (!data) return <EmptyState title={emptyTitle} />;
  if (empty?.(data)) return <EmptyState title={emptyTitle} />;
  return <>{children(data)}</>;
}
