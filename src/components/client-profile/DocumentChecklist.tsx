'use client';

/*
 * Client Profile → Overview → your documents.
 *
 * The same tbl_client_document rows the EasyFix CRM sees, scoped server-side
 * to your own client. Endpoints:
 *   GET    /api/client/company/documents
 *   POST   /api/client/company/documents      (multipart)
 *   DELETE /api/client/company/documents/:id
 *
 * WHY A CHECKLIST AND NOT AN UPLOAD FORM. The question a client actually has
 * is "what does EasyFix still need from us?" — so each expected document is a
 * named slot that is either filled or shows an upload control, and a gap is
 * visible without reading a list. Anything uploaded outside the named set is
 * still listed under Other, so nothing becomes unreachable.
 *
 * SLOT → doc_type. The backend vocabulary is fixed (pan | tan | gstin |
 * aadhaar | other) and predates these labels, so the slots translate rather
 * than rename the API — CIN rides on `tan` and MOU on `aadhaar`, the same
 * legacy conventions tbl_client's own tan_number / client_aadhaar columns use.
 * Logo, Profile Photo and About Media all ride on `other`, distinguished by
 * doc_label, because three new doc_type values would be a backend enum change
 * for what is purely a labelling difference.
 *
 * Presigned S3 URLs come back on each row, so a plain <img>/<a href> works —
 * these are NOT authenticated portal endpoints and need no bearer.
 */

import { useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { api, ApiError } from '@/lib/api';
import { useFetchOnce } from '@/lib/hooks';
import type { CompanyDocument, DocumentsResponse } from './types';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';

type Slot = {
  key: string;
  label: string;
  docType: 'pan' | 'tan' | 'gstin' | 'aadhaar' | 'other';
  docLabel?: string;
};

const CHECKLIST: Slot[] = [
  { key: 'cin',  label: 'CIN',  docType: 'tan' },
  { key: 'pan',  label: 'PAN',  docType: 'pan' },
  { key: 'gst',  label: 'GST',  docType: 'gstin' },
  { key: 'mou',  label: 'MOU',  docType: 'aadhaar' },
  { key: 'logo', label: 'Logo', docType: 'other', docLabel: 'Logo' },
];

const PROFILE_PHOTO: Slot = { key: 'photo', label: 'Profile Photo', docType: 'other', docLabel: 'Profile Photo' };
const ABOUT_MEDIA_LABEL = 'About Media';

export function DocumentChecklist() {
  const { data, loading, error, reload } = useFetchOnce<DocumentsResponse>('/company/documents');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ doc: CompanyDocument; label: string } | null>(null);

  const items = data?.items ?? [];
  const canEdit = !!data?.canEdit;

  /* Newest row wins — re-uploading a slot adds a row rather than replacing one. */
  const find = (slot: Slot) => items.find((d) => d.doc_type === slot.docType
    && (slot.docLabel ? (d.doc_label ?? '') === slot.docLabel : true));

  const aboutMedia = items.filter((d) => (d.doc_label ?? '') === ABOUT_MEDIA_LABEL);
  const claimed = new Set<number>();
  for (const s of [...CHECKLIST, PROFILE_PHOTO]) {
    const hit = find(s);
    if (hit) claimed.add(hit.document_id);
  }
  for (const m of aboutMedia) claimed.add(m.document_id);
  const others = items.filter((d) => !claimed.has(d.document_id));

  async function upload(slotKey: string, file: File, docType: string, docLabel?: string) {
    setBusy(slotKey);
    setActionError(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('docType', docType);
      if (docLabel) fd.set('docLabel', docLabel);
      await api.upload('/company/documents', fd);
      await reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally { setBusy(null); }
  }

  /*
   * Removal is confirmed through the portal's own ConfirmDialog, never
   * window.confirm — a native dialog is unstyled, unbrandable and blocks the
   * whole tab, and this app already owns a modal for exactly this.
   */
  function askRemove(doc: CompanyDocument, label: string) {
    setPendingDelete({ doc, label });
  }

  async function confirmRemove() {
    if (!pendingDelete) return;
    const { doc } = pendingDelete;
    setBusy(`del-${doc.document_id}`);
    setActionError(null);
    try {
      await api.delete(`/company/documents/${doc.document_id}`);
      setPendingDelete(null);
      await reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not remove that file.');
      setPendingDelete(null);
    } finally { setBusy(null); }
  }

  if (data && !data.provisioned) {
    return (
      <aside className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900">Document Checklist</h3>
        <p className="text-xs text-ink-500 bg-ink-50 border border-ink-100 rounded-lg px-3 py-2">
          Document uploads are not switched on for your account yet. Send files to
          your EasyFix SPOC in the meantime.
        </p>
      </aside>
    );
  }

  return (
    <aside className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900">Document Checklist</h3>
        {loading && <p className="text-xs text-ink-500">Loading…</p>}
        {error && <p className="text-xs text-danger-text">{error}</p>}
        {actionError && (
          <p className="text-xs text-danger-text bg-danger-tint border border-danger/30 rounded px-2 py-1.5">
            {actionError}
          </p>
        )}
        <ul className="space-y-2">
          {CHECKLIST.map((slot) => (
            <SlotRow
              key={slot.key}
              slot={slot}
              doc={find(slot)}
              canEdit={canEdit}
              busy={busy === slot.key}
              deleting={busy === `del-${find(slot)?.document_id}`}
              onUpload={(f) => upload(slot.key, f, slot.docType, slot.docLabel)}
              onRemove={(d) => askRemove(d, slot.label)}
            />
          ))}
        </ul>
        <p className="text-xs text-info-text bg-info-tint border-l-2 border-info rounded-r px-3 py-2">
          Attach your NDA, SLA, MOU and signed rate card here — anything without a
          slot goes under &ldquo;Other&rdquo;.
        </p>
        <UploadButton
          label="Other" canEdit={canEdit} busy={busy === 'other'}
          onPick={(f) => upload('other', f, 'other')}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900">Profile Photo</h3>
        <SlotRow
          slot={PROFILE_PHOTO}
          doc={find(PROFILE_PHOTO)}
          canEdit={canEdit}
          busy={busy === PROFILE_PHOTO.key}
          deleting={busy === `del-${find(PROFILE_PHOTO)?.document_id}`}
          preview
          onUpload={(f) => upload(PROFILE_PHOTO.key, f, PROFILE_PHOTO.docType, PROFILE_PHOTO.docLabel)}
          onRemove={(d) => askRemove(d, PROFILE_PHOTO.label)}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900">About-Us Media</h3>
        <p className="text-xs text-ink-500">
          Site photos, briefing decks or walkthroughs that help our technicians
          arrive prepared.
        </p>
        {aboutMedia.length === 0 && !loading && (
          <p className="text-xs text-ink-500 italic">Nothing uploaded.</p>
        )}
        <ul className="space-y-1">
          {aboutMedia.map((d) => (
            <li key={d.document_id} className="rounded-lg border border-ink-100 bg-surface px-3 py-2 flex items-center justify-between gap-2 text-xs">
              <DocLink doc={d} fallback="Media" />
              {canEdit && (
                <button
                  type="button" aria-label="Remove media"
                  onClick={() => askRemove(d, 'this file')}
                  className="text-danger hover:text-danger-text shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <UploadButton
          label="Media" canEdit={canEdit} busy={busy === 'about'}
          onPick={(f) => upload('about', f, 'other', ABOUT_MEDIA_LABEL)}
        />
      </section>

      {others.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink-900">Other Documents</h3>
          <ul className="space-y-1">
            {others.map((d) => (
              <li key={d.document_id} className="rounded-lg border border-ink-100 bg-surface px-3 py-2 flex items-center justify-between gap-2 text-xs">
                <DocLink doc={d} fallback={d.doc_type.toUpperCase()} />
                {canEdit && (
                  <button
                    type="button" aria-label="Remove document"
                    onClick={() => askRemove(d, d.doc_label || d.doc_type.toUpperCase())}
                    className="text-danger hover:text-danger-text shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmRemove}
        busy={!!busy && busy.startsWith('del-')}
        title="Remove Document"
        message={`Remove ${pendingDelete?.label ?? 'this file'}? EasyFix will no longer see it.`}
        confirmLabel="Remove"
        tone="danger"
      />
    </aside>
  );
}

function SlotRow({
  slot, doc, canEdit, busy, deleting, preview, onUpload, onRemove,
}: {
  slot: Slot;
  doc?: CompanyDocument;
  canEdit: boolean;
  busy: boolean;
  deleting: boolean;
  preview?: boolean;
  onUpload: (file: File) => void;
  onRemove: (doc: CompanyDocument) => void;
}) {
  if (!doc) {
    return (
      <li>
        <UploadButton label={slot.label} canEdit={canEdit} busy={busy} onPick={onUpload} />
      </li>
    );
  }
  const isImage = !!doc.content_type?.startsWith('image/');
  return (
    <li className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-2 min-w-0">
        {preview && isImage && doc.url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={doc.url} alt={slot.label} className="w-8 h-8 rounded object-cover shrink-0" />
          : <FileText className="w-3.5 h-3.5 text-ink-500 shrink-0" />}
        <span className="min-w-0">
          <span className="font-semibold text-ink-900">{slot.label}</span>
          {doc.original_filename && <span className="text-ink-500"> — {doc.original_filename}</span>}
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {doc.url && (
          <a href={doc.url} target="_blank" rel="noopener noreferrer"
            className="text-primary hover:text-primary-dark inline-flex items-center gap-0.5 font-semibold">
            <ExternalLink className="w-3 h-3" /> Open
          </a>
        )}
        {canEdit && (
          <button
            type="button" aria-label={`Remove ${slot.label}`} disabled={deleting}
            onClick={() => onRemove(doc)}
            className="text-danger hover:text-danger-text disabled:opacity-50"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </span>
    </li>
  );
}

/*
 * "+ Upload X" over a hidden file input. The input is reset after every pick
 * so re-choosing the SAME file fires change again — without that, a failed
 * upload cannot be retried with the same file.
 */
function UploadButton({
  label, canEdit, busy, onPick,
}: {
  label: string;
  canEdit: boolean;
  busy: boolean;
  onPick: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  if (!canEdit) {
    return (
      <div className="rounded-lg border border-dashed border-ink-100 px-3 py-2 text-xs text-ink-500 text-center">
        {label} — not uploaded
      </div>
    );
  }
  return (
    <>
      <input
        ref={ref} type="file" accept={ACCEPT} className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
      <button
        type="button" disabled={busy} onClick={() => ref.current?.click()}
        className="w-full rounded-lg border border-dashed border-ink-100 px-3 py-2 text-xs font-semibold text-ink-500 hover:border-primary hover:text-primary transition inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        {busy ? 'Uploading…' : `Upload ${label}`}
      </button>
    </>
  );
}

function DocLink({ doc, fallback }: { doc: CompanyDocument; fallback: string }) {
  const name = doc.doc_label || doc.original_filename || fallback;
  return (
    <span className="flex items-center gap-2 min-w-0">
      <FileText className="w-3.5 h-3.5 text-ink-500 shrink-0" />
      {doc.url
        ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-dark truncate font-semibold">{name}</a>
        : <span className="truncate">{name}</span>}
    </span>
  );
}
