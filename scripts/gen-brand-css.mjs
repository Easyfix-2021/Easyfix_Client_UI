/**
 * Generate src/styles/brand-tokens.css from src/brand/tokens.ts.
 *
 * WHY A GENERATOR AND NOT HAND-WRITTEN CSS
 *
 * The brand identity is authored in hex — that is how the identity document
 * states it, how the CRM's palette states it, and how a designer reads it. But
 * Tailwind's alpha modifiers (`bg-primary/10`, `ring-primary/20`) can only be
 * rewritten against SPACE-SEPARATED CHANNELS. A custom property holding a
 * finished hex compiles to a colour with no alpha slot, and every tint in the
 * app silently renders at full strength — a bug that shipped here once.
 *
 * The hand-written version of this file therefore carried each colour TWICE,
 * once as a hex and once as a triple, with a comment asking humans to keep
 * them in sync. This script is that comment, enforced: one hex in palette.ts,
 * both forms derived.
 *
 *   npm run brand:gen      write src/styles/brand-tokens.css
 *   npm run brand:verify   regenerate in memory and diff — fails on drift
 *
 * The output IS committed. A build step that must run before the CSS is valid
 * would break `next dev` for anyone who forgot it.
 *
 * Ported from Easyfix_CRM_UI/scripts/gen-brand-css.mjs. That app emits HSL
 * triplets because its Tailwind consumes `hsl(var(--token))`; this one emits
 * hex + RGB channels because its Tailwind consumes
 * `rgb(var(--token-rgb) / <alpha-value>)`. Same mechanism, different target.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(root, 'src/styles/brand-tokens.css');

/*
 * palette.ts and tokens.ts are TypeScript, and this script is plain Node with
 * no build step, so the values are lifted by evaluating the two modules'
 * object literals rather than importing them. Narrow and deliberate: it reads
 * the named `const` and would rather throw than guess.
 */
function evalModuleObject(file, name, scope = {}) {
  const src = readFileSync(join(root, file), 'utf8');
  const start = src.indexOf(`const ${name}`);
  if (start === -1) throw new Error(`${name} not found in ${file}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`unbalanced braces reading ${name} from ${file}`);
  const body = src.slice(open, end + 1)
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  /*
   * `p` and `c` are tokens.ts's aliases for its two imports from palette.ts —
   * the shared `palette` and the portal-only `chrome`. Bound explicitly by name
   * rather than resolved through a module graph, so this script needs no build
   * step. A new import in tokens.ts must be added here too, or the eval throws
   * a ReferenceError naming the alias — which is the intended failure: silent
   * omission of a token would be far worse.
   */
  const names = Object.keys(scope);
  return Function(...names, `"use strict"; return (${body});`)(...names.map((n) => scope[n]));
}

const paletteObj = evalModuleObject('src/brand/palette.ts', 'palette');
const chromeObj = evalModuleObject('src/brand/palette.ts', 'chrome');
const tokensObj = evalModuleObject('src/brand/tokens.ts', 'tokens', { p: paletteObj, c: chromeObj });

/** '#C42430' → '196 36 48'. Exact — no rounding, no colour-space conversion. */
function hexToChannels(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`not a 6-digit hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

const lines = [];
lines.push('/*');
lines.push(' * GENERATED FILE — do not edit.');
lines.push(' *');
lines.push(' * Source: src/brand/tokens.ts (semantic map) over src/brand/palette.ts');
lines.push(' * (the brand primitives). Regenerate with `npm run brand:gen`;');
lines.push(' * `npm run brand:verify` fails if this file has drifted from its source.');
lines.push(' *');
lines.push(' * Each token emits two properties:');
lines.push(' *   --ef-<name>       the hex — for direct CSS and inline SVG fills');
lines.push(' *   --ef-<name>-rgb   channels — for Tailwind alpha modifiers, which');
lines.push(' *                     cannot be rewritten against a finished hex');
lines.push(' *');
lines.push(' * SINGLE THEME BY DESIGN: dark masthead and footer, white working');
lines.push(' * surface. Not a light-mode variant — see src/brand/tokens.ts.');
lines.push(' *');
lines.push(' * Deliberately NOT wrapped in @layer base: an @import gives this file its');
lines.push(' * own PostCSS scope, where `@layer base` has no matching `@tailwind base`');
lines.push(' * and the build fails outright. Custom-property declarations need no');
lines.push(' * layering — they are definitions, not rules competing on specificity.');
lines.push(' */');
lines.push(':root {');
lines.push('  color-scheme: light;');
for (const [name, hex] of Object.entries(tokensObj)) {
  lines.push(`  --ef-${name}: ${hex};`);
  lines.push(`  --ef-${name}-rgb: ${hexToChannels(hex)};`);
}
lines.push('}');
lines.push('');
lines.push('/*');
lines.push(' * The chrome carries dark UA affordances (scrollbars, form controls) while');
lines.push(' * the page as a whole stays light. Without this a sidebar scrollbar renders');
lines.push(' * as a light pill on near-black.');
lines.push(' */');
lines.push('.ef-chrome {');
lines.push('  color-scheme: dark;');
lines.push('  background: var(--ef-chrome-bg);');
lines.push('  color: var(--ef-chrome-fg);');
lines.push('}');
lines.push('');
/*
 * Alpha-derived chrome values. These are rgba() of white rather than palette
 * entries, because "a hover state slightly lighter than the ground" is a
 * relationship, not a colour — hard-coding a hex for it would break the moment
 * the chrome ground changes.
 */
lines.push('/* Alpha-derived, not palette entries — see the generator. */');
lines.push(':root {');
lines.push('  --ef-chrome-fg-3: rgba(255, 255, 255, 0.34);');
lines.push('  --ef-chrome-hover: rgba(255, 255, 255, 0.07);');
lines.push('  --ef-chrome-sunk: rgba(255, 255, 255, 0.10);');
lines.push('  --ef-chrome-edge: rgba(255, 255, 255, 0.16);');
lines.push('}');
lines.push('');

const css = lines.join('\n');

if (process.argv.includes('--verify')) {
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch { /* missing counts as drift */ }
  if (current !== css) {
    console.error('✗ brand-tokens.css has drifted from src/brand/tokens.ts — run `npm run brand:gen`');
    process.exit(1);
  }
  console.log('brand-tokens.css matches its source');
} else {
  writeFileSync(OUT, css);
  console.log(`✓ wrote ${Object.keys(tokensObj).length} tokens to src/styles/brand-tokens.css`);
}
