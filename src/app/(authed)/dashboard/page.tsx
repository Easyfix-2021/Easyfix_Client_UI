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

import { useMemo } from 'react';
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
  city_name?: string | null;
  service_catg_name?: string | null;
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
    const cityToday = new Map<string, { n: number; cats: Set<string> }>();

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
      if (k === todayKey) {
        plannedToday += 1;
        const city = j.city_name || 'Unknown';
        const e = cityToday.get(city) || { n: 0, cats: new Set<string>() };
        e.n += 1;
        if (j.service_catg_name) e.cats.add(j.service_catg_name);
        cityToday.set(city, e);
      }
      if (appt >= from && appt < to) {
        weekPlanned += 1;
        if (COMPLETED.has(status)) weekDone += 1;
      }
    }

    const cities = [...cityToday.entries()]
      .map(([city, v]) => ({ city, n: v.n, cats: [...v.cats] }))
      .sort((a, b) => b.n - a.n);

    return { dueToday, ahead, plannedToday, weekPlanned, weekDone, closedYesterday, closedDayBefore, cities };
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
  /* Every job the summary counts, so a share is a share of something real. */
  const totalWork = counts.newTickets + counts.inProgress + counts.completed + counts.cancelled;

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
            {/* The mock's four scope chips. They are readouts of the CURRENT
                scope until the corresponding filters ship — a chip that looks
                interactive but changes nothing is worse than one that says
                what it is, so each carries its real state as its label. */}
            <FilterChip icon={MapPin}>All cities</FilterChip>
            <FilterChip icon={Building2}>All zones</FilterChip>
            <FilterChip icon={User}>All SPOCs</FilterChip>
            <FilterChip icon={CalendarDays}>Last 60 days</FilterChip>
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
          <Panel className="flex-1" title="This month">
            {access?.grants?.includes('performance') ? (
              <>
                {/* SUBSTITUTED: SLA / first-time-fix / revisit live behind
                    /performance, which is separately grant-gated and windowed.
                    Rather than duplicate that engine here with different maths —
                    the surest way to have two numbers disagree — this shows the
                    book this endpoint DOES carry and links to the real page. */}
                <MetricRow label="Completed" value={counts.completed.toLocaleString('en-IN')} bar={counts.completed / Math.max(1, totalOpen + counts.completed)} barAccent="success" />
                <MetricRow label="In progress" value={counts.inProgress.toLocaleString('en-IN')} bar={counts.inProgress / Math.max(1, totalOpen)} barAccent="info" />
                <MetricRow label="Running late" value={boxes.runningLate.toLocaleString('en-IN')} bar={boxes.runningLate / Math.max(1, totalOpen)} barAccent="warning" />
                <MetricRow label="Escalated" value={counts.escalated.toLocaleString('en-IN')} bar={counts.escalated / Math.max(1, totalOpen)} barAccent="brand" />
                <div className="pt-2">
                  <button type="button" onClick={() => router.push('/performance')} className="text-xs text-info hover:text-info-text font-medium">
                    Full Performance Book →
                  </button>
                </div>
              </>
            ) : (
              <EmptyState
                title="Performance is not enabled for you"
                sub="An administrator can grant it against your SPOC record."
              />
            )}
          </Panel>
        </div>

        <div className="flex flex-col min-w-0">
          <SectionLabel>Planned today — by city</SectionLabel>
          <Panel className="flex-1" title={`${derived.plannedToday} job${derived.plannedToday === 1 ? '' : 's'} across ${derived.cities.length} cit${derived.cities.length === 1 ? 'y' : 'ies'}`}>
            {derived.cities.length ? (
              <>
                <RankedList
                  rows={derived.cities.slice(0, 4).map((c) => ({
                    label: (
                      <span className="block">
                        <span className="block text-ink-900">{c.city}</span>
                        <span className="block text-xs text-ink-500 truncate">
                          {c.cats.length ? c.cats.slice(0, 2).join(', ') : 'All categories'}
                        </span>
                      </span>
                    ),
                    value: c.n,
                    accent: 'info',
                  }))}
                />
                {derived.cities.length > 4 && (
                  <div className="flex items-center justify-between pt-2 text-xs text-ink-500">
                    <span>+ {derived.cities.length - 4} more cities</span>
                    <span className="tabular-nums">{derived.cities.slice(4).reduce((a, c) => a + c.n, 0)}</span>
                  </div>
                )}
              </>
            ) : (
              <EmptyState title="Nothing scheduled for today" />
            )}
          </Panel>
        </div>

        <div className="flex flex-col min-w-0">
          <SectionLabel>Cancellations</SectionLabel>
          <Panel
            className="flex-1"
            title={`${counts.cancelled.toLocaleString('en-IN')} cancelled`}
            action={<Pill accent="warning">last 60 days</Pill>}
          >
            {/*
              SUBSTITUTED — and the substitution has to be VISIBLE, not silent.
              The mock breaks cancellations down BY REASON. /dashboard-summary
              carries no reason dimension at all, only a category mix of ALL
              work. An earlier cut rendered that mix under this card's
              "N cancelled" title in a warning tint, which read as "89 carpentry
              CANCELLATIONS" — a number that was both false and larger than the
              total it appeared to be a share of.
              So the cancellation figure and the category mix are now separated
              and each says what it is. Wiring the real reasons needs
              action_taken_reason on the summary query.
            */}
            <MetricRow
              label="Cancelled"
              value={counts.cancelled.toLocaleString('en-IN')}
              bar={counts.cancelled / Math.max(1, totalWork)}
              barAccent="warning"
            />
            <MetricRow
              label="Share of all work"
              value={`${Math.round((counts.cancelled / Math.max(1, totalWork)) * 100)}%`}
            />

            <div className="mt-3 pt-3 border-t border-ink-100">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500 mb-1">
                All work by category
              </div>
              {/* Neutral, not warning — these are not cancellations. */}
              {data.categoryBreakdown?.length ? (
                <RankedList
                  rows={data.categoryBreakdown.slice(0, 3).map((c) => {
                    const total = data.categoryBreakdown!.reduce((a, x) => a + x.count, 0) || 1;
                    return {
                      label: <span className="truncate">{c.label}</span>,
                      value: `${c.count} · ${Math.round((c.count / total) * 100)}%`,
                      accent: 'info' as const,
                    };
                  })}
                />
              ) : (
                <EmptyState title="No work in this window" />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
