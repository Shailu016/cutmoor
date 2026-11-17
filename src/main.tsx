import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { loadGuideBody } from "./content/guide-content";
import { installCaptionRuntime } from "./lib/captioning/runtime";
import "./styles.css";
import "./brand.css";
import "./captions.css";
import "./editing.css";

// Registers the real captioning engine for the captions tool. Does nothing until a model list has been published,
// and imports nothing heavy: the engine itself is loaded only when a caption job starts.
installCaptionRuntime();

const root = document.getElementById("root");
if (!root) throw new Error("App root was not found.");

const tree = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

const normalizeRoute = (value: string) => value.replace(/\/+$/, "") || "/";
const prerenderedRoute = root.dataset.route;

/**
 * Prerendered routes hydrate so their static copy is reused. Every other route
 * mounts fresh. The route marker prevents hydrating a page the host served from
 * an SPA fallback, which would be a mismatch.
 */
async function start(container: HTMLElement) {
  const prerendered =
    container.hasChildNodes() && prerenderedRoute && normalizeRoute(prerenderedRoute) === normalizeRoute(window.location.pathname);

  // A guide's article is a separate chunk. Load it before hydrating, so the first
  // client render is identical to the prerendered HTML.
  const guideSlug = /^\/guides\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];
  if (prerendered && guideSlug) await loadGuideBody(guideSlug);

  if (prerendered) hydrateRoot(container, tree);
  else createRoot(container).render(tree);
}

void start(root);
