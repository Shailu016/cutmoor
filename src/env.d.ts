/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_FFMPEG_BASE_URL?: string;
  readonly VITE_ADSENSE_CLIENT?: string;
  readonly VITE_ADSENSE_SLOT_HOME?: string;
  readonly VITE_ADSENSE_SLOT_ARTICLE?: string;
  readonly VITE_ADSENSE_SLOT_FOOTER?: string;
}

/** SHA-256 (base64) of public/ffmpeg core files at build time; null when the core was not installed. */
declare const __FFMPEG_CORE_SHA256__: { js: string; wasm: string } | null;
