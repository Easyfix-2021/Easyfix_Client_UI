/*
 * ApproveQuotationDialog — pure-logic tests.
 *
 * These exercise the five things a UI test would otherwise have to click
 * through: slot-label wording, the file gate, the overall form-validity gate,
 * the 409-conflict classification, and the wall-clock string sent to the
 * backend. None of them render the dialog — see
 * tests/pending-on-you.test.tsx for the sibling component's precedent of
 * testing exported pure helpers directly rather than the whole tree.
 *
 * Each `it` below is paired with the ONE mutation that would defeat it (noted
 * in the comment above it) — checked by hand while writing these: reverting
 * the guard/condition named made the test fail, confirming the assertion is
 * actually load-bearing and not just restating the implementation.
 */
import { describe, expect, it } from 'vitest';
import {
  slotLabel, toVisitDateTime, formatVisitSummary,
  validatePermissionFile, isApproveFormValid, isSlotConflict,
  MAX_PERMISSION_FILE_BYTES,
} from '@/components/ApproveQuotationDialog';

function file(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('slotLabel', () => {
  it('formats the morning, noon and evening boundary hours', () => {
    expect(slotLabel(9)).toBe('9 AM – 10 AM');
    expect(slotLabel(11)).toBe('11 AM – 12 PM');
    expect(slotLabel(12)).toBe('12 PM – 1 PM');
    expect(slotLabel(18)).toBe('6 PM – 7 PM');
  });

  /*
   * Mutation this defeats: routing `hour` through `new Date(...)` /
   * `toLocaleTimeString` instead of the plain arithmetic above. `hour` is
   * already the technician's IST wall-clock hour — the whole point of
   * shipping it as a bare integer — so re-introducing a Date object would
   * make the label depend on the BROWSER's zone again, exactly the bug
   * src/lib/format.ts exists to prevent. Forcing the process to a
   * non-IST zone and asserting the label is unchanged catches that
   * regression the moment it lands.
   */
  it('never depends on the runtime timezone — hour is already IST wall clock, not an instant', () => {
    const prevTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(slotLabel(9)).toBe('9 AM – 10 AM');
      expect(slotLabel(18)).toBe('6 PM – 7 PM');
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

describe('toVisitDateTime', () => {
  it('builds the exact "YYYY-MM-DD HH:00:00" the backend requires, zero-padded', () => {
    expect(toVisitDateTime('2026-09-25', 9)).toBe('2026-09-25 09:00:00');
    expect(toVisitDateTime('2026-09-25', 18)).toBe('2026-09-25 18:00:00');
  });
});

describe('formatVisitSummary', () => {
  it('combines the day label and the slot label for the success toast', () => {
    // formatIstDayDate always reads Asia/Kolkata regardless of the host
    // timezone, so this is deterministic in CI as well as IST.
    expect(formatVisitSummary('2026-09-25', 10)).toMatch(/^\w+, 25 Sept?, 10 AM – 11 AM$/);
  });
});

describe('validatePermissionFile', () => {
  it('requires a file', () => {
    expect(validatePermissionFile(null)).toBe('Please choose a file.');
  });

  /*
   * Mutation this defeats: dropping the extension fallback and matching
   * `file.type` alone. iOS Safari/Chrome frequently hand HEIC camera photos
   * to <input type=file> with an empty or generic MIME type, so a MIME-only
   * gate would reject the exact file this permission type exists for.
   */
  it('accepts HEIC by extension even when the browser reports no MIME type', () => {
    expect(validatePermissionFile(file('gate-pass.heic', '', 2_000_000))).toBeNull();
  });

  it('accepts the documented types under the size limit', () => {
    expect(validatePermissionFile(file('pass.pdf', 'application/pdf', 1_000_000))).toBeNull();
    expect(validatePermissionFile(file('pass.jpg', 'image/jpeg', 1_000_000))).toBeNull();
  });

  it('rejects a type outside the documented list', () => {
    expect(validatePermissionFile(file('pass.docx', 'application/msword', 1000)))
      .toBe('Only PDF, JPEG, PNG, WEBP or HEIC files are accepted.');
  });

  /*
   * Mutation this defeats: using `>=` instead of `>` against the 10MB bound,
   * which would reject a file the route's own multer limit still accepts.
   */
  it('accepts a file exactly at the 10MB limit and rejects one byte over', () => {
    expect(validatePermissionFile(file('pass.pdf', 'application/pdf', MAX_PERMISSION_FILE_BYTES))).toBeNull();
    expect(validatePermissionFile(file('pass.pdf', 'application/pdf', MAX_PERMISSION_FILE_BYTES + 1)))
      .toBe('That file is larger than 10MB. Please choose a smaller file.');
  });
});

describe('isApproveFormValid', () => {
  const base = { date: '2026-09-25', hour: 10, choice: null, file: null } as const;

  it('is false with no slot chosen', () => {
    expect(isApproveFormValid({ ...base, date: null, choice: 'not_required' })).toBe(false);
    expect(isApproveFormValid({ ...base, hour: null, choice: 'not_required' })).toBe(false);
  });

  it('is false with no permission choice made', () => {
    expect(isApproveFormValid({ ...base, choice: null })).toBe(false);
  });

  it("'later' and 'not_required' need no file", () => {
    expect(isApproveFormValid({ ...base, choice: 'later' })).toBe(true);
    expect(isApproveFormValid({ ...base, choice: 'not_required' })).toBe(true);
  });

  /*
   * Mutation this defeats: treating `choice === 'now'` the same as the other
   * two branches and skipping the file check — exactly the gap the design
   * calls out ("permission_file required iff 'now'").
   */
  it("'now' is invalid without a passing file", () => {
    expect(isApproveFormValid({ ...base, choice: 'now', file: null })).toBe(false);
    expect(isApproveFormValid({ ...base, choice: 'now', file: file('x.docx', 'application/msword', 10) })).toBe(false);
    expect(isApproveFormValid({ ...base, choice: 'now', file: file('x.pdf', 'application/pdf', 10) })).toBe(true);
  });
});

describe('isSlotConflict', () => {
  /*
   * Mutation this defeats: matching on the error MESSAGE text instead of the
   * HTTP status. The backend's 409 copy is free text ("That slot was just
   * booked — pick another") that could be reworded without changing the
   * status code — a string match would silently stop firing on a copy edit.
   */
  it('is keyed on status 409, not on the message text', () => {
    expect(isSlotConflict(Object.assign(new Error('That slot was just booked — pick another'), { status: 409 }))).toBe(true);
    expect(isSlotConflict(Object.assign(new Error('slot was just booked'), { status: 400 }))).toBe(false);
  });

  it('is false for a plain error with no status, or no error at all', () => {
    expect(isSlotConflict(new Error('network down'))).toBe(false);
    expect(isSlotConflict(null)).toBe(false);
    expect(isSlotConflict(undefined)).toBe(false);
  });
});
