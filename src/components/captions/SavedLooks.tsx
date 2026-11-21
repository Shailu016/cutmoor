import { useEffect, useState, type CSSProperties } from "react";
import { Check, Pencil, Save, ShieldCheck, Trash2, X } from "lucide-react";
import type { CaptionStyle } from "../../lib/captioning/contracts";
import {
  applySavedLook,
  browserLookStorage,
  deleteLook,
  readSavedLooks,
  renameLook,
  saveLook,
  type SavedLook,
  type SavedLookError,
} from "../../lib/captioning/saved-looks";
import { CAPTION_STYLES, CAPTION_STYLE_LABELS } from "./styles";

interface Props {
  /** The style on screen now. Saving keeps its preset and its custom-look fields. */
  current: CaptionStyle;
  /** The full style to show when a saved look is applied. */
  onApply(style: CaptionStyle): void;
}

/**
 * Task D: name and manage looks saved in this browser. Storage is reached only through
 * `saved-looks.ts`, which catches blocked-storage and quota errors and validates every entry on
 * read. Nothing here is sent anywhere; the note says so.
 */
export function SavedLooks({ current, onApply }: Props) {
  const [looks, setLooks] = useState<SavedLook[]>([]);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const reload = () => {
    const read = readSavedLooks(browserLookStorage());
    setLooks(read.looks);
    if (read.error === "unavailable") setNotice(STORAGE_BLOCKED);
    else if (read.error === "corrupt") setNotice(MESSAGES.corrupt);
    else if (read.error) setNotice(MESSAGES["read-failed"]);
    return read;
  };

  // localStorage is a browser API, so it is read after mount (the page also prerenders on the server).
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; reload is a local helper
  }, []);

  const handleSave = () => {
    const result = saveLook(browserLookStorage(), name, current);
    if (result.ok) {
      setName("");
      setNotice(`Saved "${result.look?.name ?? name.trim()}" in this browser.`);
      reload();
    } else {
      setNotice(MESSAGES[result.error ?? "write-failed"]);
    }
  };

  const handleApply = (look: SavedLook) => {
    const preset = CAPTION_STYLES[look.preset];
    if (!preset) {
      setNotice("That look uses a caption style this version does not know.");
      return;
    }
    onApply(applySavedLook(look, preset));
    setNotice(`"${look.name}" applied.`);
  };

  const startRename = (look: SavedLook) => {
    setRenamingId(look.id);
    setRenameDraft(look.name);
  };

  const commitRename = (id: string) => {
    const result = renameLook(browserLookStorage(), id, renameDraft);
    if (result.ok) {
      setRenamingId(null);
      setNotice("Look renamed.");
      reload();
    } else {
      setNotice(MESSAGES[result.error ?? "write-failed"]);
    }
  };

  const handleDelete = (look: SavedLook) => {
    const result = deleteLook(browserLookStorage(), look.id);
    if (result.ok) {
      setNotice(`"${look.name}" deleted.`);
      if (renamingId === look.id) setRenamingId(null);
      reload();
    } else {
      setNotice(MESSAGES[result.error ?? "write-failed"]);
    }
  };

  return (
    <div className="cap-section" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="mono-label" id="cap-saved-looks-label">
        Saved looks
      </span>

      <div style={{ display: "flex", gap: 6 }} role="group" aria-labelledby="cap-saved-looks-label">
        <input
          type="text"
          value={name}
          maxLength={60}
          placeholder="e.g. Big yellow"
          aria-label="Look name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSave();
          }}
          style={{ ...INPUT, flex: 1, minWidth: 0 }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={name.trim().length === 0}
          style={{ ...BUTTON, opacity: name.trim().length === 0 ? 0.5 : 1, cursor: name.trim().length === 0 ? "not-allowed" : "pointer" }}
        >
          <Save size={14} aria-hidden="true" />
          Save this look
        </button>
      </div>

      {looks.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>No saved looks yet.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {looks.map((look) =>
            renamingId === look.id ? (
              <div key={look.id} style={CHIP_ROW}>
                <input
                  autoFocus
                  type="text"
                  value={renameDraft}
                  maxLength={60}
                  aria-label={`New name for ${look.name}`}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename(look.id);
                    if (event.key === "Escape") setRenamingId(null);
                  }}
                  style={{ ...INPUT, width: 124 }}
                />
                <button type="button" aria-label="Save name" onClick={() => commitRename(look.id)} style={ICON}>
                  <Check size={14} aria-hidden="true" />
                </button>
                <button type="button" aria-label="Cancel rename" onClick={() => setRenamingId(null)} style={ICON}>
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div key={look.id} style={CHIP_ROW}>
                <button type="button" onClick={() => handleApply(look)} title={`Apply ${look.name}`} style={APPLY}>
                  <span style={{ fontWeight: 700 }}>{look.name}</span>
                  <span style={{ fontSize: 11, opacity: 0.65 }}>{CAPTION_STYLE_LABELS[look.preset].name}</span>
                </button>
                <button type="button" aria-label={`Rename ${look.name}`} onClick={() => startRename(look)} style={ICON}>
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button type="button" aria-label={`Delete ${look.name}`} onClick={() => handleDelete(look)} style={ICON}>
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      <p role="status" aria-live="polite" style={{ margin: 0, minHeight: 18, fontSize: 12, lineHeight: 1.45, opacity: 0.8 }}>
        {notice}
      </p>

      <p style={{ margin: 0, display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, lineHeight: 1.45, opacity: 0.75 }}>
        <ShieldCheck size={14} aria-hidden="true" style={{ flex: "none", marginTop: 1 }} />
        Looks stay in this browser only. Nothing is uploaded.
      </p>
    </div>
  );
}

const STORAGE_BLOCKED = "Saved looks need this browser's storage, which is blocked here, so they are unavailable.";
const MESSAGES: Record<SavedLookError, string> = {
  unavailable: STORAGE_BLOCKED,
  "invalid-name": "Give the look a name first.",
  limit: "You can keep up to 20 looks. Delete one to make room.",
  "not-found": "That look is no longer in the list.",
  corrupt: "The saved looks are damaged, so they were left untouched. Clear this site's data to start again.",
  "read-failed": "This browser would not let the saved looks be read; its storage may be blocked.",
  "write-failed": "The look could not be saved. This browser may be out of storage.",
};

const INPUT: CSSProperties = {
  minHeight: 32,
  padding: "4px 8px",
  border: "1px solid rgba(128, 128, 128, 0.55)",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 13,
};
const BUTTON: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minHeight: 32,
  padding: "4px 10px",
  border: "1px solid currentColor",
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 600,
};
const CHIP_ROW: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: 2,
  border: "1px solid rgba(128, 128, 128, 0.4)",
  borderRadius: 999,
};
const APPLY: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 5,
  padding: "5px 9px",
  border: 0,
  borderRadius: 999,
  background: "transparent",
  color: "inherit",
  fontFamily: "inherit",
  fontSize: 13,
  cursor: "pointer",
};
const ICON: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  padding: 0,
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  opacity: 0.7,
  cursor: "pointer",
};
