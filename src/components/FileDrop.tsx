import { useRef, useState } from "react";
import { FileVideo, ShieldCheck, Upload, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import type { VideoMeta } from "../lib/media";

interface FileDropProps {
  file: File | null;
  meta?: VideoMeta | null;
  onFile: (file: File) => void;
  onClear: () => void;
  accept?: string;
  hint: string;
  disabled?: boolean;
}

export function FileDrop({ file, meta, onFile, onClear, accept = "video/*,audio/*", hint, disabled }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = (files: FileList | null) => {
    const next = files?.[0];
    if (next) onFile(next);
  };

  if (file) {
    return (
      <div className="file-card">
        <div className="file-icon">
          <FileVideo size={26} />
        </div>
        <div className="file-details">
          <strong title={file.name}>{file.name}</strong>
          <span>
            {formatBytes(file.size)}
            {meta && meta.duration > 0 ? ` · ${Math.round(meta.duration)}s` : ""}
            {meta && meta.width > 0 ? ` · ${meta.width}×${meta.height}` : ""}
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
      onDragLeave={() => setDragging(false)}
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
      tabIndex={0}
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
