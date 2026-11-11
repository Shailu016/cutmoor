import { useEffect, useState } from "react";

const CONSENT_KEY = "clipkit-consent";

export function AdSlot({ slot, className = "" }: { slot?: string; className?: string }) {
  const client = String(import.meta.env.VITE_ADSENSE_CLIENT ?? "").trim();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const read = () => setAllowed(localStorage.getItem(CONSENT_KEY) === "accepted");
    read();
    window.addEventListener("clipkit-consent-change", read);
    return () => window.removeEventListener("clipkit-consent-change", read);
  }, []);

  useEffect(() => {
    if (!client || !allowed || !slot) return;
    const existing = document.querySelector<HTMLScriptElement>("script[data-clipkit-ads]");
    if (!existing) {
      const script = document.createElement("script");
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.clipkitAds = "true";
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
        <small>Set VITE_ADSENSE_CLIENT and VITE_ADSENSE_SLOT_ARTICLE to enable</small>
      </div>
    );
  }

  if (!allowed || !slot) return null;

  return (
    <ins
      className={`adsbygoogle ${className}`.trim()}
      style={{ display: "block" }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
