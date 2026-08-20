/**
 * Categorical decoration and third-party marks — the ONE module besides
 * palette.ts allowed to hold colour literals, and exempt from the colour-literal
 * rule ONLY (every other brand rule still applies to it).
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT A LOOPHOLE
 *
 * The brand rule is "only tokens in code", and for anything that carries MEANING
 * that rule is absolute: a completed job is `text-success`, an overdue one is
 * `text-danger`, money is `text-money`. Those must move when the brand moves.
 *
 * Two kinds of colour are not like that:
 *
 *   1. CATEGORICAL DECORATION. A seven-tile grid needs seven hues that stay
 *      distinguishable when ADJACENT — that is a different problem from semantic
 *      colour, and the brand's red / ink / blue / gold cannot solve it. Rendering
 *      all seven in brand colours does not make the dashboard more on-brand; it
 *      makes the seven categories unreadable. Easyfix_CRM_UI reached the same
 *      conclusion and exempts its QuickSight chart palette for the same reason.
 *
 *   2. COLOUR SOMEBODY ELSE OWNS. WhatsApp green is WhatsApp's, not ours. A
 *      rebrand must not repaint it, and a token that did would be wrong.
 *
 * So they are gathered HERE, named, and documented — one file to read when the
 * identity changes, instead of 1,632 literals spread across 28 screens.
 *
 * THE TEST FOR ADDING SOMETHING. Ask: "if EasyFix rebranded tomorrow, should
 * this colour change?" If yes it is a TOKEN and belongs in tokens.ts — no
 * exceptions, however decorative it looks. If no, it may live here. A status
 * colour, a call-to-action, a money figure and an error state all answer yes.
 *
 * DO NOT grow the ramps to fit a new screen. Seven categorical gradients is
 * already at the edge of what stays distinguishable; a screen needing an eighth
 * needs fewer categories, not another hue.
 */

/**
 * Categorical tile gradients. Ordered for maximum adjacent separation, not by
 * hue family — tiles are read side by side, so neighbours must differ in hue AND
 * lightness. `glow` is the tile's drop shadow, the gradient's own end colour at
 * 45% so the shadow tracks its tile rather than being picked by hand.
 */
export const chartSeries = [
  { key: 'blue', from: '#5e9bff', to: '#4f46e5', glow: 'rgba(79, 70, 229, 0.45)' },
  { key: 'violet', from: '#a855f7', to: '#6d3bd0', glow: 'rgba(124, 58, 237, 0.45)' },
  { key: 'cyan', from: '#22d3ee', to: '#0e9488', glow: 'rgba(14, 148, 136, 0.45)' },
  { key: 'amber', from: '#fbbf24', to: '#f97316', glow: 'rgba(249, 115, 22, 0.45)' },
  { key: 'emerald', from: '#34d399', to: '#10b981', glow: 'rgba(16, 185, 129, 0.45)' },
  { key: 'rose', from: '#ff7a59', to: '#ef3b6e', glow: 'rgba(239, 59, 110, 0.45)' },
  { key: 'slate', from: '#94a3b8', to: '#64748b', glow: 'rgba(100, 116, 139, 0.45)' },
] as const;

export type ChartSeriesKey = (typeof chartSeries)[number]['key'];

/** `chartSeries` as a lookup, for the call sites that name a hue rather than index. */
export const chartSeriesByKey = Object.fromEntries(
  chartSeries.map((s) => [s.key, s]),
) as Record<ChartSeriesKey, (typeof chartSeries)[number]>;

/** A ready-to-use CSS gradient for series `i`, wrapping around the ramp. */
export function seriesGradient(i: number, angle = '140deg'): string {
  const s = chartSeries[((i % chartSeries.length) + chartSeries.length) % chartSeries.length];
  return `linear-gradient(${angle},${s.from},${s.to})`;
}

/**
 * The ageing ramp — the one ORDERED sequence here.
 *
 * Unlike the tile ramp this is not categorical: the steps mean "getting worse",
 * so they must read as one hue darkening rather than as four unrelated colours.
 * It stops short of brand red on purpose — an ageing bucket is a measurement,
 * and letting it borrow the action colour would put brand red on a chart axis
 * where nothing is being asked of the reader.
 */
export const severityRamp = ['#f59e0b', '#ea8a1e', '#e11d48', '#9f1239'] as const;

/**
 * Third-party brand marks. Fixed by their owners; a rebrand must not touch them.
 * Kept as a map rather than inline so a mark that changes (they do) changes once.
 */
export const vendor = {
  facebook: '#1877F2',
  instagram: '#E1306C',
  linkedin: '#0A66C2',
  whatsapp: '#25D366',
  youtube: '#FF0000',
  playStore: '#2778c4',
  playStorePressed: '#1f64a8',
} as const;
