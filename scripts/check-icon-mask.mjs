#!/usr/bin/env node
/**
 * The vendored icons must satisfy the platform that masks them.
 *
 * The technician app shipped a splash that flashed a cropped logo before the
 * whole one, and the cause was not the platform: Android has masked its splash
 * icon since API 31 and does so on every release since (the report came from
 * Android 15). The cause was an ASSET SWAP. The previous file was a
 * self-contained icon tile whose brand marks sat 54px inside the mask; its
 * replacement was a bare lockup that reached 96px past it. Nothing checked,
 * because nothing had ever needed to — the old asset satisfied the constraint
 * by accident of being a tile.
 *
 * This repo takes its icons from the same kit and can be swapped the same way.
 *
 * ── WHY THIS DOES NOT GATE ON CLIPPING, THOUGH IT REPORTS IT ───────────
 * The obvious check — "how much content does the mask remove" — was built,
 * measured, and rejected, because on THIS icon set it discriminates nothing:
 *
 *   shipped tile   180x180   max squircle reach 1.945   clips 5.9% of content
 *   bare lockup   1024x1161  max squircle reach 1.991   clips 4.0% of content
 *   mark only     1024x897   max squircle reach 1.149   clips 0%
 *
 * The kit's icons carry a full-bleed BAND across the lower quarter (measured:
 * rows 133-179 of 180, spanning the full width), so the shipped icon already
 * runs corner to corner ON PURPOSE — and by ratio it clips MORE than the bad
 * lockup would, because the ratio is over a much smaller content area. Both
 * numbers are arbitrary as thresholds. A gate that cannot separate the correct
 * asset from the broken one is worse than no gate: it reads as coverage.
 *
 * ── WHAT IS CHECKED INSTEAD: the platform's own hard requirements ───────
 * These are not thresholds anybody chose, and each one independently rejects a
 * lockup dropped in where a tile belongs:
 *
 *   OPAQUE   iOS composites a transparent home-screen icon onto BLACK, so a
 *            transparent icon ships a black-cornered badge. The shipped tile is
 *            100% opaque; the lockup is 61% transparent.
 *   SQUARE   every icon slot is square; the lockup is 1024x1161.
 *   SIZE     apple-touch-icon is 180x180 and each favicon is its named size,
 *            so a swap cannot silently halve the resolution.
 *
 *   node scripts/check-icon-mask.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from './lib/png-ink.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Apple's icon superellipse. 5 is the middle of the commonly cited 4-6. */
const SQUIRCLE_N = 5;
/** Anti-aliased edge pixels are not content. */
const ALPHA_FLOOR = 40;
/** Manhattan RGB distance at which a pixel stops being the plate. */
const PLATE_TOLERANCE = 90;
/** iOS composites anything below this onto black. */
const OPACITY_FLOOR_PCT = 99.5;

/**
 * Every icon this app vendors, with what the platform requires of it.
 * `masked` only decides whether clipping is REPORTED — it is never gated.
 */
const ICONS = [
  { file: 'public/apple-touch-icon.png', size: 180, opaque: true, masked: 'ios-squircle', why: 'iOS home screen' },
  { file: 'public/favicon-64.png', size: 64, opaque: false, masked: null, why: 'browser tab' },
  { file: 'public/favicon-48.png', size: 48, opaque: false, masked: null, why: 'browser tab' },
  { file: 'public/favicon-32.png', size: 32, opaque: false, masked: null, why: 'browser tab' },
  { file: 'public/favicon-16.png', size: 16, opaque: false, masked: null, why: 'browser tab' },
];

const inSquircle = (x, y, w, h) =>
  Math.abs((2 * x - w) / w) ** SQUIRCLE_N + Math.abs((2 * y - h) / h) ** SQUIRCLE_N <= 1;

function measure(file, masked) {
  const { width, height, channels, data } = decodePng(file);
  const at = (x, y) => {
    const i = (y * width + x) * channels;
    switch (channels) {
      case 1: return [data[i], data[i], data[i], 255];
      case 2: return [data[i], data[i], data[i], data[i + 1]];
      case 3: return [data[i], data[i + 1], data[i + 2], 255];
      default: return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    }
  };
  const plate = at(0, 0);
  const isContent = (p) => p[3] >= ALPHA_FLOOR
    && (plate[3] < ALPHA_FLOOR
      || Math.abs(p[0] - plate[0]) + Math.abs(p[1] - plate[1]) + Math.abs(p[2] - plate[2]) >= PLATE_TOLERANCE);

  let opaque = 0;
  let content = 0;
  let clipped = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = at(x, y);
      if (p[3] >= 250) opaque += 1;
      if (!isContent(p)) continue;
      content += 1;
      if (masked === 'ios-squircle' && !inSquircle(x + 0.5, y + 0.5, width, height)) clipped += 1;
    }
  }
  return {
    width,
    height,
    opaquePct: (opaque / (width * height)) * 100,
    content,
    clippedPct: content ? (clipped / content) * 100 : 0,
  };
}

const failures = [];

for (const icon of ICONS) {
  const full = path.join(ROOT, icon.file);
  if (!fs.existsSync(full)) {
    failures.push(`${icon.file}: missing — layout.tsx and the browser both ask for it.`);
    continue;
  }
  const m = measure(full, icon.masked);
  const bits = [`${m.width}x${m.height}`, `${m.opaquePct.toFixed(1)}% opaque`];
  if (icon.masked) bits.push(`squircle removes ${m.clippedPct.toFixed(2)}% of its content (reported, not gated)`);
  console.log(`${icon.file} (${icon.why}): ${bits.join(' · ')}`);

  if (m.width !== m.height) {
    failures.push(
      `${icon.file}: ${m.width}x${m.height} is not square. Every icon slot is square, so the `
      + `platform will letterbox or stretch it. A lockup was probably dropped in where a tile belongs.`,
    );
  } else if (m.width !== icon.size) {
    failures.push(
      `${icon.file}: ${m.width}x${m.width}, expected ${icon.size}x${icon.size}. The name promises a `
      + `size and the markup requests it; a different one is silently rescaled by the browser.`,
    );
  }
  if (icon.opaque && m.opaquePct < OPACITY_FLOOR_PCT) {
    failures.push(
      `${icon.file}: only ${m.opaquePct.toFixed(1)}% opaque. iOS composites a transparent home-screen `
      + `icon onto BLACK, so this would ship a black-cornered badge. Use the kit's opaque tile — a bare `
      + `lockup on transparency is not an app icon.`,
    );
  }
}

assert.deepEqual(failures, [], `\n${failures.join('\n\n')}\n`);
console.log(`\nicon mask: ${ICONS.length} vendored icon(s) meet their platform's requirements`);
