'use client';

/*
 * Invoices — client-level billing view (the CEO's "invoice management
 * section"). Shows a billed / collected / outstanding summary, an aging
 * split of the outstanding balance, and the full invoice list with
 * payment status and a PDF download when one is on file.
 *
 * Backend: GET /api/client/invoices → { summary, aging, items }.
 * Read-only for now — "pay from dashboard" is a later (Phase 3) build.
 */
import { useMemo, useState } from 'react';
import { useFetchOnce } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import {
  FileText, Search, Download, IndianRupee, AlertTriangle, Loader2,
} from 'lucide-react';

type Invoice = {
  id: number;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number;
  paid: number;
  due: number;
  status: 'paid' | 'partial' | 'unpaid';
  pdfPath: string | null;
};
type InvoicesData = {
  summary: { billed: number; collected: number; outstanding: number; count: number };
  aging: { a0_30: number; a31_60: number; a60plus: number; unpaid: number };
  items: Invoice[];
};

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupees = (n: number) => `₹${inr.format(Math.round(n || 0))}`;
// Compact lakh/crore for the big summary numbers.
function rupeesShort(n: number) {
  const v = Math.abs(n || 0);
  if (v >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return rupees(n);
}
function fmtDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${pad(dt.getDate())}-${pad(dt.getMonth() + 1)}-${dt.getFullYear()}`;
}
const FILE_BASE = (process.env.NEXT_PUBLIC_FILE_BASE_URL || '/easydoc').replace(/\/+$/, '');
const pdfUrl = (p: string) => (/^https?:\/\//.test(p) ? p : `${FILE_BASE}/${p.replace(/^\/+/, '')}`);

const STATUS = {
  paid:    { label: 'Paid',    cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  partial: { label: 'Partial', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  unpaid:  { label: 'Unpaid',  cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
} as const;

export default function InvoicesPage() {
  const { data, loading, error } = useFetchOnce<InvoicesData>('/invoices');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all');

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (!needle) return true;
      return (
        (r.invoiceNumber || '').toLowerCase().includes(needle) ||
        String(r.id).includes(needle) ||
        String(r.total).includes(needle)
      );
    });
  }, [items, q, filter]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-10 text-center">
        <Loader2 className="w-7 h-7 mx-auto animate-spin text-slate-400" />
        <div className="mt-2 text-sm text-slate-500">Loading your invoices…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-sm text-rose-900">
        {error || 'Could not load invoices.'}
      </div>
    );
  }

  const { summary, aging } = data;
  const agingRows = [
    { label: '0–30 days',  value: aging.a0_30,   color: '#10b981' },
    { label: '31–60 days', value: aging.a31_60,  color: '#f59e0b' },
    { label: '60+ days',   value: aging.a60plus, color: '#e11d48' },
  ];
  const agingMax = Math.max(1, ...agingRows.map((r) => r.value));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 inline-flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary" /> Invoices
        </h1>
        <p className="text-sm text-slate-500">Your billing, payments, and outstanding balance.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard label="Total Billed" value={rupeesShort(summary.billed)} sub={`${summary.count} invoices`} />
        <SummaryCard label="Collected" value={rupeesShort(summary.collected)} tone="emerald" />
        <SummaryCard label="Outstanding" value={rupeesShort(summary.outstanding)} tone="rose" sub={`${aging.unpaid} unpaid`} />
      </div>

      {/* Aging */}
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Outstanding by aging
          </h2>
          <span className="text-xs font-semibold text-slate-400">{rupeesShort(summary.outstanding)} due</span>
        </div>
        {summary.outstanding <= 0 ? (
          <div className="text-center text-sm text-slate-400 py-8">All invoices are settled. 🎉</div>
        ) : (
          <ul className="mt-4 space-y-3">
            {agingRows.map((r) => (
              <li key={r.label} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-slate-600">{r.label}</span>
                <span className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <span className="block h-full rounded-full" style={{ width: `${(r.value / agingMax) * 100}%`, backgroundColor: r.color }} />
                </span>
                <span className="w-28 text-right font-bold text-slate-900 tabular-nums">{rupees(r.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Search invoice no / amount…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="inline-flex bg-slate-100 border border-slate-200 rounded-lg p-1">
          {(['all', 'unpaid', 'partial', 'paid'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-bold capitalize transition',
                filter === f ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-500 bg-slate-50">
                <th className="text-left font-semibold px-4 py-2.5">Invoice</th>
                <th className="text-left font-semibold px-4 py-2.5">Invoice date</th>
                <th className="text-left font-semibold px-4 py-2.5">Due date</th>
                <th className="text-right font-semibold px-4 py-2.5">Amount</th>
                <th className="text-right font-semibold px-4 py-2.5">Paid</th>
                <th className="text-right font-semibold px-4 py-2.5">Due</th>
                <th className="text-center font-semibold px-4 py-2.5">Status</th>
                <th className="text-center font-semibold px-4 py-2.5">PDF</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center text-slate-400 py-8">No invoices found.</td></tr>
              )}
              {filtered.map((r) => {
                const st = STATUS[r.status];
                return (
                  <tr key={r.id} className="hover:bg-slate-50 border-t border-slate-100">
                    <td className="px-4 py-3 font-semibold text-slate-800">{r.invoiceNumber || `#${r.id}`}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(r.invoiceDate)}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtDate(r.dueDate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{rupees(r.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{rupees(r.paid)}</td>
                    <td className={cn('px-4 py-3 text-right tabular-nums font-bold', r.due > 0 ? 'text-rose-600' : 'text-slate-400')}>{rupees(r.due)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ring-1', st.cls)}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.pdfPath ? (
                        <a href={pdfUrl(r.pdfPath)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-primary hover:bg-primary-50" title="Download PDF">
                          <Download className="w-4 h-4" />
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400 inline-flex items-center gap-1.5">
        <IndianRupee className="w-3.5 h-3.5" />
        Online payment from the dashboard is coming soon.
      </p>
    </div>
  );
}

function SummaryCard({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string; tone?: 'emerald' | 'rose';
}) {
  const valColor = tone === 'emerald' ? 'text-emerald-700' : tone === 'rose' ? 'text-rose-600' : 'text-slate-900';
  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-4">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={cn('text-2xl font-bold mt-1.5', valColor)}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}
