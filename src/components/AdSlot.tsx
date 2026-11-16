import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isAdFreePath } from "../lib/ad-free";

export function AdSlot({ slot, className = "" }: { slot?: string; className?: string }) {
  // Ad-free pages never load ads, even if a slot is placed on them by mistake.
  const adFree = isAdFreePath(useLocation().pathname);
  const client = adFree ? "" : String(import.meta.env.VITE_ADSENSE_CLIENT ?? "").trim();

  useEffect(() => {
    if (!client || !slot) return;
    const existing = document.querySelector<HTMLScriptElement>("script[data-cutmoor-ads]");
    if (!existing) {
      const script = document.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.cutmoorAds = "true";
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      document.head.appendChild(script);
    }
    try {
      const adsbygoogle = ((window as unknown as { adsbygoogle?: unknown[] }).adsbygoogle ??= []);
      adsbygoogle.push({});
    } catch {
      // Ad blockers and script failures should never break a tool.
    }
  }, [client, slot]);

  if (adFree) return null;
  if (!client) {
    if (!import.meta.env.DEV) return null;
    return (
      <div className={`ad-placeholder ${className}`.trim()}>
        <span>Advertisement</span>
        <small>Set VITE_ADSENSE_CLIENT and the matching VITE_ADSENSE_SLOT_* variable to enable this placement.</small>
      </div>
    );
  }

  // No unit ID yet (e.g. during AdSense review, or Auto ads only): render nothing rather than an empty box.
  if (!slot) return null;

  return (
    <div className={`ad-slot ${className}`.trim()} role="region" aria-label="Advertisement">
      <span className="ad-label">Advertisement</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
