import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const CONSENT_KEY = "clipkit-consent";

/**
 * Lightweight consent gate. It stops the ad script from loading before the
 * visitor chooses. A production deployment that serves the EEA, the UK, or
 * Switzerland must replace this with a Google-certified CMP.
 */
export function ConsentBanner() {
  const [choice, setChoice] = useState<string | null>("loading");

  useEffect(() => {
    setChoice(localStorage.getItem(CONSENT_KEY));
  }, []);

  const decide = (value: "accepted" | "rejected") => {
    localStorage.setItem(CONSENT_KEY, value);
    setChoice(value);
    window.dispatchEvent(new Event("clipkit-consent-change"));
  };

  if (choice === "loading" || choice) return null;

  return (
    <div className="consent" role="dialog" aria-label="Cookie and advertising choice">
      <div className="consent-copy">
        <strong>Cookies, ads, and your video.</strong>
        <p>
          Your video never leaves this device. If you accept, Google AdSense may set advertising cookies. If you
          reject, the ad script does not load. <Link to="/cookies">Read the cookie page</Link>.
        </p>
      </div>
      <div className="consent-actions">
        <button className="button button-ghost" type="button" onClick={() => decide("rejected")}>
          Reject ads
        </button>
        <button className="button button-primary" type="button" onClick={() => decide("accepted")}>
          Accept ads
        </button>
      </div>
    </div>
  );
}

export function resetConsent() {
  localStorage.removeItem(CONSENT_KEY);
  window.dispatchEvent(new Event("clipkit-consent-change"));
  window.location.reload();
}
