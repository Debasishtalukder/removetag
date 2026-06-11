/**
 * Fixture generator — run with:  pnpm --filter @workspace/removetag exec tsx src/lib/fixtures/generate.ts
 *
 * Creates real 1×1 encoder-output images (via sharp/libvips) with and without
 * embedded metadata segments, plus truncated malformed variants.
 * All files are committed so tests run without executing this script.
 */

import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function u8(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}
function be16(v: number): [number, number] {
  return [(v >> 8) & 0xff, v & 0xff];
}
function be32(v: number): Uint8Array {
  return u8((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}
function le32(v: number): Uint8Array {
  return u8(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
function readU32LE(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}
function writeU32LE(b: Uint8Array, i: number, v: number) {
  b[i] = v & 0xff; b[i+1] = (v >> 8) & 0xff; b[i+2] = (v >> 16) & 0xff; b[i+3] = (v >> 24) & 0xff;
}
function ascii(b: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[start + i]);
  return s;
}

// ---------- JPEG metadata injection ----------

function jpegApp1Exif(): Uint8Array {
  const payload = concat([enc("Exif\0\0"), u8(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00)]);
  const len = payload.length + 2;
  return concat([u8(0xff, 0xe1, ...be16(len)), payload]);
}

function jpegApp1Xmp(): Uint8Array {
  const payload = concat([enc("http://ns.adobe.com/xap/1.0/\0"), enc("<x:xmpmeta/>")]);
  const len = payload.length + 2;
  return concat([u8(0xff, 0xe1, ...be16(len)), payload]);
}

function jpegApp11C2pa(): Uint8Array {
  const payload = concat([enc("jumb"), u8(0x00, 0x00, 0x00, 0x00)]);
  const len = payload.length + 2;
  return concat([u8(0xff, 0xeb, ...be16(len)), payload]);
}

function injectJpegMeta(
  base: Uint8Array,
  opts: { exif?: boolean; xmp?: boolean; c2pa?: boolean },
): Uint8Array {
  const soi = base.slice(0, 2);
  const rest = base.slice(2);
  const inserts: Uint8Array[] = [];
  if (opts.exif) inserts.push(jpegApp1Exif());
  if (opts.xmp) inserts.push(jpegApp1Xmp());
  if (opts.c2pa) inserts.push(jpegApp11C2pa());
  return concat([soi, ...inserts, rest]);
}

// ---------- PNG metadata injection ----------

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  return concat([be32(data.length), enc(type), data, u8(0, 0, 0, 0)]);
}

function injectPngMeta(
  base: Uint8Array,
  opts: { exif?: boolean; xmp?: boolean; pngChunks?: boolean; c2pa?: boolean },
): Uint8Array {
  const inserts: Uint8Array[] = [];
  if (opts.exif) inserts.push(pngChunk("eXIf", u8(0x49, 0x49, 0x2a, 0x00)));
  if (opts.xmp) {
    const kw = enc("XML:com.adobe.xmp");
    inserts.push(pngChunk("iTXt", concat([kw, u8(0x00, 0x00, 0x00), enc("<x:xmpmeta/>")])));
  }
  if (opts.pngChunks) {
    inserts.push(pngChunk("tEXt", concat([enc("Comment\0hello")])));
  }
  if (opts.c2pa) inserts.push(pngChunk("caBX", u8(0x00, 0x01, 0x02)));

  if (inserts.length === 0) return base;

  const sig = base.slice(0, 8);
  const firstChunkLen = (base[8] << 24 | base[9] << 16 | base[10] << 8 | base[11]) >>> 0;
  const firstChunkEnd = 8 + 12 + firstChunkLen;
  const ihdr = base.slice(8, firstChunkEnd);
  const tail = base.slice(firstChunkEnd);
  return concat([sig, ihdr, ...inserts, tail]);
}

// ---------- WebP metadata injection ----------

function webpChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const size = le32(data.length);
  const padded = data.length % 2 === 1 ? concat([data, u8(0)]) : data;
  return concat([enc(fourcc), size, padded]);
}

function injectWebpMeta(
  base: Uint8Array,
  opts: { exif?: boolean; xmp?: boolean; c2pa?: boolean },
): Uint8Array {
  let imgChunk: Uint8Array | null = null;
  let i = 12;
  while (i + 8 <= base.length) {
    const fourcc = ascii(base, i, 4);
    const size = readU32LE(base, i + 4);
    const padded = size + (size % 2);
    const end = i + 8 + padded;
    if (fourcc === "VP8 " || fourcc === "VP8L") {
      imgChunk = base.slice(i, end);
      break;
    }
    i = end;
  }
  if (!imgChunk) throw new Error("No VP8/VP8L chunk found");

  let flags = 0;
  if (opts.exif) flags |= 0x08;
  if (opts.xmp) flags |= 0x04;
  const vp8xData = u8(flags, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
  const vp8x = webpChunk("VP8X", vp8xData);

  const metaParts: Uint8Array[] = [];
  if (opts.exif) metaParts.push(webpChunk("EXIF", concat([enc("Exif\0\0"), u8(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00)])));
  if (opts.xmp) metaParts.push(webpChunk("XMP ", enc("<x:xmpmeta/>")));
  if (opts.c2pa) metaParts.push(webpChunk("C2PA", u8(0x00, 0x01, 0x02)));

  const body = concat([vp8x, ...metaParts, imgChunk]);
  const out = new Uint8Array(12 + body.length);
  out.set(enc("RIFF"), 0);
  writeU32LE(out, 4, out.length - 8);
  out.set(enc("WEBP"), 8);
  out.set(body, 12);
  return out;
}

// ---------- main ----------

async function main() {
  const pixel = { width: 1, height: 1, channels: 3 as const, background: { r: 200, g: 180, b: 160 } };

  const jpegBase = await sharp({ create: pixel }).jpeg({ quality: 85 }).toBuffer();
  const pngBase = await sharp({ create: pixel }).png({ compressionLevel: 6 }).toBuffer();
  const webpBase = await sharp({ create: pixel }).webp({ lossless: true }).toBuffer();

  const files: [string, Uint8Array][] = [
    ["jpeg/clean.jpg", new Uint8Array(jpegBase)],
    ["jpeg/exif.jpg", injectJpegMeta(new Uint8Array(jpegBase), { exif: true })],
    ["jpeg/xmp.jpg", injectJpegMeta(new Uint8Array(jpegBase), { xmp: true })],
    ["jpeg/c2pa.jpg", injectJpegMeta(new Uint8Array(jpegBase), { c2pa: true })],
    ["jpeg/all-meta.jpg", injectJpegMeta(new Uint8Array(jpegBase), { exif: true, xmp: true, c2pa: true })],
    // Truncated mid-segment (i+4 > b.length guard fires → null)
    ["jpeg/malformed.jpg", new Uint8Array(jpegBase).slice(0, 5)],

    ["png/clean.png", new Uint8Array(pngBase)],
    ["png/exif.png", injectPngMeta(new Uint8Array(pngBase), { exif: true })],
    ["png/xmp.png", injectPngMeta(new Uint8Array(pngBase), { xmp: true })],
    ["png/text-chunks.png", injectPngMeta(new Uint8Array(pngBase), { pngChunks: true })],
    ["png/c2pa.png", injectPngMeta(new Uint8Array(pngBase), { c2pa: true })],
    ["png/all-meta.png", injectPngMeta(new Uint8Array(pngBase), { exif: true, xmp: true, pngChunks: true, c2pa: true })],
    // Chunk length overflows buffer → null
    ["png/malformed.png", (() => {
      const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const overflowChunk = concat([be32(0xffffff00), enc("IHDR"), u8(0x01), u8(0, 0, 0, 0)]);
      return concat([sig, overflowChunk]);
    })()],

    ["webp/clean.webp", new Uint8Array(webpBase)],
    ["webp/exif.webp", injectWebpMeta(new Uint8Array(webpBase), { exif: true })],
    ["webp/xmp.webp", injectWebpMeta(new Uint8Array(webpBase), { xmp: true })],
    ["webp/c2pa.webp", injectWebpMeta(new Uint8Array(webpBase), { c2pa: true })],
    ["webp/all-meta.webp", injectWebpMeta(new Uint8Array(webpBase), { exif: true, xmp: true, c2pa: true })],
    // Chunk size overflows buffer → null
    ["webp/malformed.webp", (() => {
      return concat([enc("RIFF"), le32(100), enc("WEBP"), enc("VP8X"), le32(0xffffff00), u8(0x01)]);
    })()],
  ];

  for (const [relPath, bytes] of files) {
    const full = path.join(DIR, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
    console.log(`wrote ${relPath} (${bytes.length} bytes)`);
  }

  console.log("\nAll fixtures written.");
}

main().catch((e) => { console.error(e); process.exit(1); });
