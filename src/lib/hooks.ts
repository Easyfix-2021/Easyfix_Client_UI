'use client';

/*
 * Reusable data-fetching hooks. ALWAYS use these instead of raw
 * `useEffect(() => { api.get(...) }, [])` patterns:
 *
 *  - useFetchOnce<T>(path)        bootstrap loads keyed by path; ref-guarded
 *                                 against React 18 Strict Mode double-mount
 *  - useFetch<T>(path)            reactive loads with AbortController abort
 *                                 on dep change / unmount; pair with
 *                                 useDebouncedValue for typed search inputs
 *  - useDebouncedValue<T>(v, ms)  debounce a state value before feeding it
 *                                 into a fetch URL
 *
 * Passing `path = null` to either fetch hook skips the request entirely
 * (use this when a required upstream value isn't ready yet).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

type FetchState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
};

/**
 * One-shot fetch keyed by `path`. Fires exactly once per distinct path
 * even under Strict Mode's dev double-mount. Re-fires when `path`
 * actually changes (e.g. /jobs/123 → /jobs/124).
 *
 * Use for: profile page, job detail, anything keyed off a route param
 * or a stable URL.
 */
export function useFetchOnce<T>(
  path: string | null
): FetchState<T> & { reload: () => Promise<void> } {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    error: null,
    loading: path != null,
  });
  const lastPathRef = useRef<string | null>(null);

  const doFetch = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get<T>(path);
      setState({ data, error: null, loading: false });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Request failed';
      setState({ data: null, error: msg, loading: false });
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    if (lastPathRef.current === path) return; // already fetched THIS path
    lastPathRef.current = path;
    void doFetch();
  }, [doFetch, path]);

  return { ...state, reload: doFetch };
}

/**
 * Reactive fetch. Re-runs whenever `path` changes. Aborts the in-flight
 * request when path changes or the component unmounts, preventing
 * stale-response races and saving network on rapid input.
 *
 * Use for: filtered/searchable lists. Pair the search-input state with
 * `useDebouncedValue` so URL changes are throttled.
 */
export function useFetch<T>(path: string | null): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    error: null,
    loading: path != null,
  });

  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get<T>(path, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ data, error: null, loading: false });
      })
      .catch((err) => {
        // Aborted requests intentionally do not update state.
        if (controller.signal.aborted) return;
        if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') return;
        const msg = err instanceof ApiError ? err.message : 'Request failed';
        setState({ data: null, error: msg, loading: false });
      });
    return () => controller.abort();
  }, [path]);

  return state;
}

/**
 * Debounce a value. Returns the latest `value` after `delay` ms of
 * stillness. Typical use:
 *
 *   const [q, setQ] = useState('');
 *   const debouncedQ = useDebouncedValue(q, 300);
 *   const { data } = useFetch<...>(`/jobs?q=${encodeURIComponent(debouncedQ)}`);
 *
 * The user sees the input update immediately (q), but the fetch only
 * fires after they pause typing.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ─── Recent-orders window (for client-side analytics) ─────────────────
 *
 * Ported from the mobile client app (Easyfix_Client_App → src/lib/hooks.ts).
 * The dashboard's Orders-trend / Performance-by-city cards aggregate the last
 * 7–30 days CLIENT-SIDE (see src/lib/analytics.ts), exactly like the app, so
 * we load a recent window of orders once and slice it in the browser.
 */

type Paged<T> = { items: T[]; total?: number };

/** Parallel pager over GET /jobs — fetches up to `cap` rows for `query`. */
export async function fetchAllJobs<T>(query = '', cap = 4000): Promise<T[]> {
  const PAGE = 500;
  const q = query ? `${query}&` : '';
  const first = await api.get<Paged<T>>(`/jobs?${q}limit=${PAGE}&offset=0`);
  const head = first.items || [];
  const total = Math.min(first.total ?? head.length, cap);
  if (head.length >= total || head.length < PAGE) return head.slice(0, cap);

  const offsets: number[] = [];
  for (let off = PAGE; off < total; off += PAGE) offsets.push(off);
  const rest = await Promise.all(
    offsets.map((off) =>
      api.get<Paged<T>>(`/jobs?${q}limit=${PAGE}&offset=${off}`).then((r) => r.items || []).catch(() => [] as T[])),
  );
  return [head, ...rest].flat().slice(0, cap);
}

/**
 * Recent orders for the dashboard analytics cards. `windowDays` limits the
 * fetch to a server-side ticket-created date window so we don't download the
 * client's ENTIRE history on every open — the charts only aggregate the last
 * 7–30 days.
 */
export function useRecentJobs<T>(cap = 4000, windowDays = 60) {
  const [jobs, setJobs] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      let q = '';
      if (windowDays > 0) {
        const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const lo = new Date(Date.now() - windowDays * 86400000);
        q = `dateType=ticket&startDate=${ymd(lo)}&endDate=${encodeURIComponent(`${ymd(new Date())} 23:59:59`)}`;
      }
      setJobs(await fetchAllJobs<T>(q, cap));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load orders');
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [cap, windowDays]);

  useEffect(() => { void load(); }, [load]);
  return { jobs, loading, error, reload: load };
}
