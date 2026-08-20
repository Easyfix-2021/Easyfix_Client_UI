/**
 * Analytics — the SHAPE of the client's book, not the state of any one job.
 *
 * Every other tab in this console answers "what needs me now?". This one answers
 * "what does my book look like?" — how volume has moved over the last month,
 * where the jobs sit in the lifecycle, what kind of work they are, and which
 * cities carry them. Composition and arithmetic only; every piece of chrome
 * comes from src/components/ui/console.
 *
 * ONE SOURCE, TWO WINDOWS
 *
 * Everything here is one round-trip to /dashboard-summary. Reading that handler
 * (EasyFix_Backend/routes/client/index.js) turns up the fact that governs this
 * whole page: only ONE of its payloads is windowed.
 *
 *   trend              LAST 30 DAYS. created = ticket_created_date_time,
 *                      completed = checkout_date_time on status 3/5. The server
 *                      zero-fills the gap days, so it is always 30 points.
 *   statusBreakdown    LIFETIME. GROUP BY job_status over the team scope, folded
 *                      into 7 named groups, empty groups dropped.
 *   categoryBreakdown  LIFETIME, and only the TOP 6 categories (SQL LIMIT 6).
 *   cityPerformance    LIFETIME, and only the TOP 6 cities by volume (LIMIT 6).
 *
 * The handler's own comment says it: "Date scope: omitted on v1 — counts are
 * lifetime." So this page cannot honestly call itself "last 30 days", and it
 * does not — each block states its own window, in its own panel title. See the
 * SUBSTITUTED notes below.
 *
 * ALL OF IT IS TEAM-SCOPED — the signed-in SPOC plus everyone reporting to
 * them, never the whole client. The header says so, because a total that
 * silently excludes a colleague's jobs is a number nobody can reconcile.
 *
 * THE PAYLOAD'S COLOURS ARE IGNORED ON PURPOSE. statusBreakdown and
 * categoryBreakdown each ship a `color` hex — stock amber/blue/violet/emerald,
 * picked server-side long before this console had an identity. Binding them
 * would put seven un-branded hues on the page and would put colour literals in
 * the render path. Meaning is mapped to our accent vocabulary here instead.
 */
'use client';

import { useMemo } from 'react';
import { Activity, AlertTriangle, Layers, Loader2, MapPin, PieChart } from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import {
  PageHeader, SectionLabel, Panel, Pill, RankedList, DataTable, Row, Cell,
  EmptyState, ActionButton, type Accent,
} from '@/components/ui/console';

/* ─── contracts ─────────────────────────────────────────────────────────────
 * Only the fields this page reads, typed off the real handler rather than off
 * the mock. `color` is typed but never bound — see the header.
 */

type TrendPoint = { date: string; created: number; completed: number };

/** statusBreakdown and categoryBreakdown share one shape. */
type Slice = { label: string; count: number; color?: string };

type CityRow = {
  city: string;
  orders: number;
  completed: number;
  /** On-time is measured AGAINST COMPLETED, not against orders. Null when the
   *  city has closed nothing yet — the handler returns null rather than 0 so a
   *  city with no closures cannot read as 0% on time. */
  onTimePct: number | null;
  /** ticket-created → checkout, in 24h days. Null when nothing has closed. */
  avgTatDays: number | null;
};

type Summary = {
  trend: TrendPoint[];
  statusBreakdown: Slice[];
  categoryBreakdown: Slice[];
  cityPerformance: CityRow[];
  teamSize: number;
};

/* ─── meaning → accent ──────────────────────────────────────────────────────
 * The console has five accents and the handler returns seven status groups, so
 * the map is deliberately many-to-one and maps by MEANING: live work is info,
 * something waiting on a person is warning, done is success, lost is brand.
 * Two groups sharing an accent is correct here — they mean the same thing to
 * the reader — which is also why this block is a RankedList rather than a
 * stacked ProportionBar: a stacked bar with two adjacent identical colours has
 * no readable boundary.
 */
const STATUS_ACCENT: Record<string, Accent> = {
  New: 'warning',
  Scheduled: 'info',
  'In Progress': 'info',
  Completed: 'success',
  'Under Audit': 'info',
  Cancelled: 'brand',
  'On Hold': 'warning',
};

/* ─── helpers ───────────────────────────────────────────────────────────── */

/**
 * 'YYYY-MM-DD' → a LOCAL Date. Deliberately not `new Date(s)`: that parses a
 * bare date as UTC midnight, which renders as the previous day for anyone west
 * of Greenwich. These are Indian business days and must not shift.
 */
function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const shortDay = (s: string) => {
  const d = parseDay(s);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : s;
};

const n0 = (v: number) => v.toLocaleString('en-IN');

/** Round an axis maximum up to something a reader can halve in their head. */
function niceCeil(v: number): number {
  if (v <= 5) return 5;
  const pow = 10 ** Math.floor(Math.log10(v));
  const lead = v / pow;
  const step = lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10;
  return step * pow;
}

/* ─── page ──────────────────────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const { data, loading, error, reload } = useFetchOnce<Summary>('/dashboard-summary');

  const trend = useMemo(() => data?.trend ?? [], [data]);

  const trendTotals = useMemo(() => {
    let created = 0;
    let completed = 0;
    let peak: TrendPoint | null = null;
    for (const p of trend) {
      created += p.created;
      completed += p.completed;
      if (!peak || p.created > peak.created) peak = p;
    }
    return { created, completed, peak };
  }, [trend]);

  const statusTotal = useMemo(
    () => (data?.statusBreakdown ?? []).reduce((a, s) => a + s.count, 0),
    [data],
  );
  const categoryTotal = useMemo(
    () => (data?.categoryBreakdown ?? []).reduce((a, s) => a + s.count, 0),
    [data],
  );

  /* Loading / error are Home's treatment verbatim, so a reader moving between
     tabs never has to work out whether a different-looking panel means a
     different kind of failure. */
  if (loading) {
    return (
      <div className="bg-surface rounded-xl border border-ink-100 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
        <div className="mt-2 text-sm text-ink-500">Loading your analytics…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load your analytics"
          sub={error || 'The summary service did not respond.'}
          /* Home hangs this on router.refresh(); useFetchOnce exposes a reload
             that actually re-issues the request, and a "Try Again" that does
             not try again is worse than no button. */
          action={<ActionButton onClick={() => void reload()}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  const trendHasActivity = trend.some((p) => p.created > 0 || p.completed > 0);

  return (
    <>
      {/*
        SUBSTITUTED: the brief asked for the window in the title
        ("Analytics · last 30 days") with a Segmented control beside it if more
        than one window is genuinely available. Neither is honest here.

        - /dashboard-summary accepts NO date parameters at all, so there is
          exactly one window on offer and a Segmented control would be a row of
          buttons that change nothing. It is not rendered.
        - That single window is not 30 days. Only `trend` is windowed; status,
          category and city are lifetime. A page-level "last 30 days" would
          mislabel three of the four blocks, so the sub-line names both windows
          and every panel below repeats its own.
      */}
      <PageHeader
        title="Analytics"
        sub={`Volume trend · last 30 days · everything else · all time · across ${data.teamSize} SPOC${data.teamSize === 1 ? '' : 's'}`}
      />

      <SectionLabel>Volume trend</SectionLabel>
      <Panel
        className="mb-6"
        title={
          <span className="inline-flex items-center gap-2">
            <Activity className="w-4 h-4 text-info" aria-hidden />
            Created vs completed · last 30 days
          </span>
        }
        action={
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-info inline-block" aria-hidden />
              Created
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-success inline-block" aria-hidden />
              Completed
            </span>
          </div>
        }
      >
        {trendHasActivity ? (
          <>
            <VolumeTrendChart points={trend} />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
              <span>
                <span className="text-ink-900 font-semibold tabular-nums">{n0(trendTotals.created)}</span> created
              </span>
              <span>
                <span className="text-ink-900 font-semibold tabular-nums">{n0(trendTotals.completed)}</span> completed
              </span>
              {trendTotals.peak && trendTotals.peak.created > 0 ? (
                <span>
                  Busiest day {shortDay(trendTotals.peak.date)} ·{' '}
                  <span className="tabular-nums">{n0(trendTotals.peak.created)}</span> created
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <EmptyState
            icon={Activity}
            title="No job activity in the last 30 days"
            sub="Nothing was raised and nothing closed in this window."
          />
        )}
      </Panel>

      <div className="grid gap-x-6 gap-y-2 grid-cols-1 lg:grid-cols-2 mb-6">
        <div>
          <SectionLabel>Status mix</SectionLabel>
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <PieChart className="w-4 h-4 text-ink-500" aria-hidden />
                Where the book sits · all time
              </span>
            }
            action={statusTotal ? <Pill accent="info">{n0(statusTotal)} jobs</Pill> : null}
          >
            {data.statusBreakdown?.length ? (
              <RankedList
                rows={data.statusBreakdown.map((s) => ({
                  label: <ShareLabel label={s.label} share={s.count / (statusTotal || 1)} />,
                  value: `${n0(s.count)} · ${Math.round((s.count / (statusTotal || 1)) * 100)}%`,
                  accent: STATUS_ACCENT[s.label] ?? 'info',
                }))}
              />
            ) : (
              /* The handler drops empty groups, so an empty array means the
                 team genuinely has no jobs — not that a status is missing. */
              <EmptyState title="No jobs on this team yet" sub="Raise a ticket and the mix appears here." />
            )}
          </Panel>
        </div>

        <div>
          <SectionLabel>By category</SectionLabel>
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <Layers className="w-4 h-4 text-ink-500" aria-hidden />
                Largest service categories · all time
              </span>
            }
            action={categoryTotal ? <Pill accent="info">{n0(categoryTotal)} jobs</Pill> : null}
          >
            {data.categoryBreakdown?.length ? (
              <>
                <RankedList
                  rows={data.categoryBreakdown.map((c) => ({
                    label: <ShareLabel label={c.label} share={c.count / (categoryTotal || 1)} />,
                    value: `${n0(c.count)} · ${Math.round((c.count / (categoryTotal || 1)) * 100)}%`,
                    accent: 'info' as const,
                  }))}
                />
                {/* SUBSTITUTED: the endpoint's category query carries LIMIT 6 and
                    returns no grand total, so a share of ALL work cannot be
                    computed here. These percentages are shares of the six shown
                    and the footnote says so — the alternative was a percentage
                    that silently means something other than its label. */}
                <div className="pt-2 text-xs text-ink-500">
                  Share of the {data.categoryBreakdown.length} largest categories · the summary returns no others
                </div>
              </>
            ) : (
              <EmptyState title="No categories to rank" sub="No jobs have been raised against a service category." />
            )}
          </Panel>
        </div>
      </div>

      <SectionLabel>By city</SectionLabel>
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            <MapPin className="w-4 h-4 text-ink-500" aria-hidden />
            Largest cities by volume · all time
          </span>
        }
        bodyClassName="p-0"
      >
        {data.cityPerformance?.length ? (
          <>
            <DataTable
              className="border-0 rounded-none"
              columns={[
                { key: 'city', label: 'City' },
                { key: 'orders', label: 'Orders', align: 'right' },
                { key: 'completed', label: 'Completed', align: 'right' },
                /* Named for what the handler actually divides by. On-time is
                   on_time / completed, NOT / orders — a column headed plain
                   "On time" would read as a share of the whole city book. */
                { key: 'onTime', label: 'On time · of completed', align: 'right' },
                { key: 'tat', label: 'Avg days to close', align: 'right' },
              ]}
            >
              {data.cityPerformance.map((c) => (
                <Row key={c.city} edge={onTimeAccent(c.onTimePct)}>
                  <Cell>
                    <div className="text-ink-900">{c.city}</div>
                    <div className="text-xs text-ink-500">
                      {c.orders ? `${Math.round((c.completed / c.orders) * 100)}% of orders closed` : 'No orders'}
                    </div>
                  </Cell>
                  <Cell align="right" className="tabular-nums text-ink-900">{n0(c.orders)}</Cell>
                  <Cell align="right" className="tabular-nums text-ink-900">{n0(c.completed)}</Cell>
                  <Cell align="right" className="tabular-nums text-ink-900">
                    {c.onTimePct == null ? <span className="text-ink-300">—</span> : `${c.onTimePct}%`}
                  </Cell>
                  <Cell align="right" className="tabular-nums text-ink-900">
                    {c.avgTatDays == null ? <span className="text-ink-300">—</span> : c.avgTatDays.toFixed(1)}
                  </Cell>
                </Row>
              ))}
            </DataTable>
            <div className="px-3 py-2.5 text-xs text-ink-500 border-t border-ink-100">
              Top {data.cityPerformance.length} cities by order volume. A dash means the city has closed nothing
              yet, so there is no on-time or turnaround figure to show. The left edge marks on-time:{' '}
              <span className="text-success">90%+</span> · <span className="text-warning">75–89%</span> ·{' '}
              <span className="text-primary">below 75%</span>.
            </div>
          </>
        ) : (
          <div className="px-3">
            <EmptyState
              icon={MapPin}
              title="No city data yet"
              sub="Jobs need a mapped address before they can be counted against a city."
            />
          </div>
        )}
      </Panel>
    </>
  );
}

/* ─── pieces ────────────────────────────────────────────────────────────── */

/**
 * A ranked-list label with a proportion sliver beside it.
 *
 * The sliver is INK, not the row's accent, on purpose: the figure on the right
 * already carries the meaning colour, and painting the same meaning twice makes
 * the list read as a chart legend rather than a ranking. The sliver's only job
 * is relative size.
 */
function ShareLabel({ label, share }: { label: string; share: number }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0 w-full">
      <span className="truncate">{label}</span>
      <span className="hidden sm:inline-block w-14 h-1 rounded-full bg-ink-100 overflow-hidden shrink-0">
        <span
          className="block h-full bg-ink-300"
          style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
        />
      </span>
    </span>
  );
}

/**
 * Severity for the city table's left edge.
 *
 * These cut points are a DISPLAY convention, not a figure from the API — the
 * summary endpoint carries no SLA target. 90 is the target the Performance
 * screen states in the brief, and 75 is the midpoint below it. A city that has
 * closed nothing gets no edge rather than a green one.
 */
function onTimeAccent(pct: number | null): Accent | undefined {
  if (pct == null) return undefined;
  if (pct >= 90) return 'success';
  if (pct >= 75) return 'warning';
  return 'brand';
}

/**
 * The 30-day volume chart — hand-rolled SVG, no chart library.
 *
 * Two filled lines rather than paired bars: 30 days × 2 series as bars is 60
 * shapes under 12px wide, which reads as texture. Lines keep the two series
 * comparable at a glance and leave room for a real date axis.
 *
 * Every colour is an --ef-* token and every <text> is at the 12px brand floor;
 * scripts/check-brand-tokens.js enforces both, including inside SVG.
 */
function VolumeTrendChart({ points }: { points: TrendPoint[] }) {
  const W = 720;
  const H = 210;
  const padL = 34;   // room for a 3-digit y label at 12px
  const padR = 10;
  const padT = 12;
  const padB = 28;   // room for the date axis baseline at 12px
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const n = points.length;
  const max = niceCeil(Math.max(1, ...points.flatMap((p) => [p.created, p.completed])));

  const x = (i: number) => (n > 1 ? padL + (innerW * i) / (n - 1) : padL + innerW / 2);
  const y = (v: number) => padT + innerH * (1 - v / max);
  const base = y(0);

  const line = (key: 'created' | 'completed') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const area = (key: 'created' | 'completed') =>
    `${line(key)} L${x(n - 1).toFixed(1)},${base.toFixed(1)} L${x(0).toFixed(1)},${base.toFixed(1)} Z`;

  /* Five date ticks across a month — one a week plus today. More than five
     collide at 12px, which is the floor and not negotiable. */
  const ticks = [0, 7, 14, 21, n - 1].filter((i, k, a) => i >= 0 && i < n && a.indexOf(i) === k);
  const band = n > 1 ? innerW / (n - 1) : innerW;
  const last = points[n - 1];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto min-w-[520px]"
        role="img"
        aria-label={`Jobs created and completed per day over the last ${n} days`}
      >
        {/* Gridlines and the y scale. Three lines only — a 30-point chart is
            read for its slope, and more rules than that compete with it. */}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)}
              stroke="var(--ef-ink-100)" strokeWidth={1}
            />
            <text
              x={padL - 6} y={y(max * f) + 4} textAnchor="end"
              fontSize={12} fill="var(--ef-ink-500)"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}

        <path d={area('created')} fill="var(--ef-blue-500)" fillOpacity={0.1} />
        <path d={area('completed')} fill="var(--ef-success)" fillOpacity={0.12} />
        <path
          d={line('created')} fill="none" stroke="var(--ef-blue-500)"
          strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />
        <path
          d={line('completed')} fill="none" stroke="var(--ef-success)"
          strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />

        {/* Today gets a marker on both series — the point a reader looks for
            first, and the only one worth singling out on a 30-point line. */}
        {last ? (
          <>
            <circle cx={x(n - 1)} cy={y(last.created)} r={3} fill="var(--ef-blue-500)" />
            <circle cx={x(n - 1)} cy={y(last.completed)} r={3} fill="var(--ef-success)" />
          </>
        ) : null}

        {/* Date axis. 12 is the brand floor; padB is 28 and the baseline sits 9
            above H, so descenders land at ~H−5, inside the viewBox. */}
        {ticks.map((i) => (
          <text
            key={i} x={x(i)} y={H - 9} textAnchor="middle"
            fontSize={12} fill="var(--ef-ink-500)"
          >
            {shortDay(points[i].date)}
          </text>
        ))}

        {/* Per-day hit bands carrying a native <title>. A tooltip a screen
            reader and a mouse both get, with no JS and no library. */}
        {points.map((p, i) => (
          <rect
            key={p.date}
            x={Math.max(padL, x(i) - band / 2)}
            y={padT}
            width={band}
            height={innerH}
            fill="transparent"
          >
            <title>{`${shortDay(p.date)} · ${p.created} created · ${p.completed} completed`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
