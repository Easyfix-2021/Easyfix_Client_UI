/*
 * The open book — eight parallel status sweeps, streamed.
 *
 * ⚠ THIS LIVES IN lib BECAUSE IT HAD TO BE TESTABLE. It was defined inside
 * app/(authed)/jobs/page.tsx, and Next rejects a non-page export from a page
 * file, so nothing could import it — which meant its partial-failure handling,
 * the one branch a reader depends on to know their counts are short, was
 * verifiable only by reading. See tests/open-book.test.tsx.
 *
 * Generic over the row type so the page keeps owning its own JobRow shape;
 * this module only cares that rows arrive in arrays.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { fetchAllJobs } from '@/lib/hooks';
import { classifySweeps } from '@/lib/sweeps';

/*
 * ⚠ THIS LIST IS "job_status NOT IN (3,5,6,7)" ENUMERATED, and it has to stay
 * that way — the Home card counts the book with that predicate and this page
 * is where the reader lands when they click it. Any code the predicate keeps
 * and this array drops is a job counted but not listable.
 *
 * 10 was the one that got dropped. It reads as CLOSED_FROM_APP, but it is a
 * RESTING state, not a terminal one: 259 of them on QA, not one with a
 * checkout timestamp, none newer than four months old, and statusLabel renders
 * them as "Ready for Full-Fillement" / "Estimate Approved" — work outstanding
 * by any reading. It is excluded from the terminal set for that reason, so the
 * list has to carry it.
 */
export const OPEN_STATUSES = [9, 0, 1, 2, 20, 15, 21, 10] as const;

/** Per-status ceiling. fetchAllJobs pages at 500, so this is at most two calls. */
export const PER_STATUS_CAP = 1000;

export function useOpenBook<T>(spocId: number | null) {
  const [jobs, setJobs] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  /** Statuses whose sweep failed — the list is INCOMPLETE, and the page says so. */
  const [partial, setPartial] = useState<number[]>([]);
  /*
   * Supersession guard. Changing the SPOC starts a new load while the old
   * one's eight requests are still in flight, and a late chunk from the
   * previous scope must not append itself to the new one.
   *
   * ⚠ The guard is on the WRITES, never on the single setLoading(false) — a
   * stale-guarded finally is how a screen ends up stuck on its skeleton
   * forever when the guard trips.
   */
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoading(true);
    setError(null);
    setPartial([]);

    const scope = spocId ? `&spoc=${spocId}` : '';
    /*
     * ⚠ sortBy=age IS THE CAP'S CORRECTNESS, not an ordering preference.
     *
     * Each status is capped at PER_STATUS_CAP. Unsorted, the route falls back
     * to `ORDER BY j.job_id DESC` — highest ids, i.e. most recently CREATED —
     * so the rows dropped by the cap were the OLDEST open jobs. This screen
     * exists to open on the worst thing in the book and sorts oldest-first to
     * do it, so the cap was discarding precisely what the page is for, and
     * the age band above it was counting a set with its tail cut off.
     *
     * `age` is on the backend's SORTABLE_COLUMNS whitelist and resolves to
     * GREATEST(TIMESTAMPDIFF(SECOND, j.ticket_created_date_time, <end>), 0) —
     * the SAME measure this page's ageDays and every bucket is computed from,
     * and anchored on ticket_created_date_time, which is immutable (unlike
     * created_date_time, which is re-stamped on edits). One definition, so
     * the server's choice of which rows survive and the client's ordering of
     * them can never disagree.
     */
    /*
     * ─── SEVEN SWEEPS, RENDERED AS THEY LAND ──────────────────────────────
     *
     * This was `await Promise.all(...)` followed by one setJobs, so the page
     * showed nothing at all until the SLOWEST of eight status sweeps came
     * back — on a large client, the whole screen waited on its least
     * interesting status. Each sweep now appends the moment it resolves.
     *
     * The accumulator is why the list is not blanked first: the previous
     * scope's rows stay on screen until the first chunk of the new one
     * arrives, so a manual refresh does not flash empty.
     */
    const acc: T[] = [];
    let capped = false;
    const failed: number[] = [];

    const settled = await Promise.all(OPEN_STATUSES.map((st) =>
      fetchAllJobs<T>(`status=${st}${scope}&sortBy=age&sortDir=desc`, PER_STATUS_CAP)
        .then((rows) => {
          if (seqRef.current !== seq) return;
          if (rows.length >= PER_STATUS_CAP) capped = true;
          acc.push(...rows);
          setJobs([...acc]);
        })
        .catch((err) => {
          failed.push(st);
          return err instanceof ApiError ? err.message : 'Could not load your open jobs';
        })));

    if (seqRef.current !== seq) return;

    /*
     * ⚠ A PARTIAL BOOK IS NOT A LOADED BOOK. Under Promise.all one failed
     * sweep rejected the lot and the page showed an error. Streaming would
     * instead show seven statuses out of eight with no sign anything was
     * missing — every bucket count silently short. So: all eight failed is an
     * error, some failed is a disclosed partial, and only none failed is a
     * clean load.
     */
    /* classifySweeps is in lib so this decision has a runnable check — the
       portal has no React test harness, and a branch left inline in a hook is
       verifiable only by reading. See tests/sweeps.test.js. */
    const outcome = classifySweeps(OPEN_STATUSES.length, failed.length);
    if (outcome === 'failed') {
      setError(settled.find((m) => typeof m === 'string') || 'Could not load your open jobs');
      setJobs([]);
    }
    setPartial(outcome === 'partial' ? failed : []);
    setTruncated(capped);
    setLoading(false);
  }, [spocId]);

  useEffect(() => { void load(); }, [load]);
  return { jobs, loading, error, truncated, partial, reload: load };
}
