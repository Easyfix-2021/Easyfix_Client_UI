/*
 * Deep link: /jobs?jobId=<id> — the "Send Request to Client" email link
 * (EasyFix_Backend material-approval flow) points here and expects the
 * job's drawer to open on arrival.
 *
 * Three things a symptom-shaped fix gets wrong, each verified here:
 *   1. It must open the drawer for a valid id — and only ONCE, even across
 *      re-renders (an effect with `[searchParams]` instead of `[]` would
 *      reopen it on every unrelated filter click).
 *   2. It must strip jobId from the URL via router.replace, or a refresh /
 *      Back reopens the drawer.
 *   3. A non-numeric id must be ignored outright — never handed to the
 *      drawer, which has no not-found state for "NaN".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { setFetches, lookup } from './helpers/page-harness';

const push = vi.fn();
const replace = vi.fn();
const openJobDrawer = vi.fn();
/** Mutable, stable-reference nav state — see helpers/page-harness's `state`
 *  object for why this dodges vi.mock hoisting/TDZ concerns. */
const nav = { search: '' };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => '/jobs',
}));
vi.mock('@/lib/hooks', () => ({
  useFetch: (p: string | null) => lookup(p),
  useFetchOnce: (p: string | null) => lookup(p),
  useDebouncedValue: (v: unknown) => v,
  fetchAllJobs: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/components/job-drawer', () => ({
  openJobDrawer: (...a: unknown[]) => openJobDrawer(...a),
}));
vi.mock('@/lib/open-book', () => ({
  OPEN_STATUSES: [9, 0, 1, 2, 20, 15, 21, 10, 16],
  PER_STATUS_CAP: 1000,
  useOpenBook: () => ({
    jobs: [], loading: false, error: null, truncated: false, partial: [], reload: vi.fn(),
  }),
}));

import OpenJobsPage from '@/app/(authed)/jobs/page';

beforeEach(() => {
  setFetches({});
  push.mockClear();
  replace.mockClear();
  openJobDrawer.mockClear();
  nav.search = '';
});

describe('jobs page ?jobId= deep link', () => {
  it('opens the drawer once for a valid id, then strips jobId from the URL', () => {
    nav.search = 'jobId=482';
    const { rerender } = render(<OpenJobsPage />);

    expect(openJobDrawer).toHaveBeenCalledTimes(1);
    expect(openJobDrawer).toHaveBeenCalledWith(482);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/jobs', { scroll: false });

    // A later re-render (e.g. an unrelated filter click) must not reopen it —
    // the effect runs once per mount, not once per searchParams read.
    rerender(<OpenJobsPage />);
    expect(openJobDrawer).toHaveBeenCalledTimes(1);
  });

  it('preserves other query params when stripping jobId', () => {
    nav.search = 'city=Pune&jobId=17';
    render(<OpenJobsPage />);

    expect(openJobDrawer).toHaveBeenCalledWith(17);
    expect(replace).toHaveBeenCalledWith('/jobs?city=Pune', { scroll: false });
  });

  it('ignores a non-numeric jobId — no drawer opens', () => {
    nav.search = 'jobId=not-a-number';
    render(<OpenJobsPage />);

    expect(openJobDrawer).not.toHaveBeenCalled();
  });

  it('does nothing when there is no jobId at all', () => {
    nav.search = 'city=Pune';
    render(<OpenJobsPage />);

    expect(openJobDrawer).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
