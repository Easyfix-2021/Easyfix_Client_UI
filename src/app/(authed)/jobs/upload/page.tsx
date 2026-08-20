'use client';

/*
 * Bulk Job Upload — SPOC version, mirrors the CRM_UI admin page (which
 * is the source of truth at Easyfix_CRM_UI/src/app/(authed)/jobs/upload).
 *
 * Differences from the admin page:
 *  - NO client picker — SPOC's client_id is auto-applied server-side.
 *    Every row in the uploaded file is created against the logged-in
 *    SPOC's own tenant. The backend enforces this; we don't even send
 *    a clientId field.
 *  - Red/white theme (vs. CRM's blue) using existing globals.css
 *    primitives (.card, .btn-primary, .btn-outline, .input, .data-table).
 *  - Calls /jobs/upload (resolves to /api/client/jobs/upload via lib/api).
 */
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Upload, Download, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api, ApiError, getToken } from '@/lib/api';
import { cn } from '@/lib/utils';

// Template endpoint sits OUTSIDE the JSON api wrapper — we fetch it
// directly to get the binary .xlsx response. The path matches the
// /api/client/* prefix so it routes through the same auth.
const TEMPLATE_PATH = '/api/client/jobs/upload-template';

async function downloadTemplate(onErr: (msg: string) => void) {
  try {
    const token = getToken();
    const res = await fetch(TEMPLATE_PATH, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { onErr(`Template download failed (HTTP ${res.status})`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'easyfix-jobs-upload-template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    onErr(err instanceof Error ? err.message : 'Template download failed');
  }
}

type Report = {
  summary: {
    totalRows: number;
    createdCount: number;
    failedCount: number;
    skipCount: number;
    dryRun: boolean;
    clientId?: number;
    clientName?: string;
    landingTab?: string;
  };
  results: Array<{
    rowNumber: number;
    status: string;
    jobId?: number;
    reason?: string;
    errors?: string[];
    client_ref_id?: string | null;
    date_of_appointment?: string | null;
  }>;
};

function displayStatus(s: string): 'Valid' | 'Invalid' {
  return s === 'valid' || s === 'created' ? 'Valid' : 'Invalid';
}

function formatAppointment(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function JobUploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError('Pick an .xlsx file before uploading.');
      return;
    }
    const fd = new FormData();
    fd.set('file', file);
    setLoading(true);
    try {
      // FormData payload — note: api.post stringifies plain objects, but
      // FormData passes through untouched in fetch. We use a raw fetch
      // here to avoid the wrapper trying to JSON-encode the body.
      const token = getToken();
      const res = await fetch(`/api/client/jobs/upload?dryRun=${dryRun}`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.success === false) {
        throw new ApiError(body?.error || `HTTP ${res.status}`, res.status, body?.details);
      }
      setReport(body.data as Report);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  const createdAny = report && !report.summary.dryRun && report.summary.createdCount > 0;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Bulk Job Upload</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every row in the uploaded file creates an <strong>Unconfirmed</strong> order on your account.
          EasyFix operators complete city / PIN / service type / time slot via the per-row Confirm &amp;
          Schedule action before booking.
        </p>
      </div>

      {/* Upload form */}
      <section className="card p-5 space-y-4 max-w-3xl">
        <h2 className="text-base font-semibold text-ink-900">Upload Excel</h2>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink-500 uppercase tracking-wide mb-1.5">
              .xlsx file <span className="text-primary">*</span>
            </label>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-primary-dark"
              required
            />
            <p className="text-xs text-ink-500 mt-1.5">
              Row 1 = header, data from row 2. Columns: Client Reference ID · Customer Name · Mobile ·
              Address · Date of Appointment (dd-mm-yyyy) · Product Quantity · Mode of Payment ·
              Type of Service · Job Description · Special Comments.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              className="rounded text-primary focus:ring-primary"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />
            <span>Dry Run (validation only — no orders created)</span>
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={loading} className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed">
              <Upload className="w-4 h-4" />
              {loading ? 'Processing…' : dryRun ? 'Validate' : 'Upload & Create'}
            </button>
            <button
              type="button"
              onClick={() => downloadTemplate(setError)}
              className="btn-outline"
            >
              <Download className="w-4 h-4" /> Download template
            </button>
          </div>

          {error && (
            <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </form>
      </section>

      {/* Report */}
      {report && (
        <section className="card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-ink-900">
              Report · {report.summary.dryRun ? 'Dry run' : 'Upload complete'}
            </h2>
            {createdAny && (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-semibold"
              >
                <CheckCircle2 className="w-4 h-4" /> View created orders on Order History
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Total rows" v={report.summary.totalRows} tint="bg-ink-100 text-ink-700" />
            <Stat
              label="Created / Valid"
              v={report.summary.createdCount || report.results.filter((r) => r.status === 'valid').length}
              tint="bg-success-tint text-success-text"
            />
            <Stat label="Failed" v={report.summary.failedCount} tint="bg-danger-tint text-danger-text" />
            <Stat label="Skipped" v={report.summary.skipCount} tint="bg-ink-100 text-ink-500" />
          </div>

          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row #</th>
                  <th>Client Reference ID</th>
                  <th>Date of Appointment</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((r) => {
                  const valid = r.status === 'valid' || r.status === 'created';
                  const details = valid
                    ? ''
                    : r.errors?.length
                      ? r.errors.join('; ')
                      : (r.reason || '');
                  return (
                    <tr key={r.rowNumber}>
                      <td className="font-mono text-xs">{r.rowNumber}</td>
                      <td className="text-xs">{r.client_ref_id || '—'}</td>
                      <td className="text-xs">{formatAppointment(r.date_of_appointment)}</td>
                      <td>
                        <span
                          className={cn(
                            'badge ring-1',
                            valid
                              ? 'bg-success-tint text-success-text ring-success/30'
                              : 'bg-danger-tint text-danger-text ring-danger/30'
                          )}
                        >
                          {displayStatus(r.status)}
                        </span>
                      </td>
                      <td className="text-xs">
                        {r.jobId ? (
                          <Link href={`/jobs/${r.jobId}`} className="text-primary hover:underline font-semibold">
                            job #{r.jobId}
                          </Link>
                        ) : (
                          <span>{details}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, v, tint }: { label: string; v: number | string; tint: string }) {
  return (
    <div className={cn('rounded-lg p-3', tint)}>
      <div className="text-2xl font-semibold tabular-nums">{v}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}
