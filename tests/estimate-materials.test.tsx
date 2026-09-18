/*
 * Materials section — sub-project E (Ops Material Approval).
 *
 * The API contract (EasyFix_Backend's ops-material-approval design doc)
 * filters `type = 'material' AND status = 1` server-side, so the client is
 * NOT supposed to re-filter by status — it renders exactly what arrives.
 * These tests exist to prove that rendering, and to positive-control the
 * empty-state guard: a service-only job (no material lines) must not grow
 * an empty "Materials" heading, and that guard is the kind of check that
 * silently stops firing if someone flips `.length === 0` to `.length >= 0`.
 *
 * The exact field the backend uses for the approved amount isn't pinned
 * down yet (parallel change) — `amount` / `approved_charge` /
 * `approvedCharge` are all exercised so a backend key choice doesn't quietly
 * start rendering ₹0 for every line.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EstimateMaterials, EstimateTotalsSummary } from '@/components/estimate-materials';

describe('EstimateMaterials', () => {
  it('renders nothing when there are no material lines (service-only job)', () => {
    const { container: empty } = render(<EstimateMaterials materials={[]} />);
    expect(empty.firstChild).toBeNull();

    const { container: nullish } = render(<EstimateMaterials materials={null} />);
    expect(nullish.firstChild).toBeNull();

    expect(screen.queryByText('Materials')).toBeNull();
  });

  it('shows exactly what the API returns: name, qty and the approved amount', () => {
    render(
      <EstimateMaterials
        materials={[
          { name: 'Copper Pipe 1"', unit: 3, approved_charge: 450 },
          { name: 'PVC Elbow', unit: '2', amount: '120.50' },
        ]}
      />
    );
    expect(screen.getByText('Materials')).toBeTruthy();
    expect(screen.getByText('Copper Pipe 1"')).toBeTruthy();
    expect(screen.getByText('PVC Elbow')).toBeTruthy();
    // Qty cells
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    // Approved amounts, via the shared ₹ formatter
    expect(screen.getByText('₹450')).toBeTruthy();
    expect(screen.getByText('₹121')).toBeTruthy(); // Math.round(120.50)
    // Material Subtotal = 450 + 120.50 = 570.50 → rounds to 571
    expect(screen.getByText('₹571')).toBeTruthy();
  });

  it('reads the approved amount from approvedCharge when neither amount nor approved_charge is present', () => {
    render(<EstimateMaterials materials={[{ name: 'Sealant Tube', unit: 1, approvedCharge: 80 }]} />);
    // Appears twice: the line's own amount cell and the (single-line) subtotal.
    expect(screen.getAllByText('₹80')).toHaveLength(2);
  });

  it('does not invent a client-side status filter — it renders every line handed to it', () => {
    // The API is documented to return only approved (status = 1) lines. This
    // asserts the OTHER half of that contract: the component itself applies
    // no filtering of its own, so a backend regression that leaked a pending
    // or rejected line would actually surface here rather than being masked.
    const suspicious = [
      { name: 'Line A', unit: 1, amount: 100 },
      { name: 'Line B', unit: 1, amount: 200, status: 0 } as any,
    ];
    render(<EstimateMaterials materials={suspicious} />);
    expect(screen.getByText('Line A')).toBeTruthy();
    expect(screen.getByText('Line B')).toBeTruthy();
  });
});

describe('EstimateTotalsSummary', () => {
  it('renders nothing until the backend sends totals', () => {
    const { container } = render(<EstimateTotalsSummary totals={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('hides the Materials line when the material subtotal is zero', () => {
    render(<EstimateTotalsSummary totals={{ service_charge_subtotal: 500, material_subtotal: 0, grand_total: 500 }} />);
    expect(screen.getByText('Service Charges')).toBeTruthy();
    expect(screen.queryByText('Materials')).toBeNull();
    expect(screen.getByText('Grand Total')).toBeTruthy();
  });

  it('shows the material subtotal and an inclusive grand total when materials are approved', () => {
    render(<EstimateTotalsSummary totals={{ service_charge_subtotal: 500, material_subtotal: 570, grand_total: 1070 }} />);
    expect(screen.getByText('₹500')).toBeTruthy();
    expect(screen.getByText('₹570')).toBeTruthy();
    expect(screen.getByText('₹1,070')).toBeTruthy();
  });
});
