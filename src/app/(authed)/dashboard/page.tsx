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
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FolderOpen, CheckCircle2, CalendarDays, CalendarRange,
  AlertTriangle, MapPin, User, Loader2, type LucideIcon,
} from 'lucide-react';
import { useFetchOnce, useRecentJobs } from '@/lib/hooks';
import { useAccess } from '@/lib/spoc-context';
import { cn } from '@/lib/utils';
import { openJobDrawer } from '@/components/job-drawer';
import {
  PageHeader, SectionLabel, StatRow, StatCard, Panel, ListRow, Pill,
  RankedList, ProportionBar, MetricRow, ActionButton, EmptyState, Bar,
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

const DEFAULT_RANGE: RangeKey = 'd60';

/* The URL is user input. An unrecognised key would leave the chip showing one
   window while the cards showed another — a control that lies about what you
   are looking at — so it resolves to the default instead. */
const resolveRange = (raw: string | null): RangeKey =>
  RANGE_PRESETS.find((r) => r.key === raw)?.key ?? DEFAULT_RANGE;

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
    cancelled: number; total: number;
    topReasons: Array<{ reason: string; count: number; pct: number }>;
    reasonCount: number;
    otherReasons: { count: number; reasons: number };
  };
  previous: { total: number; completed: number; cancelled: number };
};

const COMPLETED = new Set([3, 5]);
const CANCELLED = new Set([6, 7]);
const OPEN = new Set([0, 1, 2, 20]);

export default function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useAccess();
  const { data, loading, error, reload } = useFetchOnce<Summary>('/dashboard-summary');
  const { data: queue } = useFetchOnce<{ items: QueueItem[]; total: number }>('/action-queue');
  const { jobs } = useRecentJobs<DashJob>();

  const now = useMemo(() => new Date(), []);

  /*
   * ─── SCOPE AND RANGE ──────────────────────────────────────────────────────
   *
   * These drive the THREE CARDS BELOW ONLY. Today's Pulse, the action queue and
   * the open breakdown are live figures — "how many orders are open" has no
   * date range — so the controls sit with the cards they govern rather than
   * looking like they filter the whole page.
   *
   * All three live in the QUERY STRING, not useState, so a narrowed dashboard
   * is a LINK: it survives a refresh, it is what you paste into chat when you
   * want someone looking at the same numbers you are, and Back is not the only
   * way to widen it again. Same treatment as the Client Profile's ?tab=, down
   * to `router.replace` over push — Back should leave the page, not walk back
   * through every chip you touched on the way here.
   *
   * A default is ABSENT from the URL rather than spelled out, so a plain
   * /dashboard link keeps meaning "the default view".
   */
  const rangeKey = resolveRange(searchParams.get('range'));
  const city = searchParams.get('city') ?? '';
  const spocParam = searchParams.get('spoc') ?? '';
  const range = useMemo(() => rangeFor(rangeKey, now), [rangeKey, now]);
  const rangeLabel = RANGE_PRESETS.find((r) => r.key === rangeKey)?.label ?? '';
  /* Hiding a card the SPOC cannot fill is a COURTESY, not a control — the
     /performance route is guarded on the server independently. */
  const canSeePerformance = !!access?.grants?.includes('performance');

  /*
   * The two scope lookups. Both are client-scoped already: /cities is DISTINCT
   * over this client's own jobs (not the ~11k city master), and /team is the
   * caller's contacts. The SPOC picker only appears for a manager — a SPOC with
   * nobody reporting to them has one option, which is not a filter.
   */
  const { data: cityList } = useFetchOnce<{ items: string[] }>('/cities');
  const { data: team } = useFetchOnce<{ items: Array<{ id: number; name: string | null; status: number }>; isManager: boolean }>('/team');
  const spocOptions = useMemo(
    () => (team?.items ?? []).filter((m) => m.status === 1),
    [team],
  );

  /*
   * Both scope params are checked against those lists, and they are handled
   * DIFFERENTLY on purpose — the rule is that the chip and the cards must never
   * disagree about what you are looking at.
   *
   *   ?city=   KEPT even when unknown, and given its own option. The cards
   *            really are filtered to it, so dropping it would leave the chip
   *            reading "All cities" over one city's numbers. An unknown city
   *            matches nothing and the cards say so, which is the truth.
   *   ?spoc=   DROPPED when it is not in your subtree, because the server
   *            IGNORES such an id (the containment check on /dashboard-range)
   *            and answers for the whole team. Keeping it would name one person
   *            over everybody's numbers.
   *
   * The spoc check waits for /team to ARRIVE: before that "not yours" and "not
   * loaded yet" are indistinguishable, and guessing costs a wasted fetch and a
   * flash of the wrong scope.
   */
  const cityOptions = useMemo(() => {
    const known = cityList?.items ?? [];
    const items = city && !known.includes(city) ? [city, ...known] : known;
    return [{ value: '', label: 'All cities' }, ...items.map((c) => ({ value: c, label: c }))];
  }, [cityList, city]);
  const spoc = !team || spocOptions.some((m) => String(m.id) === spocParam) ? spocParam : '';

  function pushScope(patch: { range?: RangeKey; city?: string; spoc?: string }) {
    const next = { range: rangeKey, city, spoc, ...patch };
    const qs = new URLSearchParams(searchParams.toString());
    const put = (k: string, v: string, omit: string) => (v === omit ? qs.delete(k) : qs.set(k, v));
    put('range', next.range, DEFAULT_RANGE);
    put('city', next.city, '');
    put('spoc', next.spoc, '');
    const q = qs.toString();
    router.replace(q ? `/dashboard?${q}` : '/dashboard', { scroll: false });
  }

  // The path carries from/to and the scope, so changing any chip refetches —
  // useFetchOnce re-issues on a PATH change (its lastPathRef guard), which is
  // exactly what makes this work without a manual reload.
  const scopeQs = `${city ? `&city=${encodeURIComponent(city)}` : ''}${spoc ? `&spoc=${spoc}` : ''}`;
  const { data: rangeData, loading: rangeLoading } =
    useFetchOnce<RangeData>(`/dashboard-range?from=${range.from}&to=${range.to}${scopeQs}`);

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
            {/*
              * Scope for the three cards BELOW Today's Pulse — the same three
              * the date range governs. The pulse is a live figure and is
              * deliberately not scoped; see the range note above.
              *
              * "All zones" is GONE rather than left as a decorative chip. Zones
              * are tbl_zone_master / tbl_zone_city_mapping — an EasyFix
              * technician-routing construct that the client API has never
              * exposed and that means nothing from a client's side of the
              * wire. There is no honest list to put in it, and by the same rule
              * we just applied to Performance health: if it cannot be filled,
              * it should not be on the page.
              */}
            <ChipSelect
              icon={MapPin}
              label="City"
              value={city}
              onChange={(v) => pushScope({ city: v })}
              options={cityOptions}
            />
            {team?.isManager && spocOptions.length > 1 && (
              <ChipSelect
                icon={User}
                label="SPOC"
                value={spoc}
                onChange={(v) => pushScope({ spoc: v })}
                options={[{ value: '', label: 'All SPOCs' },
                          ...spocOptions.map((m) => ({ value: String(m.id), label: m.name || `Contact #${m.id}` }))]}
              />
            )}
            <ChipSelect
              icon={CalendarDays}
              label="Date range"
              value={rangeKey}
              onChange={(v) => pushScope({ range: v as RangeKey })}
              options={RANGE_PRESETS.map((r) => ({ value: r.key, label: r.label }))}
            />
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

      <div className={cn(
        'grid gap-x-6 gap-y-2 grid-cols-1 items-stretch',
        // Two columns, not three-with-a-hole, when Performance health is
        // withheld — a gap where a card used to be reads as a failed load.
        canSeePerformance ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
      )}>
        {/*
          * WITHHELD ENTIRELY, not rendered empty. This card used to show an
          * "Performance is not enabled for you" placeholder to a SPOC without
          * the grant — a card that occupies a column, draws a border and says
          * nothing. Either it carries data or it should not be on the page.
          */}
        {canSeePerformance && (
        <div className="flex flex-col min-w-0">
          <SectionLabel>Performance health</SectionLabel>
          <Panel
            className="flex-1"
            title={rangeLabel}
            /*
              COMPLETION RATE, not volume — this card is about how the work
              went, and its neighbour already reports how much of it there was.
              Two adjacent cards showing the identical volume delta would read
              as a duplicated widget rather than two findings.

              `pp` because a move from 61% to 64% is three percentage POINTS,
              not three percent. /performance uses the same unit for the same
              reason, so the two pages agree on what a delta means.
            */
            action={rangeData ? (
              <DeltaPill
                now={pct(rangeData.performance.completed, rangeData.performance.total)}
                prev={pct(rangeData.previous.completed, rangeData.previous.total)}
                good="up"
                unit="pp"
              />
            ) : undefined}
          >
            {(
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
            )}
          </Panel>
        </div>
        )}

        <div className="flex flex-col min-w-0">
          <SectionLabel>Work done — by city</SectionLabel>
          <Panel
            className="flex-1"
            title={rangeData
              ? `${rangeData.performance.total.toLocaleString('en-IN')} job${rangeData.performance.total === 1 ? '' : 's'} across ${rangeData.cities.length} cit${rangeData.cities.length === 1 ? 'y' : 'ies'}`
              : rangeLabel}
            /* good="neither": more orders is not good or bad news, it is how
               much work there was. The pill reports the move and declines to
               grade it. */
            action={rangeData ? (
              <DeltaPill
                now={rangeData.performance.total}
                prev={rangeData.previous.total}
                good="neither"
              />
            ) : undefined}
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
                      /*
                       * The SHARE ships with the bar, deliberately. A bar whose
                       * denominator is not written down is a picture the reader
                       * cannot name — and this card had no percentage anywhere,
                       * so the bar alone could have meant "of all work", "of the
                       * biggest city", or "of the four shown". It means the
                       * first, and now says so, in the same "count · pct" shape
                       * the Cancellations card beside it uses.
                       */
                      value: `${c.jobs.toLocaleString('en-IN')} · ${pct(c.jobs, r.performance.total)}%`,
                      accent: 'info' as const,
                      /*
                       * Against the WINDOW'S TOTAL, not against the largest city.
                       * Scaling to the leader would paint the top row full-width
                       * whether it held 90% of the work or 12%, which is the one
                       * reading this card must not invite. Against the total, the
                       * four bars and the "+ N more cities" remainder below them
                       * describe one whole.
                       */
                      bar: c.jobs / Math.max(1, r.performance.total),
                      /*
                       * The SPOC scope travels with the city. /jobs reads both
                       * off the URL during render, so arriving pre-scoped costs
                       * it nothing — and landing on the whole team's book after
                       * narrowing to one person's would silently widen what you
                       * are looking at, which is the failure this card's own
                       * scope chips exist to prevent.
                       */
                      onClick: () => router.push(
                        `/jobs?city=${encodeURIComponent(c.name)}${spoc ? `&spoc=${spoc}` : ''}`,
                      ),
                    }))}
                  />
                  {(() => {
                    const rest = r.cities.slice(4).reduce((a, c) => a + c.jobs, 0);
                    const mapped = r.cities.reduce((a, c) => a + c.jobs, 0);
                    /*
                     * ⚠ THE BARS DO NOT SUM TO 100%, and that is not a rounding
                     * artefact. The cities query excludes jobs whose address has
                     * no city (`ci.city_name IS NOT NULL AND <> ''`), while the
                     * denominator here is the window's TOTAL — because that is
                     * what the "N · X%" beside every row claims to be a share OF,
                     * and it is the same total the Performance card reports.
                     *
                     * Denominating against the cities' own sum instead would make
                     * the bars fill the track, at the cost of every percentage
                     * quietly meaning "of the work we could place on a map". So
                     * the shortfall is NAMED below rather than hidden by a
                     * flattering denominator — adding bars is what made this gap
                     * visible, so the bars should be what explains it.
                     */
                    const unplaced = Math.max(0, r.performance.total - mapped);
                    if (rest === 0 && unplaced === 0) return null;
                    return (
                      <div className="pt-2 space-y-2">
                        {rest > 0 && (
                          <div>
                            <div className="flex items-center justify-between text-xs text-ink-500">
                              <span>+ {r.cities.length - 4} more cities</span>
                              <span className="tabular-nums">
                                {rest.toLocaleString('en-IN')} · {pct(rest, r.performance.total)}%
                              </span>
                            </div>
                            {/* Same scale and accent as the four rows above: this
                                IS those cities, just not named individually, so
                                the set reads as top-four AGAINST everything else
                                rather than only against each other. The text
                                stays grey because it is a rollup you cannot
                                click; the bar matches because it measures the
                                same quantity. */}
                            <Bar value={rest / Math.max(1, r.performance.total)} accent="info" />
                          </div>
                        )}
                        {unplaced > 0 && (
                          <div className="flex items-center justify-between text-xs text-ink-500">
                            <span>No city recorded</span>
                            <span className="tabular-nums">
                              {unplaced.toLocaleString('en-IN')} · {pct(unplaced, r.performance.total)}%
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/*
                    The drill-down lands on Open orders, which is a DIFFERENT
                    cohort to the count beside it: this card counts every order
                    RAISED in the window whatever became of it, and that page
                    holds only what is still open. Saying so is a line of copy;
                    letting someone click 40 and land on 3 is a bug report.
                  */}
                  <p className="pt-2 text-xs text-ink-500">
                    Select a city to see what is still open there.
                  </p>
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
            action={
              <span className="inline-flex items-center gap-1.5">
                {rangeData && (
                  <DeltaPill
                    now={rangeData.cancellations.cancelled}
                    prev={rangeData.previous.cancelled}
                    good="down"
                  />
                )}
                <Pill accent="warning">{rangeLabel.toLowerCase()}</Pill>
              </span>
            }
          >
            <RangeBody loading={rangeLoading} data={rangeData}>
              {(r) => (
                <>
                  {/*
                    This card answers TWO questions and no more: how many
                    were cancelled, and why. /dashboard-range joins
                    action_taken_reason, so the reasons are the recorded ones.

                    A category mix of ALL work used to sit below the reasons,
                    and a "Share of all work" row above them. Both are gone as
                    of 2026-08-26 — the design comp carries neither, and the
                    category block in particular kept inviting the misreading it
                    was built to fix ("89 carpentry CANCELLATIONS"), because a
                    breakdown of every job in the window cannot help but read as
                    a breakdown of the number in the title.
                  */}
                  <MetricRow
                    label="Cancelled"
                    value={r.cancellations.cancelled.toLocaleString('en-IN')}
                    bar={r.cancellations.cancelled / Math.max(1, r.cancellations.total)}
                    barAccent="warning"
                  />
                  <div className="mt-3 pt-3 border-t border-ink-100">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500 mb-1">
                      Top reasons
                    </div>
                    {r.cancellations.topReasons.length ? (
                      <>
                        {/* % is of CANCELLED jobs, not of all work — the card is
                            answering "of these cancellations, why". */}
                        {/*
                          "Other" is a ROW, not the muted "+ N other reasons"
                          footnote it replaces. The three named reasons sum to
                          less than the total above them, and a footnote in
                          smaller, greyer type does not read as the thing that
                          closes that gap — so the percentages looked like they
                          did not add up. As a row it carries its own count and
                          share, and the four values reconcile on the page.
                          Its count is EXACT: the reasons cohort is the same
                          job_status = 6 the title counts, and an unrecorded
                          reason is labelled rather than dropped.
                        */}
                        <RankedList
                          rows={[
                            ...r.cancellations.topReasons.map((x) => ({
                              label: <span className="truncate">{x.reason}</span>,
                              value: `${x.count.toLocaleString('en-IN')} · ${x.pct}%`,
                              accent: 'warning' as const,
                              // Share of CANCELLATIONS, the same denominator the
                              // pct beside it uses — a bar drawn against the
                              // window's total work would contradict its own
                              // label on every row.
                              bar: x.count / Math.max(1, r.cancellations.cancelled),
                            })),
                            ...(r.cancellations.otherReasons.count > 0 ? [{
                              label: (
                                <span className="block">
                                  <span className="block text-ink-900">Other</span>
                                  <span className="block text-xs text-ink-500">
                                    {r.cancellations.otherReasons.reasons} reason
                                    {r.cancellations.otherReasons.reasons === 1 ? '' : 's'}
                                  </span>
                                </span>
                              ),
                              value: `${r.cancellations.otherReasons.count.toLocaleString('en-IN')} · `
                                + `${pct(r.cancellations.otherReasons.count, r.cancellations.cancelled)}%`,
                              // WARNING, same as the named rows. All four are
                              // cancellation counts that sum to the title, and
                              // a different tint would say "this is a different
                              // kind of number" — precisely the misreading the
                              // category block used to cause. The muted second
                              // line is what marks it as a bucket.
                              accent: 'warning' as const,
                              bar: r.cancellations.otherReasons.count / Math.max(1, r.cancellations.cancelled),
                            }] : []),
                          ]}
                        />
                      </>
                    ) : (
                      <div className="text-xs text-ink-500 italic">No cancellations in this window.</div>
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
 * The movement pill the three range-scoped cards share.
 *
 * ⚠ `good` IS PER CARD, AND THE THREE DISAGREE. A rise means something
 * different on each one, and getting this wrong inverts a card's meaning
 * without changing a number:
 *
 *   'up'      completion rate — more finished work is better.
 *   'down'    cancellations   — more cancelled work is worse.
 *   'neither' volume raised   — more orders is not good or bad news for the
 *             client, it is just how much work there was. Colouring it green
 *             or amber would be the dashboard inventing an opinion about
 *             someone else's business, so it stays neutral.
 *
 * "vs previous period", not "vs last month". The comparison is always the same
 * LENGTH immediately before the selected range, so with a range picker only the
 * generic phrasing stays true: for "This month" (month-to-date) it is the
 * equally many days before the 1st — a fair like-for-like, but not last month.
 *
 * Silent when BOTH windows are empty: a first-ever window would otherwise read
 * as a dramatic change from nothing.
 */
function DeltaPill({
  now, prev, good, unit = '',
}: {
  now: number;
  prev: number;
  good: 'up' | 'down' | 'neither';
  /** 'pp' for a rate — a 3-point move in a percentage is not 3 percent. */
  unit?: string;
}) {
  if (now === 0 && prev === 0) return null;
  const delta = Math.round((now - prev) * 10) / 10;
  if (delta === 0) return <Pill accent="info">level vs previous period</Pill>;
  const rising = delta > 0;
  const accent = good === 'neither' ? 'info' : (rising === (good === 'up') ? 'success' : 'warning');
  return (
    <Pill accent={accent}>
      {rising ? '↑' : '↓'} {Math.abs(delta).toLocaleString('en-IN')}{unit} vs previous period
    </Pill>
  );
}

/*
 * One percentage, to one decimal — the same rounding the SERVER uses for the
 * reason shares it sends. Three copies of this had accumulated (completion
 * rate, city share, the Other bucket) and identical arithmetic under three
 * names is how one of them ends up rounding to a different place and two
 * figures on the same card stop adding up.
 *
 * A zero denominator is 0%, never NaN: an empty window still renders.
 */
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((1000 * part) / whole) / 10 : 0;

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

/*
 * A <select> dressed as a FilterChip.
 *
 * Native, not a popover: one control, the current value always on screen, no
 * outside-click or keyboard handling to get wrong, and it is the platform's own
 * picker on mobile. Chip STYLING is duplicated from FilterChip rather than
 * shared because FilterChip renders a <button> — wrapping a select in a button
 * is invalid HTML, and widening that component to sometimes-not-be-a-button
 * would be a worse trade than these two class strings.
 *
 * `active` (brand-tinted) whenever the value is not the default, so a narrowed
 * scope is visible at a glance rather than something you discover by reading
 * the dropdown.
 */
function ChipSelect({
  icon: Icon, label, value, onChange, options,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const active = value !== '' && value !== DEFAULT_RANGE;
  return (
    <label
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border pl-3 pr-2 py-1.5 text-xs font-medium transition focus-within:border-primary',
        active ? 'border-primary bg-primary-50 text-primary' : 'border-ink-100 bg-surface text-ink-700',
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent pr-1 text-xs font-medium focus:outline-none cursor-pointer max-w-[10rem] truncate"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
