/*
 * Date/time formatting for the client portal.
 *
 * ─── WHY THIS MODULE EXISTS SEPARATELY FROM utils.ts ────────────────────────
 * It is DEPENDENCY-FREE on purpose: no React, no components, no path aliases.
 * That is what lets `npm test` compile it standalone with tsc and exercise it
 * under node:test. utils.ts imports clsx/tailwind-merge and cannot.
 *
 * ─── THE PROBLEM ────────────────────────────────────────────────────────────
 * MySQL DATETIMEs reach this app as a ZONE-LESS wall-clock string —
 * "2026-08-25 16:56:17" — because the backend pool runs `dateStrings: true`
 * with `timezone: '+05:30'`. The string is IST. It does not say so.
 *
 * The portal's formatDate then made TWO independent mistakes on top of that:
 *
 *   1. `new Date("2026-08-25 16:56:17")` parses as the BROWSER's local time.
 *   2. It read the parts back with `getDate()` / `getHours()` — LOCAL getters,
 *      no timeZone — so even a correctly-parsed instant rendered in whatever
 *      zone the browser happened to be in.
 *
 * On an IST machine the two cancel out exactly, which is why this was invisible
 * to everyone who could have caught it. Anywhere else, both are wrong, and a
 * job stamped just after midnight IST renders on the previous day.
 *
 * FIXING ONLY ONE IS WORSE THAN FIXING NEITHER. Parse as IST but keep the local
 * getters and a correct instant gets re-rendered in the browser's zone; keep
 * the naive parse but format in IST and the wrong instant gets stamped IST.
 * Both halves move together below.
 *
 * Mirrors Easyfix_CRM_UI/src/lib/format.ts — one convention across the two
 * front ends, because they read the same columns off the same backend.
 */

const IST = 'Asia/Kolkata';

/** True when a string states its own UTC offset (trailing Z, +hh:mm or -hhmm). */
export function hasExplicitZone(value: string): boolean {
  return /[Zz]$|[+-]\d{2}:?\d{2}$/.test(value.trim());
}

/*
 * A bare calendar date or a zone-less datetime, and nothing else. Anchored at
 * both ends, so anything carrying an offset or a trailing Z falls through to
 * the normal Date parse rather than being re-stamped.
 */
const NAIVE_DATETIME = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?))?$/;

/**
 * Parse a value that may be an IST wall clock into a real instant.
 *
 * A Date passes through. A string with an explicit zone passes through — it is
 * already an absolute instant, and re-stamping it would corrupt a correct
 * timestamp in order to fix an incorrect one. A zone-less date or datetime is
 * read AS IST. Junk returns an Invalid Date; callers guard on isNaN.
 */
export function parseIstDateTime(value: string | Date): Date {
  if (value instanceof Date) return value;
  const raw = String(value).trim();
  if (!hasExplicitZone(raw)) {
    const m = raw.match(NAIVE_DATETIME);
    // A date with no time is midnight IST. Left to the default Date parse it
    // would be midnight UTC — 05:30 IST — which reads as the right day but the
    // wrong time, and as the WRONG DAY west of Greenwich.
    if (m) return new Date(`${m[1]}T${m[2] ?? '00:00:00'}+05:30`);
  }
  return new Date(raw);
}

/*
 * Render an instant as "DD-MM-YYYY HH:MM" in IST.
 *
 * formatToParts rather than a template over getDate()/getHours(): those are
 * LOCAL getters with no way to ask for a zone, which is half of the original
 * bug. `hourCycle: 'h23'` pins midnight to "00" — `hour12: false` renders it
 * as "24" in some engines.
 */
export function formatIstDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}
