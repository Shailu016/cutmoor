import { useEffect, useState } from "react";

const CONSENT_KEY = "cutmoor-consent";

function readAllowed(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

export function AdSlot({ slot, className = "" }: { slot?: string; className?: string }) {
  const client = String(import.meta.env.VITE_ADSENSE_CLIENT ?? "").trim();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const read = () => setAllowed(readAllowed());
    read();
    window.addEventListener("cutmoor-consent-change", read);
    return () => window.removeEventListener("cutmoor-consent-change", read);
  }, []);

  useEffect(() => {
    if (!client || !allowed || !slot) return;
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
  }, [client, allowed, slot]);

  if (!client) {
    if (!import.meta.env.DEV) return null;
    return (
      <div className={`ad-placeholder ${className}`.trim()}>
        <span>Advertisement</span>
        <small>Set VITE_ADSENSE_CLIENT and the matching VITE_ADSENSE_SLOT_* variable to enable this placement.</small>
      </div>
    );
  }

  return (
    <div className={`ad-slot ${className}`.trim()} role="region" aria-label="Advertisement">
      <span className="ad-label">Advertisement</span>
      {allowed && slot ? (
        <ins
          className="adsbygoogle"
          style={{ display: "block" }}
          data-ad-client={client}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      ) : (
        <div className="ad-empty">Ads load after you accept advertising cookies.</div>
      )}
    </div>
  );
}
