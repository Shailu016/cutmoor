/**
 * The sample clip's picture: a sunset over a mountain lake with a hot-air balloon,
 * drawn on a canvas as a pure function of time. scripts/make-sample.mjs renders it
 * frame by frame and encodes it with the site's own FFmpeg.
 *
 * Runs in the browser (it is injected into a page), so it uses no imports.
 * Everything is seeded: the same time always draws the same frame.
 */
(() => {
  const W = 1280;
  const H = 720;
  const HORIZON = 470;
  const DURATION = 6;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, v) => {
    const k = clamp((v - a) / (b - a));
    return k * k * (3 - 2 * k);
  };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const rgb = (c, alpha = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;

  // Golden hour at the start, dusk at the end.
  const DAY = {
    top: hex("#1f3a8a"),
    upper: hex("#5a5fb8"),
    mid: hex("#f0907a"),
    low: hex("#ffc27a"),
    horizon: hex("#ffe2a6"),
    haze: hex("#e8a48c"),
    near: hex("#161a3e"),
    cloud: hex("#ffd0b0"),
    cloudShade: hex("#c9799a"),
  };
  const DUSK = {
    top: hex("#080c28"),
    upper: hex("#272a6b"),
    mid: hex("#8a4585"),
    low: hex("#f07a70"),
    horizon: hex("#ffb07c"),
    haze: hex("#8d5a8c"),
    near: hex("#090b22"),
    cloud: hex("#f19a9a"),
    cloudShade: hex("#5c3f80"),
  };

  function palette(p) {
    const out = {};
    for (const key of Object.keys(DAY)) out[key] = mix(DAY[key], DUSK[key], p);
    return out;
  }

  // ---- fixed scenery, generated once ----
  const starRand = mulberry32(11);
  const STARS = Array.from({ length: 170 }, () => ({
    x: starRand() * W,
    y: starRand() * 330,
    r: 0.5 + starRand() * 1.1,
    phase: starRand() * 6.283,
    speed: 1.5 + starRand() * 3,
  }));

  const RIDGES = [
    { seed: 3.1, base: 432, amp: 78, freq: 0.0034, speed: 4, depth: 0.0 },
    { seed: 7.7, base: 452, amp: 66, freq: 0.0047, speed: 8, depth: 0.34 },
    { seed: 12.9, base: 470, amp: 50, freq: 0.0061, speed: 14, depth: 0.68 },
  ];

  function ridgeY(ridge, x) {
    const u = x * ridge.freq + ridge.seed;
    const ridged = 1 - Math.abs(Math.sin(u * 1.0));
    const shape =
      0.55 * ridged * ridged +
      0.25 * (0.5 + 0.5 * Math.sin(u * 2.31 + 1.3)) +
      0.12 * (1 - Math.abs(Math.sin(u * 4.7 + 0.4))) +
      0.05 * Math.sin(u * 11.3) +
      0.03 * Math.sin(u * 23.7 + 2.0);
    return ridge.base - ridge.amp * shape;
  }

  const CLOUDS = [
    { x: 150, y: 150, s: 1.25, speed: 9, seed: 21 },
    { x: 930, y: 105, s: 1.0, speed: 6, seed: 22 },
    { x: 1130, y: 245, s: 0.8, speed: 11, seed: 23 },
    { x: 420, y: 285, s: 0.7, speed: 13, seed: 24 },
    { x: -80, y: 320, s: 0.9, speed: 12, seed: 25 },
  ].map((cloud) => {
    const rand = mulberry32(cloud.seed);
    const puffs = Array.from({ length: 9 }, (_, i) => ({
      dx: (i - 4) * 34 + (rand() - 0.5) * 22,
      dy: (rand() - 0.5) * 14 - Math.sin((i / 8) * Math.PI) * 12,
      r: 34 + rand() * 30,
    }));
    return { ...cloud, puffs };
  });

  const treeRand = mulberry32(41);
  const TREES = [];
  for (let i = 0; i < 26; i += 1) {
    const left = i % 2 === 0;
    const edge = treeRand();
    const x = left ? edge * edge * 370 - 10 : W - edge * edge * 350 + 10;
    const distance = left ? x / 370 : (W - x) / 350; // 0 at the edge, 1 towards the middle
    TREES.push({ x, h: lerp(190, 70, distance) * (0.75 + treeRand() * 0.5), sway: treeRand() * 6.283 });
  }
  TREES.sort((a, b) => a.h - b.h);

  const grainTiles = [];
  function grainTile(index) {
    if (grainTiles[index]) return grainTiles[index];
    const size = 256;
    const tile = document.createElement("canvas");
    tile.width = size;
    tile.height = size;
    const tctx = tile.getContext("2d");
    const image = tctx.createImageData(size, size);
    const rand = mulberry32(900 + index);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = 128 + (rand() + rand() + rand() - 1.5) * 110;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    tctx.putImageData(image, 0, 0);
    grainTiles[index] = tile;
    return tile;
  }

  // ---- drawing ----
  function drawSky(ctx, c) {
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
    sky.addColorStop(0, rgb(c.top));
    sky.addColorStop(0.36, rgb(c.upper));
    sky.addColorStop(0.7, rgb(c.mid));
    sky.addColorStop(0.9, rgb(c.low));
    sky.addColorStop(1, rgb(c.horizon));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, HORIZON + 2);
  }

  function drawStars(ctx, t, p) {
    const visible = smooth(0.3, 1, p);
    if (visible <= 0) return;
    for (const star of STARS) {
      const twinkle = 0.55 + 0.45 * Math.sin(star.phase + t * star.speed);
      const fade = 1 - smooth(120, 330, star.y);
      ctx.fillStyle = `rgba(255,248,235,${(visible * twinkle * fade * 0.9).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, 6.283);
      ctx.fill();
    }
  }

  function sunPosition(t) {
    return { x: 742 - t * 3, y: 352 + t * 17 };
  }

  function drawSun(ctx, t, p) {
    const { x, y } = sunPosition(t);
    const wide = ctx.createRadialGradient(x, y, 0, x, y, 430);
    wide.addColorStop(0, `rgba(255,214,150,${lerp(0.62, 0.5, p)})`);
    wide.addColorStop(0.35, `rgba(255,150,110,${lerp(0.26, 0.22, p)})`);
    wide.addColorStop(1, "rgba(255,140,110,0)");
    ctx.fillStyle = wide;
    ctx.fillRect(0, 0, W, HORIZON + 2);

    const disc = ctx.createRadialGradient(x, y, 0, x, y, 62);
    disc.addColorStop(0, "rgba(255,252,236,1)");
    disc.addColorStop(0.62, "rgba(255,238,190,1)");
    disc.addColorStop(0.74, "rgba(255,214,150,0.55)");
    disc.addColorStop(1, "rgba(255,200,140,0)");
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(x, y, 62, 0, 6.283);
    ctx.fill();
  }

  function drawClouds(ctx, t, c) {
    for (const cloud of CLOUDS) {
      const cx = ((cloud.x + t * cloud.speed + 300) % (W + 600)) - 300;
      ctx.save();
      ctx.translate(cx, cloud.y);
      ctx.scale(cloud.s * 1.9, cloud.s * 0.5);
      for (const puff of cloud.puffs) {
        const g = ctx.createRadialGradient(puff.dx, puff.dy + puff.r * 0.25, 0, puff.dx, puff.dy, puff.r);
        g.addColorStop(0, rgb(c.cloud, 0.5));
        g.addColorStop(0.55, rgb(mix(c.cloud, c.cloudShade, 0.55), 0.26));
        g.addColorStop(1, rgb(c.cloudShade, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(puff.dx, puff.dy, puff.r, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function ridgePath(ctx, ridge, t, floor) {
    const shift = t * ridge.speed;
    ctx.beginPath();
    ctx.moveTo(0, floor);
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, ridgeY(ridge, x + shift));
    ctx.lineTo(W, floor);
    ctx.closePath();
  }

  function drawRidges(ctx, t, c) {
    for (const ridge of RIDGES) {
      const color = mix(c.haze, c.near, ridge.depth);
      const g = ctx.createLinearGradient(0, ridge.base - ridge.amp, 0, HORIZON);
      g.addColorStop(0, rgb(color));
      g.addColorStop(1, rgb(mix(color, c.horizon, 0.42 * (1 - ridge.depth))));
      ctx.fillStyle = g;
      ridgePath(ctx, ridge, t, HORIZON + 2);
      ctx.fill();
    }
  }

  function drawLake(ctx, t, p, c) {
    const water = ctx.createLinearGradient(0, HORIZON, 0, H);
    water.addColorStop(0, rgb(mix(c.horizon, c.mid, 0.35)));
    water.addColorStop(0.22, rgb(mix(c.mid, c.upper, 0.45)));
    water.addColorStop(0.65, rgb(mix(c.upper, c.top, 0.6)));
    water.addColorStop(1, rgb(mix(c.top, [4, 6, 20], 0.45)));
    ctx.fillStyle = water;
    ctx.fillRect(0, HORIZON, W, H - HORIZON);

    // The ridges, mirrored and softened.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HORIZON, W, H - HORIZON);
    ctx.clip();
    ctx.translate(0, HORIZON * 2);
    ctx.scale(1, -1);
    ctx.globalAlpha = 0.42;
    for (const ridge of RIDGES) {
      ctx.fillStyle = rgb(mix(mix(c.haze, c.near, ridge.depth), c.top, 0.25));
      ridgePath(ctx, ridge, t, HORIZON + 2);
      ctx.fill();
    }
    ctx.restore();

    // The sun's path on the water: flickering bands that widen towards the shore.
    const sun = sunPosition(t);
    const rand = mulberry32(77);
    for (let i = 0; i < 150; i += 1) {
      const depth = rand();
      const y = HORIZON + 3 + depth * depth * (H - HORIZON - 40);
      const spread = 16 + depth * 150;
      const offset = (rand() - 0.5) * 2;
      const width = (10 + rand() * 46) * (0.6 + depth);
      const flicker = 0.5 + 0.5 * Math.sin(t * (2.2 + rand() * 3.4) + rand() * 6.283);
      const x = sun.x + offset * spread + Math.sin(t * 1.3 + i) * 5;
      const alpha = (1 - Math.abs(offset)) * flicker * lerp(0.6, 0.42, p) * (1 - depth * 0.35);
      ctx.fillStyle = `rgba(255,220,168,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, width / 2, 1.1 + depth * 1.8, 0, 0, 6.283);
      ctx.fill();
    }

    // Small ripples across the whole lake.
    const ripple = mulberry32(131);
    for (let i = 0; i < 260; i += 1) {
      const depth = ripple();
      const y = HORIZON + 4 + depth * (H - HORIZON - 20);
      const x = (ripple() * (W + 200) + t * (6 + depth * 26)) % (W + 200) - 100;
      const width = 14 + ripple() * 60 * (0.4 + depth);
      const flicker = 0.5 + 0.5 * Math.sin(t * (1.4 + ripple() * 2.6) + ripple() * 6.283);
      ctx.fillStyle = rgb(mix(c.low, c.horizon, 0.5), (0.05 + 0.1 * flicker) * (0.5 + depth * 0.5));
      ctx.beginPath();
      ctx.ellipse(x, y, width / 2, 0.8 + depth * 1.2, 0, 0, 6.283);
      ctx.fill();
    }

    // A thin bright line where water meets land.
    const line = ctx.createLinearGradient(0, HORIZON - 2, 0, HORIZON + 5);
    line.addColorStop(0, rgb(c.horizon, 0));
    line.addColorStop(0.5, rgb(c.horizon, 0.5));
    line.addColorStop(1, rgb(c.horizon, 0));
    ctx.fillStyle = line;
    ctx.fillRect(0, HORIZON - 2, W, 7);
  }

  function drawBirds(ctx, t, p) {
    ctx.strokeStyle = `rgba(22,20,48,${lerp(0.75, 0.6, p)})`;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    const flock = [
      [0, 0, 1],
      [-26, 12, 0.85],
      [22, 16, 0.9],
      [-52, 26, 0.75],
      [48, 34, 0.8],
    ];
    const fx = 150 + t * 46;
    const fy = 235 - t * 9;
    flock.forEach(([dx, dy, s], i) => {
      const flap = Math.sin(t * 7 + i * 1.3);
      const x = fx + dx;
      const y = fy + dy;
      const span = 9 * s;
      ctx.beginPath();
      ctx.moveTo(x - span, y - flap * 4 * s);
      ctx.quadraticCurveTo(x - span * 0.4, y - 3 * s - flap * 1.5, x, y);
      ctx.quadraticCurveTo(x + span * 0.4, y - 3 * s - flap * 1.5, x + span, y - flap * 4 * s);
      ctx.stroke();
    });
  }

  function drawBalloon(ctx, t, p) {
    const x = 520 + t * 11 + Math.sin(t * 0.9) * 4;
    const y = 236 - t * 7 + Math.sin(t * 1.4) * 3;
    const R = 58;
    const tilt = Math.sin(t * 0.9) * 0.035;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    const envelope = () => {
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.bezierCurveTo(R * 1.12, -R, R * 1.08, R * 0.42, R * 0.2, R * 1.24);
      ctx.lineTo(-R * 0.2, R * 1.24);
      ctx.bezierCurveTo(-R * 1.08, R * 0.42, -R * 1.12, -R, 0, -R);
      ctx.closePath();
    };

    // Stripes, clipped to the envelope. Each gore narrows towards the edge like a sphere's.
    ctx.save();
    envelope();
    ctx.clip();
    const stripes = ["#ff6a4d", "#fff1dc", "#2d4bf0", "#fff1dc", "#ff6a4d", "#fff1dc", "#2d4bf0", "#fff1dc"];
    for (let i = 0; i < stripes.length; i += 1) {
      const a0 = -Math.PI / 2 + (i / stripes.length) * Math.PI;
      const a1 = -Math.PI / 2 + ((i + 1) / stripes.length) * Math.PI;
      const x0 = Math.sin(a0) * R * 1.1;
      const x1 = Math.sin(a1) * R * 1.1;
      ctx.fillStyle = stripes[i];
      ctx.beginPath();
      ctx.moveTo(0, -R * 1.05);
      ctx.bezierCurveTo(x0 * 1.25, -R * 0.9, x0 * 1.15, R * 0.5, x0 * 0.18, R * 1.3);
      ctx.lineTo(x1 * 0.18, R * 1.3);
      ctx.bezierCurveTo(x1 * 1.15, R * 0.5, x1 * 1.25, -R * 0.9, 0, -R * 1.05);
      ctx.closePath();
      ctx.fill();
    }
    // Sunset light from the right, shade on the left, and dusk settling over everything.
    const light = ctx.createLinearGradient(-R, 0, R, 0);
    light.addColorStop(0, `rgba(30,22,70,${lerp(0.5, 0.62, p)})`);
    light.addColorStop(0.55, `rgba(60,30,80,${lerp(0.1, 0.3, p)})`);
    light.addColorStop(1, `rgba(255,190,120,${lerp(0.34, 0.2, p)})`);
    ctx.fillStyle = light;
    ctx.fillRect(-R * 1.3, -R * 1.2, R * 2.6, R * 2.7);
    const top = ctx.createLinearGradient(0, -R, 0, R * 1.3);
    top.addColorStop(0, "rgba(255,255,255,0.14)");
    top.addColorStop(0.5, "rgba(0,0,0,0)");
    top.addColorStop(1, "rgba(10,8,40,0.34)");
    ctx.fillStyle = top;
    ctx.fillRect(-R * 1.3, -R * 1.2, R * 2.6, R * 2.7);
    ctx.restore();

    // Skirt, ropes and basket.
    ctx.fillStyle = "#231a3d";
    ctx.beginPath();
    ctx.moveTo(-R * 0.2, R * 1.24);
    ctx.lineTo(R * 0.2, R * 1.24);
    ctx.lineTo(R * 0.15, R * 1.36);
    ctx.lineTo(-R * 0.15, R * 1.36);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(30,22,56,0.9)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-R * 0.15, R * 1.36);
    ctx.lineTo(-R * 0.13, R * 1.62);
    ctx.moveTo(R * 0.15, R * 1.36);
    ctx.lineTo(R * 0.13, R * 1.62);
    ctx.moveTo(0, R * 1.36);
    ctx.lineTo(0, R * 1.62);
    ctx.stroke();
    // The burner's glow gets easier to see as the light goes.
    const flame = 0.55 + 0.45 * Math.sin(t * 9) * Math.sin(t * 3.1);
    const glow = ctx.createRadialGradient(0, R * 1.42, 0, 0, R * 1.42, R * 0.5);
    glow.addColorStop(0, `rgba(255,214,130,${(lerp(0.35, 0.9, p) * flame).toFixed(3)})`);
    glow.addColorStop(1, "rgba(255,170,90,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-R * 0.5, R * 0.95, R, R);
    ctx.fillStyle = "#2a1c33";
    ctx.beginPath();
    ctx.roundRect(-R * 0.16, R * 1.62, R * 0.32, R * 0.24, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,180,120,0.3)";
    ctx.fillRect(R * 0.07, R * 1.64, R * 0.07, R * 0.2);

    ctx.restore();
  }

  function drawShore(ctx, t, c) {
    const dark = mix(c.near, [3, 4, 14], 0.55);
    ctx.fillStyle = rgb(dark);

    const bank = (fromLeft) => {
      ctx.beginPath();
      if (fromLeft) {
        ctx.moveTo(0, H);
        ctx.lineTo(0, 566);
        ctx.bezierCurveTo(120, 574, 250, 610, 330, 650);
        ctx.bezierCurveTo(390, 680, 430, 705, 470, H);
      } else {
        ctx.moveTo(W, H);
        ctx.lineTo(W, 580);
        ctx.bezierCurveTo(1170, 590, 1060, 626, 990, 664);
        ctx.bezierCurveTo(950, 686, 920, 706, 890, H);
      }
      ctx.closePath();
      ctx.fill();
    };
    bank(true);
    bank(false);

    for (const tree of TREES) {
      const groundY = tree.x < W / 2 ? lerp(568, 660, clamp(tree.x / 370)) : lerp(582, 668, clamp((W - tree.x) / 350));
      const lean = Math.sin(t * 1.1 + tree.sway) * 0.012;
      ctx.save();
      ctx.translate(tree.x, groundY + 8);
      ctx.rotate(lean);
      const h = tree.h;
      ctx.fillRect(-h * 0.02, -h * 0.2, h * 0.04, h * 0.2);
      const tiers = 6;
      for (let i = 0; i < tiers; i += 1) {
        const k = i / tiers;
        const yTop = -h + k * h * 0.78;
        const yBottom = yTop + h * 0.3;
        const half = h * (0.05 + k * 0.17);
        ctx.beginPath();
        ctx.moveTo(0, yTop);
        ctx.lineTo(half, yBottom);
        ctx.lineTo(half * 0.45, yBottom - h * 0.04);
        ctx.lineTo(-half * 0.45, yBottom - h * 0.04);
        ctx.lineTo(-half, yBottom);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawFinish(ctx, frameIndex) {
    const vignette = ctx.createRadialGradient(W / 2, H * 0.46, H * 0.42, W / 2, H * 0.5, W * 0.72);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(4,4,20,0.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    // Fine grain, like footage has. A different tile and offset every frame.
    const tile = grainTile(frameIndex % 6);
    const rand = mulberry32(5000 + frameIndex);
    const ox = Math.floor(rand() * 256);
    const oy = Math.floor(rand() * 256);
    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.06;
    for (let y = -oy; y < H; y += 256) for (let x = -ox; x < W; x += 256) ctx.drawImage(tile, x, y);
    ctx.restore();
  }

  function drawSampleScene(ctx, t, frameIndex = Math.round(t * 24)) {
    const p = smooth(0, 1, clamp(t / DURATION));
    const c = palette(p);
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    drawSky(ctx, c);
    drawStars(ctx, t, p);
    drawSun(ctx, t, p);
    drawClouds(ctx, t, c);
    drawBirds(ctx, t, p);
    drawRidges(ctx, t, c);
    drawLake(ctx, t, p, c);
    drawBalloon(ctx, t, p);
    drawShore(ctx, t, c);
    drawFinish(ctx, frameIndex);
    ctx.restore();
  }

  window.SAMPLE_SCENE = { width: W, height: H, duration: DURATION, draw: drawSampleScene };
})();
