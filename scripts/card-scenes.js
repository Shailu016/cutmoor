/**
 * The pictures and clips behind the home-page tool cards, drawn on a canvas in code. One scene per tool, each chosen
 * so that the tool's change is obvious at a glance (see .team notes: Pinterest research 2026-11-17). Nothing here is
 * traced or copied: shapes, colours and type are ours. scripts/make-card-sources.mjs renders them (stills as PNG,
 * clips encoded with the site's own FFmpeg) and scripts/make-card-art.mjs runs the real tools on the results.
 *
 * Runs in the browser (it is injected into a page), so it uses no imports. Everything is seeded: the same time
 * always draws the same frame.
 */
(() => {
  const TAU = Math.PI * 2;
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, v) => {
    const k = clamp((v - a) / (b - a));
    return k * k * (3 - 2 * k);
  };
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixc = (a, b, k) => {
    const x = hex(a), y = hex(b);
    return `rgb(${Math.round(lerp(x[0], y[0], k))},${Math.round(lerp(x[1], y[1], k))},${Math.round(lerp(x[2], y[2], k))})`;
  };
  const vgrad = (ctx, y0, y1, stops) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    return g;
  };
  const FONT = '"Geist Variable", "Segoe UI", system-ui, sans-serif';
  const MONO = '"Geist Mono Variable", Consolas, monospace';

  /** A ridge line made of a few sine waves: used for mountains, dunes and hills. */
  function ridge(ctx, w, h, base, amp, seed, color, step = 8) {
    const r = rng(seed);
    const waves = [0, 1, 2].map(() => ({ f: 0.6 + r() * 2.6, p: r() * TAU, a: 0.4 + r() * 0.6 }));
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + step; x += step) {
      let y = 0;
      for (const v of waves) y += Math.sin((x / w) * v.f * TAU + v.p) * v.a;
      ctx.lineTo(x, base - (y / 2) * amp);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function pine(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const top = y - s * (1 - i * 0.22);
      const half = s * (0.16 + i * 0.07);
      ctx.moveTo(x, top);
      ctx.lineTo(x - half, top + s * 0.34);
      ctx.lineTo(x + half, top + s * 0.34);
    }
    ctx.fill();
    ctx.fillRect(x - s * 0.025, y - s * 0.05, s * 0.05, s * 0.12);
  }

  // ---------------------------------------------------------------- 1. Neon city at night (Compress video)
  const neonCity = {
    width: 1280, height: 720, duration: 6,
    draw(ctx, t) {
      const W = 1280, H = 720, HZ = 430;
      ctx.fillStyle = vgrad(ctx, 0, HZ, [[0, "#0a0620"], [0.55, "#2a0f4d"], [1, "#a0246e"]]);
      ctx.fillRect(0, 0, W, HZ);
      // far skyline
      const far = rng(11);
      for (let x = -20; x < W; ) {
        const bw = 40 + far() * 70, bh = 120 + far() * 220;
        ctx.fillStyle = "#1a0b33";
        ctx.fillRect(x, HZ - bh, bw, bh);
        for (let wy = HZ - bh + 10; wy < HZ - 8; wy += 14)
          for (let wx = x + 6; wx < x + bw - 6; wx += 11) if (far() < 0.28) {
            ctx.fillStyle = far() < 0.5 ? "rgba(255,190,120,0.7)" : "rgba(140,200,255,0.55)";
            ctx.fillRect(wx, wy, 5, 7);
          }
        x += bw + 4;
      }
      // near buildings with neon signs
      const near = rng(29);
      const signs = [["NOODLES", "#ff3df2"], ["24H", "#3df2ff"], ["CINEMA", "#ffd23d"], ["BAR", "#ff5a3d"], ["HOTEL", "#7dff8a"], ["ARCADE", "#3d8bff"]];
      let si = 0;
      for (let x = 10; x < W; ) {
        const bw = 150 + near() * 110, bh = 260 + near() * 200;
        ctx.fillStyle = vgrad(ctx, HZ - bh, HZ + 40, [[0, "#140a28"], [1, "#07040f"]]);
        ctx.fillRect(x, HZ + 40 - bh, bw, bh);
        for (let wy = HZ + 40 - bh + 18; wy < HZ + 10; wy += 22)
          for (let wx = x + 12; wx < x + bw - 14; wx += 20) if (near() < 0.35) {
            ctx.fillStyle = `rgba(255,${170 + near() * 60},${110 + near() * 60},${0.35 + near() * 0.5})`;
            ctx.fillRect(wx, wy, 9, 12);
          }
        const [label, color] = signs[si++ % signs.length];
        const flicker = 0.75 + 0.25 * Math.sin(t * (6 + si) + si * 2);
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 22;
        ctx.globalAlpha = flicker;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        const sx = x + 16, sy = HZ + 40 - bh + 40 + near() * 80;
        ctx.font = `700 ${label.length > 4 ? 26 : 34}px ${FONT}`;
        const tw = ctx.measureText(label).width;
        ctx.strokeRect(sx - 8, sy - 30, tw + 16, 42);
        ctx.fillStyle = color;
        ctx.fillText(label, sx, sy);
        ctx.restore();
        x += bw + 18;
      }
      // wet street and reflections
      ctx.fillStyle = vgrad(ctx, HZ + 40, H, [[0, "#12081f"], [1, "#05030a"]]);
      ctx.fillRect(0, HZ + 40, W, H - HZ - 40);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.translate(0, (HZ + 40) * 2);
      ctx.scale(1, -1);
      ctx.filter = "blur(6px)";
      ctx.drawImage(ctx.canvas, 0, HZ - 160, W, 200, 0, HZ - 160, W, 200);
      ctx.restore();
      // road lines rushing toward us
      for (let i = 0; i < 6; i++) {
        const k = ((i / 6 + t * 0.35) % 1);
        const y = lerp(HZ + 60, H + 40, k * k);
        const w = lerp(6, 70, k * k);
        ctx.fillStyle = `rgba(255,220,150,${0.25 + k * 0.5})`;
        ctx.fillRect(W / 2 - w / 2, y, w, 4 + k * 18);
      }
      // rain
      const rain = rng(7);
      ctx.strokeStyle = "rgba(200,220,255,0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 260; i++) {
        const x = rain() * W, speed = 700 + rain() * 500;
        const y = ((rain() * H + t * speed) % (H + 40)) - 20;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 6, y + 22);
      }
      ctx.stroke();
    },
  };

  // ---------------------------------------------------------------- 2. Desert road with a cyclist (Crop & resize)
  const desertRoad = {
    width: 1280, height: 720, duration: 6,
    draw(ctx, t) {
      const W = 1280, H = 720, HZ = 380;
      ctx.fillStyle = vgrad(ctx, 0, HZ, [[0, "#2b6cb0"], [0.6, "#7fb8e8"], [1, "#ffd9a0"]]);
      ctx.fillRect(0, 0, W, HZ);
      ctx.fillStyle = "rgba(255,240,200,0.95)";
      ctx.beginPath();
      ctx.arc(W * 0.78, 150, 46, 0, TAU);
      ctx.fill();
      // mesas
      ctx.fillStyle = "#c2603a";
      [[60, 210, 120], [300, 150, 80], [880, 260, 140], [1120, 140, 100]].forEach(([x, w, hgt]) => {
        ctx.beginPath();
        ctx.moveTo(x - 20, HZ);
        ctx.lineTo(x + 10, HZ - hgt);
        ctx.lineTo(x + w - 10, HZ - hgt);
        ctx.lineTo(x + w + 20, HZ);
        ctx.fill();
      });
      ridge(ctx, W, H, HZ + 20, 30, 3, "#e0955a");
      ridge(ctx, W, H, HZ + 90, 50, 4, "#d07a45");
      ridge(ctx, W, H, HZ + 200, 70, 5, "#b85e34");
      // road
      ctx.fillStyle = "#3a3340";
      ctx.beginPath();
      ctx.moveTo(W / 2 - 8, HZ);
      ctx.lineTo(W / 2 + 8, HZ);
      ctx.lineTo(W / 2 + 330, H);
      ctx.lineTo(W / 2 - 330, H);
      ctx.fill();
      for (let i = 0; i < 9; i++) {
        const k = (i / 9 + t * 0.4) % 1;
        const y = lerp(HZ, H, k * k);
        ctx.fillStyle = "#ffd86b";
        ctx.fillRect(W / 2 - lerp(1, 7, k * k), y, lerp(2, 14, k * k), lerp(4, 40, k * k));
      }
      // cyclist, centred, pedalling
      const cx = W / 2, cy = 560, wheel = 34, a = t * 7;
      ctx.strokeStyle = "#141018";
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      [[cx - 46, cy], [cx + 46, cy]].forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, wheel, 0, TAU);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(cx - 46, cy);
      ctx.lineTo(cx - 6, cy - 46);
      ctx.lineTo(cx + 34, cy - 46);
      ctx.lineTo(cx + 46, cy);
      ctx.moveTo(cx - 6, cy - 46);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + 34, cy - 46);
      ctx.stroke();
      const px = cx + Math.cos(a) * 16, py = cy + Math.sin(a) * 16;
      ctx.fillStyle = "#e8452c";
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 112);
      ctx.lineTo(cx + 26, cy - 70);
      ctx.lineTo(cx - 8, cy - 52);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#141018";
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy - 56);
      ctx.lineTo(px, py);
      ctx.moveTo(cx + 18, cy - 92);
      ctx.lineTo(cx + 36, cy - 52);
      ctx.stroke();
      ctx.fillStyle = "#141018";
      ctx.beginPath();
      ctx.arc(cx - 2, cy - 128, 15, 0, TAU);
      ctx.fill();
    },
  };

  // ---------------------------------------------------------------- 3. Slate, then the shot (Trim video)
  const slateThenShot = {
    width: 1280, height: 720, duration: 6,
    draw(ctx, t) {
      const W = 1280, H = 720;
      if (t < 2) {
        const bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
        bars.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fillRect((i * W) / 7, 0, W / 7 + 1, H * 0.62);
        });
        ctx.fillStyle = "#111";
        ctx.fillRect(0, H * 0.62, W, H * 0.38);
        // clapperboard
        const clap = t > 1.4 ? 0 : 0.35 * (1 - smooth(1.1, 1.4, t));
        ctx.save();
        ctx.translate(W / 2 - 230, 250);
        ctx.fillStyle = "#151515";
        ctx.fillRect(0, 60, 460, 300);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 60, 460, 300);
        ctx.fillStyle = "#fff";
        ctx.font = `600 30px ${MONO}`;
        ctx.fillText("SCENE  12", 30, 140);
        ctx.fillText("TAKE   3", 30, 200);
        ctx.fillText("ROLL   A04", 30, 260);
        ctx.font = `500 20px ${MONO}`;
        ctx.fillText(`TC 00:00:0${Math.floor(t)}:${String(Math.floor((t % 1) * 24)).padStart(2, "0")}`, 30, 330);
        ctx.save();
        ctx.translate(0, 60);
        ctx.rotate(-clap);
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = i % 2 ? "#fff" : "#151515";
          ctx.beginPath();
          ctx.moveTo(i * 58, -50);
          ctx.lineTo(i * 58 + 58, -50);
          ctx.lineTo(i * 58 + 30, 0);
          ctx.lineTo(i * 58 - 28, 0);
          ctx.fill();
        }
        ctx.strokeRect(0, -50, 460, 50);
        ctx.restore();
        ctx.restore();
        return;
      }
      // the shot: a paper plane gliding over green hills at morning
      const s = t - 2;
      ctx.fillStyle = vgrad(ctx, 0, H, [[0, "#7cc6ff"], [0.6, "#d8f0ff"], [1, "#fff6dc"]]);
      ctx.fillRect(0, 0, W, H);
      const cl = rng(5);
      for (let i = 0; i < 6; i++) {
        const x = ((cl() * W + s * 30 * (1 + i * 0.2)) % (W + 300)) - 150, y = 80 + cl() * 220;
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.ellipse(x, y, 90, 26, 0, 0, TAU);
        ctx.ellipse(x + 50, y - 16, 60, 26, 0, 0, TAU);
        ctx.fill();
      }
      ridge(ctx, W, H, 470, 80, 21, "#7fc77a");
      ridge(ctx, W, H, 540, 70, 22, "#4fa860");
      ridge(ctx, W, H, 630, 60, 23, "#2f8a4c");
      for (let i = 0; i < 14; i++) pine(ctx, 40 + i * 92 + (i % 3) * 14, 650 + (i % 2) * 20, 80, "#1d5c34");
      const px = lerp(-120, W + 120, s / 4), py = 260 + Math.sin(s * 2.2) * 50;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.cos(s * 2.2) * 0.18);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#1b2a4a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(70, 0);
      ctx.lineTo(-60, -34);
      ctx.lineTo(-30, 0);
      ctx.lineTo(-60, 30);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#dfe7f5";
      ctx.beginPath();
      ctx.moveTo(70, 0);
      ctx.lineTo(-30, 0);
      ctx.lineTo(-44, 14);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };

  // ---------------------------------------------------------------- 4. Day-to-night time-lapse (Change speed)
  const timelapse = {
    width: 1280, height: 720, duration: 6,
    draw(ctx, t) {
      const W = 1280, H = 720, HZ = 520;
      const k = t / 6; // 0 = noon, 1 = night
      const top = k < 0.5 ? mixc("#3b82f6", "#f97316", k * 2) : mixc("#f97316", "#0b1030", (k - 0.5) * 2);
      const low = k < 0.5 ? mixc("#bfe3ff", "#ffd27a", k * 2) : mixc("#ffd27a", "#30215a", (k - 0.5) * 2);
      ctx.fillStyle = vgrad(ctx, 0, HZ, [[0, top], [1, low]]);
      ctx.fillRect(0, 0, W, HZ);
      // sun then moon on an arc
      const sa = lerp(-0.2, 1.15, k) * Math.PI;
      ctx.fillStyle = k < 0.72 ? "#fff3c4" : "#e8ecff";
      ctx.beginPath();
      ctx.arc(W / 2 - Math.cos(sa) * 520, HZ - Math.sin(sa) * 420, 38, 0, TAU);
      ctx.fill();
      if (k > 0.65) {
        const st = rng(8);
        ctx.fillStyle = `rgba(255,255,255,${smooth(0.65, 0.9, k)})`;
        for (let i = 0; i < 120; i++) ctx.fillRect(st() * W, st() * HZ * 0.8, 2, 2);
      }
      // clouds racing
      const cl = rng(41);
      for (let i = 0; i < 7; i++) {
        const x = ((cl() * W + t * 260 * (0.6 + cl())) % (W + 400)) - 200, y = 60 + cl() * 200;
        ctx.fillStyle = `rgba(255,255,255,${0.75 * (1 - k * 0.7)})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 110, 22, 0, 0, TAU);
        ctx.ellipse(x + 40, y - 14, 70, 22, 0, 0, TAU);
        ctx.fill();
      }
      // skyline with windows turning on
      const b = rng(17);
      for (let x = 0; x < W; ) {
        const bw = 60 + b() * 90, bh = 120 + b() * 260;
        ctx.fillStyle = mixc("#2a3550", "#0a0d1c", k);
        ctx.fillRect(x, HZ - bh, bw, bh + 200);
        for (let wy = HZ - bh + 12; wy < HZ + 150; wy += 18)
          for (let wx = x + 8; wx < x + bw - 8; wx += 14) {
            const on = b() < smooth(0.45, 0.95, k) * 0.7;
            if (on) {
              ctx.fillStyle = "rgba(255,206,120,0.9)";
              ctx.fillRect(wx, wy, 7, 10);
            }
          }
        x += bw + 6;
      }
      // clock tower, hands spinning: the passing of hours
      const cx = 1010, cy = 230;
      ctx.fillStyle = mixc("#3a4566", "#121633", k);
      ctx.fillRect(cx - 50, cy - 40, 100, HZ - cy + 40);
      ctx.fillStyle = "#f4f1e6";
      ctx.beginPath();
      ctx.arc(cx, cy, 36, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "#1a1d2b";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      const hour = (12 + k * 10) / 12, minute = k * 10;
      [[hour, 18], [minute, 28]].forEach(([turns, len]) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.sin(turns * TAU) * len, cy - Math.cos(turns * TAU) * len);
        ctx.stroke();
      });
      ctx.fillStyle = mixc("#1d2438", "#05060d", k);
      ctx.fillRect(0, HZ + 150, W, H);
    },
  };

  // ---------------------------------------------------------------- 5. A phone clip filmed sideways (Rotate video)
  // The upright picture is portrait (720 x 1280). It is stored turned a quarter to the left, as phones sometimes save
  // it, so the card's "before" is sideways and the real Rotate tool's "90° right" puts it upright.
  function skaterPortrait(ctx, t) {
    const W = 720, H = 1280;
    ctx.fillStyle = vgrad(ctx, 0, H, [[0, "#ff9a62"], [0.45, "#ffcf7a"], [0.46, "#9ad0c2"], [1, "#4b8f8c"]]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fff1c9";
    ctx.beginPath();
    ctx.arc(W * 0.3, 380, 90, 0, TAU);
    ctx.fill();
    // palm tree
    ctx.strokeStyle = "#3b2a2a";
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(560, 1010);
    ctx.quadraticCurveTo(620, 600, 520, 300);
    ctx.stroke();
    ctx.fillStyle = "#1f5d47";
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.45 + Math.sin(t * 2 + i) * 0.05;
      ctx.save();
      ctx.translate(520, 300);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, -110, 26, 120, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    // ramp
    ctx.fillStyle = "#e8e2d4";
    ctx.beginPath();
    ctx.moveTo(0, 1180);
    ctx.quadraticCurveTo(360, 1180, 720, 900);
    ctx.lineTo(720, 1280);
    ctx.lineTo(0, 1280);
    ctx.fill();
    // skater riding up the ramp
    const k = (t % 3) / 3;
    const x = lerp(80, 600, k), y = lerp(1150, 940, k * k);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.25 - k * 0.35);
    ctx.fillStyle = "#1c1c28";
    ctx.fillRect(-70, -8, 140, 12);
    ctx.beginPath();
    ctx.arc(-46, 10, 9, 0, TAU);
    ctx.arc(46, 10, 9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#1c1c28";
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-30, -10);
    ctx.lineTo(-10, -80);
    ctx.lineTo(30, -10);
    ctx.moveTo(-10, -80);
    ctx.lineTo(0, -160);
    ctx.moveTo(0, -140);
    ctx.lineTo(-60, -110);
    ctx.moveTo(0, -140);
    ctx.lineTo(60, -170);
    ctx.stroke();
    ctx.fillStyle = "#2a6cf0";
    ctx.fillRect(-20, -170, 40, 70);
    ctx.fillStyle = "#1c1c28";
    ctx.beginPath();
    ctx.arc(0, -190, 22, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  const sidewaysPhone = {
    width: 1280, height: 720, duration: 6,
    draw(ctx, t) {
      ctx.save();
      // Turned a quarter to the left: the top of the picture ends up on the left side of the frame.
      ctx.translate(0, 720);
      ctx.rotate(-Math.PI / 2);
      skaterPortrait(ctx, t);
      ctx.restore();
    },
  };

  // ---------------------------------------------------------------- 7. Pastel studio still life (Compress image)
  const studio = {
    width: 1920, height: 1080,
    draw(ctx) {
      const W = 1920, H = 1080, FLOOR = 760;
      ctx.fillStyle = vgrad(ctx, 0, FLOOR, [[0, "#f7d9c4"], [1, "#f2c3a5"]]);
      ctx.fillRect(0, 0, W, FLOOR);
      // window light falling across the wall
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#fff6ea";
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(200 + i * 260, 0);
        ctx.lineTo(380 + i * 260, 0);
        ctx.lineTo(780 + i * 260, FLOOR);
        ctx.lineTo(600 + i * 260, FLOOR);
        ctx.fill();
      }
      ctx.restore();
      // arch
      const ax = 1240;
      const ag = ctx.createLinearGradient(ax - 260, 0, ax + 260, 0);
      ag.addColorStop(0, "#f0a873");
      ag.addColorStop(1, "#f6c08f");
      ctx.fillStyle = ag;
      ctx.beginPath();
      ctx.moveTo(ax - 260, FLOOR);
      ctx.lineTo(ax - 260, 400);
      ctx.arc(ax, 400, 260, Math.PI, 0);
      ctx.lineTo(ax + 260, FLOOR);
      ctx.fill();
      // floor
      ctx.fillStyle = vgrad(ctx, FLOOR, H, [[0, "#e8a27c"], [1, "#d98e66"]]);
      ctx.fillRect(0, FLOOR, W, H - FLOOR);
      const podium = (x, y, rx, ry, hgt, top, side) => {
        ctx.fillStyle = "rgba(120,60,30,0.18)";
        ctx.beginPath();
        ctx.ellipse(x + 40, y + hgt + 8, rx * 1.1, ry * 1.1, 0, 0, TAU);
        ctx.fill();
        const g = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
        g.addColorStop(0, side);
        g.addColorStop(0.55, top);
        g.addColorStop(1, side);
        ctx.fillStyle = g;
        ctx.fillRect(x - rx, y, rx * 2, hgt);
        ctx.beginPath();
        ctx.ellipse(x, y + hgt, rx, ry, 0, 0, Math.PI);
        ctx.fill();
        ctx.fillStyle = top;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
        ctx.fill();
      };
      podium(760, 640, 230, 60, 190, "#fbefe6", "#e3cfc2");
      podium(1060, 720, 200, 52, 120, "#fde7a8", "#e9c46a");
      podium(560, 780, 170, 44, 80, "#f7f2ee", "#ddd1c8");
      // sphere
      const sx = 760, sy = 540, r = 100;
      const sg = ctx.createRadialGradient(sx - 35, sy - 40, 10, sx, sy, r);
      sg.addColorStop(0, "#d9f0e6");
      sg.addColorStop(0.7, "#9cc9b4");
      sg.addColorStop(1, "#6fa48c");
      ctx.fillStyle = "rgba(90,50,30,0.2)";
      ctx.beginPath();
      ctx.ellipse(sx + 30, 640, 110, 26, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();
      // ring
      ctx.strokeStyle = "#7b6cf6";
      ctx.lineWidth = 28;
      ctx.beginPath();
      ctx.ellipse(1060, 620, 90, 90, 0, 0, TAU);
      ctx.stroke();
    },
  };

  // ---------------------------------------------------------------- 8. Layered mountains (Resize image)
  const mountains = {
    width: 1920, height: 1080,
    draw(ctx) {
      const W = 1920, H = 1080;
      ctx.fillStyle = vgrad(ctx, 0, H, [[0, "#5bb8e8"], [0.5, "#bfe6f2"], [1, "#e9f6ef"]]);
      ctx.fillRect(0, 0, W, H);
      const cl = rng(12);
      for (let i = 0; i < 6; i++) {
        const x = cl() * W, y = 90 + cl() * 220;
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath();
        ctx.ellipse(x, y, 160, 40, 0, 0, TAU);
        ctx.ellipse(x + 70, y - 30, 100, 44, 0, 0, TAU);
        ctx.ellipse(x - 80, y - 10, 80, 30, 0, 0, TAU);
        ctx.fill();
      }
      // snowy peaks
      ctx.fillStyle = "#7b6fc9";
      ctx.beginPath();
      ctx.moveTo(500, 700);
      ctx.lineTo(860, 300);
      ctx.lineTo(1040, 470);
      ctx.lineTo(1180, 340);
      ctx.lineTo(1500, 700);
      ctx.fill();
      ctx.fillStyle = "#f4f2ff";
      ctx.beginPath();
      ctx.moveTo(860, 300);
      ctx.lineTo(930, 378);
      ctx.lineTo(890, 370);
      ctx.lineTo(860, 400);
      ctx.lineTo(830, 360);
      ctx.lineTo(790, 378);
      ctx.fill();
      ridge(ctx, W, H, 690, 120, 31, "#4fa3a5");
      ridge(ctx, W, H, 780, 110, 32, "#3d8f6e");
      ridge(ctx, W, H, 880, 90, 33, "#7fbf5a");
      ridge(ctx, W, H, 980, 70, 34, "#2f6e4f");
      const tr = rng(9);
      for (let i = 0; i < 22; i++) pine(ctx, tr() * W, 940 + tr() * 120, 120 + tr() * 80, "#1c4a36");
    },
  };

  // ---------------------------------------------------------------- 9. A product on a podium, off-centre (Crop image)
  const product = {
    width: 1920, height: 1080,
    draw(ctx) {
      const W = 1920, H = 1080, FLOOR = 800;
      ctx.fillStyle = vgrad(ctx, 0, FLOOR, [[0, "#dfe9e2"], [1, "#c9dbd0"]]);
      ctx.fillRect(0, 0, W, FLOOR);
      ctx.fillStyle = vgrad(ctx, FLOOR, H, [[0, "#b9cfc2"], [1, "#a7c1b2"]]);
      ctx.fillRect(0, FLOOR, W, H);
      // big soft circle behind
      ctx.fillStyle = "#cfe0d5";
      ctx.beginPath();
      ctx.arc(1100, 520, 330, 0, TAU);
      ctx.fill();
      // shadow diagonal
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#2f4a3d";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(500, 0);
      ctx.lineTo(1400, FLOOR);
      ctx.lineTo(900, FLOOR);
      ctx.fill();
      ctx.restore();
      // podium
      const x = 1080, y = 760, rx = 260, ry = 54, hgt = 120;
      ctx.fillStyle = "#e9efe9";
      ctx.fillRect(x - rx, y, rx * 2, hgt);
      ctx.beginPath();
      ctx.ellipse(x, y + hgt, rx, ry, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = "#f7faf7";
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
      ctx.fill();
      // bottle: glass body, liquid, cap, label
      const bx = 1080, by = 470;
      ctx.fillStyle = "rgba(60,90,70,0.25)";
      ctx.beginPath();
      ctx.ellipse(bx + 40, y + 6, 130, 22, 0, 0, TAU);
      ctx.fill();
      const g = ctx.createLinearGradient(bx - 120, 0, bx + 120, 0);
      g.addColorStop(0, "#e88a4f");
      g.addColorStop(0.45, "#f8c27a");
      g.addColorStop(1, "#d06a35");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(bx - 120, by, 240, 290, 36);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.roundRect(bx - 96, by + 20, 26, 240, 13);
      ctx.fill();
      ctx.fillStyle = "#2b2b2b";
      ctx.beginPath();
      ctx.roundRect(bx - 50, by - 110, 100, 120, 14);
      ctx.fill();
      ctx.fillStyle = "#f6efe4";
      ctx.fillRect(bx - 80, by + 110, 160, 90);
      ctx.fillStyle = "#2b2b2b";
      ctx.font = `600 34px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("AMBER", bx, by + 160);
      ctx.font = `500 16px ${MONO}`;
      ctx.fillText("No. 07  ·  50 ml", bx, by + 188);
      ctx.textAlign = "left";
    },
  };

  // ---------------------------------------------------------------- 10. Gradient poster with grain (Convert image)
  const poster = {
    width: 1920, height: 1080,
    draw(ctx) {
      const W = 1920, H = 1080;
      ctx.fillStyle = "#1b1140";
      ctx.fillRect(0, 0, W, H);
      const blobs = [[400, 300, 600, "#ff4d6d"], [1300, 250, 650, "#4361ee"], [1000, 800, 700, "#ffb703"], [300, 900, 500, "#7209b7"], [1650, 900, 500, "#06d6a0"]];
      ctx.globalCompositeOperation = "lighter";
      for (const [x, y, r, c] of blobs) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, c);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = "source-over";
      // film grain
      const img = ctx.getImageData(0, 0, W, H);
      const r = rng(77);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (r() - 0.5) * 26;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 210px ${FONT}`;
      ctx.fillText("COLOUR", 120, 560);
      ctx.fillText("FIELD 07", 120, 760);
      ctx.font = `500 30px ${MONO}`;
      ctx.fillText("GRADIENT STUDY  ·  1920 × 1080", 128, 880);
    },
  };

  // ---------------------------------------------------------------- 11. A parked car with a licence plate (Blur / hide)
  const PLATE = { x: 0.405, y: 0.655, w: 0.19, h: 0.07 }; // where the plate sits, as a share of the picture (used by the art script)
  const car = {
    width: 1920, height: 1080, plate: PLATE,
    draw(ctx) {
      const W = 1920, H = 1080;
      ctx.fillStyle = vgrad(ctx, 0, 620, [[0, "#cfd8e3"], [1, "#e9edf2"]]);
      ctx.fillRect(0, 0, W, 620);
      // shop fronts
      const shops = ["#e76f51", "#2a9d8f", "#e9c46a", "#264653"];
      shops.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(i * 480, 120, 470, 500);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillRect(i * 480 + 40, 260, 390, 260);
        ctx.fillStyle = "rgba(0,0,0,0.12)";
        ctx.fillRect(i * 480 + 40, 260, 390, 18);
      });
      ctx.fillStyle = "#9aa3ad";
      ctx.fillRect(0, 620, W, 60);
      ctx.fillStyle = vgrad(ctx, 680, H, [[0, "#4a4f57"], [1, "#2c3036"]]);
      ctx.fillRect(0, 680, W, H - 680);
      // car, front view
      const cx = W / 2;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.ellipse(cx, 960, 520, 40, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#1f2937";
      ctx.fillRect(cx - 440, 860, 110, 100);
      ctx.fillRect(cx + 330, 860, 110, 100);
      const body = ctx.createLinearGradient(0, 480, 0, 920);
      body.addColorStop(0, "#3b82f6");
      body.addColorStop(1, "#1d4ed8");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(cx - 470, 640, 940, 260, 60);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 330, 650);
      ctx.lineTo(cx - 260, 470);
      ctx.lineTo(cx + 260, 470);
      ctx.lineTo(cx + 330, 650);
      ctx.fill();
      ctx.fillStyle = "#a9d6f5";
      ctx.beginPath();
      ctx.moveTo(cx - 290, 640);
      ctx.lineTo(cx - 235, 500);
      ctx.lineTo(cx + 235, 500);
      ctx.lineTo(cx + 290, 640);
      ctx.fill();
      ctx.fillStyle = "#fff7d6";
      [[cx - 360, 730], [cx + 360, 730]].forEach(([x, y]) => {
        ctx.beginPath();
        ctx.ellipse(x, y, 70, 34, 0, 0, TAU);
        ctx.fill();
      });
      ctx.fillStyle = "#111827";
      ctx.fillRect(cx - 200, 690, 400, 80);
      // licence plate
      const px = W * PLATE.x, py = H * PLATE.y, pw = W * PLATE.w, ph = H * PLATE.h;
      ctx.fillStyle = "#fbfbf5";
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, 8);
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.font = `700 50px ${MONO}`;
      ctx.textAlign = "center";
      ctx.fillText("KA 05 MX 2047", px + pw / 2, py + ph / 2 + 17, pw - 28);
      ctx.textAlign = "left";
    },
  };

  // ---------------------------------------------------------------- 12. Lake at golden hour with a canoe (Watermark)
  const lake = {
    width: 1920, height: 1080,
    draw(ctx) {
      const W = 1920, H = 1080, HZ = 600;
      ctx.fillStyle = vgrad(ctx, 0, HZ, [[0, "#3d2c8d"], [0.5, "#c7417b"], [1, "#ffb26b"]]);
      ctx.fillRect(0, 0, W, HZ);
      ctx.fillStyle = "#ffe8b0";
      ctx.beginPath();
      ctx.arc(W * 0.62, HZ - 40, 90, 0, TAU);
      ctx.fill();
      ridge(ctx, W, H, HZ - 60, 120, 51, "#6b3a7a");
      ridge(ctx, W, H, HZ, 70, 52, "#3e2559");
      ctx.fillStyle = vgrad(ctx, HZ, H, [[0, "#f09a73"], [0.4, "#8a4a86"], [1, "#2b1a4a"]]);
      ctx.fillRect(0, HZ, W, H - HZ);
      ctx.fillStyle = "rgba(255,232,176,0.5)";
      for (let i = 0; i < 18; i++) {
        const y = HZ + 20 + i * 22, w = 220 - i * 10;
        ctx.fillRect(W * 0.62 - w / 2, y, w, 4);
      }
      for (let i = 0; i < 9; i++) pine(ctx, 60 + i * 70, HZ + 20, 160 + (i % 3) * 40, "#1d1033");
      // canoe
      ctx.fillStyle = "#1d1033";
      ctx.beginPath();
      ctx.moveTo(1100, 820);
      ctx.quadraticCurveTo(1250, 870, 1400, 820);
      ctx.lineTo(1100, 820);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(1250, 780, 14, 0, TAU);
      ctx.fill();
      ctx.fillRect(1242, 790, 16, 34);
    },
  };

  // ---------------------------------------------------------------- 13. A presenter at a studio desk (Auto captions)
  // Flat-illustration presenter whose mouth moves in short bursts, like someone talking to camera. There is no real
  // speech in the clip: the card says "Sample captions" and the words come from the tool's development stand-in.
  const presenter = {
    // 10 s: long enough that the tool's stand-in places its whole first sentence before the gap it leaves at 55%.
    width: 1280, height: 720, duration: 10,
    draw(ctx, t) {
      const W = 1280, H = 720;
      ctx.fillStyle = vgrad(ctx, 0, H, [[0, "#0f2a43"], [0.6, "#14405a"], [1, "#0b1c2e"]]);
      ctx.fillRect(0, 0, W, H);
      // soft studio lights (bokeh)
      const bk = rng(61);
      for (let i = 0; i < 16; i++) {
        const x = bk() * W, y = bk() * 380, r = 24 + bk() * 60;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const c = ["255,196,120", "120,220,255", "255,140,170"][i % 3];
        g.addColorStop(0, `rgba(${c},0.30)`);
        g.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // shelf with books and a plant
      ctx.fillStyle = "#0a1624";
      ctx.fillRect(820, 300, 360, 12);
      const bookColors = ["#e76f51", "#2a9d8f", "#e9c46a", "#7b6cf6", "#f4a261"];
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = bookColors[i % 5];
        ctx.fillRect(840 + i * 22, 300 - 70 - (i % 3) * 12, 18, 70 + (i % 3) * 12);
      }
      ctx.fillStyle = "#2f8a4c";
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(1120 + i * 8 - 16, 250 - i * 6, 14, 46, (i - 2) * 0.35, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = "#c2603a";
      ctx.fillRect(1100, 276, 52, 24);
      // desk
      ctx.fillStyle = vgrad(ctx, 560, H, [[0, "#3a2a22"], [1, "#22170f"]]);
      ctx.fillRect(0, 560, W, H - 560);
      // microphone on a boom arm
      ctx.strokeStyle = "#1a2433";
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(1010, 570);
      ctx.lineTo(1010, 380);
      ctx.lineTo(820, 330);
      ctx.stroke();
      ctx.fillStyle = "#2c3a50";
      ctx.beginPath();
      ctx.roundRect(765, 300, 70, 110, 30);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(770, 318 + i * 15);
        ctx.lineTo(830, 318 + i * 15);
        ctx.stroke();
      }
      // presenter
      const cx = 560, sway = Math.sin(t * 1.3) * 5;
      // shoulders + jacket
      ctx.fillStyle = "#f0b429";
      ctx.beginPath();
      ctx.moveTo(cx - 260, 720);
      ctx.quadraticCurveTo(cx - 250, 470, cx - 90 + sway, 450);
      ctx.lineTo(cx + 90 + sway, 450);
      ctx.quadraticCurveTo(cx + 250, 470, cx + 260, 720);
      ctx.fill();
      ctx.fillStyle = "#d99a1b";
      ctx.beginPath();
      ctx.moveTo(cx - 40 + sway, 450);
      ctx.lineTo(cx + sway, 560);
      ctx.lineTo(cx + 40 + sway, 450);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(cx - 62 + sway, 446);
      ctx.lineTo(cx + sway, 540);
      ctx.lineTo(cx + 62 + sway, 446);
      ctx.fill();
      // neck
      ctx.fillStyle = "#d89a74";
      ctx.fillRect(cx - 34 + sway, 410, 68, 50);
      // head
      const hx = cx + sway, hy = 330;
      ctx.fillStyle = "#e7b08a";
      ctx.beginPath();
      ctx.ellipse(hx, hy, 98, 116, 0, 0, TAU);
      ctx.fill();
      // hair
      ctx.fillStyle = "#1d1a2b";
      ctx.beginPath();
      ctx.ellipse(hx, hy - 52, 104, 78, 0, Math.PI, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx - 94, hy - 8, 22, 54, 0.1, 0, TAU);
      ctx.ellipse(hx + 94, hy - 8, 22, 54, -0.1, 0, TAU);
      ctx.fill();
      // eyes (blink every ~3 s), brows, nose
      const blink = (t % 3) > 2.85 ? 0.1 : 1;
      ctx.fillStyle = "#ffffff";
      [-38, 38].forEach((dx) => {
        ctx.beginPath();
        ctx.ellipse(hx + dx, hy - 8, 17, 12 * blink, 0, 0, TAU);
        ctx.fill();
      });
      ctx.fillStyle = "#26324a";
      [-38, 38].forEach((dx) => {
        ctx.beginPath();
        ctx.ellipse(hx + dx + 2, hy - 8, 7, 7 * blink, 0, 0, TAU);
        ctx.fill();
      });
      ctx.strokeStyle = "#1d1a2b";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(hx - 58, hy - 36 - Math.sin(t * 2.4) * 3);
      ctx.lineTo(hx - 20, hy - 38);
      ctx.moveTo(hx + 20, hy - 38);
      ctx.lineTo(hx + 58, hy - 36 - Math.sin(t * 2.4) * 3);
      ctx.stroke();
      ctx.strokeStyle = "#c98862";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(hx - 12, hy + 26, hx + 6, hy + 28);
      ctx.stroke();
      // mouth: short bursts of speech with small pauses between phrases
      const phrase = Math.max(0, Math.sin(t * 2.2 + 0.4));
      const open = phrase > 0.15 ? Math.abs(Math.sin(t * 13)) * (0.4 + 0.6 * phrase) : 0.04;
      ctx.fillStyle = "#7a2a38";
      ctx.beginPath();
      ctx.ellipse(hx, hy + 62, 30 + open * 6, 5 + open * 20, 0, 0, TAU);
      ctx.fill();
      if (open > 0.3) {
        ctx.fillStyle = "#fffaf2";
        ctx.fillRect(hx - 24, hy + 56, 48, 6 + open * 4);
      }
      // headset
      ctx.strokeStyle = "#1a2433";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(hx, hy - 14, 108, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.fillStyle = "#1a2433";
      ctx.beginPath();
      ctx.roundRect(hx - 118, hy - 18, 26, 48, 10);
      ctx.fill();
      // ON AIR light
      const on = (Math.floor(t * 2) % 2) === 0 ? "#ff3b3b" : "#8c1d1d";
      ctx.fillStyle = "#0a1624";
      ctx.beginPath();
      ctx.roundRect(60, 60, 150, 54, 12);
      ctx.fill();
      ctx.fillStyle = on;
      ctx.beginPath();
      ctx.arc(92, 87, 11, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#e7eefc";
      ctx.font = `700 24px ${MONO}`;
      ctx.fillText("REC", 116, 96);
    },
  };

  window.CARD_SCENES = {
    clips: { "neon-city": neonCity, "desert-road": desertRoad, "slate-shot": slateThenShot, timelapse, "sideways-phone": sidewaysPhone, presenter },
    stills: { studio, mountains, product, poster, car, lake },
  };
})();
