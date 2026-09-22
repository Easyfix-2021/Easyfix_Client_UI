/*
 * Materials section — shared between the two client-facing estimate
 * surfaces (authed console at src/app/(authed)/jobs/page.tsx and the
 * public magic-link page at src/app/estimate/[token]/page.tsx).
 *
 * Sub-project E, Ops Material Approval (see EasyFix_Backend's
 * docs/superpowers/specs/2026-09-18-ops-material-approval-design.md,
 * "Client portal" section). The API returns ONLY approved
 * (`quotation_details.status = 1`) material lines — a pending or rejected
 * line is filtered out server-side — so this renders exactly what arrives
 * with no client-side status filtering that could hide a backend mistake.
 *
 * Renders nothing when there are no material lines: a service-only job
 * must not grow an empty "Materials" heading.
 */
import { rupees } from '@/lib/format';
import { materialAmount, materialSubtotal, num, type MaterialLine } from '@/lib/materials';

export type { MaterialLine };

export function EstimateMaterials({
  materials, className,
}: {
  materials: MaterialLine[] | null | undefined;
  className?: string;
}) {
  if (!materials || materials.length === 0) return null;
  return (
    <div className={className}>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-1.5">
        Materials
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="!text-right">Qty</th>
              <th className="!text-right">Approved Amount</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m, i) => (
              <tr key={m.line_id ?? i}>
                <td className="text-sm">{m.name || '—'}</td>
                <td className="text-right font-mono">{num(m.unit)}</td>
                <td className="text-right font-mono">{rupees(materialAmount(m))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="text-right text-sm font-semibold text-ink-700">
                Material Subtotal
              </td>
              <td className="text-right font-mono font-semibold text-ink-900">
                {rupees(materialSubtotal(materials))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/*
 * Totals summary — Service Charges / Materials (only when non-zero) /
 * Grand Total. The public estimate page shows no total figure at all
 * today (it only renders the PDF), so this is what gives it one; the
 * authed console page already shows its own grand-total figure inline
 * (the Approve-Estimate button label + the Estimate-value row) and does
 * NOT use this component — those two spots already read
 * `est.totals.grand_total` and pick up the material subtotal automatically
 * once the backend includes it, with no client change needed.
 */
export function EstimateTotalsSummary({
  totals, className,
}: {
  totals: { service_charge_subtotal?: number | string | null; material_subtotal?: number | string | null; grand_total?: number | string | null } | null | undefined;
  className?: string;
}) {
  if (!totals) return null;
  const materialTotal = num(totals.material_subtotal);
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-sm text-ink-500 py-0.5">
        <span>Service Charges</span>
        <span className="font-mono">{rupees(num(totals.service_charge_subtotal))}</span>
      </div>
      {materialTotal > 0 && (
        <div className="flex items-baseline justify-between text-sm text-ink-500 py-0.5">
          <span>Materials</span>
          <span className="font-mono">{rupees(materialTotal)}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between text-base font-semibold text-ink-900 pt-1.5 mt-1 border-t border-ink-100">
        <span>Grand Total</span>
        <span className="font-mono">{rupees(num(totals.grand_total))}</span>
      </div>
    </div>
  );
}
