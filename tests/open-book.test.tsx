/*
 * useOpenBook — the partial-failure behaviour, executed rather than read.
 *
 * /jobs loads its open book from SEVEN parallel status sweeps. It used to
 * await Promise.all, so one failure rejected the lot and the page showed an
 * error. Streaming them means the sweeps that succeed now render — and the
 * failure mode inverts: the screen looks perfectly healthy while the list and
 * every age-band count below it are SHORT.
 *
 * That is the state this file exists for. It is unreachable from a happy path
 * and it is what a reader relies on to know their numbers are incomplete.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchAllJobs = vi.fn();
vi.mock('@/lib/hooks', () => ({ fetchAllJobs: (...a: unknown[]) => fetchAllJobs(...a) }));

import { useOpenBook, OPEN_STATUSES, PER_STATUS_CAP } from '@/lib/open-book';

type Row = { job_id: number };
const rowsFor = (status: number, n = 2): Row[] =>
  Array.from({ length: n }, (_, i) => ({ job_id: status * 100 + i }));

/** Resolve every sweep, except the statuses named — those reject. */
function sweeps({ failing = [] as number[], rows = 2 } = {}) {
  fetchAllJobs.mockImplementation((qs: string) => {
    const status = Number(/status=(\d+)/.exec(qs)?.[1]);
    return failing.includes(status)
      ? Promise.reject(new Error(`status ${status} exploded`))
      : Promise.resolve(rowsFor(status, rows));
  });
}

beforeEach(() => fetchAllJobs.mockReset());

describe('useOpenBook', () => {
  it('loads every status when all sweeps succeed, and reports no partial', async () => {
    sweeps();
    const { result } = renderHook(() => useOpenBook<Row>(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.jobs).toHaveLength(OPEN_STATUSES.length * 2);
    expect(result.current.partial).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('⚠ SURFACES A PARTIAL when some sweeps fail, and still shows the rest', async () => {
    sweeps({ failing: [1, 20] });
    const { result } = renderHook(() => useOpenBook<Row>(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The banner's condition. Without this the page renders five statuses out
    // of eight and looks entirely healthy.
    expect(result.current.partial.sort()).toEqual([1, 20]);
    // NOT an error — an error would replace a screen that has usable rows on it.
    expect(result.current.error).toBeNull();
    // And the five that worked are on screen.
    expect(result.current.jobs).toHaveLength((OPEN_STATUSES.length - 2) * 2);
  });

  it('one failure out of eight is enough to disclose', async () => {
    sweeps({ failing: [21] });
    const { result } = renderHook(() => useOpenBook<Row>(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.partial).toEqual([21]);
  });

  it('ALL sweeps failing is an error, not a partial, and clears the rows', async () => {
    sweeps({ failing: [...OPEN_STATUSES] });
    const { result } = renderHook(() => useOpenBook<Row>(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    // Not both: the error gate returns before the banner, so a partial set here
    // would be invisible state that only render order keeps harmless.
    expect(result.current.partial).toEqual([]);
    expect(result.current.jobs).toEqual([]);
  });

  it('stops loading even when everything fails — the skeleton must not strand', async () => {
    sweeps({ failing: [...OPEN_STATUSES] });
    const { result } = renderHook(() => useOpenBook<Row>(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loading).toBe(false);
  });

  it('flags truncation when a sweep comes back at the per-status cap', async () => {
    sweeps({ rows: PER_STATUS_CAP });
    const { result } = renderHook(() => useOpenBook<Row>(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.truncated).toBe(true);
  });

  it('does not flag truncation below the cap', async () => {
    sweeps({ rows: 3 });
    const { result } = renderHook(() => useOpenBook<Row>(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.truncated).toBe(false);
  });

  it('asks for the OLDEST rows — the cap keeps what this screen is for', async () => {
    sweeps();
    const { result } = renderHook(() => useOpenBook<Row>(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    for (const [qs] of fetchAllJobs.mock.calls) {
      // Unsorted the route falls back to job_id DESC — most recently CREATED —
      // so the cap would discard the oldest open jobs, which is the opposite
      // of what this screen exists to show.
      expect(qs).toContain('sortBy=age');
      expect(qs).toContain('sortDir=desc');
    }
  });

  it('carries the SPOC scope into every sweep', async () => {
    sweeps();
    const { result } = renderHook(() => useOpenBook<Row>(42));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchAllJobs.mock.calls).toHaveLength(OPEN_STATUSES.length);
    for (const [qs] of fetchAllJobs.mock.calls) expect(qs).toContain('&spoc=42');
  });
});
