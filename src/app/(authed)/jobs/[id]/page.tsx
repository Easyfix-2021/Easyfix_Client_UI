'use client';

/*
 * Job Detail — comprehensive single-job view.
 *
 * Migrated from legacy ACD_APIs
 *   GET /api/jobs/job/{jobId}
 * (Angular JobDetailComponent — shared/panels/job-detail).
 *
 * The new backend's GET /api/client/jobs/:id returns the row + customer
 * + address + services + images in one round-trip, scoped to the SPOC's
 * client_id (404 if the job belongs to another client).
 *
 * Page layout (single column, max-w-5xl, brand-red accents):
 *   1. Sticky breadcrumb + title bar with status pill + escalated icon
 *   2. Quick-stats strip — Ticket Created · Appointment · Customer · Tech
 *   3. Status timeline — 6-step horizontal progress (Created → Scheduled →
 *      Checked-in → Checked-out → Closed → Audit-done)
 *   4. Two-column grid: Customer/Address card | Job info card
 *   5. Services breakdown (estimate-preview style, with approve/reject)
 *   6. Image gallery — grouped by image_category, click-to-zoom modal
 *   7. Comments / Remarks (read-only)
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, AlertTriangle, Phone, Mail, MapPin, Calendar, Clock,
  User, Briefcase, HardHat, Tag, MessageSquare, ImageIcon,
  CheckCircle2, XCircle, Loader2, IndianRupee, Hash,
  Activity, FileText, X as XIcon, ClipboardList,
  PhoneCall, Star, Flame, Headphones,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useFetchOnce } from '@/lib/hooks';
import { STATUS_LABELS } from '@/lib/utils';
import { cn } from '@/lib/utils';

type Job = {
  job_id: number;
  job_reference_id: string | null;
  client_ref_id: string | null;
  job_status: number;
  job_type: string | null;
  source_type: string | null;
  job_desc: string | null;
  remarks: string | null;
  customer_name: string | null;
  customer_mob_no: string | null;
  customer_email: string | null;
  address: string | null;
  building: string | null;
  landmark: string | null;
  locality: string | null;
  pin_code: string | null;
  city_name: string | null;
  client_name: string | null;
  easyfixer_name: string | null;
  easyfixer_mobile: string | null;
  owner_name: string | null;
  created_by_name: string | null;
  client_spoc_name: string | null;
  ticket_created_date_time: string | null;
  created_date_time: string | null;
  requested_date_time: string | null;
  scheduled_date_time: string | null;
  checkin_date_time: string | null;
  checkout_date_time: string | null;
  approved_on_date_time: string | null;
  approval_reject_date_time: string | null;
  approval_sent_on_date_time: string | null;
  approval_reject_reason: string | null;
  time_slot: string | null;
  is_escalated?: boolean | number | null;
  approved_by_client: number | null;
  call_later: number | null;
  sub_job_id: number | null;
  primary_job_id: number | null;
  job_reopen_flag: number | null;
  full_fillment_reason: string | null;
  services: Array<{
    job_service_id: number;
    service_id: number | null;
    service_type_id: number | null;
    service_category_id: number | null;
    quantity: number | string;
    total_charge: number | string;
    job_service_status: number;
    service_type_name: string | null;
    service_catg_name: string | null;
  }>;
  images: Array<{
    image_id: number;
    image: string;
    image_category: string | null;
    job_stage: string | null;
    created_date: string;
  }>;
};

type EstimateLine = {
  job_service_id: number;
  service_name: string | null;
  quantity: number | string;
  total_charge: number | string;
  material_charge: number | string;
  line_total: number | string;
};
type EstimatePreview = {
  job_id: number;
  services: EstimateLine[];
  totals: { services_subtotal: number | string; material_subtotal: number | string; grand_total: number | string };
  already_approved: boolean;
  already_rejected: boolean;
};

// ─── Status badge colors ────────────────────────────────────────────
function statusBadgeClass(status: number) {
  switch (status) {
    case 0:  return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 1:  return 'bg-blue-50 text-blue-700 ring-blue-200';
    case 2:
    case 20: return 'bg-violet-50 text-violet-700 ring-violet-200';
    case 3:
    case 5:  return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    case 6:  return 'bg-rose-50 text-rose-700 ring-rose-200';
    case 9:  return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 10: return 'bg-primary/10 text-primary ring-primary/30';
    case 15: return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 21: return 'bg-slate-100 text-slate-700 ring-slate-200';
    default: return 'bg-slate-100 text-slate-700 ring-slate-200';
  }
}

function formatDateTime(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function num(v: number | string | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── Status timeline ────────────────────────────────────────────────
// Each milestone has a status threshold; reached if current status >=
// threshold, OR specific date column is filled. Color flips to brand
// red when reached, otherwise muted slate.
type Milestone = { key: string; label: string; reached: boolean; date: string | null };
function buildTimeline(j: Job): Milestone[] {
  return [
    { key: 'created', label: 'Ticket Created',
      reached: !!j.created_date_time,
      date: j.created_date_time },
    { key: 'scheduled', label: 'Scheduled',
      reached: !!j.scheduled_date_time || j.job_status >= 1,
      date: j.scheduled_date_time },
    { key: 'checkin', label: 'On Location',
      reached: !!j.checkin_date_time,
      date: j.checkin_date_time },
    { key: 'checkout', label: 'Work Done',
      reached: !!j.checkout_date_time,
      date: j.checkout_date_time },
    { key: 'approved', label: 'Approved',
      reached: !!j.approved_on_date_time,
      date: j.approved_on_date_time },
    { key: 'closed', label: 'Closed',
      reached: [3, 5, 6].includes(j.job_status),
      date: [3, 5].includes(j.job_status) ? j.checkout_date_time : null },
  ];
}

export default function JobDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const job = useFetchOnce<Job>(id ? `/jobs/${id}` : null);
  const estimate = useFetchOnce<EstimatePreview>(id ? `/jobs/${id}/estimate-preview` : null);

  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  // Contact + Escalate dialogs (legacy parity — Angular
  // job-detail.component.{html,ts}). callDialog opens the "Who Would
  // Need To Contact" picker; escalateDialog opens the reason + comment
  // form. flashOk is a transient success toast shown after submit.
  const [callDialog, setCallDialog] = useState(false);
  const [escalateDialog, setEscalateDialog] = useState(false);
  const [escalateReasons, setEscalateReasons] = useState<Array<{ id: number; label: string }>>([]);
  const [escalateReasonId, setEscalateReasonId] = useState<number | ''>('');
  const [escalateComment, setEscalateComment] = useState('');
  const [flashOk, setFlashOk] = useState<string | null>(null);

  async function reloadBoth() {
    await Promise.allSettled([job.reload(), estimate.reload()]);
  }

  async function approve() {
    setActing(true); setActError(null);
    try {
      await api.patch(`/jobs/${id}/estimate/approve`, {});
      await reloadBoth();
    } catch (err) {
      setActError(err instanceof ApiError ? err.message : 'Approve failed');
    } finally { setActing(false); }
  }
  async function reject() {
    if (rejectReason.trim().length < 3) { setActError('Reason required (min 3 chars)'); return; }
    setActing(true); setActError(null);
    try {
      await api.patch(`/jobs/${id}/estimate/reject`, { reason: rejectReason.trim() });
      setShowReject(false);
      setRejectReason('');
      await reloadBoth();
    } catch (err) {
      setActError(err instanceof ApiError ? err.message : 'Reject failed');
    } finally { setActing(false); }
  }

  /*
   * Open the Escalate dialog. Lazy-loads the reason list on first open
   * (actionType=23, legacy `escalateActionType`). Subsequent opens reuse
   * the cached list — it's a tiny lookup that rarely changes.
   */
  async function openEscalateDialog() {
    setEscalateDialog(true);
    setActError(null);
    if (escalateReasons.length === 0) {
      try {
        const res = await api.get<Array<{ id: number; label: string }>>(
          '/lookup/reasons?actionType=23'
        );
        setEscalateReasons(res);
      } catch (err) {
        setActError(err instanceof ApiError ? err.message : 'Failed to load reasons');
      }
    }
  }

  async function submitEscalate() {
    if (!escalateReasonId) { setActError('Please select a reason'); return; }
    if (escalateComment.trim().length < 3) { setActError('Please share a comment (min 3 chars)'); return; }
    setActing(true); setActError(null);
    try {
      await api.post(`/jobs/${id}/escalate`, {
        reasonId: Number(escalateReasonId),
        comment: escalateComment.trim(),
      });
      setEscalateDialog(false);
      setEscalateReasonId('');
      setEscalateComment('');
      setFlashOk('Job Escalate Successfull');
      setTimeout(() => setFlashOk(null), 3000);
      await reloadBoth();
    } catch (err) {
      setActError(err instanceof ApiError ? err.message : 'Escalate failed');
    } finally { setActing(false); }
  }

  if (job.loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading job…
      </div>
    );
  }
  if (!job.data) {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        {job.error || 'Job not found'}
      </div>
    );
  }

  const j = job.data;
  const e = estimate.data;
  const timeline = buildTimeline(j);

  // Build complete address from parts
  const fullAddress = [j.building, j.address, j.locality, j.landmark, j.city_name, j.pin_code]
    .filter(Boolean).join(', ');

  const showEstimateActions = !j.approved_on_date_time && !j.approval_reject_date_time
    && e && !e.already_approved && !e.already_rejected;

  // Group images by category for the gallery. PDFs are excluded —
  // the gallery is for image thumbnails; non-image files (signed
  // jobsheet PDFs) get their own dedicated button in the top bar.
  const isImage = (filename: string | null) => {
    if (!filename) return false;
    return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(filename);
  };
  const imagesByCategory: Record<string, typeof j.images> = {};
  for (const img of j.images || []) {
    if (!isImage(img.image)) continue;
    const cat = img.image_category || 'Other';
    (imagesByCategory[cat] = imagesByCategory[cat] || []).push(img);
  }

  // Resolve image src — relative paths go through our SPOC-scoped image
  // endpoint (which 302s to S3 or streams from disk). Absolute URLs
  // pass through unchanged.
  function imageSrc(img: { image_id: number; image: string }): string {
    if (img.image && img.image.startsWith('http')) return img.image;
    return `/api/client/jobs/${j.job_id}/images/${img.image_id}`;
  }

  // Jobsheet = the feedback-category image. Case-insensitive match
  // matches the legacy SQL `LIKE 'feedback'`. Picks the most recent
  // when multiple exist.
  const feedbackImage = (j.images || [])
    .filter((img) => (img.image_category || '').toLowerCase() === 'feedback')
    .sort((a, b) => b.image_id - a.image_id)[0] || null;

  return (
    <div className="max-w-5xl mx-auto pb-10 space-y-5">
      {/* Sticky top bar — Back link + title + status */}
      <div className="sticky top-16 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-slate-50/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-primary"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="h-5 w-px bg-slate-300" />
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Hash className="w-5 h-5 text-primary shrink-0" />
            <h1 className="text-lg font-bold text-slate-900">Job {j.job_id}</h1>
            {j.is_escalated ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 ring-1 ring-orange-200 text-xs font-semibold">
                <AlertTriangle className="w-3 h-3" /> Escalated
              </span>
            ) : null}
            <span className={cn(
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ring-1',
              statusBadgeClass(j.job_status)
            )}>
              {STATUS_LABELS[j.job_status] || `Status ${j.job_status}`}
            </span>
          </div>
          {/* Jobsheet button — opens the feedback artefact in a new
              tab. Most rows are PDFs (signed customer feedback /
              jobsheet), so we let the browser handle them natively
              rather than forcing them into the image-zoom modal.
              Legacy SQL: image_category LIKE 'feedback'. */}
          {feedbackImage && (
            <a
              href={imageSrc(feedbackImage)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary shrink-0"
              title="Open the signed jobsheet (PDF)"
            >
              <ClipboardList className="w-4 h-4" /> Jobsheet
            </a>
          )}
        </div>
      </div>

      {/* Hero — quick stats strip */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary via-primary-dark to-primary" />
        <div className="p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Reference IDs</div>
              <div className="flex flex-wrap gap-2">
                {j.job_reference_id && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-mono font-semibold">
                    RefId · {j.job_reference_id}
                  </span>
                )}
                {j.client_ref_id && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono font-semibold">
                    Client Ref Id · {j.client_ref_id}
                  </span>
                )}
                {j.job_type && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">
                    <Tag className="w-3 h-3" /> {j.job_type}
                  </span>
                )}
                {j.source_type && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
                    Source · {j.source_type}
                  </span>
                )}
              </div>
            </div>
            {/* Sub-job / Parent-job navigation */}
            {(j.sub_job_id || (j.primary_job_id && j.primary_job_id > 0)) && (
              <div className="flex flex-col items-end gap-1 text-xs">
                {j.primary_job_id && j.primary_job_id > 0 && (
                  <Link href={`/jobs/${j.primary_job_id}`} className="text-primary hover:underline">
                    ← Parent {j.primary_job_id}
                  </Link>
                )}
                {j.sub_job_id && (
                  <Link href={`/jobs/${j.sub_job_id}`} className="text-primary hover:underline">
                    Revisit {j.sub_job_id} →
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* Quick-stats — 4 cells with subtle dividers */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 rounded-xl overflow-hidden border border-slate-200">
            <QuickStat icon={Calendar} label="Ticket Created" value={formatDateTime(j.ticket_created_date_time || j.created_date_time) || '—'} />
            <QuickStat icon={Clock} label="Appointment" value={formatDateTime(j.requested_date_time) || '—'} sub={j.time_slot || undefined} />
            <QuickStat icon={User} label="Customer" value={j.customer_name || '—'} sub={j.customer_mob_no || undefined} />
            <QuickStat icon={HardHat} label="Technician" value={j.easyfixer_name || 'Not yet allocated'} accent={!!j.easyfixer_name} />
          </div>
        </div>
      </div>

      {/* Status timeline */}
      <Section title="Status Timeline" icon={Activity}>
        <div className="relative overflow-x-auto pb-2">
          <div className="flex items-start min-w-max">
            {timeline.map((m, i) => (
              <div key={m.key} className="flex-1 min-w-[120px] relative">
                {i > 0 && (
                  <div className={cn(
                    'absolute top-4 left-0 right-1/2 h-0.5',
                    timeline[i - 1].reached ? 'bg-primary' : 'bg-slate-200'
                  )} />
                )}
                {i < timeline.length - 1 && (
                  <div className={cn(
                    'absolute top-4 left-1/2 right-0 h-0.5',
                    m.reached ? 'bg-primary' : 'bg-slate-200'
                  )} />
                )}
                <div className="relative flex flex-col items-center text-center">
                  <div className={cn(
                    'w-8 h-8 rounded-full grid place-items-center border-2 transition',
                    m.reached
                      ? 'bg-primary border-primary text-white shadow-md shadow-primary/30'
                      : 'bg-white border-slate-300 text-slate-400'
                  )}>
                    {m.reached ? <CheckCircle2 className="w-4 h-4" /> : <span className="w-2 h-2 rounded-full bg-current" />}
                  </div>
                  <div className={cn(
                    'text-xs font-semibold mt-2',
                    m.reached ? 'text-slate-900' : 'text-slate-400'
                  )}>
                    {m.label}
                  </div>
                  {m.reached && m.date && (
                    <div className="text-[10px] text-slate-500 mt-0.5 px-1">
                      {formatDateTime(m.date)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Two-column grid — Customer | Job Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Customer & Address */}
        <Section title="Customer & Location" icon={User}>
          <dl className="space-y-3 text-sm">
            <Field label="Name" icon={User}>{j.customer_name || '—'}</Field>
            <Field label="Mobile" icon={Phone}>
              {j.customer_mob_no ? (
                <a href={`tel:${j.customer_mob_no}`} className="text-primary hover:underline font-mono">
                  {j.customer_mob_no}
                </a>
              ) : '—'}
            </Field>
            {j.customer_email && (
              <Field label="Email" icon={Mail}>
                <a href={`mailto:${j.customer_email}`} className="text-primary hover:underline">
                  {j.customer_email}
                </a>
              </Field>
            )}
            <Field label="Address" icon={MapPin}>
              {fullAddress || '—'}
            </Field>
            {j.city_name && (
              <Field label="City" icon={MapPin}>{j.city_name}{j.pin_code ? ` · ${j.pin_code}` : ''}</Field>
            )}
          </dl>
        </Section>

        {/* Job Info — SPOC, owner, created by */}
        <Section title="Job Information" icon={FileText}>
          <dl className="space-y-3 text-sm">
            <Field label="Client SPOC" icon={User}>{j.client_spoc_name || '—'}</Field>
            <Field label="Owner" icon={Briefcase}>{j.owner_name || '—'}</Field>
            <Field label="Created By" icon={User}>{j.created_by_name || '—'}</Field>
            {j.job_desc && (
              <Field label="Description" icon={FileText}>
                <span className="whitespace-pre-wrap">{j.job_desc}</span>
              </Field>
            )}
            {j.full_fillment_reason && (
              <Field label="Fulfilment Hold Reason" icon={AlertTriangle}>
                <span className="whitespace-pre-wrap">{j.full_fillment_reason}</span>
              </Field>
            )}
          </dl>
        </Section>
      </div>

      {/* Services / Estimate */}
      {e && (
        <Section title="Estimate" icon={IndianRupee}
          titleRight={
            <span className="text-xs">
              {e.already_approved && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-semibold">
                  <CheckCircle2 className="w-3 h-3" /> Approved
                </span>
              )}
              {e.already_rejected && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 font-semibold">
                  <XCircle className="w-3 h-3" /> Rejected
                </span>
              )}
            </span>
          }
        >
          {e.services.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              No services awaiting approval on this job.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th className="!text-right">Qty</th>
                      <th className="!text-right">Unit ₹</th>
                      <th className="!text-right">Material ₹</th>
                      <th className="!text-right">Line Total ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.services.map((s) => (
                      <tr key={s.job_service_id}>
                        <td>{s.service_name || '—'}</td>
                        <td className="text-right font-mono">{num(s.quantity)}</td>
                        <td className="text-right font-mono">{num(s.total_charge).toFixed(2)}</td>
                        <td className="text-right font-mono">{num(s.material_charge).toFixed(2)}</td>
                        <td className="text-right font-mono font-semibold">{num(s.line_total).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-bold text-primary">
                      <td colSpan={4} className="text-right">Grand Total</td>
                      <td className="text-right font-mono inline-flex items-center justify-end gap-0.5">
                        <IndianRupee className="w-3.5 h-3.5" />
                        {num(e.totals.grand_total).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {showEstimateActions && (
                <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">
                  <button
                    onClick={approve}
                    disabled={acting}
                    className="btn-primary disabled:opacity-60"
                  >
                    {acting
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Working…</>
                      : <><CheckCircle2 className="w-4 h-4" /> Approve Estimate</>}
                  </button>
                  <button
                    onClick={() => setShowReject(true)}
                    disabled={acting}
                    className="btn-outline text-rose-600 border-rose-200 hover:bg-rose-50"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                </div>
              )}
            </>
          )}

          {j.approval_reject_reason && (
            <div className="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm">
              <div className="text-xs font-semibold text-rose-900 uppercase tracking-wide mb-1">
                Rejection Reason
              </div>
              <p className="text-rose-800">{j.approval_reject_reason}</p>
            </div>
          )}
        </Section>
      )}

      {/* Reject reason modal */}
      {showReject && (
        <Section title="Reason for Rejection" icon={XCircle}>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            className="input min-h-[100px] resize-y"
            placeholder="Tell the team why you're rejecting this estimate (minimum 3 characters)…"
          />
          <div className="flex gap-2 mt-3">
            <button onClick={reject} disabled={acting} className="btn-primary">
              {acting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : 'Submit Rejection'}
            </button>
            <button onClick={() => { setShowReject(false); setRejectReason(''); }} disabled={acting} className="btn-outline">
              Cancel
            </button>
          </div>
        </Section>
      )}

      {/* Services list (all, including non-pending) */}
      {j.services && j.services.length > 0 && (
        <Section title="All Services" icon={Briefcase}
          titleRight={<span className="text-xs text-slate-500">{j.services.length} item{j.services.length === 1 ? '' : 's'}</span>}
        >
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Service Type</th>
                  <th className="!text-right">Qty</th>
                  <th className="!text-right">Charge ₹</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {j.services.map((s) => (
                  <tr key={s.job_service_id}>
                    <td className="text-sm">{s.service_catg_name || '—'}</td>
                    <td className="text-sm">{s.service_type_name || '—'}</td>
                    <td className="text-right font-mono">{num(s.quantity)}</td>
                    <td className="text-right font-mono">{num(s.total_charge).toFixed(2)}</td>
                    <td>
                      {s.job_service_status === 1 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 text-xs font-semibold">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200 text-xs font-semibold">
                          Inactive
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Image gallery */}
      {Object.keys(imagesByCategory).length > 0 && (
        <Section title="Job Images" icon={ImageIcon}
          titleRight={<span className="text-xs text-slate-500">{j.images.length} total</span>}
        >
          <div className="space-y-4">
            {Object.entries(imagesByCategory).map(([cat, imgs]) => (
              <div key={cat}>
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2 inline-flex items-center gap-1">
                  <Tag className="w-3 h-3 text-slate-400" />
                  {cat}
                  <span className="text-slate-400 font-normal">({imgs.length})</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {imgs.map((img) => {
                    const src = imageSrc(img);
                    return (
                      <button
                        key={img.image_id}
                        type="button"
                        onClick={() => setZoomImage(src)}
                        className="aspect-square rounded-lg bg-slate-100 overflow-hidden hover:ring-2 hover:ring-primary transition group relative"
                        title={img.job_stage || ''}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="w-full h-full object-cover group-hover:scale-105 transition" />
                        {img.job_stage && (
                          <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">
                            {img.job_stage}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Comments / Remarks */}
      {j.remarks && (
        <Section title="Comments & Remarks" icon={MessageSquare}>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{j.remarks}</p>
        </Section>
      )}

      {/* ─── Action buttons (legacy parity) ────────────────────────────
          Three colored buttons matching Angular_ClientDashboard
          job-detail.component.html lines 877-894:
            • Contact       — purple #6D20BF, opens callDialog
            • Send Feedback — dark teal #013249, amber star icon
            • Escalate      — red #E31E25 (brand), opens escalateDialog
          On terminal jobs (status 3/5 = Completed) the third button is
          hidden so SPOCs don't escalate already-closed work. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setCallDialog(true)}
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-md text-white font-semibold text-sm shadow-sm hover:opacity-90 transition"
          style={{ backgroundColor: '#6D20BF' }}
        >
          <PhoneCall className="w-4 h-4" />
          Contact
        </button>
        <button
          type="button"
          onClick={() => setFlashOk('Feedback coming soon')}
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-md text-white font-semibold text-sm shadow-sm hover:opacity-90 transition"
          style={{ backgroundColor: '#013249' }}
        >
          <Star className="w-4 h-4" style={{ color: '#FFAA1B', fill: '#FFAA1B' }} />
          Send Feedback
        </button>
        {![3, 5].includes(j.job_status) && (
          <button
            type="button"
            onClick={openEscalateDialog}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-md text-white font-semibold text-sm shadow-sm hover:opacity-90 transition"
            style={{ backgroundColor: '#E31E25' }}
          >
            <Flame className="w-4 h-4" />
            Escalate
          </button>
        )}
      </div>

      {/* Success flash — short toast under the action buttons */}
      {flashOk && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 inline-flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          {flashOk}
        </div>
      )}

      {/* Error inline */}
      {actError && (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actError}
        </div>
      )}

      {/* Contact dialog — "Who Would Need To Contact". Mirrors legacy
          p-dialog at job-detail.component.html line 1095. The three sub-
          buttons are tel: links so the browser's native dialer fires
          (no Click2Call backend required). Sub-buttons are hidden when
          the respective number isn't on file (Handyman, Easyfix Support). */}
      <Modal open={callDialog} onClose={() => setCallDialog(false)}>
        <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Who Would Need To Contact</h2>
          <button
            type="button"
            onClick={() => setCallDialog(false)}
            className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-3">
          {j.customer_mob_no ? (
            <a
              href={`tel:${j.customer_mob_no}`}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-white font-semibold text-sm shadow-sm hover:opacity-90 transition"
              style={{ backgroundColor: '#6D20BF' }}
            >
              <User className="w-4 h-4" /> Call Customer
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-slate-400 bg-slate-100 font-semibold text-sm cursor-not-allowed"
            >
              <User className="w-4 h-4" /> Customer · no number on file
            </button>
          )}
          {j.easyfixer_mobile ? (
            <a
              href={`tel:${j.easyfixer_mobile}`}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-white font-semibold text-sm shadow-sm hover:opacity-90 transition"
              style={{ backgroundColor: '#6D20BF' }}
            >
              <HardHat className="w-4 h-4" /> Call Handyman
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-slate-400 bg-slate-100 font-semibold text-sm cursor-not-allowed"
            >
              <HardHat className="w-4 h-4" /> Handyman · not yet allocated
            </button>
          )}
          <a
            href="tel:+918068499000"
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-white font-semibold text-sm shadow-sm hover:opacity-90 transition"
            style={{ backgroundColor: '#6D20BF' }}
          >
            <Headphones className="w-4 h-4" /> Call Easyfix Support
          </a>
        </div>
      </Modal>

      {/* Escalate dialog — mirrors legacy p-dialog at line 939.
          Reason dropdown + comment textarea, Submit / Cancel buttons.
          Reasons load lazily (actionType=23) on first dialog open. */}
      <Modal
        open={escalateDialog}
        onClose={() => setEscalateDialog(false)}
        allowBackdropClose={!acting}
      >
        <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900 inline-flex items-center gap-2">
            <Flame className="w-5 h-5" style={{ color: '#E31E25' }} />
            Escalate Job
          </h2>
          <button
            type="button"
            onClick={() => setEscalateDialog(false)}
            disabled={acting}
            className="w-8 h-8 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            aria-label="Close"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Reason <span className="text-rose-500">*</span>
            </label>
            <select
              value={escalateReasonId}
              onChange={(e) => setEscalateReasonId(e.target.value ? Number(e.target.value) : '')}
              className="input w-full"
              disabled={acting}
            >
              <option value="">Select your reason to escalate</option>
              {escalateReasons.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            {escalateReasons.length === 0 && (
              <p className="text-[11px] text-slate-400 mt-1 inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading reasons…
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Comment <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              value={escalateComment}
              onChange={(e) => setEscalateComment(e.target.value)}
              className="input w-full resize-y min-h-[90px]"
              placeholder="Please share comments for escalation"
              disabled={acting}
            />
          </div>
          {actError && (
            <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {actError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEscalateDialog(false)}
              disabled={acting}
              className="px-4 py-2 rounded-md text-sm font-semibold border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-60"
            >
              No, Cancel
            </button>
            <button
              type="button"
              onClick={submitEscalate}
              disabled={acting}
              className="px-5 py-2 rounded-md text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              {acting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : 'Submit'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Image zoom modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomImage(null)}
        >
          <button
            type="button"
            onClick={() => setZoomImage(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center"
            aria-label="Close"
          >
            <XIcon className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomImage}
            alt=""
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────

function Section({
  title, icon: Icon, titleRight, children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  titleRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 grid place-items-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
        </div>
        {titleRight}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function QuickStat({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 inline-flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <div className={cn(
        'text-sm truncate font-semibold',
        accent ? 'text-emerald-700' : 'text-slate-800'
      )}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 truncate">{sub}</div>}
    </div>
  );
}

function Field({
  label, icon: Icon, children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-md bg-slate-50 grid place-items-center shrink-0 mt-0.5">
        <Icon className="w-3.5 h-3.5 text-slate-400" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">{label}</dt>
        <dd className="text-sm text-slate-800">{children}</dd>
      </div>
    </div>
  );
}

/*
 * Modal — portals the dialog overlay straight to document.body so it
 * covers the full viewport regardless of any scroll containers,
 * stacking contexts, or transformed ancestors. Without the portal the
 * `fixed inset-0` backdrop is scoped to the nearest containing block,
 * which lets the page show through above/below the dialog when the
 * outer <main> scrolls (the bug the user was seeing).
 *
 * Also locks <body> scroll while the dialog is open and re-enables it
 * on close, so the page underneath doesn't jiggle when the user
 * scrolls inside the modal.
 */
function Modal({
  open, onClose, children, allowBackdropClose = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  allowBackdropClose?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open || !mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/30 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      onClick={() => allowBackdropClose && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
