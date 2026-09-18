/*
 * Approved material lines on the client-facing estimate.
 *
 * Sub-project E (Ops Material Approval) of Material Management phase 2 —
 * see EasyFix_Backend/docs/superpowers/specs/2026-09-18-ops-material-approval-
 * design.md. `services/job-line-total.js` on the backend now folds each
 * APPROVED (status = 1) `quotation_details` row into the estimate-preview
 * payload as a line with a name, a qty (`unit`) and the approved charge.
 * The query filters `type = 'material' AND status = 1` server-side, so a
 * pending or rejected line is never returned here — this module renders
 * whatever it is given, with NO status re-filtering on the client, so a
 * backend mistake surfaces instead of being masked.
 *
 * VERIFIED against the landed backend (services/job-line-total.js,
 * MATERIAL_LINE_COLUMNS + approvedMaterialLinesForJobs, 2026-09-18): a line
 * is `{ line_id, name, unit, approved_charge }`, with `approved_charge`
 * always a coerced Number, never null. Both GET /client/jobs/:id/
 * estimate-preview and the public GET /api/public/estimate/:token return the
 * same shape under the same `materials` key (routes/client/index.js,
 * routes/public/estimate.js) — they share estimateLinesForJob(), so the two
 * surfaces cannot disagree.
 *
 * `amount` / `approvedCharge` are read tolerantly anyway: this module was
 * written while that backend change was still landing in parallel, and
 * keeping the fallback costs nothing now that the field name is pinned down.
 *
 * DEPENDENCY-FREE ON PURPOSE (mirrors lib/format.ts): no React, no path
 * aliases, so `npm run test:build` can compile it standalone with tsc and
 * exercise it under node:test.
 */

export type MaterialLine = {
  line_id?: number | string;
  name: string | null;
  unit: number | string | null;
  approved_charge?: number | string | null;
  amount?: number | string | null;
  approvedCharge?: number | string | null;
};

export function num(v: number | string | null | undefined): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The approved charge for one material line, tolerant of whichever field
 * name the backend ships: `amount`, `approved_charge` (the design doc's own
 * spelling) or `approvedCharge`. First one present wins; unset/blank/non-
 * numeric all read as 0 rather than throwing or rendering NaN.
 */
export function materialAmount(line: MaterialLine): number {
  if (line.amount != null && line.amount !== '') return num(line.amount);
  if (line.approved_charge != null && line.approved_charge !== '') return num(line.approved_charge);
  return num(line.approvedCharge);
}

/** Sum of every line's approved amount — the client-visible material subtotal. */
export function materialSubtotal(materials: MaterialLine[] | null | undefined): number {
  return (materials || []).reduce((sum, m) => sum + materialAmount(m), 0);
}
