/**
 * Open jobs — the console's working screen.
 *
 * Built to the design the client team shared, block for block: a toolbar of
 * filters over a five-bucket AGE BAND, then the list beside a detail pane that
 * carries the job's actions, its facts and its written record. Every piece of
 * chrome comes from src/components/ui/console, so this file holds composition,
 * arithmetic and data handling — not styling.
 *
 * WHY THE OPEN BOOK IS LOADED WHOLE, NOT PAGED
 *
 * The age band is a READOUT and a FILTER at once: each bucket shows a count and
 * a share of open, and clicking it narrows the list. If the counts came from a
 * server aggregate and the rows from a page of /jobs, the two would disagree the
 * moment the client had more open jobs than one page — the bucket would claim 42
 * and the list would show 30. So both come from ONE set: the client's open book,
 * pulled once per scope change.
 *
 * `/jobs` takes a single `status`, so "open" is seven parallel calls — the same
 * seven codes Home counts as open (9 new + 0/1/2/20 in flight) plus 15 awaiting
 * approval and 21 on hold, which are open precisely BECAUSE they are waiting on
 * someone. Each call is capped; if a cap is hit the page says so rather than
 * quietly under-counting a bucket.
 *
 * WHERE THE FILTERS RUN
 *
 *   SPOC   → server. `/jobs?spoc=<contactId>` is the API's own reporting-
 *            hierarchy filter, so it narrows the set before it is counted.
 *   city / work type / search → browser. The client route forwards only
 *            status, q, a date window and paging to jobService.list — it has no
 *            city or category parameter to forward — and `q` also matches
 *            mobile numbers and job ids, which the mock's "Search store or
 *            city…" does not promise. Filtering the loaded book locally is both
 *            what the placeholder says and instant.
 *
 * WHERE THE NUMBERS COME FROM, AND WHERE THEY DO NOT
 *
 * The mock was drawn against a richer dataset than this API exposes. Where a
 * figure or a control had no honest source it is labelled for what it actually
 * is rather than made to read like the mock. Each one is marked SUBSTITUTED.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, Loader2, MapPin, MessageSquare, Search, User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fetchAllJobs, useFetchOnce } from '@/lib/hooks';
import { openJobDrawer } from '@/components/job-drawer';
import { STATUS_LABELS } from '@/lib/utils';
import {
  PageHeader, SectionLabel, Toolbar, FilterChip, AgeBand, SplitLayout,
  DataTable, Row, Cell, Pill, Panel, Banner, DetailPane, MetaRow,
  ActionButton, EmptyState, type Accent,
} from '@/components/ui/console';

/* ─── contracts ───────────────────────────────────────────────────────────
 * Written against the handlers, not the mock: GET /jobs projects
 * job.service.js LIST_COLUMNS + JOB_AGE_COLUMNS, GET /jobs/:id projects
 * `j.*` plus the detail joins and the shaped services array.
 */

/** The LIST_COLUMNS fields this page reads. Everything else is ignored. */
type JobRow = {
  job_id: number;
  job_reference_id: string | null;
  client_ref_id: string | null;
  job_status: number;
  job_type: string | null;
  /** LEFT(j.job_desc, 200) — already truncated by the projection. */
  job_desc: string | null;
  customer_name: string | null;
  city_name: string | null;
  /** sc.service_catg_name, aliased `service_category` by LIST_COLUMNS. */
  service_category: string | null;
  client_spoc_name: string | null;
  easyfixer_name: string | null;
  fk_easyfixter_id: number | null;
  requested_date_time: string | null;
  ticket_created_date_time: string | null;
  /** GREATEST(TIMESTAMPDIFF(DAY, ticket_created, terminal-or-now), 0). */
  ageDays: number | string | null;
};

/** GET /jobs/:id — `j.*` plus joins, so every tbl_job column arrives raw. */
type JobDetail = JobRow & {
  fk_client_id: number;
  remarks: string | null;
  client_spoc: string | null;
  created_date_time: string | null;
  created_by_name: string | null;
  owner_name: string | null;
  efr_special_notes: string | null;
  approval_sent_on_date_time: string | null;
  approved_on_date_time: string | null;
  approval_reject_date_time: string | null;
  approval_reject_reason: string | null;
  cancel_date_time: string | null;
  cancel_comment: string | null;
  cancel_reason_name: string | null;
  cancelled_by_name: string | null;
  services: Array<{
    job_service_id: number;
    service_name: string | null;
    service_catg_name: string | null;
    service_type_name: string | null;
    quantity: number | null;
    job_service_status: number;
    billing_label: string;
    effective_charge: number | string | null;
  }>;
};

/** GET /jobs/:id/estimate-preview — the canonical estimate figure. */
type EstimatePreview = {
  job_id: number;
  totals: { services_subtotal: number; material_subtotal: number; grand_total: number };
  already_approved: boolean;
  already_rejected: boolean;
};

/** GET /action-queue — the rows the SPOC personally has to clear. */
type QueueItem = {
  type: string;
  jobId: number;
  reference: string | null;
  city: string | null;
  category: string | null;
  ageDays: number;
  estimateValue: number | null;
  action: { label: string; method: string; path: string };
};

/** GET /team — `isManager` decides whether the SPOC filter is even offered. */
type TeamMember = { id: number; name: string | null };

/* ─── the open book ───────────────────────────────────────────────────────
 * Home counts open as newTickets (9) + inProgress (0, 1, 2, 20). This screen
 * adds 15 and 21: an estimate awaiting the client's answer and a job held for
 * parts are open precisely BECAUSE they are waiting on someone. The seven codes
 * are exactly the set the backend's own SLA-ageing query treats as still active
 * (routes/client/index.js — `j.job_status IN (0,1,2,20,9,15,21)`).
 *
 * /action-queue is NOT confined to those seven. Its SQL selects on two unanswered
 * approval stamps plus `job_status NOT IN (3,5,6)` — there is no status-15
 * predicate — so it can hold jobs in states this screen never loads. That is why
 * the "Your action needed" chip counts the rows in THIS book rather than the
 * queue's own total; see queueCount below.
 */
const OPEN_STATUSES = [9, 0, 1, 2, 20, 15, 21] as const;

/** Per-status ceiling. fetchAllJobs pages at 500, so this is at most two calls. */
const PER_STATUS_CAP = 1000;

function useOpenBook(spocId: number | null) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scope = spocId ? `&spoc=${spocId}` : '';
      const pages = await Promise.all(
        OPEN_STATUSES.map((s) => fetchAllJobs<JobRow>(`status=${s}${scope}`, PER_STATUS_CAP)),
      );
      setTruncated(pages.some((p) => p.length >= PER_STATUS_CAP));
      setJobs(pages.flat());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your open jobs');
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [spocId]);

  useEffect(() => { void load(); }, [load]);
  return { jobs, loading, error, truncated, reload: load };
}

/* ─── ageing ──────────────────────────────────────────────────────────────
 * Five mutually exclusive buckets, in this precedence:
 *
 *   FUTURE   the committed appointment is still ahead — the job is not late,
 *            it is booked. (Home calls this "not yet due".)
 *   the rest the job's AGE in days, straight off the API's `ageDays`, which is
 *            ticket-created → now (or → the terminal stamp). One measure, so the
 *            band, the Age column and the row's severity rule can never disagree.
 *
 * SUBSTITUTED: /dashboard-summary already ships an slaAging aggregate, and it is
 * NOT used here. Its buckets are days past the appointment cut at 0–1 / 2–3 /
 * 4–7 / >7 — the last two are not the mock's 4–5 and >5, and its population
 * (overdue jobs only) is not this list's. Rendering it under the mock's labels
 * would print a number whose definition contradicts its caption.
 */
type BucketKey = 'future' | 'd01' | 'd23' | 'd45' | 'd5plus';

const BUCKETS: ReadonlyArray<{ key: BucketKey; label: string; accent: Accent }> = [
  { key: 'future', label: 'Future', accent: 'success' },
  { key: 'd01', label: '0–1 day', accent: 'success' },
  { key: 'd23', label: '2–3 days', accent: 'info' },
  { key: 'd45', label: '4–5 days', accent: 'warning' },
  { key: 'd5plus', label: '> 5 days', accent: 'brand' },
];

const BUCKET_ACCENT: Record<BucketKey, Accent> = {
  future: 'success', d01: 'success', d23: 'info', d45: 'warning', d5plus: 'brand',
};

const parse = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
};

const ageDaysOf = (j: JobRow) => {
  const n = Number(j.ageDays);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

function bucketOf(j: JobRow, now: number): BucketKey {
  const appt = parse(j.requested_date_time);
  if (appt && appt.getTime() > now) return 'future';
  const d = ageDaysOf(j);
  if (d <= 1) return 'd01';
  if (d <= 3) return 'd23';
  if (d <= 5) return 'd45';
  return 'd5plus';
}

/* ─── vocabulary ──────────────────────────────────────────────────────────
 * lib/utils exposes the CRM's own status vocabulary, but it speaks to
 * operators — "Tx Ongoing Order", "Full-Fillement on Hold". A client reading
 * their own book needs the same states in their own words, and the colour has
 * to carry the meaning: red is the one that is waiting on THEM.
 */
function statusOf(j: JobRow): { label: string; cls: string } {
  switch (j.job_status) {
    case 9: return { label: 'New Ticket', cls: 'text-info' };
    case 0: return j.fk_easyfixter_id
      ? { label: 'Technician Assigned', cls: 'text-info' }
      : { label: 'Awaiting Technician', cls: 'text-warning' };
    case 1: return { label: 'Scheduled', cls: 'text-info' };
    case 2:
    case 20: return { label: 'Technician On Site', cls: 'text-success' };
    case 15: return { label: 'Awaiting Your Approval', cls: 'text-primary' };
    case 21: return { label: 'On Hold', cls: 'text-warning' };
    default: return {
      label: STATUS_LABELS[j.job_status] || `Status ${j.job_status}`,
      cls: 'text-ink-500',
    };
  }
}

/** The store this job is for. Each client site is a customer record. */
const storeOf = (j: JobRow) =>
  j.customer_name || j.client_ref_id || j.job_reference_id || `Job ${j.job_id}`;

const workOf = (j: JobRow) => j.service_category || 'Uncategorised';
const cityOf = (j: JobRow) => j.city_name || 'Unknown';

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

const fmtDay = (s?: string | null) => {
  const d = parse(s);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
};
const fmtStamp = (s?: string | null) => {
  const d = parse(s);
  return d
    ? d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;
};

/* ─── the written record ──────────────────────────────────────────────────
 * SUBSTITUTED: the mock's right-hand pane ends in a live comment thread. The
 * client API has no job-comment endpoint at all — tbl_job_comment is written by
 * the escalate route and read by nobody on this surface — so there is nothing to
 * fetch and nothing to post to. Rather than draw an empty box or fake a post,
 * the thread renders the job's REAL written record from the detail payload:
 * the booking note, the order remarks, the note left FOR the technician, and
 * each recorded decision with its own timestamp. The composer is present but
 * disabled and says why.
 */
type Entry = { author: string; text: string; at: string | null; sort: number };

/** Strip the two `[Label] value` lines composeRemarks() folds into remarks. */
function cleanRemarks(raw: string | null): string {
  if (!raw) return '';
  return String(raw)
    .split('\n')
    .filter((l) => !/^\[(Product Code|Building \/ Property)\]/.test(l.trim()))
    .join('\n')
    .trim();
}

function threadOf(j: JobDetail): Entry[] {
  const anchor = parse(j.ticket_created_date_time || j.created_date_time)?.getTime() ?? 0;
  const at = (s: string | null | undefined) => parse(s)?.getTime() ?? anchor;
  const out: Entry[] = [];

  const booked = (j.job_desc || '').trim();
  if (booked) {
    out.push({
      author: j.created_by_name ? `${j.created_by_name} · booking` : 'Booking note',
      text: booked,
      at: j.ticket_created_date_time || j.created_date_time,
      sort: anchor,
    });
  }

  const remarks = cleanRemarks(j.remarks);
  if (remarks && remarks !== booked) {
    // No timestamp of its own on tbl_job.remarks — so none is shown.
    out.push({ author: 'Order remarks', text: remarks, at: null, sort: anchor + 1 });
  }

  if (j.approval_sent_on_date_time) {
    out.push({
      author: 'EasyFix',
      text: 'Estimate sent for your approval.',
      at: j.approval_sent_on_date_time,
      sort: at(j.approval_sent_on_date_time),
    });
  }
  if (j.approved_on_date_time) {
    out.push({
      // approved_by_client_contact holds a contact id the payload never resolves
      // to a name, so the actor is named by role rather than invented.
      author: 'Your team',
      text: 'Estimate approved.',
      at: j.approved_on_date_time,
      sort: at(j.approved_on_date_time),
    });
  }
  if (j.approval_reject_date_time) {
    out.push({
      author: 'Your team',
      text: j.approval_reject_reason
        ? `Estimate rejected — ${j.approval_reject_reason}`
        : 'Estimate rejected.',
      at: j.approval_reject_date_time,
      sort: at(j.approval_reject_date_time),
    });
  }
  if ((j.efr_special_notes || '').trim()) {
    out.push({
      // efr_special_notes is the note written FOR the technician, never BY one.
      // It is captured at booking (validators/job.validator.js: "Special notes
      // for the technician — visible in mobile app job detail"), the integration
      // APIs map their `specialComments` field onto it, and no technician
      // surface writes it. Attributing it to the assigned easyfixer by name
      // would put words in a real person's mouth, so it is labelled for what it
      // is and carries no author.
      author: 'Note for the technician',
      text: String(j.efr_special_notes).trim(),
      at: null,
      sort: anchor + 2,
    });
  }
  if (j.cancel_date_time || j.cancel_comment) {
    out.push({
      author: j.cancelled_by_name || 'Cancellation',
      text: [j.cancel_reason_name, j.cancel_comment].filter(Boolean).join(' — ') || 'Order cancelled.',
      at: j.cancel_date_time,
      sort: at(j.cancel_date_time),
    });
  }

  return out.sort((a, b) => a.sort - b.sort);
}

/* ─── page ────────────────────────────────────────────────────────────── */

const FIELD =
  'w-full rounded-lg border border-ink-100 bg-surface px-3 py-2 text-xs text-ink-900 '
  + 'placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed';

/** How many rows the table renders before the "show more" footer. */
const PAGE_STEP = 50;

export default function OpenJobsPage() {
  /* filters */
  const [spocId, setSpocId] = useState<number | null>(null);
  const [city, setCity] = useState('');
  const [work, setWork] = useState('');
  const [term, setTerm] = useState('');
  const [actionOnly, setActionOnly] = useState(false);
  const [bucket, setBucket] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_STEP);

  /* selection */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [autoPick, setAutoPick] = useState(true);

  /* pane action state */
  const [busy, setBusy] = useState<'approve' | 'reject' | 'escalate' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [escOpen, setEscOpen] = useState(false);
  const [escReason, setEscReason] = useState('');
  const [escComment, setEscComment] = useState('');

  const book = useOpenBook(spocId);
  const queue = useFetchOnce<{ items: QueueItem[]; total: number }>('/action-queue?limit=100');
  const team = useFetchOnce<{ items: TeamMember[]; isManager: boolean }>('/team');
  // The endpoint the spec names for the page total. It counts the client's WHOLE
  // book, not the open part — see the header line where it is used.
  const orders = useFetchOnce<{ otherOrders: number; completedOrders: number }>('/orders/counts');

  const detail = useFetchOnce<JobDetail>(selectedId ? `/jobs/${selectedId}` : null);
  const estimate = useFetchOnce<EstimatePreview>(
    selectedId ? `/jobs/${selectedId}/estimate-preview` : null,
  );
  // Escalation reasons — action_type 23, user_type 4. Fetched only once the
  // escalate form is actually opened.
  const reasons = useFetchOnce<{ items: Array<{ id: number; label: string }> }>(
    escOpen ? '/lookup/reasons?actionType=23' : null,
  );

  const now = useMemo(() => Date.now(), []);
  const jobs = book.jobs;

  const queueIds = useMemo(
    () => new Set((queue.data?.items ?? []).map((i) => i.jobId)),
    [queue.data],
  );

  /*
   * Chip options come from the LOADED BOOK, not from /cities and
   * /lookup/service-categories. Those list everything the client has ever used;
   * this screen is about what is open right now, so an option that would select
   * zero rows should not be offered.
   */
  const cityOptions = useMemo(
    () => [...new Set(jobs.map(cityOf))].sort((a, b) => a.localeCompare(b)),
    [jobs],
  );
  const workOptions = useMemo(
    () => [...new Set(jobs.map(workOf))].sort((a, b) => a.localeCompare(b)),
    [jobs],
  );

  /* Everything except the age selection — this is what the band describes. */
  const scoped = useMemo(() => {
    const q = term.trim().toLowerCase();
    return jobs.filter((j) => {
      if (city && cityOf(j) !== city) return false;
      if (work && workOf(j) !== work) return false;
      if (actionOnly && !queueIds.has(j.job_id)) return false;
      if (!q) return true;
      return [storeOf(j), cityOf(j), j.client_ref_id, j.job_reference_id]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [jobs, city, work, term, actionOnly, queueIds]);

  const bands = useMemo(() => {
    const tally: Record<BucketKey, number> = { future: 0, d01: 0, d23: 0, d45: 0, d5plus: 0 };
    for (const j of scoped) tally[bucketOf(j, now)] += 1;
    const total = scoped.length || 1;
    return BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      value: tally[b.key],
      sub: `${Math.round((tally[b.key] / total) * 100)}% of open`,
      accent: b.accent,
    }));
  }, [scoped, now]);

  /* Oldest first — a console's list should open on the thing that is worst. */
  const rows = useMemo(() => {
    const sel = bucket as BucketKey | null;
    return scoped
      .filter((j) => !sel || bucketOf(j, now) === sel)
      .sort((a, b) => {
        const fa = bucketOf(a, now) === 'future' ? 1 : 0;
        const fb = bucketOf(b, now) === 'future' ? 1 : 0;
        if (fa !== fb) return fa - fb;
        return ageDaysOf(b) - ageDaysOf(a);
      });
  }, [scoped, bucket, now]);

  /* Open on the first row, but never fight a reader who closed the pane. */
  useEffect(() => {
    if (!autoPick || selectedId != null || rows.length === 0) return;
    setSelectedId(rows[0].job_id);
  }, [autoPick, selectedId, rows]);

  /* A new selection starts with no half-filled forms and no stale confirmation. */
  useEffect(() => {
    setNote(null);
    setRejectOpen(false);
    setRejectReason('');
    setEscOpen(false);
    setEscReason('');
    setEscComment('');
  }, [selectedId]);

  useEffect(() => { setVisible(PAGE_STEP); }, [bucket, city, work, term, actionOnly, spocId]);

  const refresh = useCallback(async (msg: string) => {
    setNote(msg);
    await Promise.all([detail.reload(), estimate.reload(), queue.reload(), book.reload()]);
  }, [detail, estimate, queue, book]);

  const onApprove = useCallback(async () => {
    if (!selectedId) return;
    setBusy('approve');
    setNote(null);
    try {
      await api.patch(`/jobs/${selectedId}/estimate/approve`, {});
      await refresh('Estimate approved. The job is back with EasyFix.');
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not approve the estimate.');
    } finally {
      setBusy(null);
    }
  }, [selectedId, refresh]);

  const onReject = useCallback(async () => {
    if (!selectedId || rejectReason.trim().length < 3) return;
    setBusy('reject');
    setNote(null);
    try {
      await api.patch(`/jobs/${selectedId}/estimate/reject`, { reason: rejectReason.trim() });
      setRejectOpen(false);
      setRejectReason('');
      await refresh('Estimate rejected. Your reason has been sent to the owner.');
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not reject the estimate.');
    } finally {
      setBusy(null);
    }
  }, [selectedId, rejectReason, refresh]);

  const onEscalate = useCallback(async () => {
    if (!selectedId || !escReason) return;
    setBusy('escalate');
    setNote(null);
    try {
      await api.post(`/jobs/${selectedId}/escalate`, {
        reasonId: Number(escReason),
        comment: escComment.trim(),
      });
      setEscOpen(false);
      setEscReason('');
      setEscComment('');
      await refresh('Escalation raised with the EasyFix owner for this job.');
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not raise the escalation.');
    } finally {
      setBusy(null);
    }
  }, [selectedId, escReason, escComment, refresh]);

  /* ─── loading / failure ─────────────────────────────────────────────── */

  if (book.loading && jobs.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-ink-100 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
        <div className="mt-2 text-sm text-ink-500">Loading your open jobs…</div>
      </div>
    );
  }
  if (book.error) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load your open jobs"
          sub={book.error}
          action={<ActionButton onClick={() => void book.reload()}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  /* ─── derived, post-guard ───────────────────────────────────────────── */

  /*
   * The chip counts the rows it can actually SELECT, not the rows /action-queue
   * returned. That endpoint is broader than this book in two ways: it has no
   * status-15 predicate (only unanswered approval stamps + `NOT IN (3,5,6)`), so
   * it can carry jobs in states this screen does not load, and it is fetched
   * without the &spoc= scope the book uses — it even widens to the whole client
   * for an all-stores SPOC. Printing its `total` beside a filter that then
   * selects fewer rows would be a caption contradicting its own control. The
   * unfiltered queue is the /action-queue page.
   */
  const queueCount = jobs.filter((j) => queueIds.has(j.job_id)).length;
  // The route caps its own limit at 100 and reports total = rows returned, so a
  // full page means more may be waiting than this screen has been told about.
  const queueLabel = `Your action needed (${queueCount}${(queue.data?.total ?? 0) >= 100 ? '+' : ''})`;

  const selected = rows.find((j) => j.job_id === selectedId)
    ?? jobs.find((j) => j.job_id === selectedId)
    ?? null;
  /*
   * useFetchOnce keeps the PREVIOUS payload on screen while the next one loads.
   * That is right for a refresh and wrong for a new selection — it would print
   * job A's estimate under job B's header. Both detail reads are therefore
   * accepted only when they belong to the row currently selected.
   */
  const d = detail.data && detail.data.job_id === selectedId ? detail.data : null;
  const est = estimate.data && estimate.data.job_id === selectedId ? estimate.data : null;
  const estimatePending = !!est && !est.already_approved && !est.already_rejected
    && est.totals.grand_total > 0;
  const selectedBucket = selected ? bucketOf(selected, now) : null;
  const canEscalate = !!selected && !estimatePending && selectedBucket !== 'future';

  const scopeName = spocId
    ? (team.data?.items ?? []).find((m) => m.id === spocId)?.name || 'Selected SPOC'
    : null;

  return (
    <>
      <PageHeader
        title="Open jobs"
        sub={
          // SUBSTITUTED: the spec sources the page total from /orders/counts, but
          // that endpoint's `otherOrders` is COUNT(*) over the client's ENTIRE
          // book with no status predicate — it is not an open figure. It is shown
          // here as what it counts, and the open total stays on the toolbar,
          // where it is the size of the set the list actually holds.
          orders.data
            ? `${orders.data.otherOrders.toLocaleString('en-IN')} orders on file · ${jobs.length.toLocaleString('en-IN')} of them open`
            : `${jobs.length.toLocaleString('en-IN')} open jobs loaded`
        }
        filters={
          <ActionButton onClick={() => void book.reload()} disabled={book.loading}>
            {book.loading ? 'Refreshing…' : 'Refresh'}
          </ActionButton>
        }
      />

      <Toolbar count={`${scoped.length.toLocaleString('en-IN')} open jobs`}>
        <label className="relative inline-flex items-center">
          <Search className="absolute left-3 w-3.5 h-3.5 text-ink-300 pointer-events-none" aria-hidden />
          <span className="sr-only">Search store or city</span>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search store or city…"
            className="w-56 rounded-full border border-ink-100 bg-surface pl-8 pr-3 py-1.5 text-xs text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>

        {/*
          The console has no menu primitive, and adding one would be a rival to
          FilterChip. So each chip stays the FilterChip it is and a transparent
          native <select> sits over it: the chip is the face, the select is the
          control — real keyboard support, real mobile pickers, no popover state.
        */}
        <ChipSelect
          icon={MapPin}
          label={city || 'All cities'}
          value={city}
          onChange={setCity}
          allLabel="All cities"
          options={cityOptions}
        />
        <ChipSelect
          icon={Building2}
          label={work || 'All work types'}
          value={work}
          onChange={setWork}
          allLabel="All work types"
          options={workOptions}
        />
        {team.data?.isManager ? (
          <ChipSelect
            icon={User}
            label={scopeName || 'All SPOCs'}
            value={spocId ? String(spocId) : ''}
            onChange={(v) => setSpocId(v ? Number(v) : null)}
            allLabel="All SPOCs"
            options={(team.data.items ?? []).map((m) => ({
              value: String(m.id),
              label: m.name || `Contact ${m.id}`,
            }))}
          />
        ) : (
          /* Not a manager: the API scopes every list to this SPOC's own book, so
             a SPOC picker here would be a control that cannot change anything. */
          <FilterChip icon={User}>Your bookings</FilterChip>
        )}

        <FilterChip
          icon={AlertTriangle}
          active={actionOnly}
          onClick={() => setActionOnly((v) => !v)}
          className={actionOnly ? undefined : 'border-primary/40 text-primary'}
        >
          {queueLabel}
        </FilterChip>
      </Toolbar>

      {book.truncated ? (
        <Banner accent="warning" className="mb-4">
          More than {PER_STATUS_CAP.toLocaleString('en-IN')} jobs in one open state — the list and the
          bucket counts below cover the first {PER_STATUS_CAP.toLocaleString('en-IN')} of each. Narrow by
          city or SPOC for an exact picture.
        </Banner>
      ) : null}

      <SectionLabel>Age of open jobs</SectionLabel>
      <AgeBand
        buckets={bands}
        selected={bucket}
        onSelect={setBucket}
        className="mb-6"
      />

      <SectionLabel>
        {bucket ? `${BUCKETS.find((b) => b.key === bucket)?.label} · ${rows.length} jobs` : 'All open jobs'}
      </SectionLabel>

      <SplitLayout
        list={
          rows.length === 0 ? (
            <Panel>
              <EmptyState
                icon={Search}
                title="No open jobs match these filters"
                sub="Clear the age bucket or widen the city and work-type filters."
                action={
                  <ActionButton
                    onClick={() => {
                      setBucket(null); setCity(''); setWork(''); setTerm(''); setActionOnly(false);
                    }}
                  >
                    Clear Filters
                  </ActionButton>
                }
              />
            </Panel>
          ) : (
            <>
              <DataTable
                columns={[
                  { key: 'store', label: 'Store · location' },
                  { key: 'work', label: 'Work needed' },
                  { key: 'age', label: 'Age' },
                  { key: 'status', label: 'Status' },
                  { key: 'action', label: 'Action', align: 'right' },
                ]}
              >
                {rows.slice(0, visible).map((j) => {
                  const b = bucketOf(j, now);
                  const st = statusOf(j);
                  const inQueue = queueIds.has(j.job_id);
                  const label = inQueue ? 'Approve' : b === 'd5plus' ? 'Escalate' : 'View';
                  const appt = parse(j.requested_date_time);
                  return (
                    <Row
                      key={j.job_id}
                      edge={BUCKET_ACCENT[b]}
                      selected={j.job_id === selectedId}
                      onClick={() => setSelectedId(j.job_id)}
                    >
                      <Cell>
                        <div className="text-sm font-semibold text-ink-900 truncate max-w-[16rem]">
                          {storeOf(j)}
                        </div>
                        {/* SUBSTITUTED: the mock's second line is "city, state".
                            Neither /jobs nor /jobs/:id carries a state — the
                            address join stops at tbl_city — so this shows the
                            city and the client's own reference instead of
                            printing a region nothing measured. */}
                        <div className="text-xs text-ink-500 truncate max-w-[16rem]">
                          {[cityOf(j), j.client_ref_id].filter(Boolean).join(' · ')}
                        </div>
                      </Cell>
                      <Cell>
                        <div className="text-sm text-ink-900 truncate max-w-[14rem]">{workOf(j)}</div>
                        <div className="text-xs text-ink-500 truncate max-w-[14rem]">
                          {j.job_type || (j.job_desc || '').trim() || 'No sub-detail recorded'}
                        </div>
                      </Cell>
                      <Cell>
                        <Pill accent={BUCKET_ACCENT[b]}>
                          {b === 'future' ? 'Not yet due' : `${ageDaysOf(j)}d`}
                        </Pill>
                        {b === 'future' && appt ? (
                          <div className="mt-1 text-xs text-ink-300">{fmtDay(j.requested_date_time)}</div>
                        ) : null}
                      </Cell>
                      <Cell>
                        <span className={`text-sm ${st.cls}`}>{st.label}</span>
                        {j.easyfixer_name ? (
                          <div className="text-xs text-ink-500 truncate max-w-[10rem]">{j.easyfixer_name}</div>
                        ) : null}
                      </Cell>
                      <Cell align="right">
                        <ActionButton
                          onClick={() => {
                            setSelectedId(j.job_id);
                            if (label === 'View') openJobDrawer(j.job_id);
                          }}
                        >
                          {label}
                        </ActionButton>
                      </Cell>
                    </Row>
                  );
                })}
              </DataTable>
              {rows.length > visible ? (
                <div className="flex items-center justify-between pt-3 text-xs">
                  <span className="text-ink-500 tabular-nums">
                    Showing {visible} of {rows.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVisible((v) => v + PAGE_STEP)}
                    className="text-info hover:text-info-text font-medium"
                  >
                    Show {Math.min(PAGE_STEP, rows.length - visible)} more →
                  </button>
                </div>
              ) : null}
            </>
          )
        }
        detail={
          selected ? (
            <DetailPane
              eyebrow={`JOB-${selected.job_id} · ${cityOf(selected)}`}
              title={storeOf(selected)}
              sub={workOf(selected)}
              onClose={() => { setAutoPick(false); setSelectedId(null); }}
            >
              {note ? <Banner accent="info">{note}</Banner> : null}

              {/* Primary actions — every one of them posts to a real endpoint.
                  SUBSTITUTED: the mock's row vocabulary also has "Confirm
                  access" and "Raise PO". The client API has neither an access-
                  confirmation call nor any way to raise a purchase order (a PO
                  is an uploaded document on tbl_job_image), so neither is
                  offered — a button that cannot act is worse than none. */}
              {estimatePending ? (
                <div className="space-y-2">
                  <ActionButton
                    variant="primary"
                    size="md"
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() => void onApprove()}
                  >
                    {busy === 'approve'
                      ? 'Approving…'
                      : `Approve Estimate — ${rupees(est!.totals.grand_total)}`}
                  </ActionButton>
                  {rejectOpen ? (
                    <div className="space-y-2">
                      <textarea
                        rows={3}
                        // The route validates reason as min 3 / max 500, so the
                        // field stops where the API does instead of composing a
                        // paragraph the PATCH will 400 on.
                        maxLength={500}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Why is this estimate being rejected? (required)"
                        className={FIELD}
                      />
                      <div className="flex gap-2">
                        <ActionButton
                          size="md"
                          className="flex-1"
                          disabled={busy !== null || rejectReason.trim().length < 3}
                          onClick={() => void onReject()}
                        >
                          {busy === 'reject' ? 'Sending…' : 'Confirm Rejection'}
                        </ActionButton>
                        <ActionButton size="md" onClick={() => setRejectOpen(false)}>Cancel</ActionButton>
                      </div>
                    </div>
                  ) : (
                    <ActionButton
                      size="md"
                      className="w-full"
                      disabled={busy !== null}
                      onClick={() => setRejectOpen(true)}
                    >
                      Reject
                    </ActionButton>
                  )}
                </div>
              ) : null}

              {canEscalate ? (
                escOpen ? (
                  <div className="space-y-2">
                    <select
                      value={escReason}
                      onChange={(e) => setEscReason(e.target.value)}
                      className={FIELD}
                      aria-label="Escalation reason"
                    >
                      <option value="">Choose a reason…</option>
                      {(reasons.data?.items ?? []).map((r) => (
                        <option key={r.id} value={r.id}>{r.label}</option>
                      ))}
                    </select>
                    <textarea
                      rows={2}
                      /* POST /jobs/:id/escalate caps comment at 500 chars. */
                      maxLength={500}
                      value={escComment}
                      onChange={(e) => setEscComment(e.target.value)}
                      placeholder="Anything the owner should know (optional)"
                      className={FIELD}
                    />
                    <div className="flex gap-2">
                      <ActionButton
                        size="md"
                        className="flex-1"
                        disabled={busy !== null || !escReason}
                        onClick={() => void onEscalate()}
                      >
                        {busy === 'escalate' ? 'Raising…' : 'Raise Escalation'}
                      </ActionButton>
                      <ActionButton size="md" onClick={() => setEscOpen(false)}>Cancel</ActionButton>
                    </div>
                  </div>
                ) : (
                  <ActionButton
                    variant={selectedBucket === 'd5plus' ? 'primary' : 'outline'}
                    size="md"
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() => setEscOpen(true)}
                  >
                    Escalate
                  </ActionButton>
                )
              ) : null}

              <ActionButton size="md" className="w-full" onClick={() => openJobDrawer(selected.job_id)}>
                Open Full Job Record
              </ActionButton>

              <div>
                <MetaRow
                  label="Estimate sent"
                  value={fmtDay(d?.approval_sent_on_date_time) || 'Not sent yet'}
                />
                <MetaRow
                  label="Work scope"
                  value={
                    d?.services?.length
                      ? d.services
                        .filter((s) => s.job_service_status === 1)
                        .map((s) => s.service_name || s.service_type_name || s.service_catg_name)
                        .filter(Boolean).slice(0, 3).join(', ') || workOf(selected)
                      : workOf(selected)
                  }
                />
                <MetaRow
                  label="Store SPOC"
                  value={d?.client_spoc_name || selected.client_spoc_name || 'Not recorded'}
                />
                <MetaRow
                  label="Estimate value"
                  value={
                    est
                      ? (est.totals.grand_total > 0
                        ? rupees(est.totals.grand_total)
                        : 'No priced services yet')
                      : estimate.loading ? 'Loading…' : 'Not available'
                  }
                />
              </div>

              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-ink-500 mb-2">
                  <MessageSquare className="w-3.5 h-3.5" aria-hidden />
                  On the record
                </div>
                {detail.loading && !d ? (
                  <div className="text-xs text-ink-500">Loading the job&rsquo;s record…</div>
                ) : d && threadOf(d).length ? (
                  <div className="space-y-2">
                    {threadOf(d).map((c, i) => (
                      <div key={i} className="rounded-lg bg-surface-alt px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-medium text-ink-700 truncate">{c.author}</span>
                          {c.at ? (
                            <span className="shrink-0 text-xs text-ink-300 tabular-nums">{fmtStamp(c.at)}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-700 whitespace-pre-line break-words">
                          {c.text}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-ink-500">
                    Nothing written on this job yet beyond its booking.
                  </div>
                )}

                <textarea
                  rows={2}
                  disabled
                  aria-label="Add a comment or question"
                  placeholder="Add a comment or question… (not available yet)"
                  className={`${FIELD} mt-2 bg-surface-alt`}
                />
                <div className="mt-1 text-xs text-ink-300">
                  Read-only: the client API has no job-comment endpoint, so this thread is the
                  job&rsquo;s written record. Use Escalate to reach the owner.
                </div>
              </div>
            </DetailPane>
          ) : (
            <Panel>
              <EmptyState
                title="No job selected"
                sub="Pick a row to see its estimate, its facts and its record."
              />
            </Panel>
          )
        }
      />
    </>
  );
}

/* ─── chip + select ───────────────────────────────────────────────────────
 * A FilterChip wearing a native <select>. Composition, not a new primitive:
 * the chip is untouched and unrestyled, and every behaviour a dropdown needs
 * comes from the element the platform already ships.
 */
function ChipSelect({
  icon, label, value, onChange, allLabel, options,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: ReadonlyArray<string | { value: string; label: string }>;
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <span className="relative inline-flex">
      <FilterChip icon={icon} active={!!value}>{label}</FilterChip>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={allLabel}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        <option value="">{allLabel}</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}
