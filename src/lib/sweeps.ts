/*
 * Outcome of a fan-out that loads one screen from SEVERAL requests.
 *
 * Extracted so this decision has a runnable check. The portal has no React
 * test harness, so a branch left inline in a hook is verifiable only by
 * reading — and this is the branch that decides whether a reader is told their
 * data is incomplete.
 *
 * Dependency-free ON PURPOSE, like lib/format, so `npm run test:build` can
 * compile it standalone.
 */

/**
 * `failed` — how many of `total` requests rejected.
 *
 *   'failed'   every one rejected. There is nothing to show, so the screen
 *              shows an error instead.
 *   'partial'  some rejected. ⚠ THIS IS THE CASE THAT MUST NOT BE SILENT:
 *              the rows that DID arrive render fine, so the screen looks
 *              healthy while every count on it is short. The reader has to be
 *              told, or a partial book reads as the whole book.
 *   'ok'       none rejected.
 *
 * `total === 0` is 'ok', not 'failed': nothing was asked for, so nothing
 * failed — a fan-out over an empty list must not report an error.
 */
export type SweepOutcome = 'ok' | 'partial' | 'failed';

export function classifySweeps(total: number, failed: number): SweepOutcome {
  if (total <= 0) return 'ok';
  if (failed >= total) return 'failed';
  return failed > 0 ? 'partial' : 'ok';
}
