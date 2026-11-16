import { describe, expect, it } from "vitest";
import { checkRequests, type NetworkPolicy, type RecordedRequest } from "./network-policy";

const PAGE = "https://cutmoor.com";
const MODELS = "https://models.cutmoor.com";
const download: NetworkPolicy = { modelOrigins: [MODELS], pageOrigin: PAGE, phase: "download" };
const offline: NetworkPolicy = { ...download, phase: "offline" };
const get = (url: string, extra: Partial<RecordedRequest> = {}): RecordedRequest => ({ url, method: "GET", bodyBytes: 0, ...extra });

describe("checkRequests, download phase", () => {
  it("allows the page's own files and GETs to the model host", () => {
    expect(checkRequests([get(`${PAGE}/assets/app.js`), get(`${MODELS}/m/abc123`), get(`${MODELS}/m/abc123`, { method: "HEAD" })], download)).toEqual([]);
  });

  it("ignores data: and blob: URLs, which never leave the machine", () => {
    expect(checkRequests([get("blob:https://cutmoor.com/1234"), get("data:text/plain;base64,AAAA")], download)).toEqual([]);
  });

  it("flags any other host, including look-alikes", () => {
    const found = checkRequests([get("https://huggingface.co/m.onnx"), get("https://models.cutmoor.com.evil.example/m"), get("https://cdn.jsdelivr.net/npm/ort.wasm")], download);
    expect(found).toHaveLength(3);
  });

  it("flags any request that sends data out, even to an allowed host", () => {
    expect(checkRequests([{ url: `${MODELS}/m`, method: "POST", bodyBytes: 2048 }], download)[0].reason).toMatch(/data out/);
    expect(checkRequests([{ url: `${PAGE}/collect`, method: "GET", bodyBytes: 5 }], download)).toHaveLength(1);
    expect(checkRequests([{ url: `${MODELS}/m`, method: "PUT", bodyBytes: 0 }], download)[0].reason).toMatch(/PUT/);
  });

  it("flags cookies and credentials", () => {
    expect(checkRequests([get(`${MODELS}/m`, { headers: { cookie: "a=b" } })], download)).toHaveLength(1);
    expect(checkRequests([get(`${MODELS}/m`, { headers: { authorization: "Bearer x" } })], download)).toHaveLength(1);
  });

  it("flags a malformed URL", () => {
    expect(checkRequests([get("not a url")], download)[0].reason).toMatch(/valid URL/);
  });
});

describe("checkRequests, offline phase", () => {
  it("allows nothing: not even the allowed host", () => {
    expect(checkRequests([], offline)).toEqual([]);
    expect(checkRequests([get(`${MODELS}/m/abc123`)], offline)).toHaveLength(1);
    expect(checkRequests([get(`${PAGE}/favicon.ico`)], offline)[0].reason).toMatch(/after the model was downloaded/);
  });

  it("still ignores blob: and data: URLs", () => {
    expect(checkRequests([get("blob:https://cutmoor.com/9")], offline)).toEqual([]);
  });
});
