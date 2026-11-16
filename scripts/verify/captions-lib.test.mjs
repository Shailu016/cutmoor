// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createFakeModelHost, headersFor, MODEL_ORIGIN, parseCsp, parseHeadersFile, patternToRegExp, seededBytes, sha256Hex } from "./captions-lib.mjs";

const real = parseHeadersFile(await readFile(new URL("../../public/_headers", import.meta.url), "utf8"));

describe("_headers parsing and matching", () => {
  it("reads rules, ignores comments and blank lines", () => {
    const rules = parseHeadersFile("# c\n\n/a\n  X-One: 1\n  # inner comment\n  X-Two: a: b\n/b/*\n  X-Three: 3\n");
    expect(rules).toEqual([
      { pattern: "/a", headers: [["X-One", "1"], ["X-Two", "a: b"]] },
      { pattern: "/b/*", headers: [["X-Three", "3"]] },
    ]);
  });

  it("rejects an indented line before any rule", () => {
    expect(() => parseHeadersFile("  X: 1\n")).toThrow();
  });

  it("matches splats across slashes, exact paths exactly, and :placeholders per segment", () => {
    expect(patternToRegExp("/a/*").test("/a/")).toBe(true);
    expect(patternToRegExp("/a/*").test("/a/b/c")).toBe(true);
    expect(patternToRegExp("/a/*").test("/a")).toBe(false);
    expect(patternToRegExp("/a").test("/a/")).toBe(false);
    expect(patternToRegExp("/*.png").test("/x/y.png")).toBe(true);
    expect(patternToRegExp("/*.png").test("/x/y.pngx")).toBe(false);
    expect(patternToRegExp("/u/:id").test("/u/7")).toBe(true);
    expect(patternToRegExp("/u/:id").test("/u/7/8")).toBe(false);
  });

  it("joins a header set by two matching rules", () => {
    const rules = parseHeadersFile("/*\n  X-A: one\n/p/*\n  X-A: two\n");
    expect(headersFor("/p/x", rules)["x-a"]).toBe("one, two");
    expect(headersFor("/q", rules)["x-a"]).toBe("one");
  });
});

describe("the real public/_headers for the captions page", () => {
  const paths = ["/tools/auto-captions", "/tools/auto-captions/", "/tools/auto-captions/index.html"];

  it.each(paths)("%s is cross-origin isolated", (path) => {
    const headers = headersFor(path, real);
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["cross-origin-embedder-policy"]).toBe("credentialless");
  });

  it.each(paths)("%s limits connect-src to itself and the model host, with one policy only", (path) => {
    const csp = headersFor(path, real)["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).not.toContain(", default-src"); // a second joined policy would mean two rules matched
    const policy = parseCsp(csp);
    expect(policy["connect-src"].sort()).toEqual(["'self'", MODEL_ORIGIN, "blob:", "data:"].sort());
    expect(policy["script-src"]).toContain("'self'");
    expect(policy["script-src"]).toContain("'wasm-unsafe-eval'");
    expect(policy["script-src"]).not.toContain("'unsafe-eval'");
    expect(policy["script-src"]).not.toContain("'unsafe-inline'");
    expect(policy["script-src"].some((source) => /^https?:/.test(source))).toBe(false); // no third-party scripts, so no ads
    expect(policy["worker-src"]).toEqual(expect.arrayContaining(["'self'", "blob:"]));
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    // Nothing may reach any host but our own through any other directive either.
    for (const [directive, sources] of Object.entries(policy)) {
      const hosts = sources.filter((source) => /^https?:\/\//.test(source));
      if (directive === "connect-src") expect(hosts).toEqual([MODEL_ORIGIN]);
      else expect(hosts).toEqual([]);
    }
  });

  it("does not leak COOP, COEP or the policy onto any other page (ads elsewhere keep working)", () => {
    for (const path of ["/", "/tools/compress/", "/tools/", "/guides/x/", "/assets/a.js", "/tools/auto-captions-extra", "/tools/auto-captionsx/"]) {
      const headers = headersFor(path, real);
      expect(headers["cross-origin-opener-policy"], path).toBeUndefined();
      expect(headers["cross-origin-embedder-policy"], path).toBeUndefined();
      expect(headers["content-security-policy"], path).toBeUndefined();
    }
  });

  it("keeps the site-wide security headers on the captions page too", () => {
    const headers = headersFor("/tools/auto-captions/", real);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });

  it("every header line stays under Cloudflare's 2000 character limit", async () => {
    const text = await readFile(new URL("../../public/_headers", import.meta.url), "utf8");
    for (const line of text.split(/\r?\n/)) expect(line.length).toBeLessThan(2000);
  });
});

describe("pretend model host", () => {
  const url = `${MODEL_ORIGIN}/m/aaaaaaaaaaaaaaaa.bin`;
  const data = seededBytes(1000, 7);
  const respond = createFakeModelHost({ files: new Map([[url, data]]), pageOrigin: "http://localhost:5190" });

  it("serves exact ranges with Content-Range and CORS", () => {
    const r = respond({ url, method: "GET", headers: { range: "bytes=10-19" } });
    expect(r.status).toBe(206);
    expect([...r.body]).toEqual([...data.subarray(10, 20)]);
    expect(r.headers["content-range"]).toBe("bytes 10-19/1000");
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:5190");
  });

  it("clamps the last range, refuses ranges past the end, answers whole files, 404s, and rejects POST", () => {
    expect(respond({ url, method: "GET", headers: { range: "bytes=990-2000" } }).body.length).toBe(10);
    expect(respond({ url, method: "GET", headers: { range: "bytes=1000-1010" } }).status).toBe(416);
    expect(respond({ url, method: "GET", headers: {} }).status).toBe(200);
    expect(respond({ url: url + "x", method: "GET" }).status).toBe(404);
    expect(respond({ url, method: "POST" }).status).toBe(405);
    expect(respond({ url, method: "HEAD" }).body).toBeNull();
  });

  it("can ignore Range like a naive proxy", () => {
    const naive = createFakeModelHost({ files: new Map([[url, data]]), pageOrigin: "x", ignoreRange: new Set([url]) });
    const r = naive({ url, method: "GET", headers: { range: "bytes=0-9" } });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(1000);
  });
});

describe("seededBytes", () => {
  it("is deterministic, seed-sensitive, and not constant", () => {
    expect(sha256Hex(seededBytes(512, 1))).toBe(sha256Hex(seededBytes(512, 1)));
    expect(sha256Hex(seededBytes(512, 1))).not.toBe(sha256Hex(seededBytes(512, 2)));
    expect(new Set(seededBytes(512, 1)).size).toBeGreaterThan(100);
  });
});
