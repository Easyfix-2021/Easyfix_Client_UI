'use client';

/*
 * My Order History — primary landing page after SPOC login.
 *
 * Migrated from legacy ACD_APIs
 *   POST /api/clients/{clientId}/jobs?pageNo=1&pageSize=5&sortBy=job_id
 *   body: { flag, status[], clientSpocId, cityIds, userIds, startDate,
 *           endDate, ageBracket }
 * (Angular OrderHistoryComponent — order-history.component.ts + .html).
 *
 * Tabs (legacy parity — `flag` field):
 *   1. All Orders                → flag=otherOrders
 *      Whole-client view, NOT auto-scoped to SPOC's team
 *   2. Completed & Under Audit   → flag=completedOrders
 *      Auto-scoped to SPOC's team (matches legacy)
 *      Backend adds ready_for_billing='Yes' AND sub_job_id IS NULL
 *
 * Both tabs send the legacy status list [0,1,2,3,5,6,7,9,10,15,20,21,22]
 * so the network payload mirrors the legacy POST body 1:1.
 *
 * Table columns are the EXACT set from legacy job-status.model.ts
 * (OrderHistoryTable for All Orders, VisitDoneTable for Completed).
 */
import Link from 'next/link';
import { openJobDrawer } from '@/components/job-drawer';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Upload, Download, AlertTriangle, Search,
  ChevronLeft, ChevronRight, Star, Filter, X, RotateCcw,
} from 'lucide-react';
import { useFetch, useFetchOnce, useDebouncedValue } from '@/lib/hooks';
import { ApiError, downloadBlob } from '@/lib/api';
import { useSpoc } from '@/lib/spoc-context';
import { getBucketStatusForJob, getBucketCurrentStatusForJob } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { MultiSelect, type MultiSelectOption } from '@/components/multi-select';
import { formatIstDayDate } from '@/lib/format';

type Job = {
  job_id: number;
  job_reference_id: string | null;     // "Ref ID" column (legacy referenceId)
  client_ref_id: string | null;
  job_status: number;
  customer_name: string | null;
  customer_mob_no: string | null;
  city_name: string | null;
  requested_date_time: string | null;
  scheduled_date_time: string | null;
  checkin_date_time: string | null;    // "App Start" on Completed tab
  checkout_date_time: string | null;
  ticket_created_date_time: string | null;
  created_date_time: string | null;
  original_appointment_date_time: string | null;  // for OTA computation
  time_slot: string | null;            // shown under Appointment on Completed
  easyfixer_name: string | null;
  source_type: string | null;
  rating?: number | null;
  is_escalated?: boolean | number | null;
  ready_for_billing?: string | null;   // 'Yes' / 'No'
  sub_job_id?: number | null;
  job_reopen_flag?: number | null;     // 1 → "Reopened", 0 → "Reopen"
  // Fields used by getBucketCurrentStatusForJob (Status of Order column)
  approved_by_client?: number | null;
  spoc_approval_by_client?: number | null;
  call_later?: number | boolean | null;
  fk_easyfixter_id?: number | null;
  approval_sent_on_date_time?: string | null;
  approved_on_date_time?: string | null;
  approval_reject_date_time?: string | null;
  full_fillment_created_time?: string | null;
};

// Tab keys mirror legacy flag values exactly.
type TabKey = 'otherOrders' | 'completedOrders';
const TABS: Array<{ key: TabKey; label: string; subtitle: string }> = [
  {
    key: 'otherOrders',
    label: 'All Orders',
    subtitle: 'Below tickets the order appointment to be confirmed.',
  },
  {
    key: 'completedOrders',
    label: 'In-Warranty Orders',
    subtitle: 'Below orders need repair and are completed on D+2 days of approval.',
  },
];

// Full status set sent in the URL on both tabs — matches the legacy
// POST body exactly. Backend can still filter further via the active
// flag (completedOrders adds ready_for_billing predicates).
const LEGACY_STATUS_SET = [0, 1, 2, 3, 5, 6, 7, 9, 10, 15, 20, 21, 22];

const PAGE_SIZE_OPTIONS = [5, 10, 15, 20];

// Bucket options for the "All Orders" tab filter pickers.
// Labels + value-to-status mapping mirror the legacy
// Angular_ClientDashboard `Buckets` constant in
// components/models/shared.model.ts (1:1 — names, order, status codes).
// "Fulfilment" intentionally spelt with the legacy double-l so SPOCs
// who learned the dashboard recognise the term unchanged.
const BUCKET_OPTIONS: MultiSelectOption<string>[] = [
  { value: '9',    label: 'New Tickets' },
  { value: '0',    label: 'Allocated - Unallocated' },
  { value: '1',    label: 'TX On Going' },
  { value: '2,20', label: 'TX On Location' },
  { value: '10',   label: 'Under EF Audit' },
  { value: '15',   label: 'Approve Estimate' },
  { value: '21',   label: 'Fullfillment On Hold' },
  { value: '3,5',  label: 'Completed - VisitCompleted' },
  { value: '6',    label: 'Failed - Cancelled' },
  { value: '7',    label: 'Failed - Enquiry' },
];

function statusBadgeClass(status: number) {
  switch (status) {
    case 0:  return 'bg-warning-tint text-warning-text ring-warning/30';
    case 1:  return 'bg-info-tint text-info-text ring-info/30';
    // "Tx On Location" was violet, which the brand has no equivalent for.
    // `gold` is the nearest free slot: `info` (case 1) and `primary`
    // (case 10) already carry other statuses in this same function, so
    // reusing either would collapse two states into one chip colour.
    case 2:  return 'bg-gold-tint text-gold-text ring-gold/30';
    case 3:
    case 5:  return 'bg-success-tint text-success-text ring-success/30';
    case 6:  return 'bg-danger-tint text-danger-text ring-danger/30';
    case 7:  return 'bg-ink-100 text-ink-700 ring-ink-300/40';
    case 9:  return 'bg-ink-100 text-ink-700 ring-ink-300/40';
    case 10: return 'bg-primary-100 text-primary ring-primary/30';
    case 15: return 'bg-warning-tint text-warning-text ring-warning/30';
    case 21: return 'bg-ink-100 text-ink-700 ring-ink-300/40';
    default: return 'bg-ink-100 text-ink-700 ring-ink-300/40';
  }
}

/*
 * Color for the "Bucket" column — the context-aware sub-status returned
 * by getBucketCurrentStatusForJob (Ready for Billing, Tx Allocated,
 * Estimate Approved, etc.). Keyed by exact label so the same row
 * always renders the same colour across pages.
 *
 * Palette maps the legacy Angular dashboard's tones onto brand tokens.
 * The legacy hue is kept in brackets so a reader can still match this
 * column against the old dashboard:
 *   Ready for Billing → money  [pink]   (it IS the invoice state)
 *   Allocated/Ongoing → info   [blue]   (in flight, no action needed)
 *   Tx On Location    → gold   [violet] (technician is actively working)
 *   Completed         → success[emerald](done)
 *   Rejected / Cancel → danger [rose]   (failure)
 *   Awaiting decision → warning[amber]  (waiting on someone)
 *   Fallback          → ink    [slate]  (no special meaning)
 *
 * `money` and `gold` are used rather than a second helping of `info` /
 * `primary`: those two already colour other buckets in this function, and
 * two adjacent columns colour-code status side by side, so a duplicate
 * would erase a distinction the SPOC reads at a glance.
 */
function bucketBadgeClass(label: string) {
  switch (label) {
    case 'Ready for Billing':       return 'bg-money/10 text-money ring-money/30';
    case 'Visit Completed':
    case 'Completed':
    case 'Completed on TX App':
    case 'Estimate Approved':       return 'bg-success-tint text-success-text ring-success/30';
    case 'Tx Allocated':
    case 'Tx Ongoing Order':
    case 'New Ticket':              return 'bg-info-tint text-info-text ring-info/30';
    case 'Tx On Location':          return 'bg-gold-tint text-gold-text ring-gold/30';
    case 'Tx Unallocated':
    case 'Approve Estimate':
    case 'Ready for Full-Fillement':
    case 'Full-Fillement on Hold':  return 'bg-warning-tint text-warning-text ring-warning/30';
    case 'Cancel Order':
    case 'Estimate Rejected':
    case 'Un-Authorize':            return 'bg-danger-tint text-danger-text ring-danger/30';
    case 'Call Later':
    case 'Enquiry Order':           return 'bg-ink-100 text-ink-700 ring-ink-300/40';
    default:                        return 'bg-ink-100 text-ink-700 ring-ink-300/40';
  }
}

function ageInDays(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

// Legacy "OTA" — Same-day attempt: was the original appointment date
// the same as the actual checkout? Yes if all three present and equal.
function computeOTA(job: Job): string {
  if (!job.original_appointment_date_time || !job.checkout_date_time) return '—';
  const orig = new Date(job.original_appointment_date_time).toDateString();
  const out  = new Date(job.checkout_date_time).toDateString();
  return orig === out ? 'Yes' : 'No';
}

// Legacy "TAT" — turnaround days from ticket creation to checkout.
function computeTAT(job: Job): string {
  if (!job.ticket_created_date_time || !job.checkout_date_time) return '—';
  const start = new Date(job.ticket_created_date_time).getTime();
  const end   = new Date(job.checkout_date_time).getTime();
  if (isNaN(start) || isNaN(end)) return '—';
  const days = Math.max(0, Math.floor((end - start) / 86_400_000));
  return `${days} Days`;
}

// ─── Filter state ────────────────────────────────────────────────────
type FilterState = {
  startDate: string;
  endDate: string;
  cityIds: number[];
  ownerIds: number[];
  bucketValues: string[];
};

const EMPTY_FILTERS: FilterState = {
  startDate: '', endDate: '',
  cityIds: [], ownerIds: [], bucketValues: [],
};

function filtersDiffer(a: FilterState, b: FilterState) {
  if (a.startDate !== b.startDate || a.endDate !== b.endDate) return true;
  if (a.cityIds.length !== b.cityIds.length) return true;
  if (a.ownerIds.length !== b.ownerIds.length) return true;
  if (a.bucketValues.length !== b.bucketValues.length) return true;
  if (a.cityIds.some((id, i) => id !== b.cityIds[i])) return true;
  if (a.ownerIds.some((id, i) => id !== b.ownerIds[i])) return true;
  if (a.bucketValues.some((v, i) => v !== b.bucketValues[i])) return true;
  return false;
}

export default function OrderHistoryPage() {
  const spoc = useSpoc();
  const [tab, setTab] = useState<TabKey>('otherOrders');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [staged, setStaged] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  useEffect(() => { setPage(1); }, [tab, debouncedQ, pageSize, applied]);

  // On Completed tab, the bucket multi-select is hidden — clear any
  // staged values so they don't sneak back when user returns to All.
  useEffect(() => {
    if (tab === 'completedOrders' && staged.bucketValues.length > 0) {
      setStaged((s) => ({ ...s, bucketValues: [] }));
    }
  }, [tab, staged.bucketValues.length]);

  // Deep-link: the dashboard status tiles (New / In Progress / Completed)
  // link here with ?flag= and ?statuses=. Seed the tab + status filter
  // once on mount so the list lands pre-filtered. Read from window
  // (client-only) to avoid the useSearchParams Suspense requirement.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const flag = sp.get('flag');
    const statuses = sp.get('statuses');
    const qParam = sp.get('q');
    if (flag === 'completedOrders' || flag === 'otherOrders') setTab(flag);
    if (qParam) setQ(qParam);
    if (statuses) {
      const seeded: FilterState = { ...EMPTY_FILTERS, bucketValues: [statuses] };
      setStaged(seeded);
      setApplied(seeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Build the URL with EVERY legacy field for 1:1 network-tab parity.
  //
  // Legacy POST body had:
  //   { flag, status[], clientSpocId, startDate, endDate, ageBracket,
  //     cityIds, userIds }
  // We translate to query params (GET is cacheable, no preflight).
  // `clientSpocId` is sent but the backend ignores it and uses
  // req.spoc.id from the JWT for security.
  const fetchPath = useMemo(() => {
    const params = new URLSearchParams();
    // Strict legacy parity — send only `flag`, not `ticketFlag`. The
    // backend reads either, with `flag` falling back through the same
    // ticketFlag branch. Removing `ticketFlag` keeps the URL identical
    // to the legacy POST body's `flag` field.
    params.set('flag',         tab);
    params.set('clientSpocId', String(spoc.id));               // legacy parity (server ignores)
    // If user picked specific buckets, narrow the status list to those.
    // Otherwise send the full legacy default set so the payload still
    // matches the legacy network call when nothing's picked.
    if (applied.bucketValues.length > 0) {
      const flat = applied.bucketValues.flatMap((v) => v.split(',')).filter(Boolean).join(',');
      params.set('statuses', flat);
    } else {
      params.set('statuses', LEGACY_STATUS_SET.join(','));
    }
    if (debouncedQ.trim())        params.set('q', debouncedQ.trim());
    if (applied.startDate)        params.set('startDate', applied.startDate);
    if (applied.endDate)          params.set('endDate',   applied.endDate);
    if (applied.cityIds.length)   params.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length)  params.set('ownerIds',  applied.ownerIds.join(','));
    params.set('dateType', 'created');
    params.set('limit',  String(pageSize));
    params.set('offset', String((page - 1) * pageSize));
    // URLSearchParams.toString() percent-encodes commas as %2C, which
    // is technically correct but noisy in the DevTools network tab.
    // The backend handles both encodings — we strip the encoding
    // back to plain commas for legibility.
    return `/jobs?${params.toString().replace(/%2C/g, ',')}`;
  }, [tab, applied, debouncedQ, pageSize, page, spoc.id]);

  // ─── Tab counts ──────────────────────────────────────────────────────
  // Legacy parity: order-history.component.ts subscribes to
  // bucketCountState$ for otherOrdersCount + completedForBillingOrdersCount.
  // We hit a dedicated endpoint that returns both in one round-trip and
  // refetches when the applied filters change.
  const countsPath = useMemo(() => {
    const p = new URLSearchParams();
    p.set('clientSpocId', String(spoc.id));
    if (debouncedQ.trim())        p.set('q', debouncedQ.trim());
    if (applied.startDate)        p.set('startDate', applied.startDate);
    if (applied.endDate)          p.set('endDate',   applied.endDate);
    if (applied.cityIds.length)   p.set('cityIds',   applied.cityIds.join(','));
    if (applied.ownerIds.length)  p.set('ownerIds',  applied.ownerIds.join(','));
    return `/orders/counts?${p.toString().replace(/%2C/g, ',')}`;
  }, [applied, debouncedQ, spoc.id]);

  const countsRes = useFetch<{ otherOrders: number; completedOrders: number }>(countsPath);
  const counts = countsRes.data ?? { otherOrders: 0, completedOrders: 0 };

  const { data, error, loading } = useFetch<{ items: Job[]; total: number }>(fetchPath);

  const items = data?.items ?? [];
  const total = data?.total ?? items.length;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIdx = Math.min(page * pageSize, total);

  const hasStagedChanges = filtersDiffer(staged, applied);
  const hasAnyApplied =
    applied.startDate || applied.endDate ||
    applied.cityIds.length || applied.ownerIds.length || applied.bucketValues.length;

  function applyFilters() { setApplied(staged); }
  function resetFilters() {
    setStaged(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setQ('');
  }

  // ─── Export to Excel ────────────────────────────────────────────────
  // Mandatory date-range guard preserved from legacy
  // job-status-header.component.ts:122-143.
  //
  // Export reads from STAGED filters (live UI state), NOT applied — so
  // the user can pick date + city + bucket and immediately download
  // without first clicking Apply Filter to reload the table. The only
  // hard gate is the date range (both From + To) and the ≤ 60-day cap.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportGate = useMemo(() => {
    if (!staged.startDate || !staged.endDate) {
      return { ok: false, reason: 'Pick a date range (both From and To) to enable export.' };
    }
    const ms = new Date(staged.endDate).getTime() - new Date(staged.startDate).getTime();
    const days = Math.floor(ms / 86_400_000);
    if (days > 60) {
      return { ok: false, reason: `Date range is ${days} days. Maximum allowed is 60 days — narrow the range to export.` };
    }
    return { ok: true, reason: '' };
  }, [staged.startDate, staged.endDate]);

  // Popup-style notice. Replaces the silent "disabled button does
  // nothing" behaviour — when the export gate rejects (no date range,
  // > 60 days, etc.), we surface the reason in a modal the user
  // actually sees instead of a tooltip they have to hover to discover.
  const [gateNotice, setGateNotice] = useState<string | null>(null);

  async function handleExport() {
    if (!exportGate.ok) {
      // Show the gate reason in a centred popup AND keep the legacy
      // setExportError banner — covers both at-glance and scroll-up
      // surfaces. Returning early stops the download from firing.
      setGateNotice(exportGate.reason);
      setExportError(exportGate.reason);
      return;
    }
    setExporting(true); setExportError(null);
    try {
      const params = new URLSearchParams();
      params.set('flag',       tab);
      params.set('clientSpocId', String(spoc.id));
      // All filter values pulled from `staged` (what's currently in the
      // UI), not `applied`. Lets the user tweak inputs and export
      // without round-tripping through Apply Filter.
      if (staged.bucketValues.length > 0) {
        const flat = staged.bucketValues.flatMap((v) => v.split(',')).filter(Boolean).join(',');
        params.set('statuses', flat);
      } else {
        params.set('statuses', LEGACY_STATUS_SET.join(','));
      }
      if (debouncedQ.trim())        params.set('q', debouncedQ.trim());
      params.set('startDate', staged.startDate);
      params.set('endDate',   staged.endDate);
      if (staged.cityIds.length)    params.set('cityIds',   staged.cityIds.join(','));
      if (staged.ownerIds.length)   params.set('ownerIds',  staged.ownerIds.join(','));
      params.set('dateType', 'created');
      const ts = new Date().toISOString().slice(0, 10);
      // Same %2C → "," cleanup as the list fetch — purely cosmetic.
      const qs = params.toString().replace(/%2C/g, ',');
      await downloadBlob(`/export/jobs?${qs}`, `OrderHistory_${ts}.xlsx`);
    } catch (err) {
      // The backend returns a structured 404 when the filter set
      // matches zero jobs (see /export/jobs route). We surface that
      // case in the SAME amber popup the date-range gate uses, so
      // the user has one consistent "why didn't I get a file?"
      // surface. Everything else (network failure, 5xx) falls
      // through to the existing inline error banner.
      const msg = err instanceof ApiError ? err.message : 'Export failed';
      if (err instanceof ApiError && err.status === 404) {
        setGateNotice(msg);
      }
      setExportError(msg);
    } finally {
      setExporting(false);
    }
  }

  // Column counts — used for "loading…" colspans.
  const otherColCount = 10;       // All Orders tab
  const completedColCount = 10;   // Completed tab
  const colCount = tab === 'otherOrders' ? otherColCount : completedColCount;

  return (
    <div className="space-y-5">
      {/* Title + action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">My Order History</h1>
          <p className="text-sm text-ink-500">{currentTab.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Legacy parity: job-status-header.component "Escalate" button —
              navigates to the Escalated Orders list. Maps to legacy
              openEscalated() → router.navigate(['/escalated/escalated']). */}
          <Link
            href="/tickets/escalated"
            className="btn-outline"
            title="View escalated orders"
          >
            <AlertTriangle className="w-4 h-4 text-primary" /> Escalate
          </Link>
          <Link href="/jobs/upload" className="btn-outline" title="Bulk-upload orders via .xlsx">
            <Upload className="w-4 h-4" /> Bulk Upload
          </Link>
          {/* Stays clickable even when the gate fails — the click now
              opens an explanatory popup instead of being silently
              swallowed by HTML `disabled`. `exporting` still hard-
              disables while a download is in-flight to stop double-fires. */}
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="btn-outline disabled:cursor-not-allowed disabled:opacity-60"
            title={exportGate.ok
              ? 'Download Excel using the current filter inputs (date range mandatory, max 60 days)'
              : exportGate.reason}
          >
            <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Export'}
          </button>
          <Link
            href="/jobs/new"
            title="Raise a new technician booking"
            className="px-5 py-2.5 text-sm font-semibold rounded-xl text-white inline-flex items-center gap-1.5 transition hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(145deg,var(--ef-red-500),var(--ef-red-600))',
              boxShadow: '0 12px 24px -10px rgb(var(--ef-red-600-rgb) / 0.7)',
            }}
          >
            <Plus className="w-4 h-4" /> New Order
          </Link>
        </div>
      </div>

      {/* Tabs — with live counts (legacy parity, badge style matches
          the My New Tickets page). */}
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
              <span>{t.label}</span>
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded-full text-xs font-semibold',
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
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
          {tab === 'otherOrders' && (
            <div>
              <label className="block text-xs font-medium text-ink-500 mb-1">Bucket</label>
              <MultiSelect
                label="All Buckets"
                options={BUCKET_OPTIONS}
                value={staged.bucketValues}
                onChange={(v) => setStaged((s) => ({ ...s, bucketValues: v }))}
              />
            </div>
          )}
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

      {(error || exportError) && (
        <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {exportError || error}
        </div>
      )}

      {/* TABLE — fluid: no horizontal scroll. Explicit per-column
          widths via <colgroup> + `table-fixed w-full` so unbreakable
          strings (long client-ref-ids, mobile numbers) truncate with
          an ellipsis instead of bleeding into the next column. The
          badge cells use a smaller text size + can wrap on spaces. */}
      <div className="card">
        <table className="data-table table-fixed w-full">
          {tab === 'otherOrders' ? (
            <colgroup>
              <col className="w-[7%]"  />{/* Job ID */}
              <col className="w-[9%]"  />{/* Ref ID */}
              <col className="w-[11%]" />{/* Client Ref ID */}
              <col className="w-[9%]"  />{/* City */}
              <col className="w-[12%]" />{/* Customer */}
              <col className="w-[10%]" />{/* Appointment */}
              <col className="w-[13%]" />{/* Status Of Order */}
              <col className="w-[13%]" />{/* Bucket */}
              <col className="w-[10%]" />{/* Source */}
              <col className="w-[6%]"  />{/* Age */}
            </colgroup>
          ) : (
            <colgroup>
              <col className="w-[8%]"  />{/* Job ID */}
              <col className="w-[12%]" />{/* Client Ref ID */}
              <col className="w-[10%]" />{/* City */}
              <col className="w-[7%]"  />{/* OTA */}
              <col className="w-[7%]"  />{/* TAT */}
              <col className="w-[12%]" />{/* Appointment */}
              <col className="w-[12%]" />{/* App Start */}
              <col className="w-[10%]" />{/* Billing Value */}
              <col className="w-[8%]"  />{/* Rating */}
              <col className="w-[14%]" />{/* Action */}
            </colgroup>
          )}
          <thead>
            {tab === 'otherOrders' ? (
              <tr>
                <th>Job ID</th>
                <th>Ref ID</th>
                <th>Client Ref ID</th>
                <th>City</th>
                <th>Customer</th>
                <th>Appointment</th>
                <th>Status Of Order</th>
                <th>Bucket</th>
                <th>Source</th>
                <th>Age</th>
              </tr>
            ) : (
              <tr>
                <th>Job ID</th>
                <th>Client Ref ID</th>
                <th>City</th>
                <th>OTA</th>
                <th>TAT</th>
                <th>Appointment</th>
                <th>App Start</th>
                <th>Billing Value</th>
                <th>Rating</th>
                <th>Action</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={colCount} className="text-center text-ink-500 py-8">Loading…</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={colCount} className="text-center text-ink-500 py-8">No orders found.</td></tr>
            )}
            {!loading && tab === 'otherOrders' && items.map((j) => {
              const age = ageInDays(j.requested_date_time);
              return (
                <tr key={j.job_id} className="hover:bg-primary-50/50">
                  <td>
                    <button type="button" onClick={() => openJobDrawer(j.job_id)} className="text-primary hover:underline font-semibold inline-flex items-center gap-1">
                      #{j.job_id}
                      {j.is_escalated ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-warning" aria-label="Escalated" />
                      ) : null}
                    </button>
                  </td>
                  <td className="text-xs font-mono truncate" title={j.job_reference_id || ''}>
                    {j.job_reference_id || '—'}
                  </td>
                  <td className="text-xs font-mono truncate" title={j.client_ref_id || ''}>
                    {j.client_ref_id || '—'}
                  </td>
                  <td className="truncate" title={j.city_name || ''}>{j.city_name || '—'}</td>
                  <td className="truncate" title={j.customer_name || ''}>
                    <div className="text-ink-900 truncate">{j.customer_name || '—'}</div>
                  </td>
                  <td className="text-xs">{formatIstDayDate(j.requested_date_time)}</td>
                  <td>
                    {/* Status Of Order — legacy parity: this column holds
                        the static status→category label
                        (CommonUtils.java#getBucketStatusForJob).
                        Examples: status 3/5 → "Completed", 9 → "New Ticket". */}
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 leading-tight text-center',
                      statusBadgeClass(j.job_status)
                    )}>
                      {getBucketStatusForJob(j.job_status) || '—'}
                    </span>
                  </td>
                  {/* Bucket — legacy parity: this column holds the
                      context-aware sub-status
                      (CommonUtils.java#getBucketCurrentStatusForJob).
                      Examples: "Ready for Billing", "Tx Allocated",
                      "Estimate Approved". Falls back to the static
                      bucket name when no contextual rule matches.
                      Colour-coded via bucketBadgeClass so each label
                      gets the same pastel tone it had in legacy. */}
                  <td>
                    {(() => {
                      const label = getBucketCurrentStatusForJob(j) || getBucketStatusForJob(j.job_status) || '—';
                      return (
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 leading-tight text-center',
                          bucketBadgeClass(label)
                        )}>
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="text-xs">{j.source_type || '—'}</td>
                  <td className="text-xs">{age != null ? `${age} d` : '—'}</td>
                </tr>
              );
            })}
            {!loading && tab === 'completedOrders' && items.map((j) => (
              <tr key={j.job_id} className="hover:bg-primary-50/50">
                <td>
                  <button type="button" onClick={() => openJobDrawer(j.job_id)} className="text-primary hover:underline font-semibold inline-flex items-center gap-1">
                    #{j.job_id}
                    {j.is_escalated ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-warning" aria-label="Escalated" />
                    ) : null}
                  </button>
                </td>
                <td className="text-xs font-mono">{j.client_ref_id || '—'}</td>
                <td>{j.city_name || '—'}</td>
                <td className="text-xs">{computeOTA(j)}</td>
                <td className="text-xs">{computeTAT(j)}</td>
                <td className="text-xs">
                  <div>{formatIstDayDate(j.requested_date_time)}</div>
                  {j.time_slot && <div className="text-ink-500">{j.time_slot}</div>}
                </td>
                <td className="text-xs">{formatIstDayDate(j.checkin_date_time)}</td>
                {/* Billing Value — total comes from SUM(job_services); not
                    yet computed in the new backend. Showing "—" keeps the
                    column shape for legacy parity. */}
                <td className="text-xs text-ink-300">—</td>
                <td>
                  {j.rating ? (
                    <span className="inline-flex items-center gap-1 text-gold">
                      <Star className="w-3.5 h-3.5 fill-gold stroke-gold" />
                      <span className="text-xs font-semibold">{j.rating}</span>
                    </span>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </td>
                <td>
                  {/* Legacy "Reopen Invoice" / "Reopened" button — opens
                      the detail panel; flag flips after backend re-open. */}
                  <Link
                    href={`/jobs/${j.job_id}`}
                    className={cn(
                      // whitespace-nowrap keeps "Reopen Invoice" on a
                      // single line — the column is narrow enough that
                      // the default wrapping broke "Reopen" / "Invoice"
                      // across two lines.
                      'inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold transition whitespace-nowrap',
                      j.job_reopen_flag === 1
                        ? 'bg-ink-100 text-ink-500 ring-1 ring-ink-300/40'
                        : 'bg-primary text-white hover:bg-primary-dark'
                    )}
                    title={j.job_reopen_flag === 1 ? 'Invoice was reopened' : 'Reopen invoice'}
                  >
                    <RotateCcw className="w-3 h-3 shrink-0" />
                    {j.job_reopen_flag === 1 ? 'Reopened' : 'Reopen'} Invoice
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

      {/* Export gate popup — opens when handleExport finds the gate
          failed (no date range or > 60 days). Replaces the
          easy-to-miss tooltip with an explicit centred dialog. */}
      {gateNotice && (
        <ExportGatePopup
          message={gateNotice}
          onClose={() => setGateNotice(null)}
        />
      )}
    </div>
  );
}

/*
 * ExportGatePopup — small centred modal that explains why an export
 * was blocked. Portaled to <body> so it escapes any local stacking
 * context (the dashboard table has its own z-index). Escape key +
 * backdrop click close the dialog.
 */
function ExportGatePopup({
  message, onClose,
}: {
  message: string; onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Escape closes the popup — standard accessibility behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-ink-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-surface rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Warning header — "warning, not error" tone. Same gradient
            family as the rest of our modals so the dashboard feels
            consistent. Token, not decoration: this header IS the warning
            state, so it must move if the brand's warning colour moves. */}
        <div className="bg-gradient-to-br from-warning/80 via-warning to-warning px-5 pt-5 pb-6 text-center relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 grid place-items-center text-white transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white/20 backdrop-blur grid place-items-center shadow-lg">
            <AlertTriangle className="w-7 h-7 text-white" />
          </div>
          <h2 className="mt-3 text-lg font-semibold text-white">Nothing to export</h2>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm text-ink-700 leading-relaxed text-center">
            {message}
          </p>
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-warning/80 to-warning text-white shadow hover:shadow-md transition"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
