'use client';

/*
 * Tx on Location — jobs the technician has checked-in on-site.
 *
 * Migrated from legacy ACD_APIs
 *   POST /api/clients/{clientId}/jobs?pageNo=…&pageSize=…&sortBy=job_id
 *   body: { flag: "", status: [2, 20], clientSpocId, ... }
 * (Angular TxOnLocation — tx-on-location.component).
 *
 * Single-view page (no tabs). Status pinned to 2 (IN_PROGRESS) + 20
 * (IN_PROGRESS_ALT) by the backend `flag=onLocation` branch. Scoped to
 * the SPOC's team (matches legacy ClientController.java:101 — any
 * non-otherOrders flag triggers userIds expansion).
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  MapPin, Search, ChevronLeft, ChevronRight,
  Filter, X, AlertTriangle, Eye, Activity,
} from 'lucide-react';
import { useFetch, useFetchOnce, useDebouncedValue } from '@/lib/hooks';
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
  requested_date_time: string | null;
  ticket_created_date_time: string | null;
  time_slot: string | null;
  service_category_name: string | null;
  client_spoc_name: string | null;
  scheduled_by_name: string | null;
  created_by_name: string | null;
  easyfixer_name: string | null;
  is_escalated?: boolean | number | null;
};

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

export default function TxOnLocationPage() {
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

  const fetchPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set('flag', 'onLocation');
    params.set('clientSpocId', String(spoc.id));
    params.set('statuses', '2,20');
    if (debouncedQ.trim())       params.set('q', debouncedQ.trim());
    if (applied.startDate)       params.set('startDate', applied.startDate);
    if (applied.endDate)         params.set('endDate',   applied.endDate);
    if (applied.cityIds.length)  params.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length) params.set('ownerIds',  applied.ownerIds.join(','));
    params.set('dateType', 'created');
    params.set('limit',  String(pageSize));
    params.set('offset', String((page - 1) * pageSize));
    return `/jobs?${params.toString().replace(/%2C/g, ',')}`;
  }, [spoc.id, debouncedQ, applied, pageSize, page]);

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

  return (
    <div className="space-y-5">
      {/* Title with live count chip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 inline-flex items-center gap-2">
            <MapPin className="w-6 h-6 text-primary" /> Tx on Location
          </h1>
          <p className="text-sm text-slate-500">
            Orders currently being addressed on-site by the technician.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-50 text-violet-700 ring-1 ring-violet-200 text-sm font-semibold">
          <Activity className="w-4 h-4 animate-pulse" />
          {loading && data == null ? '…' : `${total.toLocaleString('en-IN')} live`}
        </div>
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

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Table — legacy ClientTable column shape */}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Client Ref ID</th>
              <th>Reference ID</th>
              <th>Appointment</th>
              <th>Customer</th>
              <th>City</th>
              <th>Category</th>
              <th>Client SPOC</th>
              <th>Scheduled By</th>
              <th>Technician</th>
              <th>Age</th>
              <th className="w-16">View</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={12} className="text-center text-slate-500 py-8">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={12} className="text-center text-slate-500 py-8">No technicians on location right now.</td></tr>
            )}
            {!loading && items.map((j) => {
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
                  <td className="text-xs font-mono">{j.job_reference_id || '—'}</td>
                  <td className="text-xs">
                    <div>{formatDate(j.requested_date_time)}</div>
                    {j.time_slot && <div className="text-slate-500">{j.time_slot}</div>}
                  </td>
                  <td>
                    <div className="text-slate-800">{j.customer_name || '—'}</div>
                    {j.customer_mob_no && (
                      <div className="text-xs text-slate-500">{j.customer_mob_no}</div>
                    )}
                  </td>
                  <td>{j.city_name || '—'}</td>
                  <td className="text-sm">{j.service_category_name || '—'}</td>
                  <td className="text-sm">{j.client_spoc_name || '—'}</td>
                  <td className="text-sm">{j.scheduled_by_name || j.created_by_name || '—'}</td>
                  <td className="text-sm">
                    {j.easyfixer_name ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        {j.easyfixer_name}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-xs">{age != null ? `${age} Days` : '—'}</td>
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
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            Showing <span className="font-semibold">{firstIdx}</span>–
            <span className="font-semibold">{lastIdx}</span> of{' '}
            <span className="font-semibold">{total.toLocaleString('en-IN')}</span>
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
