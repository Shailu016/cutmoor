import puppeteer from "puppeteer-core";
import { statSync, writeFileSync } from "node:fs";

const [BASE, FILE, OUT] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 900_000,
});
const page = await browser.newPage();
const log = [];
let phase = "load";

const record = (source) => (e) => {
  const r = e.request;
  const u = new URL(r.url);
  log.push({
    phase,
    source,
    method: r.method,
    host: u.host || u.protocol,
    path: u.pathname.length > 60 ? u.pathname.slice(0, 60) + "…" : u.pathname,
    scheme: u.protocol,
    type: e.type,
    hasBody: Boolean(r.hasPostData),
    bodyBytes: r.postData ? r.postData.length : r.postDataEntries ? r.postDataEntries.reduce((n, p) => n + (p.bytes ? p.bytes.length : 0), 0) : 0,
  });
};

const client = await page.createCDPSession();
await client.send("Network.enable");
client.on("Network.requestWillBeSent", record("page"));
browser.on("targetcreated", async (target) => {
  if (target.type() === "worker" || target.type() === "service_worker") {
    try {
      const session = await target.createCDPSession();
      await session.send("Network.enable");
      session.on("Network.requestWillBeSent", record(target.type()));
    } catch {
      /* worker may be gone already */
    }
  }
});

// Also watch the main-thread APIs that can send data out.
await page.evaluateOnNewDocument(() => {
  window.__outbound = [];
  const note = (kind, detail) => window.__outbound.push({ kind, detail });
  const origBeacon = navigator.sendBeacon?.bind(navigator);
  if (origBeacon) navigator.sendBeacon = (url, data) => { note("sendBeacon", String(url)); return origBeacon(url, data); };
  const OrigWS = window.WebSocket;
  window.WebSocket = function (...args) { note("WebSocket", String(args[0])); return new OrigWS(...args); };
});

await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
const afterLoad = log.length;

phase = "job";
const input = await page.$('input[type="file"]');
await input.uploadFile(FILE);
await page.waitForFunction(() => /Ready/.test(document.querySelector(".job-state")?.textContent || ""), { timeout: 30000 });
const clickByText = (t) => page.evaluate((text) => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim().includes(text)); if (!b) throw new Error("no button: " + text); b.click(); }, t);
const buttons = await page.evaluate(() => [...document.querySelectorAll("main button")].map((b) => b.innerText.trim()).filter(Boolean));
const runLabel = buttons.find((b) => /^Compress video/.test(b) || /^Compress/.test(b));
await clickByText(runLabel);
const jobStart = log.length;
await page.waitForFunction(() => /Complete|Failed/.test(document.querySelector(".job-state")?.textContent || ""), { timeout: 400000 });
const state = await page.evaluate(() => document.querySelector(".job-state")?.textContent);
await new Promise((r) => setTimeout(r, 2500));
phase = "after";

const outbound = await page.evaluate(() => window.__outbound);
const fileBytes = statSync(FILE).size;
const duringJob = log.filter((e) => e.phase === "job");
const summary = (entries) => {
  const map = new Map();
  for (const e of entries) {
    const key = `${e.method} ${e.host}${e.path}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([k, n]) => `${n}x ${k}`);
};
const result = {
  url: BASE,
  jobState: state,
  fileBytes,
  requestsAtPageLoad: afterLoad,
  requestsDuringAndAfterJob: log.length - afterLoad,
  nonGetRequests: log.filter((e) => e.method !== "GET").map((e) => `${e.method} ${e.host}${e.path} body=${e.bodyBytes}B (${e.phase})`),
  requestsWithBody: log.filter((e) => e.hasBody || e.bodyBytes > 0).map((e) => `${e.method} ${e.host}${e.path} body=${e.bodyBytes}B (${e.phase})`),
  largestRequestBodyBytes: Math.max(0, ...log.map((e) => e.bodyBytes)),
  hostsAtLoad: [...new Set(log.filter((e) => e.phase === "load").map((e) => e.host))],
  hostsDuringJob: [...new Set(duringJob.map((e) => e.host))],
  hostsAfterJob: [...new Set(log.filter((e) => e.phase === "after").map((e) => e.host))],
  requestsDuringJob: summary(duringJob),
  mainThreadOutboundApis: outbound,
  workerRequests: log.filter((e) => e.source !== "page").map((e) => `${e.source}: ${e.method} ${e.host}${e.path}`),
  allRequests: summary(log),
};
writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
