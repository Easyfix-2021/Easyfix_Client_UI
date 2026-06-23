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

import Link from 'next/link';
import { useFetchOnce } from '@/lib/hooks';
import { useSpoc } from '@/lib/spoc-context';
import {
  Loader2, BellRing, ArrowUpRight, Plus,
  TicketIcon, Clock, AlarmClock, CheckCircle2, XCircle, AlertTriangle,
  Users as UsersIcon,
} from 'lucide-react';

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
  teamSize: number;
};

export default function SummaryDashboardPage() {
  const spoc = useSpoc();
  const { data, loading, error } = useFetchOnce<Summary>('/dashboard-summary');

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {greetingName ? `Welcome back, ${greetingName}` : 'Welcome back'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5 inline-flex items-center gap-1.5">
            <UsersIcon className="w-3.5 h-3.5" />
            Across {data.teamSize} {data.teamSize === 1 ? 'account' : 'accounts'} in your team
          </p>
        </div>
        <Link
          href="/jobs/new"
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:opacity-90 inline-flex items-center gap-1.5 transition shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Order
        </Link>
      </div>

      {/* ─── KPI cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KPICard
          label="New Tickets"
          value={data.boxes.newTickets}
          icon={TicketIcon}
          tone="amber"
          href="/tickets/new"
        />
        <KPICard
          label="Waiting for Allocation"
          value={data.boxes.waitingForAllocation}
          icon={Clock}
          tone="violet"
          href="/appointments"
        />
        <KPICard
          label="Running Late"
          value={data.boxes.runningLate}
          icon={AlarmClock}
          tone="orange"
          href="/appointments"
        />
        <KPICard
          label="Estimate Approved"
          value={data.boxes.estimateApproved}
          icon={CheckCircle2}
          tone="emerald"
          href="/tickets/under-audit"
        />
        <KPICard
          label="Estimate Rejected"
          value={data.boxes.estimateRejected}
          icon={XCircle}
          tone="rose"
          href="/tickets/under-audit"
        />
      </div>

      {/* ─── Status donut + Escalations ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StatusDonut breakdown={data.statusBreakdown} />
        <EscalationsList items={data.recentEscalations} />
      </div>
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
function StatusDonut({
  breakdown,
}: {
  breakdown: Array<{ label: string; count: number; color: string }>;
}) {
  const total = breakdown.reduce((sum, s) => sum + s.count, 0);

  // Empty state — no jobs at all (e.g. brand-new SPOC).
  if (total === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6">
        <h2 className="text-sm font-bold text-slate-700 mb-3">Status breakdown</h2>
        <div className="text-center text-sm text-slate-400 py-12">
          No jobs yet to chart.
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
      <h2 className="text-sm font-bold text-slate-700 mb-4">Status breakdown</h2>
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
                TOTAL JOBS
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
