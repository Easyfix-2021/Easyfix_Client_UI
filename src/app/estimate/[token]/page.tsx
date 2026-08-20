'use client';

/*
 * Public Estimate Approval page — no SPOC login.
 *
 * Ported from the legacy Angular estimate.component (template +
 * controller). A SPOC receives a magic-link via email containing a
 * JWT that pins the jobId + clientContactId. They land here, see the
 * estimate PDF rendered inline, and either Approve or Reject (with
 * a reason).
 *
 *   URL: /estimate/<jwt>
 *   Backend contract:
 *     GET   /api/public/estimate/:token          → job info + status
 *     PATCH /api/public/estimate/:token/approve  → idempotent approve
 *     PATCH /api/public/estimate/:token/reject   → { reason } → reject
 *
 * State machine (mirrors legacy):
 *   loading     → first fetch in-flight
 *   pending     → PDF + Approve/Reject buttons
 *   approved    → success screen ("Estimate approved by X")
 *   rejected    → already-rejected screen ("rejected by X — reason …")
 *   expired     → invalid / expired / no-job error screen
 *
 * Design choice: intentionally OUTSIDE the (authed) route group so
 * the SPOC sidebar and navbar do NOT render. The page lives in its
 * own context — a focused, single-purpose approval surface.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2, CheckCircle2, XCircle, AlertCircle, FileText, X,
  ThumbsUp, ThumbsDown, Send, ChevronDown,
} from 'lucide-react';

/*
 * Frontend mirror of the backend's `/easydoc/...` Nginx convention,
 * with a build-time env override for QA. Matches the helper used on
 * the authed job-detail page so dev/QA URLs line up.
 */
const FILE_BASE = (process.env.NEXT_PUBLIC_FILE_BASE_URL || '/easydoc').replace(/\/+$/, '');

type EstimateInfo = {
  job_id: number;
  job_status: number;
  customer_name: string | null;
  easyfixer_name: string | null;
  service_category: string | null;
  client_name: string | null;
  pdf_path: string;
  status: 'pending' | 'approved' | 'rejected';
  actioned_by_name: string | null;
  actioned_on: string | null;
  reject_reason: string | null;
};

/*
 * Hardcoded reject-reason list. Legacy fetched these from
 * tbl_action_master via the SPOC-authed reasons endpoint; for a
 * public link surface a short, predictable list is simpler and
 * matches typical SPOC complaints. The selected dropdown label + the
 * comment textarea get concatenated into the single `reason` payload
 * the backend stores in `approval_reject_reason`.
 */
const REJECT_REASONS = [
  'Price too high',
  'Scope unclear',
  'Not needed anymore',
  'Wrong technician estimate',
  'Customer changed mind',
  'Other',
];

export default function EstimateApprovalPage() {
  const { token } = useParams<{ token: string }>();

  const [info, setInfo] = useState<EstimateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reject side-pane state. The flow is:
  //   click Reject → showReject = true (form appears below buttons)
  //   pick reason + add comment → click Reject again to submit
  // Matches the legacy two-tap "open form → submit" UX.
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectComment, setRejectComment] = useState('');

  // PDF iframe loading state — separate from the page-level loading so
  // the controls stay clickable while the heavy PDF streams in.
  const [pdfLoaded, setPdfLoaded] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('Estimate link is missing the token segment.');
      setLoading(false);
      return;
    }
    fetch(`/api/public/estimate/${encodeURIComponent(String(token))}`)
      .then(async (r) => {
        const body = await r.json();
        if (!body.success) {
          // Surface the backend's friendly message verbatim
          // ("invalid or expired link", "job not found", etc.)
          throw new Error(body.error || 'Could not load estimate.');
        }
        setInfo(body.data as EstimateInfo);
      })
      .catch((err) => setLoadError((err as Error).message || 'Could not load estimate.'))
      .finally(() => setLoading(false));
  }, [token]);

  async function approve() {
    // Browser-native confirm matches the legacy flow ("Are you really
    // approve this estimate") — minimal UX, avoids pulling in a modal
    // for what is effectively a one-tap commitment.
    if (!confirm('Approve this estimate?')) return;
    setSubmitError(null); setSubmitting(true);
    try {
      const res = await fetch(`/api/public/estimate/${encodeURIComponent(String(token))}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Could not approve.');
      // Re-fetch the info so the success screen renders with
      // actioned_by_name + actioned_on populated by the backend.
      const r2 = await fetch(`/api/public/estimate/${encodeURIComponent(String(token))}`);
      const b2 = await r2.json();
      if (b2.success) setInfo(b2.data as EstimateInfo);
    } catch (err) {
      setSubmitError((err as Error).message || 'Could not approve.');
    } finally { setSubmitting(false); }
  }

  async function reject() {
    setSubmitError(null);
    if (!showReject) {
      // First click — open the form. Don't submit yet.
      setShowReject(true);
      return;
    }
    if (!rejectReason) {
      setSubmitError('Please pick a reason for rejecting.');
      return;
    }
    // Compose the final reason string the backend stores in
    // tbl_job.approval_reject_reason. We join the dropdown label and
    // free-text comment so ops can grep either signal.
    const composed = rejectComment.trim()
      ? `${rejectReason} — ${rejectComment.trim()}`
      : rejectReason;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/estimate/${encodeURIComponent(String(token))}/reject`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: composed }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Could not reject.');
      const r2 = await fetch(`/api/public/estimate/${encodeURIComponent(String(token))}`);
      const b2 = await r2.json();
      if (b2.success) setInfo(b2.data as EstimateInfo);
    } catch (err) {
      setSubmitError((err as Error).message || 'Could not reject.');
    } finally { setSubmitting(false); }
  }

  // ─── Render ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div className="bg-surface rounded-2xl shadow-xl p-10 text-center">
          <Loader2 className="w-10 h-10 mx-auto animate-spin text-primary" />
          <div className="mt-3 text-sm font-semibold text-ink-700">Loading estimate…</div>
        </div>
      </Shell>
    );
  }

  if (loadError || !info) {
    return (
      <Shell>
        <ErrorCard
          title="Estimate link not available"
          subtitle={loadError || 'This link is invalid or has expired.'}
          tone="error"
        />
      </Shell>
    );
  }

  if (info.status === 'approved') {
    return (
      <Shell>
        <ErrorCard
          title="Estimate Approved"
          subtitle={`Approved${info.actioned_by_name ? ` by ${info.actioned_by_name}` : ''}${info.actioned_on ? ` on ${formatDate(info.actioned_on)}` : ''}.`}
          tone="success"
        />
      </Shell>
    );
  }

  if (info.status === 'rejected') {
    return (
      <Shell>
        <ErrorCard
          title="Estimate Rejected"
          subtitle={
            `Rejected${info.actioned_by_name ? ` by ${info.actioned_by_name}` : ''}` +
            `${info.actioned_on ? ` on ${formatDate(info.actioned_on)}` : ''}.` +
            (info.reject_reason ? `\nReason: ${info.reject_reason}` : '')
          }
          tone="error"
        />
      </Shell>
    );
  }

  // Pending state — render PDF + Approve/Reject controls.
  const pdfUrl = `${FILE_BASE}${info.pdf_path}`;

  return (
    <Shell>
      <div className="bg-surface rounded-2xl shadow-xl overflow-hidden">
        {/* Job summary band — concise context above the PDF. */}
        <div className="px-5 py-4 border-b border-ink-100 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-primary-dark font-semibold">
              <FileText className="w-3.5 h-3.5" />
              Estimate · Job #{info.job_id}
            </div>
            <h1 className="mt-0.5 text-lg font-semibold text-ink-900">
              Review &amp; Approve Estimate
            </h1>
            <div className="mt-1 text-xs text-ink-500">
              {info.service_category && <span className="mr-2">{info.service_category}</span>}
              {info.easyfixer_name && <span className="text-ink-300">Raised by {info.easyfixer_name}</span>}
            </div>
          </div>
          {info.client_name && (
            <div className="text-right text-xs">
              <div className="text-ink-300">For</div>
              <div className="text-sm font-semibold text-ink-900">{info.client_name}</div>
            </div>
          )}
        </div>

        {/* PDF viewer — `<iframe>` is the broadest-compat way to render
            a remote PDF in 2024 browsers. Falls back to a "Download"
            link if the browser blocks inline PDFs. */}
        <div className="relative bg-ink-100" style={{ height: '70vh', minHeight: 460 }}>
          {!pdfLoaded && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="w-8 h-8 animate-spin text-ink-300" />
            </div>
          )}
          <iframe
            src={pdfUrl}
            title="Estimate PDF"
            className="w-full h-full"
            onLoad={() => setPdfLoaded(true)}
          />
        </div>

        {/* Action bar — sticky-feeling footer with Approve / Reject.
            The Reject flow expands a reason picker inline rather than
            spawning a modal (matches legacy UX). */}
        <div className="px-5 py-4 border-t border-ink-100 space-y-3">
          {submitError && (
            <div className="rounded-lg bg-danger-tint border border-danger/30 px-3 py-2 text-xs text-danger-text inline-flex items-start gap-2 w-full">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-danger" />
              <span>{submitError}</span>
            </div>
          )}

          {showReject && (
            <div className="rounded-xl border border-ink-100 bg-ink-50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-ink-700">Why are you rejecting this estimate?</div>
                <button
                  type="button"
                  onClick={() => { setShowReject(false); setRejectReason(''); setRejectComment(''); setSubmitError(null); }}
                  className="w-7 h-7 rounded-full grid place-items-center text-ink-500 hover:text-ink-700 hover:bg-ink-100 transition"
                  aria-label="Cancel reject"
                ><X className="w-3.5 h-3.5" /></button>
              </div>
              {/* Native <select> instead of a fancy combobox — cleaner
                  on mobile (system picker) and zero extra deps. */}
              <div className="relative">
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full appearance-none pl-3 pr-9 py-2 text-sm border border-ink-100 rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger"
                >
                  <option value="">Select a reason…</option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink-300" />
              </div>
              <textarea
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                rows={2}
                placeholder="Add a short comment (optional)"
                className="w-full px-3 py-2 text-sm border border-ink-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger"
                maxLength={500}
              />
            </div>
          )}

          <div className="flex items-center gap-2 justify-end flex-wrap">
            <button
              type="button"
              onClick={reject}
              disabled={submitting}
              className={
                'px-4 py-2 text-sm font-semibold rounded-lg inline-flex items-center gap-1.5 transition shadow ' +
                (showReject
                  ? 'bg-danger hover:bg-danger-text text-white'
                  : 'bg-surface border border-danger/30 text-danger-text hover:bg-danger-tint')
              }
            >
              {submitting && showReject
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ThumbsDown className="w-4 h-4" />}
              {showReject ? 'Submit reject' : 'Reject'}
            </button>
            {!showReject && (
              <button
                type="button"
                onClick={approve}
                disabled={submitting}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-success to-success-text text-white shadow hover:shadow-md inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ThumbsUp className="w-4 h-4" />}
                Approve
              </button>
            )}
          </div>

          {/* Fallback — some browsers (older iOS Safari) refuse inline
              PDFs even from same-origin. Give the SPOC a direct link
              so they can still review. */}
          <div className="text-center text-xs text-ink-300">
            Trouble viewing the PDF?{' '}
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="text-link hover:text-info-text underline"
            >
              Open in new tab
            </a>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ─── Helpers ───────────────────────────────────────────────────── */

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/*
 * Shell — page chrome shared by every state. Brand band on top,
 * powered-by-EasyFix line at the bottom, content centred on a
 * fixed-max width card. Keeps the four state branches lean.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-ink-50 via-white to-primary-50 flex flex-col">
      <header className="bg-gradient-to-r from-primary via-primary-dark to-primary text-white px-4 py-3 shadow">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div className="font-semibold text-lg">Estimate Approval</div>
          <div className="text-xs opacity-90">Powered by <span className="font-semibold">EasyFix</span></div>
        </div>
      </header>
      <main className="flex-1 px-3 py-6 sm:py-10 max-w-3xl mx-auto w-full">
        {children}
      </main>
      <footer className="text-center text-xs text-ink-300 py-4">
        © {new Date().getFullYear()} EasyFix · This link is secured by a one-time signed token.
      </footer>
    </div>
  );
}

/*
 * ErrorCard — single component for all the non-pending terminal
 * states (approved success, rejected, expired). `tone` swaps the
 * icon color so the user can read the result at a glance.
 */
function ErrorCard({
  title, subtitle, tone,
}: {
  title: string;
  subtitle: string;
  tone: 'success' | 'error';
}) {
  const Icon = tone === 'success' ? CheckCircle2 : XCircle;
  const iconClass = tone === 'success' ? 'text-success' : 'text-danger';
  return (
    <div className="bg-surface rounded-2xl shadow-xl p-8 sm:p-10 text-center">
      <Icon className={`w-16 h-16 mx-auto ${iconClass}`} />
      <h1 className="mt-4 text-xl font-semibold text-ink-900">{title}</h1>
      <p className="mt-2 text-sm text-ink-500 whitespace-pre-line">{subtitle}</p>
    </div>
  );
}
