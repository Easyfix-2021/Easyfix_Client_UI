'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { useFetch, useDebouncedValue } from '@/lib/hooks';
import { STATUS_LABELS } from '@/lib/utils';
import { openJobDrawer } from '@/components/job-drawer';

/*
 * Universal job search for the client portal's top bar.
 *
 * ALMOST NOTHING HERE IS NEW, AND THAT IS THE POINT.
 *
 *   the query   GET /jobs?q= already IS a universal job search — the backend
 *               resolves a digits-only term as a job-id / reference lookup and
 *               anything else as a multi-column LIKE.
 *   the scope   that endpoint is already pinned to the caller's client AND
 *               their reporting hierarchy by clientJobFilters(). A bespoke
 *               "search everything" route would have to re-implement both
 *               layers, and a search box is the last place to hand-roll
 *               tenancy: one forgotten clause and a client sees another
 *               client's customers.
 *   the result  openJobDrawer(id) opens the existing global job drawer, whose
 *               host is already mounted in this layout. So the fetch, the ESC
 *               handling and the scroll lock come free, and the drawer stays
 *               the single definition of "job details".
 *
 * What is actually written below is an input, a popover and keyboard handling.
 */

type Hit = {
  job_id: number;
  client_ref_id: string | null;
  customer_name: string | null;
  city_name: string | null;
  service_category: string | null;
  job_status: number;
};
type Resp = { items: Hit[]; total: number };

// Two characters. A single character matches most of the book, so it costs a
// round trip to render a list nobody can use.
const MIN_TERM = 2;
const MAX_HITS = 8;

export function JobSearch() {
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term.trim(), 300);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  /*
   * `null` while the term is too short, which SUPPRESSES the request rather
   * than sending one that cannot be useful — useFetch treats a null path as
   * "not asked yet". It also aborts the previous keystroke's request, so there
   * is no response-ordering race to write by hand.
   */
  const q = debounced.length >= MIN_TERM ? debounced : null;
  const { data, loading } = useFetch<Resp>(
    q ? `/jobs?q=${encodeURIComponent(q)}&limit=${MAX_HITS}` : null,
  );
  const hits = data?.items ?? [];

  // Reset the highlight whenever the result set changes, so Enter never opens
  // a job that has scrolled out of the list underneath the cursor.
  useEffect(() => { setActive(0); }, [data]);

  // Close on a click elsewhere. Pointerdown rather than click so it fires
  // before the input's blur reorders things.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  function choose(hit: Hit) {
    openJobDrawer(hit.job_id);
    setOpen(false);
    setTerm('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!hits.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + hits.length) % hits.length); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(hits[active]); }
  }

  const showPanel = open && debounced.length >= MIN_TERM;

  return (
    <div ref={box} className="relative hidden md:block">
      <label className="relative inline-flex items-center">
        <Search className="absolute left-3 w-3.5 h-3.5 text-ink-300 pointer-events-none" aria-hidden />
        <span className="sr-only">Search any job by id, reference, customer or mobile</span>
        <input
          value={term}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search any job…"
          // Combobox semantics so a screen reader announces that typing
          // produces a list, and which row is current.
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="job-search-results"
          aria-autocomplete="list"
          className="w-48 lg:w-64 rounded-full border border-ink-100 bg-surface pl-8 pr-8 py-1.5 text-xs text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        {loading && (
          <Loader2 className="absolute right-3 w-3.5 h-3.5 text-ink-300 animate-spin" aria-hidden />
        )}
      </label>

      {showPanel && (
        <ul
          id="job-search-results"
          role="listbox"
          className="absolute right-0 z-50 mt-1 w-80 max-h-96 overflow-y-auto rounded-lg border border-ink-100 bg-surface shadow-lg py-1"
        >
          {!data && loading && (
            <li className="px-3 py-2 text-xs text-ink-500">Searching…</li>
          )}
          {data && !hits.length && (
            <li className="px-3 py-2 text-xs text-ink-500">
              No job matches “{debounced}”.
            </li>
          )}
          {hits.map((h, i) => (
            <li key={h.job_id} role="option" aria-selected={i === active}>
              {/* onMouseDown, not onClick: the input's blur fires first and
                  would tear the list down before a click could land. */}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(h); }}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-3 py-2 ${i === active ? 'bg-primary-50' : ''}`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-ink-900">#{h.job_id}</span>
                  {h.client_ref_id && (
                    <span className="text-xs text-ink-500 truncate">{h.client_ref_id}</span>
                  )}
                  <span className="ml-auto text-xs text-ink-500 shrink-0">
                    {STATUS_LABELS[h.job_status] || `Status ${h.job_status}`}
                  </span>
                </span>
                <span className="block text-xs text-ink-500 truncate">
                  {[h.customer_name, h.service_category, h.city_name].filter(Boolean).join(' · ') || '—'}
                </span>
              </button>
            </li>
          ))}
          {data && data.total > hits.length && (
            /* Say what was cut. A silently truncated list reads as "that is
               everything", and the operator stops refining a term that would
               have found their job. */
            <li className="px-3 py-1.5 text-xs text-ink-500 border-t border-ink-100">
              Showing {hits.length} of {data.total} — keep typing to narrow.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
