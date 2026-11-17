import { useRef } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { formatBytes } from "../lib/format";

export interface ListedFile {
  file: File;
  /** A short line under the name, such as "1280×720 · 0:12". */
  detail?: string;
}

/**
 * The list of files for tools that take several (merge videos, slideshow). Order matters, so each row can move
 * up or down. The first row is the one the page previews.
 */
export function MultiFileList({
  items,
  onAdd,
  onRemove,
  onMove,
  accept,
  max,
  disabled = false,
  addLabel = "Add more files",
}: {
  items: ListedFile[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  accept: string;
  max: number;
  disabled?: boolean;
  addLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="multi-files">
      <ol className="multi-list" aria-label="Files, in the order they are used">
        {items.map((item, index) => (
          <li key={`${item.file.name}-${item.file.size}-${index}`} className="multi-row">
            <span className="multi-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="multi-name">
              <strong title={item.file.name}>{item.file.name}</strong>
              <small>
                {formatBytes(item.file.size)}
                {item.detail ? ` · ${item.detail}` : ""}
              </small>
            </span>
            <span className="multi-actions">
              <button type="button" className="icon-button" aria-label={`Move ${item.file.name} up`} disabled={disabled || index === 0} onClick={() => onMove(index, -1)}>
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move ${item.file.name} down`}
                disabled={disabled || index === items.length - 1}
                onClick={() => onMove(index, 1)}
              >
                <ArrowDown size={16} />
              </button>
              <button type="button" className="icon-button" aria-label={`Remove ${item.file.name}`} disabled={disabled} onClick={() => onRemove(index)}>
                <X size={16} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) onAdd(files);
        }}
      />
      <button type="button" className="button button-ghost button-small multi-add" disabled={disabled || items.length >= max} onClick={() => input.current?.click()}>
        <Plus size={15} /> {addLabel}
      </button>
      {items.length >= max && <p className="settings-note">That is the most this tool takes at once ({max}).</p>}
    </div>
  );
}

/** Move one item of a list by one place, returning a new list. Out-of-range moves return the list unchanged. */
export function moveItem<T>(list: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
