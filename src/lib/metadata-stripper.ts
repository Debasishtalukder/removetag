import exifr from "exifr";

export type MetadataDetection = {
  exif: boolean;
  xmp: boolean;
  c2pa: boolean;
  pngChunks: boolean;
};

export type StripOptions = {
  exif: boolean;
  xmp: boolean;
  c2pa: boolean;
  pngChunks: boolean;
};

export type MetadataTag = {
  type: "exif" | "xmp" | "c2pa" | "png";
  key: string;
  value: string;
};

export type ProcessedFile = {
  id: string;
  originalFile: File;
  processedBlob?: Blob;
  status: "idle" | "processing" | "success" | "error";
  error?: string;
  detectedBefore: MetadataDetection;
  detectedAfter?: MetadataDetection;
  detailedTags?: MetadataTag[];
  fileOptions?: StripOptions;
};

const emptyDetection = (): MetadataDetection => ({
  exif: false,
  xmp: false,
  c2pa: false,
  pngChunks: false,
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const isPng = (b: Uint8Array) =>
  b.length > 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);

const isJpeg = (b: Uint8Array) =>
  b.length > 3 && b[0] === 0xff && b[1] === 0xd8;

const isWebp = (b: Uint8Array) =>
  b.length > 12 &&
  b[0] === 0x52 && // R
  b[1] === 0x49 && // I
  b[2] === 0x46 && // F
  b[3] === 0x46 && // F
  b[8] === 0x57 && // W
  b[9] === 0x45 && // E
  b[10] === 0x42 && // B
  b[11] === 0x50; // P

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[start + i]);
  return s;
};

const readUint32BE = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

// Search for an ASCII needle within b[start, end). Returns true if present.
const containsAscii = (
  b: Uint8Array,
  start: number,
  end: number,
  needle: string,
): boolean => {
  const limit = Math.min(end, b.length) - needle.length;
  for (let i = start; i <= limit; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (b[i + j] !== needle.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
};

const readUint32LE = (b: Uint8Array, i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

const writeUint32LE = (b: Uint8Array, i: number, value: number) => {
  b[i] = value & 0xff;
  b[i + 1] = (value >> 8) & 0xff;
  b[i + 2] = (value >> 16) & 0xff;
  b[i + 3] = (value >> 24) & 0xff;
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

// ---------- JPEG ----------

export type JpegResult = { detection: MetadataDetection; bytes: Uint8Array | null };

export const processJpeg = (
  b: Uint8Array,
  options: StripOptions | null,
): JpegResult => {
  const detection = emptyDetection();
  const kept: Uint8Array[] = [b.slice(0, 2)]; // SOI
  let i = 2;

  while (i < b.length) {
    if (b[i] !== 0xff) {
      // Malformed; bail out so caller can fall back.
      return { detection, bytes: null };
    }
    const marker = b[i + 1];

    // Standalone markers without length (RSTn, TEM, padding).
    if (marker === 0xd9) {
      kept.push(b.slice(i));
      i = b.length;
      break;
    }
    if (marker === 0xda) {
      // Start of scan: copy the rest verbatim (compressed data).
      kept.push(b.slice(i));
      i = b.length;
      break;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(b.slice(i, i + 2));
      i += 2;
      continue;
    }

    if (i + 4 > b.length) {
      return { detection, bytes: null };
    }
    const length = (b[i + 2] << 8) | b[i + 3];
    if (length < 2) {
      return { detection, bytes: null };
    }
    const segStart = i;
    const segEnd = i + 2 + length;
    if (segEnd > b.length) {
      return { detection, bytes: null };
    }

    let drop = false;
    const payloadStart = i + 4;
    const payloadLen = length - 2; // segment length includes the 2 length bytes

    if (marker === 0xe1) {
      // APP1: EXIF or XMP
      const id = ascii(b, payloadStart, Math.min(6, payloadLen));
      if (id.startsWith("Exif")) {
        detection.exif = true;
        if (options?.exif) drop = true;
      } else {
        const xmpId = ascii(b, payloadStart, Math.min(29, payloadLen));
        if (xmpId.startsWith("http://ns.adobe.com/xap/")) {
          detection.xmp = true;
          if (options?.xmp) drop = true;
        }
      }
    } else if (marker === 0xeb) {
      // APP11: only treat as C2PA when a JUMBF box is actually present.
      if (containsAscii(b, payloadStart, segEnd, "jumb")) {
        detection.c2pa = true;
        if (options?.c2pa) drop = true;
      }
    }

    if (!drop) kept.push(b.slice(segStart, segEnd));
    i = segEnd;
  }

  return { detection, bytes: options ? concat(kept) : null };
};

// ---------- PNG ----------

export type PngResult = { detection: MetadataDetection; bytes: Uint8Array | null };

const XMP_KEYWORD = "XML:com.adobe.xmp";

export const processPng = (
  b: Uint8Array,
  options: StripOptions | null,
): PngResult => {
  const detection = emptyDetection();
  const kept: Uint8Array[] = [b.slice(0, 8)]; // signature
  let i = 8;

  while (i + 8 <= b.length) {
    const length = readUint32BE(b, i);
    const type = ascii(b, i + 4, 4);
    const chunkEnd = i + 12 + length; // len(4) + type(4) + data + crc(4)
    // Bounds guard: reject overflowing / out-of-range lengths and fall back.
    if (chunkEnd > b.length || chunkEnd <= i) {
      return { detection, bytes: null };
    }

    let drop = false;
    const isTextChunk = type === "tEXt" || type === "zTXt" || type === "iTXt";

    if (isTextChunk) {
      detection.pngChunks = true;
      let isXmp = false;
      if (type === "iTXt") {
        const keyword = ascii(b, i + 8, Math.min(length, XMP_KEYWORD.length));
        if (keyword === XMP_KEYWORD) {
          isXmp = true;
          detection.xmp = true;
        }
      }
      if (options) {
        if (options.pngChunks) drop = true;
        else if (isXmp && options.xmp) drop = true;
      }
    } else if (type === "eXIf") {
      detection.exif = true;
      if (options?.exif) drop = true;
    } else if (type === "caBX") {
      // C2PA manifest store chunk for PNG.
      detection.c2pa = true;
      if (options?.c2pa) drop = true;
    }

    if (!drop) kept.push(b.slice(i, chunkEnd));
    i = chunkEnd;
  }

  return { detection, bytes: options ? concat(kept) : null };
};

// ---------- WebP ----------

export type WebpResult = { detection: MetadataDetection; bytes: Uint8Array | null };

export const processWebp = (
  b: Uint8Array,
  options: StripOptions | null,
): WebpResult => {
  const detection = emptyDetection();
  const header = b.slice(0, 12); // RIFF + size + WEBP
  const chunks: Uint8Array[] = [];
  let i = 12;

  while (i + 8 <= b.length) {
    const fourcc = ascii(b, i, 4);
    const size = readUint32LE(b, i + 4);
    const padded = size + (size % 2); // chunks are padded to even size
    const chunkEnd = i + 8 + padded;
    // Bounds guard: reject overflowing / out-of-range sizes and fall back.
    if (chunkEnd > b.length || chunkEnd <= i) {
      return { detection, bytes: null };
    }

    let drop = false;
    if (fourcc === "EXIF") {
      detection.exif = true;
      if (options?.exif) drop = true;
    } else if (fourcc === "XMP ") {
      detection.xmp = true;
      if (options?.xmp) drop = true;
    } else if (fourcc === "C2PA") {
      detection.c2pa = true;
      if (options?.c2pa) drop = true;
    }

    if (!drop) chunks.push(b.slice(i, chunkEnd));
    i = chunkEnd;
  }

  if (!options) return { detection, bytes: null };

  // Clear EXIF/XMP flag bits in VP8X header if we removed those chunks.
  const rebuilt = chunks.map((chunk) => {
    if (ascii(chunk, 0, 4) === "VP8X" && chunk.length >= 9) {
      const copy = chunk.slice();
      if (options.exif) copy[8] &= ~0x08;
      if (options.xmp) copy[8] &= ~0x04;
      return copy;
    }
    return chunk;
  });

  const body = concat(rebuilt);
  const out = concat([header, body]);
  // RIFF size = total file size - 8 (RIFF fourcc + size field).
  writeUint32LE(out, 4, out.length - 8);
  return { detection, bytes: out };
};

// ---------- Canvas fallback (guaranteed strip of everything) ----------

const canvasStrip = (file: File | Blob, mime: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob failed"));
        },
        mime,
        0.95,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image for processing"));
    };
    img.src = objectUrl;
  });

const detectFromBytes = (b: Uint8Array): MetadataDetection => {
  if (isJpeg(b)) return processJpeg(b, null).detection;
  if (isPng(b)) return processPng(b, null).detection;
  if (isWebp(b)) return processWebp(b, null).detection;
  return emptyDetection();
};

export const getDetailedMetadata = async (
  source: File | Blob,
): Promise<MetadataTag[]> => {
  const tags: MetadataTag[] = [];
  const sourceBuffer = await source.arrayBuffer();

  try {
    const parsed = await exifr.parse(sourceBuffer, {
      tiff: true,
      xmp: true,
      icc: false,
      iptc: true,
    });

    if (parsed) {
      const exifFields: [string, string][] = [
        ["Make", "Camera Make"],
        ["Model", "Camera Model"],
        ["DateTimeOriginal", "Date Taken"],
        ["GPSLatitude", "GPS Latitude"],
        ["GPSLongitude", "GPS Longitude"],
        ["Software", "Software"],
        ["LensModel", "Lens"],
        ["ExposureTime", "Exposure"],
        ["FNumber", "Aperture"],
        ["ISO", "ISO"],
      ];

      for (const [key, label] of exifFields) {
        if (parsed[key] !== undefined && parsed[key] !== null) {
          let value = String(parsed[key]);
          if (key === "ExposureTime" && typeof parsed[key] === "number" && parsed[key] < 1) {
            value = `1/${Math.round(1 / parsed[key])}s`;
          }
          if (key === "FNumber") value = `f/${parsed[key]}`;
          if (key === "GPSLatitude" || key === "GPSLongitude") {
            value = typeof parsed[key] === "number"
              ? parsed[key].toFixed(5)
              : String(parsed[key]);
          }
          tags.push({ type: "exif", key: label, value: value.slice(0, 80) });
        }
      }

      const xmpFields: [string, string][] = [
        ["CreatorTool", "Creator Tool"],
        ["creator", "Creator"],
        ["rights", "Rights"],
        ["description", "Description"],
        ["title", "Title"],
        ["subject", "Subject"],
      ];

      for (const [key, label] of xmpFields) {
        if (parsed[key] !== undefined && parsed[key] !== null) {
          const raw = Array.isArray(parsed[key]) ? parsed[key].join(", ") : String(parsed[key]);
          tags.push({ type: "xmp", key: label, value: raw.slice(0, 80) });
        }
      }
    }
  } catch {
    // exifr couldn't parse — no detailed tags available
  }

  try {
    const bytes = new Uint8Array(sourceBuffer);
    const detection = detectFromBytes(bytes);
    if (detection.c2pa) {
      tags.push({ type: "c2pa", key: "C2PA Manifest", value: "Content credentials present" });
    }
    if (detection.pngChunks && !tags.some(t => t.type === "png")) {
      tags.push({ type: "png", key: "Text Chunks", value: "Hidden text chunks detected" });
    }
  } catch {
    // byte-scan failed
  }

  return tags;
};

export const detectMetadata = async (
  source: File | Blob,
): Promise<MetadataDetection> => {
  const buffer = await source.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const detection = detectFromBytes(bytes);

  // Augment EXIF/XMP detection with exifr, which understands more layouts.
  // Pass the already-fetched ArrayBuffer so exifr reads bytes directly rather
  // than going through FileReader (which is unavailable in Node / workers).
  try {
    const parsed = await exifr.parse(buffer, {
      tiff: true,
      xmp: true,
      icc: false,
      iptc: true,
    });
    if (parsed) {
      if (
        parsed.Make ||
        parsed.Model ||
        parsed.DateTimeOriginal ||
        parsed.GPSLatitude ||
        parsed.Software ||
        parsed.LensModel
      ) {
        detection.exif = true;
      }
      if (parsed.xmp || parsed.Rights || parsed.CreatorTool) {
        detection.xmp = true;
      }
    }
  } catch {
    // exifr throwing just means it found nothing parseable; keep byte-scan result.
  }

  return detection;
};

export const stripMetadata = async (
  file: File,
  options: StripOptions,
): Promise<Blob> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let result: { bytes: Uint8Array | null } | null = null;
  let mime = file.type;

  try {
    if (isJpeg(bytes)) {
      result = processJpeg(bytes, options);
      mime = "image/jpeg";
    } else if (isPng(bytes)) {
      result = processPng(bytes, options);
      mime = "image/png";
    } else if (isWebp(bytes)) {
      result = processWebp(bytes, options);
      mime = "image/webp";
    }
  } catch {
    result = null;
  }

  if (result && result.bytes) {
    return new Blob([result.bytes as BlobPart], { type: mime });
  }

  // Fallback: re-encode through canvas which discards all metadata.
  const fallbackMime = ["image/jpeg", "image/png", "image/webp"].includes(
    file.type,
  )
    ? file.type
    : "image/png";
  return canvasStrip(file, fallbackMime);
};
