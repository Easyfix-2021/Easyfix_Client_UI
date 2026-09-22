'use client';

/*
 * ApproveQuotationDialog — shared by every "Approve Estimate" call site.
 *
 * Owner-approved design (2026-09-22): approving an estimate/quotation now also
 * asks for the NEXT VISIT date + time and the ENTRY PERMISSION. One component
 * so the four places that could approve an estimate (Open jobs, the public
 * estimate link, and — once they grow a live Approve trigger again —
 * action-queue / job detail) all ask the same two questions the same way.
 *
 * Backend contract (parallel change):
 *   GET  <slots path>   → { technician_id, days: [{ date: 'YYYY-MM-DD',
 *                            hours: [{ hour: 9..18, free: boolean }] }] }
 *   the approve call    → multipart/form-data:
 *                            visit_date_time  'YYYY-MM-DD HH:00:00' (IST wall clock)
 *                            permission       'now' | 'later' | 'not_required'
 *                            permission_file  required iff permission === 'now'
 *                          → { visit_date_time, permission: { choice, request_id } }
 *   Errors: 400 with a message; 409 "That slot was just booked — pick another".
 *
 * WHY `loadSlots` / `approve` ARE INJECTED, NOT CALLED HERE. The authed portal
 * hits /client/jobs/:id/... through `api` (Bearer token, JSON envelope); the
 * public estimate link hits /public/estimate/:token/... through a bare
 * `fetch` with no token. Baking either one in here would make this component
 * work for only one of its four callers. Each caller wires its own transport;
 * this component owns only the form and the slot/permission rules.
 *
 * WHY THE HOUR LABEL NEVER TOUCHES `Date`/`Intl`. `hour` (9..18) is already the
 * technician's IST wall-clock hour — the backend picked it precisely so the
 * client never has to convert a timezone to render it. Running it through
 * `new Date(...)` and a locale formatter would re-introduce exactly the
 * browser-timezone bug `src/lib/format.ts` exists to prevent. `slotLabel`
 * below is pure integer arithmetic instead.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarDays, CheckCircle2, Loader2, ShieldCheck, Upload, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatIstDayDate } from '@/lib/format';

/* ─── contract types ────────────────────────────────────────────────────── */

export type VisitHourSlot = { hour: number; free: boolean };
export type VisitDay = { date: string; hours: VisitHourSlot[] };
export type VisitSlotsResponse = { technician_id: number; days: VisitDay[] };
export type PermissionChoice = 'now' | 'later' | 'not_required';
export type ApproveResult = {
  visit_date_time: string;
  permission: { choice: PermissionChoice; request_id: number | null };
};

/* ─── pure logic (exported for tests — no DOM, no fetch) ───────────────── */

/** "9 AM", "12 PM", "6 PM" — plain integer arithmetic, no Date object. */
function fmt12(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${period}`;
}

/** "10 AM – 11 AM" for the hour a 1-hour slot starts at. */
export function slotLabel(hour: number): string {
  return `${fmt12(hour)} – ${fmt12(hour + 1)}`;
}

/** 'YYYY-MM-DD HH:00:00' — the IST wall-clock string the backend expects. */
export function toVisitDateTime(date: string, hour: number): string {
  return `${date} ${String(hour).padStart(2, '0')}:00:00`;
}

/** "Mon, 25 Aug, 10 AM – 11 AM" — the success-toast summary. `date` is a bare
 *  calendar date FROM THE BACKEND, so formatIstDayDate is the right primitive
 *  (see its own header note on locally-constructed dates, which this is not). */
export function formatVisitSummary(date: string, hour: number): string {
  return `${formatIstDayDate(date)}, ${slotLabel(hour)}`;
}

export const MAX_PERMISSION_FILE_BYTES = 10 * 1024 * 1024;
const PERMISSION_MIME = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);
/* MIME-first, extension fallback: iOS Camera Roll HEIC photos frequently arrive
 * with an empty or generic `file.type` in Safari/Chrome-iOS. */
const PERMISSION_EXT = /\.(pdf|jpe?g|png|webp|heic|heif)$/i;
export const PERMISSION_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';

/** null = valid. Only meaningful when a file is required (`permission === 'now'`). */
export function validatePermissionFile(file: File | null): string | null {
  if (!file) return 'Please choose a file.';
  const typeOk = PERMISSION_MIME.has(file.type) || PERMISSION_EXT.test(file.name);
  if (!typeOk) return 'Only PDF, JPEG, PNG, WEBP or HEIC files are accepted.';
  if (file.size > MAX_PERMISSION_FILE_BYTES) return 'That file is larger than 10MB. Please choose a smaller file.';
  return null;
}

export type ApproveFormState = {
  date: string | null;
  hour: number | null;
  choice: PermissionChoice | null;
  file: File | null;
};

/** The Approve button's disabled/enabled gate — every required field present
 *  and, for 'now', a file that passes validatePermissionFile. */
export function isApproveFormValid(state: ApproveFormState): boolean {
  if (!state.date || state.hour == null) return false;
  if (!state.choice) return false;
  if (state.choice === 'now') return validatePermissionFile(state.file) === null;
  return true;
}

/** True for the one error the flow treats specially: someone else took the
 *  slot between load and submit. Keyed on HTTP status, not on message text,
 *  because the message is free text the backend may still tweak. */
export function isSlotConflict(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { status?: unknown }).status === 409;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/* ─── component ─────────────────────────────────────────────────────────── */

type Props = {
  open: boolean;
  onClose: () => void;
  /** Fetches { technician_id, days } for this job/estimate. Re-invoked after a 409. */
  loadSlots: () => Promise<VisitSlotsResponse>;
  /** Submits the multipart approve request. Must reject with `{ status }` (e.g. ApiError) on failure. */
  approve: (form: FormData) => Promise<ApproveResult>;
  /** Called once the backend confirms approval. `summary` is the human slot label for a toast. */
  onApproved: (result: ApproveResult, summary: string) => void;
};

export function ApproveQuotationDialog({ open, onClose, loadSlots, approve, onApproved }: Props) {
  const [slots, setSlots] = useState<VisitSlotsResponse | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [date, setDate] = useState<string | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [choice, setChoice] = useState<PermissionChoice | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchSlots = useCallback(async () => {
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      setSlots(await loadSlots());
    } catch (err) {
      setSlots(null);
      setSlotsError(errorMessage(err, 'Could not load available visit slots.'));
    } finally {
      setSlotsLoading(false);
    }
  }, [loadSlots]);

  // Fresh form every time the dialog opens — a half-filled form from the last
  // job (or the last, now-stale, slot list) must never carry over.
  useEffect(() => {
    if (!open) return;
    setDate(null); setHour(null); setChoice(null); setFile(null);
    setFileError(null); setSubmitError(null); setSlots(null);
    void fetchSlots();
  }, [open, fetchSlots]);

  // Esc closes, but never mid-submit — that would orphan the in-flight request.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const days = slots?.days ?? [];
  const activeDay = days.find((d) => d.date === date) ?? null;

  function pickFile(f: File | null) {
    setFile(f);
    setFileError(f ? validatePermissionFile(f) : null);
  }

  function pickDate(d: string) {
    setDate(d);
    setHour(null); // a slot from the PREVIOUS day must never survive a day change
  }

  const valid = isApproveFormValid({ date, hour, choice, file });

  async function submit() {
    if (!date || hour == null || !choice || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const fd = new FormData();
    fd.set('visit_date_time', toVisitDateTime(date, hour));
    fd.set('permission', choice);
    if (choice === 'now' && file) fd.set('permission_file', file);
    try {
      const result = await approve(fd);
      onApproved(result, formatVisitSummary(date, hour));
    } catch (err) {
      if (isSlotConflict(err)) {
        setSubmitError(errorMessage(err, 'That slot was just booked — pick another'));
        setDate(null);
        setHour(null);
        void fetchSlots();
      } else {
        setSubmitError(errorMessage(err, 'Could not approve the estimate.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="approve-quotation-title" className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={() => { if (!submitting) onClose(); }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-ink-100">
          <h2 id="approve-quotation-title" className="text-base font-semibold text-ink-900">Approve Estimate</h2>
          <button
            type="button"
            aria-label="Close"
            disabled={submitting}
            onClick={onClose}
            className="p-1 rounded text-ink-300 hover:text-ink-700 hover:bg-surface-alt transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* ─── Next Visit ─────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
              <CalendarDays className="w-4 h-4 text-primary" /> Next Visit <span className="text-danger">*</span>
            </div>

            {slotsLoading && (
              <p className="text-xs text-ink-500 inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading available slots…
              </p>
            )}
            {slotsError && !slotsLoading && (
              <div className="rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger-text space-y-1.5">
                <p className="inline-flex items-start gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {slotsError}</p>
                <button type="button" onClick={() => void fetchSlots()} className="font-semibold underline">
                  Try again
                </button>
              </div>
            )}

            {!slotsLoading && !slotsError && (
              <>
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Visit day">
                  {days.map((d) => (
                    <button
                      key={d.date}
                      type="button"
                      role="tab"
                      aria-selected={date === d.date}
                      onClick={() => pickDate(d.date)}
                      className={cn(
                        'px-2.5 py-1.5 rounded-lg border text-xs font-medium transition whitespace-nowrap',
                        date === d.date
                          ? 'border-primary bg-primary-50 text-primary'
                          : 'border-ink-100 bg-surface text-ink-700 hover:border-ink-300',
                      )}
                    >
                      {formatIstDayDate(d.date)}
                    </button>
                  ))}
                  {days.length === 0 && (
                    <p className="text-xs text-ink-500">No visit slots are available in the next 30 days.</p>
                  )}
                </div>

                {activeDay && (
                  <div className="flex flex-wrap gap-1.5">
                    {activeDay.hours.map((h) => (
                      <button
                        key={h.hour}
                        type="button"
                        disabled={!h.free}
                        aria-pressed={hour === h.hour}
                        onClick={() => setHour(h.hour)}
                        className={cn(
                          'px-2.5 py-1.5 rounded-lg border text-xs font-medium transition whitespace-nowrap',
                          !h.free && 'opacity-40 cursor-not-allowed line-through border-ink-100 bg-ink-50 text-ink-300',
                          h.free && hour === h.hour && 'border-primary bg-primary text-white',
                          h.free && hour !== h.hour && 'border-ink-100 bg-surface text-ink-700 hover:border-ink-300',
                        )}
                      >
                        {slotLabel(h.hour)}
                      </button>
                    ))}
                  </div>
                )}
                {!activeDay && days.length > 0 && (
                  <p className="text-xs text-ink-500">Choose a day to see available times.</p>
                )}
              </>
            )}
          </section>

          {/* ─── Entry Permission ───────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
              <ShieldCheck className="w-4 h-4 text-primary" /> Entry Permission <span className="text-danger">*</span>
            </div>

            <div className="space-y-2">
              <PermissionOption
                id="permission-now"
                checked={choice === 'now'}
                onSelect={() => setChoice('now')}
                label="Upload Now"
              >
                <label htmlFor="permission-file" className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-ink-100 px-3 py-2 text-xs font-medium text-ink-700 hover:border-primary hover:text-primary cursor-pointer transition">
                  <Upload className="w-3.5 h-3.5" />
                  {file ? file.name : 'Choose a file'}
                </label>
                <input
                  id="permission-file"
                  type="file"
                  accept={PERMISSION_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    pickFile(f);
                  }}
                />
                {fileError && <p className="mt-1 text-xs text-danger-text">{fileError}</p>}
                <p className="mt-1 text-xs text-ink-500">PDF, JPEG, PNG, WEBP or HEIC — up to 10MB.</p>
              </PermissionOption>

              <PermissionOption
                id="permission-later"
                checked={choice === 'later'}
                onSelect={() => setChoice('later')}
                label="Upload Later"
              >
                <p className="mt-1 text-xs text-ink-500">
                  You can upload it from Permission Requests; the technician will see it.
                </p>
              </PermissionOption>

              <PermissionOption
                id="permission-not-required"
                checked={choice === 'not_required'}
                onSelect={() => setChoice('not_required')}
                label="Not Required"
              />
            </div>
          </section>

          {submitError && (
            <p className="rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {submitError}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-ink-100">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-outline">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || submitting}
            className="btn-primary"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Approving…</>
              : <><CheckCircle2 className="w-4 h-4" /> Approve</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function PermissionOption({
  id, checked, onSelect, label, children,
}: {
  id: string;
  checked: boolean;
  onSelect: () => void;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(
      'rounded-lg border px-3 py-2.5',
      checked ? 'border-primary bg-primary-50' : 'border-ink-100 bg-surface',
    )}>
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium text-ink-900 cursor-pointer">
        <input
          id={id}
          type="radio"
          name="permission-choice"
          checked={checked}
          onChange={onSelect}
          className="accent-primary"
        />
        {label}
      </label>
      {checked && children}
    </div>
  );
}
