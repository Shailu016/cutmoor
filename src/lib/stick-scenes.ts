import { MEDIA_VERSION } from "./samples";

/**
 * Loads the hand-drawn scene code once: the stick-scene runtime (MIT, public/stick/stick.js) and Cutmoor's own scenes
 * (public/stick/scenes.js). Both are plain files from this site, so nothing is fetched from anywhere else. They load only
 * when a home-page card is near the screen, so they never count toward the first load.
 */
let loading: Promise<void> | null = null;

function addScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${src}?v=${MEDIA_VERSION}`;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

export function loadStickScenes(): Promise<void> {
  loading ??= addScript("/stick/stick.js")
    .then(() => addScript("/stick/scenes.js"))
    .catch(() => {
      loading = null;
    });
  return loading;
}
