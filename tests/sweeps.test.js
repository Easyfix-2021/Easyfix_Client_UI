/*
 * classifySweeps — the branch that decides whether a reader is told their data
 * is incomplete.
 *
 * WHY THIS EXISTS. /jobs loads its open book from SEVEN parallel status
 * sweeps. It used to await Promise.all, so one failed sweep rejected the lot
 * and the page showed an error. Streaming them means the six that succeeded
 * now render — and the failure mode inverts: the screen looks perfectly
 * healthy while the list and every age-band count below it are SHORT, with
 * nothing saying so.
 *
 * That is the one outcome worth a test, and it is exactly the one a
 * happy-path check never reaches: it needs a request to fail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { classifySweeps } = require('../.test-build/sweeps.js');

const OPEN_STATUSES = 7; // what /jobs actually fans out over

test('all seven failing is an error — there is nothing to show', () => {
  assert.equal(classifySweeps(OPEN_STATUSES, 7), 'failed');
});

test('SOME failing is a PARTIAL, never a clean load', () => {
  for (let f = 1; f < OPEN_STATUSES; f += 1) {
    assert.equal(classifySweeps(OPEN_STATUSES, f), 'partial',
      `${f} of 7 failing must be disclosed — the rows that arrived render fine, `
      + 'so the page looks healthy while every bucket count is short');
  }
});

test('one failure is enough — a six-sevenths book is not a book', () => {
  assert.equal(classifySweeps(OPEN_STATUSES, 1), 'partial');
  assert.notEqual(classifySweeps(OPEN_STATUSES, 1), 'ok');
});

test('none failing is the only clean load', () => {
  assert.equal(classifySweeps(OPEN_STATUSES, 0), 'ok');
});

test('an empty fan-out is ok, not failed — nothing was asked for', () => {
  assert.equal(classifySweeps(0, 0), 'ok');
  // Guards the `failed >= total` form: 0 >= 0 is true, so a naive
  // implementation reports an error for a screen that requested nothing.
});

test('more failures than requests still reads as failed, never as partial', () => {
  // Defensive: a caller double-counting a rejection must not downgrade a total
  // outage to a disclosed partial, which is the softer of the two states.
  assert.equal(classifySweeps(3, 5), 'failed');
});

test('the three outcomes are exhaustive and mutually exclusive', () => {
  const seen = new Set();
  for (let total = 0; total <= 7; total += 1) {
    for (let failed = 0; failed <= total; failed += 1) {
      const out = classifySweeps(total, failed);
      assert.ok(['ok', 'partial', 'failed'].includes(out), `unexpected outcome ${out}`);
      seen.add(out);
    }
  }
  assert.deepEqual([...seen].sort(), ['failed', 'ok', 'partial'],
    'every state must be reachable, or one of them is dead code');
});
