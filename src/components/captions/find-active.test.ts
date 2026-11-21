import { describe, expect, it } from "vitest";
import type { CaptionEvent, Word } from "../../lib/captioning/types";
import { captionSafeArea, placeBlock } from "../../lib/captioning/burn-in/position";
import { anchorForDrag, CONTROLS_CLEARANCE_PX, draggableHeight, findActive, findWordAtTime, fitRect, grabOffsetFromRect, pointerInPicture } from "./find-active";

function w(index: number, text: string, startMs: number, endMs: number): Word {
  return { text, startMs, endMs, confidence: 1, index, windowIndex: 0 };
}

const EVENTS: CaptionEvent[] = [
  { index: 0, startMs: 1000, endMs: 3000, lines: [[w(0, "a", 1000, 1400), w(1, "b", 1500, 1900)], [w(2, "c", 2000, 2800)]] },
  { index: 1, startMs: 5000, endMs: 6000, lines: [[w(3, "d", 5000, 5500)]] },
];

describe("findActive", () => {
  it("is null before the first caption, between captions and after the last", () => {
    expect(findActive(EVENTS, 0)).toBeNull();
    expect(findActive(EVENTS, 999)).toBeNull();
    expect(findActive(EVENTS, 3000)).toBeNull(); // end is exclusive
    expect(findActive(EVENTS, 4999)).toBeNull();
    expect(findActive(EVENTS, 6000)).toBeNull();
    expect(findActive([], 100)).toBeNull();
  });

  it("highlights the word that has started, and keeps it through a pause", () => {
    expect(findActive(EVENTS, 1000)).toEqual({ event: 0, line: 0, word: 0 });
    expect(findActive(EVENTS, 1450)).toEqual({ event: 0, line: 0, word: 0 }); // pause between a and b
    expect(findActive(EVENTS, 1500)).toEqual({ event: 0, line: 0, word: 1 });
    expect(findActive(EVENTS, 1950)).toEqual({ event: 0, line: 0, word: 1 }); // pause before line 2
    expect(findActive(EVENTS, 2000)).toEqual({ event: 0, line: 1, word: 0 });
    expect(findActive(EVENTS, 2999)).toEqual({ event: 0, line: 1, word: 0 });
    expect(findActive(EVENTS, 5200)).toEqual({ event: 1, line: 0, word: 0 });
  });

  it("shows a caption whose first word has not started yet with no word lit", () => {
    const early: CaptionEvent[] = [{ index: 0, startMs: 1000, endMs: 2000, lines: [[w(0, "a", 1200, 1500)]] }];
    expect(findActive(early, 1100)).toEqual({ event: 0, line: 0, word: -1 });
  });

  it("agrees with a plain scan on many random times (oracle)", () => {
    const events: CaptionEvent[] = [];
    let t = 500;
    for (let e = 0; e < 200; e += 1) {
      const words: Word[] = [];
      const start = t;
      for (let k = 0; k < 4; k += 1) {
        words.push(w(e * 4 + k, `w${k}`, t, t + 300));
        t += 350;
      }
      events.push({ index: e, startMs: start, endMs: t, lines: [words.slice(0, 2), words.slice(2)] });
      t += 400;
    }
    const scan = (time: number) => {
      const ev = events.findIndex((event) => time >= event.startMs && time < event.endMs);
      if (ev < 0) return null;
      let best = { event: ev, line: 0, word: -1 };
      events[ev].lines.forEach((line, l) =>
        line.forEach((word, k) => {
          if (word.startMs <= time) best = { event: ev, line: l, word: k };
        }),
      );
      return best;
    };
    for (let time = 0; time < t + 1000; time += 37) expect(findActive(events, time)).toEqual(scan(time));
  });
});

describe("findWordAtTime", () => {
  const words = [w(0, "a", 100, 300), w(1, "b", 300, 500), w(2, "c", 900, 1200)];

  it("finds the word that contains the time", () => {
    expect(findWordAtTime(words, 100)).toEqual({ index: 0, distanceMs: 0 });
    expect(findWordAtTime(words, 299)).toEqual({ index: 0, distanceMs: 0 });
    expect(findWordAtTime(words, 300)).toEqual({ index: 1, distanceMs: 0 });
    expect(findWordAtTime(words, 1199)).toEqual({ index: 2, distanceMs: 0 });
  });

  it("falls back to the nearest word inside a silence, before and after", () => {
    expect(findWordAtTime(words, 0)).toEqual({ index: 0, distanceMs: 100 });
    expect(findWordAtTime(words, 540)).toMatchObject({ index: 1 }); // closer to b's end than c's start
    expect(findWordAtTime(words, 800)).toMatchObject({ index: 2 }); // closer to c's start
    expect(findWordAtTime(words, 5000)).toMatchObject({ index: 2 });
  });

  it("handles an empty list", () => {
    expect(findWordAtTime([], 10)).toEqual({ index: -1, distanceMs: 0 });
  });

  it("matches a brute-force nearest search on random transcripts (oracle)", () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let round = 0; round < 40; round += 1) {
      const list: Word[] = [];
      let t = Math.floor(next() * 500);
      for (let k = 0; k < 30; k += 1) {
        const dur = 50 + Math.floor(next() * 400);
        list.push(w(k, "x", t, t + dur));
        t += dur + Math.floor(next() * 600);
      }
      for (let time = 0; time < t + 300; time += 53) {
        const dist = (word: Word) => (time < word.startMs ? word.startMs - time : time >= word.endMs ? time - word.endMs + 1 : 0);
        const best = Math.min(...list.map(dist));
        const got = findWordAtTime(list, time);
        expect(got.distanceMs).toBe(best);
        expect(dist(list[got.index])).toBe(best);
      }
    }
  });
});

describe("fitRect", () => {
  it("letterboxes a wide video in a square box", () => {
    expect(fitRect(100, 100, 200, 100)).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });
  it("pillarboxes a vertical video in a wide box", () => {
    const r = fitRect(160, 90, 9, 16);
    expect(r.height).toBeCloseTo(90);
    expect(r.width).toBeCloseTo(50.625);
    expect(r.x).toBeCloseTo((160 - 50.625) / 2);
    expect(r.y).toBe(0);
  });
  it("uses the whole box when the video size is unknown (audio), and nothing for an empty box", () => {
    expect(fitRect(160, 90, 0, 0)).toEqual({ x: 0, y: 0, width: 160, height: 90 });
    expect(fitRect(0, 90, 10, 10)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("preview pointer maths", () => {
  const picture = { left: 100, top: 50, width: 800, height: 450 };
  const block = { left: 400, top: 300, width: 200, height: 100 };

  it("converts client coordinates into picture coordinates", () => {
    expect(pointerInPicture(picture, 250, 150)).toEqual({ x: 150, y: 100 });
  });

  it("keeps the grabbed point inside the block, even at its edges", () => {
    expect(grabOffsetFromRect(block, 500, 350)).toEqual({ x: 100, y: 50 });
    expect(grabOffsetFromRect(block, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(grabOffsetFromRect(block, 9999, 9999)).toEqual({ x: 200, y: 100 });
  });

  it("turns a drag into the anchors that keep the grabbed point under the pointer", () => {
    const safe = captionSafeArea(picture.width, picture.height);
    const grab = grabOffsetFromRect(block, 500, 350);
    const next = anchorForDrag({ picture, grab, clientX: 500, clientY: 350, blockSize: { width: block.width, height: block.height }, safe });
    // The block is already where those anchors put it, so a zero movement returns the same place.
    const expected = placeBlock({ position: "bottom", anchorX: next.x, anchorY: next.y }, { width: block.width, height: block.height }, picture.width, picture.height);
    expect(expected.left).toBeCloseTo(block.left - picture.left, 6);
    expect(expected.top).toBeCloseTo(block.top - picture.top, 6);
  });

  it("increases the anchors as the pointer moves right and down, and clamps at the edges", () => {
    const safe = captionSafeArea(picture.width, picture.height);
    const size = { width: block.width, height: block.height };
    const grab = { x: 100, y: 50 };
    const at = (x: number, y: number) => anchorForDrag({ picture, grab, clientX: x, clientY: y, blockSize: size, safe });
    const start = at(500, 350);
    const moved = at(700, 400);
    expect(moved.x).toBeGreaterThan(start.x);
    expect(moved.y).toBeGreaterThan(start.y);
    expect(at(-9999, -9999)).toEqual({ x: 0, y: 0 });
    expect(at(9999, 9999)).toEqual({ x: 1, y: 1 });
  });
});

describe("draggableHeight keeps the player's control bar usable", () => {
  const STAGE = 360;

  it("lets the whole caption be dragged when it sits well above the controls", () => {
    expect(draggableHeight({ top: 100, height: 40 }, 0, STAGE)).toBe(40);
  });

  it("offers nothing when the caption rests entirely on the control bar (the default landscape position)", () => {
    // 7% from the bottom of a 360 px picture: the block's top is at 360 - 25 - 40 = 295, below the bar's top at 304.
    expect(draggableHeight({ top: 305, height: 40 }, 0, STAGE)).toBe(0);
  });

  it("offers only the part above the bar when the caption overlaps it", () => {
    const top = STAGE - CONTROLS_CLEARANCE_PX - 10; // 10 px of the block clears the bar
    expect(draggableHeight({ top, height: 40 }, 0, STAGE)).toBe(10);
  });

  it("counts the picture's offset inside the stage (a letterboxed video)", () => {
    // Without the offset this block would clear the bar completely; 150 px lower in the stage only 14 px of it does.
    expect(draggableHeight({ top: 140, height: 40 }, 0, STAGE)).toBe(40);
    expect(draggableHeight({ top: 140, height: 40 }, 150, STAGE)).toBe(14);
  });

  it("never goes negative, and leaves the block alone when the stage has no size yet", () => {
    expect(draggableHeight({ top: 900, height: 40 }, 0, STAGE)).toBe(0);
    expect(draggableHeight({ top: 100, height: 40 }, 0, 0)).toBe(40);
    expect(draggableHeight({ top: 100, height: 40 }, 0, Number.NaN)).toBe(40);
  });
});
