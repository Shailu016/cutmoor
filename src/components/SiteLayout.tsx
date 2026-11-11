import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { AdSlot } from "./AdSlot";
import { ConsentBanner } from "./ConsentBanner";
import { ToolIcon } from "./ToolIcon";
import { IMAGE_TOOLS, VIDEO_TOOLS } from "../lib/tools";

const FOOTER = [
  {
    title: "Video tools",
    links: [
      { to: "/tools/compress", label: "Compress video" },
      { to: "/tools/resize", label: "Crop to 9:16" },
      { to: "/tools/trim", label: "Trim video" },
      { to: "/tools/convert", label: "Convert video" },
      { to: "/tools/audio", label: "Extract audio" },
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
    <Link className="logo" to="/" aria-label="Cutmoor home">
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="28" height="28">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <path d="M10 9v10a4 4 0 1 0 2 3.46V14h8v5a4 4 0 1 0 2 3.46V9H10Z" fill="#c9f24b" />
        </svg>
      </span>
      <span className="logo-word">Cutmoor</span>
    </Link>
  );
}

function ToolLink({ tool }: { tool: (typeof VIDEO_TOOLS)[number] }) {
  return (
    <Link className="nav-dropdown-link" to={`/tools/${tool.slug}`}>
      <ToolIcon icon={tool.icon} size={16} />
      <span>{tool.name}</span>
    </Link>
  );
}

export function SiteLayout() {
  const location = useLocation();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const toolsPanelRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const toolsActive = location.pathname.startsWith("/tools");

  useEffect(() => {
    // The first paint is prerendered, so the entrance animation only runs on
    // client-side navigation. That keeps the first view instant.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.documentElement.classList.add("page-anim");
    const timer = window.setTimeout(() => document.documentElement.classList.remove("page-anim"), 320);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  useEffect(() => {
    setToolsOpen(false);
    setMobileOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    if (!toolsOpen && !mobileOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        toolsPanelRef.current?.contains(target) ||
        toolsButtonRef.current?.contains(target) ||
        mobileNavRef.current?.contains(target) ||
        menuButtonRef.current?.contains(target)
      ) {
        return;
      }
      setToolsOpen(false);
      setMobileOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (toolsOpen) {
        setToolsOpen(false);
        toolsButtonRef.current?.focus();
      }
      if (mobileOpen) {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toolsOpen, mobileOpen]);

  useEffect(() => {
    if (mobileOpen) menuButtonRef.current?.focus();
  }, [mobileOpen]);

  useEffect(() => {
    if (location.hash) {
      let id = "";
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        id = location.hash.slice(1);
      }
      const target = id ? document.getElementById(id) : null;
      if (target) {
        target.scrollIntoView({ block: "start" });
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname, location.hash, location.key]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="shell header-inner">
          <Logo />

          <nav className="desktop-nav" aria-label="Primary">
            <div className="nav-dropdown">
              <button
                ref={toolsButtonRef}
                type="button"
                className={toolsActive ? "nav-link active" : "nav-link"}
                aria-expanded={toolsOpen}
                aria-controls="tools-menu"
                onClick={() => setToolsOpen((value) => !value)}
              >
                Tools
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {toolsOpen && (
                <div className="nav-dropdown-panel" id="tools-menu" ref={toolsPanelRef}>
                  <div>
                    <div className="nav-dropdown-title">Video</div>
                    {VIDEO_TOOLS.map((tool) => (
                      <ToolLink key={tool.slug} tool={tool} />
                    ))}
                  </div>
                  <div>
                    <div className="nav-dropdown-title">Images</div>
                    {IMAGE_TOOLS.map((tool) => (
                      <ToolLink key={tool.slug} tool={tool} />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <NavLink
              to="/guides"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              Guides
            </NavLink>
            <NavLink
              to="/about"
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              About
            </NavLink>
          </nav>

          <div className="header-actions">
            <Link className="header-cta" to="/tools">
              Open the toolkit <ArrowUpRight size={15} />
            </Link>
            <button
              ref={menuButtonRef}
              className="menu-button"
              type="button"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              aria-controls="mobile-menu"
              onClick={() => setMobileOpen((value) => !value)}
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="mobile-nav" id="mobile-menu" aria-label="Mobile" ref={mobileNavRef}>
            <div className="mobile-nav-group">
              <div className="mobile-nav-title">Video tools</div>
              {VIDEO_TOOLS.map((tool) => (
                <NavLink key={tool.slug} to={`/tools/${tool.slug}`} className="mobile-link">
                  {tool.name}
                </NavLink>
              ))}
            </div>
            <div className="mobile-nav-group">
              <div className="mobile-nav-title">Image tools</div>
              {IMAGE_TOOLS.map((tool) => (
                <NavLink key={tool.slug} to={`/tools/${tool.slug}`} className="mobile-link">
                  {tool.name}
                </NavLink>
              ))}
            </div>
            <div className="mobile-nav-group">
              <div className="mobile-nav-title">Explore</div>
              <NavLink to="/tools" className="mobile-link">
                All tools
              </NavLink>
              <NavLink to="/guides" className="mobile-link">
                Guides
              </NavLink>
              <NavLink to="/about" className="mobile-link">
                About
              </NavLink>
            </div>
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
                <Link key={link.to + link.label} to={link.to}>
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="shell footer-bottom">
          <span>© 2026 Cutmoor. Tools are free; ads keep them free.</span>
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
