export declare const LAUNCH_ORIGIN: string;
export declare function resolveSiteUrl(env: Record<string, string | undefined>): { url: string; source: string };
export declare function resolveFfmpegBase(env: Record<string, string | undefined>): string;
export declare function ffmpegCoreHashes(root: string): Promise<{ js: string; wasm: string } | null>;
