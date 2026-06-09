'use client';

/*
 * My Technicians — easyfixers mapped to the SPOC's client.
 *
 * Built fresh (not a 1:1 legacy port): the legacy
 *   /clients/{clientID}/contacts/managers?status=…
 * call was a misnamed shortcut that returned SPOC contacts, not real
 * technicians (the legacy page was a bug). The new endpoint
 *   GET /api/client/technicians
 * pulls the real easyfixer roster via tbl_client_easyfixer_mapping,
 * with service-type chips, skill / tool ratings, and customer-rating
 * averages scoped to this client's jobs.
 *
 * UX:
 *  - Two view modes (Table / Grid cards) toggle top-right
 *  - Status filter (Active / Inactive / All)
 *  - City multi-select
 *  - Search by name / mobile / email (debounced 300ms)
 *  - Pagination 10 / 20 / 30 per page
 *  - Each row/card: avatar, name, mobile, email, city, status chip,
 *    skill star bar, tool star bar, avg customer rating, total jobs
 *    on this client's account, service-type chips
 */
import { useEffect, useMemo, useState } from 'react';
import {
  HardHat, Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  MapPin, Star, Wrench, Award,
  Shield, ShieldOff, Briefcase,
} from 'lucide-react';
import { useFetch, useFetchOnce, useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { MultiSelect, type MultiSelectOption } from '@/components/multi-select';

type Technician = {
  id: number;
  name: string | null;
  mobile: string | null;
  email: string | null;
  status: number | null;                  // 1 active, 0 inactive
  skill_rating: number | string | null;   // 0-10 from CRM
  tool_rating: number | string | null;    // 0-10 from CRM
  city: string | null;
  service_types: string | null;           // CSV (granular service types)
  service_categories: string | null;      // CSV (parent categories — Carpentry, Electrician, …) what we render on the card
  // mysql2 returns DECIMAL columns as strings by default — keep both
  // shapes typed so the rest of the component stays defensive.
  avg_rating: number | string | null;     // 1-5 customer average
  total_jobs: number | string;            // COUNT comes back as string
};

// Coerce numeric-ish values that mysql2 surfaces as strings (DECIMAL /
// BIGINT). Returns null on any non-finite result so callers can fall
// back to a placeholder.
function num(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

type StatusFilter = 'true' | 'false' | 'all';
const PAGE_SIZE_OPTIONS = [10, 20, 30];

function initialsOf(name: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
// Deterministic colour per name — same tech keeps the same colour
function avatarBg(name: string | null) {
  const palette = [
    'bg-rose-500', 'bg-amber-500', 'bg-emerald-500', 'bg-sky-500',
    'bg-violet-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
    'bg-orange-500', 'bg-cyan-500',
  ];
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) {
    h = (h * 31 + (name || '').charCodeAt(i)) >>> 0;
  }
  return palette[h % palette.length];
}

// ─── Star rating bar (0-5 scale; converts 0-10 inputs by /2) ─────────
//
// MySQL ROUND/AVG return values come back as strings via mysql2 (DECIMAL
// type), so we coerce defensively here. Accepts number | string | null
// and bails to "—" on anything non-numeric so the page never crashes
// when the backend hands us a rating in an unexpected shape.
function StarBar({ value, max = 5 }: { value: number | string | null; max?: number }) {
  if (value == null || value === '') return <span className="text-xs text-slate-400">—</span>;
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            'w-3.5 h-3.5',
            i < Math.round(n)
              ? 'fill-amber-400 stroke-amber-500'
              : 'fill-slate-100 stroke-slate-300'
          )}
        />
      ))}
      <span className="text-xs text-slate-600 font-semibold ml-1">
        {n.toFixed(1)}
      </span>
    </span>
  );
}

function StatusBadge({ status }: { status: number | null }) {
  if (status === 1) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-xs font-semibold">
        <Shield className="w-3 h-3" /> Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200 text-xs font-semibold">
      <ShieldOff className="w-3 h-3" /> Inactive
    </span>
  );
}

function ServiceTypeChips({ csv, max = 3 }: { csv: string | null; max?: number }) {
  // Click to expand → reveals the hidden chips inline. Collapses back
  // to the truncated view on a second click. Avoids the dim native
  // `title` tooltip — users couldn't tell the +N chip was interactive.
  const [expanded, setExpanded] = useState(false);

  if (!csv) return <span className="text-xs text-slate-400">No services</span>;
  const all = csv.split(',').map((s) => s.trim()).filter(Boolean);
  const shown = expanded ? all : all.slice(0, max);
  const hidden = all.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold"
        >
          <Briefcase className="w-2.5 h-2.5" />
          {s}
        </span>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold cursor-pointer transition"
        >
          +{hidden} more
        </button>
      )}
      {expanded && all.length > max && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold cursor-pointer transition"
        >
          Show less
        </button>
      )}
    </div>
  );
}

export default function MyTechniciansPage() {
  const [status, setStatus] = useState<StatusFilter>('true');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  // 12 instead of 10 so the 3-column grid fills cleanly without
  // leaving 2 empty cells on the last row (10 % 3 = 1).
  const [pageSize, setPageSize] = useState(12);
  const [cityIds, setCityIds] = useState<number[]>([]);

  // Reset to page 1 whenever any filter changes
  useEffect(() => { setPage(1); }, [status, debouncedQ, cityIds, pageSize]);

  const cityLookup = useFetchOnce<{ items: { id: number; name: string }[] }>('/lookup/cities');
  const cityOptions: MultiSelectOption<number>[] = useMemo(
    () => (cityLookup.data?.items ?? []).map((c) => ({ value: c.id, label: c.name || `City #${c.id}` })),
    [cityLookup.data]
  );

  const fetchPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set('status', status);
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
    if (cityIds.length) params.set('cityIds', cityIds.join(','));
    params.set('limit', String(pageSize));
    params.set('offset', String((page - 1) * pageSize));
    return `/technicians?${params.toString().replace(/%2C/g, ',')}`;
  }, [status, debouncedQ, cityIds, pageSize, page]);

  const { data, error, loading } = useFetch<{ items: Technician[]; total: number }>(fetchPath);
  const items = data?.items ?? [];
  const total = data?.total ?? items.length;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = Math.min(page * pageSize, total);

  // Avg skill rating across the CURRENT page (not all-time)
  const pageAvgSkill = useMemo(() => {
    const vals = items
      .map((t) => num(t.skill_rating))
      .filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    return (vals.reduce((s, v) => s + v, 0) / vals.length / 2);
  }, [items]);

  return (
    <div className="space-y-5">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 inline-flex items-center gap-2">
          <HardHat className="w-6 h-6 text-primary" /> My Technicians
        </h1>
        <p className="text-sm text-slate-500">
          Easyfixers mapped to your account across cities and service types.
        </p>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide">
            {status === 'true' ? 'Active' : status === 'false' ? 'Inactive' : 'Total'} Technicians
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {loading && data == null ? '…' : total.toLocaleString('en-IN')}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Cities (this page)</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {new Set(items.map((t) => t.city).filter(Boolean)).size || '—'}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide">Avg Skill (this page)</div>
          <div className="text-2xl font-bold text-amber-600 mt-1 inline-flex items-center gap-1">
            <Star className="w-5 h-5 fill-amber-400 stroke-amber-500" />
            {pageAvgSkill == null ? '—' : pageAvgSkill.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Filter row */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search by name, mobile or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {/* City + Status filters removed per design — keep only the
            free-text search and the per-page selector. status defaults
            to 'true' (Active) and stays pinned at that value via the
            useState initializer; city filter is dropped entirely. */}
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
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="btn-outline text-xs"
            title="Clear search"
          >
            Reset
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Grid view — only view, table removed per request. */}
      <>
          {loading && (
            <div className="card p-8 text-center text-slate-500">Loading…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="card p-8 text-center text-slate-500">No technicians found.</div>
          )}
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((t) => (
                <div key={t.id} className="card p-4 hover:shadow-md transition">
                  {/* Top: avatar + name + status */}
                  <div className="flex items-start gap-3 mb-3">
                    <div className={cn(
                      'w-12 h-12 rounded-xl text-white font-bold flex items-center justify-center shrink-0 text-sm',
                      avatarBg(t.name)
                    )}>
                      {initialsOf(t.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900 truncate">{t.name || '—'}</div>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="text-[11px] text-slate-500">EFR #{t.id}</div>
                    </div>
                  </div>

                  {/* City row — phone/email intentionally hidden so
                      customers' contacts don't leak unnecessarily. */}
                  <div className="text-xs mb-3">
                    <div className="inline-flex items-center gap-1 text-slate-700 truncate">
                      <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">{t.city || '—'}</span>
                    </div>
                  </div>

                  {/* Service-type chips */}
                  <div className="mb-3 pb-3 border-b border-slate-100">
                    <ServiceTypeChips csv={t.service_categories} max={4} />
                  </div>

                  {/* Ratings + stats — 3-col grid */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5 inline-flex items-center gap-0.5">
                        <Wrench className="w-2.5 h-2.5" /> Skill
                      </div>
                      <StarBar value={(() => { const v = num(t.skill_rating); return v != null ? v / 2 : null; })()} />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5 inline-flex items-center gap-0.5">
                        <Award className="w-2.5 h-2.5" /> Tool
                      </div>
                      <StarBar value={(() => { const v = num(t.tool_rating); return v != null ? v / 2 : null; })()} />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5 inline-flex items-center gap-0.5">
                        <Briefcase className="w-2.5 h-2.5" /> Jobs
                      </div>
                      <div className="text-sm font-bold text-slate-800">{Number(t.total_jobs) || 0}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            Showing <span className="font-semibold">{firstIdx}</span>–
            <span className="font-semibold">{lastIdx}</span> of{' '}
            <span className="font-semibold">{total.toLocaleString('en-IN')}</span>
          </span>
          <div className="flex items-center gap-1">
            {/* First page — jump to page 1 in one tap. Useful when the
                SPOC has paged deep into a 37-page list and wants to
                start over without 30+ back-clicks. */}
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="First page"
              title="First page"
            >
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {/* Direct page-number input. Type a number + Enter (or
                blur) to jump straight there. Clamped on submit so
                negative / over-pageCount values land on a valid page. */}
            <span className="px-2 py-1.5 inline-flex items-center gap-1.5">
              Page
              <input
                type="number"
                min={1}
                max={pageCount}
                value={page}
                onChange={(e) => {
                  // Allow live editing — clamp only on commit so the
                  // user can type "12" without it snapping to "1" mid-keystroke.
                  const v = Number(e.target.value);
                  if (Number.isInteger(v) && v >= 1 && v <= pageCount) setPage(v);
                }}
                onBlur={(e) => {
                  // Final clamp on blur — covers paste / out-of-range entries.
                  const v = Math.max(1, Math.min(pageCount, Number(e.target.value) || 1));
                  setPage(v);
                }}
                className="w-14 px-2 py-1 text-center border border-slate-300 rounded text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                aria-label="Go to page"
              />
              of <span className="font-semibold">{pageCount}</span>
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="Next page"
              title="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {/* Last page — symmetric counterpart to First. One tap
                from anywhere in the list to the final page. */}
            <button
              type="button"
              onClick={() => setPage(pageCount)}
              disabled={page >= pageCount}
              className="btn-outline disabled:cursor-not-allowed"
              aria-label="Last page"
              title="Last page"
            >
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
