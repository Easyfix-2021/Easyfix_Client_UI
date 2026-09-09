'use client';

/*
 * Site Access Requests — the client's half of "the technician cannot get in".
 *
 * A technician standing at a mall gate / society desk raises a request against
 * the job from the technician app. It lands HERE, on the job it blocks, and the
 * client either uploads the gate pass / NOC / access letter or declines with a
 * reason. Someone is waiting on site while this is on screen, which is the only
 * reason this panel is loud.
 *
 * WHY IT LIVES ON THE JOB AND NOT IN A NEW TOP-LEVEL SECTION
 *   The request is meaningless without its job — the address, the customer, the
 *   technician's name and the appointment are the context that lets a SPOC
 *   decide. So this mounts on the two surfaces a client already opens for one
 *   job: the job detail page and the job drawer (which is what a job-id click
 *   opens from every list). It renders NOTHING when the job has no requests, so
 *   every other job page is unchanged.
 *
 *   That is still true and still not enough on its own: nobody opens a job to
 *   find out there is a reason to open it. The console-level counterpart is
 *   @/components/pending-on-you, which lists the OPEN requests across every job
 *   and answers them through this file's RequestList — one implementation of
 *   the upload, the size gate and the decline, rendered on two surfaces.
 *
 * ENDPOINTS (agent A's contract, verbatim — the client half):
 *   GET  /api/client/jobs/:jobId/permission-requests
 *        → { items: [{ id, kind, note, status, requestedAt, fulfilledAt, documentUrl }] }
 *   POST /api/client/permission-requests/:id/fulfil    multipart, file field "file"
 *        → { id, status: 'fulfilled', documentUrl }
 *   POST /api/client/permission-requests/:id/decline   { reason }
 *        → { id, status: 'declined', reason }
 *
 * `documentUrl` is a PRESIGNED url or null, never an authed portal endpoint —
 * an <img>/<a> pointing at a bearer-only endpoint 401s with no visible error in
 * this app, which is why the contract specifies presigned. We therefore link it
 * directly, exactly as the client-profile Document Checklist does.
 *
 * WHY A LINK AND NOT A THUMBNAIL. The contract carries no content type, and S3
 * keys in this estate are stored WITHOUT a file extension (MIME rides on
 * Content-Type), so nothing on this side can tell a JPEG from a PDF. A link
 * opens both correctly; an <img> would render a broken box for every PDF. If
 * the item shape ever grows a content type, an image preview is a one-line add.
 */

import { useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, ExternalLink, Loader2,
  ShieldCheck, Upload, XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { api, ApiError } from '@/lib/api';
import { useFetchOnce } from '@/lib/hooks';
import { formatIst, parseIstDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * The contract's item shape, checked against what the backend actually returns
 * (services/job-permission-request.service.js#toItem):
 *   { id, jobId, kind, note, status, requestedAt, fulfilledAt, documentUrl, reason }
 *
 * `reason` is additive on the backend's side and required on ours — a declined
 * request with no explanation is useless to the technician and to the next SPOC
 * who opens the job — so it is read here as optional and rendered when present.
 *
 * `requestedBy` is the technician's NAME, resolved server-side as a correlated
 * subquery on tbl_easyfixer (ROW_COLS in the service) — a bare efr id tells the
 * person who has to act nothing. It is null when that row is gone, and the card
 * then omits the clause rather than printing a hollow "Raised by —", which is
 * why it stays optional here.
 *
 * `requestedAt` / `fulfilledAt` are zone-less MySQL DATETIMEs in IST (the pool
 * runs dateStrings with timezone '+05:30'), which is why every read of them
 * goes through parseIstDateTime and never through `new Date()`.
 */
export type PermissionRequest = {
  id: number;
  jobId?: number;
  kind: string;
  note: string | null;
  status: 'requested' | 'fulfilled' | 'declined';
  requestedAt: string | null;
  fulfilledAt: string | null;
  documentUrl: string | null;
  reason?: string | null;
  requestedBy?: string | null;
};

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';
/* The fulfil route's own multer limit (10MB, 1 file) — kept in step with it. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/* The decline route's Joi bound: reason is trim().min(3).max(500). */
const REASON_MIN = 3;
const REASON_MAX = 500;

/**
 * How long the technician has been waiting, in the coarsest unit that still
 * conveys urgency. Returns null when there is nothing honest to say — no
 * timestamp, an unparseable one, or a stamp in the FUTURE (clock skew between
 * the technician's phone and the server), because "waiting -3 min" reads as a
 * bug and undermines the one number on this card that matters.
 *
 * `iso` is a zone-less MySQL DATETIME in IST; parseIstDateTime is what turns it
 * into a real instant instead of the browser's local reading of the same digits.
 */
export function waitingFor(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const t = parseIstDateTime(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.floor((now - t) / 60000);
  if (mins < 0) return null;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ${mins % 60} min`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/*
 * `kind` is free text from the technician app, so it can arrive as
 * "Mall Gate Pass", "mall gate pass" or "mall_gate_pass". Underscores and
 * hyphens become spaces here; the capitalisation is left to CSS
 * `capitalize`, which raises each word's first letter and leaves the REST
 * alone — so "Society NOC" survives as "Society NOC" rather than becoming
 * "Society Noc", which a JS title-caser would do.
 */
export function kindLabel(kind: string): string {
  return String(kind || '').replace(/[_-]+/g, ' ').trim() || 'Site Access';
}

const dt = (v: string | null | undefined) =>
  formatIst(v ?? null, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }, { fallback: '' }) || null;

/* Waiting first, then newest first inside each group. */
function ordered(items: PermissionRequest[]): PermissionRequest[] {
  const rank = (s: string) => (s === 'requested' ? 0 : 1);
  return [...items].sort((a, b) => rank(a.status) - rank(b.status) || b.id - a.id);
}

export function SiteAccessRequests({ jobId }: { jobId: number }) {
  const { data, error, reload } = useFetchOnce<{ items: PermissionRequest[] }>(
    jobId ? `/jobs/${jobId}/permission-requests` : null,
  );

  const items = data?.items ?? [];
  const waitingCount = items.filter((r) => r.status === 'requested').length;

  /*
   * A job with no access requests — the overwhelming majority — shows nothing
   * at all. An "Everything is fine" panel on every job page would train people
   * to scroll past the one place this feature has to be noticed.
   *
   * A FAILED load is not the same as an empty one, so it says so — but quietly,
   * in body text rather than as a red alarm. This endpoint is new; a portal
   * running against a backend that predates it must not paint an error banner
   * across every job in the estate.
   */
  if (!items.length) {
    return error ? (
      <p className="text-xs text-ink-500">Site access requests could not be loaded.</p>
    ) : null;
  }

  return (
    <section aria-label="Site Access Requests" className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 grid place-items-center">
          <ShieldCheck className="w-4 h-4 text-primary" />
        </div>
        <h2 className="text-base font-semibold text-ink-900">Site Access</h2>
        {waitingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-danger text-white text-xs font-semibold">
            {/* bg-current, not bg-white: the dot IS the pill's own foreground,
                so it follows the pill if that ever stops being white. */}
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" aria-hidden />
            {waitingCount} Waiting
          </span>
        )}
      </div>

      <RequestList items={items} reload={reload} />
    </section>
  );
}

/*
 * The interactive half — upload, decline, confirm, the two flash lines.
 *
 * Extracted from SiteAccessRequests so the cross-job "Pending on you" panel
 * (@/components/pending-on-you) answers a request with the SAME code rather
 * than a second copy of it. The size gate, the decline bounds, the input reset
 * and the never-window.confirm rule are each one implementation; a copy would
 * be a second place for them to drift.
 *
 * Callers own the heading and the empty state, because the two surfaces frame
 * this differently: on a job it is a section with no chrome when empty, in the
 * console it is a Panel that has to say "nothing waiting".
 *
 * `context` renders above the kind — the job identity, which the job page
 * already has on screen and the console panel does not.
 */
export function RequestList({
  items, reload, context,
}: {
  items: PermissionRequest[];
  reload: () => Promise<void> | void;
  context?: (req: PermissionRequest) => ReactNode;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [flashOk, setFlashOk] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [confirmDecline, setConfirmDecline] = useState(false);

  const rows = ordered(items);

  async function fulfil(req: PermissionRequest, file: File) {
    setActionError(null); setFlashOk(null);
    /*
     * Mirrors the route's own multer limit. Checked here as well so a 12MB
     * photo is refused instantly rather than after the client has pushed it up
     * a mall's congested 4G — the person waiting on that upload is the one
     * standing at the gate.
     */
    if (file.size > MAX_UPLOAD_BYTES) {
      setActionError('That file is larger than 10MB. Please upload a smaller image or PDF.');
      return;
    }
    setBusyId(req.id);
    try {
      const fd = new FormData();
      fd.set('file', file);
      await api.upload(`/permission-requests/${req.id}/fulfil`, fd);
      setFlashOk(`${kindLabel(req.kind)} sent to the technician.`);
      await reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally { setBusyId(null); }
  }

  async function decline() {
    const req = rows.find((r) => r.id === decliningId);
    if (!req) return;
    setBusyId(req.id); setActionError(null); setFlashOk(null);
    try {
      await api.post(`/permission-requests/${req.id}/decline`, { reason: reason.trim() });
      setConfirmDecline(false);
      setDecliningId(null);
      setReason('');
      setFlashOk('The technician has been told access was declined.');
      await reload();
    } catch (e) {
      setConfirmDecline(false);
      setActionError(e instanceof ApiError ? e.message : 'Could not decline that request.');
    } finally { setBusyId(null); }
  }

  return (
    <>
      {actionError && (
        <p className="rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {actionError}
        </p>
      )}
      {flashOk && (
        <p className="rounded-lg border border-success/30 bg-success-tint px-3 py-2 text-sm text-success-text inline-flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-success" /> {flashOk}
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((r) => (
          <RequestCard
            key={r.id}
            req={r}
            context={context?.(r)}
            busy={busyId === r.id}
            declining={decliningId === r.id}
            reason={reason}
            onReason={setReason}
            onStartDecline={() => { setDecliningId(r.id); setReason(''); setActionError(null); }}
            onCancelDecline={() => { setDecliningId(null); setReason(''); }}
            onAskDecline={() => setConfirmDecline(true)}
            onPickFile={(f) => fulfil(r, f)}
          />
        ))}
      </ul>

      <ConfirmDialog
        open={confirmDecline}
        onClose={() => setConfirmDecline(false)}
        onConfirm={decline}
        busy={busyId != null}
        title="Decline Access Request"
        message="The technician is on site and will be told they cannot enter. The visit will need rescheduling."
        confirmLabel="Yes, Decline"
        tone="danger"
      />
    </>
  );
}

function RequestCard({
  req, context, busy, declining, reason,
  onReason, onStartDecline, onCancelDecline, onAskDecline, onPickFile,
}: {
  req: PermissionRequest;
  context?: ReactNode;
  busy: boolean;
  declining: boolean;
  reason: string;
  onReason: (v: string) => void;
  onStartDecline: () => void;
  onCancelDecline: () => void;
  onAskDecline: () => void;
  onPickFile: (f: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const open = req.status === 'requested';
  const waited = waitingFor(req.requestedAt);

  return (
    <li className={cn(
      'rounded-xl border px-4 py-3',
      open ? 'border-danger/40 bg-danger-tint' : 'border-ink-100 bg-surface',
    )}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          {context}
          {open && (
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-danger-text">
              <AlertTriangle className="w-3.5 h-3.5" />
              Technician Waiting On Site
            </div>
          )}
          <div className={cn('text-sm font-semibold capitalize', open ? 'text-danger-text' : 'text-ink-900')}>
            {kindLabel(req.kind)}
          </div>
          {req.note && (
            <p className="mt-0.5 text-sm text-ink-700 whitespace-pre-wrap">{req.note}</p>
          )}
          <p className="mt-1 text-xs text-ink-500">
            {req.requestedBy ? <>Raised by {req.requestedBy} · </> : null}
            {dt(req.requestedAt) || 'Time not recorded'}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {open && waited && (
            <div className="text-sm font-semibold text-danger-text">Waiting {waited}</div>
          )}
          {req.status === 'fulfilled' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success-tint text-success-text ring-1 ring-success/30 text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" /> Fulfilled
            </span>
          )}
          {req.status === 'declined' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-ink-100 text-ink-700 text-xs font-semibold">
              <XCircle className="w-3.5 h-3.5" /> Declined
            </span>
          )}
          {req.status === 'fulfilled' && dt(req.fulfilledAt) && (
            <div className="mt-1 text-xs text-ink-500">{dt(req.fulfilledAt)}</div>
          )}
        </div>
      </div>

      {req.status === 'declined' && req.reason && (
        <p className="mt-2 text-xs text-ink-500">Reason · {req.reason}</p>
      )}

      {/* Presigned URL — a plain link, never an authed endpoint. See the file header. */}
      {req.documentUrl && (
        <a
          href={req.documentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-dark"
        >
          <ExternalLink className="w-3.5 h-3.5" /> View Document
        </a>
      )}

      {open && !declining && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            /*
             * Reset the input after every pick so choosing the SAME file again
             * still fires change — without it a failed upload cannot be retried
             * with the file the user already selected.
             */
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onPickFile(f);
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="btn-primary"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {busy ? 'Uploading…' : 'Upload Document'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onStartDecline}
            className="inline-flex items-center gap-1.5 rounded border border-danger/40 bg-surface px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-tint disabled:opacity-50"
          >
            <XCircle className="w-4 h-4" /> Decline
          </button>
          <span className="text-xs text-ink-500">Image or PDF</span>
        </div>
      )}

      {open && declining && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-ink-700" htmlFor={`decline-reason-${req.id}`}>
            Reason For Declining <span className="text-danger">*</span>
          </label>
          <textarea
            id={`decline-reason-${req.id}`}
            rows={2}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            disabled={busy}
            placeholder="Tell the technician why access cannot be given"
            className="input resize-y min-h-[60px]"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || reason.trim().length < REASON_MIN}
              onClick={onAskDecline}
              className="inline-flex items-center gap-1.5 rounded bg-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-danger-text disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Decline Request
            </button>
            <button type="button" disabled={busy} onClick={onCancelDecline} className="btn-outline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
