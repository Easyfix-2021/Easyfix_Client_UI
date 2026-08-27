/*
 * /completed must not present HALF a window as a total.
 *
 * This page is the union of two status sweeps (3 and 5). It used to sit behind
 * a page-wide spinner, which hid the fact that every figure computed from
 * `rows` while one sweep is still in flight counts only half the window. With
 * the frame rendering first, a confident half-total would sit where the
 * spinner was — worse than a spinner, because it looks like an answer.
 *
 * The guard shipped verified by reading. This runs it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setFetches, lookup } from './helpers/page-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/lib/hooks', () => ({
  useFetch: (p: string | null) => lookup(p),
  useFetchOnce: (p: string | null) => lookup(p),
  useDebouncedValue: (v: unknown) => v,
  fetchAllJobs: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/spoc-context', () => ({
  useAccess: () => ({ grants: ['home', 'completed'], allStores: true }),
  useSpoc: () => ({ id: 1, client_id: 1 }),
  useHasGrant: () => true,
}));
vi.mock('@/components/job-drawer', () => ({ openJobDrawer: vi.fn(), JobDrawerHost: () => null }));

import Completed from '@/app/(authed)/completed/page';

const job = (id: number) => ({
  job_id: id,
  job_reference_id: `REF${id}`,
  city_name: 'Pune',
  service_category: 'Carpentry',
  checkin_date_time: '2026-08-01 09:00:00',
  checkout_date_time: '2026-08-01 17:00:00',
  ticket_created_date_time: '2026-08-01 08:00:00',
  ageDays: 1,
});

/** status=3 answers with `n` rows; status=5 is still in flight. */
function halfLoaded(n: number) {
  setFetches({
    '/jobs?status=3': { data: { items: Array.from({ length: n }, (_, i) => job(i + 1)), total: n }, loading: false },
    '/jobs?status=5': { data: null, loading: true },
    '/orders/counts': { data: { otherOrders: 0, completedOrders: 0 }, loading: false },
  });
}

beforeEach(() => setFetches({}));

describe('/completed half-window guard', () => {
  it('renders the frame while one sweep is still in flight', () => {
    halfLoaded(3);
    render(<Completed />);
    // The window chip is the control a reader reaches for when this page is
    // slow, so it must not be trapped behind the slow query.
    expect(screen.getByText('Closed work')).toBeTruthy();
  });

  it('⚠ shows EM DASHES, not a half-total, until BOTH sweeps answer', () => {
    halfLoaded(3);
    render(<Completed />);

    const tile = screen.getByText('Completed', { selector: 'div,span,p' }).closest('div')?.parentElement;
    // 3 rows have arrived; presenting "3" would state a total that is missing
    // every status-5 closure in the same window.
    expect(tile?.textContent).toContain('—');
    expect(tile?.textContent).not.toMatch(/\b3\b/);
  });

  it('shows the real total once both sweeps have answered', () => {
    setFetches({
      '/jobs?status=3': { data: { items: [job(1), job(2), job(3)], total: 3 }, loading: false },
      '/jobs?status=5': { data: { items: [job(4)], total: 1 }, loading: false },
      '/orders/counts': { data: { otherOrders: 0, completedOrders: 0 }, loading: false },
    });
    render(<Completed />);

    const tile = screen.getByText('Completed', { selector: 'div,span,p' }).closest('div')?.parentElement;
    expect(tile?.textContent).toContain('4');
    expect(tile?.textContent).not.toContain('—');
  });

  it('discloses a PARTIAL when one sweep fails, and does not error out', () => {
    setFetches({
      '/jobs?status=3': { data: { items: [job(1)], total: 1 }, loading: false },
      '/jobs?status=5': { data: null, loading: false, error: 'status 5 exploded' },
      '/orders/counts': { data: { otherOrders: 0, completedOrders: 0 }, loading: false },
    });
    const { container } = render(<Completed />);

    expect(container.textContent).toContain('could not be read');
    // Not the error page — one usable sweep still has rows worth showing.
    expect(container.textContent).not.toContain('Could not load completed jobs');
  });

  it('BOTH sweeps failing is the error page, not a partial banner', () => {
    setFetches({
      '/jobs?status=3': { data: null, loading: false, error: 'boom' },
      '/jobs?status=5': { data: null, loading: false, error: 'boom' },
      '/orders/counts': { data: { otherOrders: 0, completedOrders: 0 }, loading: false },
    });
    const { container } = render(<Completed />);

    expect(container.textContent).toContain('Could not load completed jobs');
    expect(container.textContent).not.toContain('could not be read');
  });
});
