import { useState, useEffect, useRef, useCallback } from "react";
import JSZip from "jszip";
import { UploadZone } from "@/components/UploadZone";
import { ResultList } from "@/components/ResultList";
import { RecentActivity } from "@/components/RecentActivity";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  detectMetadata,
  stripMetadata,
  getDetailedMetadata,
  ProcessedFile,
  StripOptions,
  MetadataTag,
  MetadataDetection,
} from "@/lib/metadata-stripper";
import { useCleanHistory } from "@/hooks/useCleanHistory";
import { GripVertical, X, ChevronDown, ChevronRight } from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ── badge colors ──────────────────────────────────────────────────────────────

const BADGE: Record<MetadataTag["type"], { bg: string; color: string }> = {
  exif: { bg: "#dbeafe", color: "#1d4ed8" },
  xmp:  { bg: "#ede9fe", color: "#6d28d9" },
  c2pa: { bg: "#fee2e2", color: "#b91c1c" },
  png:  { bg: "#ffedd5", color: "#c2410c" },
};

// ── per-file toggles config ──────────────────────────────────────────────────

const TOGGLES: { key: keyof StripOptions; label: string; tooltip: string }[] = [
  { key: "exif",      label: "EXIF",  tooltip: "Camera model, GPS & timestamps" },
  { key: "xmp",       label: "XMP",   tooltip: "AI tool names, prompts & edit history" },
  { key: "c2pa",      label: "C2PA",  tooltip: "Content credentials & AI generation markers" },
  { key: "pngChunks", label: "PNG",   tooltip: "Hidden text chunks in PNG files" },
];

const GLOBAL_OPTS = [
  { key: "exif" as const,      label: "EXIF Data" },
  { key: "xmp" as const,       label: "XMP Tags" },
  { key: "c2pa" as const,      label: "C2PA Signatures" },
  { key: "pngChunks" as const, label: "PNG Chunks" },
];

// ── FileQueueItem ─────────────────────────────────────────────────────────────

function FileQueueItem({
  file,
  index,
  dragSrcIdx,
  dragOverIdx,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onRemove,
  onOptionChange,
}: {
  file: ProcessedFile;
  index: number;
  dragSrcIdx: number | null;
  dragOverIdx: number | null;
  onDragStart: (i: number) => void;
  onDragOver: (i: number) => void;
  onDrop: (i: number) => void;
  onDragEnd: () => void;
  onRemove: (id: string) => void;
  onOptionChange: (id: string, key: keyof StripOptions, val: boolean) => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file.originalFile);
    setThumbUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file.originalFile]);

  const opts = file.fileOptions ?? { exif: true, xmp: true, c2pa: true, pngChunks: true };
  const det = file.detectedBefore;
  const hasAny = det.exif || det.xmp || det.c2pa || det.pngChunks;
  const tags: MetadataTag[] = file.detailedTags ?? [];
  const isDraggingThis = dragSrcIdx === index;
  const isDropTarget = dragOverIdx === index && dragSrcIdx !== null && dragSrcIdx !== index;

  return (
    <div
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(index); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(index); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDrop(index); }}
      onDragEnd={onDragEnd}
      className="rounded-xl p-3 flex flex-col gap-2 transition-all"
      style={{
        opacity: isDraggingThis ? 0.45 : 1,
        backgroundColor: "#ffffff",
        border: isDropTarget ? "2px solid #7c3aed" : "1px solid #f3e8ff",
        boxShadow: "0 1px 6px rgba(124,58,237,0.05)",
      }}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Drag handle — desktop only */}
        <div
          className="hidden sm:flex shrink-0 cursor-grab active:cursor-grabbing items-center"
          style={{ color: "#d1d5db", minHeight: "44px", minWidth: "20px" }}
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Thumbnail */}
        <div
          className="shrink-0 rounded-lg overflow-hidden"
          style={{ width: 40, height: 40, border: "1px solid #f3e8ff", backgroundColor: "#faf5ff" }}
        >
          {thumbUrl && <img src={thumbUrl} alt="" className="w-full h-full object-cover" />}
        </div>

        {/* Name + meta toggle */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "#0f0f0f", maxWidth: "200px" }}>
            {file.originalFile.name}
          </p>
          <p className="text-xs flex items-center gap-1.5 flex-wrap" style={{ color: "#6b7280" }}>
            <span>{formatBytes(file.originalFile.size)}</span>
            {hasAny ? (
              <button
                onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-0.5 font-medium hover:underline"
                style={{ color: "#7c3aed" }}
              >
                {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {open ? "Hide tags" : "Show tags"}
              </button>
            ) : (
              <span style={{ color: "#16a34a" }}>✓ Clean</span>
            )}
          </p>
        </div>

        {/* Per-file toggles — desktop */}
        <div className="hidden sm:flex items-center gap-1">
          {TOGGLES.map(({ key, label, tooltip }) => {
            const on = opts[key];
            return (
              <button
                key={key}
                title={tooltip}
                onClick={() => onOptionChange(file.id, key, !on)}
                className="text-[10px] font-semibold rounded-full transition-colors"
                style={{
                  backgroundColor: on ? "#7c3aed" : "#e5e7eb",
                  color: on ? "#fff" : "#6b7280",
                  padding: "3px 8px",
                  minHeight: "22px",
                  minWidth: "36px",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Remove */}
        <button
          onClick={() => onRemove(file.id)}
          title="Remove file"
          className="shrink-0 rounded-full flex items-center justify-center transition-colors hover:bg-red-50"
          style={{ width: 28, height: 28, color: "#9ca3af", minHeight: "44px", minWidth: "28px" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Per-file toggles — mobile */}
      <div className="sm:hidden grid grid-cols-4 gap-1">
        {TOGGLES.map(({ key, label, tooltip }) => {
          const on = opts[key];
          return (
            <button
              key={key}
              title={tooltip}
              onClick={() => onOptionChange(file.id, key, !on)}
              className="text-[10px] font-semibold rounded-full py-1.5 transition-colors text-center"
              style={{
                backgroundColor: on ? "#7c3aed" : "#e5e7eb",
                color: on ? "#fff" : "#6b7280",
                minHeight: "32px",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Metadata inspector */}
      {open && (
        <div
          className="overflow-y-auto pt-2 mt-1 flex flex-col gap-1"
          style={{ borderTop: "1px solid #f3e8ff", maxHeight: "200px" }}
        >
          {tags.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {det.exif && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: BADGE.exif.bg, color: BADGE.exif.color }}>EXIF detected</span>}
              {det.xmp  && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: BADGE.xmp.bg,  color: BADGE.xmp.color }}>XMP detected</span>}
              {det.c2pa && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: BADGE.c2pa.bg, color: BADGE.c2pa.color }}>C2PA detected</span>}
              {det.pngChunks && <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: BADGE.png.bg, color: BADGE.png.color }}>PNG chunks detected</span>}
              {!hasAny && <span className="text-xs italic" style={{ color: "#9ca3af" }}>Nothing found</span>}
            </div>
          )}
          {tags.map((tag, i) => {
            const s = BADGE[tag.type];
            return (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-bold uppercase"
                  style={{ fontSize: "9px", backgroundColor: s.bg, color: s.color }}
                >
                  {tag.type}
                </span>
                <span style={{ color: "#6b7280" }} className="shrink-0">{tag.key}:</span>
                <span className="font-medium truncate" style={{ color: "#374151" }}>{tag.value}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

const TAG_LABEL_MAP: { key: keyof MetadataDetection; label: string }[] = [
  { key: "exif",      label: "EXIF" },
  { key: "xmp",       label: "XMP" },
  { key: "c2pa",      label: "C2PA" },
  { key: "pngChunks", label: "PNG Chunks" },
];

function getTagsRemoved(before: MetadataDetection, after: MetadataDetection): string[] {
  return TAG_LABEL_MAP
    .filter(({ key }) => before[key] && !after[key])
    .map(({ label }) => label);
}

// ── ToolSection ───────────────────────────────────────────────────────────────

export function ToolSection() {
  const { history, addEntries, clearHistory } = useCleanHistory();
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [globalOptions, setGlobalOptions] = useState<StripOptions>({
    exif: true, xmp: true, c2pa: true, pngChunks: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalToProcess, setTotalToProcess] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const idleFiles  = files.filter(f => f.status === "idle");
  const activeFiles = files.filter(f => f.status !== "idle");
  const allDone = !isProcessing && files.length > 0 && files.every(f => f.status === "success" || f.status === "error");

  // ── clipboard paste ──────────────────────────────────────────────────────

  const handleFilesAdded = useCallback(async (newFiles: File[]) => {
    const processable = await Promise.all(
      newFiles.map(async (f) => {
        const id = Math.random().toString(36).substring(7);
        const [detection, detailedTags] = await Promise.all([
          detectMetadata(f),
          getDetailedMetadata(f),
        ]);
        return {
          id,
          originalFile: f,
          status: "idle",
          detectedBefore: detection,
          detailedTags,
          fileOptions: { exif: true, xmp: true, c2pa: true, pngChunks: true },
        } as ProcessedFile;
      })
    );
    setFiles(prev => [...processable, ...prev]);
  }, []);

  const handleFilesAddedRef = useRef(handleFilesAdded);
  useEffect(() => { handleFilesAddedRef.current = handleFilesAdded; }, [handleFilesAdded]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) imgs.push(f);
        }
      }
      if (imgs.length > 0) {
        handleFilesAddedRef.current(imgs);
        showToast("Image pasted ✓");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [showToast]);

  // ── drag reorder ─────────────────────────────────────────────────────────

  const handleDragStart = (i: number) => setDragSrcIdx(i);
  const handleDragOver  = (i: number) => setDragOverIdx(i);
  const handleDragEnd   = () => { setDragSrcIdx(null); setDragOverIdx(null); };

  const handleDrop = (toIdx: number) => {
    if (dragSrcIdx === null || dragSrcIdx === toIdx) {
      setDragSrcIdx(null);
      setDragOverIdx(null);
      return;
    }
    const idle = [...idleFiles];
    const [moved] = idle.splice(dragSrcIdx, 1);
    idle.splice(toIdx, 0, moved);
    setFiles([...idle, ...activeFiles]);
    setDragSrcIdx(null);
    setDragOverIdx(null);
  };

  // ── per-file option toggle ────────────────────────────────────────────────

  const handleOptionChange = (id: string, key: keyof StripOptions, val: boolean) => {
    setFiles(prev =>
      prev.map(f =>
        f.id === id
          ? { ...f, fileOptions: { ...(f.fileOptions ?? globalOptions), [key]: val } }
          : f
      )
    );
  };

  const handleRemove = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  // ── process ───────────────────────────────────────────────────────────────

  const handleProcess = async () => {
    const count = files.filter(f => f.status === "idle").length;
    setTotalToProcess(count);
    setProcessedCount(0);
    setIsProcessing(true);

    const updated = [...files];
    let done = 0;
    const historyBatch: { filename: string; fileSize: number; tagsRemoved: string[] }[] = [];

    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status !== "idle") continue;

      updated[i] = { ...updated[i], status: "processing" };
      setFiles([...updated]);

      try {
        const opts = updated[i].fileOptions ?? globalOptions;
        const cleaned = await stripMetadata(updated[i].originalFile, opts);
        const detectedAfter = await detectMetadata(cleaned);
        updated[i] = {
          ...updated[i],
          processedBlob: cleaned,
          status: "success",
          detectedAfter,
        };
        historyBatch.push({
          filename: updated[i].originalFile.name,
          fileSize: updated[i].originalFile.size,
          tagsRemoved: getTagsRemoved(updated[i].detectedBefore, detectedAfter),
        });
      } catch (err) {
        updated[i] = {
          ...updated[i],
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
      done++;
      setProcessedCount(done);
      setFiles([...updated]);
    }

    if (historyBatch.length > 0) {
      addEntries(historyBatch);
    }

    setIsProcessing(false);
  };

  // ── download ──────────────────────────────────────────────────────────────

  const handleDownloadSingle = (file: ProcessedFile) => {
    if (!file.processedBlob) return;
    const url = URL.createObjectURL(file.processedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleaned_${file.originalFile.name}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = async () => {
    const zip = new JSZip();
    const successes = files.filter(f => f.status === "success" && f.processedBlob);
    if (!successes.length) return;
    successes.forEach(f => zip.file(`cleaned_${f.originalFile.name}`, f.processedBlob!));
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cleaned_images.zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── progress bar ─────────────────────────────────────────────────────────

  const pct = totalToProcess > 0 ? Math.min(100, Math.round((processedCount / totalToProcess) * 100)) : 0;
  const currentFile = Math.min(processedCount + 1, totalToProcess);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto w-full">
      <div
        className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm"
        style={{ border: "1px solid #f3e8ff" }}
      >
        {/* Recent activity */}
        <RecentActivity history={history} onClear={clearHistory} />

        {/* Upload zone */}
        <UploadZone onFilesAdded={handleFilesAdded} />

        {/* Global checkbox cards */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GLOBAL_OPTS.map(({ key, label }) => {
            const checked = globalOptions[key];
            return (
              <div
                key={key}
                className="flex items-center gap-2 p-2.5 rounded-lg cursor-pointer select-none transition-all"
                style={{
                  backgroundColor: "#faf5ff",
                  border: `1px solid ${checked ? "#7c3aed" : "#e9d5ff"}`,
                  minHeight: "44px",
                }}
                onClick={() => setGlobalOptions(prev => ({ ...prev, [key]: !prev[key] }))}
              >
                <Checkbox
                  id={`g-${key}`}
                  checked={checked}
                  onCheckedChange={c => setGlobalOptions(prev => ({ ...prev, [key]: !!c }))}
                  onClick={e => e.stopPropagation()}
                />
                <Label
                  htmlFor={`g-${key}`}
                  className="text-xs font-medium cursor-pointer"
                  style={{ color: checked ? "#7c3aed" : "#6b7280" }}
                >
                  {label}
                </Label>
              </div>
            );
          })}
        </div>

        {/* Batch progress bar */}
        {isProcessing && (
          <div className="mt-5">
            <div className="flex justify-between text-xs mb-1.5" style={{ color: "#6b7280" }}>
              <span>Processing file {currentFile} of {totalToProcess}…</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2.5 w-full rounded-full overflow-hidden" style={{ backgroundColor: "#f3e8ff" }}>
              <div
                className="h-full rounded-full rt-progress-bar"
                style={{
                  width: `${pct}%`,
                  backgroundColor: "#7c3aed",
                  transition: "width 0.35s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* All done banner */}
        {allDone && (
          <div
            className="mt-4 flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg"
            style={{ color: "#16a34a", backgroundColor: "#f0fdf4" }}
          >
            ✓ All files cleaned
          </div>
        )}

        {/* Idle file queue */}
        {idleFiles.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium mb-2" style={{ color: "#6b7280" }}>
              {idleFiles.length} file{idleFiles.length !== 1 ? "s" : ""} queued
              <span className="ml-1 hidden sm:inline" style={{ color: "#c4b5fd" }}>— drag to reorder</span>
            </p>
            <div className="flex flex-col gap-2">
              {idleFiles.map((file, idx) => (
                <FileQueueItem
                  key={file.id}
                  file={file}
                  index={idx}
                  dragSrcIdx={dragSrcIdx}
                  dragOverIdx={dragOverIdx}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  onRemove={handleRemove}
                  onOptionChange={handleOptionChange}
                />
              ))}
            </div>
          </div>
        )}

        {/* Clean button */}
        {idleFiles.length > 0 && !isProcessing && (
          <div className="mt-5">
            <Button
              onClick={handleProcess}
              size="lg"
              className="w-full sm:w-auto px-8 rounded-full"
              style={{ backgroundColor: "#7c3aed", color: "#fff", minHeight: "44px" }}
            >
              Clean {idleFiles.length} Image{idleFiles.length !== 1 ? "s" : ""}
            </Button>
          </div>
        )}

        {/* Results */}
        {activeFiles.length > 0 && (
          <ResultList
            files={activeFiles}
            onDownloadAll={handleDownloadAll}
            onDownloadSingle={handleDownloadSingle}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-white text-sm font-semibold shadow-xl rt-toast-in"
          style={{ backgroundColor: "#7c3aed" }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
