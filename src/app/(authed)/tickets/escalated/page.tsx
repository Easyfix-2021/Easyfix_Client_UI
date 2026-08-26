'use client';

/*
 * Escalated Orders — jobs where the customer-rating row carries
 * is_escalated = 1.
 *
 * Migrated from legacy ACD_APIs
 *   POST /api/clients/{clientId}/jobs?pageNo=1&pageSize=5&sortBy=job_id
 *   body: { flag: "escalatedJobs", clientSpocId, userIds: [], status: [] }
 * (Angular EscalatedComponent — escalated.components.ts + .html).
 *
 * Backend `flag=escalatedJobs` adds an EXISTS predicate on
 * tbl_easyfixer_rating_by_customer.is_escalated. Auto-scoped to the
 * SPOC's team (same as other flag values that aren't 'otherOrders' /
 * 'noResponse'), matching ClientController.java:101-111.
 *
 * Columns (legacy EscalatedTable in job-status.model.ts):
 *   1. Job_id (+ 🔥 fire icon)
 *   2. Escalated_by  → escalated_by_name (rating row)
 *   3. NoofEscalation → no_of_escalations
 *   4. EscalatedTime → escalated_time (formatted as "Mar 15, 2024 4:30 PM")
 */
import Link from 'next/link';
import { openJobDrawer } from '@/components/job-drawer';
import { useEffect, useMemo, useState } from 'react';
import {
  Search, ChevronLeft, ChevronRight, Filter, X, Flame,
} from 'lucide-react';
import { useFetch, useFetchOnce, useDebouncedValue } from '@/lib/hooks';
import { useSpoc } from '@/lib/spoc-context';
import { cn } from '@/lib/utils';
import { MultiSelect, type MultiSelectOption } from '@/components/multi-select';
import { formatIst } from '@/lib/format';

type EscalatedJob = {
  job_id: number;
  client_ref_id: string | null;
  city_name: string | null;
  customer_name: string | null;
  is_escalated: number | null;
  no_of_escalations: number | null;
  escalated_time: string | null;
  escalated_by_name: string | null;
  escalated_by_user: string | null;
  escalated_comments: string | null;
};

const PAGE_SIZE_OPTIONS = [5, 10, 15, 20];

// ─── Filter state (same shape as other ticket pages) ─────────────────
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

// Legacy convertToAMPM(): "Month DD, YYYY hh:mm AM/PM" — port verbatim
// so escalated time renders identically.
function formatEscalatedTime(iso: string | null) {
  if (!iso) return '—';
  const date = formatIst(iso, { month: 'long', day: 'numeric', year: 'numeric' }, { locale: 'en-US', fallback: '' });
  const time = formatIst(iso, { hour: 'numeric', minute: '2-digit', hour12: true }, { locale: 'en-US', fallback: '' });
  return date ? `${date} ${time}` : '—';
}

export default function EscalatedOrdersPage() {
  const spoc = useSpoc();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [staged, setStaged] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  useEffect(() => { setPage(1); }, [debouncedQ, pageSize, applied]);

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

  // URL mirrors the legacy POST body 1:1 — only `flag` and `clientSpocId`
  // are mandatory; the rest come from the filter bar. `status` is sent
  // empty (legacy parity — backend doesn't apply a status filter for
  // escalatedJobs; the EXISTS predicate is the whole story).
  const fetchPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set('flag',         'escalatedJobs');
    params.set('clientSpocId', String(spoc.id));
    if (debouncedQ.trim())        params.set('q', debouncedQ.trim());
    if (applied.startDate)        params.set('startDate', applied.startDate);
    if (applied.endDate)          params.set('endDate',   applied.endDate);
    if (applied.cityIds.length)   params.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length)  params.set('ownerIds',  applied.ownerIds.join(','));
    params.set('dateType', 'booked');
    params.set('limit',  String(pageSize));
    params.set('offset', String((page - 1) * pageSize));
    return `/jobs?${params.toString().replace(/%2C/g, ',')}`;
  }, [spoc.id, debouncedQ, applied, pageSize, page]);

  const { data, error, loading } = useFetch<{ items: EscalatedJob[]; total: number }>(fetchPath);
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

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 inline-flex items-center gap-2">
            <Flame className="w-6 h-6 text-danger" /> Escalated Orders
          </h1>
          <p className="text-sm text-ink-500">
            Orders flagged by customers as needing senior attention.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-danger-tint text-danger-text ring-1 ring-danger/30 text-sm font-semibold">
          <Flame className="w-4 h-4" />
          {loading && data == null ? '…' : `${total} escalated`}
        </div>
      </div>

      {/* Filter bar — same shape as other ticket pages */}
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
            <label className="block text-xs font-medium text-ink-500 mb-1">Order Booked — From</label>
            <input
              type="date" className="input"
              value={staged.startDate}
              max={staged.endDate || undefined}
              onChange={(e) => setStaged((s) => ({ ...s, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-500 mb-1">Order Booked — To</label>
            <input
              type="date" className="input"
              value={staged.endDate}
              min={staged.startDate || undefined}
              onChange={(e) => setStaged((s) => ({ ...s, endDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-500 mb-1">City</label>
            <MultiSelect
              label="All Cities" options={cityOptions}
              value={staged.cityIds}
              onChange={(v) => setStaged((s) => ({ ...s, cityIds: v }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-500 mb-1">Client Team</label>
            <MultiSelect
              label="All Members" options={teamOptions}
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

      {error && (
        <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {error}
        </div>
      )}

      {/* Table — 4 legacy columns (EscalatedTable) + 2 helpful extras
          (Customer, Comments) for context. Keep the legacy 4 first. */}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Escalated By</th>
              <th>No. of Escalations</th>
              <th>Escalated Time</th>
              <th>Customer</th>
              <th>Comments</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="text-center text-ink-500 py-8">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="text-center text-ink-500 py-8">No escalated orders found.</td></tr>
            )}
            {!loading && items.map((j) => (
              <tr key={j.job_id} className="hover:bg-danger-tint/40">
                <td>
                  <button
                    type="button"
                    onClick={() => openJobDrawer(j.job_id)}
                    className="text-primary hover:underline font-semibold inline-flex items-center gap-1"
                  >
                    <Flame className="w-3.5 h-3.5 text-danger" aria-label="Escalated" />
                    #{j.job_id}
                  </button>
                </td>
                <td>
                  <div className="text-ink-900">{j.escalated_by_name || '—'}</div>
                  {j.escalated_by_user && (
                    <div className="text-xs text-ink-500 capitalize">{j.escalated_by_user}</div>
                  )}
                </td>
                <td>
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full text-xs font-semibold',
                    (j.no_of_escalations ?? 0) >= 3
                      ? 'bg-danger-tint text-danger-text ring-1 ring-danger/30'
                      : (j.no_of_escalations ?? 0) >= 2
                        ? 'bg-warning-tint text-warning-text ring-1 ring-warning/30'
                        : 'bg-warning-tint/60 text-warning-text ring-1 ring-warning/20'
                  )}>
                    {j.no_of_escalations ?? 0}
                  </span>
                </td>
                <td className="text-xs">{formatEscalatedTime(j.escalated_time)}</td>
                <td className="text-sm">{j.customer_name || '—'}</td>
                <td className="text-xs text-ink-500 max-w-xs">
                  {j.escalated_comments ? (
                    <span className="line-clamp-2" title={j.escalated_comments}>
                      {j.escalated_comments}
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
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
