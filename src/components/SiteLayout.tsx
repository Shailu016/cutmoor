import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { AdSlot } from "./AdSlot";
import { ConsentBanner } from "./ConsentBanner";

const LINKS = [
  { to: "/tools", label: "Tools" },
  { to: "/guides", label: "Guides" },
  { to: "/about", label: "About" },
];

const FOOTER = [
  {
    title: "Video tools",
    links: [
      { to: "/tools/compress", label: "Compress video" },
      { to: "/tools/resize", label: "Crop to 9:16" },
      { to: "/tools/trim", label: "Trim video" },
      { to: "/tools/convert", label: "Convert video" },
    ],
  },
  {
    title: "Image tools",
    links: [
      { to: "/tools/compress-image", label: "Compress image" },
      { to: "/tools/resize-image", label: "Resize image" },
      { to: "/tools/convert-image", label: "Convert image" },
      { to: "/tools/heic-to-jpg", label: "HEIC to JPG" },
    ],
  },
  {
    title: "More tools",
    links: [
      { to: "/tools/audio", label: "Extract audio" },
      { to: "/tools/frame", label: "Save a frame" },
      { to: "/tools/captions", label: "SRT to VTT" },
      { to: "/tools", label: "All tools" },
    ],
  },
  {
    title: "Learn",
    links: [
      { to: "/guides", label: "Guides" },
      { to: "/guides/compress-video-for-whatsapp", label: "WhatsApp limits" },
      { to: "/guides/social-media-image-sizes", label: "Image sizes" },
      { to: "/editorial", label: "Editorial policy" },
    ],
  },
  {
    title: "Site",
    links: [
      { to: "/about", label: "About" },
      { to: "/contact", label: "Contact" },
      { to: "/privacy", label: "Privacy" },
      { to: "/terms", label: "Terms" },
      { to: "/licences", label: "Licences" },
    ],
  },
];

function Logo() {
  return (
    <Link className="logo" to="/" aria-label="ClipKit home">
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <path d="M10 9v10a4 4 0 1 0 2 3.46V14h8v5a4 4 0 1 0 2 3.46V9H10Z" fill="#c8f169" />
        </svg>
      </span>
      <span className="logo-word">ClipKit</span>
    </Link>
  );
}

export function SiteLayout() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) {
        target.scrollIntoView({ block: "start" });
        setOpen(false);
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    setOpen(false);
  }, [location.pathname, location.hash]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="shell header-inner">
          <Logo />
          <nav className="desktop-nav" aria-label="Primary">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <Link className="header-cta" to="/tools">
              Open the toolkit <ArrowUpRight size={15} />
            </Link>
            <button
              className="menu-button"
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="mobile-nav" aria-label="Mobile">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className="mobile-link">
                {link.label}
              </NavLink>
            ))}
            <Link className="mobile-link mobile-cta" to="/tools">
              Open the toolkit
            </Link>
          </nav>
        )}
      </header>

      <main id="main">
        <Outlet />
      </main>

      <div className="shell footer-ad">
        <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT_FOOTER} />
      </div>

      <footer className="site-footer">
        <div className="shell footer-grid">
          <div className="footer-brand">
            <Logo />
            <p>
              The browser media toolkit for video and images. Your files stay on your device — no upload, no account, no
              watermark.
            </p>
            <span className="mono-label">EST. 2026 · LOCAL-FIRST</span>
          </div>
          {FOOTER.map((column) => (
            <div key={column.title} className="footer-column">
              <h3>{column.title}</h3>
              {column.links.map((link) => (
                <Link key={link.to} to={link.to}>
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="shell footer-bottom">
          <span>© 2026 ClipKit. Tools are free; ads keep them free.</span>
          <div className="footer-legal">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/cookies">Cookies</Link>
          </div>
        </div>
      </footer>

      <ConsentBanner />
    </>
  );
}
