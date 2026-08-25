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
 * ─── The two shapes the portal actually renders ─────────────────────────────
 *
 * These replace three hand-rolled copies of formatDate that lived in
 * tickets/new, history and estimate/[token]. Two were byte-identical and the
 * third differed only in its options and its fallback, which is exactly how
 * duplication looks right before it starts to drift.
 *
 * Each keeps the ORIGINAL toLocale* call and options verbatim and only adds
 * `timeZone` — the surest way to guarantee the rendered string is unchanged
 * for the zone-less IST values these pages receive, while becoming correct for
 * a zoned string or a Date (which used to render in the browser's timezone).
 *
 * `fallback` exists because the estimate page is PUBLIC: on a bad value it
 * showed the raw string rather than an em dash, on the reasoning that a
 * customer seeing something is better than seeing nothing. Preserved rather
 * than normalised away.
 */

/** "Mon, 25 Aug" — weekday and date, no year, no time. */
export function formatIstDayDate(
  value: string | Date | null | undefined,
  fallback = '—',
): string {
  if (!value) return fallback;
  const d = parseIstDateTime(value);
  if (Number.isNaN(d.getTime())) return fallback;
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: IST });
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: IST });
  return `${day}, ${date}`;
}

/** "25 Aug 2026, 04:56 pm" — the long form, with year and time. */
export function formatIstDateTimeLong(
  value: string | Date | null | undefined,
  fallback = '—',
): string {
  if (!value) return fallback;
  const d = parseIstDateTime(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: IST,
  });
}

/*
 * ─── The primitive every date render should go through ──────────────────────
 *
 * One function, the caller's own Intl options. Deliberately NOT a named
 * function per visual format: the portal renders a dozen different shapes
 * ("25 Aug", "Tue, 25 Aug", "August 2026", "25 Aug 2026, 04:56 pm"), and a
 * name for each would be a naming committee that still leaves the format
 * invisible at the call site. What must be consistent is the BEHAVIOUR —
 * parse as IST, render as IST — not the appearance. Screens legitimately
 * differ in how much date they show.
 *
 * ⚠ ONLY FOR VALUES THAT CAME FROM THE BACKEND. A locally-constructed
 * calendar date — `new Date(year, month, 1)` for a month boundary, or
 * `new Date()` for "today" — is a LOCAL wall clock by construction, and
 * forcing it through Asia/Kolkata shifts it for anyone AHEAD of IST: local
 * midnight on 1 Sep in Tokyo is 20:30 IST on 31 Aug, so a month label would
 * read "August". Those call sites are deliberately left alone; see the
 * exclusions listed in the commit that introduced this.
 */
export function formatIst(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
  opts: { locale?: string; fallback?: string } = {},
): string {
  const { locale = 'en-IN', fallback = '—' } = opts;
  if (!value) return fallback;
  const d = parseIstDateTime(value);
  if (Number.isNaN(d.getTime())) return fallback;
  // timeZone LAST so a caller cannot accidentally override the one guarantee
  // this function exists to make.
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: IST }).format(d);
}
