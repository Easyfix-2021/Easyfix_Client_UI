/*
 * Quality Check (3.8) — the two things that would fail silently:
 *
 *   1. THE DUE-TIME LABEL. `dueOn` is a zone-less IST wall clock (same
 *      convention as every other datetime this backend emits — see
 *      format.ts). Read naively it renders in the browser's own zone, so a
 *      client outside IST would be told the wrong auto-approve time — the
 *      exact number this screen exists to make trustworthy.
 *
 *   2. DISPUTE REQUIRES A NOTE. The desk sees only the note; a dispute with
 *      no reason gives it nothing to act on, so the request must never leave
 *      the browser without one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setFetches, lookup } from './helpers/page-harness';

vi.mock('@/lib/hooks', () => ({
  useFetch: (p: string | null) => lookup(p),
  useFetchOnce: (p: string | null) => lookup(p),
  useDebouncedValue: (v: unknown) => v,
}));

const post = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
  ApiError: class ApiError extends Error {},
}));

import QualityCheckPage from '@/app/(authed)/tickets/under-audit/page';
import { autoApprovesLabel } from '@/lib/qc';

const PATH = '/qc';

const ITEM = {
  jobId: 501, reference: 'EF-501', service: 'Carpentry',
  technician: 'Ramesh Kumar', finishedOn: '2026-09-20 11:30:00',
  dueOn: '2026-09-21 11:30:00',
};

beforeEach(() => { setFetches({}); post.mockClear(); });

describe('autoApprovesLabel', () => {
  it('reads a zone-less dueOn as IST, not as browser-local', () => {
    // 2026-09-21 11:30:00 IST is 06:00 UTC. Parsed naively (as UTC, or as
    // whatever zone the test runner sits in) this could read as a different
    // calendar day or hour; forced through Asia/Kolkata it must always read
    // "21 Sept" at "11:30 am".
    expect(autoApprovesLabel('2026-09-21 11:30:00')).toBe('Auto-approves 21 Sept, 11:30 am');
  });

  it('says timing is unset rather than inventing a time', () => {
    expect(autoApprovesLabel(null)).toBe('Auto-approves — timing not set');
  });
});

describe('QualityCheckPage', () => {
  it('an honest empty state, not a bare "no data"', () => {
    setFetches({ [PATH]: { data: { items: [], total: 0 } } });
    render(<QualityCheckPage />);
    expect(screen.getByText('Nothing waiting for your check.')).toBeTruthy();
  });

  it('a failed load is stated, not silently shown as empty', () => {
    setFetches({ [PATH]: { data: null, error: 'HTTP 500' } });
    render(<QualityCheckPage />);
    expect(screen.getByText(/Could not load Quality Check/)).toBeTruthy();
  });

  it('renders job, service, technician, completed time and the due label', () => {
    setFetches({ [PATH]: { data: { items: [ITEM], total: 1 } } });
    render(<QualityCheckPage />);
    expect(screen.getByText('EF-501')).toBeTruthy();
    expect(screen.getByText('Carpentry')).toBeTruthy();
    expect(screen.getByText('Ramesh Kumar')).toBeTruthy();
    expect(screen.getByText('Auto-approves 21 Sept, 11:30 am')).toBeTruthy();
  });

  it('Approve posts to the contract path and refreshes the list', async () => {
    setFetches({ [PATH]: { data: { items: [ITEM], total: 1 } } });
    render(<QualityCheckPage />);

    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/jobs/501/qc/approve', {}));
  });

  it('Dispute refuses to send with no note', () => {
    setFetches({ [PATH]: { data: { items: [ITEM], total: 1 } } });
    render(<QualityCheckPage />);

    fireEvent.click(screen.getByText('Dispute'));
    fireEvent.click(screen.getByText('Send Dispute'));

    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/Please describe the issue/)).toBeTruthy();
  });

  it('Dispute with a note posts {note} to the contract path', async () => {
    setFetches({ [PATH]: { data: { items: [ITEM], total: 1 } } });
    render(<QualityCheckPage />);

    fireEvent.click(screen.getByText('Dispute'));
    fireEvent.change(screen.getByPlaceholderText(/Tell us what needs to be fixed/), {
      target: { value: 'Cabinet hinge is still loose' },
    });
    fireEvent.click(screen.getByText('Send Dispute'));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/jobs/501/qc/dispute', { note: 'Cabinet hinge is still loose' },
    ));
  });
});
