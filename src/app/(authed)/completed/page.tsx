/**
 * Completed — the client console's record of closed work.
 *
 * Same frame as Open jobs so the two read as one product: a PageHeader, a
 * Toolbar of scope chips, a four-up StatRow, then a SplitLayout with the list
 * on the left and the selected job's evidence on the right. Every piece of
 * chrome comes from src/components/ui/console; this file holds composition,
 * arithmetic and the honest labelling of what each figure is.
 *
 * WHERE THE ROWS COME FROM
 *
 *   GET /jobs           twice — status=3 and status=5, both windowed on
 *                       dateType=completed (checkout_date_time). The spec asked
 *                       for `?statuses=3,5`, and jobService.list() does support
 *                       a CSV `statuses`, but routes/client/index.js forwards
 *                       ONLY `status` (a single Number) — a `statuses` param is
 *                       dropped silently and the endpoint would return every
 *                       status in the window. A page that quietly counts
 *                       cancellations as completions is worse than two
 *                       requests, so this makes two requests and merges them.
 *   GET /orders/counts  completedOrders. NOT the number of status-3/5 jobs:
 *                       the handler counts ready_for_billing='Yes' rows with no
 *                       sub_job, scoped to the SPOC's direct reports. It is
 *                       reported in the header for exactly that.
 *
 * WHAT THE MOCK SHOWS AND THE API CANNOT SOURCE
 *
 * The mock's four tiles are "N completed / X% first visit fix / Y avg days to
 * close / Z rated excellent", and its rows carry "1st visit / N visits" and a
 * photo count. Two of those have no source on this endpoint:
 *
 *   first visit fix / revisits  needs the `linked_job` parent→child table,
 *                               which only services/client-performance.js
 *                               reads, behind the grant-gated /performance
 *                               route. The client job list carries no revisit
 *                               marker at all (no sub_job_id, no reopen flag).
 *   customer rating             tbl_easyfixer_rating_by_customer is a FILTER
 *                               param on the job list, never a projected
 *                               column. Nothing on the payload says "excellent".
 *
 * So those tiles measure what the payload really carries — a technician
 * check-in, and closure inside a day — and say so on their own labels. Each is
 * marked SUBSTITUTED below with its reason. A traceable number beats a pretty
 * one.
 */
'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2, UserCheck, Clock, CalendarCheck, ListChecks, Camera, ImageOff,
  MapPin, Wrench, CalendarDays, Loader2, AlertTriangle,
} from 'lucide-react';
import { useFetch, useFetchOnce } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
  PageHeader, SectionLabel, Toolbar, FilterChip, StatRow, StatCard, Banner,
  SplitLayout, Panel, DetailPane, MetaRow, ListRow, Pill, StatusPill,
  ActionButton, EmptyState,
} from '@/components/ui/console';
import { formatIst } from '@/lib/format';
import { classifySweeps } from '@/lib/sweeps';

/* ─── contracts ─────────────────────────────────────────────────────────────
 * Only the columns this page reads, named exactly as jobService.LIST_COLUMNS
 * emits them — `service_category` (aliased off sc.service_catg_name), not
 * `service_catg_name`, and `ageDays` from utils/job-age-sql.js, which for a
 * completed job is ticket_created_date_time → checkout_date_time.
 */
type Paged<T> = { items: T[]; total: number };

type CompletedJob = {
  job_id: number;
  job_reference_id: string | null;
  client_ref_id: string | null;
  job_status: number;
  customer_name: string | null;
  city_name: string | null;
  service_category: string | null;
  job_desc: string | null;
  ticket_created_date_time: string | null;
  checkin_date_time: string | null;
  checkout_date_time: string | null;
  easyfixer_name: string | null;
  client_spoc_name: string | null;
  service_count: number | null;
  ageDays: number | null;
};

/**
 * tbl_job_image, as getById() shapes it. `image_url` is a short-lived S3
 * presigned URL resolved server-side — it needs no Authorization header, which
 * is why the tiles render it directly instead of pointing an <img> at the
 * bearer-authed /jobs/:id/images/:imageId endpoint (that one 401s from an
 * <img>; it is fine for a click-through, which carries the session).
 */
type JobImage = {
  image_id: number;
  image: string | null;
  image_category: string | null;
  job_stage: number | string | null;
  image_url: string | null;
};

/** GET /jobs/:id — j.* plus the detail aliases. No service_count on this one. */
type JobDetail = {
  job_id: number;
  customer_name: string | null;
  city_name: string | null;
  service_category: string | null;
  client_spoc_name: string | null;
  easyfixer_name: string | null;
  ticket_created_date_time: string | null;
  checkin_date_time: string | null;
  checkout_date_time: string | null;
  ageDays: number | null;
  images: JobImage[] | null;
};

type OrderCounts = { otherOrders: number; completedOrders: number };

/* ─── date helpers ──────────────────────────────────────────────────────────
 * Same parse as Home's: MySQL hands back an instant, the browser renders it in
 * the reader's zone (IST for these users).
 */
const parse = (s?: string | null) => {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
};
const stamp = (s?: string | null) => parse(s)?.getTime() ?? 0;
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = (d: Date | null) =>
  d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
const fmtStamp = (s?: string | null) =>
  formatIst(s, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/* ─── window ───────────────────────────────────────────────────────────────
 * The "This month" chip. Both windows are applied SERVER-side on
 * checkout_date_time (dateType=completed); endDate is exclusive-next-day in
 * jobService.list, so a plain YYYY-MM-DD includes the whole final day.
 */
type WindowKey = 'month' | 'd90';

const WINDOWS: ReadonlyArray<{ key: WindowKey; label: string }> = [
  { key: 'month', label: 'This month' },
  { key: 'd90', label: 'Last 90 days' },
];

function windowFor(key: WindowKey, now: Date) {
  const from =
    key === 'month'
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89);
  return {
    from,
    to: now,
    startDate: ymd(from),
    endDate: ymd(now),
    label: WINDOWS.find((w) => w.key === key)!.label,
  };
}

/* ─── image buckets ────────────────────────────────────────────────────────
 * tbl_job_image is tagged twice — a text `image_category` and a numeric
 * `job_stage` enum — and rows in the wild carry one, the other, or neither.
 * This is the SAME vocabulary routes/admin/jobs.js bucketed the CRM's
 * transaction view with (start_job 0 · site_inspection 1 · job_sheet 2 ·
 * material_used 3 · signature 4 · checkout 5), so a photo lands in the same
 * bucket on both consoles.
 *
 * Matched against closed sets rather than a loose /before|start/ regex: a
 * substring test would put `job_sheet` or `signature` in a photo tile the
 * moment someone adds a category containing one of those fragments.
 */
type Bucket = 'before' | 'after' | 'jobsheet' | 'material' | 'other';

const norm = (s: string | null | undefined) =>
  String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const BEFORE_CATS = new Set(['booking', 'start_job', 'startjob', 'checkin', 'check_in', 'site_inspection', 'siteinspection', 'before']);
const AFTER_CATS = new Set(['completion', 'checkout', 'check_out', 'after']);
const JOBSHEET_CATS = new Set(['job_sheet', 'jobsheet']);
const MATERIAL_CATS = new Set(['material_used', 'material', 'materials', 'bom']);

function bucketOf(im: JobImage): Bucket {
  const c = norm(im.image_category);
  if (BEFORE_CATS.has(c)) return 'before';
  if (AFTER_CATS.has(c)) return 'after';
  if (JOBSHEET_CATS.has(c)) return 'jobsheet';
  if (MATERIAL_CATS.has(c)) return 'material';
  // Number(null) is 0, and 0 is a REAL stage (start_job) — so an untagged row
  // would land in "Before" if the null were not excluded first.
  const raw = im.job_stage;
  if (raw === null || raw === undefined || raw === '') return 'other';
  const st = Number(raw);
  if (st === 0 || st === 1) return 'before';
  if (st === 5) return 'after';
  if (st === 2) return 'jobsheet';
  if (st === 3) return 'material';
  return 'other';
}

/** A PDF attachment is a document, not a photo — keep it out of the tiles. */
const isPhoto = (im: JobImage) => !/\.pdf$/i.test(String(im.image ?? ''));

/* ─── small local shapes ────────────────────────────────────────────────────
 * Two things the console grammar does not have a primitive for, composed here
 * rather than added to console.tsx:
 *
 *   SELECTABLE ROW  ListRow has no onClick/selected, and wrapping it in a
 *                   button breaks its own `last:border-0` (the ListRow becomes
 *                   the only child of the wrapper, so every separator
 *                   disappears). These buttons are siblings in one container
 *                   and carry ListRow's exact spacing and rule classes, so the
 *                   list reads identically — it just also selects.
 *   PHOTO TILE      a labelled thumbnail with a count. Nothing in the grammar
 *                   is close; it is built from the same surface/ink tokens.
 */
function PhotoTile({ label, images }: { label: string; images: JobImage[] }) {
  const cover = images.find((im) => im.image_url);
  const n = images.length;
  return (
    <div className={cn('rounded-lg border border-ink-100 overflow-hidden', n === 0 && 'opacity-60')}>
      <div className="h-20 flex items-center justify-center bg-surface-alt">
        {cover?.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.image_url} alt={`${label} photo`} className="w-full h-20 object-cover" />
        ) : (
          <ImageOff className="w-5 h-5 text-ink-300" aria-hidden />
        )}
      </div>
      <div className="px-2.5 py-1.5 bg-surface border-t border-ink-100">
        <div className="text-xs font-medium text-ink-900">{label}</div>
        <div className="text-xs text-ink-500">
          {n ? `${n} photo${n === 1 ? '' : 's'}` : 'No photos attached'}
        </div>
      </div>
    </div>
  );
}

/**
 * `ageDays` as a number, or NaN when the server had nothing to measure.
 *
 * Number(null) is 0, and 0 is a legitimate age — a job whose ticket-created or
 * checkout timestamp is missing would otherwise read as "closed in 0 days",
 * count toward "closed within a day", and pull the average down. Every reader
 * of ageDays goes through here.
 */
const days = (v: number | null | undefined) => (v === null || v === undefined ? NaN : Number(v));

/** Severity of a days-to-close figure — the colour a scanning eye reads first. */
const ageAccent = (d: number) => (d <= 1 ? 'success' : d <= 3 ? 'info' : d <= 7 ? 'warning' : 'brand');

const pct = (k: number, n: number) => (n ? Math.round((k / n) * 100) : null);

/** Distinct values with their counts, commonest first — the chip menus. */
function tally(values: Array<string | null>) {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = (v || '').trim();
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

export default function CompletedPage() {
  const now = useMemo(() => new Date(), []);
  const [windowKey, setWindowKey] = useState<WindowKey>('month');
  const [city, setCity] = useState<string | null>(null);
  const [workType, setWorkType] = useState<string | null>(null);
  const [menu, setMenu] = useState<'city' | 'type' | 'window' | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);

  const win = useMemo(() => windowFor(windowKey, now), [windowKey, now]);

  /*
   * Two windowed reads, one per completed status code. 500 is the route's hard
   * cap (Math.min(limit, 500)); when the window holds more than that the page
   * says so rather than quietly describing a slice as the whole month.
   */
  // useFetch keys on the PATH, so a retry has to change it or nothing refires.
  // The nonce is only appended once someone has actually pressed Try Again, so
  // the ordinary request URL stays clean.
  /*
   * ⚠ sortBy IS LOAD-BEARING, not a preference. Each call is capped at 500, and
   * the banner below tells the reader those 500 are "the most recent closures".
   * Without a sort the route falls back to `ORDER BY j.job_id DESC` — most
   * recently CREATED, which is a different set: a job raised in January and
   * closed in August carries a low job_id, so it was the RECENT closures being
   * dropped, under a banner promising the opposite.
   *
   * checkout_date_time is on the backend's SORTABLE_COLUMNS whitelist, and it
   * is the same column dateType=completed windows on — so the cap now bites the
   * oldest closures in the window, which is what "narrow the window" fixes.
   */
  const qs =
    `dateType=completed&startDate=${win.startDate}&endDate=${win.endDate}`
    + `&sortBy=checkout_date_time&sortDir=desc&limit=500`
    + (retry ? `&_retry=${retry}` : '');
  const closed = useFetch<Paged<CompletedJob>>(`/jobs?status=3&${qs}`);
  const audited = useFetch<Paged<CompletedJob>>(`/jobs?status=5&${qs}`);
  const { data: counts } = useFetchOnce<OrderCounts>('/orders/counts');

  /* Each call is already sorted by checkout_date_time DESC, but this screen
     MERGES two of them (status 3 and status 5). Two sorted lists concatenated
     are not one sorted list, so the merge sort stays. */
  const rows = useMemo(() => {
    const all = [...(closed.data?.items ?? []), ...(audited.data?.items ?? [])];
    return all.sort(
      (a, b) => stamp(b.checkout_date_time) - stamp(a.checkout_date_time) || b.job_id - a.job_id,
    );
  }, [closed.data, audited.data]);

  const windowTotal = (closed.data?.total ?? 0) + (audited.data?.total ?? 0);
  const truncated = rows.length < windowTotal;

  const cities = useMemo(() => tally(rows.map((r) => r.city_name)), [rows]);
  const workTypes = useMemo(() => tally(rows.map((r) => r.service_category)), [rows]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!city || (r.city_name || '').trim() === city) &&
          (!workType || (r.service_category || '').trim() === workType),
      ),
    [rows, city, workType],
  );

  const stats = useMemo(() => {
    let withCheckin = 0;
    let insideADay = 0;
    let ageSum = 0;
    let ageN = 0;
    for (const j of filtered) {
      if (j.checkin_date_time) withCheckin += 1;
      const d = days(j.ageDays);
      if (Number.isFinite(d)) {
        ageSum += d;
        ageN += 1;
        if (d <= 1) insideADay += 1;
      }
    }
    return {
      n: filtered.length,
      withCheckin,
      insideADay,
      ageN,
      avgAge: ageN ? Math.round((ageSum / ageN) * 10) / 10 : null,
    };
  }, [filtered]);

  /* Selection without an effect: the explicit pick wins while it is still in
     the filtered set, otherwise the newest closure leads. A chip that filters
     the selected job away therefore cannot strand the detail pane. */
  const selected = useMemo(
    () => filtered.find((j) => j.job_id === picked) ?? filtered[0] ?? null,
    [filtered, picked],
  );

  const detail = useFetch<JobDetail>(selected ? `/jobs/${selected.job_id}` : null);

  /*
   * useFetch keeps the PREVIOUS payload in `data` while the next request is in
   * flight — it only spreads `loading: true` over the existing state — so every
   * value derived from the detail response has to be gated on that response
   * actually being THIS job. Without the gate, the moment between clicking a
   * row and its detail arriving leaves the job-sheet / bill-of-materials "View"
   * button enabled on the document of the job you just left, and openDoc would
   * build its fallback URL from that job's id too. Number() on the comparison
   * so a stringified id can never make the pane permanently claim "not
   * attached".
   */
  const fresh =
    detail.data && selected && Number(detail.data.job_id) === selected.job_id ? detail.data : null;

  const pics = useMemo(() => (fresh?.images ?? []).filter(isPhoto), [fresh]);
  const before = useMemo(() => pics.filter((im) => bucketOf(im) === 'before'), [pics]);
  const after = useMemo(() => pics.filter((im) => bucketOf(im) === 'after'), [pics]);
  const docs = fresh?.images ?? [];
  const jobSheet = docs.find((im) => bucketOf(im) === 'jobsheet') ?? null;
  const materials = docs.find((im) => bucketOf(im) === 'material') ?? null;

  /*
   * Prefer the presigned URL getById already resolved; fall back to the bearer-
   * authed proxy, which works for a click-through (the tab carries the session)
   * even though it cannot back an <img>.
   */
  /*
   * "Not attached to this job" is a claim, and it is false while the detail
   * request is still in flight — the images simply have not arrived yet. The
   * row says which of the three states it is in.
   */
  const docSub = (found: JobImage | null) =>
    detail.loading
      ? 'Checking attachments…'
      : detail.error
        ? 'Attachments could not be loaded'
        : found
          ? 'Attached to this job'
          : 'Not attached to this job';

  const openDoc = (im: JobImage) => {
    const jobId = fresh?.job_id;
    const url = im.image_url || (jobId ? `/api/client/jobs/${jobId}/images/${im.image_id}` : null);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const listPending = (closed.loading || audited.loading) && rows.length === 0;
  /*
   * Same three-way outcome /jobs uses, from the same tested function rather
   * than hand-rolled again — this page fans out over two status sweeps where
   * that one fans out over seven, but the decision is identical and so is the
   * failure it guards: the sweeps that DID land render fine, so a partial book
   * looks like a whole one.
   */
  const outcome = classifySweeps(2, (closed.error ? 1 : 0) + (audited.error ? 1 : 0));
  const failed = outcome === 'failed';

  /*
   * ⚠ BOTH CALLS MUST HAVE ANSWERED BEFORE ANY AGGREGATE IS REAL.
   *
   * This page is the union of two status sweeps (3 and 5), so every figure
   * computed from `rows` while one is still in flight counts HALF the window —
   * and the page-wide spinner that used to sit here is what hid that. With the
   * frame rendering first, a confident half-total would be on screen instead,
   * which is worse than a spinner: it looks like an answer.
   *
   * Keyed on `data`, not on `loading`, so a refetch does NOT blank figures
   * already on screen — useFetch spreads `loading: true` over its existing
   * state rather than clearing it (see the note above).
   */
  const bothIn = !!closed.data && !!audited.data;
  /** Em dash until the window is whole. */
  const agg = (v: number) => (bothIn ? v.toLocaleString('en-IN') : '—');

  /*
   * NO PAGE-WIDE SPINNER. The window chip is the control a reader reaches for
   * when this page is slow — a wide window on a large client is exactly the
   * case where both 500-row sweeps take their time — so trapping it behind the
   * query it exists to narrow was the wrong way round. The frame renders
   * immediately; only the list waits.
   */
  if (failed) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load completed jobs"
          sub={closed.error || audited.error || 'The job service did not respond.'}
          action={<ActionButton onClick={() => setRetry((n) => n + 1)}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  const selDays = selected ? days(selected.ageDays) : NaN;
  const verified = !!selected?.checkin_date_time;

  return (
    <>
      <PageHeader
        title="Completed"
        sub={
          <>
            {win.label} · closed {fmtDay(win.from)} – {fmtDay(win.to)}
            {/* `(all time)` is load-bearing, not padding. Everything to the left
                of this clause is scoped to the selected window; completedOrders
                is not — GET /orders/counts is called with no date params, so it
                counts the team's whole book. Two differently-scoped figures on
                one line separated by a `·` read as one scope unless the second
                says otherwise. */}
            {counts
              ? ` · ${counts.completedOrders.toLocaleString('en-IN')} marked ready for billing across your team (all time)`
              : ''}
          </>
        }
      />

      <SectionLabel>Closed work</SectionLabel>

      {/* The three scope chips. Each opens a strip of its own real values —
          derived from the rows in the window, so a chip can never offer a cut
          that returns nothing. City and work type narrow the loaded set; the
          window chip re-queries the server. */}
      <Toolbar
        count={
          !bothIn
            ? 'Loading…'
            : truncated
            ? `${filtered.length.toLocaleString('en-IN')} shown · ${windowTotal.toLocaleString('en-IN')} completed in this window`
            : `${filtered.length.toLocaleString('en-IN')} completed`
        }
      >
        <FilterChip
          icon={MapPin}
          active={!!city || menu === 'city'}
          onClick={() => setMenu((m) => (m === 'city' ? null : 'city'))}
        >
          {city || 'All cities'}
        </FilterChip>
        <FilterChip
          icon={Wrench}
          active={!!workType || menu === 'type'}
          onClick={() => setMenu((m) => (m === 'type' ? null : 'type'))}
        >
          {workType || 'All work types'}
        </FilterChip>
        <FilterChip
          icon={CalendarDays}
          active={menu === 'window'}
          onClick={() => setMenu((m) => (m === 'window' ? null : 'window'))}
        >
          {win.label}
        </FilterChip>
      </Toolbar>

      {menu ? (
        <div className="flex flex-wrap items-center gap-2 mb-3 pb-3 border-b border-ink-100">
          {menu === 'window' &&
            WINDOWS.map((w) => (
              <FilterChip
                key={w.key}
                active={windowKey === w.key}
                onClick={() => {
                  setWindowKey(w.key);
                  setMenu(null);
                }}
              >
                {w.label}
              </FilterChip>
            ))}

          {menu === 'city' && (
            <>
              <FilterChip active={!city} onClick={() => { setCity(null); setMenu(null); }}>
                All cities
              </FilterChip>
              {cities.map((c) => (
                <FilterChip
                  key={c.key}
                  active={city === c.key}
                  onClick={() => { setCity(city === c.key ? null : c.key); setMenu(null); }}
                >
                  {c.key} · {c.n}
                </FilterChip>
              ))}
              {cities.length === 0 && (
                <span className="text-xs text-ink-500">No cities on the jobs in this window.</span>
              )}
            </>
          )}

          {menu === 'type' && (
            <>
              <FilterChip active={!workType} onClick={() => { setWorkType(null); setMenu(null); }}>
                All work types
              </FilterChip>
              {workTypes.map((t) => (
                <FilterChip
                  key={t.key}
                  active={workType === t.key}
                  onClick={() => { setWorkType(workType === t.key ? null : t.key); setMenu(null); }}
                >
                  {t.key} · {t.n}
                </FilterChip>
              ))}
              {workTypes.length === 0 && (
                <span className="text-xs text-ink-500">No work types on the jobs in this window.</span>
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Completed is two status codes read separately (see the header). If one
          read fails the page still has rows — and every figure on it is short by
          an unknown amount, which the reader has to be told. */}
      {outcome === 'partial' ? (
        <Banner accent="warning" className="mb-4">
          One of the two completed statuses could not be read
          {closed.error ? ' (Completed)' : ' (Completed & audited)'} — {closed.error || audited.error}.
          The figures below are incomplete.
        </Banner>
      ) : null}

      {/* The 500-row cap is the route's, not ours. Saying so is the difference
          between a windowed figure and a wrong one. */}
      {/* bothIn: windowTotal is the SUM of two totals, so mid-load this banner
          could compare a full row count against half a window and claim a
          truncation that is not there. */}
      {bothIn && truncated ? (
        <Banner
          accent="info"
          className="mb-4"
          right={`${rows.length.toLocaleString('en-IN')} of ${windowTotal.toLocaleString('en-IN')}`}
        >
          This window holds more completed jobs than one page can carry, so the figures below
          describe the most recent {rows.length.toLocaleString('en-IN')} closures — the oldest in
          the window are the ones left out. Narrow the window to cover the rest.
        </Banner>
      ) : null}

      <StatRow className="mb-6">
        <StatCard
          icon={CheckCircle2}
          accent="success"
          label="Completed"
          value={agg(stats.n)}
          sub={`${win.label} · closed ${fmtDay(win.from)} – ${fmtDay(win.to)}`}
        />
        <StatCard
          icon={UserCheck}
          accent="info"
          // SUBSTITUTED: the mock's "first visit fix" needs the linked_job
          // parent→child table, which only the grant-gated /performance route
          // reads. The client job list has no revisit marker of any kind, so
          // this tile reports the closure evidence the payload DOES carry — a
          // technician check-in on the job.
          label="With on-site check-in"
          value={!bothIn || pct(stats.withCheckin, stats.n) == null ? '—' : `${pct(stats.withCheckin, stats.n)}%`}
          sub={`${agg(stats.withCheckin)} of ${agg(stats.n)} carry a technician check-in`}
        />
        <StatCard
          icon={Clock}
          accent="info"
          label="Avg days to close"
          value={!bothIn || stats.avgAge == null ? '—' : stats.avgAge.toFixed(1)}
          sub={`Ticket raised → checked out · ${agg(stats.ageN)} job${stats.ageN === 1 ? '' : 's'} measured`}
        />
        <StatCard
          icon={CalendarCheck}
          accent="info"
          // SUBSTITUTED: "rated excellent" has no source — the customer rating
          // table is a FILTER parameter on the job list, never a projected
          // column, so nothing on this payload can say a job was rated well.
          // Closure inside a day is the nearest thing the data can prove.
          label="Closed within a day"
          value={!bothIn || pct(stats.insideADay, stats.ageN) == null ? '—' : `${pct(stats.insideADay, stats.ageN)}%`}
          sub={`${agg(stats.insideADay)} closed in 1 day or less`}
        />
      </StatRow>

      <SectionLabel>Completed jobs</SectionLabel>

      <SplitLayout
        list={
          <Panel bodyClassName="px-4 py-1.5">
            {listPending ? (
              /* The spinner lives HERE now, not over the whole page — the
                 window chip above is already usable, which is the point. */
              <div className="py-10 text-center">
                <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
                <div className="mt-2 text-sm text-ink-500">Loading completed jobs…</div>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No completed jobs in this window"
                sub={
                  city || workType
                    ? 'The city and work-type filters may be hiding them.'
                    : 'Nothing closed in the selected period.'
                }
                action={
                  city || workType ? (
                    <ActionButton onClick={() => { setCity(null); setWorkType(null); }}>
                      Clear Filters
                    </ActionButton>
                  ) : windowKey === 'month' ? (
                    <ActionButton onClick={() => setWindowKey('d90')}>Widen to 90 Days</ActionButton>
                  ) : null
                }
              />
            ) : (
              filtered.map((j) => {
                const d = days(j.ageDays);
                const on = selected?.job_id === j.job_id;
                // Same null trap as ageDays: an absent count must not render "0 items".
                const items = j.service_count == null ? NaN : Number(j.service_count);
                return (
                  <button
                    key={j.job_id}
                    type="button"
                    onClick={() => setPicked(j.job_id)}
                    aria-pressed={on}
                    className={cn(
                      'w-full text-left flex items-center gap-3 py-2.5 px-2 -mx-2 rounded',
                      'border-b border-ink-100 last:border-0 transition',
                      on ? 'bg-info-tint' : 'hover:bg-surface-alt',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-900 truncate">
                        {j.customer_name || `Job ${j.job_id}`}
                      </span>
                      <span className="block text-xs text-ink-500 truncate">
                        {[
                          j.city_name || 'City not recorded',
                          j.service_category || 'Category not recorded',
                          `closed ${fmtDay(parse(j.checkout_date_time))}`,
                        ].join(' · ')}
                      </span>
                    </span>

                    {/* SUBSTITUTED: the mock reads "1st visit" / "N visits".
                        Visit counts live in linked_job, which this endpoint
                        does not expose, so this is the per-job line-item count
                        the list projection really carries (service_count). */}
                    {Number.isFinite(items) ? (
                      <span className="hidden sm:inline-flex items-center gap-1 text-xs text-ink-500 shrink-0 tabular-nums">
                        <ListChecks className="w-3.5 h-3.5" aria-hidden />
                        {items} item{items === 1 ? '' : 's'}
                      </span>
                    ) : null}

                    {Number.isFinite(d) ? <Pill accent={ageAccent(d)}>{d}d</Pill> : null}

                    {/* SUBSTITUTED: Excellent / Partial is a customer rating in
                        the mock. No rating reaches this payload, so the pill
                        reports whether the closure is evidenced by an on-site
                        check-in — and says that, rather than borrowing the
                        rating's words. */}
                    <StatusPill status={j.checkin_date_time ? 'excellent' : 'partial'}>
                      {j.checkin_date_time ? 'Verified on site' : 'No check-in'}
                    </StatusPill>

                    {/* SUBSTITUTED: the mock puts a photo COUNT here. The list
                        projection carries no image count — photos arrive only
                        with GET /jobs/:id — so this is a cue that the pane
                        holds them, never a number nobody can trace. */}
                    <span className="hidden sm:inline-flex shrink-0 text-ink-300" title="Photos open in the detail pane">
                      <Camera className="w-3.5 h-3.5" aria-hidden />
                    </span>
                  </button>
                );
              })
            )}
          </Panel>
        }
        detail={
          selected ? (
            <DetailPane
              eyebrow={`JOB-${selected.job_id} · ${selected.city_name || 'City not recorded'}`}
              title={selected.customer_name || `Job ${selected.job_id}`}
              sub={[
                selected.service_category || 'Category not recorded',
                `completed ${fmtDay(parse(selected.checkout_date_time))}`,
                Number.isFinite(selDays) ? `${selDays} day${selDays === 1 ? '' : 's'}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              {/* SUBSTITUTED: the mock's banner reads "Completed on first visit
                  · Excellent" — a revisit check and a rating, neither of which
                  this payload carries. It states the two facts it can prove:
                  how long the job took, and whether a technician checked in. */}
              <Banner accent={verified ? 'success' : 'warning'}>
                {Number.isFinite(selDays)
                  ? `Closed in ${selDays} day${selDays === 1 ? '' : 's'}`
                  : 'Closed'}
                {verified
                  ? ` · technician checked in ${fmtStamp(selected.checkin_date_time)}`
                  : ' · no technician check-in recorded'}
              </Banner>

              <div>
                {detail.loading ? (
                  <div className="text-xs text-ink-500 py-2">Loading photos and documents…</div>
                ) : detail.error ? (
                  <div className="text-xs text-warning-text py-2">
                    Attachments could not be loaded — {detail.error}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <PhotoTile label="Before" images={before} />
                    <PhotoTile label="After" images={after} />
                  </div>
                )}
              </div>

              <div>
                <MetaRow label="Booked" value={fmtStamp(selected.ticket_created_date_time)} />
                <MetaRow label="Closed" value={fmtStamp(selected.checkout_date_time)} />
                <MetaRow label="Technician" value={selected.easyfixer_name || 'Not recorded'} />
                <MetaRow
                  label="Reference"
                  value={selected.job_reference_id || selected.client_ref_id || `JOB-${selected.job_id}`}
                />
                <MetaRow label="Store SPOC" value={selected.client_spoc_name || 'Not recorded'} />
              </div>

              <div>
                <ListRow
                  title="Signed job sheet"
                  sub={docSub(jobSheet)}
                  action={
                    <ActionButton disabled={!jobSheet} onClick={() => jobSheet && openDoc(jobSheet)}>
                      View
                    </ActionButton>
                  }
                />
                <ListRow
                  title="Bill of materials"
                  sub={docSub(materials)}
                  action={
                    <ActionButton disabled={!materials} onClick={() => materials && openDoc(materials)}>
                      View
                    </ActionButton>
                  }
                />
                {/* SUBSTITUTED: there is no bundled-document endpoint on the
                    client API — /export/jobs is a list-level spreadsheet on a
                    different window and a different scope, so wiring it here
                    would hand the reader a file that is not this job. The row
                    stays, disabled, saying why. */}
                <ListRow
                  title="Download all as PDF"
                  sub="No bundled download yet — open each document above"
                  action={<ActionButton disabled>Download</ActionButton>}
                />
              </div>
            </DetailPane>
          ) : (
            <DetailPane title="No job selected" sub="Pick a completed job from the list.">
              <EmptyState
                icon={Camera}
                title="Nothing to show"
                sub="Photos, the job sheet and the bill of materials appear here."
              />
            </DetailPane>
          )
        }
      />
    </>
  );
}
