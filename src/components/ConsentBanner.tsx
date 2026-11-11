import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const CONSENT_KEY = "cutmoor-consent";

function readConsent(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function writeConsent(value: "accepted" | "rejected") {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Privacy modes can block storage; the choice still applies to this page.
  }
}

/**
 * Lightweight consent gate. It stops the ad script from loading before the
 * visitor chooses. A production deployment that serves the EEA, the UK, or
 * Switzerland must replace this with a Google-certified CMP.
 */
export function ConsentBanner() {
  const [choice, setChoice] = useState<string | null>("loading");
  const cardRef = useRef<HTMLDivElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setChoice(readConsent());
  }, []);

  const decide = useCallback((value: "accepted" | "rejected") => {
    writeConsent(value);
    setChoice(value);
    window.dispatchEvent(new Event("cutmoor-consent-change"));
    window.setTimeout(() => previousFocus.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (choice !== "loading" && choice === null) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      rejectRef.current?.focus();

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          decide("rejected");
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }
  }, [choice, decide]);

  if (choice === "loading" || choice) return null;

  return (
    <div
      className="consent-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) decide("rejected");
      }}
    >
      <div
        className="consent-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="consent-title"
        aria-describedby="consent-description"
      >
        <div className="consent-copy">
          <strong id="consent-title">Cookies, ads, and your files.</strong>
          <p id="consent-description">
            Your files never leave this device. If you accept, Google AdSense may set advertising cookies. If you reject,
            the ad script does not load. <Link to="/cookies">Read the cookie page</Link>.
          </p>
        </div>
        <div className="consent-actions">
          <button ref={rejectRef} className="button button-ghost" type="button" onClick={() => decide("rejected")}>
            Reject ads
          </button>
          <button className="button button-primary" type="button" onClick={() => decide("accepted")}>
            Accept ads
          </button>
        </div>
      </div>
    </div>
  );
}

export function resetConsent() {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Ignore storage failures and still reload so the banner can reappear.
  }
  window.dispatchEvent(new Event("cutmoor-consent-change"));
  window.location.reload();
}
