/**
 * Client-side analytics over a loaded window of recent orders.
 *
 * Ported VERBATIM from the mobile client app (Easyfix_Client_App →
 * src/lib/analytics.ts + the inline top-cities logic in InsightsSections.tsx)
 * so the web dashboard's "Orders trend" and "Performance by city" produce
 * the exact same numbers as the app. The backend can't aggregate by day or
 * by city on this path, so both surfaces derive these from the newest orders
 * they load. Do not change the definitions here without changing the app too.
 */

/** Minimal shape these aggregations need off each job row. */
export type AnalyticsJob = {
  ticket_created_date_time?: string | null;
  job_status?: number | null;
  city_name?: string | null;
};

const COMPLETED_STATUS = new Set([3, 5]);
// "Cancelled" bucket = cancelled (6) + enquiry (7), per the client's request.
const CANCELLED_STATUS = new Set([6, 7]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse "YYYY-MM-DD HH:mm:ss" / ISO into a local Date. */
export function parseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export type DayBar = { label: string; day: number; created: number; completed: number; cancelled: number };
export type Trend7 = {
  days: DayBar[];
  createdTotal: number;
  completedTotal: number;
  cancelledTotal: number;
  completionPct: number;
  rangeLabel: string;
};

/** Latest order-creation day present in `jobs` (falls back to `now`). */
function latestDay(jobs: AnalyticsJob[], now: Date): Date {
  let maxDay: Date | null = null;
  for (const j of jobs) {
    const d = parseDate(j.ticket_created_date_time);
    if (d && (!maxDay || dayStart(d).getTime() > maxDay.getTime())) maxDay = dayStart(d);
  }
  return maxDay || dayStart(now);
}

/**
 * Created/completed trend over the trailing `days` window. The window ends on
 * the most recent order date present in `jobs` (so it's never empty when data
 * lags), or `now` if none.
 */
export function buildTrend(jobs: AnalyticsJob[], days = 7, now: Date = new Date()): Trend7 {
  const list = jobs ?? [];
  const maxDay = latestDay(list, now);
  const start = addDays(maxDay, -(days - 1));

  const buckets: DayBar[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    buckets.push({ label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, day: d.getDate(), created: 0, completed: 0, cancelled: 0 });
  }
  const idxOf = (d: Date) => {
    const diff = Math.round((dayStart(d).getTime() - start.getTime()) / 86400000);
    return diff >= 0 && diff < days ? diff : -1;
  };

  let createdTotal = 0;
  let completedTotal = 0;
  let cancelledTotal = 0;
  for (const j of list) {
    const cd = parseDate(j.ticket_created_date_time);
    if (!cd) continue;
    const i = idxOf(cd);
    if (i < 0) continue;
    buckets[i].created += 1;
    createdTotal += 1;
    const st = j.job_status ?? -1;
    if (COMPLETED_STATUS.has(st)) {
      buckets[i].completed += 1;
      completedTotal += 1;
    }
    if (CANCELLED_STATUS.has(st)) {
      buckets[i].cancelled += 1;
      cancelledTotal += 1;
    }
  }

  const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return {
    days: buckets,
    createdTotal,
    completedTotal,
    cancelledTotal,
    completionPct: createdTotal ? Math.round((completedTotal / createdTotal) * 100) : 0,
    rangeLabel: `${fmt(start)} – ${fmt(maxDay)}`,
  };
}

/** Orders created within the trailing `days` window (ending at the latest data day). */
export function jobsInWindow(jobs: AnalyticsJob[], days: number, now: Date = new Date()): AnalyticsJob[] {
  const list = jobs ?? [];
  const maxDay = latestDay(list, now);
  const lo = addDays(maxDay, -(days - 1)).getTime();
  const hi = addDays(maxDay, 1).getTime(); // exclusive end-of-day
  return list.filter((j) => {
    const d = parseDate(j.ticket_created_date_time);
    return d && d.getTime() >= lo && d.getTime() < hi;
  });
}

export type CityBar = { city: string; orders: number };

/**
 * Top cities by order count over the trailing `days` window (ending at the
 * latest data day). Ported from InsightsSections.tsx — count `city_name`
 * over `jobsInWindow`, sort desc, take top `topN`.
 */
export function topCities(jobs: AnalyticsJob[], days: number, topN = 10, now: Date = new Date()): CityBar[] {
  const inWin = jobsInWindow(jobs, days, now);
  const counts = new Map<string, number>();
  inWin.forEach((j) => {
    const city = (j.city_name || '').trim();
    if (city) counts.set(city, (counts.get(city) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([city, orders]) => ({ city, orders }))
    .sort((a, b) => b.orders - a.orders)
    .slice(0, topN);
}
