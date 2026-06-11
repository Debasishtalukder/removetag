import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Trash2 } from "lucide-react";
import { HistoryEntry } from "@/hooks/useCleanHistory";

type RecentActivityProps = {
  history: HistoryEntry[];
  onClear: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const TAG_STYLE: Record<string, { bg: string; color: string }> = {
  EXIF:  { bg: "#dbeafe", color: "#1d4ed8" },
  XMP:   { bg: "#ede9fe", color: "#6d28d9" },
  C2PA:  { bg: "#fee2e2", color: "#b91c1c" },
  "PNG Chunks": { bg: "#ffedd5", color: "#c2410c" },
};

export function RecentActivity({ history, onClear }: RecentActivityProps) {
  const [open, setOpen] = useState(false);

  if (history.length === 0) return null;

  return (
    <div
      className="mb-4 rounded-xl overflow-hidden"
      style={{ border: "1px solid #f3e8ff", backgroundColor: "#faf5ff" }}
    >
      {/* Header row */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4" style={{ color: "#7c3aed" }} />
          <span className="text-sm font-semibold" style={{ color: "#0f0f0f" }}>
            Recent activity
          </span>
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: "#ede9fe", color: "#7c3aed" }}
          >
            {history.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {open && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="flex items-center gap-1 text-xs rounded-full px-2 py-0.5 transition-colors hover:bg-red-50"
              style={{ color: "#9ca3af" }}
              title="Clear history"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
          {open ? (
            <ChevronDown className="w-4 h-4" style={{ color: "#7c3aed" }} />
          ) : (
            <ChevronRight className="w-4 h-4" style={{ color: "#7c3aed" }} />
          )}
        </div>
      </button>

      {/* Entry list */}
      {open && (
        <div
          className="px-4 pb-3 flex flex-col gap-2 overflow-y-auto"
          style={{ maxHeight: "280px" }}
        >
          {history.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 py-2 rounded-lg px-2"
              style={{ backgroundColor: "#ffffff", border: "1px solid #f3e8ff" }}
            >
              {/* Icon */}
              <div
                className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5"
                style={{ backgroundColor: "#f3e8ff" }}
              >
                <span className="text-[10px] font-bold" style={{ color: "#7c3aed" }}>
                  ✓
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "#0f0f0f", maxWidth: "260px" }}
                  title={entry.filename}
                >
                  {entry.filename}
                </p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-xs" style={{ color: "#9ca3af" }}>
                    {formatBytes(entry.fileSize)}
                  </span>
                  <span style={{ color: "#e5e7eb" }}>·</span>
                  <span className="text-xs" style={{ color: "#9ca3af" }}>
                    {formatDate(entry.date)}
                  </span>
                </div>
                {entry.tagsRemoved.length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {entry.tagsRemoved.map((tag) => {
                      const s = TAG_STYLE[tag] ?? { bg: "#f3f4f6", color: "#6b7280" };
                      return (
                        <span
                          key={tag}
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: s.bg, color: s.color }}
                        >
                          {tag} removed
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
                    No metadata found
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
