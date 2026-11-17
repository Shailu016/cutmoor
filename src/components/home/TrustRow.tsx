import { ArrowRight, BadgeCheck, EyeOff, ShieldCheck } from "lucide-react";
import { Link } from "../Link";

/** Facts anyone can check. The first one explains how: the browser's own Network tab shows every request a page makes. */
export function TrustRow() {
  return (
    <section className="shell trust-row" aria-label="What you can check yourself">
      <div className="trust-fact">
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <strong className="num">0 bytes uploaded</strong>
          <span>
            Check it:{" "}
            <button type="button" className="trust-tip" aria-describedby="trust-how">
              how to verify
              <span role="tooltip" id="trust-how">
                Open your browser&apos;s developer tools, choose the Network tab, then run any tool. Your file never appears in a request.
              </span>
            </button>
          </span>
        </div>
      </div>
      <div className="trust-fact">
        <BadgeCheck size={20} aria-hidden="true" />
        <div>
          <strong>No account</strong>
          <span>Nothing to sign up for</span>
        </div>
      </div>
      <div className="trust-fact">
        <EyeOff size={20} aria-hidden="true" />
        <div>
          <strong>No watermark</strong>
          <span>On any output, ever</span>
        </div>
      </div>
      <Link className="trust-link" to="/privacy">
        How local processing works <ArrowRight size={15} />
      </Link>
    </section>
  );
}
