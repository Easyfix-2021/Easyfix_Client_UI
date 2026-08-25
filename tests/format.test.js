'use strict';

/*
 * lib/format — IST datetime handling for the client portal.
 *
 * THE FAILURE THIS PREVENTS IS INVISIBLE ON AN IST MACHINE, which is why it
 * survived so long. MySQL DATETIMEs arrive zone-less ("2026-08-25 16:56:17")
 * and mean IST. The old formatDate made two mistakes that cancel out EXACTLY
 * at +05:30 and nowhere else: it parsed with `new Date(s)` (browser-local) and
 * then read the parts back with getDate()/getHours() (browser-local again).
 *
 * So every assertion below compares against a FIXED absolute instant, and the
 * suite is run under foreign timezones in CI-by-hand:
 *
 *     TZ=America/New_York npm test
 *     TZ=Europe/London    npm test
 *
 * If these only pass under IST, they are testing nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const F = require('../.test-build/format.js');

const AT = (iso) => new Date(iso).getTime();

// ─── parseIstDateTime ─────────────────────────────────────────────────────

test('a zone-less MySQL DATETIME is read as IST, not as browser-local time', () => {
  assert.equal(F.parseIstDateTime('2026-08-25 16:56:17').getTime(), AT('2026-08-25T16:56:17+05:30'));
});

test('the T-separated form is treated identically', () => {
  assert.equal(F.parseIstDateTime('2026-08-25T16:56:17').getTime(), AT('2026-08-25T16:56:17+05:30'));
});

test('a date with no time is MIDNIGHT IST, not midnight UTC', () => {
  assert.equal(F.parseIstDateTime('2026-08-25').getTime(), AT('2026-08-25T00:00:00+05:30'));
});

test('a value that STATES its zone is left alone', () => {
  // Re-stamping this would corrupt a correct timestamp to fix an incorrect one.
  assert.equal(F.parseIstDateTime('2026-08-25T11:26:17Z').getTime(), AT('2026-08-25T11:26:17Z'));
  assert.equal(F.parseIstDateTime('2026-08-25T06:56:17-05:00').getTime(), AT('2026-08-25T06:56:17-05:00'));
});

test('a Date passes through untouched', () => {
  const d = new Date('2026-08-25T11:26:17Z');
  assert.equal(F.parseIstDateTime(d), d);
});

test('junk returns an Invalid Date rather than throwing — callers guard on isNaN', () => {
  assert.ok(Number.isNaN(F.parseIstDateTime('not a date').getTime()));
});

test('hasExplicitZone does not mistake the date separators for an offset', () => {
  assert.equal(F.hasExplicitZone('2026-08-25 16:56:17'), false,
    'the hyphens in the DATE must not read as a negative UTC offset');
  assert.equal(F.hasExplicitZone('2026-08-25T16:56:17-05:00'), true);
});

// ─── formatIstDateTime ────────────────────────────────────────────────────

test('renders DD-MM-YYYY HH:MM in IST regardless of the host timezone', () => {
  // 11:26 UTC is 16:56 IST. A local-getter renderer would print the host's
  // clock here and pass only under TZ=Asia/Kolkata.
  assert.equal(F.formatIstDateTime(new Date('2026-08-25T11:26:17Z')), '25-08-2026 16:56');
});

test('the output format is unchanged from the version this replaced', () => {
  assert.match(F.formatIstDateTime(new Date('2026-01-05T00:00:00+05:30')), /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
});

test('midnight IST renders as 00, never 24', () => {
  // hour12:false renders midnight as "24" in some engines; hourCycle 'h23' pins it.
  assert.equal(F.formatIstDateTime(new Date('2026-08-25T00:00:00+05:30')), '25-08-2026 00:00');
});

test('an instant just after IST midnight keeps its own DATE, not the host’s', () => {
  // 18:45 UTC on the 24th is 00:15 IST on the 25th. Under any western zone the
  // old renderer showed the 24th — the wrong DAY, which is the bug that hurts.
  assert.equal(F.formatIstDateTime(new Date('2026-08-24T18:45:00Z')), '25-08-2026 00:15');
});

// ─── end to end ───────────────────────────────────────────────────────────

test('a zone-less DB string round-trips to its own IST wall clock', () => {
  const s = '2026-08-25 16:56:17';
  assert.equal(F.formatIstDateTime(F.parseIstDateTime(s)), '25-08-2026 16:56',
    'what the database holds is what the operator sees, in any timezone');
});

// ─── the two rendered shapes ──────────────────────────────────────────────
/*
 * These replaced three hand-rolled copies. The assertions that matter are not
 * "does it format" but "is it the SAME STRING the copies produced", because a
 * consolidation that quietly changes what operators read is a worse outcome
 * than the duplication it removed.
 */

test('formatIstDayDate renders "Mon, DD Mmm" in IST', () => {
  // 11:26 UTC = 16:56 IST on the 25th, a Tuesday in IST.
  assert.equal(F.formatIstDayDate('2026-08-25 16:56:17'), 'Tue, 25 Aug');
});

test('formatIstDayDate keeps the IST day across the UTC midnight boundary', () => {
  // 18:45 UTC on the 24th is 00:15 IST on the 25th. A browser-local renderer
  // west of Greenwich showed the 24th — the wrong DAY.
  assert.equal(F.formatIstDayDate('2026-08-24T18:45:00Z'), 'Tue, 25 Aug');
});

test('formatIstDateTimeLong renders "DD Mmm YYYY, hh:mm am/pm" in IST', () => {
  const out = F.formatIstDateTimeLong('2026-08-25 16:56:17');
  assert.match(out, /^25 Aug 2026, 04:56\s*pm$/i, `got ${JSON.stringify(out)}`);
});

test('both fall back for empty and invalid input', () => {
  assert.equal(F.formatIstDayDate(null), '—');
  assert.equal(F.formatIstDayDate('not a date'), '—');
  assert.equal(F.formatIstDateTimeLong(''), '—');
});

test('the estimate page can keep showing the RAW value on a bad date', () => {
  // That page is PUBLIC; it preferred showing something over an em dash, and
  // the fallback parameter preserves that rather than normalising it away.
  assert.equal(F.formatIstDateTimeLong('garbage', 'garbage'), 'garbage');
});
