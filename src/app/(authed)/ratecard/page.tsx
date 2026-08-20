'use client';

/*
 * Rate Card — contracted service rates for the SPOC's client.
 *
 * Migrated from legacy ACD_APIs
 *   (legacy RatecardServiceService.getRateCardData called /clients/{id}
 *    which was a bug — it returned client info, not rate-card lines).
 * (Angular RateCardComponent — ratecard.component.ts + .html).
 *
 * Backend: GET /api/client/ratecard returns one row per active
 *          client_service. Columns: Service Category, Service Type,
 *          Rate Card Name, Total Amount.
 *
 * UX additions over legacy (which was just a flat table):
 *   - Search input filters across all four text fields
 *   - Grouped by category — collapsible sections with per-group sub-totals
 *   - Rate-amount badges (₹) for quick scanning
 */
import { useMemo, useState } from 'react';
import {
  ReceiptText, Search, ChevronRight, IndianRupee, Tag,
} from 'lucide-react';
import { useFetchOnce } from '@/lib/hooks';
import { cn } from '@/lib/utils';

type RateCardRow = {
  client_service_id: number;
  service_category_name: string | null;
  service_type_name: string | null;
  rate_card_name: string | null;
  total_amount: number | null;
  charge_type: number | boolean | null;
};

// INR formatter — no decimals (legacy showed bare integers).
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export default function RateCardPage() {
  const [q, setQ] = useState('');

  const { data, loading, error } = useFetchOnce<{ items: RateCardRow[] }>('/ratecard');
  const items = data?.items ?? [];

  // Search across the 4 user-visible string fields. Numbers searched
  // too (so "1500" matches total_amount = 1500).
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((r) =>
      (r.service_category_name || '').toLowerCase().includes(needle) ||
      (r.service_type_name     || '').toLowerCase().includes(needle) ||
      (r.rate_card_name        || '').toLowerCase().includes(needle) ||
      String(r.total_amount ?? '').includes(needle)
    );
  }, [items, q]);

  // For grouped view — { categoryName → rows[] }
  const grouped = useMemo(() => {
    const map = new Map<string, RateCardRow[]>();
    for (const r of filtered) {
      const key = r.service_category_name || 'Other';
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    // Sort category groups alphabetically; rows already sorted by API.
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  // Track collapsed groups (default all expanded)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const totalRowCount = filtered.length;

  return (
    <div className="space-y-5">
      {/* Title + summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900 inline-flex items-center gap-2">
            <ReceiptText className="w-6 h-6 text-primary" /> Rate Card
          </h1>
          <p className="text-sm text-ink-500">
            Your contracted service rates across categories and skill levels.
          </p>
        </div>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-3">
          <div className="text-xs text-ink-500 uppercase tracking-wide">Total Services</div>
          <div className="text-2xl font-semibold text-ink-900 mt-1">{totalRowCount}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-500 uppercase tracking-wide">Categories</div>
          <div className="text-2xl font-semibold text-ink-900 mt-1">{grouped.length}</div>
        </div>
      </div>

      {/* Search */}
      <div className="card p-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
          <input
            className="input pl-9"
            placeholder="Search by category, type, rate card name or amount…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="rounded border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {error}
        </div>
      )}

      {/* GROUPED — collapsible categories with per-group totals */}
      <div className="space-y-3">
          {loading && (
            <div className="card text-center text-ink-500 py-8">Loading…</div>
          )}
          {!loading && grouped.length === 0 && (
            <div className="card text-center text-ink-500 py-8">
              {q ? 'No matches for your search.' : 'No rate card configured for your account.'}
            </div>
          )}
          {!loading && grouped.map(([category, rows]) => {
            const isOpen = !collapsed.has(category);
            const groupTotal = rows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
            return (
              <div key={category} className="card overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleGroup(category)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-primary-50/40 hover:bg-primary-50 transition"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <ChevronRight className={cn('w-4 h-4 text-ink-500 transition shrink-0', isOpen && 'rotate-90')} />
                    <Tag className="w-4 h-4 text-primary shrink-0" />
                    <span className="font-semibold text-ink-900 truncate">{category}</span>
                    <span className="inline-flex items-center justify-center px-2 h-5 rounded-full bg-surface text-xs font-semibold text-ink-500 ring-1 ring-ink-100">
                      {rows.length}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-0.5 font-semibold text-money shrink-0">
                    <IndianRupee className="w-3.5 h-3.5" />
                    {inr.format(groupTotal)}
                  </span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto border-t border-ink-100">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="w-12">#</th>
                          <th>Service Type</th>
                          <th>Rate Card Name</th>
                          <th className="text-right">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.client_service_id} className="hover:bg-primary-50/30">
                            <td className="text-xs text-ink-500">{i + 1}</td>
                            <td className="text-sm">{r.service_type_name || '—'}</td>
                            <td className="text-sm text-ink-500">{r.rate_card_name || '—'}</td>
                            <td className="text-right">
                              <span className="inline-flex items-center gap-0.5 font-semibold text-money">
                                <IndianRupee className="w-3.5 h-3.5" />
                                {r.total_amount != null ? inr.format(r.total_amount) : '—'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
