import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import {
  processJpeg,
  processPng,
  processWebp,
  stripMetadata,
  detectMetadata,
  type StripOptions,
} from "./metadata-stripper";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
function fix(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, rel)));
}

async function assertDecodesAs(bytes: Uint8Array, width: number, height: number) {
  const meta = await sharp(Buffer.from(bytes)).metadata();
  expect(meta.width, `expected width=${width}, got ${meta.width}`).toBe(width);
  expect(meta.height, `expected height=${height}, got ${meta.height}`).toBe(height);
}

async function assertFullyDecodable(bytes: Uint8Array) {
  await sharp(Buffer.from(bytes)).raw().toBuffer();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function u8(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
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

const ALL_STRIP: StripOptions = {
  exif: true,
  xmp: true,
  c2pa: true,
  pngChunks: true,
};

const NO_STRIP: StripOptions = {
  exif: false,
  xmp: false,
  c2pa: false,
  pngChunks: false,
};

// ---------------------------------------------------------------------------
// Structural decode-validity helpers
//
// These walk the actual binary structure of the cleaned output to assert that
// the image remains intact: required markers / chunks are present and the
// byte stream can be fully traversed without hitting an invalid state.
// ---------------------------------------------------------------------------

function isValidJpegStructure(b: Uint8Array): { valid: boolean; reason?: string } {
  if (b.length < 4) return { valid: false, reason: "too short" };
  if (b[0] !== 0xff || b[1] !== 0xd8)
    return { valid: false, reason: "missing SOI" };
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9)
    return { valid: false, reason: "missing EOI" };

  let hasSos = false;
  let i = 2;
  while (i < b.length - 1) {
    if (b[i] !== 0xff) return { valid: false, reason: `non-marker byte at ${i}` };
    const marker = b[i + 1];
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      hasSos = true;
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return { valid: false, reason: "truncated length field" };
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return { valid: false, reason: "segment length < 2" };
    const segEnd = i + 2 + len;
    if (segEnd > b.length) return { valid: false, reason: "segment overflows buffer" };
    i = segEnd;
  }
  if (!hasSos) return { valid: false, reason: "missing SOS" };
  return { valid: true };
}

function isValidPngStructure(b: Uint8Array): { valid: boolean; reason?: string } {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 12) return { valid: false, reason: "too short" };
  if (!sig.every((v, i) => b[i] === v)) return { valid: false, reason: "bad signature" };

  let hasIhdr = false, hasIdat = false, hasIend = false;
  let i = 8;
  while (i + 8 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (end > b.length || end <= i) return { valid: false, reason: `chunk ${type} overflows` };
    if (type === "IHDR") hasIhdr = true;
    if (type === "IDAT") hasIdat = true;
    if (type === "IEND") hasIend = true;
    i = end;
  }
  if (!hasIhdr) return { valid: false, reason: "missing IHDR" };
  if (!hasIdat) return { valid: false, reason: "missing IDAT" };
  if (!hasIend) return { valid: false, reason: "missing IEND" };
  return { valid: true };
}

function isValidWebpStructure(b: Uint8Array): { valid: boolean; reason?: string } {
  if (b.length < 12) return { valid: false, reason: "too short" };
  if (String.fromCharCode(...b.slice(0, 4)) !== "RIFF")
    return { valid: false, reason: "missing RIFF" };
  if (String.fromCharCode(...b.slice(8, 12)) !== "WEBP")
    return { valid: false, reason: "missing WEBP" };

  const riffSize = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  if (riffSize !== b.length - 8)
    return { valid: false, reason: "RIFF size mismatch" };

  let hasImageChunk = false;
  let i = 12;
  while (i + 8 <= b.length) {
    const fourcc = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const size = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
    const padded = size + (size % 2);
    const end = i + 8 + padded;
    if (end > b.length || end <= i) return { valid: false, reason: `chunk ${fourcc} overflows` };
    if (fourcc === "VP8 " || fourcc === "VP8L" || fourcc === "VP8X") hasImageChunk = true;
    i = end;
  }
  if (!hasImageChunk) return { valid: false, reason: "no VP8/VP8L/VP8X chunk" };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// JPEG fixture builder
// ---------------------------------------------------------------------------

interface JpegOptions {
  exif?: boolean;
  xmp?: boolean;
  c2pa?: boolean;
}

function makeJpegApp1Exif(): Uint8Array {
  const payload = concatBytes([
    enc("Exif\0\0"),
    u8(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00),
  ]);
  const segLen = payload.length + 2;
  return concatBytes([u8(0xff, 0xe1, ...be16(segLen)), payload]);
}

function makeJpegApp1Xmp(): Uint8Array {
  const payload = concatBytes([
    enc("http://ns.adobe.com/xap/1.0/\0"),
    enc("<x:xmpmeta/>"),
  ]);
  const segLen = payload.length + 2;
  return concatBytes([u8(0xff, 0xe1, ...be16(segLen)), payload]);
}

function makeJpegApp11C2pa(): Uint8Array {
  const payload = concatBytes([enc("jumb"), u8(0x00, 0x00, 0x00, 0x00)]);
  const segLen = payload.length + 2;
  return concatBytes([u8(0xff, 0xeb, ...be16(segLen)), payload]);
}

function makeJpeg({ exif = false, xmp = false, c2pa = false }: JpegOptions = {}): Uint8Array {
  const sof0Data = u8(0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00);
  const sof0Len = sof0Data.length + 2;
  const sof0 = concatBytes([u8(0xff, 0xc0, ...be16(sof0Len)), sof0Data]);

  const sosData = u8(0x01, 0x01, 0x00, 0x00, 0x3f, 0x00);
  const sosLen = sosData.length + 2;
  const sos = concatBytes([u8(0xff, 0xda, ...be16(sosLen)), sosData]);

  const parts: Uint8Array[] = [u8(0xff, 0xd8)];
  if (exif) parts.push(makeJpegApp1Exif());
  if (xmp) parts.push(makeJpegApp1Xmp());
  if (c2pa) parts.push(makeJpegApp11C2pa());
  parts.push(sof0);
  parts.push(sos);
  parts.push(u8(0x7f));
  parts.push(u8(0xff, 0xd9));

  return concatBytes(parts);
}

// ---------------------------------------------------------------------------
// PNG fixture builder
// ---------------------------------------------------------------------------

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  return concatBytes([be32(data.length), enc(type), data, u8(0, 0, 0, 0)]);
}

interface PngOptions {
  exif?: boolean;
  xmp?: boolean;
  pngChunks?: boolean;
  c2pa?: boolean;
}

function makePng({
  exif = false,
  xmp = false,
  pngChunks = false,
  c2pa = false,
}: PngOptions = {}): Uint8Array {
  const sig = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

  const ihdrData = concatBytes([be32(1), be32(1), u8(8, 2, 0, 0, 0)]);
  const ihdr = makePngChunk("IHDR", ihdrData);

  const idatData = u8(0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01);
  const idat = makePngChunk("IDAT", idatData);

  const iend = makePngChunk("IEND", new Uint8Array(0));

  const parts: Uint8Array[] = [sig, ihdr];

  if (exif) {
    parts.push(makePngChunk("eXIf", u8(0x49, 0x49, 0x2a, 0x00)));
  }
  if (xmp) {
    const keyword = enc("XML:com.adobe.xmp");
    const xtData = concatBytes([keyword, u8(0x00, 0x00, 0x00), enc("<x:xmpmeta/>")]);
    parts.push(makePngChunk("iTXt", xtData));
  }
  if (pngChunks) {
    parts.push(makePngChunk("tEXt", concatBytes([enc("Comment\0hello")])));
  }
  if (c2pa) {
    parts.push(makePngChunk("caBX", u8(0x00, 0x01, 0x02)));
  }

  parts.push(idat, iend);
  return concatBytes(parts);
}

// ---------------------------------------------------------------------------
// WebP fixture builder
// ---------------------------------------------------------------------------

interface WebpOptions {
  exif?: boolean;
  xmp?: boolean;
  c2pa?: boolean;
}

function makeWebpChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const size = le32(data.length);
  const padded = data.length % 2 === 1 ? concatBytes([data, u8(0)]) : data;
  return concatBytes([enc(fourcc), size, padded]);
}

function makeWebp({
  exif = false,
  xmp = false,
  c2pa = false,
}: WebpOptions = {}): Uint8Array {
  let flags = 0x02;
  if (exif) flags |= 0x08;
  if (xmp) flags |= 0x04;

  const vp8xData = concatBytes([
    u8(flags, 0x00, 0x00, 0x00),
    u8(0x00, 0x00, 0x00),
    u8(0x00, 0x00, 0x00),
  ]);
  const vp8x = makeWebpChunk("VP8X", vp8xData);
  const vp8lPayload = u8(0x2f, 0x00, 0x00, 0x00, 0xfe, 0xff, 0x03);
  const vp8l = makeWebpChunk("VP8L", vp8lPayload);

  const metaParts: Uint8Array[] = [];
  if (exif) metaParts.push(makeWebpChunk("EXIF", u8(0x49, 0x49, 0x2a, 0x00)));
  if (xmp) metaParts.push(makeWebpChunk("XMP ", enc("<x:xmpmeta/>")));
  if (c2pa) metaParts.push(makeWebpChunk("C2PA", u8(0x00, 0x01, 0x02)));

  const body = concatBytes([vp8x, ...metaParts, vp8l]);
  const riffSize = le32(4 + body.length);
  return concatBytes([enc("RIFF"), riffSize, enc("WEBP"), body]);
}

// ===========================================================================
// JPEG tests
// ===========================================================================

describe("JPEG", () => {
  describe("detection (null options)", () => {
    it("detects nothing in a clean JPEG", () => {
      const { detection } = processJpeg(makeJpeg(), null);
      expect(detection).toEqual({ exif: false, xmp: false, c2pa: false, pngChunks: false });
    });

    it("detects EXIF", () => {
      const { detection } = processJpeg(makeJpeg({ exif: true }), null);
      expect(detection.exif).toBe(true);
    });

    it("detects XMP", () => {
      const { detection } = processJpeg(makeJpeg({ xmp: true }), null);
      expect(detection.xmp).toBe(true);
    });

    it("detects C2PA", () => {
      const { detection } = processJpeg(makeJpeg({ c2pa: true }), null);
      expect(detection.c2pa).toBe(true);
    });

    it("detects all metadata types simultaneously", () => {
      const { detection } = processJpeg(makeJpeg({ exif: true, xmp: true, c2pa: true }), null);
      expect(detection.exif).toBe(true);
      expect(detection.xmp).toBe(true);
      expect(detection.c2pa).toBe(true);
    });

    it("returns null bytes when options are null", () => {
      const { bytes } = processJpeg(makeJpeg({ exif: true }), null);
      expect(bytes).toBeNull();
    });
  });

  describe("stripping — option matrix", () => {
    it("strips EXIF only when exif:true", () => {
      const b = makeJpeg({ exif: true, xmp: true });
      const { bytes } = processJpeg(b, { ...NO_STRIP, exif: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processJpeg(bytes!, null);
      expect(check.exif).toBe(false);
      expect(check.xmp).toBe(true);
    });

    it("strips XMP only when xmp:true", () => {
      const b = makeJpeg({ exif: true, xmp: true });
      const { bytes } = processJpeg(b, { ...NO_STRIP, xmp: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processJpeg(bytes!, null);
      expect(check.xmp).toBe(false);
      expect(check.exif).toBe(true);
    });

    it("strips C2PA only when c2pa:true", () => {
      const b = makeJpeg({ exif: true, c2pa: true });
      const { bytes } = processJpeg(b, { ...NO_STRIP, c2pa: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processJpeg(bytes!, null);
      expect(check.c2pa).toBe(false);
      expect(check.exif).toBe(true);
    });

    it("strips all metadata when all options are true", () => {
      const b = makeJpeg({ exif: true, xmp: true, c2pa: true });
      const { bytes } = processJpeg(b, ALL_STRIP);
      expect(bytes).not.toBeNull();
      const { detection: check } = processJpeg(bytes!, null);
      expect(check.exif).toBe(false);
      expect(check.xmp).toBe(false);
      expect(check.c2pa).toBe(false);
    });

    it("keeps all metadata when all options are false", () => {
      const b = makeJpeg({ exif: true, xmp: true, c2pa: true });
      const { bytes } = processJpeg(b, NO_STRIP);
      expect(bytes).not.toBeNull();
      const { detection: check } = processJpeg(bytes!, null);
      expect(check.exif).toBe(true);
      expect(check.xmp).toBe(true);
      expect(check.c2pa).toBe(true);
    });
  });

  describe("output decode validity", () => {
    it("cleaned output has a fully traversable JPEG structure (SOI + SOS + EOI)", () => {
      const { bytes } = processJpeg(makeJpeg({ exif: true, xmp: true, c2pa: true }), ALL_STRIP);
      expect(bytes).not.toBeNull();
      const v = isValidJpegStructure(bytes!);
      expect(v.valid, v.reason).toBe(true);
    });

    it("no-op output has a fully traversable JPEG structure", () => {
      const { bytes } = processJpeg(makeJpeg({ exif: true, xmp: true }), NO_STRIP);
      expect(bytes).not.toBeNull();
      const v = isValidJpegStructure(bytes!);
      expect(v.valid, v.reason).toBe(true);
    });

    it("stripped output is smaller than input", () => {
      const b = makeJpeg({ exif: true, xmp: true, c2pa: true });
      const { bytes } = processJpeg(b, ALL_STRIP);
      expect(bytes!.length).toBeLessThan(b.length);
    });

    it("no-op output is same size as input", () => {
      const b = makeJpeg({ exif: true });
      const { bytes } = processJpeg(b, NO_STRIP);
      expect(bytes!.length).toBe(b.length);
    });
  });

  describe("malformed input — returns null bytes (triggers fallback)", () => {
    it("truncated segment", () => {
      const { bytes } = processJpeg(makeJpeg().slice(0, 5), ALL_STRIP);
      expect(bytes).toBeNull();
    });

    it("non-0xFF marker byte at position 2", () => {
      const b = makeJpeg();
      const bad = b.slice();
      bad[2] = 0xab;
      const { bytes } = processJpeg(bad, ALL_STRIP);
      expect(bytes).toBeNull();
    });

    it("segment length < 2", () => {
      const b = concatBytes([u8(0xff, 0xd8), u8(0xff, 0xe0, 0x00, 0x01)]);
      const { bytes } = processJpeg(b, ALL_STRIP);
      expect(bytes).toBeNull();
    });

    it("segment length overflows buffer", () => {
      const b = concatBytes([u8(0xff, 0xd8), u8(0xff, 0xe0, 0xff, 0xff), u8(0x00, 0x01)]);
      const { bytes } = processJpeg(b, ALL_STRIP);
      expect(bytes).toBeNull();
    });
  });
});

// ===========================================================================
// PNG tests
// ===========================================================================

describe("PNG", () => {
  describe("detection (null options)", () => {
    it("detects nothing in a clean PNG", () => {
      const { detection } = processPng(makePng(), null);
      expect(detection).toEqual({ exif: false, xmp: false, c2pa: false, pngChunks: false });
    });

    it("detects eXIf chunk", () => {
      const { detection } = processPng(makePng({ exif: true }), null);
      expect(detection.exif).toBe(true);
    });

    it("detects XMP via iTXt chunk", () => {
      const { detection } = processPng(makePng({ xmp: true }), null);
      expect(detection.xmp).toBe(true);
      expect(detection.pngChunks).toBe(true);
    });

    it("detects tEXt as pngChunks", () => {
      const { detection } = processPng(makePng({ pngChunks: true }), null);
      expect(detection.pngChunks).toBe(true);
    });

    it("detects caBX as C2PA", () => {
      const { detection } = processPng(makePng({ c2pa: true }), null);
      expect(detection.c2pa).toBe(true);
    });

    it("detects all metadata types simultaneously", () => {
      const b = makePng({ exif: true, xmp: true, pngChunks: true, c2pa: true });
      const { detection } = processPng(b, null);
      expect(detection.exif).toBe(true);
      expect(detection.xmp).toBe(true);
      expect(detection.pngChunks).toBe(true);
      expect(detection.c2pa).toBe(true);
    });

    it("returns null bytes when options are null", () => {
      const { bytes } = processPng(makePng({ exif: true }), null);
      expect(bytes).toBeNull();
    });
  });

  describe("stripping — option matrix", () => {
    it("strips eXIf only when exif:true", () => {
      const b = makePng({ exif: true, pngChunks: true });
      const { bytes } = processPng(b, { ...NO_STRIP, exif: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processPng(bytes!, null);
      expect(check.exif).toBe(false);
      expect(check.pngChunks).toBe(true);
    });

    it("strips XMP iTXt only when xmp:true (keeps other tEXt)", () => {
      const b = makePng({ xmp: true, pngChunks: true });
      const { bytes } = processPng(b, { ...NO_STRIP, xmp: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processPng(bytes!, null);
      expect(check.xmp).toBe(false);
      expect(check.pngChunks).toBe(true);
    });

    it("strips all text chunks when pngChunks:true (including XMP iTXt)", () => {
      const b = makePng({ xmp: true, pngChunks: true });
      const { bytes } = processPng(b, { ...NO_STRIP, pngChunks: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processPng(bytes!, null);
      expect(check.pngChunks).toBe(false);
      expect(check.xmp).toBe(false);
    });

    it("strips caBX only when c2pa:true", () => {
      const b = makePng({ c2pa: true, pngChunks: true });
      const { bytes } = processPng(b, { ...NO_STRIP, c2pa: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processPng(bytes!, null);
      expect(check.c2pa).toBe(false);
      expect(check.pngChunks).toBe(true);
    });

    it("strips all metadata when all options are true", () => {
      const b = makePng({ exif: true, xmp: true, pngChunks: true, c2pa: true });
      const { bytes } = processPng(b, ALL_STRIP);
      expect(bytes).not.toBeNull();
      const { detection: check } = processPng(bytes!, null);
      expect(check).toEqual({ exif: false, xmp: false, c2pa: false, pngChunks: false });
    });

    it("keeps all metadata when all options are false", () => {
      const b = makePng({ exif: true, xmp: true, pngChunks: true, c2pa: true });
      const { bytes } = processPng(b, NO_STRIP);
      expect(bytes).not.toBeNull();
      const { detection: check } = processPng(bytes!, null);
      expect(check.exif).toBe(true);
      expect(check.xmp).toBe(true);
      expect(check.pngChunks).toBe(true);
      expect(check.c2pa).toBe(true);
    });
  });

  describe("output decode validity", () => {
    it("cleaned output has a fully traversable PNG structure (IHDR + IDAT + IEND present)", () => {
      const b = makePng({ exif: true, xmp: true, pngChunks: true, c2pa: true });
      const { bytes } = processPng(b, ALL_STRIP);
      expect(bytes).not.toBeNull();
      const v = isValidPngStructure(bytes!);
      expect(v.valid, v.reason).toBe(true);
    });

    it("no-op output has a fully traversable PNG structure", () => {
      const { bytes } = processPng(makePng({ exif: true, pngChunks: true }), NO_STRIP);
      expect(bytes).not.toBeNull();
      const v = isValidPngStructure(bytes!);
      expect(v.valid, v.reason).toBe(true);
    });

    it("stripped output is smaller than input", () => {
      const b = makePng({ exif: true, xmp: true, c2pa: true, pngChunks: true });
      const { bytes } = processPng(b, ALL_STRIP);
      expect(bytes!.length).toBeLessThan(b.length);
    });

    it("no-op output is same size as input", () => {
      const b = makePng({ exif: true, pngChunks: true });
      const { bytes } = processPng(b, NO_STRIP);
      expect(bytes!.length).toBe(b.length);
    });
  });

  describe("malformed input — returns null bytes (triggers fallback)", () => {
    it("chunk length overflows buffer", () => {
      const sig = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
      const badChunk = concatBytes([
        be32(0xffffff00),
        enc("IHDR"),
        u8(0x01),
        u8(0, 0, 0, 0),
      ]);
      const { bytes } = processPng(concatBytes([sig, badChunk]), ALL_STRIP);
      expect(bytes).toBeNull();
    });
  });
});

// ===========================================================================
// WebP tests
// ===========================================================================

describe("WebP", () => {
  describe("detection (null options)", () => {
    it("detects nothing in a clean WebP", () => {
      const { detection } = processWebp(makeWebp(), null);
      expect(detection).toEqual({ exif: false, xmp: false, c2pa: false, pngChunks: false });
    });

    it("detects EXIF chunk", () => {
      const { detection } = processWebp(makeWebp({ exif: true }), null);
      expect(detection.exif).toBe(true);
    });

    it("detects XMP chunk", () => {
      const { detection } = processWebp(makeWebp({ xmp: true }), null);
      expect(detection.xmp).toBe(true);
    });

    it("detects C2PA chunk", () => {
      const { detection } = processWebp(makeWebp({ c2pa: true }), null);
      expect(detection.c2pa).toBe(true);
    });

    it("detects all metadata types simultaneously", () => {
      const { detection } = processWebp(makeWebp({ exif: true, xmp: true, c2pa: true }), null);
      expect(detection.exif).toBe(true);
      expect(detection.xmp).toBe(true);
      expect(detection.c2pa).toBe(true);
    });

    it("returns null bytes when options are null", () => {
      const { bytes } = processWebp(makeWebp({ exif: true }), null);
      expect(bytes).toBeNull();
    });
  });

  describe("stripping — option matrix", () => {
    it("strips EXIF only when exif:true", () => {
      const b = makeWebp({ exif: true, xmp: true });
      const { bytes } = processWebp(b, { ...NO_STRIP, exif: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processWebp(bytes!, null);
      expect(check.exif).toBe(false);
      expect(check.xmp).toBe(true);
    });

    it("strips XMP only when xmp:true", () => {
      const b = makeWebp({ exif: true, xmp: true });
      const { bytes } = processWebp(b, { ...NO_STRIP, xmp: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processWebp(bytes!, null);
      expect(check.xmp).toBe(false);
      expect(check.exif).toBe(true);
    });

    it("strips C2PA only when c2pa:true", () => {
      const b = makeWebp({ exif: true, c2pa: true });
      const { bytes } = processWebp(b, { ...NO_STRIP, c2pa: true });
      expect(bytes).not.toBeNull();
      const { detection: check } = processWebp(bytes!, null);
      expect(check.c2pa).toBe(false);
      expect(check.exif).toBe(true);
    });

    it("strips all metadata when all options are true", () => {
      const b = makeWebp({ exif: true, xmp: true, c2pa: true });
      const { bytes } = processWebp(b, ALL_STRIP);
      expect(bytes).not.toBeNull();
      const { detection: check } = processWebp(bytes!, null);
      expect(check.exif).toBe(false);
      expect(check.xmp).toBe(false);
      expect(check.c2pa).toBe(false);
    });

    it("keeps all metadata when all options are false", () => {
      const b = makeWebp({ exif: true, xmp: true, c2pa: true });
      const { bytes } = processWebp(b, NO_STRIP);
      expect(bytes).not.toBeNull();
      const { detection: check } = processWebp(bytes!, null);
      expect(check.exif).toBe(true);
      expect(check.xmp).toBe(true);
      expect(check.c2pa).toBe(true);
    });
  });

  describe("output decode validity", () => {
    it("cleaned output has a fully traversable WebP structure (RIFF + VP8 chunk present)", () => {
      const b = makeWebp({ exif: true, xmp: true, c2pa: true });
      const { bytes } = processWebp(b, ALL_STRIP);
      expect(bytes).not.toBeNull();
      const v = isValidWebpStructure(bytes!);
      expect(v.valid, v.reason).toBe(true);
    });

    it("no-op output has a fully traversable WebP structure", () => {
      const { bytes } = processWebp(makeWebp({ exif: true }), NO_STRIP);
      expect(bytes).not.toBeNull();
      const v = isValidWebpStructure(bytes!);
      expect(v.valid, v.reason).toBe(true);
    });

    it("RIFF size field is consistent with output length after stripping", () => {
      const { bytes } = processWebp(makeWebp({ exif: true, xmp: true }), ALL_STRIP);
      expect(bytes).not.toBeNull();
      const riffSize =
        bytes![4] | (bytes![5] << 8) | (bytes![6] << 16) | (bytes![7] << 24);
      expect(riffSize).toBe(bytes!.length - 8);
    });

    it("stripped output is smaller than input", () => {
      const b = makeWebp({ exif: true, xmp: true, c2pa: true });
      const { bytes } = processWebp(b, ALL_STRIP);
      expect(bytes!.length).toBeLessThan(b.length);
    });

    it("no-op output is same size as input", () => {
      const b = makeWebp({ exif: true });
      const { bytes } = processWebp(b, NO_STRIP);
      expect(bytes!.length).toBe(b.length);
    });

    it("clears EXIF flag bit (0x08) in VP8X when EXIF is stripped", () => {
      const { bytes } = processWebp(makeWebp({ exif: true }), { ...NO_STRIP, exif: true });
      expect(bytes).not.toBeNull();
      expect(bytes![12 + 8] & 0x08).toBe(0);
    });

    it("clears XMP flag bit (0x04) in VP8X when XMP is stripped", () => {
      const { bytes } = processWebp(makeWebp({ xmp: true }), { ...NO_STRIP, xmp: true });
      expect(bytes).not.toBeNull();
      expect(bytes![12 + 8] & 0x04).toBe(0);
    });
  });

  describe("malformed input — returns null bytes (triggers fallback)", () => {
    it("chunk size causes overflow", () => {
      const b = concatBytes([
        enc("RIFF"),
        le32(100),
        enc("WEBP"),
        enc("VP8X"),
        le32(0xffffff00),
        u8(0x01),
      ]);
      const { bytes } = processWebp(b, ALL_STRIP);
      expect(bytes).toBeNull();
    });
  });
});

// ===========================================================================
// stripMetadata — canvas fallback path
//
// When the byte parser returns null (malformed / unrecognised input),
// stripMetadata falls back to re-encoding through a canvas element.
// These tests mock the browser DOM APIs that canvasStrip relies on and verify
// that the fallback is reached and returns a non-empty Blob.
// ===========================================================================

describe("stripMetadata — canvas fallback (mocked DOM)", () => {
  type AnyGlobal = Record<string, unknown>;

  let savedImage: unknown;
  let savedDocument: unknown;
  let savedCreateObjectURL: unknown;
  let savedRevokeObjectURL: unknown;

  const RE_ENCODED = makeJpeg();

  beforeEach(() => {
    const g = globalThis as unknown as AnyGlobal;

    savedImage = g["Image"];
    savedDocument = g["document"];
    savedCreateObjectURL = (g["URL"] as AnyGlobal | undefined)?.["createObjectURL"];
    savedRevokeObjectURL = (g["URL"] as AnyGlobal | undefined)?.["revokeObjectURL"];

    if (!g["URL"]) g["URL"] = {} as AnyGlobal;
    (g["URL"] as AnyGlobal)["createObjectURL"] = () => "blob:mock://1";
    (g["URL"] as AnyGlobal)["revokeObjectURL"] = () => {};

    class MockImage {
      naturalWidth = 1;
      naturalHeight = 1;
      onload?: () => void;
      onerror?: () => void;
      set src(_url: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    g["Image"] = MockImage;

    const mockBlob = new Blob([RE_ENCODED], { type: "image/jpeg" });
    g["document"] = {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => {} }),
            toBlob: (cb: (b: Blob | null) => void, _mime: string) => cb(mockBlob),
          };
        }
        return null;
      },
    };
  });

  afterEach(() => {
    const g = globalThis as unknown as AnyGlobal;
    if (savedImage === undefined) delete g["Image"];
    else g["Image"] = savedImage;
    if (savedDocument === undefined) delete g["document"];
    else g["document"] = savedDocument;
    if (savedCreateObjectURL !== undefined)
      (g["URL"] as AnyGlobal)["createObjectURL"] = savedCreateObjectURL;
    if (savedRevokeObjectURL !== undefined)
      (g["URL"] as AnyGlobal)["revokeObjectURL"] = savedRevokeObjectURL;
  });

  it("falls back when processJpeg returns null (non-0xFF at byte 2)", async () => {
    const malformed = u8(0xff, 0xd8, 0xab, 0x00);
    const file = new File([malformed], "bad.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
  });

  it("falls back when processPng returns null (overflowing chunk length)", async () => {
    const sig = u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const badChunk = concatBytes([be32(0xffffff00), enc("IHDR"), u8(0x01), u8(0, 0, 0, 0)]);
    const malformed = concatBytes([sig, badChunk]);
    const file = new File([malformed], "bad.png", { type: "image/png" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
  });

  it("falls back when processWebp returns null (overflowing chunk size)", async () => {
    const malformed = concatBytes([
      enc("RIFF"),
      le32(100),
      enc("WEBP"),
      enc("VP8X"),
      le32(0xffffff00),
      u8(0x01),
    ]);
    const file = new File([malformed], "bad.webp", { type: "image/webp" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
  });

  it("canvas re-encode output passes structural JPEG decode validation", async () => {
    const malformed = u8(0xff, 0xd8, 0xab, 0x00);
    const file = new File([malformed], "bad.jpg", { type: "image/jpeg" });
    const blob = await stripMetadata(file, ALL_STRIP);
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const v = isValidJpegStructure(bytes);
    expect(v.valid, v.reason).toBe(true);
  });
});

// ===========================================================================
// Disk fixture tests — real encoder output + sharp decode validation
//
// Fixtures were generated by:
//   pnpm --filter @workspace/removetag exec tsx src/lib/fixtures/generate.ts
//
// Base images are produced by sharp (libvips → libjpeg/libpng/libwebp), giving
// genuine encoder output. Metadata segments are injected into those real payloads.
// sharp.metadata() and sharp().raw().toBuffer() are used to assert decodability.
// ===========================================================================

describe("Disk fixtures — JPEG (real encoder output)", () => {
  it("clean.jpg decodes to 1×1 and has no metadata", async () => {
    const b = fix("jpeg/clean.jpg");
    await assertDecodesAs(b, 1, 1);
    const { detection } = processJpeg(b, null);
    expect(detection.exif).toBe(false);
    expect(detection.xmp).toBe(false);
    expect(detection.c2pa).toBe(false);
  });

  it("exif.jpg detects EXIF and strips it cleanly", async () => {
    const b = fix("jpeg/exif.jpg");
    const { detection } = processJpeg(b, null);
    expect(detection.exif).toBe(true);

    const { bytes } = processJpeg(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    await assertFullyDecodable(bytes!);
    const { detection: after } = processJpeg(bytes!, null);
    expect(after.exif).toBe(false);
  });

  it("xmp.jpg detects XMP and strips it cleanly", async () => {
    const b = fix("jpeg/xmp.jpg");
    const { detection } = processJpeg(b, null);
    expect(detection.xmp).toBe(true);

    const { bytes } = processJpeg(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processJpeg(bytes!, null);
    expect(after.xmp).toBe(false);
  });

  it("c2pa.jpg detects C2PA and strips it cleanly", async () => {
    const b = fix("jpeg/c2pa.jpg");
    const { detection } = processJpeg(b, null);
    expect(detection.c2pa).toBe(true);

    const { bytes } = processJpeg(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processJpeg(bytes!, null);
    expect(after.c2pa).toBe(false);
  });

  it("all-meta.jpg strips all metadata, output is still decodable 1×1", async () => {
    const b = fix("jpeg/all-meta.jpg");
    const { detection } = processJpeg(b, null);
    expect(detection.exif).toBe(true);
    expect(detection.xmp).toBe(true);
    expect(detection.c2pa).toBe(true);

    const { bytes } = processJpeg(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    await assertFullyDecodable(bytes!);
    const { detection: after } = processJpeg(bytes!, null);
    expect(after.exif).toBe(false);
    expect(after.xmp).toBe(false);
    expect(after.c2pa).toBe(false);
  });

  it("all-meta.jpg with only EXIF stripped: XMP + C2PA survive, image still decodable", async () => {
    const b = fix("jpeg/all-meta.jpg");
    const { bytes } = processJpeg(b, { ...NO_STRIP, exif: true });
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processJpeg(bytes!, null);
    expect(after.exif).toBe(false);
    expect(after.xmp).toBe(true);
    expect(after.c2pa).toBe(true);
  });

  it("malformed.jpg parser returns null bytes (triggers canvas fallback)", () => {
    const b = fix("jpeg/malformed.jpg");
    const { bytes } = processJpeg(b, ALL_STRIP);
    expect(bytes).toBeNull();
  });
});

describe("Disk fixtures — PNG (real encoder output)", () => {
  it("clean.png decodes to 1×1 and has no metadata", async () => {
    const b = fix("png/clean.png");
    await assertDecodesAs(b, 1, 1);
    const { detection } = processPng(b, null);
    expect(detection.exif).toBe(false);
    expect(detection.pngChunks).toBe(false);
    expect(detection.c2pa).toBe(false);
  });

  it("exif.png detects eXIf and strips it cleanly", async () => {
    const b = fix("png/exif.png");
    const { detection } = processPng(b, null);
    expect(detection.exif).toBe(true);

    const { bytes } = processPng(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    await assertFullyDecodable(bytes!);
    const { detection: after } = processPng(bytes!, null);
    expect(after.exif).toBe(false);
  });

  it("xmp.png detects XMP iTXt and strips it cleanly", async () => {
    const b = fix("png/xmp.png");
    const { detection } = processPng(b, null);
    expect(detection.xmp).toBe(true);

    const { bytes } = processPng(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processPng(bytes!, null);
    expect(after.xmp).toBe(false);
  });

  it("text-chunks.png detects tEXt and strips it cleanly", async () => {
    const b = fix("png/text-chunks.png");
    const { detection } = processPng(b, null);
    expect(detection.pngChunks).toBe(true);

    const { bytes } = processPng(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processPng(bytes!, null);
    expect(after.pngChunks).toBe(false);
  });

  it("c2pa.png detects caBX and strips it cleanly", async () => {
    const b = fix("png/c2pa.png");
    const { detection } = processPng(b, null);
    expect(detection.c2pa).toBe(true);

    const { bytes } = processPng(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processPng(bytes!, null);
    expect(after.c2pa).toBe(false);
  });

  it("all-meta.png strips all metadata, output is still decodable 1×1", async () => {
    const b = fix("png/all-meta.png");
    const { detection } = processPng(b, null);
    expect(detection.exif).toBe(true);
    expect(detection.xmp).toBe(true);
    expect(detection.pngChunks).toBe(true);
    expect(detection.c2pa).toBe(true);

    const { bytes } = processPng(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    await assertFullyDecodable(bytes!);
    const { detection: after } = processPng(bytes!, null);
    expect(after).toEqual({ exif: false, xmp: false, c2pa: false, pngChunks: false });
  });

  it("all-meta.png with only eXIf stripped: text chunks survive, image still decodable", async () => {
    const b = fix("png/all-meta.png");
    const { bytes } = processPng(b, { ...NO_STRIP, exif: true });
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processPng(bytes!, null);
    expect(after.exif).toBe(false);
    expect(after.pngChunks).toBe(true);
  });

  it("malformed.png parser returns null bytes (triggers canvas fallback)", () => {
    const b = fix("png/malformed.png");
    const { bytes } = processPng(b, ALL_STRIP);
    expect(bytes).toBeNull();
  });
});

describe("Disk fixtures — WebP (real encoder output)", () => {
  it("clean.webp decodes to 1×1 and has no metadata", async () => {
    const b = fix("webp/clean.webp");
    await assertDecodesAs(b, 1, 1);
    const { detection } = processWebp(b, null);
    expect(detection.exif).toBe(false);
    expect(detection.xmp).toBe(false);
    expect(detection.c2pa).toBe(false);
  });

  it("exif.webp detects EXIF and strips it cleanly", async () => {
    const b = fix("webp/exif.webp");
    const { detection } = processWebp(b, null);
    expect(detection.exif).toBe(true);

    const { bytes } = processWebp(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    await assertFullyDecodable(bytes!);
    const { detection: after } = processWebp(bytes!, null);
    expect(after.exif).toBe(false);
  });

  it("xmp.webp detects XMP and strips it cleanly", async () => {
    const b = fix("webp/xmp.webp");
    const { detection } = processWebp(b, null);
    expect(detection.xmp).toBe(true);

    const { bytes } = processWebp(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processWebp(bytes!, null);
    expect(after.xmp).toBe(false);
  });

  it("c2pa.webp detects C2PA and strips it cleanly", async () => {
    const b = fix("webp/c2pa.webp");
    const { detection } = processWebp(b, null);
    expect(detection.c2pa).toBe(true);

    const { bytes } = processWebp(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processWebp(bytes!, null);
    expect(after.c2pa).toBe(false);
  });

  it("all-meta.webp strips all metadata, output is still decodable 1×1", async () => {
    const b = fix("webp/all-meta.webp");
    const { detection } = processWebp(b, null);
    expect(detection.exif).toBe(true);
    expect(detection.xmp).toBe(true);
    expect(detection.c2pa).toBe(true);

    const { bytes } = processWebp(b, ALL_STRIP);
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    await assertFullyDecodable(bytes!);
    const { detection: after } = processWebp(bytes!, null);
    expect(after.exif).toBe(false);
    expect(after.xmp).toBe(false);
    expect(after.c2pa).toBe(false);
  });

  it("all-meta.webp with only EXIF stripped: XMP + C2PA survive, image still decodable", async () => {
    const b = fix("webp/all-meta.webp");
    const { bytes } = processWebp(b, { ...NO_STRIP, exif: true });
    expect(bytes).not.toBeNull();
    await assertDecodesAs(bytes!, 1, 1);
    const { detection: after } = processWebp(bytes!, null);
    expect(after.exif).toBe(false);
    expect(after.xmp).toBe(true);
    expect(after.c2pa).toBe(true);
  });

  it("malformed.webp parser returns null bytes (triggers canvas fallback)", () => {
    const b = fix("webp/malformed.webp");
    const { bytes } = processWebp(b, ALL_STRIP);
    expect(bytes).toBeNull();
  });
});

// ===========================================================================
// stripMetadata — integration tests with real fixture Blobs
//
// These tests exercise the complete stripMetadata export end-to-end.
// Unlike the unit tests above which call processJpeg/processPng/processWebp
// directly, these tests go through the full pipeline: File.arrayBuffer() →
// format detection → byte-strip → Blob output.  The happy-path tests run
// purely in Node without any DOM mocking; the canvas-fallback test at the
// bottom reuses the same mocked-DOM setup as the earlier describe block.
// ===========================================================================

describe("stripMetadata — integration (real fixture Blobs)", () => {
  it("strips EXIF from a real JPEG fixture and returns a clean Blob", async () => {
    const b = fix("jpeg/exif.jpg");
    const file = new File([b], "exif.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    const { detection } = processJpeg(resultBytes, null);
    expect(detection.exif).toBe(false);
  });

  it("strips all metadata from a real all-meta JPEG and output is smaller", async () => {
    const b = fix("jpeg/all-meta.jpg");
    const file = new File([b], "all-meta.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeLessThan(b.length);
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    const { detection } = processJpeg(resultBytes, null);
    expect(detection.exif).toBe(false);
    expect(detection.xmp).toBe(false);
    expect(detection.c2pa).toBe(false);
  });

  it("strips EXIF from a real PNG fixture and returns a clean Blob", async () => {
    const b = fix("png/exif.png");
    const file = new File([b], "exif.png", { type: "image/png" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    const { detection } = processPng(resultBytes, null);
    expect(detection.exif).toBe(false);
  });

  it("strips all metadata from a real all-meta PNG and output is still valid PNG", async () => {
    const b = fix("png/all-meta.png");
    const file = new File([b], "all-meta.png", { type: "image/png" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    await assertDecodesAs(resultBytes, 1, 1);
    const { detection } = processPng(resultBytes, null);
    expect(detection.exif).toBe(false);
    expect(detection.xmp).toBe(false);
    expect(detection.pngChunks).toBe(false);
    expect(detection.c2pa).toBe(false);
  });

  it("strips EXIF from a real WebP fixture and returns a clean Blob", async () => {
    const b = fix("webp/exif.webp");
    const file = new File([b], "exif.webp", { type: "image/webp" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    const { detection } = processWebp(resultBytes, null);
    expect(detection.exif).toBe(false);
  });

  it("clean JPEG passes through byte-for-byte identical in size", async () => {
    const b = fix("jpeg/clean.jpg");
    const file = new File([b], "clean.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result.size).toBe(b.length);
  });

  it("clean PNG passes through byte-for-byte identical in size", async () => {
    const b = fix("png/clean.png");
    const file = new File([b], "clean.png", { type: "image/png" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result.size).toBe(b.length);
  });

  it("result Blob has the correct MIME type for JPEG input", async () => {
    const b = fix("jpeg/clean.jpg");
    const file = new File([b], "clean.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result.type).toBe("image/jpeg");
  });

  it("result Blob has the correct MIME type for PNG input", async () => {
    const b = fix("png/clean.png");
    const file = new File([b], "clean.png", { type: "image/png" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result.type).toBe("image/png");
  });

  it("result Blob has the correct MIME type for WebP input", async () => {
    const b = fix("webp/clean.webp");
    const file = new File([b], "clean.webp", { type: "image/webp" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result.type).toBe("image/webp");
  });
});

// ===========================================================================
// detectMetadata — integration tests
//
// Tests the detectMetadata export, which combines byte-level scanning with
// exifr augmentation.  The JPEG with a real TIFF IFD (Make = "Test") is
// constructed inline so that exifr's tiff parser fires and sets detection.exif
// via the augmentation branch in detectMetadata.
// ===========================================================================

// Builds a standalone TIFF file (not wrapped in JPEG) with a single Make tag.
//
// Using a raw TIFF is the cleanest way to test the exifr augmentation path in
// isolation: the byte-scanner (detectFromBytes) only recognises JPEG/PNG/WebP,
// so it returns empty detection for this input.  exifr.parse() with {tiff:true}
// reads the TIFF IFD directly and returns { Make: "TestCam" }, which triggers
// the augmentation branch and sets detection.exif = true.
//
// TIFF structure (little-endian):
//   [0-7]  header: "II" + magic(42) + IFD0-offset(8)
//   [8-25] IFD0: entry-count(1) + Make-entry(12) + next-IFD(0)
//   [26-32] value: "TestCam\0" (8 bytes, count = 8)
function makeStandaloneTiffWithMake(): Uint8Array {
  return new Uint8Array([
    // TIFF LE header (8 bytes)
    0x49, 0x49,             // "II" = little-endian
    0x2a, 0x00,             // magic = 42
    0x08, 0x00, 0x00, 0x00, // IFD0 at byte offset 8
    // IFD0 entry count (2 bytes)
    0x01, 0x00,             // 1 entry
    // IFD entry for tag 0x010F Make (12 bytes)
    0x0f, 0x01,             // tag = 0x010F (Make)
    0x02, 0x00,             // type = ASCII
    0x08, 0x00, 0x00, 0x00, // count = 8 ("TestCam\0")
    0x22, 0x00, 0x00, 0x00, // value offset = 34 (= 8+2+12+4+8 — past next-IFD)
    // next IFD offset (4 bytes)
    0x00, 0x00, 0x00, 0x00, // no next IFD
    // padding so value offset 34 aligns (8 bytes after the end of IFD)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // value at offset 34: "TestCam\0"
    0x54, 0x65, 0x73, 0x74, 0x43, 0x61, 0x6d, 0x00, // "TestCam\0"
  ]);
}

describe("detectMetadata — integration", () => {
  it("detects nothing in a clean JPEG", async () => {
    const blob = new Blob([fix("jpeg/clean.jpg")], { type: "image/jpeg" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(false);
    expect(result.xmp).toBe(false);
    expect(result.c2pa).toBe(false);
    expect(result.pngChunks).toBe(false);
  });

  it("detects EXIF via byte-scanner in exif.jpg fixture", async () => {
    const blob = new Blob([fix("jpeg/exif.jpg")], { type: "image/jpeg" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(true);
  });

  it("detects XMP via byte-scanner in xmp.jpg fixture", async () => {
    const blob = new Blob([fix("jpeg/xmp.jpg")], { type: "image/jpeg" });
    const result = await detectMetadata(blob);
    expect(result.xmp).toBe(true);
  });

  it("detects EXIF via exifr augmentation when byte-scanner returns nothing (standalone TIFF file)", async () => {
    // A raw TIFF file is not JPEG/PNG/WebP, so detectFromBytes → empty detection.
    // exifr.parse() reads the TIFF IFD directly and returns { Make: "TestCam" },
    // which is the only thing that can set detection.exif = true here.
    const bytes = makeStandaloneTiffWithMake();

    // Precondition: byte-scanner alone returns exif:false (0x49 "I" ≠ 0xFF JPEG marker)
    const { detection: byteOnly } = processJpeg(bytes, null);
    expect(byteOnly.exif).toBe(false);

    // detectMetadata augments via exifr and finds the Make tag
    const blob = new Blob([bytes], { type: "image/tiff" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(true);
  });

  it("detects PNG text chunks in text-chunks.png fixture", async () => {
    const blob = new Blob([fix("png/text-chunks.png")], { type: "image/png" });
    const result = await detectMetadata(blob);
    expect(result.pngChunks).toBe(true);
  });

  it("detects EXIF in an eXIf-bearing PNG fixture", async () => {
    const blob = new Blob([fix("png/exif.png")], { type: "image/png" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(true);
  });

  it("detects EXIF in a WebP EXIF fixture", async () => {
    const blob = new Blob([fix("webp/exif.webp")], { type: "image/webp" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(true);
  });

  it("detects all metadata types in all-meta.jpg fixture", async () => {
    const blob = new Blob([fix("jpeg/all-meta.jpg")], { type: "image/jpeg" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(true);
    expect(result.xmp).toBe(true);
    expect(result.c2pa).toBe(true);
  });

  it("detects all metadata types in all-meta.png fixture", async () => {
    const blob = new Blob([fix("png/all-meta.png")], { type: "image/png" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(true);
    expect(result.xmp).toBe(true);
    expect(result.pngChunks).toBe(true);
    expect(result.c2pa).toBe(true);
  });

  it("detects nothing in a clean PNG fixture", async () => {
    const blob = new Blob([fix("png/clean.png")], { type: "image/png" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(false);
    expect(result.xmp).toBe(false);
    expect(result.pngChunks).toBe(false);
    expect(result.c2pa).toBe(false);
  });
});
