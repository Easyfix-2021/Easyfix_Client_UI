/**
 * Just enough PNG to measure INK — no dependency.
 *
 * The splash gate used to reason about a logo's BOUNDING BOX, which treats the
 * empty corners of a shaped mark (a house, a rounded icon) as solid and so
 * demands the artwork be smaller than it has to be. What Android's circular
 * mask actually cuts is ink, so that is what should be measured.
 *
 * Copied from Easyfix_Technician_Mobile_Application/scripts/lib/png-ink.mjs.
 * Deliberately a copy: EasyFix is a standalone product and does not take new
 * shared packages from the Channelplay estate, so the three surfaces that need
 * this each carry it with a pointer to the others.
 *
 * `pngjs` is present in node_modules but only transitively — a gate must not
 * rest on a package nothing declares, so this decodes the subset that matters:
 * 8-bit non-interlaced RGB/RGBA/grey, which is every asset the brand kit emits
 * (sharp writes 8-bit non-interlaced) and every asset expo-splash-screen
 * consumes. Anything else throws by name rather than silently mis-measuring.
 */
import { inflateSync } from "node:zlib";
import fs from "node:fs";

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }; // grey, RGB, grey+A, RGBA

/** Paeth predictor — PNG filter type 4. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode to { width, height, channels, data } with one byte per sample. */
export function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);

  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += length + 12; // length + type + data + crc
  }
  if (depth !== 8) throw new Error(`${file}: ${depth}-bit PNG unsupported`);
  if (interlace !== 0) throw new Error(`${file}: interlaced PNG unsupported`);
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`${file}: colour type ${colorType} unsupported`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0;   // left
      const b = prev ? prev[x] : 0;                       // up
      const c = prev && x >= channels ? prev[x - channels] : 0; // up-left
      const v = line[x];
      out[x] = (
        filter === 0 ? v
          : filter === 1 ? v + a
            : filter === 2 ? v + b
              : filter === 3 ? v + ((a + b) >> 1)
                : filter === 4 ? v + paeth(a, b, c)
                  : (() => { throw new Error(`${file}: filter ${filter} unsupported`); })()
      ) & 0xff;
    }
  }
  return { width, height, channels, data };
}

/**
 * Measure the artwork's INK against a centred circle.
 *
 * "Ink" is every pixel that differs from the image's own corner pixel — which
 * handles both shapes an asset can take, and the difference between them is
 * exactly why the splash flash appeared when it did:
 *
 *   • transparent field, e.g. a lockup on nothing — corner is alpha 0, so ink
 *     is the artwork, and a mask that crosses it removes VISIBLE marks.
 *   • opaque field, e.g. a red rounded-square icon — corner is the field
 *     colour, so ink is only the mark drawn on it, and a mask that crops the
 *     field takes away nothing anybody can see when the splash background is
 *     that same colour.
 *
 * Returns the ink pixel count, how much of it the circle cuts, and the tight
 * ink box — so a caller can distinguish "the artwork is too big" from "the
 * artwork sits inside a big background it does not need".
 */
export function measureInk(file, { visibleFraction = 2 / 3 } = {}) {
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
  const bg = at(0, 0);
  // Alpha first: a transparent corner makes any opaque pixel ink regardless of
  // colour, which a plain RGB distance would miss on a white-on-nothing mark.
  const isInk = (p) => (Math.abs(p[3] - bg[3]) > 60)
    || (p[3] > 40 && Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 60);

  const cx = width / 2, cy = height / 2;
  const radius = (Math.min(width, height) * visibleFraction) / 2;
  let ink = 0, cut = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInk(at(x, y))) continue;
      ink += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (Math.hypot(x - cx, y - cy) > radius) cut += 1;
    }
  }
  return {
    width, height, ink, cut,
    cutPct: ink ? (cut / ink) * 100 : 0,
    background: bg,
    opaqueField: bg[3] > 200,
    inkBox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}
