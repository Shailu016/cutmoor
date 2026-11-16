/**
 * Lets plain `node` import the TypeScript scorer.
 *
 * Node 24 strips TypeScript types on its own, but it still requires file extensions while the rest
 * of this repo uses bundler-style extensionless imports ("../normalize"). This tiny resolve hook
 * retries a failed relative specifier with ".ts" and then "/index.ts", which is exactly what Vite
 * does for the app build. It is only registered by the eval CLI, never by the site.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw error;
    for (const suffix of [".ts", "/index.ts"]) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch {
        // Try the next candidate; the original error is more informative than this one.
      }
    }
    throw error;
  }
}
