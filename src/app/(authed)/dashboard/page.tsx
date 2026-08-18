'use client';

/*
 * Summary Dashboard — landing page after login.
 *
 * Replaces the old Order History page at /dashboard (that moved to
 * /history). Shows a high-altitude view of the team's workload:
 *
 *   1. 5 KPI cards     — New / In Progress / Completed / Cancelled / Escalated
 *   2. Donut chart     — status-breakdown of every job in scope
 *   3. Escalations     — top 5 most-recent rows that need attention
 *
 * Scope: ALWAYS team-wide (logged-in SPOC + every direct report).
 * Backend resolves the team list server-side from the JWT; the FE
 * never sends scope identifiers.
 *
 * Backend contract:
 *   GET /api/client/dashboard-summary
 *     → { counts, statusBreakdown, recentEscalations, teamSize }
 *
 * Design notes:
 *   - No date picker on v1 — counts are lifetime. The endpoint is
 *     ready to take startDate / endDate query params when we add one.
 *   - Pie chart is an inline SVG (no chart library) so the bundle
 *     stays lean. ~25 lines of arc math; readable, easy to tweak.
 *   - Escalations rows link straight to /jobs/[id] so the SPOC can
 *     jump into resolution with one tap.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetchOnce, useRecentJobs } from '@/lib/hooks';
import { buildTrend, topCities, type AnalyticsJob } from '@/lib/analytics';
import { openJobDrawer } from '@/components/job-drawer';
import { useSpoc } from '@/lib/spoc-context';
import {
  Loader2, BellRing, ArrowUpRight, Plus,
  TicketIcon, Clock, AlarmClock, CheckCircle2, XCircle, AlertTriangle,
  Activity, FileClock, PauseCircle, CalendarDays, Search,
  MapPin, CalendarClock, Sun,
} from 'lucide-react';
import { STATUS_LABELS } from '@/lib/utils';

type Summary = {
  // Home-page KPI boxes — see /api/client/dashboard-summary.
  boxes: {
    newTickets:           number;
    waitingForAllocation: number;
    runningLate:          number;
    estimateApproved:     number;
    estimateRejected:     number;
  };
  counts: {
    newTickets: number;
    inProgress: number;
    completed:  number;
    cancelled:  number;
    escalated:  number;
  };
  statusBreakdown: Array<{ label: string; count: number; color: string }>;
  categoryBreakdown: Array<{ label: string; count: number; color: string }>;
  recentTickets: Array<{
    jobId: number;
    ref: string | null;
    customer: string | null;
    city: string | null;
    tech: string | null;
    status: number;
    when: string | null;
  }>;
  recentEscalations: Array<{
    job_id: number;
    client_ref_id: string | null;
    job_status: number;
    customer_name: string | null;
    customer_mob_no: string | null;
    easyfixer_name: string | null;
    review_comment: string | null;
    customer_rating: number | null;
  }>;
  // Performance by city / store — real, team-scoped aggregation.
  cityPerformance: Array<{
    city: string;
    orders: number;
    completed: number;
    onTimePct: number | null;
    avgTatDays: number | null;
  }>;
  // Overdue active jobs bucketed by how many days late they are.
  slaAging: { d01: number; d23: number; d47: number; d7plus: number };
  // "Needs attention" — actionable order buckets + invoices due.
  attention?: {
    invoicesDue: { count: number; amount: number };
    estimatePending: number;
    noResponse: number;
    onHold: number;
    revisit: number;
    qcDone: number;
  };
  // 30-day orders trend — received vs completed per day.
  trend?: Array<{ date: string; created: number; completed: number }>;
  teamSize: number;
};

export default function SummaryDashboardPage() {
  const spoc = useSpoc();
  const { data, loading, error } = useFetchOnce<Summary>('/dashboard-summary');
  // Recent-orders window — Orders-trend + Performance-by-city aggregate this
  // CLIENT-SIDE (see src/lib/analytics.ts), exactly like the mobile app.
  const { jobs, loading: jobsLoading } = useRecentJobs<AnalyticsJob>();

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-slate-400" />
        <div className="mt-2 text-sm text-slate-500">Loading your dashboard…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-sm text-rose-900">
        {error || 'Could not load the dashboard.'}
      </div>
    );
  }

  // Pulls a friendly first name out of "Mr. Rahul Jadhav" / "Rahul"
  // for the welcome line. Strips the salutation if present, then
  // takes the first remaining word.
  const greetingName = (() => {
    const raw = (spoc.contact_name || '').trim();
    if (!raw) return null;
    const stripped = raw.replace(/^(mr|mrs|ms|dr|miss|sir|madam)\.?\s+/i, '').trim();
    return (stripped.split(/\s+/)[0] || raw).trim();
  })();

  // Time-of-day greeting (client-only — this page renders after the data
  // fetch, so no SSR/hydration mismatch on the hour).
  const hour = new Date().getHours();
  const greet =
    hour < 12 ? 'Good morning' :
    hour < 17 ? 'Good afternoon' :
    hour < 21 ? 'Good evening' : 'Good night';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {greetingName ? `${greet}, ${greetingName}` : greet} <span aria-hidden>👋</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Here&apos;s what&apos;s happening across your service operations today.
          </p>
        </div>
        <Link
          href="/jobs/new"
          className="px-5 py-2.5 text-sm font-bold rounded-xl text-white inline-flex items-center gap-1.5 transition hover:-translate-y-0.5"
          style={{ background: 'linear-gradient(145deg,#ff6b6b,#e53935)', boxShadow: '0 12px 24px -10px rgba(229,57,53,.7)' }}
        >
          <Plus className="w-4 h-4" /> New Order
        </Link>
      </div>

      {/* Needs your attention — full width */}
      <AttentionCard attention={data.attention} />

      {/* Today's appointments + Yesterday's booked */}
      <section>
        <SectionHead>Today &amp; yesterday</SectionHead>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <TodaysAppointments />
          <YesterdaysBooked />
        </div>
      </section>

      {/* Trends */}
      <section>
        <SectionHead>Trends</SectionHead>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OrdersTrend jobs={jobs} loading={jobsLoading} />
          <CompletionCard counts={data.counts} />
        </div>
      </section>

      {/* Breakdown + Upcoming events (replaces Recent escalations) */}
      <section>
        <SectionHead>Breakdown</SectionHead>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <CategoryBreakdown items={data.categoryBreakdown ?? []} />
          <HolidayCalendar />
        </div>
      </section>

      {/* Top Performance — city ranking (SLA breaches removed) */}
      <section>
        <CityPerformance jobs={jobs} loading={jobsLoading} />
      </section>

      {/* Recent tickets — searchable by Job ID */}
      <section>
        <SectionHead>Recent tickets</SectionHead>
        <RecentTickets rows={data.recentTickets ?? []} onOpen={openJobDrawer} />
      </section>
    </div>
  );
}

/*
 * RecentTickets — a sample tickets table (dummy data for now). Swap the
 * ROWS array for a real GET /jobs feed when we wire it up.
 */
function RecentTickets({ rows, onOpen }: { rows: Summary['recentTickets']; onOpen: (id: number) => void }) {
  const items = rows ?? [];
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  // Live-filter the loaded tickets by Job ID / ref / customer.
  const filtered = query
    ? items.filter((r) =>
        String(r.jobId).includes(query) ||
        (r.ref || '').toLowerCase().includes(query) ||
        (r.customer || '').toLowerCase().includes(query))
    : items;
  // Enter on a numeric id → open that job even if it isn't in the recent list.
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const n = Number(q.trim());
    if (Number.isFinite(n) && n > 0) onOpen(n);
  };

  // Map the real job_status code to a labelled, colour-coded pill.
  const pill = (s: number): { label: string; cls: string } => {
    if (s === 9) return { label: 'New Ticket', cls: 'bg-amber-50 text-amber-700' };
    if (s === 0 || s === 1) return { label: 'Pending Scheduling', cls: 'bg-blue-50 text-blue-700' };
    if (s === 2 || s === 20) return { label: 'In Progress', cls: 'bg-violet-50 text-violet-700' };
    if (s === 3 || s === 5) return { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700' };
    if (s === 6) return { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700' };
    if (s === 10) return { label: 'Under Audit', cls: 'bg-cyan-50 text-cyan-700' };
    if (s === 15) return { label: 'Awaiting Approval', cls: 'bg-amber-50 text-amber-700' };
    if (s === 21) return { label: 'On Hold', cls: 'bg-slate-100 text-slate-600' };
    return { label: 'Order', cls: 'bg-slate-100 text-slate-600' };
  };
  const fmt = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Recent Tickets</h3>
          <p className="text-xs text-slate-400">Your latest orders</p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            inputMode="numeric"
            placeholder="Search Job ID…"
            className="w-full sm:w-52 rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="text-center text-sm text-slate-400 py-8">
          {query
            ? <>No ticket here matches “{q.trim()}”. Press <b>Enter</b> to open Job #{q.trim()}.</>
            : 'No recent tickets.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
                <th className="text-left font-semibold px-5 py-2.5">Ticket</th>
                <th className="text-left font-semibold px-3 py-2.5">Customer</th>
                <th className="text-left font-semibold px-3 py-2.5">Technician</th>
                <th className="text-left font-semibold px-3 py-2.5">Status</th>
                <th className="text-left font-semibold px-3 py-2.5">Appointment</th>
                <th className="text-right font-semibold px-5 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const p = pill(r.status);
                return (
                  <tr key={r.jobId} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <button type="button" onClick={() => onOpen(r.jobId)} className="font-bold text-primary hover:underline">
                        #{r.jobId}
                      </button>
                      {r.ref && <div className="text-xs text-slate-400">{r.ref}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-700 truncate max-w-[200px]">{r.customer || '—'}</div>
                      <div className="text-xs text-slate-400">{r.city || '—'}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{r.tech || '—'}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold ${p.cls}`}>
                        {p.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-500">{fmt(r.when)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onOpen(r.jobId)}
                        className="text-xs font-bold text-primary border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-primary-50 transition"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/*
 * SlaAging — overdue active jobs bucketed by how many days late they
 * are. Reads /dashboard-summary → slaAging. Empty (all zero) shows a
 * reassuring "nothing overdue" state rather than an empty chart.
 */
function SlaAging({ aging }: { aging: Summary['slaAging'] }) {
  const rows = [
    { label: '0–1 day',  value: aging?.d01 ?? 0,    color: '#f59e0b' },
    { label: '2–3 days', value: aging?.d23 ?? 0,    color: '#ea8a1e' },
    { label: '4–7 days', value: aging?.d47 ?? 0,    color: '#e11d48' },
    { label: '7+ days',  value: aging?.d7plus ?? 0, color: '#9f1239' },
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700">SLA breaches by aging</h2>
        <span className="text-xs font-semibold text-slate-400">{total} overdue</span>
      </div>
      {total === 0 ? (
        <div className="text-center text-sm text-slate-400 py-10">
          Nothing overdue — every committed appointment is on track. 🎉
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-slate-600">{r.label}</span>
              <span className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${(r.value / max) * 100}%`, backgroundColor: r.color }}
                />
              </span>
              <span className="w-8 text-right font-bold text-slate-900 tabular-nums">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/*
 * AttentionCard — the "Needs attention" panel. Surfaces the things a
 * SPOC should act on today: invoices due, tickets aging 7+ days, and
 * orders at SLA-breach risk (4–7 days overdue). Each row links straight
 * to where the SPOC can act. All-clear shows a reassuring empty state.
 */
/*
 * SectionHead — a small red-accent eyebrow that labels each dashboard
 * band (Overview / Trends / Breakdown / Service health) so the page
 * scans as distinct, ordered sections.
 */
function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-1 h-4 rounded-full bg-primary" />
      <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-500">{children}</h2>
    </div>
  );
}

/*
 * HolidayCalendar — upcoming holidays (sample data for now; swap the
 * HOLIDAYS list for a real feed when we have one). Shows the next few
 * holidays from today, each with a date chip, name, weekday and tag.
 */
type Holiday = { date: string; name: string; holiday_type: string; description: string | null };

function HolidayCalendar() {
  const DAYS = 30;
  const { data, loading } = useFetchOnce<{ items: Holiday[] }>(`/holidays?days=${DAYS}`);
  const items = data?.items ?? [];

  const mon = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
  const dow = (d: Date) => d.toLocaleString('en-US', { weekday: 'long' });

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <CalendarDays className="w-5 h-5 text-slate-400" />
        <h3 className="text-base font-bold text-slate-800">Upcoming Events</h3>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="text-center py-10 text-sm text-slate-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-slate-600 font-semibold">No Upcoming Holidays</div>
            <div className="text-slate-400 text-sm mt-1">Within the next {DAYS} days</div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((h) => {
              const d = new Date(h.date);
              const national = String(h.holiday_type).toLowerCase() === 'national';
              return (
                <li key={h.date + h.name} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="w-11 h-11 shrink-0 rounded-xl text-white flex flex-col items-center justify-center leading-none"
                    style={{ background: national ? 'linear-gradient(140deg,#5e9bff,#4f46e5)' : 'linear-gradient(140deg,#fbbf24,#f97316)' }}>
                    <span className="text-base font-extrabold tabular-nums">{isNaN(d.getTime()) ? '—' : d.getDate()}</span>
                    <span className="text-[9px] font-bold uppercase">{isNaN(d.getTime()) ? '' : mon(d)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-800 truncate">{h.name}</div>
                    <div className="text-xs text-slate-400">{isNaN(d.getTime()) ? '' : dow(d)}</div>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${national ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                    {national ? 'National' : 'Restricted'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function AttentionCard({ attention }: { attention?: Summary['attention'] }) {
  const a = attention;
  type Tone = 'rose' | 'amber' | 'violet' | 'blue' | 'emerald';
  // Positive, action-oriented buckets only (no escalations / SLA / TAT).
  // All three always render so the panel stays stable day to day.
  const defs: Array<{
    key: string; count: number; tone: Tone;
    icon: React.ComponentType<{ className?: string }>;
    label: string; hint: string; href: string;
  }> = [
    { key: 'qc',   count: a?.qcDone ?? 0, tone: 'emerald', icon: CheckCircle2,
      label: 'QC done', hint: 'Ready to invoice', href: '/tickets/under-audit' },
    { key: 'est',  count: a?.estimatePending ?? 0, tone: 'amber',  icon: FileClock,
      label: 'Pending approval', hint: 'Approve to proceed', href: '/tickets/approvals' },
    { key: 'hold', count: a?.onHold ?? 0, tone: 'blue', icon: PauseCircle,
      label: 'Fulfilment on hold', hint: 'Items / parts pending', href: '/tickets/approvals' },
  ];
  const cards = defs;

  // Vivid gradient priority tiles — each tone is a bold gradient + a matching
  // soft glow, white text and a translucent icon chip.
  const tone: Record<Tone, { grad: string; glow: string }> = {
    amber:   { grad: 'linear-gradient(140deg,#fbbf24,#f97316)', glow: 'rgba(249,115,22,.45)' },
    rose:    { grad: 'linear-gradient(140deg,#ff7a59,#ef3b6e)', glow: 'rgba(239,59,110,.45)' },
    violet:  { grad: 'linear-gradient(140deg,#a855f7,#6d3bd0)', glow: 'rgba(124,58,237,.45)' },
    blue:    { grad: 'linear-gradient(140deg,#5e9bff,#4f46e5)', glow: 'rgba(79,70,229,.45)' },
    emerald: { grad: 'linear-gradient(140deg,#34d399,#10b981)', glow: 'rgba(16,185,129,.45)' },
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full bg-primary" />
        <h2 className="text-base font-extrabold text-slate-900">Needs your attention</h2>
      </div>

      {cards.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 text-center text-sm text-slate-400 py-8">
          You’re all caught up — nothing needs action right now. 🎉
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 flex-1">
          {cards.map((d) => {
            const t = tone[d.tone];
            const Icon = d.icon;
            return (
              <Link
                key={d.key}
                href={d.href}
                className="h-full min-h-[150px] flex flex-col justify-between rounded-2xl p-4 text-white transition hover:-translate-y-0.5"
                style={{ background: t.grad, boxShadow: `0 14px 30px -14px ${t.glow}` }}
              >
                <span className="w-10 h-10 rounded-xl grid place-items-center bg-white/25 text-white">
                  <Icon className="w-5 h-5" />
                </span>
                <div>
                  <div className="text-3xl font-extrabold leading-none tabular-nums">
                    {d.count.toLocaleString('en-IN')}
                  </div>
                  <div className="mt-1 text-[13px] font-extrabold">{d.label}</div>
                  <div className="text-[11px] mt-0.5 text-white/80">{d.hint}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Today's appointments + Yesterday's booked ──────────────────────
 *
 * Both read the existing team-scoped GET /api/client/jobs list:
 *   - Appointments: dateType=requested (the appointment column), today's
 *     date, then the OPEN rows only (excludes completed 3/5, cancelled
 *     6/7) — this mirrors the mobile app's Open-Orders "Today" tab.
 *   - Yesterday's booked: dateType=booked (created_date_time), yesterday's
 *     date, split into Open vs Completed, then bucketed by age and city.
 */
type DashJob = {
  job_id: number;
  client_ref_id: string | null;
  job_status: number;
  customer_name: string | null;
  city_name: string | null;
  requested_date_time: string | null;
  created_date_time: string | null;
  easyfixer_name: string | null;
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseDT = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
};
const fmtTime = (s?: string | null) => {
  const d = parseDT(s);
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
};
const ageDays = (s?: string | null) => {
  const d = parseDT(s);
  return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : null;
};

const STATUS_PILL: Record<number, string> = {
  0: 'bg-slate-100 text-slate-600', 1: 'bg-amber-50 text-amber-700',
  2: 'bg-violet-50 text-violet-700', 20: 'bg-violet-50 text-violet-700',
  9: 'bg-slate-100 text-slate-600', 15: 'bg-amber-50 text-amber-700',
  21: 'bg-blue-50 text-blue-700', 3: 'bg-emerald-50 text-emerald-700',
  5: 'bg-emerald-50 text-emerald-700', 6: 'bg-rose-50 text-rose-700',
  7: 'bg-rose-50 text-rose-700', 10: 'bg-red-50 text-red-700',
};
const statusPill = (s: number) => ({
  label: STATUS_LABELS[s] ?? `#${s}`,
  cls: STATUS_PILL[s] ?? 'bg-slate-100 text-slate-600',
});

const TERMINAL = [3, 5, 6, 7];

function TodaysAppointments() {
  const today = ymd(new Date());
  const q = `/jobs?dateType=requested&startDate=${today}&endDate=${encodeURIComponent(today + ' 23:59:59')}&limit=500`;
  const { data, loading } = useFetchOnce<{ items: DashJob[] }>(q);
  const rows = (data?.items ?? [])
    .filter((j) => !TERMINAL.includes(j.job_status ?? -1))
    .sort((a, b) => (a.requested_date_time || '').localeCompare(b.requested_date_time || ''));

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-primary" />
          <h3 className="text-base font-bold text-slate-800">Today&apos;s appointments</h3>
        </div>
        {!loading && rows.length > 0 && (
          <span className="text-xs font-bold text-slate-500 bg-slate-100 rounded-full px-2.5 py-1 tabular-nums">{rows.length}</span>
        )}
      </div>
      <div className="p-3 flex-1">
        {loading ? (
          <div className="text-center py-10 text-sm text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-slate-600 font-bold">No appointments today</div>
            <div className="text-slate-400 text-sm mt-1">Nothing scheduled for today.</div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-[440px] overflow-y-auto">
            {rows.map((j) => {
              const st = statusPill(j.job_status);
              return (
                <li key={j.job_id}>
                  <button
                    type="button"
                    onClick={() => openJobDrawer(j.job_id)}
                    className="w-full text-left flex items-center gap-3 px-2 py-3 rounded-xl hover:bg-slate-50 transition"
                  >
                    <span className="w-11 h-11 shrink-0 rounded-xl bg-primary/10 text-primary grid place-items-center">
                      <Clock className="w-5 h-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800 truncate">{j.customer_name || 'Customer'}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="text-xs text-slate-500 truncate mt-0.5 flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />{j.city_name || '—'}
                        {j.easyfixer_name && <><span className="text-slate-300">·</span><span className="truncate">{j.easyfixer_name}</span></>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold text-slate-800 tabular-nums">{fmtTime(j.requested_date_time)}</div>
                      <div className="text-[11px] text-slate-400">#{j.job_id}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function YesterdaysBooked() {
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  const yday = ymd(yd);
  const q = `/jobs?dateType=booked&startDate=${yday}&endDate=${encodeURIComponent(yday + ' 23:59:59')}&limit=500`;
  const { data, loading } = useFetchOnce<{ items: DashJob[] }>(q);
  const rows = data?.items ?? [];

  const completed = rows.filter((j) => [3, 5].includes(j.job_status ?? -1));
  const open = rows.filter((j) => !TERMINAL.includes(j.job_status ?? -1));

  const age: Record<'0-2' | '3-5' | '>6', number> = { '0-2': 0, '3-5': 0, '>6': 0 };
  rows.forEach((j) => {
    const a = ageDays(j.created_date_time);
    if (a == null) return;
    age[a <= 2 ? '0-2' : a <= 5 ? '3-5' : '>6'] += 1;
  });

  const cityMap = new Map<string, number>();
  rows.forEach((j) => { const c = (j.city_name || '').trim(); if (c) cityMap.set(c, (cityMap.get(c) || 0) + 1); });
  const cities = [...cityMap.entries()].map(([city, n]) => ({ city, n })).sort((a, b) => b.n - a.n).slice(0, 5);
  const cityMax = cities.length ? cities[0].n : 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Sun className="w-5 h-5 text-amber-500" />
          <div>
            <h3 className="text-base font-bold text-slate-800">Yesterday&apos;s booked</h3>
            <p className="text-[11px] text-slate-400">{yday}</p>
          </div>
        </div>
        {!loading && rows.length > 0 && (
          <span className="text-xs font-bold text-slate-500 bg-slate-100 rounded-full px-2.5 py-1 tabular-nums">{rows.length}</span>
        )}
      </div>
      <div className="p-5 flex-1">
        {loading ? (
          <div className="text-center py-10 text-sm text-slate-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center py-12">
            <div className="text-slate-600 font-bold text-lg">No orders</div>
            <div className="text-slate-400 text-sm mt-1">Nothing was booked yesterday.</div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(140deg,#5e9bff,#4f46e5)' }}>
                <div className="text-white/80 text-xs font-bold uppercase tracking-wide">Open</div>
                <div className="text-white text-3xl font-extrabold tabular-nums mt-1">{open.length}</div>
              </div>
              <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(140deg,#34d399,#10b981)' }}>
                <div className="text-white/80 text-xs font-bold uppercase tracking-wide">Completed</div>
                <div className="text-white text-3xl font-extrabold tabular-nums mt-1">{completed.length}</div>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">By age (days)</div>
              <div className="grid grid-cols-3 gap-2">
                {(['0-2', '3-5', '>6'] as const).map((k) => (
                  <div key={k} className="rounded-xl bg-slate-50 ring-1 ring-slate-100 p-3 text-center">
                    <div className="text-xl font-extrabold text-slate-800 tabular-nums">{age[k]}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{k}</div>
                  </div>
                ))}
              </div>
            </div>

            {cities.length > 0 && (
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">By city</div>
                <ul className="space-y-2">
                  {cities.map((c) => (
                    <li key={c.city} className="flex items-center gap-3">
                      <span className="text-sm text-slate-700 w-28 truncate shrink-0">{c.city}</span>
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${cityMax ? Math.max(8, (c.n / cityMax) * 100) : 0}%`, background: 'linear-gradient(90deg,#5e9bff,#4f46e5)' }} />
                      </div>
                      <span className="text-sm font-bold text-slate-500 tabular-nums w-6 text-right">{c.n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * OrdersTrend — created / completed / cancelled trend per day.
 *
 * Ported 1:1 from the mobile client app: aggregates the loaded orders window
 * CLIENT-SIDE via buildTrend() (src/lib/analytics.ts). The window ends on the
 * most recent order date present in the data (so it's never empty when data
 * lags), and each day counts Created (all), Completed (status 3/5) and
 * Cancelled (status 6/7) by ticket-created day. Own 7D/30D toggle.
 */
function OrdersTrend({ jobs, loading }: { jobs: AnalyticsJob[]; loading: boolean }) {
  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const days = range === '7d' ? 7 : 30;
  const trend = useMemo(() => buildTrend(jobs, days), [jobs, days]);
  const inr = (n: number) => n.toLocaleString('en-IN');

  const W = 520, H = 150, padL = 8, padR = 8, padT = 10, padB = 8;
  const n = Math.max(1, trend.days.length - 1);
  const max = Math.max(1, ...trend.days.flatMap((d) => [d.created, d.completed, d.inProgress, d.cancelled])) * 1.1;
  const x = (i: number) => padL + i * ((W - padL - padR) / n);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = (key: 'created' | 'completed' | 'inProgress' | 'cancelled') =>
    trend.days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const area = (key: 'created' | 'completed') =>
    trend.days.length
      ? `M${x(0)},${y(0)} ` + trend.days.map((d, i) => `L${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ') + ` L${x(trend.days.length - 1)},${y(0)} Z`
      : '';

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-700 inline-flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-primary" /> Orders trend
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Last {days} days · {trend.rangeLabel}</p>
        </div>
        <div className="inline-flex bg-slate-100 border border-slate-200 rounded-lg p-1">
          {(['7d', '30d'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-md text-xs font-bold transition ${range === r ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {r === '7d' ? '7D' : '30D'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-12">Loading orders…</div>
      ) : trend.createdTotal === 0 ? (
        <div className="text-center text-sm text-slate-400 py-12">No orders in the last {days} days.</div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-3" preserveAspectRatio="none">
            <defs>
              <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#6366f1" stopOpacity="0.35" />
                <stop offset="1" stopColor="#6366f1" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="trendLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#4f46e5" />
                <stop offset="1" stopColor="#a855f7" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} stroke="#f1f5f9" strokeWidth={1} />
            ))}
            <path d={area('created')} fill="url(#trendArea)" />
            <path d={line('completed')} fill="none" stroke="#12b886" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <path d={line('inProgress')} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <path d={line('cancelled')} fill="none" stroke="#ef4444" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            <path d={line('created')} fill="none" stroke="url(#trendLine)" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            {trend.days.map((d, i) => (
              <span key={i}>{i % (days <= 7 ? 1 : 5) === 0 || i === trend.days.length - 1 ? d.day : ''}</span>
            ))}
          </div>

          {/* Stat row — Created / Completed·% / Cancelled totals (matches app). */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
            <div className="bg-slate-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#2a78d6' }} />Created
              </div>
              <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{inr(trend.createdTotal)}</div>
            </div>
            <div className="bg-slate-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#1baf7a' }} />Completed
              </div>
              <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{inr(trend.completedTotal)}</div>
            </div>
            <div className="bg-slate-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#f59e0b' }} />In Progress
              </div>
              <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{inr(trend.inProgressTotal)}</div>
            </div>
            <div className="bg-slate-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#e34948' }} />Cancelled
              </div>
              <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{inr(trend.cancelledTotal)}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/*
 * CompletionCard — compact ring showing what share of orders are done,
 * plus a small legend. Sits beside the Orders trend. Uses the counts
 * already in the summary payload (no extra fetch).
 */
function CompletionCard({ counts }: { counts: Summary['counts'] }) {
  const total = counts.completed + counts.inProgress + counts.newTickets + counts.cancelled;
  const rate = total ? Math.round((counts.completed / total) * 100) : 0;
  const r = 46;
  const C = 2 * Math.PI * r;
  // Muted, earthy status palette (calm — matches the reference).
  const rows = [
    { label: 'Completed',   value: counts.completed,  color: '#3f7d5c' },
    { label: 'In progress', value: counts.inProgress, color: '#e0954a' },
    { label: 'New',         value: counts.newTickets, color: '#e6c96a' },
    { label: 'Cancelled',   value: counts.cancelled,  color: '#d76a60' },
  ];
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  // Build the segmented ring: each status is an arc proportional to its
  // share of total, laid clockwise from 12 o'clock with a small gap
  // between segments (rounded caps give the clean separated look).
  const GAP = 4; // dash units of whitespace between segments
  let acc = 0;
  const segments = rows
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = s.value / total;
      const len = Math.max(frac * C - GAP, 0.001);
      const seg = { color: s.color, len, offset: -acc * C };
      acc += frac;
      return seg;
    });

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-5">
      <h2 className="text-base font-bold text-slate-900">Completion rate</h2>
      <p className="text-xs text-slate-400 mt-0.5">Order status breakdown</p>

      <div className="mt-4 flex items-center gap-6">
        <div className="relative w-32 h-32 shrink-0">
          <svg viewBox="0 0 110 110" className="w-32 h-32 -rotate-90">
            {/* faint track (visible only if statuses don't fill the ring) */}
            <circle cx="55" cy="55" r={r} fill="none" stroke="#eef1ee" strokeWidth="11" />
            {segments.map((seg, i) => (
              <circle
                key={i}
                cx="55" cy="55" r={r} fill="none"
                stroke={seg.color} strokeWidth="11" strokeLinecap="round"
                strokeDasharray={`${seg.len} ${C - seg.len}`}
                strokeDashoffset={seg.offset}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-extrabold text-slate-900 leading-none">{rate}%</span>
            <span className="text-xs text-slate-400 mt-1.5">complete</span>
          </div>
        </div>

        <ul className="flex-1 space-y-3.5 text-sm">
          {rows.map((r2) => (
            <li key={r2.label} className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r2.color }} />
              <span className="flex-1 text-slate-600">{r2.label}</span>
              <b className="tabular-nums text-slate-900 font-bold">{pct(r2.value)}%</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/*
 * CityPerformance — "Where the work is": top 10 cities by order count over
 * the chosen window, as ranked horizontal bars.
 *
 * Ported 1:1 from the mobile client app (InsightsSections.tsx → topCities):
 * count city_name over jobsInWindow(jobs, days), sort desc, take top 10.
 * Own 7D/30D toggle.
 */
const CITY_COLORS = [
  'linear-gradient(140deg,#5e9bff,#4f46e5)',
  'linear-gradient(140deg,#a855f7,#6d3bd0)',
  'linear-gradient(140deg,#22d3ee,#0e9488)',
  'linear-gradient(140deg,#fbbf24,#f97316)',
  'linear-gradient(140deg,#34d399,#10b981)',
  'linear-gradient(140deg,#ff7a59,#ef3b6e)',
  'linear-gradient(140deg,#94a3b8,#64748b)',
];

function CityPerformance({ jobs, loading }: { jobs: AnalyticsJob[]; loading: boolean }) {
  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const days = range === '7d' ? 7 : 30;
  const cities = useMemo(() => topCities(jobs, days), [jobs, days]);
  const cityMax = cities.length ? cities[0].orders : 0;
  const inr = (n: number) => n.toLocaleString('en-IN');

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-700">Top Performance</h2>
          <p className="text-xs text-slate-400 mt-0.5">Most orders by city · last {days} days</p>
        </div>
        <div className="inline-flex bg-slate-100 border border-slate-200 rounded-lg p-1 shrink-0">
          {(['7d', '30d'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded-md text-xs font-bold transition ${range === r ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {r === '7d' ? '7D' : '30D'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading orders…</div>
      ) : cities.length === 0 ? (
        <div className="text-center text-sm text-slate-400 py-10">No city data yet.</div>
      ) : (
        <ul className="mt-4 space-y-3">
          {cities.map((ct, i) => (
            <li key={ct.city} className="flex items-center gap-3">
              <span className="w-6 h-6 shrink-0 rounded-lg grid place-items-center text-[11px] font-extrabold text-white tabular-nums"
                style={{ background: CITY_COLORS[i % CITY_COLORS.length] }}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800 truncate">{ct.city}</span>
                  <span className="text-sm font-bold text-slate-500 tabular-nums">{inr(ct.orders)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${cityMax ? Math.max(6, (ct.orders / cityMax) * 100) : 0}%`,
                      background: CITY_COLORS[i % CITY_COLORS.length],
                    }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Components ───────────────────────────────────────────────── */

/*
 * KPICard — a single headline number with a coloured icon. Click-
 * through link when supplied so the SPOC can jump from a KPI into
 * the matching filtered list (e.g. New Tickets → /tickets/new).
 */
function KPICard({
  label, value, icon: Icon, tone, href,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'amber' | 'violet' | 'emerald' | 'rose' | 'orange';
  href?: string;
}) {
  const toneClass = {
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   ring: 'ring-amber-200' },
    violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  ring: 'ring-violet-200' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
    rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-200' },
    orange:  { bg: 'bg-orange-50',  text: 'text-orange-700',  ring: 'ring-orange-200' },
  }[tone];

  const body = (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4 hover:shadow-md hover:ring-slate-300 transition">
      <div className="flex items-center justify-between">
        <span className={`w-10 h-10 rounded-xl grid place-items-center ${toneClass.bg} ${toneClass.text} ring-1 ${toneClass.ring}`}>
          <Icon className="w-5 h-5" />
        </span>
        {href && (
          <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition" />
        )}
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-900 leading-none">
        {value.toLocaleString('en-IN')}
      </div>
      <div className="mt-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">
        {label}
      </div>
    </div>
  );

  return href
    ? <Link href={href} className="group block focus:outline-none focus:ring-2 focus:ring-primary rounded-2xl">{body}</Link>
    : body;
}

/*
 * StatusDonut — inline SVG donut chart for the status breakdown.
 *
 * Math: each slice is an SVG `<circle>` with its `stroke-dasharray`
 * set so it draws exactly its share of the circumference. We rotate
 * each circle by the cumulative offset so the slices line up around
 * a single ring. Zero external deps, ~30 lines of code, fully
 * responsive (the SVG scales with the container).
 */
function CategoryBreakdown({
  items: breakdown,
}: {
  items: Array<{ label: string; count: number; color: string }>;
}) {
  const total = breakdown.reduce((sum, s) => sum + s.count, 0);

  // Empty state — no jobs at all (e.g. brand-new SPOC).
  if (total === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6">
        <h2 className="text-sm font-bold text-slate-700 mb-3">Category &amp; work type</h2>
        <div className="text-center text-sm text-slate-400 py-12">
          No orders yet to chart.
        </div>
      </div>
    );
  }

  // SVG geometry. r = inner radius of the ring; we use a thick stroke
  // (16) on a circle of radius 60 → outer diameter ~152px in the
  // viewBox, with comfy padding inside a 160×160 box.
  const r = 60;
  const C = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6">
      <h2 className="text-sm font-bold text-slate-700 mb-4">Category &amp; work type</h2>
      <div className="grid grid-cols-2 gap-4 items-center">
        <div className="flex items-center justify-center">
          <svg viewBox="0 0 160 160" className="w-44 h-44 -rotate-90">
            <circle cx="80" cy="80" r={r} fill="none" stroke="#f1f5f9" strokeWidth="16" />
            {breakdown.map((s, i) => {
              const fraction = s.count / total;
              const dash = fraction * C;
              const offset = -cumulative * C;
              cumulative += fraction;
              return (
                <circle
                  key={i}
                  cx="80" cy="80" r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="16"
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={offset}
                />
              );
            })}
            {/* Centre label — counter-rotated so it reads upright
                despite the parent -rotate-90. */}
            <g transform="rotate(90 80 80)">
              <text x="80" y="76" textAnchor="middle" fontWeight="700" fontSize="22" fill="#1e293b">
                {total.toLocaleString('en-IN')}
              </text>
              <text x="80" y="94" textAnchor="middle" fontSize="10" fill="#94a3b8" letterSpacing="0.05em">
                TOTAL ORDERS
              </text>
            </g>
          </svg>
        </div>
        <ul className="space-y-1.5">
          {breakdown.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-xs">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-slate-700 flex-1 truncate">{s.label}</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {s.count.toLocaleString('en-IN')}
              </span>
              <span className="text-slate-400 tabular-nums w-9 text-right">
                {Math.round((s.count / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/*
 * EscalationsList — top-5 most-recent escalated jobs the SPOC should
 * look at. Each row links into the job-detail page so the SPOC can
 * read the comments and act. Designed to be scannable: customer
 * name + job id + a 1-line comment excerpt.
 */
function EscalationsList({
  items,
}: {
  items: Summary['recentEscalations'];
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200">
      <div className="px-5 pt-5 pb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700 inline-flex items-center gap-1.5">
          <BellRing className="w-4 h-4 text-rose-500" />
          Recent escalations
        </h2>
        <Link
          href="/tickets/escalated"
          className="text-xs font-semibold text-primary hover:text-primary-dark inline-flex items-center gap-0.5"
        >
          View all <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="px-5 pb-6 text-center text-sm text-slate-400 py-10">
          No active escalations. Nothing needs your attention right now.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((j) => (
            <li key={j.job_id}>
              <Link
                href={`/jobs/${j.job_id}`}
                className="flex items-start gap-3 px-5 py-3 hover:bg-rose-50/40 transition"
              >
                <span className="w-9 h-9 rounded-full bg-rose-100 grid place-items-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-slate-900 truncate">
                      {j.customer_name || 'Customer'}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      #{j.job_id}
                      {j.client_ref_id ? ` · ${j.client_ref_id}` : ''}
                    </span>
                  </div>
                  {j.review_comment && (
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                      “{j.review_comment}”
                    </p>
                  )}
                  {j.easyfixer_name && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Technician: {j.easyfixer_name}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
