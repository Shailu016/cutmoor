/**
 * The privacy promise, as a rule a machine can check. A browser test records every request the
 * captions page makes while it runs a job and hands the list to `checkRequests`; any violation
 * fails the build.
 *
 * Two guarantees are enforced:
 *  1. During the job, the page contacts only the model host (and only to GET model files).
 *  2. After the one-time download, a job makes NO network request at all.
 */

export interface RecordedRequest {
  url: string;
  method: string;
  /** Size of the request body in bytes, 0 for none. */
  bodyBytes: number;
  /** Request headers the browser sent, lower-cased names. */
  headers?: Record<string, string>;
}

export interface NetworkPolicy {
  /** Origins that may be contacted for model files, e.g. "https://models.cutmoor.com". */
  modelOrigins: readonly string[];
  /** The page itself and its own static files. Always allowed to be loaded from, never to be sent data. */
  pageOrigin: string;
  /** "download": model GETs are allowed. "offline": nothing may be requested. */
  phase: "download" | "offline";
}

export interface Violation {
  url: string;
  reason: string;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function checkRequests(requests: readonly RecordedRequest[], policy: NetworkPolicy): Violation[] {
  const violations: Violation[] = [];
  const modelOrigins = new Set(policy.modelOrigins);

  for (const request of requests) {
    const origin = originOf(request.url);
    // data: and blob: URLs never leave the machine.
    if (request.url.startsWith("data:") || request.url.startsWith("blob:")) continue;
    if (origin === null) {
      violations.push({ url: request.url, reason: "not a valid URL" });
      continue;
    }

    if (policy.phase === "offline") {
      violations.push({ url: request.url, reason: "a request was made after the model was downloaded" });
      continue;
    }

    const method = request.method.toUpperCase();
    if (request.bodyBytes > 0) {
      violations.push({ url: request.url, reason: `a request carried ${request.bodyBytes} bytes of data out` });
      continue;
    }
    if (method !== "GET" && method !== "HEAD") {
      violations.push({ url: request.url, reason: `${method} requests are not allowed` });
      continue;
    }
    if (origin !== policy.pageOrigin && !modelOrigins.has(origin)) {
      violations.push({ url: request.url, reason: `${origin} is not the page or an allowed model host` });
      continue;
    }
    if (request.headers && (request.headers["cookie"] || request.headers["authorization"])) {
      violations.push({ url: request.url, reason: "the request carried cookies or credentials" });
    }
  }
  return violations;
}
