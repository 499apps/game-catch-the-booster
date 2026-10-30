// Generates the PWA icons as PNG files with pure node (zlib only, no native deps).
// The art is original: a stainless booster between two tower arms, with a small heron glyph.
// Shapes are defined as signed-distance primitives and rasterised with 4x4 supersampling.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// ---------- PNG encoder ----------
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- SDF primitives (unit square coordinates, y down) ----------
const sdBox = (px, py, cx, cy, hx, hy, r = 0) => {
  const dx = Math.abs(px - cx) - hx + r;
  const dy = Math.abs(py - cy) - hy + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const sdSeg = (px, py, ax, ay, bx, by, r) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};

// Layers drawn back to front: [sdf(x,y), [r,g,b]] ; s scales art toward centre for maskable safe zone.
function scene(x, y, s) {
  const u = 0.5 + (x - 0.5) / s;
  const v = 0.5 + (y - 0.5) / s;
  const sky = [13 + 40 * v, 27 + 60 * v, 42 + 70 * v];
  const layers = [];
  // sea band
  layers.push([sdBox(u, v, 0.5, 0.9, 0.6, 0.1), [18, 60, 92]]);
  // tower column (left)
  layers.push([sdBox(u, v, 0.24, 0.55, 0.05, 0.42), [38, 46, 58]]);
  // two arms
  layers.push([sdBox(u, v, 0.4, 0.36, 0.17, 0.018), [70, 82, 98]]);
  layers.push([sdBox(u, v, 0.4, 0.44, 0.17, 0.018), [70, 82, 98]]);
  // booster body (stainless)
  layers.push([sdBox(u, v, 0.56, 0.42, 0.065, 0.3, 0.02), [196, 204, 212]]);
  layers.push([sdBox(u, v, 0.585, 0.42, 0.02, 0.29), [226, 232, 238]]);
  // plume
  layers.push([sdSeg(u, v, 0.56, 0.74, 0.56, 0.86, 0.035), [255, 176, 72]]);
  layers.push([sdSeg(u, v, 0.56, 0.74, 0.56, 0.82, 0.016), [255, 240, 210]]);
  // heron glyph on the body: body, neck, head, beak
  const ink = [24, 52, 84];
  layers.push([sdCircle(u, v, 0.555, 0.5, 0.022), ink]);
  layers.push([sdSeg(u, v, 0.555, 0.49, 0.548, 0.44, 0.006), ink]);
  layers.push([sdCircle(u, v, 0.552, 0.435, 0.009), ink]);
  layers.push([sdSeg(u, v, 0.556, 0.435, 0.59, 0.43, 0.0035), ink]);
  layers.push([sdSeg(u, v, 0.55, 0.52, 0.546, 0.56, 0.003), ink]);
  layers.push([sdSeg(u, v, 0.56, 0.52, 0.564, 0.56, 0.003), ink]);
  let col = sky;
  for (const [d, c] of layers) if (d <= 0) col = c;
  return col;
}

function render(size, maskable, rounded) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4;
  const s = maskable ? 0.78 : 1.0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          const inside = rounded ? sdBox(x, y, 0.5, 0.5, 0.5, 0.5, 0.18) <= 0 : true;
          if (!inside) continue;
          const c = scene(x, y, s);
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      buf[i] = Math.round(r / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(b / n);
      buf[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, buf);
}

const outputs = [
  ['icon-192.png', 192, false, true],
  ['icon-512.png', 512, false, true],
  ['maskable-192.png', 192, true, false],
  ['maskable-512.png', 512, true, false],
  ['apple-touch-icon.png', 180, false, false],
];
for (const [name, size, maskable, rounded] of outputs) {
  writeFileSync(join(outDir, name), render(size, maskable, rounded));
}
console.log(`icons: wrote ${outputs.length} files to public/icons`);
