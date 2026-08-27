/*
 * Home renders its frame before its data, and shows NO placeholder zeroes.
 *
 * The page used to return one spinner for the whole screen until
 * /dashboard-summary answered, so the slowest of five independent requests
 * decided when anything appeared. Removing that gate is only safe if the
 * figures it used to hide never render as confident zeroes — "0 open jobs" is
 * a claim, and a zero shown before the data arrives is a wrong answer rather
 * than a missing one.
 *
 * That guard shipped verified by reading. This runs it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setFetches, setRecentJobs, lookup, recentJobs } from './helpers/page-harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/lib/hooks', () => ({
  useFetch: (p: string | null) => lookup(p),
  useFetchOnce: (p: string | null) => lookup(p),
  useRecentJobs: () => recentJobs(),
  useDebouncedValue: (v: unknown) => v,
  fetchAllJobs: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/spoc-context', () => ({
  useAccess: () => ({ grants: ['home', 'performance'], allStores: true }),
  useSpoc: () => ({ id: 1, client_id: 1 }),
  useHasGrant: () => true,
}));
vi.mock('@/components/job-drawer', () => ({ openJobDrawer: vi.fn(), JobDrawerHost: () => null }));

import Home from '@/app/(authed)/dashboard/page';

const SUMMARY = {
  boxes: { newTickets: 4, waitingForAllocation: 3, runningLate: 1, estimateApproved: 0, estimateRejected: 0 },
  slaAging: { d01: 1, d23: 2, d47: 0, d7plus: 5 },
  attention: { invoicesDue: { count: 1, amount: 10 }, estimatePending: 2, noResponse: 1, onHold: 0, revisit: 0, qcDone: 0, repeatedlyUnreachable: 4 },
  counts: { newTickets: 4, inProgress: 7, completed: 20, cancelled: 1, escalated: 0, openTotal: 12, awaitingYou: 2 },
  teamSize: 3,
};

beforeEach(() => { setFetches({}); setRecentJobs([], false); });

describe('Home progressive render', () => {
  it('renders the frame immediately — no page-wide spinner blocks it', () => {
    setFetches({ '/dashboard-summary': { data: null, loading: true } });
    render(<Home />);

    // The chrome is up while the summary is still in flight — section labels,
    // tiles and the action-queue frame, none of which need data to exist.
    expect(screen.getByText('Total open')).toBeTruthy();
    expect(screen.getByText('Your action queue')).toBeTruthy();
    expect(screen.getByText('Open breakdown')).toBeTruthy();
  });

  it('⚠ shows an EM DASH, never a zero, while the data is loading', () => {
    // BOTH sources pending. With the 60-day window already loaded and empty,
    // "0 due today" would be honest — this test is about the case where
    // nothing has answered yet, which is when a zero would be a claim.
    setFetches({ '/dashboard-summary': { data: null, loading: true } });
    setRecentJobs([], true);
    const { container } = render(<Home />);

    const openTile = screen.getByText('Total open').closest('div')?.parentElement;
    expect(openTile?.textContent).toContain('—');
    // The placeholder summary is all zeroes so the layout can compute; none of
    // it may reach the screen as a figure.
    expect(openTile?.textContent).not.toMatch(/\b0\b/);
    expect(container.textContent).toContain('Loading your book');
  });

  it('shows the real figures once the summary lands', () => {
    setFetches({ '/dashboard-summary': { data: SUMMARY, loading: false } });
    render(<Home />);

    // newTickets 4 + inProgress 7
    const openTile = screen.getByText('Total open').closest('div')?.parentElement;
    expect(openTile?.textContent).toContain('11');
    expect(openTile?.textContent).not.toContain('—');
  });

  it('the job-window tiles dash independently of the summary', () => {
    // Summary in, 60-day window still loading: each section waits on its OWN
    // request, which is the whole point of removing the page-wide gate.
    setFetches({ '/dashboard-summary': { data: SUMMARY, loading: false } });
    setRecentJobs([], true);
    render(<Home />);

    const closed = screen.getByText('Closed yesterday').closest('div')?.parentElement;
    expect(closed?.textContent).toContain('—');
    const openTile = screen.getByText('Total open').closest('div')?.parentElement;
    expect(openTile?.textContent).toContain('11');
  });
});

describe('Home tolerates a backend that predates a field', () => {
  it('⚠ renders a dash, not a crash, when the summary omits a new field', () => {
    /*
     * Exactly what a frontend deployed AHEAD of its backend sees. Before the
     * null guard this threw inside render and took the entire dashboard down,
     * which is a far worse failure than one missing figure.
     */
    const older = { ...SUMMARY, attention: { ...SUMMARY.attention } } as Record<string, unknown>;
    delete (older.attention as Record<string, unknown>).repeatedlyUnreachable;
    setFetches({ '/dashboard-summary': { data: older, loading: false } });

    const { container } = render(<Home />);
    expect(container.textContent).toContain('Customer unreachable');
    const tile = screen.getByText('Customer unreachable').closest('div')?.parentElement;
    expect(tile?.textContent).toContain('—');
  });
});
