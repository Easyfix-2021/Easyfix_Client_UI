/**
 * EasyFix brand palette — the ONLY module in the client dashboard allowed to
 * hold colour literals.
 *
 * Every value is a canonical primitive from the EasyFix Brand Identity
 * ("EasyFix — Brand Identity.html"):
 *   "Red is action. Ink is text. Blue is money and grade. Gold is earned."
 *
 * Components never read these directly — they consume tokens, which reach them
 * as CSS custom properties generated from `tokens.ts` into
 * `src/styles/brand-tokens.css` by `npm run brand:gen`.
 *
 * THIS FILE IS THE REBRAND SEAM. Changing the identity means editing these
 * values and re-running the generator — not touching components.
 *
 * KEYS MATCH Easyfix_CRM_UI/src/brand/palette.ts EXACTLY, and that app's keys
 * in turn match the technician app's, so all three surfaces stay diffable
 * line-for-line. Do NOT add a colour that is not on the brand page, and do NOT
 * invent a second error palette — urgent/error reuse red600 / red100 / red700.
 * A value this portal needs that the other two do not goes in a SEPARATE
 * export below, never into `palette` — that is what keeps the three diffable.
 *
 * WHY THIS FILE REPLACED A HAND-WRITTEN CSS FILE. brand-tokens.css previously
 * carried each colour TWICE — once as a hex and once as a space-separated RGB
 * triple, because Tailwind's alpha modifiers need channels. Two hand-kept
 * copies of the same value is a drift waiting to happen; the generator now
 * derives the triple from the hex, so there is one number per colour.
 */

export const palette = {
  // ── Red — action ─────────────────────────────────────────────────────────
  red50: '#FBF0F1', // soft wash
  red100: '#F6DEE0', // status/action tint (also urgent/error tint)
  red500: '#C42430', // header, primary action, active tab, logo
  red600: '#A71F29', // pressed action · urgent · error
  red700: '#831820', // red text on red tint

  // ── Ink — text & neutral surfaces ────────────────────────────────────────
  ink900: '#171B1F', // headings, dark surfaces (the portal's masthead ground)
  ink700: '#363B41', // body text, elevated dark surfaces
  ink500: '#5C636B', // supporting text, labels
  ink300: '#9AA1A9', // placeholder, disabled
  ink100: '#E4E7EA', // borders, dividers
  ink50: '#F4F6F7', // light page background
  white: '#FFFFFF', // cards, inverse text

  // ── Blue — money & grade / information ───────────────────────────────────
  blue100: '#E4EFFA', // information tint
  blue500: '#2A6FBF', // links, information icons
  blue700: '#1B4C87', // blue text on blue tint
  blue900: '#10294D', // wallet and grade blocks

  // ── Meaning ──────────────────────────────────────────────────────────────
  success: '#1B9E5A',
  successTint: '#E2F5EA',
  successText: '#0E5C34',
  warning: '#E0930F',
  warningTint: '#FCF0D9',
  warningText: '#6B4405',

  // ── Gold — earned grade & rewards ONLY (never on red, never a large fill) ─
  gold: '#C99A2E',
  goldTint: '#FBF1D8',
  goldText: '#6B4A05',
} as const;

/**
 * Two masthead values the ink ramp cannot supply.
 *
 * They live HERE rather than in tokens.ts because a hex in tokens.ts is still a
 * hex outside the rebrand seam — the seam is this file, and a colour the seam
 * cannot reach is a colour a rebrand will miss. They are kept OUT of `palette`
 * for the same reason the CRM keeps `tricolour` out of its own: `palette` is
 * the line-for-line-diffable set shared with the CRM and the technician app,
 * and these two are portal chrome, not brand primitives.
 *
 * CONTRAST, MEASURED against ink900 (#171B1F), which is the chrome ground:
 *   redFg  5.91:1  → the one red light enough to READ as copy on the masthead;
 *                    red500 manages 3.00:1, legal for a shape and never text.
 *   line           → ink900 lifted just enough to separate nav sections.
 */
export const chrome = {
  line: '#2A3138',
  redFg: '#E8737C',
} as const;

export type PaletteColor = keyof typeof palette;
