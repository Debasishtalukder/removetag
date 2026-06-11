import { useState } from "react";
import { UploadCloud, AlertCircle } from "lucide-react";

type UploadZoneProps = {
  onFilesAdded: (files: File[]) => void;
  maxFiles?: number;
  maxSizeMB?: number;
};

export function UploadZone({ onFilesAdded, maxFiles = 20, maxSizeMB = 15 }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const validateAndAddFiles = (fileList: FileList | File[]) => {
    setError(null);
    const validFiles: File[] = [];
    let hasError = false;
    const filesArray = Array.from(fileList);

    if (filesArray.length > maxFiles) {
      setError(`You can only upload up to ${maxFiles} files at once.`);
      return;
    }

    for (const file of filesArray) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setError("Only JPG, PNG, and WebP images are supported.");
        hasError = true;
        break;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        setError(`File ${file.name} exceeds the ${maxSizeMB}MB limit.`);
        hasError = true;
        break;
      }
      validFiles.push(file);
    }

    if (!hasError && validFiles.length > 0) {
      onFilesAdded(validFiles);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndAddFiles(e.dataTransfer.files);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndAddFiles(e.target.files);
    }
  };

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all duration-200"
        style={{
          minHeight: "280px",
          backgroundColor: isDragging ? "#f3e8ff" : "#faf5ff",
          border: isDragging ? "2px solid #7c3aed" : "2px dashed #c4b5fd",
        }}
      >
        <input
          type="file"
          multiple
          accept="image/jpeg, image/png, image/webp"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          onChange={handleFileInput}
          title="Drop files here"
        />
        <div
          className="p-4 rounded-full mb-4 rt-upload-float"
          style={{ backgroundColor: isDragging ? "rgba(124,58,237,0.15)" : "rgba(124,58,237,0.08)" }}
        >
          <UploadCloud className="w-8 h-8" style={{ color: "#7c3aed" }} />
        </div>

        {isDragging ? (
          <h3 className="text-xl font-bold mb-2" style={{ color: "#7c3aed" }}>Drop it!</h3>
        ) : (
          <>
            <h3 className="text-lg font-semibold mb-2" style={{ color: "#0f0f0f" }}>
              <span className="hidden sm:block">Drag &amp; drop images here</span>
              <span className="block sm:hidden">Tap to upload</span>
            </h3>
            <p className="text-sm mb-5 text-center max-w-sm px-4" style={{ color: "#6b7280" }}>
              JPG, PNG, WebP · up to {maxSizeMB}MB · batch up to {maxFiles} files
            </p>
          </>
        )}

        {!isDragging && (
          <button
            type="button"
            className="pointer-events-none px-6 py-2 rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: "#7c3aed", minHeight: "44px", minWidth: "120px" }}
          >
            Browse Files
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
