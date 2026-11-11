import { useRef, useState } from "react";
import { FileAudio, FileImage, FileText, FileVideo, ShieldCheck, Upload, X } from "lucide-react";
import { formatBytes } from "../lib/format";

export interface FileDropMeta {
  width?: number;
  height?: number;
  duration?: number;
}

interface FileDropProps {
  file: File | null;
  meta?: FileDropMeta | null;
  onFile: (file: File) => void;
  onClear: () => void;
  accept?: string;
  hint: string;
  disabled?: boolean;
  kind?: "video" | "image" | "audio" | "file";
}

export function FileDrop({
  file,
  meta,
  onFile,
  onClear,
  accept = "video/*,audio/*",
  hint,
  disabled,
  kind = "video",
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const Icon = kind === "image" ? FileImage : kind === "audio" ? FileAudio : kind === "file" ? FileText : FileVideo;

  const take = (files: FileList | null) => {
    const next = files?.[0];
    if (next) onFile(next);
  };

  if (file) {
    return (
      <div className="file-card">
        <div className={`file-icon file-icon-${kind}`}>
          <Icon size={26} />
        </div>
        <div className="file-details">
          <strong title={file.name}>{file.name}</strong>
          <span>
            {formatBytes(file.size)}
            {typeof meta?.duration === "number" && meta.duration > 0 ? ` · ${Math.round(meta.duration)}s` : ""}
            {typeof meta?.width === "number" && meta.width > 0 && typeof meta?.height === "number"
              ? ` · ${meta.width}×${meta.height}`
              : ""}
          </span>
        </div>
        <button className="icon-button" type="button" onClick={onClear} aria-label="Remove file" disabled={disabled}>
          <X size={18} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`dropzone ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) take(event.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="dropzone-icon">
        <Upload size={26} />
      </div>
      <strong>Drop a file here, or click to choose</strong>
      <span>{hint}</span>
      <div className="dropzone-trust">
        <ShieldCheck size={14} /> Processed on your device — never uploaded
      </div>
    </div>
  );
}
