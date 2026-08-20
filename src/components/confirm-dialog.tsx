'use client';

/*
 * ConfirmDialog — centred modal with Cancel / Confirm actions.
 *
 * Generic enough to reuse for any destructive action (logout, cancel
 * ticket, delete user, etc.). Pass an async `onConfirm` and the dialog
 * shows a loading state until the promise settles. Closing on backdrop
 * click + Escape, matching native browser dialog conventions.
 *
 * Why custom instead of <dialog>: the native element's backdrop and
 * close behaviour need feature-detection across older browsers, and we
 * want full Tailwind control over the look. Keeping it portable.
 */
import { useEffect } from 'react';
import { AlertTriangle, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';   // colour of the confirm button
  busy?: boolean;                // parent-controlled loading flag
  icon?: React.ComponentType<{ className?: string }>;
};

export function ConfirmDialog({
  open, onClose, onConfirm,
  title, message,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  icon: Icon = AlertTriangle,
}: Props) {
  // Esc closes the dialog (but never while busy — would orphan the
  // in-flight request).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  // Lock body scroll while the dialog is open so the page behind doesn't
  // scroll on touch / scroll-wheel events.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const confirmClass = tone === 'danger'
    ? 'bg-danger hover:bg-danger-text focus:ring-danger/40 text-white'
    : 'bg-primary hover:bg-primary-dark focus:ring-primary/40 text-white';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop — click to close (unless busy) */}
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={() => { if (!busy) onClose(); }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />

      {/* Card */}
      <div
        className={cn(
          'relative bg-surface rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-150'
        )}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="absolute top-3 right-3 p-1 rounded text-ink-300 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4">
          <div className={cn(
            'shrink-0 w-11 h-11 rounded-full flex items-center justify-center',
            tone === 'danger' ? 'bg-danger-tint text-danger' : 'bg-primary/10 text-primary'
          )}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="confirm-dialog-title" className="text-lg font-semibold text-ink-900">
              {title}
            </h2>
            <p className="mt-1 text-sm text-ink-500">{message}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-ink-700 border border-ink-100 hover:bg-ink-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => { void onConfirm(); }}
            disabled={busy}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed',
              confirmClass
            )}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
