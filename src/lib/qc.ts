/*
 * Pure helpers for the Quality Check page (3.8).
 *
 * Pulled out of the page module because a Next.js App Router `page.tsx` may
 * export ONLY the handful of names the framework recognises (the default
 * component, `metadata`, `generateMetadata`, …) — any other named export,
 * including one added purely so a test can import it, fails `next build`
 * with "is not a valid Page export field". Everything testable in isolation
 * therefore lives here instead, one level up from the page.
 */
import { formatIst } from './format';

const DUE_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
};

/**
 * "Auto-approves 21 Sept, 11:30 am" — the label a client reads to know how
 * long they have before an unreviewed job leaves their hands. `dueOn` is a
 * zone-less IST wall clock, same convention as every other datetime this
 * backend emits; `formatIst` is what keeps it from rendering in whatever zone
 * the client's browser happens to sit in.
 */
export function autoApprovesLabel(dueOn: string | null): string {
  if (!dueOn) return 'Auto-approves — timing not set';
  return `Auto-approves ${formatIst(dueOn, DUE_FORMAT)}`;
}
