import { useState } from "react";
import { FileDrop } from "../../components/FileDrop";
import { JobPanel } from "../../components/JobPanel";
import { Chips, Segmented, RunButton, SettingsHead } from "../../components/Controls";
import { useMediaJob } from "../../hooks/useMediaJob";
import { baseName } from "../../lib/format";
import { buildGifArgs, GIF_PRESETS } from "../../lib/video-edit-args";

type PresetKey = keyof typeof GIF_PRESETS;
const WIDTHS = [160, 240, 320, 480, 640, 800].map((value) => ({ value, label: `${value} px` }));

/** Compress GIF and Resize GIF share one engine; the two pages only differ in which control comes first. */
export function GifTool({ mode }: { mode: "compress" | "resize" }) {
  const job = useMediaJob();
  const [preset, setPreset] = useState<PresetKey>("balanced");
  const [width, setWidth] = useState(320);
  const working = job.phase === "working";
  const outputName = `${baseName(job.file?.name ?? "animation")}-${mode === "compress" ? "small" : `${width}px`}.gif`;

  const run = () => {
    if (!job.file) return;
    job.runMulti(
      outputName,
      [job.file],
      ({ names, infos }) => {
        if (mode === "compress") {
          const p = GIF_PRESETS[preset];
          return buildGifArgs({ input: names[0], output: outputName, width: p.width, fps: p.fps, colors: p.colors });
        }
        // Resize keeps the animation's own speed, within what a GIF can reasonably hold.
        const fps = Math.min(20, Math.max(6, Math.round(infos[0].fps || 12)));
        return buildGifArgs({ input: names[0], output: outputName, width, fps, colors: 160 });
      },
      { probe: true },
    );
  };

  return (
    <div className="tool-workbench">
      <section className="tool-input">
        <FileDrop
          file={job.file}
          meta={job.meta}
          onFile={job.selectFile}
          onClear={job.clear}
          accept="image/gif,.gif"
          kind="image"
          hint="A .gif file. The result is a new GIF."
          disabled={working}
        />

        {job.file && (
          <div className="settings-card">
            {mode === "compress" ? (
              <>
                <SettingsHead label="01 · How small" />
                <Segmented
                  label="Compression level"
                  value={preset}
                  wrap
                  disabled={working}
                  onChange={setPreset}
                  options={(Object.keys(GIF_PRESETS) as PresetKey[]).map((key) => ({ value: key, label: GIF_PRESETS[key].label }))}
                />
                <p className="settings-note">
                  <strong>{GIF_PRESETS[preset].label}:</strong> {GIF_PRESETS[preset].note} The size, frame rate, and number of colours are all
                  reduced together, because that is what makes a GIF smaller.
                </p>
              </>
            ) : (
              <>
                <SettingsHead label="01 · New width" hint="Height follows" />
                <Chips label="Width in pixels" value={width} options={WIDTHS} onChange={setWidth} disabled={working} />
                <p className="settings-note">
                  The picture keeps its shape. A GIF is never made wider than it already is, because that only makes it blurrier and bigger.
                </p>
              </>
            )}
            <RunButton working={working} idleLabel={mode === "compress" ? "Compress GIF" : "Resize GIF"} workingLabel="Working…" onClick={run} />
            <p className="settings-footnote">Output: animated GIF · loops forever · made on your device</p>
          </div>
        )}
      </section>

      <JobPanel job={job} idleHint={`Choose a GIF. Cutmoor ${mode === "compress" ? "shrinks" : "resizes"} it on your device.`} />
    </div>
  );
}
