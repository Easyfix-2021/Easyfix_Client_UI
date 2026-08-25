'use client';

/*
 * My New Tickets — three-tab page mirroring the legacy
 * Angular_ClientDashboard component `MyNewTicketsComponent`.
 *
 *   Tab 1 — Un-Authorized  → ticketFlag=unauthorized
 *           Pending tickets that need manager approval. Manager-role
 *           SPOCs see an "Authorize" button per row that fires the
 *           existing PATCH /jobs/:id/approve endpoint.
 *
 *   Tab 2 — New Tickets    → ticketFlag=authorized
 *           Already-approved (or preapproved) tickets awaiting EasyFix
 *           confirmation.
 *
 *   Tab 3 — No Response    → ticketFlag=noResponse
 *           Tickets stuck on "call later" (customer unreachable).
 *
 * All three tabs internally pin status=9 on the backend — the tab is the
 * filter. Bucket multi-select is intentionally hidden here (would be a
 * no-op against the fixed status). Date / City / Team filters are
 * available because the legacy page exposed them too.
 *
 * Backend contract (parity with ACD_APIs JobFilterServiceImpl#getPredicates):
 *   GET /api/client/jobs?ticketFlag=unauthorized|authorized|noResponse
 *                       [&cityIds=][&ownerIds=][&startDate=][&endDate=]
 *                       [&dateType=created][&q=][&limit=][&offset=]
 *   PATCH /api/client/jobs/:id/approve   — authorizes (flips approved_by_client=1)
 */
import Link from 'next/link';
import { openJobDrawer } from '@/components/job-drawer';
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Upload, Search, ChevronLeft, ChevronRight,
  Filter, X, AlertTriangle, Check, ShieldCheck, Phone, Eye,
} from 'lucide-react';
import { useFetch, useFetchOnce, useDebouncedValue } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import { useSpoc } from '@/lib/spoc-context';
import { cn } from '@/lib/utils';
import { MultiSelect, type MultiSelectOption } from '@/components/multi-select';
import { formatIstDayDate } from '@/lib/format';

type Job = {
  job_id: number;
  job_reference_id: string | null;
  client_ref_id: string | null;
  job_status: number;
  customer_name: string | null;
  customer_mob_no: string | null;
  city_name: string | null;
  ticket_created_date_time: string | null;
  requested_date_time: string | null;
  source_type: string | null;
  approved_by_client: number | null;       // 0 = pending, 1 = approved, 2 = preapproved, NULL = preapproved
  approved_by_client_contact: number | null;
  call_later: number | null;               // 1 → No Response
  is_escalated?: boolean | number | null;
};

type TabKey = 'unauthorized' | 'authorized' | 'noResponse';
const TABS: Array<{ key: TabKey; label: string; subtitle: string }> = [
  {
    key: 'unauthorized',
    label: 'Un-Authorized',
    subtitle: 'These orders are pending approval from a manager to confirm the booking.',
  },
  {
    key: 'authorized',
    label: 'New Tickets',
    subtitle: 'Approved / preapproved tickets currently awaiting EasyFix confirmation.',
  },
  {
    key: 'noResponse',
    label: 'No Response',
    subtitle: 'Tickets paused because the customer was unreachable for confirmation.',
  },
];

const PAGE_SIZE_OPTIONS = [5, 10, 15, 20];

// Authorization status badge — mirrors the legacy template's nested
// *ngIf ladder (Authorize button → Pending → Authorized + name →
// Preapproved). Returns a JSX node plus an optional click handler the
// row uses to expose the "Authorize" button.
function AuthCellContent({ job, onAuthorize }: {
  job: Job;
  onAuthorize: (id: number) => void;
}) {
  const approved = job.approved_by_client;

  // 0 → not yet authorized. Show the "Authorize" CTA. Whether the
  // logged-in SPOC actually has manager rights is enforced server-side
  // (the endpoint already scopes to the SPOC's own client_id) — so we
  // always render the button on this tab.
  if (approved === 0) {
    return (
      <button
        type="button"
        onClick={() => onAuthorize(job.job_id)}
        className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-white text-xs font-semibold hover:bg-primary-dark transition shadow-sm"
      >
        <ShieldCheck className="w-3.5 h-3.5" /> Authorize
      </button>
    );
  }

  // 1 → manager approved → show "Authorized" badge.
  if (approved === 1) {
    return (
      <div className="inline-flex flex-col items-start gap-0.5">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-success-tint text-success-text ring-1 ring-success/30 text-xs font-semibold">
          <Check className="w-3 h-3" /> Authorized
        </span>
      </div>
    );
  }

  // 2 → preapproved (client-level setting), NULL → no approval required.
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-ink-100 text-ink-700 ring-1 ring-ink-100 text-xs font-semibold">
      <Check className="w-3 h-3" /> Preapproved
    </span>
  );
}

// ─── Filter state ────────────────────────────────────────────────────
type FilterState = {
  startDate: string;
  endDate: string;
  cityIds: number[];
  ownerIds: number[];
};
const EMPTY_FILTERS: FilterState = { startDate: '', endDate: '', cityIds: [], ownerIds: [] };

function filtersDiffer(a: FilterState, b: FilterState) {
  if (a.startDate !== b.startDate || a.endDate !== b.endDate) return true;
  if (a.cityIds.length !== b.cityIds.length || a.ownerIds.length !== b.ownerIds.length) return true;
  if (a.cityIds.some((id, i) => id !== b.cityIds[i])) return true;
  if (a.ownerIds.some((id, i) => id !== b.ownerIds[i])) return true;
  return false;
}

export default function MyNewTicketsPage() {
  const spoc = useSpoc();
  const [tab, setTab] = useState<TabKey>('unauthorized');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [staged, setStaged] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  // Per-row authorize action lives outside the staged-filter machinery —
  // a successful PATCH must trigger a refetch so the row leaves the
  // Un-Authorized tab. We bump a counter; useFetch's path memo embeds
  // it as an unused param so React re-fetches without changing semantics.
  const [refreshTick, setRefreshTick] = useState(0);
  const [authorizingId, setAuthorizingId] = useState<number | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [tab, debouncedQ, pageSize, applied]);

  const currentTab = useMemo(() => TABS.find((t) => t.key === tab) ?? TABS[0], [tab]);

  const cityLookup = useFetchOnce<{ items: { id: number; name: string }[] }>('/lookup/cities');
  const teamLookup = useFetchOnce<{ items: { id: number; name: string }[] }>('/team/members');

  // Tab counts — single round-trip endpoint returning all three at once.
  // Path is keyed by the current filters + the refreshTick so any
  // authorize/reset/apply re-fetches without us writing extra glue.
  const countsPath = useMemo(() => {
    const p = new URLSearchParams();
    // Same legacy-parity field as the list call — backend ignores it
    // (uses JWT spoc.id) but it appears in the network tab.
    p.set('clientSpocId', String(spoc.id));
    if (debouncedQ.trim()) p.set('q', debouncedQ.trim());
    if (applied.startDate)        p.set('startDate', applied.startDate);
    if (applied.endDate)          p.set('endDate',   applied.endDate);
    if (applied.cityIds.length)   p.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length)  p.set('ownerIds',  applied.ownerIds.join(','));
    if (refreshTick) p.set('_r', String(refreshTick));
    return `/tickets/counts?${p}`;
  }, [applied, debouncedQ, refreshTick, spoc.id]);

  const countsRes = useFetch<{ unauthorized: number; authorized: number; noResponse: number }>(countsPath);
  const counts = countsRes.data ?? { unauthorized: 0, authorized: 0, noResponse: 0 };

  const cityOptions: MultiSelectOption<number>[] = useMemo(
    () => (cityLookup.data?.items ?? []).map((c) => ({ value: c.id, label: c.name || `City #${c.id}` })),
    [cityLookup.data]
  );
  const teamOptions: MultiSelectOption<number>[] = useMemo(
    () => (teamLookup.data?.items ?? []).map((u) => ({ value: u.id, label: u.name || `User #${u.id}` })),
    [teamLookup.data]
  );

  const fetchPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set('ticketFlag', tab);
    // Legacy parity — clientSpocId: the Angular client always
    // overwrote this field with the logged-in user's contact id (see
    // legacy job-status.service.ts:43-45). We mirror that here so the
    // network call is 1:1 with the legacy payload.
    //
    // SECURITY NOTE: the backend IGNORES this value and uses
    // req.spoc.id from the JWT. The query param is for debugging
    // transparency only — a malicious caller can't impersonate a
    // different SPOC by changing it.
    params.set('clientSpocId', String(spoc.id));
    // Legacy parity: the Angular client always sent `status: [9]` in
    // the body alongside `flag`. The backend already pins status=9
    // inside the ticketFlag branch, but mirroring it in the URL keeps
    // the network request 1:1 with legacy for debugging — and is a
    // harmless extra clause if the backend logic ever drifts.
    //
    // noResponse intentionally omits the status pin — legacy doesn't
    // pin status on that flag (a "call later" job can be in any status).
    if (tab !== 'noResponse') params.set('statuses', '9');
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
    if (applied.startDate)        params.set('startDate', applied.startDate);
    if (applied.endDate)          params.set('endDate',   applied.endDate);
    if (applied.cityIds.length)   params.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length)  params.set('ownerIds',  applied.ownerIds.join(','));
    params.set('dateType', 'created');
    params.set('limit',  String(pageSize));
    params.set('offset', String((page - 1) * pageSize));
    // refresh tick — opaque to the backend but changes the URL identity
    // so useFetch refires after an authorize action without us re-deriving
    // any other state.
    if (refreshTick) params.set('_r', String(refreshTick));
    return `/jobs?${params}`;
  }, [tab, applied, debouncedQ, pageSize, page, refreshTick, spoc.id]);

  const { data, error, loading } = useFetch<{ items: Job[]; total: number }>(fetchPath);
  const items = data?.items ?? [];
  const total = data?.total ?? items.length;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = Math.min(page * pageSize, total);

  const hasStagedChanges = filtersDiffer(staged, applied);
  const hasAnyApplied =
    applied.startDate || applied.endDate ||
    applied.cityIds.length || applied.ownerIds.length;

  function applyFilters() { setApplied(staged); }
  function resetFilters() {
    setStaged(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setQ('');
  }

  async function authorize(jobId: number) {
    setAuthError(null);
    setAuthorizingId(jobId);
    try {
      await api.patch(`/jobs/${jobId}/approve`, {});
      // Refetch — the row should now disappear from the Un-Authorized tab
      // and appear in New Tickets (approved_by_client flipped 0 → 1).
      setRefreshTick((n) => n + 1);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Authorize failed';
      setAuthError(msg);
    } finally {
      setAuthorizingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Title + action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">My New Tickets</h1>
          <p className="text-sm text-ink-500">{currentTab.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/jobs/upload" className="btn-outline" title="Bulk-upload orders via .xlsx">
            <Upload className="w-4 h-4" /> Bulk Upload
          </Link>
          <Link href="/jobs/new" className="btn-primary" title="Raise a new technician booking">
            <Plus className="w-4 h-4" /> New Orders
          </Link>
        </div>
      </div>

      {/* Tabs — counts refresh on filter change + after each authorize. */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const isActive = tab === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-semibold transition border inline-flex items-center gap-2',
                isActive
                  ? 'bg-primary text-white border-primary shadow-md shadow-primary/30'
                  : 'bg-surface text-ink-700 border-ink-100 hover:bg-ink-50'
              )}
            >
              {t.key === 'noResponse' && <Phone className="w-3.5 h-3.5" />}
              <span>{t.label}</span>
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded-full text-xs font-semibold',
                  isActive
                    ? 'bg-white/25 text-white'
                    : 'bg-primary/10 text-primary'
                )}
              >
                {countsRes.loading && countsRes.data == null ? '…' : count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter bar — same shape as /dashboard, minus the bucket picker
          (status is fixed to 9 by the active tab). */}
      <div className="card p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
            <input
              className="input pl-9"
              placeholder="Search by Job ID, Ref ID, customer or mobile…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="input max-w-[140px]"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} per page</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-ink-500 mb-1">Ticket Created — From</label>
            <input
              type="date"
              className="input"
              value={staged.startDate}
              max={staged.endDate || undefined}
              onChange={(e) => setStaged((s) => ({ ...s, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-500 mb-1">Ticket Created — To</label>
            <input
              type="date"
              className="input"
              value={staged.endDate}
              min={staged.startDate || undefined}
              onChange={(e) => setStaged((s) => ({ ...s, endDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-500 mb-1">City</label>
            <MultiSelect
              label="All Cities"
              options={cityOptions}
              value={staged.cityIds}
              onChange={(v) => setStaged((s) => ({ ...s, cityIds: v }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-500 mb-1">Client Team</label>
            <MultiSelect
              label="All Members"
              options={teamOptions}
              value={staged.ownerIds}
              onChange={(v) => setStaged((s) => ({ ...s, ownerIds: v }))}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-ink-500">
            {hasAnyApplied ? (
              <span className="inline-flex items-center gap-1 text-primary font-medium">
                <Filter className="w-3.5 h-3.5" /> Filters active
              </span>
            ) : (
              <span>No filters applied</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="btn-outline"
              disabled={!hasAnyApplied && !hasStagedChanges && !q}
            >
              <X className="w-4 h-4" /> Reset
            </button>
            <button
              type="button"
              onClick={applyFilters}
              className="btn-primary"
              disabled={!hasStagedChanges}
            >
              <Filter className="w-4 h-4" /> Apply Filter
            </button>
          </div>
        </div>
      </div>

      {(error || authError) && (
        <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {authError || error}
        </div>
      )}

      {/* Table — column set mirrors the legacy my-new-tickets.component.html
          (Job ID / Client Ref / Ticket Created / Requested / City / Source /
          Authorization / Action). */}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Client Ref ID</th>
              <th>Ticket Created</th>
              <th>Requested</th>
              <th>City</th>
              <th>Customer</th>
              <th>Source</th>
              <th>Authorization</th>
              <th className="w-16">View</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="text-center text-ink-500 py-8">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={9} className="text-center text-ink-500 py-8">No tickets found.</td></tr>
            )}
            {!loading && items.map((j) => (
              <tr key={j.job_id} className="hover:bg-primary-50/50">
                <td>
                  <button
                    type="button"
                    onClick={() => openJobDrawer(j.job_id)}
                    className="text-primary hover:underline font-semibold inline-flex items-center gap-1"
                  >
                    #{j.job_id}
                    {j.is_escalated ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-danger" aria-label="Escalated" />
                    ) : null}
                  </button>
                </td>
                <td className="text-xs font-mono">{j.client_ref_id || '—'}</td>
                <td className="text-xs">{formatIstDayDate(j.ticket_created_date_time)}</td>
                <td className="text-xs">{formatIstDayDate(j.requested_date_time)}</td>
                <td>{j.city_name || '—'}</td>
                <td>
                  <div className="text-ink-900">{j.customer_name || '—'}</div>
                </td>
                <td className="text-xs">{j.source_type || '—'}</td>
                <td>
                  {authorizingId === j.job_id ? (
                    <span className="text-xs text-ink-500">Authorizing…</span>
                  ) : (
                    <AuthCellContent job={j} onAuthorize={authorize} />
                  )}
                </td>
                <td>
                  {/* Legacy parity: my-new-tickets.component.html had a
                      cancel-icon button here that just opened the detail
                      panel. Replaced with a proper "View" eye-icon since
                      the icon semantic was misleading in legacy. */}
                  <Link
                    href={`/jobs/${j.job_id}`}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full text-ink-500 hover:text-primary hover:bg-primary-50 transition"
                    aria-label={`View job ${j.job_id}`}
                    title="View details"
                  >
                    <Eye className="w-4 h-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-500">
          <span>
            Showing <span className="font-semibold">{firstIdx}</span>–
            <span className="font-semibold">{lastIdx}</span> of{' '}
            <span className="font-semibold">{total}</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1.5">
              Page <span className="font-semibold">{page}</span> of{' '}
              <span className="font-semibold">{pageCount}</span>
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
