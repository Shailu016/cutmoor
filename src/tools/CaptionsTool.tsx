import { useState } from "react";
import { Check, Clipboard, Download, FileText, Sparkles } from "lucide-react";
import {
  detectSubtitleFormat,
  shiftSubtitles,
  srtToVtt,
  vttToSrt,
} from "../lib/subtitles";

type Mode = "srt2vtt" | "vtt2srt" | "shift";

export function CaptionsTool() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("srt2vtt");
  const [offset, setOffset] = useState(0);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fileName, setFileName] = useState("captions");

  const run = () => {
    setError(null);
    setCopied(false);
    if (!input.trim()) {
      setError("Paste a subtitle file or drop an .srt or .vtt file first.");
      setOutput("");
      return;
    }
    try {
      if (mode === "srt2vtt") {
        if (detectSubtitleFormat(input) === "vtt") {
          setError("This already looks like a VTT file. Choose VTT to SRT instead.");
          setOutput("");
          return;
        }
        setOutput(srtToVtt(input));
        setFileName("captions.vtt");
      } else if (mode === "vtt2srt") {
        if (detectSubtitleFormat(input) === "srt") {
          setError("This looks like an SRT file. Choose SRT to VTT instead.");
          setOutput("");
          return;
        }
        setOutput(vttToSrt(input));
        setFileName("captions.srt");
      } else {
        const shifted = shiftSubtitles(input, offset);
        setOutput(shifted);
        setFileName(`captions-${offset >= 0 ? "plus" : "minus"}-${Math.abs(offset)}s.${detectSubtitleFormat(input)}`);
      }
    } catch {
      setError("The file could not be parsed. Check that it contains valid timecodes.");
      setOutput("");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard access was blocked. Select the text and copy it manually.");
    }
  };

  const download = () => {
    if (!output) return;
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const loadFile = async (file: File) => {
    const text = await file.text();
    setInput(text);
    setOutput("");
    setError(null);
    setFileName(file.name.replace(/\.(srt|vtt)$/i, ""));
    setMode(detectSubtitleFormat(text) === "vtt" ? "vtt2srt" : "srt2vtt");
  };

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <div
          className="dropzone dropzone-slim"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) void loadFile(file);
          }}
        >
          <div className="dropzone-icon">
            <FileText size={24} />
          </div>
          <strong>Drop an .srt or .vtt file</strong>
          <span>Or paste the subtitle text below. Nothing is uploaded.</span>
          <label className="button button-ghost button-small">
            Choose a file
            <input
              type="file"
              accept=".srt,.vtt,text/plain"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <div className="settings-card">
          <div className="settings-head">
            <span className="mono-label">01 · What do you need?</span>
          </div>
          <div className="segmented segmented-wrap">
            <button type="button" className={mode === "srt2vtt" ? "segment active" : "segment"} onClick={() => setMode("srt2vtt")}>
              SRT → VTT
            </button>
            <button type="button" className={mode === "vtt2srt" ? "segment active" : "segment"} onClick={() => setMode("vtt2srt")}>
              VTT → SRT
            </button>
            <button type="button" className={mode === "shift" ? "segment active" : "segment"} onClick={() => setMode("shift")}>
              <Sparkles size={15} /> Shift timing
            </button>
          </div>

          {mode === "shift" && (
            <label className="single-field">
              Offset in seconds (positive = later, negative = earlier)
              <input
                type="number"
                step={0.1}
                value={offset}
                onChange={(event) => setOffset(Number(event.target.value) || 0)}
              />
            </label>
          )}

          <div className="settings-head">
            <span className="mono-label">02 · Subtitle text</span>
            <span className="settings-hint">{input.split("\n").length} lines</span>
          </div>
          <textarea
            className="subtitle-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={"1\n00:00:01,000 --> 00:00:04,000\nThis is a subtitle line."}
            spellCheck={false}
            aria-label="Subtitle input"
          />

          {error && <p className="field-error">{error}</p>}

          <button className="button button-primary button-block button-lg" type="button" onClick={run}>
            {mode === "shift" ? "Shift subtitles" : "Convert subtitles"}
          </button>
          <p className="settings-footnote">
            Output encoding: UTF-8. Cue settings that SRT cannot represent are removed.
          </p>
        </div>
      </section>

      <aside className="job-panel">
        <div className="job-head">
          <span className="mono-label">Output</span>
          <span className={`job-state ${output ? "job-state-done" : "job-state-idle"}`}>
            {output ? "Complete" : "Waiting"}
          </span>
        </div>
        <div className="job-body">
          {!output ? (
            <>
              <p className="job-idle">The converted file appears here. Conversion is instant and runs entirely in this page.</p>
              <div className="job-trust">
                <Sparkles size={16} />
                <span>No ffmpeg needed: subtitles are plain text.</span>
              </div>
            </>
          ) : (
            <>
              <div className="result-badge">
                <Check size={16} /> Conversion complete
              </div>
              <textarea className="subtitle-output" value={output} readOnly aria-label="Subtitle output" />
              <div className="result-actions">
                <button className="button button-primary" type="button" onClick={download}>
                  <Download size={16} /> Download
                </button>
                <button className="button button-ghost" type="button" onClick={copy}>
                  {copied ? <Check size={16} /> : <Clipboard size={16} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="job-note">Download name: {fileName}</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
