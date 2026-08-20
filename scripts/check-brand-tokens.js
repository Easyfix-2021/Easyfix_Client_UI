/**
 * Brand-token guard for the client dashboard.
 *
 * THIS USED TO BE A RATCHET. IT IS NOW AN ASSERTION.
 *
 * When this script landed, the app carried 122 hex literals and 1,510 raw
 * Tailwind palette classes (`text-slate-500`, `bg-red-50`, …) across 28 screens —
 * the dashboard alone accounted for 303. Turning a strict check on that day
 * would have failed the build on the first run and forced a 1,600-site rewrite
 * bundled into an unrelated change, so the check would simply have been deleted
 * and the codebase would have gained nothing.
 *
 * So it ratcheted: the counts were recorded as a baseline and the check failed
 * only when a number went UP. Its own header set the exit condition — "when both
 * reach zero, delete the baseline and make this a plain assertion." Both reached
 * zero. The baseline is gone, and this app now carries the same guarantee
 * Easyfix_CRM_UI does: colour literals live in src/brand/palette.ts and nowhere
 * else, and every colour in a component is a semantic token.
 *
 * DO NOT REINTRODUCE A BASELINE. A ratchet is scaffolding for paying off debt
 * that already exists; adding one back would mean re-admitting the debt this
 * sweep just cleared. If a change cannot be expressed in tokens, the answer is
 * either a new token in src/brand/tokens.ts or an entry in src/brand/charts.ts —
 * both of which are one file and reviewable — never a raised number here.
 *
 * WHAT IS SCANNED
 *   src/**\/*.ts, *.tsx  — every component, page, hook and lib module
 *   src/**\/*.css        — hand-written CSS, including `@apply` lines
 *
 * FOUR MORE RULES, ADOPTED FROM Easyfix_CRM_UI
 *
 *   OPAQUE bg-white      A surface that names a colour instead of a role.
 *                        `bg-surface` says what the element IS; `bg-white` says
 *                        what the palette currently happens to be. NOTE the CRM
 *                        forbids this for a different reason — it has a dark
 *                        theme and an opaque white card cannot follow it. This
 *                        app is single-theme BY DESIGN (see tokens.ts), so that
 *                        rationale does not port; the rebrand-seam one does.
 *                        `bg-white/N` is NOT flagged and must never be: white at
 *                        alpha over a coloured ground is the frost pattern, and
 *                        it is correct. A line carrying BOTH forms
 *                        (`bg-white/90 hover:bg-white`) is a frost element
 *                        intensifying on interaction — flagging its opaque half
 *                        would push someone to convert it alone and flip the
 *                        control mid-hover.
 *
 *   WEIGHT > 600         The brand type scale stops at semibold. Matched in BOTH
 *                        the class form (`font-bold`) and the property form —
 *                        and the property matcher accepts `:` OR `=`, because
 *                        the CRM's `fontWeight\s*:\s*` misses the SVG ATTRIBUTE
 *                        form `fontWeight="700"`, which this app really uses.
 *
 *   12px TYPE FLOOR      Arbitrary sizes below the legibility floor. Tailwind's
 *                        own `text-xs` IS 12px, so the fix is almost always to
 *                        drop the arbitrary value entirely.
 *
 *   ONE LOGO OWNER       A logo asset path may appear only in
 *                        src/components/brand/logo.tsx. Everywhere else imports
 *                        <Logo>, so swapping the mark stays a one-file change and
 *                        no page can pin a stale file.
 *
 * THE ALLOWLIST (three files, each for one specific reason)
 *   src/brand/palette.ts         — the rebrand seam. The literals ARE the point.
 *   src/styles/brand-tokens.css  — GENERATED from tokens.ts by `npm run brand:gen`
 *                                  and verified against it by `npm run brand:verify`.
 *   src/brand/charts.ts          — categorical decoration and third-party marks.
 *                                  Exempt from the COLOUR-LITERAL rules only; the
 *                                  raw-palette-class rule still applies to it.
 *                                  See that file's header for the test that
 *                                  decides what may go in it.
 *
 * Comments are stripped before matching, so a doc comment may cite a hex to
 * record a measurement (a contrast ratio, say) without tripping the guard.
 *
 * Pure node — no dependencies.
 *
 *   npm run check:brand
 */

'use strict';

const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative } = require('node:path');

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

const SEAM = join('src', 'brand', 'palette.ts');
const GENERATED = join('src', 'styles', 'brand-tokens.css');
const DECORATION = join('src', 'brand', 'charts.ts');

/** Exempt from the colour-LITERAL rules. Every other rule still applies. */
const LITERAL_EXEMPT = new Set([SEAM, GENERATED, DECORATION]);

const HEX = /#[0-9A-Fa-f]{6}\b/g;

/*
 * A colour built at the call site. `rgb(var(--ef-x-rgb) / 0.5)` is EXEMPT and
 * must stay so: that is not a literal, it is how a token is consumed at the CSS
 * layer — brand-tokens.css emits channel triplets precisely so this works.
 * Flagging it would push a sweep to "fix" the one pattern the token system
 * depends on.
 */
const COLOUR_FUNC = /\b(?:rgba?|hsla?)\s*\((?!\s*var\()/g;

/*
 * Raw Tailwind palette scales — the big one. A `bg-slate-100` is exactly as
 * hard-coded a colour as `#f1f5f9` is; it just doesn't look like one, which is
 * why 1,510 of them accumulated. Tailwind's slate is a BLUE grey and the brand's
 * ink ramp is cool-but-warmer; every raw class is a colour the rebrand seam
 * cannot reach.
 *
 * The brand ramp names (primary / ink / chrome / success / warning / danger /
 * info / gold / money / link) are deliberately absent — those ARE the tokens.
 */
const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|divide|placeholder|shadow|outline|decoration|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

/**
 * Opaque only — the negative lookahead spares `bg-white/70` and friends.
 *
 * DELIBERATELY NOT /g, and that is not a style choice. Unlike every other
 * pattern here, this one is consumed with `.test()` PER LINE rather than with
 * `String.match()` over the whole file. A /g regex carries a mutable `lastIndex`
 * that `.test()` ADVANCES and never resets, and the regex object is shared
 * across every line and every file in the walk — so matches silently alternate
 * hit, miss, hit, miss. Measured on four identical violating lines, the /g
 * version reported TWO. Worse, a file whose single violating line is tested
 * while lastIndex is stale reports ZERO, so the rule emits a false CLEAN.
 *
 * `String.match()` is immune (it resets lastIndex itself), which is why the
 * other patterns keep /g, and `matchAll` is immune (it clones the regex), which
 * is why TEXT_SIZE keeps it. Only a `.test()` consumer must be non-global.
 * The assertion below makes that invariant executable rather than a comment
 * somebody has to happen to read.
 */
const OPAQUE_WHITE = /\bbg-white\b(?!\/)/;
/** A line that ALSO carries an alpha form is frost; see the header. */
const FROST_PAIR = /bg-white\//;

/*
 * Weight above 600, in every form this codebase can express it.
 *
 * The CRM's version matches `fontWeight\s*:\s*700` and stops, which leaves three
 * ways through that no code review would notice:
 *   - the JSX ATTRIBUTE form `fontWeight="700"` — real, in the dashboard's SVG;
 *   - the arbitrary class `font-[700]`;
 *   - a TERNARY, `fontWeight={cond ? 700 : 400}`, where the number never
 *     follows the brace directly.
 * The last is not hypothetical: performance/page.tsx already writes
 * `fontWeight={last ? 600 : 400}` — legal today, and one character from being an
 * unguarded 700 that the guard would wave through.
 *
 * So the property form is matched in TWO steps: take the whole expression up to
 * the next delimiter, then look inside it for a forbidden weight. `\bbold\b`
 * cannot match `semibold` (no word boundary between `i` and `b`), which is why
 * the ALLOWED `font-semibold` never trips it.
 */
const WEIGHT_CLASS = /\bfont-(?:bold|extrabold|black)\b/g;
const WEIGHT_ARBITRARY = /\bfont-\[(\d{2,3})\]/g;
/*
 * The span must be the VALUE EXPRESSION and nothing more. A looser "everything
 * up to the next delimiter" version read
 * `fontWeight="600" fontSize="22" fill="var(--ef-ink-900)"` as a violation,
 * because `ink-900` contains `900` between two non-word characters. Matching a
 * quoted string, a braced expression or a bare token — and stopping there —
 * keeps the ternary case working without swallowing the neighbouring attributes.
 */
const WEIGHT_PROP_SPAN = /\bfontWeight\s*[:=]\s*(?:\{[^}]*\}|"[^"]*"|'[^']*'|[A-Za-z0-9_.]+)/g;
const WEIGHT_FORBIDDEN = /\b(?:700|800|900)\b|\bbold\b/;
const MAX_WEIGHT = 600;

/*
 * Arbitrary type sizes against the legibility floor — in the class form AND as
 * an SVG/inline `fontSize`, which no class can express.
 *
 * The technician app's guard already checks `fontSize`; the CRM's does not, and
 * this app has three real sub-floor chart labels that ONLY the fontSize form
 * finds — including the donut's "TOTAL ORDERS" caption, which is plain UI copy
 * rather than a chart tick. Adopting a floor that a `<text>` element can walk
 * straight through is not adopting a floor.
 *
 * Units are normalised so `text-[0.5rem]` cannot slip past a px-only pattern.
 */
const TEXT_SIZE = /text-\[([\d.]+)(px|rem|em|pt)\]/g;
const FONT_SIZE_PROP = /\bfontSize\s*[:=]\s*\{?\s*["']?([\d.]+)/g;
const UNIT_PX = { px: 1, rem: 16, em: 16, pt: 96 / 72 };
const TYPE_FLOOR_PX = 12;

/** A logo asset wired up outside the shared <Logo> component. */
const LOGO_IMAGE = /<Image[^>]*src=["']\/logo/g;
const LOGO_OWNER = join('src', 'components', 'brand', 'logo.tsx');

/*
 * This file's own header says a guard that under-reports is worse than no
 * guard. That applies to the guard itself, so prove the property rather than
 * asserting it in prose: any pattern used with `.test()` must be non-global.
 */
for (const [name, re] of [['OPAQUE_WHITE', OPAQUE_WHITE], ['FROST_PAIR', FROST_PAIR], ['WEIGHT_FORBIDDEN', WEIGHT_FORBIDDEN]]) {
  if (re.global) {
    throw new Error(
      `${name} is consumed with .test() per line and MUST NOT be /g — a global `
      + 'regex advances lastIndex between calls, so the rule would under-report.',
    );
  }
}

/**
 * Strip comments so documentation examples don't trip the regexes.
 *
 * ORDER MATTERS, and only one order is correct for JS/TS: line comments FIRST.
 * A line comment may legitimately contain `/*`. Strip block comments first and
 * that stray opener swallows everything to the next close — potentially hundreds
 * of lines of real code, whose violations then silently vanish. A guard that
 * under-reports is worse than no guard.
 *
 * The `(^|[^:])` guard keeps `https://…` intact. CSS has no `//` comment form,
 * so for .css input only block comments are stripped.
 */
function stripComments(src, { css = false } = {}) {
  if (css) return src.replace(/\/\*[\s\S]*?\*\//g, '');
  return src
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const KINDS = {
  HEX: 'colour literal (hex)',
  FUNC: 'colour literal (rgb/hsl)',
  PALETTE: 'raw Tailwind palette class',
  WHITE: 'opaque bg-white (use bg-surface)',
  WEIGHT: 'font weight above 600',
  FLOOR: `type below the ${TYPE_FLOOR_PX}px floor`,
  LOGO: 'logo <Image> outside logo.tsx',
};

const findings = [];

for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const css = file.endsWith('.css');
  const src = stripComments(readFileSync(file, 'utf8'), { css });
  const literalExempt = LITERAL_EXEMPT.has(rel);

  const count = (re) => (src.match(re) || []).length;

  if (!literalExempt) {
    const hex = count(HEX);
    const func = count(COLOUR_FUNC);
    if (hex) findings.push({ rel, kind: KINDS.HEX, n: hex });
    if (func) findings.push({ rel, kind: KINDS.FUNC, n: func });
  }
  const cls = count(PALETTE_CLASS);
  if (cls) findings.push({ rel, kind: KINDS.PALETTE, n: cls });

  /*
   * bg-white is judged PER LINE, not per file: a frost element intensifying on
   * hover writes both forms on one line, and only that pairing is exempt. A
   * plain `bg-white` elsewhere in the same file is still a violation.
   */
  const white = src
    .split(/\r?\n/)
    .filter((l) => OPAQUE_WHITE.test(l) && !FROST_PAIR.test(l))
    .length;
  if (white) findings.push({ rel, kind: KINDS.WHITE, n: white });

  const weight = count(WEIGHT_CLASS)
    + [...src.matchAll(WEIGHT_ARBITRARY)].filter((m) => Number(m[1]) > MAX_WEIGHT).length
    + [...src.matchAll(WEIGHT_PROP_SPAN)].filter((m) => WEIGHT_FORBIDDEN.test(m[0])).length;
  if (weight) findings.push({ rel, kind: KINDS.WEIGHT, n: weight });

  const floor = [...src.matchAll(TEXT_SIZE)]
    .filter((m) => Number(m[1]) * UNIT_PX[m[2]] < TYPE_FLOOR_PX).length
    + [...src.matchAll(FONT_SIZE_PROP)]
      .filter((m) => Number(m[1]) < TYPE_FLOOR_PX).length;
  if (floor) findings.push({ rel, kind: KINDS.FLOOR, n: floor });

  if (rel !== LOGO_OWNER) {
    const logo = count(LOGO_IMAGE);
    if (logo) findings.push({ rel, kind: KINDS.LOGO, n: logo });
  }
}

if (findings.length === 0) {
  console.log(
  '✓ brand system OK — tokens only, no colour literals outside the seam,'
  + `\n  surfaces named by role, weights ≤600, type ≥${TYPE_FLOOR_PX}px, one logo owner`,
);
  process.exit(0);
}

const byKind = new Map();
const byFile = new Map();
for (const f of findings) {
  byKind.set(f.kind, (byKind.get(f.kind) || 0) + f.n);
  byFile.set(f.rel, (byFile.get(f.rel) || 0) + f.n);
}
const total = [...byKind.values()].reduce((a, b) => a + b, 0);

console.error(`✗ ${total} brand violation(s), in ${byFile.size} file(s).\n`);
console.error('By rule:');
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.error(`  ${String(n).padStart(4)}  ${kind}`);
}
console.error('\nBy file:');
for (const [rel, n] of [...byFile].sort((a, b) => b[1] - a[1])) {
  console.error(`  ${String(n).padStart(4)}  ${rel}`);
}
console.error(
  '\nUse the semantic tokens in src/brand/tokens.ts (Tailwind: primary / ink-* /'
  + '\nchrome-* / success / warning / danger / info / gold / money / link). Colour'
  + '\nliterals belong in src/brand/palette.ts and nowhere else; categorical'
  + '\ndecoration and third-party marks belong in src/brand/charts.ts.'
  + '\n\nFor alpha, use a Tailwind modifier (bg-primary/10) or the channel form'
  + '\nrgb(var(--ef-ink-900-rgb) / 0.12) — NOT rgba(var(--ef-ink-900-rgb), 0.12),'
  + '\nwhich is invalid CSS and silently drops the whole declaration.'
  + '\n\nOpaque bg-white → bg-surface (bg-white/N frost is fine). Weights above 600'
  + `\n→ font-semibold. Type below ${TYPE_FLOOR_PX}px → text-xs (which IS ${TYPE_FLOOR_PX}px).`
  + '\nA logo asset path belongs only in src/components/brand/logo.tsx.\n',
);
process.exit(1);
