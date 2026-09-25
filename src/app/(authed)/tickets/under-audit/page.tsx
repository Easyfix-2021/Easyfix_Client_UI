'use client';

/*
 * Quality Check — V3 Phase 3, sub-project 3.8.
 *
 * Replaces the "Completed & Under Audit" stub (ComingSoon) that lived at this
 * route. The route is kept rather than moved so any existing deep link/nav
 * entry pointed at /tickets/under-audit keeps working — see the layout's
 * EXTRAS entry, which now points here under the "Quality Check" label.
 *
 * WHAT THIS SCREEN IS
 *
 * A job finishes, EasyFix's own audit passes it (`tbl_job_verification.
 * verified_on`), and the client then gets a window (`qc_hours`, per-client via
 * tbl_client_qc_timing, default from the `job.qc.hours.default` property) to
 * look at the completed work before it auto-approves. This page is that
 * window: every job in `qc_status = 'pending'` for this client, oldest first,
 * with the plain choice — Approve, or Dispute with a note.
 *
 * WHERE THE ROWS COME FROM
 *
 *   GET  /client/qc?limit=&offset=   — bounded (see LIMIT), scoped to this
 *                                       SPOC's client the same way every other
 *                                       /client/* route is.
 *   POST /client/jobs/:id/qc/approve — clears the row; the ledger post follows
 *                                       server-side (postAfterQc), not here.
 *   POST /client/jobs/:id/qc/dispute — {note}. Puts the job back in EasyFix's
 *                                       hands (band C/D on the ops desk); the
 *                                       note is required because a dispute with
 *                                       no reason gives the desk nothing to
 *                                       act on.
 *
 * Field names are the ones GET /client/qc actually returns
 * (services/job-verification.service.js clientQcList): jobId, reference,
 * service, technician, finishedOn, verifiedOn, dueOn. finishedOn is the
 * technician's check-out — what the client knows as "completed".
 *
 * WHY NO GRANT. /jobs, /completed and /action-queue — the other Operations
 * surfaces — carry no `grant` in the nav (see (authed)/layout.tsx PRIMARY):
 * every SPOC has Operations. Quality Check is exactly that kind of surface
 * (a job outcome, not a gated report), so it is left ungated here too; the
 * backend's own SPOC scoping is the real boundary, same as every other
 * /client/* route.
 */
import { Fragment, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, XCircle } from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import { openJobDrawer } from '@/components/job-drawer';
import { formatIst } from '@/lib/format';
import { autoApprovesLabel } from '@/lib/qc';
import {
  PageHeader, SectionLabel, Panel, DataTable, Row, Cell, Pill,
  ActionButton, EmptyState,
} from '@/components/ui/console';

type QcItem = {
  jobId: number;
  reference: string | null;
  service: string | null;
  technician: string | null;
  finishedOn: string | null;
  verifiedOn?: string | null;
  dueOn: string | null;
};
type QcQueue = { items: QcItem[]; total: number };

/* The endpoint's own bound. Matches the order of magnitude of every other
 * purpose-built queue in this portal (/action-queue's own ?limit=100). */
const LIMIT = 100;

export default function QualityCheckPage() {
  const { data, loading, error, reload } = useFetchOnce<QcQueue>(`/qc?limit=${LIMIT}&offset=0`);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const items = data?.items ?? [];

  function openDispute(jobId: number) {
    setActError(null);
    setNote('');
    setDisputeId(jobId);
  }
  function cancelDispute() {
    setDisputeId(null);
    setNote('');
  }

  async function approve(jobId: number) {
    setBusyId(jobId); setActError(null);
    try {
      await api.post(`/jobs/${jobId}/qc/approve`, {});
      await reload();
    } catch (err) {
      setActError(err instanceof ApiError ? err.message : 'Could not approve this job.');
    } finally {
      setBusyId(null);
    }
  }

  async function submitDispute(jobId: number) {
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      setActError('Please describe the issue (minimum 3 characters) before sending.');
      return;
    }
    setBusyId(jobId); setActError(null);
    try {
      await api.post(`/jobs/${jobId}/qc/dispute`, { note: trimmed });
      setDisputeId(null);
      setNote('');
      await reload();
    } catch (err) {
      setActError(err instanceof ApiError ? err.message : 'Could not send the dispute.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-surface rounded-xl border border-ink-100 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-ink-300" aria-hidden />
        <div className="mt-2 text-sm text-ink-500">Loading your quality checks…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Panel accent="brand">
        <EmptyState
          icon={AlertTriangle}
          title="Could not load Quality Check"
          sub={error || 'The QC service did not respond.'}
          action={<ActionButton onClick={() => void reload()}>Try Again</ActionButton>}
        />
      </Panel>
    );
  }

  return (
    <>
      <PageHeader
        title="Quality Check"
        sub={
          items.length === 0
            ? 'Nothing waiting for your check'
            : `${items.length} job${items.length === 1 ? '' : 's'} waiting${items.length >= LIMIT ? ` · the ${LIMIT} oldest` : ''}`
        }
      />

      {actError && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {actError}
        </div>
      )}

      <SectionLabel>Completed jobs awaiting your sign-off</SectionLabel>
      <Panel
        accent={items.length ? 'brand' : undefined}
        title="Quality Check"
        action={items.length ? <Pill accent="brand">{items.length} pending</Pill> : null}
        bodyClassName="p-0"
      >
        {items.length ? (
          <DataTable
            className="border-0 rounded-none"
            columns={[
              { key: 'job', label: 'Job' },
              { key: 'service', label: 'Service' },
              { key: 'technician', label: 'Technician' },
              { key: 'completed', label: 'Completed' },
              { key: 'due', label: 'Auto-approves' },
              { key: 'actions', label: 'Actions', align: 'right' },
            ]}
          >
            {items.map((it) => (
              <Fragment key={it.jobId}>
                <Row>
                  <Cell>
                    <button
                      type="button"
                      onClick={() => openJobDrawer(it.jobId)}
                      className="font-medium text-primary hover:underline"
                    >
                      {it.reference || `Job ${it.jobId}`}
                    </button>
                  </Cell>
                  <Cell>{it.service || '—'}</Cell>
                  <Cell>{it.technician || '—'}</Cell>
                  <Cell>{formatIst(it.finishedOn, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Cell>
                  <Cell>
                    <Pill accent="info">{autoApprovesLabel(it.dueOn)}</Pill>
                  </Cell>
                  <Cell align="right">
                    <div className="flex items-center justify-end gap-2">
                      <ActionButton
                        onClick={() => void approve(it.jobId)}
                        disabled={busyId === it.jobId}
                      >
                        {busyId === it.jobId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Approve
                      </ActionButton>
                      <ActionButton
                        onClick={() => openDispute(it.jobId)}
                        disabled={busyId === it.jobId}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Dispute
                      </ActionButton>
                    </div>
                  </Cell>
                </Row>
                {disputeId === it.jobId && (
                  <tr className="border-b border-ink-100 bg-surface-alt">
                    <td colSpan={6} className="px-3 py-3">
                      <label className="block text-xs font-medium text-ink-500 mb-1.5">
                        What is wrong with this job? (required)
                      </label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full min-h-[80px] resize-y rounded-lg border border-ink-100 bg-surface px-3 py-2 text-sm text-ink-900"
                        placeholder="Tell us what needs to be fixed (minimum 3 characters)…"
                        autoFocus
                      />
                      <div className="flex gap-2 mt-2.5">
                        <ActionButton
                          variant="primary"
                          onClick={() => void submitDispute(it.jobId)}
                          disabled={busyId === it.jobId}
                        >
                          {busyId === it.jobId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                          Send Dispute
                        </ActionButton>
                        <ActionButton onClick={cancelDispute} disabled={busyId === it.jobId}>
                          Cancel
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </DataTable>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="Nothing waiting for your check."
            sub="Completed jobs land here once EasyFix has verified them, and stay until you approve, dispute, or the timer above closes them."
          />
        )}
      </Panel>
    </>
  );
}
