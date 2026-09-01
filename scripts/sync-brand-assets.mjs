/**
 * Re-vendor the brand assets this app actually uses, from the EasyFix Brand Kit.
 *
 *   npm run brand:sync           copy from the kit into public/
 *   npm run brand:sync -- --check verify the vendored copies match the kit
 *
 * WHY THE ASSETS ARE VENDORED AT ALL
 *
 * The kit lives OUTSIDE this repo (~/Documents/GitHub/EasyFix-Brand-Kit) and is
 * not a git repo, so it can be neither a submodule nor an npm git dependency.
 * The Dockerfile builds with `COPY . .` from the repo root, so anything outside
 * this directory is not in the build context: a symlink or a relative path
 * resolves fine on a laptop and produces a 404 in the production image.
 *
 * WHY ONLY WHAT IS USED
 *
 * The kit ships 40 SVGs per surface. Copying the directory leaves files nobody
 * can tell are unused and a future reader has to assume are load-bearing. The
 * lists below ARE the contract — reference a new variant, add it here and
 * re-run, rather than copying the directory again.
 *
 * ⚠ THE RED COLOURWAY. This portal's tab icon is the red inverse, so the web
 * assets come from the kit's `*-red` files and are vendored under the plain
 * names the HTML asks for. Take the defaults and every browser that prefers a
 * PNG over the SVG shows a WHITE tile beside a red icon.svg. See kit §7.2.
 *
 * `--check` exists so CI can catch a vendored asset that was hand-edited or
 * left behind when the kit was regenerated.
 *
 * ⚠ AND IT USED TO PASS WHEN IT COULD NOT CHECK ANYTHING.
 *
 * The kit is absent in CI — that is the whole reason these files are vendored
 * — and `--check` exited 0 on a missing kit so it would not fail the build.
 * Which made it a no-op exactly where it was meant to run: the one environment
 * that could not verify was the only one that ever did.
 *
 * So `brand:sync` now writes brand-assets.lock.json, a sha256 per vendored
 * file plus the kit commit it came from, and `--check` falls back to that when
 * the kit is missing. With the kit it still compares real bytes; without it,
 * it compares against the recorded hashes. A hand-edited asset now fails in
 * CI, which is where hand-edited assets are actually discovered.
 *
 * What the lockfile cannot catch is the kit moving on without a re-sync — no
 * local file changes, so no hash changes. It records the kit commit so the
 * staleness is at least legible; catching it needs the kit present, i.e. a
 * developer running `npm run brand:sync -- --check` before pushing.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = process.env.EASYFIX_BRAND_KIT
  || join(homedir(), 'Documents/GitHub/EasyFix-Brand-Kit');

/*
 * ONE lockup, because the app renders one.
 *
 * `src/components/brand/logo.tsx` hard-codes `/brand/wordmark-onlight.svg` —
 * the ink-on-light cut — and says so: an on-dark or red variant gets a `variant`
 * prop there first, and only then a second entry here. (This comment used to
 * claim eight variants, four shapes x on-light/on-dark; that was never what the
 * component did, and it sent readers looking for seven missing files. The other
 * 40 lockups the kit cuts for this surface are catalogue, acknowledged in the
 * lock's `kitAssets` rather than vendored.)
 */
const LOGO_SVGS = [
  'wordmark-onlight.svg',
];

/*
 * The tab set, RED. `from` is the kit's -red file, `to` is the plain name the
 * markup asks for: src/app/layout.tsx declares /favicon-32.png and
 * /apple-touch-icon.png, and browsers probe /favicon.ico unprompted.
 */
const WEB_ASSETS = [
  ['favicon-red.ico', 'favicon.ico'],
  ['favicon-16-red.png', 'favicon-16.png'],
  ['favicon-32-red.png', 'favicon-32.png'],
  ['favicon-48-red.png', 'favicon-48.png'],
  ['favicon-64-red.png', 'favicon-64.png'],
  ['apple-touch-icon-red.png', 'apple-touch-icon.png'],
];

/*
 * The tab icon itself. Next's file convention serves src/app/icon.svg as
 * /icon.svg, so it is vendored there rather than into public/.
 */
const APP_ICON = ['icon-rounded-red.svg', 'src/app/icon.svg'];

const jobs = [
  ...LOGO_SVGS.map((f) => ({ from: join(KIT, 'apps/client-dashboard/svg', f), to: join(root, 'public/brand', f) })),
  ...WEB_ASSETS.map(([from, to]) => ({ from: join(KIT, 'apps/client-dashboard/web', from), to: join(root, 'public', to) })),
  { from: join(KIT, 'apps/client-dashboard/svg', APP_ICON[0]), to: join(root, APP_ICON[1]) },
];

const check = process.argv.includes('--check');
const LOCK = join(root, 'brand-assets.lock.json');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const relOf = (p) => p.replace(root + '/', '');

if (!existsSync(KIT)) {
  /*
   * No kit — the CI case. Verify against the committed hashes instead of
   * exiting 0 and calling that a pass.
   */
  if (!check) {
    console.error(`Brand kit not found at ${KIT}`);
    console.error('Set EASYFIX_BRAND_KIT to its path, or clone/generate the kit first.');
    console.error('Vendored assets are committed, so this is only needed to RE-sync.');
    process.exit(1);
  }
  if (!existsSync(LOCK)) {
    console.error(`No kit at ${KIT} and no ${relOf(LOCK)} to check against.`);
    console.error('Run `npm run brand:sync` on a machine that has the kit.');
    process.exit(1);
  }
  const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
  const bad = [];
  for (const [rel, want] of Object.entries(lock.assets)) {
    const abs = join(root, rel);
    if (!existsSync(abs)) { bad.push(`${rel} — missing`); continue; }
    const got = sha(readFileSync(abs));
    if (got !== want) bad.push(`${rel} — sha256 ${got.slice(0, 12)}, expected ${want.slice(0, 12)}`);
  }
  if (bad.length) {
    console.error(`${bad.length} vendored asset(s) do not match ${relOf(LOCK)}:`);
    for (const b of bad) console.error(`  ${b}`);
    console.error('A brand asset was edited in place. Re-sync from the kit instead.');
    process.exit(1);
  }
  console.log(`brand:sync --check — ${Object.keys(lock.assets).length} assets match `
    + `${relOf(LOCK)} (kit ${lock.kitCommit || 'unknown'}); kit absent, bytes not re-compared`);
  process.exit(0);
}

mkdirSync(join(root, 'public/brand'), { recursive: true });

let changed = 0;
/*
 * ── AN ASSET THE KIT HAS AND THIS APP HAS NEVER SEEN ───────────────────
 *
 * The map above is hand-maintained, so a NEW kit asset is invisible here until
 * somebody happens to notice it. That is not hypothetical: `splash-icon.png`
 * was generated for every surface and sat unused, and the Android splash it
 * exists to fix stayed broken meanwhile.
 *
 * Mirrors the same block in the technician app's sync script.
 *
 * The rule is NOT "every kit asset must be vendored" — the kit's per-surface
 * catalogue is deliberately broader than any one app needs, and demanding a
 * mapping for all of it would be noise. The rule is "nothing NEW may appear
 * unnoticed": every file in a directory this app already draws from must be
 * either MAPPED above or explicitly ACKNOWLEDGED in the lock. A kit file that
 * is neither stops the sync and names itself.
 *
 * Acknowledging is one command (`npm run brand:sync -- --accept-new`) and it is
 * deliberately not automatic — absorbing new assets silently is the behaviour
 * this replaces.
 */
const KIT_DIRS = [...new Set(jobs.map(({ from }) => dirname(from)))];

function unknownKitAssets(lockedInventory) {
  const mapped = new Set(jobs.map(({ from }) => from));
  const unknown = [];
  const inventory = {};
  /*
   * The kit's own manifest names what its build GENERATED, which a directory
   * listing cannot: a stale output, a hand-dropped file and a .DS_Store all
   * look like assets to readdir. Fall back to listing when the kit checkout
   * predates the manifest.
   */
  const manifestPath = join(KIT, 'manifest.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')).generated || {}
    : null;

  for (const dir of KIT_DIRS) {
    if (!existsSync(dir)) continue;
    const kitDirRel = dir.replace(KIT + '/', '');
    const files = (manifest?.[kitDirRel]
      ?? readdirSync(dir).filter((f) => !f.startsWith('.'))).slice().sort();
    inventory[kitDirRel] = files;
    const seen = new Set(lockedInventory?.[kitDirRel] || []);
    for (const f of files) {
      if (mapped.has(join(dir, f)) || seen.has(f)) continue;
      unknown.push(`${kitDirRel}/${f}`);
    }
  }
  return { unknown, inventory };
}

const acceptNew = process.argv.includes('--accept-new');
const lockedInventory = existsSync(LOCK)
  ? (JSON.parse(readFileSync(LOCK, 'utf8')).kitAssets || null)
  : null;
const { unknown: unknownAssets, inventory: kitAssets } = unknownKitAssets(lockedInventory);

if (unknownAssets.length && !acceptNew) {
  console.error(`${unknownAssets.length} asset(s) in the kit that this app has never seen:`);
  for (const u of unknownAssets) console.error(`  ${u}`);
  console.error('');
  console.error('The kit generated these and nothing here consumes them. Either add the ones');
  console.error('this app needs to FILES above, or record them as deliberately not vendored:');
  console.error('  npm run brand:sync -- --accept-new');
  process.exit(1);
}

const missing = [];
const drifted = [];

for (const { from, to } of jobs) {
  if (!existsSync(from)) { missing.push(from); continue; }
  const src = readFileSync(from);
  const cur = existsSync(to) ? readFileSync(to) : null;
  if (cur && src.equals(cur)) continue;
  if (check) { drifted.push(to.replace(root + '/', '')); continue; }
  writeFileSync(to, src);
  changed += 1;
}

if (missing.length) {
  console.error(`${missing.length} asset(s) missing from the kit:`);
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

if (check) {
  if (drifted.length) {
    console.error(`${drifted.length} vendored asset(s) differ from the kit — run \`npm run brand:sync\`:`);
    for (const d of drifted) console.error(`  ${d}`);
    process.exit(1);
  }
  console.log(`brand:sync --check — all ${jobs.length} vendored assets match the kit`);
} else {
  /*
   * The lockfile is written from the VENDORED copies, not the kit's, so it
   * records what this repo will actually serve. Identical by construction here,
   * and the distinction matters the day a copy fails silently.
   */
  const assets = {};
  for (const { to } of jobs) if (existsSync(to)) assets[relOf(to)] = sha(readFileSync(to));
  let kitCommit = null;
  try {
    kitCommit = execFileSync('git', ['-C', KIT, 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf8' }).trim();
  } catch { /* the kit need not be a git checkout */ }
  writeFileSync(LOCK, JSON.stringify({
    note: 'Generated by scripts/sync-brand-assets.mjs. Do not hand-edit; run `npm run brand:sync`.',
    kitCommit,
    /*
     * Every file the kit currently holds in the directories this app draws
     * from — mapped or not. Its only job is to make the NEXT new one visible.
     */
    kitAssets,
    assets,
  }, null, 2) + '\n');
  if (acceptNew && unknownAssets.length) {
    console.log(`brand:sync --accept-new — recorded ${unknownAssets.length} previously unseen kit `
      + `asset(s) as deliberately not vendored:`);
    for (const u of unknownAssets) console.log(`  ${u}`);
  }
  console.log(`brand:sync — ${jobs.length} assets checked, ${changed} updated, `
    + `${relOf(LOCK)} written (kit ${kitCommit || 'unknown'})`);
}
