'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch, useDebouncedValue } from '@/lib/hooks';
import { STATUS_LABELS, formatDate } from '@/lib/utils';

type Job = {
  job_id: number;
  job_reference_id: string;
  client_ref_id: string;
  job_status: number;
  customer_name: string;
  customer_mob_no: string;
  city_name: string;
  requested_date_time: string;
  scheduled_date_time: string | null;
  easyfixer_name: string | null;
};

const TABS = [
  { key: 'all',       label: 'All',         status: null },
  { key: 'open',      label: 'Open',        status: 0 },
  { key: 'scheduled', label: 'Scheduled',   status: 1 },
  { key: 'progress',  label: 'In Progress', status: 2 },
  { key: 'completed', label: 'Completed',   status: 3 },
  { key: 'cancelled', label: 'Cancelled',   status: 6 },
];

export default function JobsPage() {
  const [tab, setTab] = useState<string>('all');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);

  const fetchPath = useMemo(() => {
    const status = TABS.find((t) => t.key === tab)?.status;
    const params = new URLSearchParams();
    if (status != null) params.set('status', String(status));
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim());
    params.set('limit', '100');
    return `/jobs?${params}`;
  }, [tab, debouncedQ]);

  const { data, error, loading } = useFetch<{ items: Job[]; total: number }>(fetchPath);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <span className="text-sm text-slate-500">{total} total</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              tab === t.key ? 'bg-primary text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
        <input
          className="input ml-auto max-w-xs"
          placeholder="Search by ref / customer / mobile…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Job</th><th>Reference</th><th>Customer</th>
              <th>City</th><th>Status</th><th>Scheduled</th><th>Easyfixer</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center text-slate-500 py-6">Loading…</td></tr>}
            {!loading && items.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-500 py-6">No jobs found.</td></tr>
            )}
            {!loading && items.map((j) => (
              <tr key={j.job_id} className="hover:bg-slate-50">
                <td>
                  <Link href={`/jobs/${j.job_id}`} className="text-primary hover:underline font-medium">
                    #{j.job_id}
                  </Link>
                </td>
                <td className="font-mono text-xs">{j.job_reference_id || j.client_ref_id || '—'}</td>
                <td>{j.customer_name}</td>
                <td>{j.city_name || '—'}</td>
                <td><span className="badge bg-slate-100 text-slate-700">{STATUS_LABELS[j.job_status] || j.job_status}</span></td>
                <td className="text-xs">{formatDate(j.scheduled_date_time)}</td>
                <td>{j.easyfixer_name || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
