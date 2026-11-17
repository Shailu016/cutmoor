import { useEffect, useRef } from "react";
import { useNearScreen } from "../../hooks/useNearScreen";
import { cardPicture } from "../../lib/card-art";
import { CARD_ART } from "../../lib/card-art.generated";
import { formatBytes } from "../../lib/format";

/**
 * A looping picture of one real job: the sample clip dropped on Compress video. It is drawn in HTML and CSS (no video
 * file, no script), but everything it shows came from a real run of the tool: the two pictures are frames of the real
 * input and output, and both sizes are the real file sizes (see scripts/make-card-art.mjs). The labelled cursor and the
 * chips are the animation; they say only things that are true on every run.
 */
export function LiveDemo() {
  const root = useRef<HTMLDivElement>(null);
  // The demo is built only when the visitor scrolls close (its box keeps its size until then), and its 14-second loop
  // only runs while it is on screen. Both keep it out of the first load's work.
  const [near, nearRef] = useNearScreen<HTMLDivElement>("500px");
  useEffect(() => {
    const el = root.current;
    if (!near || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => el.classList.toggle("is-live", entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const art = CARD_ART.compress;
  const before = formatBytes(art.beforeBytes);
  const after = formatBytes(art.afterBytes);
  const saved = Math.round((1 - art.afterBytes / art.beforeBytes) * 100);
  // The clip the art script dropped on the tool: its name is the output's name without "-compressed".
  const clip = { fileName: art.name.replace("-compressed", ""), width: art.before.w, height: art.before.h };

  return (
    <section className="shell section live-section" aria-labelledby="live-heading">
      <div className="section-head">
        <div>
          <span className="mono-label">See it work</span>
          <h2 id="live-heading">One file, start to finish, on your device.</h2>
        </div>
        <p>
          A looped picture of a real job: our own night-street clip, {clip.fileName}, dropped on Compress video. The sizes and both frames come from the real output.
        </p>
      </div>

      <div
        ref={(el) => {
          root.current = el;
          nearRef.current = el;
        }}
        className={near ? "ld is-built" : "ld"}
        role="img"
        aria-label={`A looped demonstration: ${clip.fileName}, ${before}, is dropped on Compress video, nothing is uploaded, and the result is ${after}, ${saved} percent smaller.`}
      >
        {near && (
          <>
          <div className="ld-window" aria-hidden="true">
            <div className="ld-bar">
              <i />
              <i />
              <i />
              <span>cutmoor.com / compress-video</span>
            </div>
            <div className="ld-stage">
              <div className="ld-scene ld-drop">
                <div className="ld-zone">
                  <b>Drop a file here, or click to choose</b>
                  <small>MP4, MOV, WebM, MKV</small>
                </div>
              </div>

              <div className="ld-scene ld-work">
                <div className="ld-file">
                  <img src={cardPicture("compress", "before")} width={720} height={405} alt="" loading="lazy" decoding="async" />
                  <div>
                    <b>{clip.fileName}</b>
                    <small className="num">
                      {before} · {clip.width}×{clip.height}
                    </small>
                  </div>
                </div>
                <div className="ld-panel">
                  <span className="ld-btn">Compress video</span>
                  <div className="ld-progress">
                    <span className="ld-bar-label">Encoding on your device</span>
                    <span className="ld-track">
                      <span />
                    </span>
                  </div>
                </div>
              </div>

              <div className="ld-scene ld-done">
                <div className="ld-compare">
                  <img src={cardPicture("compress", "before")} width={720} height={405} alt="" loading="lazy" decoding="async" />
                  <img className="ld-after" src={cardPicture("compress", "after")} width={720} height={405} alt="" loading="lazy" decoding="async" />
                  <span className="sc-pill sc-pill-before">
                    <b>Before</b>
                    <i>MP4 · {before}</i>
                  </span>
                  <span className="sc-pill sc-pill-after">
                    <b>After</b>
                    <i>MP4 · {after}</i>
                  </span>
                  <span className="sc-divider">
                    <i />
                  </span>
                </div>
                <span className="ld-btn ld-download">Download</span>
              </div>
            </div>
          </div>

          <div className="ld-cursor" aria-hidden="true">
            <svg width="22" height="24" viewBox="0 0 22 24">
              <path d="M2 1.5v18l5-4.6 3.4 7.2 3.2-1.5-3.3-7H17.5z" fill="#fff" stroke="#0b0f17" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            <span className="ld-tag">
              <em className="t1">Dropping {clip.fileName}</em>
              <em className="t2">Compress video</em>
              <em className="t4">Encoding locally</em>
              <em className="t3">Saving the result</em>
            </span>
          </div>

          <span className="ld-chip c1" aria-hidden="true">
            0 B uploaded
          </span>
          <span className="ld-chip c2" aria-hidden="true">
            Runs on your CPU
          </span>
          <span className="ld-chip c3" aria-hidden="true">
            Done · <span className="num">{before}</span> → <span className="num">{after}</span> · −{saved}%
          </span>
          </>
        )}
      </div>
    </section>
  );
}
