/*
 * Shared mocks for rendering a console page under jsdom.
 *
 * Every page here is a client component whose data comes from hooks and whose
 * navigation comes from next/navigation — so the only things a test stands in
 * for are those two boundaries. Nothing else is faked: the real components,
 * the real arithmetic and the real guards run.
 */
import { vi } from 'vitest';

/** Per-path responses for useFetch/useFetchOnce. */
export type Fetches = Record<string, { data?: unknown; loading?: boolean; error?: string | null }>;

const state: { fetches: Fetches; recentJobs: { jobs: unknown[]; loading: boolean } } = {
  fetches: {},
  recentJobs: { jobs: [], loading: false },
};

export function setFetches(f: Fetches) { state.fetches = f; }
export function setRecentJobs(jobs: unknown[], loading = false) { state.recentJobs = { jobs, loading }; }

/*
 * Matched by PREFIX, because every page builds paths with query strings —
 * `/performance?from=…` must be answerable by a fixture keyed on
 * `/performance`. Longest key wins, so a specific fixture can override.
 */
export function lookup(path: string | null) {
  if (!path) return { data: null, loading: false, error: null, reload: vi.fn() };
  const key = Object.keys(state.fetches)
    .filter((k) => path.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  const hit = key ? state.fetches[key] : undefined;
  return {
    data: hit?.data ?? null,
    loading: hit?.loading ?? false,
    error: hit?.error ?? null,
    reload: vi.fn(),
  };
}

export const recentJobs = () => ({ ...state.recentJobs, error: null, reload: vi.fn() });
