// @vitest-environment jsdom
/**
 * Integration tests for the stripMetadata export in a jsdom environment.
 *
 * Running under jsdom gives us real browser-like File / Blob / URL globals,
 * which means File.arrayBuffer() goes through the actual Web API implementation
 * rather than Node's built-in. This validates the full pipeline end-to-end in
 * the environment closest to how the app runs in a browser.
 *
 * The happy-path tests don't exercise the canvas fallback (only valid images
 * are used), so no Canvas mocking is needed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  processJpeg,
  processPng,
  processWebp,
  stripMetadata,
  detectMetadata,
} from "./metadata-stripper";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
function fix(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(FIXTURES, rel)));
}

const ALL_STRIP = { exif: true, xmp: true, c2pa: true, pngChunks: true };

describe("stripMetadata — jsdom integration (real fixture Blobs in browser-like env)", () => {
  it("strips EXIF from exif.jpg via File.arrayBuffer() in jsdom and returns a clean Blob", async () => {
    const bytes = fix("jpeg/exif.jpg");
    const file = new File([bytes], "exif.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.size).toBeGreaterThan(0);
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    const { detection } = processJpeg(resultBytes, null);
    expect(detection.exif).toBe(false);
  });

  it("strips all metadata from all-meta.jpg and result is smaller than original", async () => {
    const bytes = fix("jpeg/all-meta.jpg");
    const file = new File([bytes], "all-meta.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result.size).toBeLessThan(bytes.length);
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    const { detection } = processJpeg(resultBytes, null);
    expect(detection.exif).toBe(false);
    expect(detection.xmp).toBe(false);
    expect(detection.c2pa).toBe(false);
  });

  it("strips EXIF from exif.png in jsdom environment", async () => {
    const bytes = fix("png/exif.png");
    const file = new File([bytes], "exif.png", { type: "image/png" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("image/png");
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    const { detection } = processPng(resultBytes, null);
    expect(detection.exif).toBe(false);
  });

  it("strips EXIF from exif.webp in jsdom environment", async () => {
    const bytes = fix("webp/exif.webp");
    const file = new File([bytes], "exif.webp", { type: "image/webp" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("image/webp");
    const resultBytes = new Uint8Array(await result.arrayBuffer());
    const { detection } = processWebp(resultBytes, null);
    expect(detection.exif).toBe(false);
  });

  it("clean JPEG passes through at the same byte size in jsdom environment", async () => {
    const bytes = fix("jpeg/clean.jpg");
    const file = new File([bytes], "clean.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result.size).toBe(bytes.length);
  });

  it("result Blob has the correct MIME type in jsdom environment", async () => {
    const bytes = fix("jpeg/clean.jpg");
    const file = new File([bytes], "clean.jpg", { type: "image/jpeg" });
    const result = await stripMetadata(file, ALL_STRIP);
    expect(result.type).toBe("image/jpeg");
  });
});

describe("detectMetadata — jsdom integration", () => {
  it("detects nothing in clean.jpg in jsdom environment", async () => {
    const blob = new Blob([fix("jpeg/clean.jpg")], { type: "image/jpeg" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(false);
    expect(result.xmp).toBe(false);
    expect(result.c2pa).toBe(false);
    expect(result.pngChunks).toBe(false);
  });

  it("detects EXIF in exif.jpg in jsdom environment", async () => {
    const blob = new Blob([fix("jpeg/exif.jpg")], { type: "image/jpeg" });
    const result = await detectMetadata(blob);
    expect(result.exif).toBe(true);
  });

  it("detects pngChunks in text-chunks.png in jsdom environment", async () => {
    const blob = new Blob([fix("png/text-chunks.png")], { type: "image/png" });
    const result = await detectMetadata(blob);
    expect(result.pngChunks).toBe(true);
  });
});
