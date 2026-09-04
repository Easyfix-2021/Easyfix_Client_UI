const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/*
 * OPEN_STATUSES must be exactly the server's idea of "open".
 *
 * WHY THIS EXISTS. The portal builds its open book by sweeping one request per
 * status in `OPEN_STATUSES`. The server has no such list — it says
 * `job_status NOT IN (3, 5, 6, 7)`, i.e. everything that is not completed,
 * cancelled or an enquiry. So this array is a hand-maintained MIRROR of a
 * server-side rule, and nothing checked it.
 *
 * Every existing test that touches it does so relative to ITSELF —
 * `OPEN_STATUSES.length * 2`, `fetchAllJobs.mock.calls` — which is exactly the
 * shape of assertion that cannot notice the list is wrong. Add a status
 * server-side and the backend counts it open while this sweep never asks for
 * it: the open book under-counts, every test stays green, and the only symptom
 * is a total that disagrees with the list beneath it.
 *
 * That is not hypothetical. On 2026-09-01 this portal showed "Total Open 5"
 * beside a breakdown reading 5 + 1, because two different places answered the
 * same question with two different status sets.
 *
 * TWO MODES, as tests/emp-code-roundtrip.test.js and the message-literal audit
 * already do. With EasyFix_Backend checked out beside this repo the expectation
 * is DERIVED from its own STATUS map, so it cannot drift. Without it, the test
 * skips rather than asserting against a copy of the answer — a locally pinned
 * duplicate would agree with this file forever and prove nothing, which is the
 * failure mode it is here to prevent.
 */

const TERMINAL = [3, 5, 6, 7];   // completed, completed-alt, cancelled, enquiry

function backendStatusValues() {
  const roots = [
    process.env.EASYFIX_BACKEND_DIR,
    path.join(__dirname, '..', '..', 'EasyFix_Backend'),
  ];
  for (const r of roots) {
    if (!r) continue;
    const f = path.join(r, 'services', 'job.service.js');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    /*
     * Read the STATUS map the backend validates against — the same object
     * ALL_STATUS_VALUES is built from. Parsed rather than required: requiring
     * that module pulls in the DB pool and a live connection, which a unit test
     * must not need.
     */
    const m = /const STATUS = Object\.freeze\(\{([\s\S]*?)\}\)/.exec(src)
      || /const STATUS = \{([\s\S]*?)\};/.exec(src);
    if (!m) return null;
    const vals = [...m[1].matchAll(/:\s*(\d+)/g)].map((x) => Number(x[1]));
    return vals.length ? [...new Set(vals)] : null;
  }
  return null;
}

test('OPEN_STATUSES is exactly the server universe minus the terminal set', (t) => {
  const all = backendStatusValues();
  if (!all) {
    t.skip('EasyFix_Backend not checked out beside this repo — cannot derive the server universe');
    return;
  }

  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'open-book.ts'), 'utf8');
  const m = /export const OPEN_STATUSES = \[([^\]]*)\]/.exec(src);
  assert.ok(m, 'OPEN_STATUSES must still be a literal array in src/lib/open-book.ts — '
    + 'if it moved, point this test at the new home rather than deleting it');
  const ours = [...new Set(m[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)))];

  const expected = all.filter((s) => !TERMINAL.includes(s)).sort((a, b) => a - b);
  const got = [...ours].sort((a, b) => a - b);

  const missing = expected.filter((s) => !got.includes(s));
  const extra = got.filter((s) => !expected.includes(s));

  assert.deepEqual(missing, [],
    'the server counts these statuses as OPEN and this sweep never asks for them, '
    + 'so the open book silently under-counts:\n  ' + missing.join(', '));
  assert.deepEqual(extra, [],
    'this sweep asks for statuses the server treats as CLOSED, so the open book '
    + 'over-counts:\n  ' + extra.join(', '));
});

/*
 * The terminal set itself is pinned as a LITERAL, deliberately.
 *
 * Deriving it from the backend too would make the whole test agree with any
 * definition of "closed", including one changed by accident — the same reason
 * the employee-code suite pins its prefix rather than reading the constant it
 * is testing. If the business genuinely retires or adds a terminal status, this
 * line is the one place that has to be edited on purpose.
 */
test('the terminal set is what the server actually excludes', (t) => {
  const roots = [process.env.EASYFIX_BACKEND_DIR, path.join(__dirname, '..', '..', 'EasyFix_Backend')];
  const f = roots.filter(Boolean).map((r) => path.join(r, 'routes', 'client', 'index.js')).find(fs.existsSync);
  if (!f) { t.skip('EasyFix_Backend not checked out beside this repo'); return; }
  const src = fs.readFileSync(f, 'utf8');

  /*
   * EVERY occurrence, not "at least one".
   *
   * The first version of this asserted the correct pattern EXISTS somewhere in
   * the file. That file excludes the terminal set in a dozen places, so a
   * mutation changing one of them still matched the other eleven and the test
   * passed — a drifted call site hiding behind its correct siblings. Caught by
   * mutation-testing this guard rather than by trusting that it was green.
   */
  const occurrences = [...src.matchAll(/job_status\s+NOT IN\s*\(([^)]*)\)/gi)]
    .map((m) => m[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)))
    .map((set) => [...set].sort((a, b) => a - b).join(','));

  assert.ok(occurrences.length, 'no `job_status NOT IN (...)` found in the client routes at all — '
    + 'the exclusion moved, and this guard is now asserting nothing');

  const want = [...TERMINAL].sort((a, b) => a - b).join(',');
  const odd = [...new Set(occurrences.filter((o) => o !== want))];
  assert.deepEqual(odd, [],
    `every job_status exclusion in the client routes must be exactly (${want}). These differ, `
    + 'so TERMINAL above is stale for at least one surface and its "open" numbers are '
    + `computed against the wrong set:\n  ` + odd.join('\n  '));
});
