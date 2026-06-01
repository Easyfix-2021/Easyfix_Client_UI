'use client';

/*
 * Completed & Under Audit.
 *
 * Migrated from legacy ACD_APIs
 *   POST /api/clients/{clientId}/jobs?…
 *   body: { flag: "visit done" | "", status: [3,5] | [10], clientSpocId }
 * (Angular UnderAuditComponent — under-audit.component).
 *
 * Two tabs:
 *   1. Re-Visit(s) Created     — status=[3,5], flag=visitdone
 *      Backend adds: sub_job_id IS NOT NULL AND ready_for_billing='No'
 *      (legacy JobFilterServiceImpl.java:179-182).
 *
 *   2. Handyman Completed On-App — status=[10]
 *      Auto-closed from the tech app; awaits EasyFix audit.
 *
 * Counts come from /api/client/under-audit/counts (single round-trip,
 * scoped to SPOC's team).
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck, Search, ChevronLeft, ChevronRight,
  Filter, X, AlertTriangle, Eye, RotateCcw, BadgeCheck, Star,
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
  scheduled_date_time: string | null;
  checkin_date_time: string | null;
  checkout_date_time: string | null;
  ticket_created_date_time: string | null;
  original_appointment_date_time: string | null;
  time_slot: string | null;
  service_category_name: string | null;
  client_spoc_name: string | null;
  sub_job_id: number | null;
  job_reopen_flag: number | null;
  easyfixer_name: string | null;
  rating: number | null;
  is_escalated?: boolean | number | null;
};

type TabKey = 'revisit' | 'completedOnApp';
const TABS: Array<{
  key: TabKey; label: string; subtitle: string;
  flag: string; statuses: number[];
}> = [
  {
    key: 'revisit',
    label: 'Re-Visit(s) Created',
    subtitle: 'A revisit has been scheduled. Open the order detail to view both the parent and child orders.',
    flag: 'visitdone',
    statuses: [3, 5],
  },
  {
    key: 'completedOnApp',
    label: 'Handyman Completed On-App',
    subtitle: 'Jobs auto-closed from the tech app. Team EasyFix is auditing the quality.',
    flag: '',
    statuses: [10],
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

// OTA — same-day-attempt indicator (original_appointment vs checkout day)
function computeOTA(j: Job): string {
  if (!j.original_appointment_date_time || !j.checkout_date_time) return '—';
  const a = new Date(j.original_appointment_date_time).toDateString();
  const b = new Date(j.checkout_date_time).toDateString();
  return a === b ? 'Yes' : 'No';
}

// TAT — days from ticket created to checkout
function computeTAT(j: Job): string {
  if (!j.ticket_created_date_time || !j.checkout_date_time) return '—';
  const s = new Date(j.ticket_created_date_time).getTime();
  const e = new Date(j.checkout_date_time).getTime();
  if (isNaN(s) || isNaN(e)) return '—';
  return `${Math.max(0, Math.floor((e - s) / 86_400_000))} Days`;
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

export default function UnderAuditPage() {
  const spoc = useSpoc();
  const [tab, setTab] = useState<TabKey>('revisit');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [staged, setStaged] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

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

  // Tab counts — single endpoint with filter set
  const countsPath = useMemo(() => {
    const p = new URLSearchParams();
    p.set('clientSpocId', String(spoc.id));
    if (debouncedQ.trim())       p.set('q', debouncedQ.trim());
    if (applied.startDate)       p.set('startDate', applied.startDate);
    if (applied.endDate)         p.set('endDate',   applied.endDate);
    if (applied.cityIds.length)  p.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length) p.set('ownerIds',  applied.ownerIds.join(','));
    return `/under-audit/counts?${p.toString().replace(/%2C/g, ',')}`;
  }, [applied, debouncedQ, spoc.id]);

  const countsRes = useFetch<{ revisit: number; completedOnApp: number }>(countsPath);
  const counts = countsRes.data ?? { revisit: 0, completedOnApp: 0 };
  const countByTab: Record<TabKey, number> = {
    revisit: counts.revisit,
    completedOnApp: counts.completedOnApp,
  };

  const fetchPath = useMemo(() => {
    const params = new URLSearchParams();
    if (currentTab.flag) params.set('flag', currentTab.flag);
    params.set('clientSpocId', String(spoc.id));
    params.set('statuses', currentTab.statuses.join(','));
    if (debouncedQ.trim())       params.set('q', debouncedQ.trim());
    if (applied.startDate)       params.set('startDate', applied.startDate);
    if (applied.endDate)         params.set('endDate',   applied.endDate);
    if (applied.cityIds.length)  params.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length) params.set('ownerIds',  applied.ownerIds.join(','));
    params.set('dateType', 'created');
    params.set('limit',  String(pageSize));
    params.set('offset', String((page - 1) * pageSize));
    return `/jobs?${params.toString().replace(/%2C/g, ',')}`;
  }, [currentTab, spoc.id, debouncedQ, applied, pageSize, page]);

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

  const colCount = tab === 'revisit' ? 12 : 10;

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 inline-flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-primary" /> Completed &amp; Under Audit
          </h1>
          <p className="text-sm text-slate-500">{currentTab.subtitle}</p>
        </div>
      </div>

      {/* Tabs with counts */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const isActive = tab === t.key;
          const count = countByTab[t.key];
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
              {t.key === 'revisit' ? <RotateCcw className="w-3.5 h-3.5" /> : <BadgeCheck className="w-3.5 h-3.5" />}
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

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* TABLE — column shape varies per tab (legacy UnderAuditTable
          for Re-Visit, VisitDoneTable for Completed-On-App). */}
      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            {tab === 'revisit' && (
              <tr>
                <th>Job Id</th>
                <th>Client Ref ID</th>
                <th>Ref Job ID</th>
                <th>Category</th>
                <th>City</th>
                <th>OTA</th>
                <th>Org Appointment</th>
                <th>Age</th>
                <th>Job Start Date</th>
                <th>Job End Date</th>
                <th>Next Visit</th>
                <th>Status</th>
              </tr>
            )}
            {tab === 'completedOnApp' && (
              <tr>
                <th>Job ID</th>
                <th>Client Ref ID</th>
                <th>City</th>
                <th>OTA</th>
                <th>TAT</th>
                <th>Appointment</th>
                <th>App Start</th>
                <th>Rating</th>
                <th>Status</th>
                <th className="w-16">View</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={colCount} className="text-center text-slate-500 py-8">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={colCount} className="text-center text-slate-500 py-8">No orders found.</td></tr>
            )}

            {/* RE-VISIT rows */}
            {!loading && tab === 'revisit' && items.map((j) => {
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
                  <td className="text-xs font-mono">
                    {/* Ref Job ID = the sub-job id when a revisit was created */}
                    {j.sub_job_id ? (
                      <Link href={`/jobs/${j.sub_job_id}`} className="text-primary hover:underline">
                        #{j.sub_job_id}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="text-sm">{j.service_category_name || '—'}</td>
                  <td>{j.city_name || '—'}</td>
                  <td className="text-xs">{computeOTA(j)}</td>
                  <td className="text-xs">{formatDate(j.original_appointment_date_time)}</td>
                  <td className="text-xs">{age != null ? `${age} Days` : '—'}</td>
                  <td className="text-xs">{formatDate(j.checkin_date_time)}</td>
                  <td className="text-xs">{formatDate(j.checkout_date_time)}</td>
                  <td className="text-xs">{formatDate(j.scheduled_date_time)}</td>
                  <td>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 text-xs font-semibold">
                      <RotateCcw className="w-3 h-3" /> Revisit
                    </span>
                  </td>
                </tr>
              );
            })}

            {/* COMPLETED-ON-APP rows */}
            {!loading && tab === 'completedOnApp' && items.map((j) => (
              <tr key={j.job_id} className="hover:bg-primary-50/50">
                <td>
                  <Link href={`/jobs/${j.job_id}`} className="text-primary hover:underline font-semibold inline-flex items-center gap-1">
                    #{j.job_id}
                    {j.is_escalated ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" aria-label="Escalated" /> : null}
                  </Link>
                </td>
                <td className="text-xs font-mono">{j.client_ref_id || '—'}</td>
                <td>{j.city_name || '—'}</td>
                <td className="text-xs">{computeOTA(j)}</td>
                <td className="text-xs">{computeTAT(j)}</td>
                <td className="text-xs">
                  <div>{formatDate(j.requested_date_time)}</div>
                  {j.time_slot && <div className="text-slate-500">{j.time_slot}</div>}
                </td>
                <td className="text-xs">{formatDate(j.checkin_date_time)}</td>
                <td>
                  {j.rating ? (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <Star className="w-3.5 h-3.5 fill-amber-400 stroke-amber-500" />
                      <span className="text-xs font-semibold">{j.rating}</span>
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 ring-1 ring-violet-200 text-xs font-semibold">
                    <BadgeCheck className="w-3 h-3" /> Auditing
                  </span>
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
