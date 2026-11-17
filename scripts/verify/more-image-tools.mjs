/**
 * Drives the REAL pages of the picture tools (crop, rotate, remove metadata, hide, watermark, the format pages) in
 * headless Chrome: picks a real file, presses the page's own buttons (and drags with the mouse where the page needs it),
 * then checks the OUTPUT file's pixels and bytes. Needs the Vite dev server:
 *   npx vite --port 5174 --strictPort
 *   node scripts/verify/more-image-tools.mjs [http://localhost:5174] [--only=slug,slug]
 * Test pictures are made in the page (canvas) and, for AVIF, by the Python in .team/venv when it is there.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = (process.argv.find((a) => a.startsWith("http")) || "http://localhost:5174").replace(/\/$/, "");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), "cutmoor-img-"));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  protocolTimeout: 900_000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 140)}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(`console: ${m.text().slice(0, 140)}`);
});
await page.goto(`${BASE}/tools/crop-image/`, { waitUntil: "domcontentloaded", timeout: 180_000 });
await page.waitForSelector('input[type="file"]', { timeout: 120_000 });

// ---- fixtures ----
const made = await page.evaluate(async () => {
  const out = {};
  const toB64 = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const canvas = (w, h, paint) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    paint(c.getContext("2d"), w, h);
    return c;
  };
  const noisy = (g, w, h) => {
    const img = g.createImageData(w, h);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        img.data[i] = (x * 255) / w + rnd() * 60;
        img.data[i + 1] = (y * 255) / h + rnd() * 60;
        img.data[i + 2] = 120 + rnd() * 100;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  };
  const blob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

  const photo = canvas(400, 300, noisy);
  let jpg = new Uint8Array(await (await blob(photo, "image/jpeg", 0.92)).arrayBuffer());

  // Put a real EXIF block (phone, date, GPS) into the JPEG, after the start marker.
  const enc = (s) => Array.from(s, (c) => c.charCodeAt(0));
  const tiff = (() => {
    const o = [];
    const u16 = (n) => o.push(n & 255, (n >> 8) & 255);
    const u32 = (n) => o.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
    o.push(...enc("II"));
    u16(42);
    u32(8);
    const make = enc("Apple\0");
    const model = enc("iPhone 15 Pro\0");
    const ifd0 = 2 + 3 * 12 + 4;
    const makeAt = 8 + ifd0;
    const modelAt = makeAt + make.length;
    const gpsAt = modelAt + model.length;
    u16(3);
    const entry = (tag, type, count, v) => (u16(tag), u16(type), u32(count), type === 3 && count === 1 ? (u16(v), u16(0)) : u32(v));
    entry(0x010f, 2, make.length, makeAt);
    entry(0x0110, 2, model.length, modelAt);
    entry(0x8825, 4, 1, gpsAt);
    u32(0);
    o.push(...make, ...model);
    const ratAt = gpsAt + 2 + 4 * 12 + 4;
    u16(4);
    entry(1, 2, 2, 78);
    entry(2, 5, 3, ratAt);
    entry(3, 2, 2, 69);
    entry(4, 5, 3, ratAt + 24);
    u32(0);
    for (const [n, d] of [[28, 1], [36, 1], [50, 1], [77, 1], [12, 1], [30, 1]]) (u32(n), u32(d));
    return o;
  })();
  const app1 = [0xff, 0xe1, (tiff.length + 8) >> 8, (tiff.length + 8) & 255, ...enc("Exif\0\0"), ...tiff];
  const withExif = new Uint8Array([jpg[0], jpg[1], ...app1, ...jpg.subarray(2)]);
  out["photo.jpg"] = await toB64(new Blob([jpg]));
  out["exif.jpg"] = await toB64(new Blob([withExif]));

  // PNG with a transparent corner and a text chunk
  const alpha = canvas(200, 200, (g) => {
    g.clearRect(0, 0, 200, 200);
    g.fillStyle = "#cc2244";
    g.beginPath();
    g.arc(100, 100, 70, 0, Math.PI * 2);
    g.fill();
  });
  const png = new Uint8Array(await (await blob(alpha, "image/png")).arrayBuffer());
  out["alpha.png"] = await toB64(new Blob([png]));
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = [...enc(type), ...data];
    const c = crc(body);
    return [(data.length >>> 24) & 255, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255, ...body, c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255];
  };
  // insert tEXt + tIME right after IHDR (8 signature + 25 bytes)
  const text = chunk("tEXt", [...enc("Author"), 0, ...enc("Secret Person")]);
  const time = chunk("tIME", [7, 232, 5, 17, 10, 30, 0]);
  out["meta.png"] = await toB64(new Blob([new Uint8Array([...png.subarray(0, 33), ...text, ...time, ...png.subarray(33)])]));

  out["pic.webp"] = await toB64(await blob(photo, "image/webp", 0.9));
  out["vec.svg"] = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><circle cx="100" cy="50" r="40" fill="#2255cc"/></svg>');
  return out;
});
const F = {};
for (const [name, b64] of Object.entries(made)) {
  F[name] = join(dir, name);
  writeFileSync(F[name], Buffer.from(b64, "base64"));
}
const python = join(process.cwd(), ".team", "venv", "Scripts", "python.exe");
if (existsSync(python)) {
  try {
    F["test.avif"] = join(dir, "test.avif");
    execFileSync(python, ["-I", "-c", `from PIL import Image\nim=Image.new('RGB',(320,240),(200,40,40))\nim.save(r'${F["test.avif"]}')`], { stdio: "ignore" });
  } catch {
    delete F["test.avif"];
  }
}

// ---- helpers ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickButton = (text) =>
  page.evaluate((t) => {
    const buttons = [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.offsetParent !== null);
    const el = buttons.find((b) => b.innerText.trim().toLowerCase().includes(t.toLowerCase()));
    if (!el) throw new Error(`no enabled button with text "${t}". Buttons: ${buttons.map((b) => b.innerText.trim()).join(" | ").slice(0, 300)}`);
    el.click();
  }, text);
const waitDone = () => page.waitForFunction(() => document.querySelector(".job-state-done") || document.querySelector(".job-state-error"), { timeout: 120_000, polling: 100 });
const upload = async (...files) => (await page.$('input[type="file"]')).uploadFile(...files);

/** The output file: name, size, first bytes, decoded size, and the pixels (as RGBA) when asked. */
const output = (withPixels = false) =>
  page.evaluate(async (withPixels) => {
    const link = document.querySelector(".job-panel a[download]");
    const state = document.querySelector(".job-state")?.textContent?.trim();
    if (!link) return { state, error: document.querySelector(".job-panel [role=alert], .job-error")?.textContent?.trim() || "no download link" };
    const blob = await (await fetch(link.href)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const bmp = await createImageBitmap(blob);
    const result = { state, name: link.getAttribute("download"), bytes: blob.size, head: [...bytes.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(""), w: bmp.width, h: bmp.height };
    if (withPixels) {
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      result.pixels = Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data);
    }
    result.fileBytes = withPixels ? undefined : Array.from(bytes);
    return result;
  }, withPixels);

const results = [];
const report = (slug, label, problems, extra = {}) => {
  const ok = problems.length === 0;
  results.push(ok);
  console.log(JSON.stringify({ slug, label, ok, ...(ok ? extra : { problems }) }));
};
const near = (a, b, tol = 0) => Math.abs(a - b) <= tol;
const pixelAt = (o, x, y) => o.pixels.slice((y * o.w + x) * 4, (y * o.w + x) * 4 + 4);
/** Mean absolute difference between two same-size pixel arrays over a rectangle. */
const meanDiff = (a, b, w, rect) => {
  let sum = 0;
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 1)
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const i = (y * w + x) * 4;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  return sum / n;
};
/** Decode a fixture file in the page and return its pixels (the picture the page was given). */
const sourcePixels = (b64) =>
  page.evaluate(async (b64, type) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type }));
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d");
    g.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, pixels: Array.from(g.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, b64, "image/jpeg");

const flows = {
  "crop-image": async () => {
    await upload(F["photo.jpg"]);
    await page.waitForSelector(".stage-box");
    await clickButton("1:1 square");
    await sleep(200);
    await clickButton("Crop picture");
    await waitDone();
    const o = await output();
    const problems = [];
    if (o.error) problems.push(o.error);
    if (o.w !== 300 || o.h !== 300) problems.push(`size ${o.w}x${o.h}, expected 300x300`);
    if (o.head !== "ffd8ffe0" && !o.head?.startsWith("ffd8ff")) problems.push(`not a JPG (${o.head})`);
    report("crop-image", "1:1 crop of a 400x300 picture is 300x300 JPG", problems, { out: `${o.w}x${o.h}` });

    // dragging a corner changes the box
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="file"]');
    await upload(F["photo.jpg"]);
    await page.waitForSelector(".stage-box");
    await page.evaluate(() => document.querySelector(".stage").scrollIntoView({ block: "center", behavior: "instant" }));
    await sleep(200);
    const handle = await page.$(".stage-handle[data-pos=se]");
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 80, hb.y - 60, { steps: 6 });
    await page.mouse.up();
    await sleep(150);
    await clickButton("Crop picture");
    await waitDone();
    const d = await output();
    const dp = [];
    if (!(d.w < 400 && d.h < 300 && d.w > 100)) dp.push(`dragged crop is ${d.w}x${d.h}, expected smaller than the picture`);
    report("crop-image", "dragging the corner shrinks the crop", dp, { out: `${d.w}x${d.h}` });

    // circle
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="file"]');
    await upload(F["photo.jpg"]);
    await page.waitForSelector(".stage-box");
    await page.evaluate(() => [...document.querySelectorAll("input[type=checkbox]")].find((c) => c.closest("label")?.innerText.includes("Round"))?.click());
    await sleep(300);
    await clickButton("Crop picture");
    await waitDone();
    const c = await output(true);
    const cp = [];
    if (c.error) cp.push(c.error);
    else {
      if (c.head !== "89504e47") cp.push(`circle crop should be PNG, got ${c.head}`);
      if (pixelAt(c, 1, 1)[3] !== 0) cp.push("corner is not transparent");
      if (pixelAt(c, Math.floor(c.w / 2), Math.floor(c.h / 2))[3] !== 255) cp.push("centre is not opaque");
    }
    report("crop-image", "circle crop is a PNG with transparent corners", cp, { out: `${c.w}x${c.h}` });
  },
  "rotate-image": async () => {
    await upload(F["photo.jpg"]);
    await page.waitForSelector(".turn-preview");
    await clickButton("Rotate picture");
    await waitDone();
    const o = await output();
    const problems = [];
    if (o.error) problems.push(o.error);
    if (o.w !== 300 || o.h !== 400) problems.push(`size ${o.w}x${o.h}, expected 300x400`);
    report("rotate-image", "90 right turns 400x300 into 300x400", problems, { out: `${o.w}x${o.h}` });
  },
  "remove-photo-metadata": async () => {
    await upload(F["exif.jpg"]);
    await page.waitForSelector(".found-list");
    const found = await page.evaluate(() => [...document.querySelectorAll(".found-list li")].map((li) => li.innerText.replace(/\s+/g, " ")));
    const fp = [];
    if (!found.some((t) => /Camera or phone.*Apple iPhone 15 Pro/.test(t))) fp.push(`camera not listed: ${found.join(" | ")}`);
    if (!found.some((t) => /GPS location.*28\.61389.*77\.20833/.test(t))) fp.push(`GPS not listed: ${found.join(" | ")}`);
    report("remove-photo-metadata", "lists the phone and the GPS position found in a JPG", fp, { found: found.length });
    await clickButton("Remove hidden data");
    await waitDone();
    const o = await output();
    const problems = [];
    if (o.error) problems.push(o.error);
    else {
      const clean = Buffer.from(o.fileBytes);
      const original = Buffer.from(made["exif.jpg"], "base64");
      if (clean.includes(Buffer.from("Apple")) || clean.includes(Buffer.from("iPhone"))) problems.push("the phone name is still in the file");
      if (clean.includes(Buffer.from("Exif"))) problems.push("an Exif block is still in the file");
      const sos = (b) => b.indexOf(Buffer.from([0xff, 0xda]));
      if (!clean.subarray(sos(clean)).equals(original.subarray(sos(original)))) problems.push("the picture data changed");
      if (o.w !== 400 || o.h !== 300) problems.push(`size ${o.w}x${o.h}`);
    }
    report("remove-photo-metadata", "JPG: hidden data gone, picture bytes identical", problems, { bytes: o.bytes });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="file"]');
    await upload(F["meta.png"]);
    await page.waitForSelector(".found-list");
    await clickButton("Remove hidden data");
    await waitDone();
    const p = await output();
    const pp = [];
    if (p.error) pp.push(p.error);
    else {
      const clean = Buffer.from(p.fileBytes);
      if (clean.includes(Buffer.from("tEXt")) || clean.includes(Buffer.from("tIME")) || clean.includes(Buffer.from("Secret"))) pp.push("PNG text or time chunk still present");
      if (p.w !== 200 || p.h !== 200) pp.push(`size ${p.w}x${p.h}`);
    }
    report("remove-photo-metadata", "PNG: text and time chunks removed, still decodes", pp, { bytes: p.bytes });
  },
  "blur-image": async () => {
    const src = await sourcePixels(made["photo.jpg"]);
    await upload(F["photo.jpg"]);
    await page.waitForSelector(".stage");
    await page.evaluate(() => document.querySelector(".stage").scrollIntoView({ block: "center", behavior: "instant" }));
    await sleep(200);
    const stage = await (await page.$(".stage")).boundingBox();
    // Region: the middle of the picture, in shown pixels.
    const x1 = stage.x + stage.width * 0.25;
    const y1 = stage.y + stage.height * 0.25;
    const x2 = stage.x + stage.width * 0.6;
    const y2 = stage.y + stage.height * 0.65;
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
    await sleep(200);
    const regions = await page.evaluate(() => document.querySelectorAll(".stage-region").length);
    await clickButton("Black box");
    await clickButton("Hide the marked areas");
    await waitDone();
    const o = await output(true);
    const problems = [];
    if (regions !== 1) problems.push(`expected 1 region on the picture, found ${regions}`);
    if (o.error) problems.push(o.error);
    else {
      const inside = { x: Math.round(400 * 0.3), y: Math.round(300 * 0.3), w: Math.round(400 * 0.25), h: Math.round(300 * 0.3) };
      const outside = { x: 0, y: 0, w: 400, h: 60 };
      const centre = pixelAt(o, inside.x + 20, inside.y + 20);
      if (!(centre[0] < 16 && centre[1] < 16 && centre[2] < 16)) problems.push(`inside the box is not black: ${centre}`);
      const away = meanDiff(o.pixels, src.pixels, 400, outside);
      if (away > 14) problems.push(`the untouched top strip changed (mean difference ${away.toFixed(1)})`);
    }
    report("blur-image", "black box covers the marked area and leaves the rest", problems, { out: `${o.w}x${o.h}` });

    // pixelate: the area becomes flat blocks (far less detail than the original noise)
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[type="file"]');
    await upload(F["photo.jpg"]);
    await page.waitForSelector(".stage");
    await page.evaluate(() => document.querySelector(".stage").scrollIntoView({ block: "center", behavior: "instant" }));
    await sleep(200);
    const s2 = await (await page.$(".stage")).boundingBox();
    await page.mouse.move(s2.x + s2.width * 0.1, s2.y + s2.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(s2.x + s2.width * 0.9, s2.y + s2.height * 0.9, { steps: 8 });
    await page.mouse.up();
    await clickButton("Hide the marked areas");
    await waitDone();
    const q = await output(true);
    const qp = [];
    if (q.error) qp.push(q.error);
    else {
      const rowDetail = (o, y, x0, x1) => {
        let sum = 0;
        for (let x = x0; x < x1 - 1; x += 1) sum += Math.abs(o.pixels[(y * o.w + x) * 4] - o.pixels[(y * o.w + x + 1) * 4]);
        return sum / (x1 - x0 - 1);
      };
      const before = rowDetail(src, 150, 60, 340);
      const after = rowDetail(q, 150, 60, 340);
      if (!(after < before * 0.4)) qp.push(`pixelated detail ${after.toFixed(1)} is not much lower than the original ${before.toFixed(1)}`);
    }
    report("blur-image", "pixelate removes the fine detail in the area", qp);
  },
  "watermark-image": async () => {
    const src = await sourcePixels(made["photo.jpg"]);
    await upload(F["photo.jpg"]);
    await page.waitForSelector(".mark-preview");
    await sleep(700);
    const overlay = await page.evaluate(() => Boolean(document.querySelector(".mark-overlay")));
    await clickButton("Add watermark");
    await waitDone();
    const o = await output(true);
    const problems = [];
    if (!overlay) problems.push("no overlay in the preview");
    if (o.error) problems.push(o.error);
    else {
      const corner = meanDiff(o.pixels, src.pixels, 400, { x: 400 - 8 - 88, y: 300 - 8 - 22, w: 88, h: 22 });
      const far = meanDiff(o.pixels, src.pixels, 400, { x: 0, y: 0, w: 200, h: 100 });
      if (!(corner > 8)) problems.push(`bottom-right did not change enough (${corner.toFixed(1)})`);
      if (!(far < 14)) problems.push(`top-left changed (${far.toFixed(1)})`);
      if (o.w !== 400 || o.h !== 300) problems.push(`size ${o.w}x${o.h}`);
    }
    report("watermark-image", "text mark appears bottom right, rest unchanged", problems);
  },
  "webp-to-jpg": async () => {
    await upload(F["pic.webp"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Convert to JPG");
    await waitDone();
    const o = await output();
    const problems = [];
    if (o.error) problems.push(o.error);
    if (!o.head?.startsWith("ffd8ff")) problems.push(`not a JPG (${o.head})`);
    if (o.w !== 400 || o.h !== 300) problems.push(`size ${o.w}x${o.h}`);
    report("webp-to-jpg", "WebP becomes a JPG of the same size", problems);
  },
  "png-to-jpg": async () => {
    await upload(F["alpha.png"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Convert to JPG");
    await waitDone();
    const o = await output(true);
    const problems = [];
    if (o.error) problems.push(o.error);
    else {
      if (!o.head?.startsWith("ffd8ff")) problems.push(`not a JPG (${o.head})`);
      const corner = pixelAt(o, 2, 2);
      if (!(corner[0] > 240 && corner[1] > 240 && corner[2] > 240 && corner[3] === 255)) problems.push(`transparent corner not filled white: ${corner}`);
    }
    report("png-to-jpg", "transparent PNG becomes a JPG with a white fill", problems);
  },
  "jpg-to-png": async () => {
    await upload(F["photo.jpg"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Convert to PNG");
    await waitDone();
    const o = await output();
    const problems = [];
    if (o.error) problems.push(o.error);
    if (o.head !== "89504e47") problems.push(`not a PNG (${o.head})`);
    if (o.w !== 400 || o.h !== 300) problems.push(`size ${o.w}x${o.h}`);
    report("jpg-to-png", "JPG becomes a PNG of the same size", problems);
  },
  "svg-to-png": async () => {
    await upload(F["vec.svg"]);
    await page.waitForSelector(".settings-card");
    await clickButton("Convert to PNG");
    await waitDone();
    const o = await output(true);
    const problems = [];
    if (o.error) problems.push(o.error);
    else {
      if (o.head !== "89504e47") problems.push(`not a PNG (${o.head})`);
      if (o.w !== 200 || o.h !== 100) problems.push(`size ${o.w}x${o.h}, expected 200x100`);
      if (pixelAt(o, 1, 1)[3] !== 0) problems.push("background is not transparent");
      const c = pixelAt(o, 100, 50);
      if (!(c[2] > 150 && c[0] < 80)) problems.push(`circle colour wrong: ${c}`);
    }
    report("svg-to-png", "SVG becomes a transparent PNG at its own size", problems);
  },
  "avif-to-jpg": async () => {
    if (!F["test.avif"]) {
      console.log(JSON.stringify({ slug: "avif-to-jpg", label: "skipped: no AVIF test file could be made", ok: true }));
      return;
    }
    await upload(F["test.avif"]);
    await page.waitForSelector(".settings-card", { timeout: 20_000 });
    await clickButton("Convert to JPG");
    await waitDone();
    const o = await output(true);
    const problems = [];
    if (o.error) problems.push(o.error);
    else {
      if (!o.head?.startsWith("ffd8ff")) problems.push(`not a JPG (${o.head})`);
      if (o.w !== 320 || o.h !== 240) problems.push(`size ${o.w}x${o.h}`);
      const c = pixelAt(o, 160, 120);
      if (!(c[0] > 170 && c[1] < 80 && c[2] < 80)) problems.push(`colour wrong: ${c}`);
    }
    report("avif-to-jpg", "AVIF becomes a JPG with the right colours", problems);
  },
};

for (const slug of Object.keys(flows)) {
  if (ONLY.length && !ONLY.includes(slug)) continue;
  try {
    await page.goto(`${BASE}/tools/${slug}/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForSelector('input[type="file"]', { timeout: 60_000 });
    await sleep(500);
    await flows[slug]();
  } catch (error) {
    results.push(false);
    console.log(JSON.stringify({ slug, ok: false, problems: [String(error.message || error).slice(0, 400)] }));
  }
}
const real = consoleErrors.filter((e) => !/favicon|ERR_BLOCKED|Failed to load resource/.test(e));
if (real.length) console.log("console errors:", real.slice(0, 8));
const failed = results.filter((r) => !r).length;
console.log(failed === 0 && real.length === 0 ? `ALL OK (${results.length} checks)` : `FAILED: ${failed} check(s), ${real.length} console error(s)`);
await browser.close();
process.exit(failed === 0 && real.length === 0 ? 0 : 1);
