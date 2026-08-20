'use client';

import { useState } from 'react';
import { ApiError, downloadBlob } from '@/lib/api';
import { FileSpreadsheet } from 'lucide-react';

export default function ExportPage() {
  const [status, setStatus] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (from) params.set('startDate', from);
      if (to) params.set('endDate', to);
      const ts = new Date().toISOString().slice(0, 10);
      await downloadBlob(`/export/jobs?${params}`, `easyfix-jobs-${ts}.xlsx`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Export failed');
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-2xl font-semibold flex items-center gap-2"><FileSpreadsheet /> Export Jobs</h1>
      <p className="text-sm text-ink-500">
        Download a spreadsheet of your jobs filtered by status and date range. Excel format (.xlsx).
      </p>

      <div className="card p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">— Any —</option>
            <option value="0">Unconfirmed</option>
            <option value="1">Scheduled</option>
            <option value="2">In Progress</option>
            <option value="3">Completed</option>
            <option value="6">Cancelled</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">From (created)</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">To (created)</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {error && <div className="text-sm text-danger">{error}</div>}
        <button onClick={go} disabled={busy} className="btn-primary">
          {busy ? 'Generating…' : 'Download Excel'}
        </button>
      </div>
    </div>
  );
}
