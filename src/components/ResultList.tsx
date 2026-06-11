import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, AlertCircle, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProcessedFile, MetadataDetection } from "@/lib/metadata-stripper";

type ResultListProps = {
  files: ProcessedFile[];
  onDownloadAll: () => void;
  onDownloadSingle: (file: ProcessedFile) => void;
};

type MetadataKey = keyof MetadataDetection;

const LABELS: { key: MetadataKey; label: string }[] = [
  { key: "exif", label: "EXIF" },
  { key: "xmp", label: "XMP" },
  { key: "c2pa", label: "C2PA" },
  { key: "pngChunks", label: "PNG Chunks" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function MetadataSummary({ file }: { file: ProcessedFile }) {
  const before = file.detectedBefore;
  const after = file.detectedAfter;
  const foundKeys = LABELS.filter(({ key }) => before[key]);

  if (foundKeys.length === 0) {
    return <p className="text-xs mt-1.5" style={{ color: "#6b7280" }}>No metadata found in this file.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {foundKeys.map(({ key, label }) => {
        const removed = after ? !after[key] : false;
        return (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={
              removed
                ? { backgroundColor: "#f0fdf4", color: "#15803d" }
                : { backgroundColor: "#fef9c3", color: "#a16207" }
            }
          >
            {removed ? <Check className="w-3 h-3" /> : null}
            {label}{after ? (removed ? " removed" : " kept") : " found"}
          </span>
        );
      })}
    </div>
  );
}

function BeforeAfterSlider({
  originalUrl,
  cleanedUrl,
  height = 160,
  onExpand,
  autoFocus = false,
  sliderPos,
  onSliderChange,
}: {
  originalUrl: string;
  cleanedUrl: string;
  height?: number | string;
  onExpand?: () => void;
  autoFocus?: boolean;
  sliderPos: number;
  onSliderChange: (pos: number) => void;
}) {
  const [isSnapping, setIsSnapping] = useState(false);
  const [showKeyHint, setShowKeyHint] = useState(false);
  const keyHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateSlider = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const SNAP_THRESHOLD = 5;
    let snapped = false;
    for (const snap of [0, 50, 100]) {
      if (Math.abs(pct - snap) <= SNAP_THRESHOLD) {
        pct = snap;
        snapped = true;
        break;
      }
    }
    setIsSnapping(snapped);
    onSliderChange(pct);
  }, [onSliderChange]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updateSlider(e.clientX);
  }, [updateSlider]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    updateSlider(e.clientX);
  }, [updateSlider]);

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSliderChange(Math.max(0, sliderPos - (e.shiftKey ? 10 : 2)));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSliderChange(Math.min(100, sliderPos + (e.shiftKey ? 10 : 2)));
    }
  }, [sliderPos, onSliderChange]);

  const HINT_SEEN_KEY = "removetag_keyboard_hint_seen";
  const HINT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

  const onFocus = useCallback(() => {
    const stored = localStorage.getItem(HINT_SEEN_KEY);
    if (stored) {
      const seenAt = parseInt(stored, 10);
      if (!isNaN(seenAt) && Date.now() - seenAt < HINT_EXPIRY_MS) return;
    }
    if (keyHintTimerRef.current) clearTimeout(keyHintTimerRef.current);
    setShowKeyHint(true);
    localStorage.setItem(HINT_SEEN_KEY, String(Date.now()));
    keyHintTimerRef.current = setTimeout(() => setShowKeyHint(false), 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (keyHintTimerRef.current) clearTimeout(keyHintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (autoFocus && containerRef.current) {
      containerRef.current.focus();
    }
  }, [autoFocus]);

  return (
    <div
      ref={containerRef}
      className="relative rounded-lg overflow-hidden select-none focus:outline-none"
      tabIndex={0}
      aria-label="Before/after comparison slider. Use arrow keys to move divider."
      style={{
        width: "100%",
        height,
        cursor: "ew-resize",
        border: "1px solid #e5e7eb",
        backgroundColor: "#f9fafb",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {/* Original image — full width, underneath */}
      <img
        src={originalUrl}
        alt="Original"
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          pointerEvents: "none",
          userSelect: "none",
        }}
      />

      {/* Cleaned image — clipped to right side of slider */}
      <img
        src={cleanedUrl}
        alt="Cleaned"
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          clipPath: `inset(0 0 0 ${sliderPos}%)`,
          transition: isSnapping ? "clip-path 120ms ease-out" : "none",
          pointerEvents: "none",
          userSelect: "none",
        }}
      />

      {/* Divider line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${sliderPos}%`,
          width: 2,
          backgroundColor: "#ffffff",
          transform: "translateX(-50%)",
          boxShadow: "0 0 4px rgba(0,0,0,0.3)",
          transition: isSnapping ? "left 120ms ease-out" : "none",
          pointerEvents: "none",
        }}
      />

      {/* Drag handle */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${sliderPos}%`,
          transform: "translate(-50%, -50%)",
          width: 32,
          height: 32,
          borderRadius: "50%",
          backgroundColor: "#ffffff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: isSnapping ? "left 120ms ease-out" : "none",
          pointerEvents: "none",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M5 8L2 5M2 5L5 2M2 5H14M11 8L14 5M14 5L11 2M14 5H2" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {/* Labels */}
      <span
        style={{
          position: "absolute",
          bottom: 6,
          left: 8,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "#fff",
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          pointerEvents: "none",
          opacity: sliderPos > 15 ? 1 : 0,
          transition: "opacity 0.15s",
        }}
      >
        Original
      </span>
      <span
        style={{
          position: "absolute",
          bottom: 6,
          right: 8,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "#fff",
          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
          pointerEvents: "none",
          opacity: sliderPos < 85 ? 1 : 0,
          transition: "opacity 0.15s",
        }}
      >
        Cleaned
      </span>

      {/* Expand button */}
      {onExpand && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          aria-label="Open full-screen comparison"
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 28,
            height: 28,
            borderRadius: "50%",
            backgroundColor: "rgba(0,0,0,0.45)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#fff",
            backdropFilter: "blur(2px)",
            zIndex: 10,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>
          </svg>
        </button>
      )}

      {/* Keyboard hint tooltip — appears briefly on focus */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 8,
          left: "50%",
          transform: "translateX(-50%)",
          backgroundColor: "rgba(0,0,0,0.72)",
          color: "#fff",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.01em",
          padding: "4px 10px",
          borderRadius: 20,
          whiteSpace: "nowrap",
          backdropFilter: "blur(8px)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          pointerEvents: "none",
          opacity: showKeyHint ? 1 : 0,
          transition: "opacity 0.4s ease",
          zIndex: 20,
        }}
      >
        ← → to compare
      </div>
    </div>
  );
}

function SizeComparison({ file }: { file: ProcessedFile }) {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [sharedSliderPos, setSharedSliderPos] = useState(50);
  const [showKeyHint, setShowKeyHint] = useState(false);
  const prevBlobRef = useRef<Blob | undefined>(undefined);
  const prevOrigRef = useRef<File | undefined>(undefined);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDoubleTapping, setIsDoubleTapping] = useState(false);
  const isDraggingRef = useRef(false);
  const didMoveRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPinchMidRef = useRef<{ x: number; y: number } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  const resetView = useCallback(() => {
    scaleRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const clampOffset = useCallback((ox: number, oy: number, s: number) => {
    const el = containerRef.current;
    if (!el) return { x: ox, y: oy };
    const maxX = Math.max(0, (s - 1) * el.clientWidth / 2);
    const maxY = Math.max(0, (s - 1) * el.clientHeight / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, ox)),
      y: Math.max(-maxY, Math.min(maxY, oy)),
    };
  }, []);
  useEffect(() => {
    if (file.originalFile !== prevOrigRef.current) {
      prevOrigRef.current = file.originalFile;
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      setOriginalUrl(URL.createObjectURL(file.originalFile));
    }
  }, [file.originalFile]);

  useEffect(() => {
    if (file.processedBlob === prevBlobRef.current) return;
    prevBlobRef.current = file.processedBlob;
    if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    if (file.processedBlob) {
      setCleanedUrl(URL.createObjectURL(file.processedBlob));
    } else {
      setCleanedUrl(null);
    }
  }, [file.processedBlob]);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    };
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;
    resetView();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !lightboxOpen) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const rect = el.getBoundingClientRect();
      const focalX = e.clientX - rect.left - rect.width / 2;
      const focalY = e.clientY - rect.top - rect.height / 2;
      const currentScale = scaleRef.current;
      const currentOffset = offsetRef.current;
      const newScale = Math.max(0.25, Math.min(12, currentScale * factor));
      const f = newScale / currentScale;
      const raw = {
        x: currentOffset.x * f + focalX * (1 - f),
        y: currentOffset.y * f + focalY * (1 - f),
      };
      const newOffset = clampOffset(raw.x, raw.y, newScale);
      scaleRef.current = newScale;
      offsetRef.current = newOffset;
      setScale(newScale);
      setOffset(newOffset);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;

    // Scroll locking
    const scrollY = window.scrollY;
    const body = document.body;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflowY = "scroll";

    // Key hint timer
    setShowKeyHint(true);
    const timer = setTimeout(() => setShowKeyHint(false), 2000);

    return () => {
      body.style.position = "";
      body.style.top = "";
      body.style.width = "";
      body.style.overflowY = "";
      window.scrollTo({ top: scrollY, behavior: "instant" as ScrollBehavior });
      clearTimeout(timer);
    };
  }, [lightboxOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    isDraggingRef.current = true;
    didMoveRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didMoveRef.current = true;
    const newOffset = clampOffset(
      dragStartRef.current.ox + dx,
      dragStartRef.current.oy + dy,
      scaleRef.current,
    );
    offsetRef.current = newOffset;
    setOffset(newOffset);
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    dragStartRef.current = null;
  };

  const handleBackdropClick = () => {
    if (!didMoveRef.current) setLightboxOpen(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDraggingRef.current = true;
      didMoveRef.current = false;
      dragStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        ox: offsetRef.current.x,
        oy: offsetRef.current.y,
      };
      lastPinchDistRef.current = null;
      lastPinchMidRef.current = null;
    } else if (e.touches.length === 2) {
      isDraggingRef.current = false;
      dragStartRef.current = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDistRef.current = Math.sqrt(dx * dx + dy * dy);
      lastPinchMidRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDraggingRef.current && dragStartRef.current) {
      const dx = e.touches[0].clientX - dragStartRef.current.x;
      const dy = e.touches[0].clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didMoveRef.current = true;
      const newOffset = clampOffset(
        dragStartRef.current.ox + dx,
        dragStartRef.current.oy + dy,
        scaleRef.current,
      );
      offsetRef.current = newOffset;
      setOffset(newOffset);
    } else if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ratio = dist / lastPinchDistRef.current;

      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const el = containerRef.current;
      const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      const focalX = midX - rect.left - rect.width / 2;
      const focalY = midY - rect.top - rect.height / 2;

      const currentScale = scaleRef.current;
      const currentOffset = offsetRef.current;
      const newScale = Math.max(0.25, Math.min(12, currentScale * ratio));
      const f = newScale / currentScale;
      const raw = {
        x: currentOffset.x * f + focalX * (1 - f),
        y: currentOffset.y * f + focalY * (1 - f),
      };
      const newOffset = clampOffset(raw.x, raw.y, newScale);

      scaleRef.current = newScale;
      offsetRef.current = newOffset;
      setScale(newScale);
      setOffset(newOffset);
      lastPinchDistRef.current = dist;
      lastPinchMidRef.current = { x: midX, y: midY };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) lastPinchDistRef.current = null;
    if (e.touches.length === 0) {
      isDraggingRef.current = false;
      dragStartRef.current = null;

      if (!didMoveRef.current && e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const now = Date.now();
        const last = lastTapRef.current;
        const DOUBLE_TAP_MS = 300;
        const DOUBLE_TAP_SLOP = 30;

        if (
          last &&
          now - last.time < DOUBLE_TAP_MS &&
          Math.abs(touch.clientX - last.x) < DOUBLE_TAP_SLOP &&
          Math.abs(touch.clientY - last.y) < DOUBLE_TAP_SLOP
        ) {
          lastTapRef.current = null;
          const el = containerRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            const focalX = touch.clientX - rect.left - rect.width / 2;
            const focalY = touch.clientY - rect.top - rect.height / 2;
            const currentScale = scaleRef.current;
            setIsDoubleTapping(true);
            setTimeout(() => setIsDoubleTapping(false), 250);
            if (currentScale > 1.05) {
              scaleRef.current = 1;
              offsetRef.current = { x: 0, y: 0 };
              setScale(1);
              setOffset({ x: 0, y: 0 });
            } else {
              const targetScale = 2.5;
              const f = targetScale / currentScale;
              const newOffset = {
                x: offsetRef.current.x * f + focalX * (1 - f),
                y: offsetRef.current.y * f + focalY * (1 - f),
              };
              scaleRef.current = targetScale;
              offsetRef.current = newOffset;
              setScale(targetScale);
              setOffset(newOffset);
            }
          }
        } else {
          lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
        }
      }
    }
  };

  if (!originalUrl || !cleanedUrl || !file.processedBlob) return null;

  const origSize = file.originalFile.size;
  const cleanedSize = file.processedBlob.size;
  const delta = origSize - cleanedSize;
  const savedKb = Math.round(delta / 1024);
  const minimal = Math.abs(delta) < 512;

  return (
    <>
      <div className="mt-3 space-y-2">
        <BeforeAfterSlider
          originalUrl={originalUrl}
          cleanedUrl={cleanedUrl}
          onExpand={() => setLightboxOpen(true)}
          sliderPos={sharedSliderPos}
          onSliderChange={setSharedSliderPos}
        />
        <div className="flex items-center gap-1.5 text-xs">
          <span style={{ color: "#9ca3af" }}>Original</span>
          <span className="font-medium" style={{ color: "#374151" }}>{formatBytes(origSize)}</span>
          <span style={{ color: "#d1d5db" }}>→</span>
          <span style={{ color: "#9ca3af" }}>Cleaned</span>
          <span className="font-medium" style={{ color: "#374151" }}>{formatBytes(cleanedSize)}</span>
          {minimal ? (
            <span style={{ color: "#6b7280" }} className="italic ml-1">· Metadata was minimal</span>
          ) : delta > 0 ? (
            <span className="font-semibold ml-1" style={{ color: "#16a34a" }}>
              · Saved {savedKb > 0 ? `${savedKb} KB` : formatBytes(delta)}
            </span>
          ) : (
            <span style={{ color: "#9ca3af" }} className="ml-1">· +{formatBytes(Math.abs(delta))} (re-encoded)</span>
          )}
        </div>
      </div>

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative flex flex-col w-full"
            style={{ maxWidth: "min(90vw, 1100px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header bar */}
            <div
              className="flex items-center gap-3 px-3 py-2 rounded-t-lg"
              style={{ backgroundColor: "rgba(15,15,15,0.9)", backdropFilter: "blur(4px)" }}
            >
              <span
                className="text-xs font-medium truncate"
                style={{ color: "#d1d5db", maxWidth: "40vw" }}
                title={file.originalFile.name}
              >
                {file.originalFile.name}
              </span>
              <span className="text-xs shrink-0 ml-auto" style={{ color: "#9ca3af" }}>
                ← / → keys to move divider
              </span>
              {/* Zoom buttons */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.max(0.25, Math.min(4, s - 0.25)))}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
                  aria-label="Zoom out"
                  style={{ color: "#9ca3af" }}
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                {scale !== 1 && (
                  <span className="text-xs tabular-nums w-8 text-center" style={{ color: "#9ca3af" }}>
                    {Math.round(scale * 100)}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.max(0.25, Math.min(4, s + 0.25)))}
                  className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors"
                  aria-label="Zoom in"
                  style={{ color: "#9ca3af" }}
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors shrink-0"
                aria-label="Close full-screen preview"
                style={{ color: "#9ca3af" }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Full-screen before/after slider with pinch-zoom, double-tap, and keyboard hint */}
            <div
              ref={containerRef}
              className="relative overflow-hidden"
              style={{ touchAction: "none", cursor: isDraggingRef.current ? "grabbing" : scale > 1 ? "grab" : "default", userSelect: "none" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onDoubleClick={resetView}
            >
              <div
                style={{
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                  transformOrigin: "center",
                  transition: isDoubleTapping ? "transform 0.2s ease-out" : isDraggingRef.current ? "none" : "transform 0.1s ease-out",
                  willChange: "transform",
                }}
              >
                <BeforeAfterSlider
                  originalUrl={originalUrl}
                  cleanedUrl={cleanedUrl}
                  height="75vh"
                  autoFocus
                  sliderPos={sharedSliderPos}
                  onSliderChange={setSharedSliderPos}
                />
              </div>
              {/* Keyboard hint tooltip */}
              <div
                aria-live="polite"
                aria-label="Use left and right arrow keys to move the divider"
                style={{
                  position: "absolute",
                  bottom: 20,
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "rgba(0,0,0,0.72)",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: "0.01em",
                  padding: "6px 14px",
                  borderRadius: 20,
                  whiteSpace: "nowrap",
                  backdropFilter: "blur(8px)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  pointerEvents: "none",
                  opacity: showKeyHint ? 1 : 0,
                  transition: "opacity 0.4s ease",
                  zIndex: 20,
                }}
              >
                ← → to compare
              </div>
            </div>

            {/* Footer bar */}
            <div
              className="flex items-center justify-between gap-4 px-3 py-2 rounded-b-lg"
              style={{ backgroundColor: "rgba(15,15,15,0.9)", backdropFilter: "blur(4px)" }}
            >
              <span className="text-xs" style={{ color: "#9ca3af" }}>
                Original&nbsp;<span className="font-medium" style={{ color: "#d1d5db" }}>{formatBytes(origSize)}</span>
              </span>
              <span className="text-xs" style={{ color: "#9ca3af" }}>
                Cleaned&nbsp;<span className="font-medium" style={{ color: "#d1d5db" }}>{formatBytes(cleanedSize)}</span>
                {!minimal && delta > 0 && (
                  <span className="ml-2 font-semibold" style={{ color: "#4ade80" }}>· −{savedKb > 0 ? `${savedKb} KB` : formatBytes(delta)}</span>
                )}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ResultList({ files, onDownloadAll, onDownloadSingle }: ResultListProps) {
  if (files.length === 0) return null;

  const allDone = files.every((f) => f.status === "success" || f.status === "error");
  const anySuccess = files.some((f) => f.status === "success");

  return (
    <div className="w-full mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold" style={{ color: "#0f0f0f" }}>Results</h3>
        {allDone && anySuccess && (
          <Button
            onClick={onDownloadAll}
            size="sm"
            className="gap-1.5 rounded-full"
            style={{ backgroundColor: "#7c3aed", color: "#fff" }}
          >
            <Download className="w-4 h-4" /> Download All (ZIP)
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {files.map((file) => (
          <div
            key={file.id}
            className="flex flex-col sm:flex-row sm:items-start justify-between p-4 rounded-xl gap-3"
            style={{ backgroundColor: "#ffffff", border: "1px solid #f3e8ff", boxShadow: "0 1px 8px rgba(124,58,237,0.06)" }}
          >
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: "#faf5ff" }}
              >
                {file.status === "processing" ? (
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#7c3aed" }} />
                ) : file.status === "success" ? (
                  <Check className="w-5 h-5" style={{ color: "#16a34a" }} />
                ) : (
                  <AlertCircle className="w-5 h-5 text-destructive" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate" style={{ color: "#0f0f0f", maxWidth: "240px" }}>
                  {file.originalFile.name}
                </p>
                <div className="text-xs mt-0.5" style={{ color: "#6b7280" }}>
                  {file.status === "processing" && "Cleaning…"}
                  {file.status === "success" && <span style={{ color: "#16a34a" }}>Cleaned &amp; ready</span>}
                  {file.status === "error" && <span className="text-destructive">{file.error}</span>}
                </div>
                {file.status !== "error" && <MetadataSummary file={file} />}
                {file.status === "success" && <SizeComparison file={file} />}
              </div>
            </div>

            {file.status === "success" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto shrink-0 rounded-full"
                style={{ borderColor: "#e9d5ff", color: "#7c3aed", minHeight: "44px" }}
                onClick={() => onDownloadSingle(file)}
              >
                <Download className="w-4 h-4 mr-1.5" /> Download
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
