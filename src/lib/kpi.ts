/*
 * The four contracted KPIs — ONE definition, two screens.
 *
 * /performance renders them as big KpiCards; Home's Performance health card
 * renders them as compact rows. What must NOT differ is anything upstream of
 * that: which field each reads, which target it is judged against, which
 * DIRECTION counts as good, and how a null is formatted. Home's card carries a
 * comment warning that duplicating this maths "is the surest way to have two
 * numbers disagree" — this module is how it stays true while both screens show
 * the same four figures.
 *
 * Presentation stays with each page. Derivation lives here.
 */
import { Gauge, RotateCcw, Timer, Wrench, type LucideIcon } from 'lucide-react';
import type { Accent } from '@/components/ui/console';

/** client-target.service.js judgeAgainst(): met / within 10% / worse. */
export type Judgement = 'ok' | 'watch' | 'risk';

export const JUDGE_ACCENT: Record<Judgement, Accent> = {
  ok: 'success', watch: 'warning', risk: 'brand',
};

/*
 * ⚠ A NULL JUDGEMENT IS NOT A PASS.
 *
 * The server sends null for a metric it cannot judge — no value measured, or
 * no target to measure against. It used to send 'ok', which painted a window
 * with zero completed jobs as four em dashes behind a GREEN on-track rule:
 * green is a claim about performance, and nothing had been measured to
 * support it.
 *
 * Neutral is `info`, the same accent this module already gives "Not recorded"
 * when the linked_job table is missing. Both mean "we cannot tell you", and
 * they should not look different from each other.
 */
const accentFor = (j: Judgement | null | undefined): Accent =>
  (j == null ? 'info' : JUDGE_ACCENT[j]);

export const kpiPct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
export const kpiDays = (v: number | null | undefined) => (v == null ? '—' : `${v}d`);

/*
 * Progress toward a target. TWO directions, because a revisit rate and an age
 * at close are met by going DOWN — a bar that filled as those rose would read
 * as progress while the service got worse.
 */
export const towardHigher = (v: number | null | undefined, t: number) =>
  (v == null || !t ? undefined : v / t);
export const towardLower = (v: number | null | undefined, t: number) =>
  (v == null ? undefined : v <= 0 ? 1 : t / v);

/*
 * A real delta between two windows, or nothing. `direction` is the direction of
 * TRAVEL; each KPI's own `good` decides whether that is an improvement.
 */
function deltaOf(current: number | null | undefined, previous: number | null | undefined, unit: string, label: string) {
  if (current == null || previous == null) return {};
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return {};
  return { delta: `${Math.abs(diff)}${unit} vs ${label}`, deltaDirection: (diff > 0 ? 'up' : 'down') as 'up' | 'down' };
}

/**
 * The narrowest shape a caller must supply. Declared structurally so both the
 * full /performance payload and a page's own slimmed-down slice satisfy it
 * without either having to import the other's type.
 */
export type KpiSource = {
  targets: { sla_pct: number; ftfr_pct: number; revisit_pct: number; avg_age_days: number };
  tat: { efScorePct: number | null; efStatus: Judgement | null };
  firstTimeFix: {
    ftfrPct: number | null; revisitPct: number | null; available: boolean;
    ftfrStatus: Judgement | null; revisitStatus: Judgement | null;
  };
  closure: { avgAgeDays: number | null; avgAgeStatus: Judgement | null };
};

export type Kpi = {
  key: 'sla' | 'ftfr' | 'revisit' | 'age';
  icon: LucideIcon;
  label: string;
  value: string;
  good: 'up' | 'down';
  target: string;
  progress: number | undefined;
  accent: Accent;
  delta?: string;
  deltaDirection?: 'up' | 'down';
};

/**
 * Build all four from a /performance response. Pass `prior` (the same shape for
 * the previous window) to get deltas; omit it for a screen that shows none.
 *
 * ⚠ `available: false` means the linked_job table is absent, so a follow-up
 * visit cannot be DETECTED at all. It gates the REVISIT rate ONLY.
 *
 * First-time fix used to be gated by it too, because both numbers came from
 * that table — ftfr was "no child row" and revisit was `100 - ftfr`. It is now
 * check-in and check-out on the same day: two core tbl_job columns, measurable
 * on any deployment, and a different question from whether anyone came back.
 */
export function performanceKpis(d: KpiSource, prior?: KpiSource | null, priorLabel = 'previous'): Kpi[] {
  /** linked_job present — gates the REVISIT rate only. */
  const revisitMeasurable = d.firstTimeFix.available;
  return [
    {
      key: 'sla',
      icon: Gauge,
      label: 'SLA compliance · EasyFix segments',
      value: kpiPct(d.tat.efScorePct),
      good: 'up',
      target: `Target ${d.targets.sla_pct}%`,
      progress: towardHigher(d.tat.efScorePct, d.targets.sla_pct),
      accent: accentFor(d.tat.efStatus),
      ...deltaOf(d.tat.efScorePct, prior?.tat.efScorePct, 'pp', priorLabel),
    },
    {
      key: 'ftfr',
      icon: Wrench,
      label: 'First time fix rate',
      value: kpiPct(d.firstTimeFix.ftfrPct),
      good: 'up',
      // NOT gated on `available` — same-day close needs no linked_job table.
      target: `Target ${d.targets.ftfr_pct}%`,
      progress: towardHigher(d.firstTimeFix.ftfrPct, d.targets.ftfr_pct),
      accent: accentFor(d.firstTimeFix.ftfrStatus),
      ...deltaOf(d.firstTimeFix.ftfrPct, prior?.firstTimeFix.ftfrPct, 'pp', priorLabel),
    },
    {
      key: 'revisit',
      icon: RotateCcw,
      label: 'Revisit rate',
      value: kpiPct(d.firstTimeFix.revisitPct),
      // A FALLING revisit rate is an improvement.
      good: 'down',
      target: revisitMeasurable ? `Target under ${d.targets.revisit_pct}%` : 'Not recorded',
      progress: towardLower(d.firstTimeFix.revisitPct, d.targets.revisit_pct),
      accent: revisitMeasurable ? accentFor(d.firstTimeFix.revisitStatus) : 'info',
      ...deltaOf(d.firstTimeFix.revisitPct, prior?.firstTimeFix.revisitPct, 'pp', priorLabel),
    },
    {
      key: 'age',
      icon: Timer,
      label: 'Avg age at close',
      value: kpiDays(d.closure.avgAgeDays),
      // As is a FALLING age at close.
      good: 'down',
      target: `Target under ${d.targets.avg_age_days}d`,
      progress: towardLower(d.closure.avgAgeDays, d.targets.avg_age_days),
      accent: accentFor(d.closure.avgAgeStatus),
      ...deltaOf(d.closure.avgAgeDays, prior?.closure.avgAgeDays, 'd', priorLabel),
    },
  ];
}
