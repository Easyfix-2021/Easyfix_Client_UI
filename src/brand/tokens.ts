/**
 * Semantic tokens — the names components and tailwind.config.ts actually use.
 *
 * palette.ts holds WHAT the colours are; this file holds WHAT THEY MEAN. A
 * component asking for `--ef-chrome-bg` should not need to know that the
 * masthead happens to be ink-900, and a rebrand that moves the masthead to a
 * different ink must not require touching a component.
 *
 * Generated into src/styles/brand-tokens.css by `npm run brand:gen`.
 * `npm run brand:verify` regenerates in memory and fails on drift.
 *
 * EVERY ENTRY EMITS TWO CUSTOM PROPERTIES:
 *   --ef-<name>       the hex, for direct use in CSS and inline SVG fills
 *   --ef-<name>-rgb   space-separated channels, for Tailwind's alpha modifiers
 *
 * The second form is not decoration. Tailwind rewrites `<alpha-value>` at build
 * time, and it can only do that against channels — a finished `var(--x)`
 * holding a hex compiles to a colour with NO alpha slot, so every
 * `bg-primary/10` in the app silently renders at full strength. That bug
 * shipped once already; the generator exists so the two forms can never
 * disagree.
 *
 * SINGLE THEME BY DESIGN. The masthead and footer are dark, the working
 * surface is white, and that is the design rather than a light-mode variant of
 * it — an operations console people read tables and job photos on all day must
 * not change with an OS setting. So there is one map here, not a light/dark
 * pair. See src/app/(authed)/layout.tsx.
 */
import { chrome as c, palette as p } from './palette';

export const tokens = {
  // ── Red — the action. Active tab, primary button, logo. Nothing else. ────
  'red-50': p.red50,
  'red-100': p.red100,
  'red-500': p.red500,
  'red-600': p.red600,
  'red-700': p.red700,

  // ── Ink — the text. Cool-biased, deliberately not a neutral grey. ────────
  'ink-900': p.ink900,
  'ink-700': p.ink700,
  'ink-500': p.ink500,
  'ink-300': p.ink300,
  'ink-100': p.ink100,
  'ink-50': p.ink50,
  white: p.white,

  // ── Blue — money and grade. ─────────────────────────────────────────────
  'blue-100': p.blue100,
  'blue-500': p.blue500,
  'blue-700': p.blue700,
  'blue-900': p.blue900,

  // ── Meaning colours. State only, never identity. ────────────────────────
  success: p.success,
  'success-tint': p.successTint,
  'success-text': p.successText,
  warning: p.warning,
  'warning-tint': p.warningTint,
  'warning-text': p.warningText,
  gold: p.gold,
  'gold-tint': p.goldTint,
  'gold-text': p.goldText,

  /*
   * ── Nav chrome ──────────────────────────────────────────────────────────
   * The masthead and footer are dark ink; the working surface stays white.
   *
   * CONTRAST, MEASURED against --ef-chrome-bg (ink-900):
   *   white     17.31:1  → body copy, active nav label
   *   ink-300    6.63:1  → inactive nav label, secondary text
   *   ink-500    2.85:1  → FAILS for copy. Never put text in it on chrome.
   *   red-500    3.00:1  → legal for a SHAPE (rule, dot, filled badge), never
   *                        for copy. The brand kit says the same: "fine for a
   *                        mark read as a shape, never for copy."
   *
   * So the active nav item is WHITE TEXT with a RED RULE, and a count badge is
   * a FILLED red pill with white copy (5.77:1 the other way round). For red as
   * TEXT on chrome, use chrome-red-fg (5.91:1) — which is the one value here
   * that is not a straight palette alias, because the palette has no red light
   * enough to read on ink-900.
   */
  'chrome-bg': p.ink900,
  'chrome-line': c.line,
  'chrome-fg': p.white,
  'chrome-fg-2': p.ink300,
  'chrome-red': p.red500,
  'chrome-red-fg': c.redFg,
} as const;

export type BrandToken = keyof typeof tokens;
