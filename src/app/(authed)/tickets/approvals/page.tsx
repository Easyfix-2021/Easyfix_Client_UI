'use client';

/*
 * Client Delay — "Pending Due to Client" page.
 *
 * Migrated from legacy ACD_APIs
 *   POST /api/clients/{clientId}/jobs?pageNo=1&pageSize=5&sortBy=job_id
 *   body: { flag, status: [15|21|9], clientSpocId, ... }
 * (Angular MyApprovalsComponent — my-approvals.component.ts + .html).
 *
 * Three tabs with three distinct column sets:
 *   1. Approve Estimate     — status=[15], no flag, MyApprovalTable
 *   2. Fulfilment On Hold   — status=[21], no flag, MyApprovalFulfilmentOnHoldTable
 *   3. Un-Authorized        — status=[9],  flag=unauthorized, MyNewTicketClientTable
 *
 * Tab counts come from a dedicated endpoint
 *   GET /api/client/client-delay/counts
 * scoped to the SPOC's team (matches the list-scope).
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Clock4, Search, ChevronLeft, ChevronRight,
  Filter, X, AlertTriangle, Eye, ShieldCheck, Check,
} from 'lucide-react';
import { useFetch, useFetchOnce, useDebouncedValue } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import { useSpoc } from '@/lib/spoc-context';
import { cn } from '@/lib/utils';
import { MultiSelect, type MultiSelectOption } from '@/components/multi-select';

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
  service_category_name: string | null;
  client_spoc_name: string | null;
  /* status=15 fields */
  approval_sent_on_date_time: string | null;
  /* status=21 fields */
  full_fillment_created_time: string | null;
  full_fillment_time: string | null;
  full_fillment_reason: string | null;
  /* status=9 fields */
  approved_by_client: number | null;
  call_later: number | null;
  is_escalated?: boolean | number | null;
};

type TabKey = 'approveEstimate' | 'fulfilmentOnHold' | 'unauthorized';

const TABS: Array<{
  key: TabKey; label: string; subtitle: string;
  statuses: number[]; flag: string;
}> = [
  {
    key: 'approveEstimate',
    label: 'Approve Estimate',
    subtitle: 'The Easyfix professional has shared the estimate. Open each ticket to review and accept.',
    // flag is intentionally non-empty so the backend's auto-scope kicks
    // in (routes/client/index.js:343 skips scope when `!ticketFlag`).
    // The service-layer ticketFlag switch silently no-ops unrecognised
    // values, so the only effect of sending this flag is the team
    // scope — exactly what /client-delay/counts already applies, so
    // the badge count and the table count finally agree.
    statuses: [15], flag: 'approveestimate',
  },
  {
    key: 'fulfilmentOnHold',
    label: 'Fulfilment On Hold',
    subtitle: 'These open orders are currently on hold. Read the reason to understand the blocker.',
    // Same rationale as approveEstimate — non-empty flag to trigger
    // team scoping on the list endpoint.
    statuses: [21], flag: 'fulfilmentonhold',
  },
  {
    key: 'unauthorized',
    label: 'Un-Authorized',
    subtitle: 'Pending approval from the client to confirm the booking.',
    statuses: [9], flag: 'unauthorized',
  },
];

const PAGE_SIZE_OPTIONS = [5, 10, 15, 20];

function formatDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const day = d.toLocaleDateString('en-IN', { weekday: 'short' });
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return `${day}, ${date}`;
}

function ageInDays(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
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

export default function ClientDelayPage() {
  const spoc = useSpoc();
  const [tab, setTab] = useState<TabKey>('approveEstimate');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [staged, setStaged] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  const [refreshTick, setRefreshTick] = useState(0);
  const [authorizingId, setAuthorizingId] = useState<number | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => { setPage(1); }, [tab, debouncedQ, pageSize, applied]);

  const currentTab = useMemo(() => TABS.find((t) => t.key === tab) ?? TABS[0], [tab]);

  const cityLookup = useFetchOnce<{ items: { id: number; name: string }[] }>('/lookup/cities');
  const teamLookup = useFetchOnce<{ items: { id: number; name: string }[] }>('/team/members');

  const cityOptions: MultiSelectOption<number>[] = useMemo(
    () => (cityLookup.data?.items ?? []).map((c) => ({ value: c.id, label: c.name || `City #${c.id}` })),
    [cityLookup.data]
  );
  const teamOptions: MultiSelectOption<number>[] = useMemo(
    () => (teamLookup.data?.items ?? []).map((u) => ({ value: u.id, label: u.name || `User #${u.id}` })),
    [teamLookup.data]
  );

  // Counts — single endpoint, refresh on filter / authorize
  const countsPath = useMemo(() => {
    const p = new URLSearchParams();
    p.set('clientSpocId', String(spoc.id));
    if (debouncedQ.trim())       p.set('q', debouncedQ.trim());
    if (applied.startDate)       p.set('startDate', applied.startDate);
    if (applied.endDate)         p.set('endDate',   applied.endDate);
    if (applied.cityIds.length)  p.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length) p.set('ownerIds',  applied.ownerIds.join(','));
    if (refreshTick) p.set('_r', String(refreshTick));
    return `/client-delay/counts?${p.toString().replace(/%2C/g, ',')}`;
  }, [applied, debouncedQ, refreshTick, spoc.id]);

  const countsRes = useFetch<{ approveEstimate: number; fulfilmentOnHold: number; unauthorized: number }>(countsPath);
  const counts = countsRes.data ?? { approveEstimate: 0, fulfilmentOnHold: 0, unauthorized: 0 };

  // Build the list URL — legacy parity: send flag + status + clientSpocId
  const fetchPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set('flag', currentTab.flag);
    params.set('clientSpocId', String(spoc.id));
    params.set('statuses', currentTab.statuses.join(','));
    // ticketFlag triggers the backend's SPOC-manager check for the
    // Un-Authorized tab (status=9, approved_by_client=0, etc.).
    if (currentTab.flag === 'unauthorized') {
      params.set('ticketFlag', 'unauthorized');
    }
    if (debouncedQ.trim())       params.set('q', debouncedQ.trim());
    if (applied.startDate)       params.set('startDate', applied.startDate);
    if (applied.endDate)         params.set('endDate',   applied.endDate);
    if (applied.cityIds.length)  params.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length) params.set('ownerIds',  applied.ownerIds.join(','));
    params.set('dateType', 'created');
    params.set('limit',  String(pageSize));
    params.set('offset', String((page - 1) * pageSize));
    if (refreshTick) params.set('_r', String(refreshTick));
    return `/jobs?${params.toString().replace(/%2C/g, ',')}`;
  }, [currentTab, spoc.id, debouncedQ, applied, pageSize, page, refreshTick]);

  const { data, error, loading } = useFetch<{ items: Job[]; total: number }>(fetchPath);
  const items = data?.items ?? [];
  const total = data?.total ?? items.length;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = Math.min(page * pageSize, total);

  const hasStagedChanges = filtersDiffer(staged, applied);
  const hasAnyApplied = !!(applied.startDate || applied.endDate ||
    applied.cityIds.length || applied.ownerIds.length);

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
      setRefreshTick((n) => n + 1);
    } catch (e) {
      setAuthError(e instanceof ApiError ? e.message : 'Authorize failed');
    } finally {
      setAuthorizingId(null);
    }
  }

  // colspan per tab matches the column count in <thead>
  const colCount = tab === 'approveEstimate' ? 9 : tab === 'fulfilmentOnHold' ? 10 : 8;

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 inline-flex items-center gap-2">
            <Clock4 className="w-6 h-6 text-primary" /> Pending Due to Client
          </h1>
          <p className="text-sm text-slate-500">{currentTab.subtitle}</p>
        </div>
      </div>

      {/* Tabs with counts */}
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
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              )}
            >
              <span>{t.label}</span>
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded-full text-xs font-bold',
                  isActive ? 'bg-white/25 text-white' : 'bg-primary/10 text-primary'
                )}
              >
                {countsRes.loading && countsRes.data == null ? '…' : count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="card p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
            <label className="block text-xs font-medium text-slate-600 mb-1">Ticket Created — From</label>
            <input
              type="date" className="input"
              value={staged.startDate}
              max={staged.endDate || undefined}
              onChange={(e) => setStaged((s) => ({ ...s, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ticket Created — To</label>
            <input
              type="date" className="input"
              value={staged.endDate}
              min={staged.startDate || undefined}
              onChange={(e) => setStaged((s) => ({ ...s, endDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">City</label>
            <MultiSelect
              label="All Cities" options={cityOptions}
              value={staged.cityIds}
              onChange={(v) => setStaged((s) => ({ ...s, cityIds: v }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Client Team</label>
            <MultiSelect
              label="All Members" options={teamOptions}
              value={staged.ownerIds}
              onChange={(v) => setStaged((s) => ({ ...s, ownerIds: v }))}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
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
              type="button" onClick={resetFilters} className="btn-outline"
              disabled={!hasAnyApplied && !hasStagedChanges && !q}
            >
              <X className="w-4 h-4" /> Reset
            </button>
            <button
              type="button" onClick={applyFilters} className="btn-primary"
              disabled={!hasStagedChanges}
            >
              <Filter className="w-4 h-4" /> Apply Filter
            </button>
          </div>
        </div>
      </div>

      {(error || authError) && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {authError || error}
        </div>
      )}

      {/* TABLE — column set varies per tab (legacy MyApproval* tables) */}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            {tab === 'approveEstimate' && (
              <tr>
                <th>Job Id</th>
                <th>Client Ref ID</th>
                <th>Estimate Sent on</th>
                <th>Category</th>
                <th>City</th>
                <th>Age</th>
                <th>Customer Name</th>
                <th>Total Cost</th>
                <th>Client SPOC</th>
              </tr>
            )}
            {tab === 'fulfilmentOnHold' && (
              <tr>
                <th>Job Id</th>
                <th>Client Ref ID</th>
                <th>Fulfilment on Hold</th>
                <th>Category</th>
                <th>City</th>
                <th>Age</th>
                <th>Customer Name</th>
                <th>Expected Date</th>
                <th>Client SPOC</th>
                <th>Reason For Hold</th>
              </tr>
            )}
            {tab === 'unauthorized' && (
              <tr>
                <th>Job ID</th>
                <th>Client Ref ID</th>
                <th>Ticket Created</th>
                <th>Appointment</th>
                <th>City</th>
                <th>Source</th>
                <th>Authorization</th>
                <th className="w-16">View</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={colCount} className="text-center text-slate-500 py-8">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={colCount} className="text-center text-slate-500 py-8">No tickets found.</td></tr>
            )}

            {/* Approve Estimate rows */}
            {!loading && tab === 'approveEstimate' && items.map((j) => {
              const age = ageInDays(j.ticket_created_date_time);
              return (
                <tr key={j.job_id} className="hover:bg-primary-50/50">
                  <td>
                    <Link href={`/jobs/${j.job_id}`} className="text-primary hover:underline font-semibold inline-flex items-center gap-1">
                      #{j.job_id}
                      {j.is_escalated ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label="Escalated" /> : null}
                    </Link>
                  </td>
                  <td className="text-xs font-mono">{j.client_ref_id || '—'}</td>
                  <td className="text-xs">{formatDate(j.approval_sent_on_date_time)}</td>
                  <td className="text-sm">{j.service_category_name || '—'}</td>
                  <td>{j.city_name || '—'}</td>
                  <td className="text-xs">{age != null ? `${age} Days` : '—'}</td>
                  <td className="text-sm">{j.customer_name || '—'}</td>
                  <td className="text-xs text-slate-400">—{/* Total Cost: needs SUM(job_services), skipped */}</td>
                  <td className="text-sm">{j.client_spoc_name || '—'}</td>
                </tr>
              );
            })}

            {/* Fulfilment On Hold rows */}
            {!loading && tab === 'fulfilmentOnHold' && items.map((j) => {
              const age = ageInDays(j.full_fillment_created_time);
              return (
                <tr key={j.job_id} className="hover:bg-primary-50/50">
                  <td>
                    <Link href={`/jobs/${j.job_id}`} className="text-primary hover:underline font-semibold inline-flex items-center gap-1">
                      #{j.job_id}
                      {j.is_escalated ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label="Escalated" /> : null}
                    </Link>
                  </td>
                  <td className="text-xs font-mono">{j.client_ref_id || '—'}</td>
                  <td className="text-xs">{formatDate(j.full_fillment_created_time)}</td>
                  <td className="text-sm">{j.service_category_name || '—'}</td>
                  <td>{j.city_name || '—'}</td>
                  <td className="text-xs">{age != null ? `${age} Days` : '—'}</td>
                  <td className="text-sm">{j.customer_name || '—'}</td>
                  <td className="text-xs">{formatDate(j.full_fillment_time)}</td>
                  <td className="text-sm">{j.client_spoc_name || '—'}</td>
                  <td className="text-xs text-slate-600 max-w-xs">
                    {j.full_fillment_reason ? (
                      <span className="line-clamp-2" title={j.full_fillment_reason}>
                        {j.full_fillment_reason}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {/* Un-Authorized rows */}
            {!loading && tab === 'unauthorized' && items.map((j) => (
              <tr key={j.job_id} className="hover:bg-primary-50/50">
                <td>
                  <Link href={`/jobs/${j.job_id}`} className="text-primary hover:underline font-semibold inline-flex items-center gap-1">
                    #{j.job_id}
                    {j.is_escalated ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label="Escalated" /> : null}
                  </Link>
                </td>
                <td className="text-xs font-mono">{j.client_ref_id || '—'}</td>
                <td className="text-xs">{formatDate(j.ticket_created_date_time)}</td>
                <td className="text-xs">{formatDate(j.requested_date_time)}</td>
                <td>{j.city_name || '—'}</td>
                <td className="text-xs">{j.source_type || '—'}</td>
                <td>
                  {authorizingId === j.job_id ? (
                    <span className="text-xs text-slate-500">Authorizing…</span>
                  ) : j.approved_by_client === 0 ? (
                    <button
                      type="button"
                      onClick={() => authorize(j.job_id)}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-white text-xs font-semibold hover:bg-primary-dark transition shadow-sm"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" /> Authorize
                    </button>
                  ) : j.approved_by_client === 1 ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-xs font-semibold">
                      <Check className="w-3 h-3" /> Authorized
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 ring-1 ring-slate-200 text-xs font-semibold">
                      <Check className="w-3 h-3" /> Preapproved
                    </span>
                  )}
                </td>
                <td>
                  <Link
                    href={`/jobs/${j.job_id}`}
                    className="inline-flex items-center justify-center w-8 h-8 rounded-full text-slate-500 hover:text-primary hover:bg-primary-50 transition"
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
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
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
