import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { FormatList, TestedNote } from "./FormatCompat";
import { summarizeFormats } from "../lib/formats";
import { IMAGE_TOOLS, VIDEO_TOOLS } from "../lib/tools";

/** Homepage overview of what the tools accept and produce, built from the same table as the tool pages. */
export function FormatSummary() {
  const videoSlugs = VIDEO_TOOLS.filter((tool) => tool.slug !== "captions").map((tool) => tool.slug);
  const imageSlugs = IMAGE_TOOLS.map((tool) => tool.slug);

  return (
    <section className="section shell format-summary" aria-labelledby="format-summary-heading">
      <div className="section-head">
        <div>
          <span className="mono-label">Formats</span>
          <h2 id="format-summary-heading">Know what works before you start.</h2>
        </div>
        <Link className="text-link" to="/tools">
          Every tool, with its limits <ArrowRight size={15} />
        </Link>
      </div>
      <div className="format-summary-grid">
        <div>
          <h3>Video</h3>
          <div className="format-lists">
            <FormatList title="Accepts" entries={summarizeFormats(videoSlugs, "inputs")} level={4} />
            <FormatList title="Produces" entries={summarizeFormats(videoSlugs, "outputs")} level={4} />
          </div>
        </div>
        <div>
          <h3>Images</h3>
          <div className="format-lists">
            <FormatList title="Accepts" entries={summarizeFormats(imageSlugs, "inputs")} level={4} />
            <FormatList title="Produces" entries={summarizeFormats(imageSlugs, "outputs")} level={4} />
          </div>
        </div>
      </div>
      <TestedNote />
    </section>
  );
}
