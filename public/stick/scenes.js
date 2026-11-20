// Cutmoor home-page scenes, drawn with the stick-scene runtime (MIT, see LICENSE-stick-scene.txt).
// One tiny figure does one job per scene: it idles, then plays the job once when the card scrolls into view.
// Load after stick.js. Used as <stick-scene scene="compress" play="view" no-font>.
(function () {
  const SC = (window.SCENES = window.SCENES || {});
  const R = window.RIG;
  const { C, E, P, mix, legs, walkSeg, fig, inkFill, rr, ln, circle, poly, text, seg, breathe, pulse, lp, sparks, tickBadge, lerp, arcArrow } = R;

  const BLUE = '#2d4bf0';
  const HOME = -132;
  const CHIN = P({ hF: [10, -96], head: [7, -116], hB: [-4, -54] });
  const CHEER = P({ hF: [14, -132], hB: [-10, -130], head: [3, -118] });

  // ---------------------------------------------------------------- the shared timeline
  // o.walks: [[t0, t1, from, to], ...] after the first walk in. o.at: where the figure stands to work.
  // o.reach: [t0, t1]: the hand is on o.hand(k). o.cheer: second the cheer starts.
  function scene(id, o) {
    const dur = o.dur || 6;
    const walks = [[0, 0.6, HOME, o.at], ...(o.walks || [])];
    const last = walks[walks.length - 1][3];
    walks.push([dur - 1.25, dur - 0.55, last, HOME]);
    SC[id] = {
      dur,
      width: o.width || 368,
      label: o.label,
      draw(g, S) {
        const T = S.on ? S.u * dur : -1;
        const t = S.t;
        let x = HOME, gait = { ph: 0, amp: 0 };
        let pose = breathe(P({ hF: [12, -60], hB: [-4, -52] }), t);
        const k = { T, t, fade: 1, on: T >= 0, x };
        if (T < 0) {
          pose = mix(pose, CHIN, pulse(t, 5.5, 2, 2.2));
        } else {
          k.fade = 1 - seg(T, dur - 0.45, dur);
          let i = 0;
          for (let j = 0; j < walks.length; j++) {
            if (T >= walks[j][0]) i = j;
          }
          const w = walks[i];
          const ws = walkSeg(T, w[0], w[1], w[2], w[3]);
          x = ws.x;
          gait = w[3] < w[2] ? { ph: -ws.ph, amp: ws.amp, stride: ws.stride } : ws;
          k.x = x;
          const [r0, r1] = o.reach;
          const reach = E.soft(seg(T, r0, r0 + 0.35)) * (1 - E.soft(seg(T, r1, r1 + 0.35)));
          const tp = o.hand(k, x);
          if (tp && reach > 0) {
            pose = mix(pose, P({ hF: lp(tp, x, 0, 1), hB: [-4, -54], head: [9, -114], chest: [3, -90] }), reach);
          }
          const c0 = o.cheer;
          const cheer = E.back(seg(T, c0, c0 + 0.5)) * (1 - E.soft(seg(T, c0 + 1.0, c0 + 1.45)));
          pose = mix(pose, CHEER, cheer);
        }
        pose = legs(pose, gait.ph, gait.amp, { arms: false, stride: gait.stride });
        k.x = x;

        g.save();
        g.translate(-22, 0);
        o.back(g, k);
        fig(g, pose, x, 0, {
          wave: S.wave,
          wt: S.wt,
          held: o.tool ? (gg, J) => R.held(gg, J, (hand) => o.tool(gg, hand, k)) : undefined,
        });
        if (o.front) {
          o.front(g, k);
        }
        g.restore();
      },
    };
  }

  // ---------------------------------------------------------------- small props
  const ease = (k) => E.soft(k);
  const photoItem = (g, cx, cy, w, h, alpha) => {
    g.save();
    g.globalAlpha *= alpha ?? 1;
    rr(g, cx - w / 2, cy - h / 2, w, h, 3);
    inkFill(g, C.paper, 1.6);
    circle(g, cx + w * 0.22, cy - h * 0.18, h * 0.12);
    inkFill(g, C.butter, 1.2);
    poly(g, [[cx - w * 0.42, cy + h * 0.38], [cx - w * 0.1, cy - h * 0.08], [cx + w * 0.12, cy + h * 0.22], [cx + w * 0.26, cy + h * 0.06], [cx + w * 0.42, cy + h * 0.38]], true);
    inkFill(g, C.green, 1.2, C.greenInk);
    g.restore();
  };
  const filmItem = (g, cx, cy, w, h) => {
    rr(g, cx - w / 2, cy - h / 2, w, h, 3);
    inkFill(g, C.butterSoft, 1.6);
    const n = Math.max(3, Math.round(w / 9));
    for (let i = 0; i < n; i++) {
      const px = cx - w / 2 + (w / n) * (i + 0.5);
      rr(g, px - 1.6, cy - h / 2 + 2.2, 3.2, 3, 0.8);
      inkFill(g, C.paper, 0.8);
      rr(g, px - 1.6, cy + h / 2 - 5.2, 3.2, 3, 0.8);
      inkFill(g, C.paper, 0.8);
    }
    poly(g, [[cx - h * 0.16, cy - h * 0.2], [cx - h * 0.16, cy + h * 0.2], [cx + h * 0.2, cy]], true);
    inkFill(g, C.ink, 1);
  };
  const cardItem = (g, cx, cy, label, fill) => {
    rr(g, cx - 15, cy - 10, 30, 20, 3);
    inkFill(g, fill || C.paper, 1.5);
    text(g, label, cx, cy + 3.3, 8.5, C.ink);
  };

  // ---------------------------------------------------------------- compress (video and image): a press squeezes the file down
  function press(id, label, item, from, to, unit) {
    const BASE = -44, POSTL = 62, POSTR = 138, CX = 100, H0 = 50, W0 = 62;
    const SHRINK = 0.46;
    scene(id, {
      label,
      at: 8,
      reach: [0.55, 3.15],
      cheer: 3.55,
      hand(k) {
        const p = this.p(k);
        const a = ((lerp(40, -14, p) * Math.PI) / 180);
        return [POSTL - 4 - 21 * Math.cos(a), -84 - 21 * Math.sin(a)];
      },
      p(k) {
        if (!k.on) {
          return 0;
        }
        const down = E.in(seg(k.T, 1.0, 1.9));
        const up = ease(seg(k.T, 2.6, 3.2));
        return down * (1 - up);
      },
      back(g, k) {
        const p = this.p(k);
        const squeezed = k.on ? ease(seg(k.T, 1.3, 1.9)) * k.fade : 0;
        const sc = lerp(1, SHRINK, squeezed);
        const h = H0 * sc, w = W0 * sc;
        // frame and table
        ln(g, POSTL, -150, POSTL, 0, 3);
        ln(g, POSTR, -150, POSTR, 0, 3);
        ln(g, POSTL - 4, -150, POSTR + 4, -150, 3);
        rr(g, POSTL + 4, BASE, POSTR - POSTL - 8, 5, 2);
        inkFill(g, C.wood, 1.5);
        // platen follows the lever
        const top = BASE - h;
        const free = -104;
        const bottom = lerp(free, top, p);
        const py = bottom;
        ln(g, CX - 22, -148, CX - 22, py - 6, 1.5, C.far);
        ln(g, CX + 22, -148, CX + 22, py - 6, 1.5, C.far);
        rr(g, CX - 36, py - 6, 72, 6, 2);
        inkFill(g, C.steel, 1.6);
        // the file
        item(g, CX, BASE - h / 2, w, h);
        // size label
        const mb = lerp(from, to, squeezed);
        text(g, `${mb.toFixed(1)} ${unit}`, CX, BASE + 17, 10, squeezed > 0.9 ? C.greenInk : C.umber);
        // lever
        const a = (lerp(40, -14, p) * Math.PI) / 180;
        const tip = [POSTL - 4 - 21 * Math.cos(a), -84 - 21 * Math.sin(a)];
        ln(g, POSTL, -84, tip[0], tip[1], 3, C.ink);
        circle(g, tip[0], tip[1], 3.4);
        inkFill(g, C.butter, 1.3);
        circle(g, POSTL, -84, 2.4);
        inkFill(g, C.paper, 1.2);
        tickBadge(g, CX + W0 / 2 + 4, BASE - H0 - 2, k.on ? seg(k.T, 3.0, 3.5) * k.fade : 0, 8);
        if (k.on) {
          sparks(g, CX, top - 8, seg(k.T, 1.85, 2.4), 18, 6, C.amber);
        }
      },
    });
  }
  press('compress', 'A stick figure pulls a lever and a press squeezes a video file from 5.5 MB down to 1.9 MB.', (g, cx, cy, w, h) => filmItem(g, cx, cy, w, h), 5.5, 1.9, 'MB');
  press('compress-image', 'A stick figure pulls a lever and a press squeezes a photo from 683 KB down to 33 KB.', (g, cx, cy, w, h) => photoItem(g, cx, cy, w, h), 682.7, 33.2, 'KB');

  // ---------------------------------------------------------------- convert-image: push a PNG card in, a WebP card comes out
  scene('convert-image', {
    label: 'A stick figure pushes a PNG card into a converter and a smaller WebP card slides out the other side.',
    at: -8,
    walks: [[1.0, 1.7, -8, 8]],
    reach: [0.6, 2.35],
    cheer: 3.55,
    push(k) {
      return k.on ? ease(seg(k.T, 1.0, 1.7)) : 0;
    },
    hand(k) {
      const c = 26 + 24 * this.push(k);
      return [c - 15, -68];
    },
    back(g, k) {
      const push = this.push(k);
      const gears = k.on ? seg(k.T, 1.7, 3.2) : 0;
      const out = k.on ? ease(seg(k.T, 2.7, 3.4)) * k.fade : 0;
      const bx = 62, by = -108, bw = 76, bh = 62;
      // legs and body of the machine
      ln(g, bx + 10, by + bh, bx + 6, 0, 2.2);
      ln(g, bx + bw - 10, by + bh, bx + bw - 6, 0, 2.2);
      // in-tray
      ln(g, 20, -52, 20, 0, 2);
      rr(g, 8, -60, 44, 5, 2);
      inkFill(g, C.wood, 1.4);
      // the PNG card slides in (clipped by the machine's left wall)
      g.save();
      g.beginPath();
      g.rect(-40, -100, bx + 44, 90);
      g.clip();
      cardItem(g, 26 + 24 * push, -70, 'PNG', C.paper);
      g.restore();
      rr(g, bx, by, bw, bh, 6);
      inkFill(g, C.paper, 1.7);
      // slot mouth on the left
      rr(g, bx - 2, -76, 7, 14, 2);
      inkFill(g, C.ink, 1.2);
      // two gears that spin while it works
      for (let i = 0; i < 2; i++) {
        const gx = bx + 24 + i * 28, gy = by + 24;
        g.save();
        g.translate(gx, gy);
        g.rotate(gears * (i ? -1 : 1) * 6.28 * 1.2);
        circle(g, 0, 0, 9);
        inkFill(g, C.butterSoft, 1.4);
        for (let j = 0; j < 6; j++) {
          const a = (j / 6) * 6.28;
          ln(g, Math.cos(a) * 9, Math.sin(a) * 9, Math.cos(a) * 12.5, Math.sin(a) * 12.5, 2.6, C.ink);
        }
        circle(g, 0, 0, 2);
        inkFill(g, C.ink, 1);
        g.restore();
      }
      text(g, 'convert', bx + bw / 2, by + bh - 7, 8.5, C.umber);
      // exit: WebP card slides onto a little shelf
      g.save();
      g.beginPath();
      g.rect(bx + bw - 4, -110, 120, 90);
      g.clip();
      g.globalAlpha *= out > 0 ? 1 : 0;
      cardItem(g, lerp(bx + bw - 14, bx + bw + 28, out), -70, 'WEBP', C.butterSoft);
      g.restore();
      rr(g, bx + bw + 4, -58, 44, 5, 2);
      inkFill(g, C.wood, 1.4);
      ln(g, bx + bw + 12, -53, bx + bw + 12, 0, 2);
      ln(g, bx + bw + 38, -53, bx + bw + 38, 0, 2);
      tickBadge(g, bx + bw + 30, -92, k.on ? seg(k.T, 3.2, 3.7) * k.fade : 0, 8);
    },
  });

  // ---------------------------------------------------------------- trim: snip the slate off the front of a film strip
  scene('trim', {
    label: 'A stick figure snips the slate off the front of a film strip with scissors and holds up the shorter clip.',
    at: 46,
    reach: [0.55, 3.2],
    cheer: 3.6,
    dur: 6.2,
    snip(k) {
      if (!k.on) {
        return 0;
      }
      // two quick snips of the blades
      return Math.max(Math.sin(Math.PI * seg(k.T, 1.3, 1.65)), Math.sin(Math.PI * seg(k.T, 1.75, 2.1)));
    },
    cut(k) {
      return k.on ? seg(k.T, 2.05, 2.15) : 0;
    },
    hand(k) {
      return [88, -76];
    },
    tool(g, hand, k) {
      // scissors: two blades pivoting at the hand, open by the snip amount
      const open = 0.1 + 0.42 * (1 - this.snip(k));
      for (const s of [-1, 1]) {
        g.save();
        g.translate(hand[0] + 2, hand[1]);
        g.rotate(s * open - 0.05);
        ln(g, 0, 0, 20, 0, 2, C.steel);
        ln(g, 0, 0, 20, 0, 1, C.ink);
        ln(g, 0, 0, -7, s * 3.5, 2.2, C.ink);
        g.restore();
      }
      circle(g, hand[0] + 2, hand[1], 1.8);
      inkFill(g, C.butter, 1);
    },
    back(g, k) {
      const fall = k.on ? seg(k.T, 2.05, 3.2) : 0;
      const keep = k.on ? ease(seg(k.T, 2.2, 3.0)) * k.fade : 0;
      const sx0 = 62, sy = -86, sh = 22;
      // rack: two posts and a rail the strip lies on
      ln(g, sx0 + 4, sy + sh + 4, sx0 + 2, 0, 2);
      ln(g, sx0 + 106, sy + sh + 4, sx0 + 108, 0, 2);
      ln(g, sx0 - 4, sy + sh + 4, sx0 + 114, sy + sh + 4, 2.2, C.ink);
      // the kept part of the strip
      const cell = (i, hot) => {
        rr(g, sx0 + 26 + i * 21, sy, 21, sh, 2);
        inkFill(g, hot ? C.butterSoft : C.paper, 1.4);
      };
      for (let i = 0; i < 4; i++) {
        cell(i, false);
        const px = sx0 + 26 + i * 21;
        poly(g, [[px + 8, sy + 6], [px + 8, sy + sh - 6], [px + 15, sy + sh / 2]], true);
        g.fillStyle = C.faint;
        g.fill();
      }
      // the slate that gets cut off falls away
      g.save();
      const fx = sx0 + 13 - 8 * E.out(fall);
      const fy = sy + sh / 2 + (-sy - sh / 2 - 8) * E.in(fall) * (k.on ? 1 : 0);
      g.translate(fx, fy);
      g.rotate(-0.9 * E.in(fall));
      g.globalAlpha *= 1 - seg(fall, 0.6, 1);
      rr(g, -13, -sh / 2, 26, sh, 2);
      inkFill(g, C.steel, 1.4);
      ln(g, -13, -sh / 2 + 7, 13, -sh / 2 + 7, 1.2);
      text(g, 'slate', 0, 6, 8, C.muted);
      g.restore();
      // the cut line
      if (k.on && fall <= 0) {
        g.save();
        g.setLineDash([3, 3]);
        ln(g, sx0 + 26, sy - 6, sx0 + 26, sy + sh + 6, 1.2, C.redInk);
        g.restore();
      }
      g.save();
      g.globalAlpha *= 1 - keep;
      text(g, '6.0 s', sx0 + 110, sy - 8, 9, C.muted, 'right');
      g.restore();
      g.save();
      g.globalAlpha *= keep;
      text(g, '4.0 s', sx0 + 110, sy - 8, 9, C.greenInk, 'right');
      g.restore();
      g.save();
      g.globalAlpha = 1;
      tickBadge(g, sx0 + 120, sy - 19, keep > 0 ? seg(k.T, 3.0, 3.5) * k.fade : 0, 8);
      g.restore();
    },
  });

  // ---------------------------------------------------------------- video-speed: press the 2x button and the lower ball races away
  scene('video-speed', {
    label: 'A stick figure presses a 2x button and a ball on the lower track finishes in half the time of the ball on the upper track.',
    at: 14,
    reach: [0.6, 2.2],
    cheer: 4.45,
    dur: 6.4,
    hand(k) {
      const press = k.on ? Math.sin(Math.PI * seg(k.T, 1.2, 1.7)) : 0;
      return [48 - press * 4, -74];
    },
    back(g, k) {
      const T = k.T;
      const pressed = k.on ? seg(T, 1.45, 1.6) : 0;
      // console with a big button
      ln(g, 44, -62, 40, 0, 2.4);
      ln(g, 70, -62, 74, 0, 2.4);
      rr(g, 34, -100, 42, 40, 5);
      inkFill(g, C.paper, 1.7);
      circle(g, 55, -78 + pressed * 2, 10);
      inkFill(g, pressed > 0 && T < 4.7 ? C.butter : C.paper, 1.6);
      text(g, '2×', 55, -74.5 + pressed * 2, 10, C.umber);
      text(g, 'speed', 55, -91, 8, C.muted);
      // two tracks
      const x0 = 100, x1 = 160;
      for (const [y, lab] of [[-100, '1×'], [-64, '2×']]) {
        ln(g, x0, y, x1, y, 2, C.far);
        ln(g, x1, y - 6, x1, y + 6, 1.6, C.ink);
        ln(g, x0, y - 6, x0, y + 6, 1.6, C.ink);
        text(g, lab, x0 - 10, y + 3.5, 9, C.muted, 'right');
      }
      const run = (a, b) => (k.on ? seg(T, a, b) : 0);
      const slow = run(1.9, 4.3);
      const fast = run(1.9, 3.1);
      const reset = k.on ? 1 - seg(T, 5.95, 6.4) : 1;
      const ball = (y, f, col) => {
        circle(g, x0 + (x1 - x0) * f * reset, y, 5);
        inkFill(g, col, 1.4);
      };
      ball(-100, slow, C.paper);
      ball(-64, fast, C.butter);
      // time labels
      g.save();
      g.globalAlpha *= k.on ? seg(T, 4.3, 4.6) * (1 - seg(T, 5.9, 6.3)) : 0;
      text(g, '6.0 s', x1, -112, 9, C.muted, 'right');
      g.restore();
      g.save();
      g.globalAlpha *= k.on ? seg(T, 3.1, 3.4) * (1 - seg(T, 5.9, 6.3)) : 0;
      text(g, '3.0 s', x1, -52, 9, C.greenInk, 'right');
      g.restore();
      tickBadge(g, x1 + 17, -64, k.on ? seg(T, 3.2, 3.7) * k.fade : 0, 7);
    },
  });

  // ---------------------------------------------------------------- rotate-video: turn a crank and the sideways clip comes upright
  scene('rotate-video', {
    label: 'A stick figure turns a crank and a sideways phone clip rotates upright.',
    at: 8,
    reach: [0.6, 3.25],
    cheer: 3.7,
    dur: 6.2,
    turn(k) {
      return k.on ? ease(seg(k.T, 1.0, 3.0)) : 0;
    },
    hand(k) {
      const a = this.turn(k) * Math.PI * 2 + 0.6;
      return [38 + 8 * Math.cos(a), -82 + 8 * Math.sin(a)];
    },
    back(g, k) {
      const turn = this.turn(k);
      const done = k.on ? turn * k.fade : 0;
      // crank post with a wheel
      ln(g, 42, -82, 42, 0, 3);
      ln(g, 30, 0, 54, 0, 3);
      const a = turn * Math.PI * 2 + 0.6;
      circle(g, 42, -82, 5.5);
      inkFill(g, C.paper, 1.5);
      ln(g, 42, -82, 42 + 8 * Math.cos(a), -82 + 8 * Math.sin(a), 2.6);
      circle(g, 42 + 8 * Math.cos(a), -82 + 8 * Math.sin(a), 2.8);
      inkFill(g, C.butter, 1.2);
      // belt to a wheel under the frame
      ln(g, 42, -88, 112, -66, 1.2, C.far);
      ln(g, 42, -76, 112, -56, 1.2, C.far);
      circle(g, 112, -61, 8);
      inkFill(g, C.paper, 1.4);
      g.save();
      g.translate(112, -61);
      g.rotate(turn * Math.PI * 2);
      ln(g, -8, 0, 8, 0, 1.4);
      ln(g, 0, -8, 0, 8, 1.4);
      g.restore();
      // the clip frame: sideways at first, upright at the end
      g.save();
      g.translate(112, -108);
      g.rotate(-Math.PI / 2 * (1 - done));
      rr(g, -23, -35, 46, 70, 6);
      inkFill(g, C.paper, 1.8);
      // a palm tree and sun in the clip
      circle(g, 8, -18, 6);
      inkFill(g, C.butter, 1.2);
      ln(g, -6, 28, -6, -2, 2.4, C.umber);
      for (const s of [-1, 0.2, 1.4]) {
        ln(g, -6, -2, -6 + 14 * Math.sin(s), -2 - 8 + 6 * Math.cos(s), 2, C.greenInk);
      }
      ln(g, -23, 28, 23, 28, 1.4, C.faint);
      g.restore();
      // a curved arrow that shows the turn
      if (k.on && turn > 0.05 && turn < 0.98) {
        g.save();
        g.globalAlpha *= 0.9 * (1 - seg(turn, 0.85, 1));
        arcArrow(g, 112, -108, 50, -2.6, -1.0, { lw: 1.6, col: BLUE });
        g.restore();
      }
      tickBadge(g, 140, -146, k.on ? seg(k.T, 3.0, 3.5) * k.fade : 0, 8);
    },
  });

  // ---------------------------------------------------------------- crop-style scenes: a frame closes in on the part that is kept
  function cropScene(id, label, o) {
    const PX = 40, PY = -112, PW = 76, PH = 46;
    scene(id, {
      label,
      at: 6,
      walks: [[1.0, 1.9, 6, 20]],
      reach: [0.55, 2.55],
      cheer: 3.55,
      close(k) {
        return k.on ? ease(seg(k.T, 1.0, 1.9)) : 0;
      },
      keepW: o.ratio * PH,
      hand(k) {
        const d = ((PW - this.keepW) / 2) * this.close(k);
        return [PX + d, PY + PH / 2 + 6];
      },
      back(g, k) {
        const c = this.close(k);
        const d = ((PW - this.keepW) / 2) * c;
        // easel
        ln(g, PX + 12, PY + PH + 6, PX + 6, 0, 2);
        ln(g, PX + PW - 12, PY + PH + 6, PX + PW - 6, 0, 2);
        ln(g, PX - 4, PY + PH + 6, PX + PW + 4, PY + PH + 6, 2.2);
        // the picture
        rr(g, PX, PY, PW, PH, 3);
        inkFill(g, C.paper, 1.7);
        g.save();
        rr(g, PX, PY, PW, PH, 3);
        g.clip();
        o.subject(g, PX, PY, PW, PH);
        // dim what is cut away
        g.fillStyle = 'rgba(238,241,245,0.82)';
        g.fillRect(PX, PY, d, PH);
        g.fillRect(PX + PW - d, PY, d, PH);
        g.restore();
        // the crop frame
        if (c > 0 || k.on) {
          rr(g, PX + d, PY, PW - 2 * d, PH, 2);
          g.lineWidth = 2;
          g.strokeStyle = C.butterHi;
          g.stroke();
        }
        // the result card slides out to the right
        const out = k.on ? ease(seg(k.T, 2.2, 3.0)) * k.fade : 0;
        const rw = o.ratio * 40;
        g.save();
        g.globalAlpha *= out;
        const rx = PX + PW + 20 + 8 * (1 - out);
        rr(g, rx, PY + 3, rw, 40, 3);
        inkFill(g, C.paper, 1.7);
        g.save();
        rr(g, rx, PY + 3, rw, 40, 3);
        g.clip();
        g.translate(rx + rw / 2 - (PX + PW / 2), 3);
        o.subject(g, PX, PY, PW, PH);
        g.restore();
        g.restore();
        if (out > 0) {
          g.save();
          g.globalAlpha *= out;
          text(g, o.tag, PX + PW + 20 + rw / 2, PY + 62, 9, C.umber);
          g.restore();
        }
        tickBadge(g, PX + PW + 20 + rw + 1, PY + 1, k.on ? seg(k.T, 3.0, 3.5) * k.fade : 0, 8);
      },
    });
  }
  const rider = (g, x, y, w, h) => {
    // a wide scene: sky, mesa, road, a lone walker in the middle
    g.fillStyle = '#fde9d4';
    g.fillRect(x, y, w, h * 0.62);
    circle(g, x + w * 0.76, y + h * 0.26, h * 0.1);
    inkFill(g, C.butter, 1);
    poly(g, [[x, y + h * 0.62], [x + w * 0.2, y + h * 0.3], [x + w * 0.42, y + h * 0.62]], true);
    inkFill(g, '#e7a98a', 1.2);
    g.fillStyle = '#e8d3b8';
    g.fillRect(x, y + h * 0.62, w, h * 0.38);
    const cx = x + w / 2, by = y + h * 0.9;
    circle(g, cx, by - 15, 2.6);
    inkFill(g, C.ink, 1);
    ln(g, cx, by - 12, cx, by - 5, 1.8);
    ln(g, cx, by - 5, cx - 2.5, by, 1.6);
    ln(g, cx, by - 5, cx + 2.5, by, 1.6);
  };
  const lake = (g, x, y, w, h) => {
    g.fillStyle = '#dbe9fb';
    g.fillRect(x, y, w, h * 0.6);
    circle(g, x + w * 0.76, y + h * 0.26, h * 0.1);
    inkFill(g, C.butter, 1);
    poly(g, [[x, y + h * 0.6], [x + w * 0.24, y + h * 0.18], [x + w * 0.5, y + h * 0.6]], true);
    inkFill(g, '#c9b8f0', 1.2);
    poly(g, [[x + w * 0.34, y + h * 0.6], [x + w * 0.6, y + h * 0.3], [x + w * 0.9, y + h * 0.6]], true);
    inkFill(g, C.green, 1.2, C.greenInk);
    g.fillStyle = '#bcd6f3';
    g.fillRect(x, y + h * 0.6, w, h * 0.4);
  };
  const perfume = (g, x, y, w, h) => {
    g.fillStyle = '#e4efe8';
    g.fillRect(x, y, w, h);
    rr(g, x + w / 2 - 9, y + h * 0.36, 18, h * 0.5, 4);
    inkFill(g, '#f0a36b', 1.4);
    rr(g, x + w / 2 - 4, y + h * 0.18, 8, h * 0.2, 2);
    inkFill(g, C.ink, 1.2);
    rr(g, x + w / 2 - 6, y + h * 0.54, 12, 7, 1);
    inkFill(g, C.paper, 0.9);
  };
  cropScene('resize', 'A stick figure closes a frame in on a wide video until only a tall 9:16 slice is kept.', { ratio: 9 / 16, subject: rider, tag: '9:16' });
  cropScene('resize-image', 'A stick figure resizes a wide photo down to a square post.', { ratio: 1, subject: lake, tag: '1080 × 1080' });
  cropScene('crop-image', 'A stick figure crops a photo to a square around the bottle.', { ratio: 1, subject: perfume, tag: 'square' });

  // ---------------------------------------------------------------- blur-image: scrub the number plate into big pixels
  scene('blur-image', {
    label: 'A stick figure scrubs over a car number plate in a photo until it turns into blurry blocks.',
    at: 42,
    reach: [0.6, 3.15],
    cheer: 3.6,
    dur: 6.2,
    cover(k) {
      return k.on ? seg(k.T, 1.2, 2.9) : 0;
    },
    hand(k) {
      const c = this.cover(k);
      const sway = Math.sin(c * 22) * 9 * (c > 0 && c < 1 ? 1 : 0.2);
      return [80 + sway, -70];
    },
    tool(g, hand) {
      // a small mosaic stamp held in the hand
      rr(g, hand[0] - 5, hand[1] - 12, 10, 14, 2);
      inkFill(g, C.butter, 1.3);
      ln(g, hand[0], hand[1] - 12, hand[0], hand[1] - 20, 2.4);
    },
    back(g, k) {
      const cover = this.cover(k) * (k.on ? k.fade : 1);
      const PX = 52, PY = -122, PW = 86, PH = 62;
      ln(g, PX + 14, PY + PH + 6, PX + 8, 0, 2);
      ln(g, PX + PW - 14, PY + PH + 6, PX + PW - 8, 0, 2);
      ln(g, PX - 4, PY + PH + 6, PX + PW + 4, PY + PH + 6, 2.2);
      rr(g, PX, PY, PW, PH, 3);
      inkFill(g, '#e6edf6', 1.7);
      g.fillStyle = '#d3dce8';
      g.fillRect(PX + 1, PY + PH * 0.7, PW - 2, PH * 0.3 - 1);
      // a car, side-on
      rr(g, PX + 14, PY + 26, 58, 22, 7);
      inkFill(g, '#5da0d6', 1.5);
      rr(g, PX + 26, PY + 14, 32, 16, 6);
      inkFill(g, '#8cbfe6', 1.4);
      for (const wx of [PX + 28, PX + 58]) {
        circle(g, wx, PY + 49, 6);
        inkFill(g, C.ink, 1.2);
        circle(g, wx, PY + 49, 2);
        inkFill(g, C.paper, 1);
      }
      // the plate
      const px = PX + 17, py = PY + 36, pw = 22, ph = 9;
      rr(g, px, py, pw, ph, 1.5);
      inkFill(g, C.paper, 1.1);
      text(g, 'AB 12', px + pw / 2, py + 7, 7, C.ink);
      if (cover > 0) {
        const cols = 6, rows = 3, bw = pw / cols, bh = ph / rows;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const lit = (c + 1) / cols <= cover;
            if (!lit) {
              continue;
            }
            const tone = 150 + (((c * 7 + r * 13) % 5) * 18);
            g.fillStyle = `rgb(${tone},${tone},${tone + 6})`;
            g.fillRect(px + c * bw, py + r * bh, bw + 0.3, bh + 0.3);
          }
        }
      }
      tickBadge(g, PX + PW - 2, PY - 2, k.on ? seg(k.T, 3.0, 3.5) * k.fade : 0, 8);
    },
  });

  // ---------------------------------------------------------------- watermark-image: stamp a name into the corner
  scene('watermark-image', {
    label: 'A stick figure stamps a small name mark into the corner of a photo.',
    at: 44,
    reach: [0.55, 3.15],
    cheer: 3.6,
    dur: 6.2,
    dip(k) {
      if (!k.on) {
        return 0;
      }
      // down onto the photo, up, down again to press harder, up
      return Math.sin(Math.PI * seg(k.T, 1.4, 1.95)) * 0.9 + Math.sin(Math.PI * seg(k.T, 2.15, 2.6)) * 0.1;
    },
    hand(k) {
      const lift = 1 - this.dip(k);
      const reachX = lerp(54, 86, E.soft(seg(k.T, 0.7, 1.3)));
      return [reachX, -70 - 16 * lift];
    },
    tool(g, hand) {
      // a rubber stamp: handle, grip and a base plate
      ln(g, hand[0], hand[1] - 2, hand[0], hand[1] - 16, 3);
      rr(g, hand[0] - 9, hand[1] - 2, 18, 5, 1.5);
      inkFill(g, C.butter, 1.3);
    },
    back(g, k) {
      const mark = k.on ? ease(seg(k.T, 1.9, 2.1)) * k.fade : 0;
      const PX = 62, PY = -122, PW = 90, PH = 60;
      ln(g, PX + 14, PY + PH + 6, PX + 8, 0, 2);
      ln(g, PX + PW - 14, PY + PH + 6, PX + PW - 8, 0, 2);
      ln(g, PX - 4, PY + PH + 6, PX + PW + 4, PY + PH + 6, 2.2);
      rr(g, PX, PY, PW, PH, 3);
      inkFill(g, C.paper, 1.7);
      g.save();
      rr(g, PX, PY, PW, PH, 3);
      g.clip();
      // sunset hills
      g.fillStyle = '#fde0c8';
      g.fillRect(PX, PY, PW, PH);
      circle(g, PX + PW * 0.3, PY + PH * 0.52, 10);
      inkFill(g, C.butter, 1);
      poly(g, [[PX, PY + PH], [PX + PW * 0.3, PY + PH * 0.6], [PX + PW * 0.6, PY + PH]], true);
      inkFill(g, '#c78b8b', 1.2);
      poly(g, [[PX + PW * 0.4, PY + PH], [PX + PW * 0.7, PY + PH * 0.5], [PX + PW, PY + PH * 0.9], [PX + PW, PY + PH]], true);
      inkFill(g, '#9e6f9e', 1.2);
      g.restore();
      // the stamped mark, bottom-right
      if (mark > 0) {
        g.save();
        g.globalAlpha *= mark;
        text(g, '© you', PX + 9, PY + PH - 7, 9, '#ffffff', 'left');
        text(g, '© you', PX + 8.4, PY + PH - 7.6, 9, C.umber, 'left');
        g.restore();
      }
      tickBadge(g, PX + PW + 4, PY - 2, k.on ? seg(k.T, 2.9, 3.4) * k.fade : 0, 8);
    },
  });

  // ---------------------------------------------------------------- auto-captions: the figure talks, the words appear and light up one by one
  const WORDS = ['Hello', 'everyone,', 'we', 'add', 'captions.'];
  scene('auto-captions', {
    label: 'A stick figure talks and captions appear on a screen, lighting up word by word.',
    at: -96,
    walks: [],
    reach: [9, 9.1],
    cheer: 4.6,
    dur: 6.4,
    hand() {
      return null;
    },
    back(g, k) {
      const T = k.T;
      const sx = -30, sy = -150, sw = 168, sh = 92;
      // screen on a stand
      ln(g, sx + 30, sy + sh + 2, sx + 22, 0, 2);
      ln(g, sx + sw - 30, sy + sh + 2, sx + sw - 22, 0, 2);
      rr(g, sx, sy, sw, sh, 6);
      inkFill(g, C.paper, 1.8);
      // a little round "face" on the screen and a sound wave bar
      circle(g, sx + sw / 2, sy + 34, 14);
      inkFill(g, '#f7ddb6', 1.4);
      ln(g, sx + sw / 2 - 5, sy + 31, sx + sw / 2 - 5, sy + 33, 2);
      ln(g, sx + sw / 2 + 5, sy + 31, sx + sw / 2 + 5, sy + 33, 2);
      rr(g, sx + sw / 2 - 12, sy + 49, 24, 9, 4.5);
      inkFill(g, '#e8b36c', 1.3);
      // caption strip
      rr(g, sx + 10, sy + sh - 30, sw - 20, 22, 4);
      inkFill(g, C.ink, 1);
      // words
      const per = 0.42, start = 1.1;
      let cx = 0;
      const widths = WORDS.map((w) => w.length * 4.3 + 4);
      const total = widths.reduce((a, b) => a + b, 0);
      cx = sx + sw / 2 - total / 2;
      WORDS.forEach((w, i) => {
        const at = start + i * per;
        const shown = k.on ? seg(T, at, at + 0.14) * k.fade : i < 0 ? 1 : 0;
        const hot = k.on ? (T >= at && T < at + per ? 1 : 0) * k.fade : 0;
        g.save();
        g.globalAlpha *= shown;
        text(g, w, cx + widths[i] / 2, sy + sh - 14.5, 9, hot ? C.butterHi : '#ffffff');
        g.restore();
        cx += widths[i];
      });
      // sound waves leaving the mouth
      const talk = k.on ? seg(T, 0.8, 1.0) * (1 - seg(T, 4.0, 4.3)) : 0;
      for (let i = 0; i < 3; i++) {
        const ph = ((k.t * 1.6 + i / 3) % 1);
        g.save();
        g.globalAlpha *= talk * (1 - ph);
        g.beginPath();
        g.arc(-92 + 6, -98, 8 + ph * 26, -0.7, 0.7);
        g.lineWidth = 1.5;
        g.strokeStyle = C.far;
        g.stroke();
        g.restore();
      }
      tickBadge(g, sx + sw - 2, sy - 2, k.on ? seg(T, 3.6, 4.1) * k.fade : 0, 8);
    },
  });
})();
