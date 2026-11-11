import "@fontsource-variable/manrope";
import "@fontsource-variable/fraunces";
import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

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
if (root.hasChildNodes() && prerenderedRoute && normalizeRoute(prerenderedRoute) === normalizeRoute(window.location.pathname)) {
  hydrateRoot(root, tree);
} else {
  createRoot(root).render(tree);
}
