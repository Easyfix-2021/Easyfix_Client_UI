'use client';

/**
 * Performance — the client's own book, drawn to the console grammar.
 *
 * Header, four KPIs against their targets, the approval banner, two trend
 * panels, the by-dimension table, and a closing line about the weakest group.
 * Every piece of chrome comes from src/components/ui/console; the two charts
 * are hand-rolled SVG (no chart library) and take every colour from an --ef-*
 * token.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * One endpoint, GET /performance, composed server-side from two engines:
 *
 *   tat.*         services/tat.service.js — the ONE place TAT is computed. It
 *                 scores four segments per completed job and splits ownership:
 *                 Visit, Estimate and Completion are EasyFix's clocks, Approval
 *                 (estimate sent → client decided) is the CLIENT's. The two
 *                 scores are reported side by side and never averaged, so a
 *                 client's own slow approvals cannot read as an EasyFix miss.
 *   closure /
 *   firstTimeFix /
 *   volume        services/client-performance.service.js — everything the TAT
 *                 engine cannot answer, because it only loads COMPLETED jobs.
 *
 * A SECOND CALL, DELIBERATELY. The mock puts a delta on every KPI ("3% vs
 * July"). One window cannot produce one, and a guessed delta is worse than
 * none — so the previous comparable window is fetched too and the four deltas
 * are the real difference between the two. All four are RATES or averages, so
 * comparing a month-to-date against a full prior month is a fair comparison;
 * no volume figure carries a delta for exactly that reason. The comparison
 * call is pinned to dim=city and months=1 so changing the breakdown dimension
 * does not re-run the heavy engine twice.
 *
 * WHERE THE MOCK ASKED FOR SOMETHING THE API CANNOT SOURCE, the element is
 * labelled for what it actually measures and marked SUBSTITUTED below. There
 * are four: the SLA/FTF trend line, and three columns of the breakdown table.
 *
 * GATED TWICE: the shell hides the tab without the grant and this page renders
 * a locked state if someone reaches the URL anyway. Neither is the control —
 * the server 403s via requireGrant('performance').
 */
import { useMemo, useState } from 'react';
import {
  Gauge, Wrench, RotateCcw, Timer, Lock, AlertTriangle, Loader2, Info,
} from 'lucide-react';
import { useFetch, useFetchOnce } from '@/lib/hooks';
import { useHasGrant } from '@/lib/spoc-context';
import {
  PageHeader, SectionLabel, StatRow, KpiCard, Banner, Panel, Segmented,
  DataTable, Row, Cell, StatusPill, Pill, EmptyState, ActionButton,
  type Accent, type Status,
} from '@/components/ui/console';

/* ─── contracts ─────────────────────────────────────────────────────────────
 * Read off routes/client/index.js (the /performance handler) and the two
 * services it composes, not off the mock.
 */

/** client-target.service.js judgeAgainst(): met / within 10% / worse. */
type Judgement = 'ok' | 'watch' | 'risk';

type Segment = {
  no: number;
  key: string;
  label: string;
  owner: 'EasyFix' | 'Client';
  yes: number;
  noCount: number;
  na: number;
  pending: number;
  metPct: number | null;
  avgHours: number | null;
  avgOverrunHours: number | null;
  coveragePct: number | null;
};

/** One row of tat.rollups[dim]. `segmentMetPct` is index-aligned to `segments`. */
type RollupRow = {
  name: string;
  jobs: number;
  efScorePct: number | null;
  efMet: number;
  efTotal: number;
  segmentMetPct: Array<number | null>;
  labels: Record<'Excellent' | 'Good' | 'Partial' | 'Poor' | 'Pending', number>;
};

type Assumption = { key: string; severity: string; title: string; detail: string };

type Performance = {
  window: { from: string; to: string; label: string };
  targets: {
    sla_pct: number;
    ftfr_pct: number;
    revisit_pct: number;
    avg_age_days: number;
    approval_response_hours: number;
    source: 'contracted' | 'platform-default';
  };
  tat: {
    jobsAnalysed: number;
    truncated: boolean;
    rowCap: number;
    efScorePct: number | null;
    efMet: number;
    efTotal: number;
    efStatus: Judgement;
    clientScorePct: number | null;
    clientMet: number;
    clientEvaluated: number;
    segments: Segment[];
    labels: Record<string, number>;
    avgBookingLeadHours: number | null;
    avgPunctualityHours: number | null;
    arrivedOnTimePct: number | null;
    assumptions: Assumption[];
  };
  breakdown: { dimension: string; label: string; rows: RollupRow[] };
  dimensions: Array<{ key: string; label: string }>;
  closure: { completed: number; cancelled: number; avgAgeDays: number | null; avgAgeStatus: Judgement };
  firstTimeFix: {
    ftfrPct: number | null;
    revisitPct: number | null;
    available: boolean;
    ftfrStatus: Judgement;
    revisitStatus: Judgement;
  };
  volume: Array<{ month: string; completed: number; cancelled: number }>;
};

/* ─── periods ───────────────────────────────────────────────────────────────
 * Windows are computed in the BROWSER so the month a SPOC sees is the month on
 * their own calendar. Each period also names the window it is compared
 * against, so the KPI deltas can say what they are a delta from.
 */

type PeriodKey = 'week' | 'month' | 'last-month' | 'quarter';

const PERIODS: ReadonlyArray<{ value: PeriodKey; label: string }> = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'quarter', label: 'Quarter' },
];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthYear = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const monthName = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long' });
const dayLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function periodWindows(key: PeriodKey, now: Date): {
  current: { from: string; to: string; title: string };
  previous: { from: string; to: string; short: string };
} {
  const y = now.getFullYear();
  const m = now.getMonth();

  if (key === 'week') {
    // Monday-anchored, matching Home's "plan this week" tile.
    const dow = (now.getDay() + 6) % 7;
    const mon = new Date(y, m, now.getDate() - dow);
    return {
      current: { from: ymd(mon), to: ymd(now), title: `Week of ${dayLabel(mon)}` },
      previous: {
        from: ymd(new Date(y, m, now.getDate() - dow - 7)),
        to: ymd(new Date(y, m, now.getDate() - dow - 1)),
        short: 'the week before',
      },
    };
  }
  if (key === 'month') {
    const first = new Date(y, m, 1);
    return {
      current: { from: ymd(first), to: ymd(now), title: monthYear(first) },
      previous: { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)), short: monthName(new Date(y, m - 1, 1)) },
    };
  }
  if (key === 'last-month') {
    const first = new Date(y, m - 1, 1);
    return {
      current: { from: ymd(first), to: ymd(new Date(y, m, 0)), title: monthYear(first) },
      previous: { from: ymd(new Date(y, m - 2, 1)), to: ymd(new Date(y, m - 1, 0)), short: monthName(new Date(y, m - 2, 1)) },
    };
  }
  // Calendar quarter to date, against the whole quarter before it.
  const qStart = Math.floor(m / 3) * 3;
  const start = new Date(y, qStart, 1);
  const pStart = new Date(y, qStart - 3, 1);
  return {
    current: { from: ymd(start), to: ymd(now), title: `Q${Math.floor(m / 3) + 1} ${y}` },
    previous: {
      from: ymd(pStart),
      to: ymd(new Date(y, qStart, 0)),
      short: `Q${Math.floor(pStart.getMonth() / 3) + 1} ${pStart.getFullYear()}`,
    },
  };
}

/* ─── judgement ─────────────────────────────────────────────────────────────
 * The server judges the four headline metrics for us and sends the verdict
 * with each. These two tables turn that verdict into console vocabulary, so
 * Performance cannot invent a different green from Invoicing.
 */
const JUDGE_ACCENT: Record<Judgement, Accent> = { ok: 'success', watch: 'warning', risk: 'brand' };
const JUDGE_STATUS: Record<Judgement, Status> = { ok: 'on-track', watch: 'watch', risk: 'at-risk' };

/**
 * The same rule as client-target.service.js judgeAgainst(), for the ROLLUP
 * rows — which carry a score but no verdict. Met is on track; missing by up to
 * a tenth of the target is watch; worse is at risk. Higher-is-better only,
 * because the only per-row metric with a target is the EF score.
 *
 * Returns null for an unscored group rather than the server's 'ok': a row with
 * nothing to score is not on track, it is unknown, and the table says so.
 */
function judgeRow(value: number | null, target: number): Judgement | null {
  if (value == null) return null;
  if (value >= target) return 'ok';
  return target - value <= Math.abs(target) * 0.1 ? 'watch' : 'risk';
}

/** Months of trend the volume series is asked for, and drawn against. */
const MONTHS = 6;

/**
 * Fill the months the series does not mention.
 *
 * The volume query GROUPs BY month, so a month in which nothing closed
 * produces NO ROW at all — and six bars drawn from four rows would space four
 * months as if they were consecutive. A month with no closures genuinely has
 * zero completed and zero cancelled, so filling it in is reading the query
 * correctly, not inventing a figure. Any month the server returns outside the
 * expected span (a future-dated checkout) is kept rather than dropped.
 */
function densify(rows: Performance['volume'], now: Date) {
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const wanted: string[] = [];
  for (let i = MONTHS - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    wanted.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const months = [...new Set([...wanted, ...byMonth.keys()])].sort();
  return months.map((month) => byMonth.get(month) ?? { month, completed: 0, cancelled: 0 });
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const days = (v: number | null | undefined) => (v == null ? '—' : `${v}d`);
const num = (v: number) => v.toLocaleString('en-IN');

/**
 * Progress toward a target, for the KPI bar. Two directions, because a revisit
 * rate and an age at close are met by going DOWN — a bar that filled as those
 * rose would read as progress while the service got worse.
 */
const towardHigher = (v: number | null, t: number) => (v == null || !t ? undefined : v / t);
const towardLower = (v: number | null, t: number) => (v == null ? undefined : v <= 0 ? 1 : t / v);

/**
 * A real delta between the selected window and the one before it, or nothing.
 * `deltaDirection` is the direction of TRAVEL; KpiCard's own `good` decides
 * whether that direction is an improvement.
 */
function deltaOf(
  current: number | null | undefined,
  previous: number | null | undefined,
  unit: string,
  label: string,
): { delta?: string; deltaDirection?: 'up' | 'down' } {
  if (current == null || previous == null) return {};
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return {};
  return { delta: `${Math.abs(diff)}${unit} vs ${label}`, deltaDirection: diff > 0 ? 'up' : 'down' };
}

export default function PerformancePage() {
  const allowed = useHasGrant('performance');
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [dim, setDim] = useState('city');
  const [showAll, setShowAll] = useState(false);
  const [showCaveats, setShowCaveats] = useState(false);

  const now = useMemo(() => new Date(), []);
  const { current, previous } = useMemo(() => periodWindows(period, now), [period, now]);

  // path = null skips the request entirely, so a SPOC without the grant never
  // fires a call the server would 403.
  const path = allowed
    ? `/performance?from=${current.from}&to=${current.to}&dim=${encodeURIComponent(dim)}&months=${MONTHS}`
    : null;
  const { data, error, loading, reload } = useFetchOnce<Performance>(path);

  // The comparison window. Pinned to dim=city and months=1: this call exists
  // only for four scalars, and re-running the scorer because someone switched
  // the table to Category would be pure waste.
  const prevPath = allowed ? `/performance?from=${previous.from}&to=${previous.to}&dim=city&months=1` : null;
  const { data: prior } = useFetch<Performance>(prevPath);

  if (!allowed) {
    return (
      <>
        <PageHeader title="Performance" sub="Turn-around time against your contracted targets" />
        <Panel>
          <EmptyState
            icon={Lock}
            title="Performance is not part of your access"
            sub="Your role does not include the performance book. Your EasyFix account manager can enable it for you, or for your whole team."
          />
        </Panel>
      </>
    );
  }

  if (loading && !data) {
    return (
      // Panel supplies the card chrome. EmptyState is not used here only
      // because its icon cannot spin — the body below is EmptyState's own
      // spacing, not a second card.
      <Panel>
        <div className="py-7 text-center">
          <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
          <div className="mt-2 text-sm text-ink-500">Loading your performance book…</div>
        </div>
      </Panel>
    );
  }
  if (error || !data) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load performance"
          sub={error || 'The performance service did not respond.'}
          action={<ActionButton onClick={() => void reload()}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  const { tat, targets, closure, firstTimeFix, breakdown } = data;
  // Six rows at most — cheap enough to do on every render, and it has to live
  // below the early returns, where a hook cannot go.
  const volume = densify(data.volume, now);

  /* Segment columns are found BY KEY, never by a hard-coded index: if the spec
     grows a fifth segment the page must not silently read the wrong column. */
  const approvalIdx = tat.segments.findIndex((s) => s.key === 'approval');
  const completionIdx = tat.segments.findIndex((s) => s.key === 'completion');

  const rows = breakdown.rows;
  const shown = showAll ? rows : rows.slice(0, 12);
  // Rows arrive sorted worst-EF-first with unscored groups LAST, so the first
  // scored row is the weakest group — no re-sorting here.
  const worst = rows.find((r) => r.efScorePct != null);
  const worstJudge = worst ? judgeRow(worst.efScorePct, targets.sla_pct) : null;

  const closedInSeries = volume.reduce((a, r) => a + r.completed + r.cancelled, 0);

  return (
    <>
      <PageHeader
        title={`Performance · ${current.title}`}
        sub={
          <>
            {data.window.label} · {num(tat.jobsAnalysed)} job{tat.jobsAnalysed === 1 ? '' : 's'} scored ·{' '}
            {targets.source === 'contracted' ? 'contracted targets' : 'platform default targets'}
            {loading ? ' · updating…' : ''}
          </>
        }
        filters={<Segmented options={PERIODS} value={period} onChange={setPeriod} />}
      />

      <SectionLabel>Against target</SectionLabel>
      <StatRow className="mb-4">
        <KpiCard
          label={
            <span className="inline-flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5" aria-hidden /> SLA compliance · EasyFix segments
            </span>
          }
          value={pct(tat.efScorePct)}
          good="up"
          {...deltaOf(tat.efScorePct, prior?.tat.efScorePct, 'pp', previous.short)}
          target={`Target ${targets.sla_pct}%`}
          progress={towardHigher(tat.efScorePct, targets.sla_pct)}
          accent={JUDGE_ACCENT[tat.efStatus]}
        />
        <KpiCard
          label={
            <span className="inline-flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" aria-hidden /> First time fix rate
            </span>
          }
          value={pct(firstTimeFix.ftfrPct)}
          good="up"
          {...deltaOf(firstTimeFix.ftfrPct, prior?.firstTimeFix.ftfrPct, 'pp', previous.short)}
          // `available: false` means the linked_job table is absent, so a
          // follow-up visit cannot be detected at all. The server sends null
          // rather than a fabricated 100%, and the card says which it is.
          target={firstTimeFix.available ? `Target ${targets.ftfr_pct}%` : 'Not recorded'}
          progress={towardHigher(firstTimeFix.ftfrPct, targets.ftfr_pct)}
          accent={firstTimeFix.available ? JUDGE_ACCENT[firstTimeFix.ftfrStatus] : 'info'}
        />
        <KpiCard
          label={
            <span className="inline-flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" aria-hidden /> Revisit rate
            </span>
          }
          value={pct(firstTimeFix.revisitPct)}
          // A FALLING revisit rate is an improvement.
          good="down"
          {...deltaOf(firstTimeFix.revisitPct, prior?.firstTimeFix.revisitPct, 'pp', previous.short)}
          target={firstTimeFix.available ? `Target under ${targets.revisit_pct}%` : 'Not recorded'}
          progress={towardLower(firstTimeFix.revisitPct, targets.revisit_pct)}
          accent={firstTimeFix.available ? JUDGE_ACCENT[firstTimeFix.revisitStatus] : 'info'}
        />
        <KpiCard
          label={
            <span className="inline-flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5" aria-hidden /> Avg age at close
            </span>
          }
          value={days(closure.avgAgeDays)}
          // As is a FALLING age at close.
          good="down"
          {...deltaOf(closure.avgAgeDays, prior?.closure.avgAgeDays, 'd', previous.short)}
          target={`Target under ${targets.avg_age_days}d`}
          progress={towardLower(closure.avgAgeDays, targets.avg_age_days)}
          accent={JUDGE_ACCENT[closure.avgAgeStatus]}
        />
      </StatRow>

      {tat.truncated && (
        <Banner accent="warning" className="mb-4">
          This window holds more than {num(tat.rowCap)} completed jobs. Every figure above is computed on
          the most recent {num(tat.rowCap)} and is a partial view — narrow the period for an exact one.
        </Banner>
      )}

      {/*
        The client's own clock, kept apart from the EasyFix score above.
        SUBSTITUTED: the mock's copy reads "target: respond within 24 hours".
        The rate IS measured against the engine's 24-hour approval target, but
        that number is a frozen spec constant the payload does not carry —
        only the CONTRACTED figure below is in it. Rather than restate a
        target from memory, the banner states the contracted one and names it
        as such.
      */}
      <Banner
        accent="info"
        right={pct(tat.clientScorePct)}
        className="mb-6"
      >
        Your approval response rate — {num(tat.clientMet)} of {num(tat.clientEvaluated)} estimate
        {tat.clientEvaluated === 1 ? '' : 's'} decided inside the approval target · your contracted target:
        respond within {targets.approval_response_hours} hours
      </Banner>

      <SectionLabel>Trend</SectionLabel>
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 mb-6">
        <Panel
          title={`Volume · last ${MONTHS} months`}
          action={<Pill accent="info">Rolling, not this period</Pill>}
        >
          {closedInSeries ? (
            <>
              <VolumeBars rows={volume} />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-success" aria-hidden /> Completed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-primary" aria-hidden /> Cancelled
                </span>
                <span className="ml-auto tabular-nums">
                  {num(volume.reduce((a, r) => a + r.completed, 0))} completed ·{' '}
                  {num(volume.reduce((a, r) => a + r.cancelled, 0))} cancelled
                </span>
              </div>
            </>
          ) : (
            <EmptyState title="No jobs closed in the last six months" />
          )}
        </Panel>

        {/*
          SUBSTITUTED: the mock's second panel is "SLA and first time fix ·
          trend". Neither has a monthly series anywhere in this payload — the
          TAT engine scores ONE window per call, and a six-month SLA line would
          mean six more calls to the heaviest endpoint in the portal. What the
          volume series can honestly carry is the share of each month's closures
          that completed, so that is what is plotted and what the title says.
          The dashed line is the six-month weighted average, labelled as an
          average and NOT as a target: the contracted targets cover SLA, FTFR,
          revisit and age, none of which this line measures.
        */}
        <Panel
          title={`Completion rate · last ${MONTHS} months`}
          action={<Pill accent="info">Share of closures completed</Pill>}
        >
          {closedInSeries ? (
            <>
              <RateLine rows={volume} />
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-info" aria-hidden /> Completed ÷ closed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-4 border-t border-dashed border-ink-300" aria-hidden /> Six-month average
                </span>
              </div>
            </>
          ) : (
            <EmptyState title="No closures to rate" sub="Nothing completed or cancelled in the last six months." />
          )}
        </Panel>
      </div>

      <SectionLabel>Breakdown</SectionLabel>
      <Panel
        className="mb-4"
        title={`By ${breakdown.label.toLowerCase()} · ${current.title}`}
        action={
          <Segmented
            options={data.dimensions.map((d) => ({ value: d.key, label: d.label }))}
            value={dim}
            onChange={setDim}
          />
        }
        bodyClassName="px-0 py-0"
      >
        {rows.length === 0 ? (
          <EmptyState
            title={`No completed jobs by ${breakdown.label.toLowerCase()} in this period`}
            sub="Widen the period, or try a different breakdown."
          />
        ) : (
          <DataTable
            className="rounded-none border-0"
            columns={[
              { key: 'name', label: breakdown.label },
              { key: 'completed', label: 'Completed', align: 'right' },
              { key: 'poor', label: 'Graded poor', align: 'right' },
              { key: 'sla', label: 'SLA %', align: 'right' },
              { key: 'approval', label: 'Approval %', align: 'right' },
              { key: 'completion', label: 'Completion %', align: 'right' },
              { key: 'status', label: 'Status', align: 'right' },
            ]}
          >
            {shown.map((r) => {
              const j = judgeRow(r.efScorePct, targets.sla_pct);
              return (
                <Row key={r.name} edge={j ? JUDGE_ACCENT[j] : undefined}>
                  <Cell className="font-medium text-ink-900">{r.name}</Cell>
                  {/* Every job the engine scores is a COMPLETED one — it loads no
                      other status — so this row count is the group's completed
                      jobs in the window, subject to the row cap flagged above. */}
                  <Cell align="right" className="tabular-nums">{num(r.jobs)}</Cell>
                  {/* SUBSTITUTED: the mock's second column is "Cancelled". A
                      cancellation never reaches the scorer, so no rollup row can
                      carry one — cancellations exist only as the window total and
                      the monthly series. The nearest per-row measure of trouble is
                      the count graded Poor, which is what this column is. */}
                  <Cell align="right" className="tabular-nums text-ink-500">{num(r.labels.Poor)}</Cell>
                  <Cell align="right" className="tabular-nums">{pct(r.efScorePct)}</Cell>
                  {/* SUBSTITUTED: the mock's "FTFR %" is a whole-window figure —
                      first-time fix is computed from linked_job in a separate
                      query with no dimension at all. This column is the client-owned
                      Approval segment's met %, which the rollup does carry. */}
                  <Cell align="right" className="tabular-nums">
                    {pct(approvalIdx >= 0 ? r.segmentMetPct[approvalIdx] : null)}
                  </Cell>
                  {/* SUBSTITUTED: the mock's "Avg age" is likewise window-wide and
                      has no per-group form. Completion segment met % is the nearest
                      per-row read on how promptly work closed. */}
                  <Cell align="right" className="tabular-nums">
                    {pct(completionIdx >= 0 ? r.segmentMetPct[completionIdx] : null)}
                  </Cell>
                  <Cell align="right">
                    <StatusPill status={j ? JUDGE_STATUS[j] : 'neutral'} />
                  </Cell>
                </Row>
              );
            })}
          </DataTable>
        )}
        {rows.length > 12 && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-ink-100 text-xs text-ink-500">
            <span>
              {showAll ? `All ${num(rows.length)} rows` : `Showing the 12 weakest of ${num(rows.length)}`}
            </span>
            <ActionButton variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show the weakest 12' : 'Show all'}
            </ActionButton>
          </div>
        )}
      </Panel>

      {worst && (
        <Banner
          accent={worstJudge === 'ok' ? 'success' : 'warning'}
          right={pct(worst.efScorePct)}
          className="mb-4"
        >
          {worstJudge === 'ok' ? (
            <>
              Every {breakdown.label.toLowerCase()} met the {targets.sla_pct}% target this period —{' '}
              {worst.name} is the closest to it, at {num(worst.jobs)} job{worst.jobs === 1 ? '' : 's'} scored.
            </>
          ) : (
            <>
              {worst.name} is your weakest {breakdown.label.toLowerCase()} this period — {pct(worst.efScorePct)} of
              EasyFix-owned segments met across {num(worst.jobs)} completed job{worst.jobs === 1 ? '' : 's'},
              against a target of {targets.sla_pct}%.
            </>
          )}
        </Banner>
      )}

      {/* The caveats travel WITH the numbers rather than living in a wiki. One
          of them is material to the headline: check-in has no writer in this
          backend, so Segment 1 reads Pending on most new-CRM jobs and is
          excluded from the denominator. A score shown without that is
          quietly overstated. */}
      {tat.assumptions?.length ? (
        <Panel
          title={
            <span className="inline-flex items-center gap-2">
              <Info className="w-4 h-4 text-ink-500" aria-hidden /> How these numbers are measured
            </span>
          }
          action={
            <ActionButton variant="ghost" onClick={() => setShowCaveats((v) => !v)}>
              {showCaveats ? 'Hide' : `Show ${tat.assumptions.length} notes`}
            </ActionButton>
          }
        >
          {showCaveats ? (
            <div>
              {tat.assumptions.map((a) => (
                <div key={a.key} className="py-2.5 border-b border-ink-100 last:border-0">
                  <div className="flex items-start gap-2">
                    <Pill accent={a.severity === 'warning' ? 'warning' : 'info'}>{a.severity}</Pill>
                    <div className="min-w-0">
                      <div className="text-sm text-ink-900">{a.title}</div>
                      <div className="text-xs text-ink-500 leading-relaxed mt-0.5">{a.detail}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              {tat.assumptions.length} known limit{tat.assumptions.length === 1 ? '' : 's'} affect the figures on
              this page — including which timestamps exist to measure from.
            </p>
          )}
        </Panel>
      ) : null}
    </>
  );
}

/* ─── charts ────────────────────────────────────────────────────────────────
 * Hand-rolled SVG, no chart library. Every colour is an --ef-* token and every
 * <text> sits at the 12px brand floor or above — the brand guard enforces both.
 */

const monthTick = (ym: string) => {
  const [yy, mm] = ym.split('-');
  return new Date(Number(yy), Number(mm) - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
};

/**
 * Completed vs cancelled, one pair of bars per month.
 *
 * Green and red are the weakest pair for a deuteranope reader, so the pairing
 * carries SECONDARY encoding as well as hue: a gap between the two bars, a
 * printed value on every completed bar, a legend beside the chart, and a title
 * on each rect. Those are the accessibility relief, not decoration — do not
 * remove them and leave the colours doing the work alone.
 */
function VolumeBars({ rows }: { rows: Array<{ month: string; completed: number; cancelled: number }> }) {
  const W = 560;
  const H = 190;
  const padT = 22;
  const padB = 26;
  const max = Math.max(...rows.flatMap((r) => [r.completed, r.cancelled]), 1);
  const slot = W / rows.length;
  const bw = Math.min(20, slot / 3.2);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto min-w-[320px]"
        role="img"
        aria-label="Completed and cancelled jobs by month, last six months"
      >
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--ef-ink-100)" strokeWidth={1} />
        ))}
        {rows.map((r, i) => {
          const cx = slot * i + slot / 2;
          const xC = cx - bw - 1;
          const xX = cx + 1;
          const last = i === rows.length - 1;
          return (
            <g key={r.month} opacity={last ? 1 : 0.78}>
              <rect x={xC} y={y(r.completed)} width={bw} height={y(0) - y(r.completed)} rx={3} fill="var(--ef-success)">
                <title>{`${monthTick(r.month)}: ${r.completed} completed`}</title>
              </rect>
              <rect x={xX} y={y(r.cancelled)} width={bw} height={y(0) - y(r.cancelled)} rx={3} fill="var(--ef-red-500)">
                <title>{`${monthTick(r.month)}: ${r.cancelled} cancelled`}</title>
              </rect>
              {/* 12 is the brand legibility floor. padT is 22 and the baseline
                  sits 5 above the bar, so a full cap height still lands inside
                  the viewBox even when a bar reaches the top gridline. */}
              <text
                x={xC + bw / 2}
                y={y(r.completed) - 5}
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill="var(--ef-ink-700)"
              >
                {r.completed}
              </text>
              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                fontSize={12}
                fontWeight={last ? 600 : 400}
                fill={last ? 'var(--ef-ink-700)' : 'var(--ef-ink-500)'}
              >
                {monthTick(r.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Share of each month's closures that COMPLETED, on a fixed 0–100 axis with the
 * six-month weighted average as a dashed reference.
 *
 * A month with nothing closed has no rate — not a zero — so it gets no point,
 * and no segment is drawn ACROSS the gap: bridging it would draw a line through
 * a month that never happened.
 */
function RateLine({ rows }: { rows: Array<{ month: string; completed: number; cancelled: number }> }) {
  const W = 560;
  const H = 190;
  const padT = 16;
  const padB = 26;
  const padL = 38;

  const points = rows.map((r) => {
    const closed = r.completed + r.cancelled;
    return { month: r.month, v: closed ? Math.round((r.completed / closed) * 1000) / 10 : null };
  });
  const totalCompleted = rows.reduce((a, r) => a + r.completed, 0);
  const totalClosed = rows.reduce((a, r) => a + r.completed + r.cancelled, 0);
  // Weighted, not the mean of the monthly rates: a month with four closures
  // must not pull the average as hard as a month with four hundred.
  const avg = totalClosed ? Math.round((totalCompleted / totalClosed) * 1000) / 10 : null;

  const slot = (W - padL) / rows.length;
  const x = (i: number) => padL + slot * i + slot / 2;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / 100);

  const lastIdx = points.map((p, i) => (p.v == null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto min-w-[320px]"
        role="img"
        aria-label="Share of monthly closures that completed, last six months"
      >
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={padL} x2={W} y1={y(g)} y2={y(g)} stroke="var(--ef-ink-100)" strokeWidth={1} />
            {/* 12 is the brand legibility floor; padL of 38 leaves room for
                "100%" at that size without touching the plot area. */}
            <text x={padL - 6} y={y(g) + 4} textAnchor="end" fontSize={12} fill="var(--ef-ink-500)">
              {g}%
            </text>
          </g>
        ))}

        {avg != null && (
          <>
            <line
              x1={padL}
              x2={W}
              y1={y(avg)}
              y2={y(avg)}
              stroke="var(--ef-ink-300)"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
            <text x={W} y={y(avg) - 6} textAnchor="end" fontSize={12} fill="var(--ef-ink-500)">
              {`avg ${avg}%`}
            </text>
          </>
        )}

        {points.map((p, i) => {
          const next = points[i + 1];
          if (p.v == null || !next || next.v == null) return null;
          return (
            <line
              key={`seg-${p.month}`}
              x1={x(i)}
              y1={y(p.v)}
              x2={x(i + 1)}
              y2={y(next.v)}
              stroke="var(--ef-blue-500)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          );
        })}

        {points.map((p, i) =>
          p.v == null ? null : (
            <circle key={`dot-${p.month}`} cx={x(i)} cy={y(p.v)} r={i === lastIdx ? 4 : 3} fill="var(--ef-blue-500)">
              <title>{`${monthTick(p.month)}: ${p.v}% of closures completed`}</title>
            </circle>
          ),
        )}

        {lastIdx >= 0 && points[lastIdx].v != null && (
          <text
            x={x(lastIdx)}
            y={Math.max(y(points[lastIdx].v as number) - 10, padT + 10)}
            textAnchor="end"
            fontSize={12}
            fontWeight={600}
            fill="var(--ef-ink-700)"
          >
            {`${points[lastIdx].v}%`}
          </text>
        )}

        {points.map((p, i) => (
          <text
            key={`tick-${p.month}`}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            fontSize={12}
            fontWeight={i === rows.length - 1 ? 600 : 400}
            fill={i === rows.length - 1 ? 'var(--ef-ink-700)' : 'var(--ef-ink-500)'}
          >
            {monthTick(p.month)}
          </text>
        ))}
      </svg>
    </div>
  );
}
