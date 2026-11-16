import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer";

const ramp = (from: number, count: number) => Float32Array.from({ length: count }, (_, i) => from + i);

describe("RingBuffer", () => {
  it("rounds the capacity up to a power of two", () => {
    expect(new RingBuffer(1).capacity).toBe(1);
    expect(new RingBuffer(5).capacity).toBe(8);
    expect(new RingBuffer(1024).capacity).toBe(1024);
    expect(new RingBuffer(1025).capacity).toBe(2048);
  });

  it("rejects impossible sizes", () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-4)).toThrow();
    expect(() => new RingBuffer(2.5)).toThrow();
    expect(() => new RingBuffer(2 ** 31)).toThrow();
    expect(() => new RingBuffer(2 ** 28 + 1)).toThrow(/1 GiB/); // 4 bytes a sample: 2 ** 30 samples would be 4 GiB
  });

  it("reads back what was written, in order", () => {
    const ring = new RingBuffer(8);
    expect(ring.write(ramp(1, 5))).toBe(5);
    const out = new Float32Array(5);
    expect(ring.read(out)).toBe(5);
    expect([...out]).toEqual([1, 2, 3, 4, 5]);
    expect(ring.available).toBe(0);
  });

  it("never overwrites unread samples: it stores what fits and says so", () => {
    const ring = new RingBuffer(4);
    expect(ring.write(ramp(1, 6))).toBe(4);
    expect(ring.free).toBe(0);
    expect(ring.write(ramp(9, 2))).toBe(0);
    const out = new Float32Array(4);
    ring.read(out);
    expect([...out]).toEqual([1, 2, 3, 4]);
  });

  it("wraps around the end of the storage", () => {
    const ring = new RingBuffer(8);
    ring.write(ramp(0, 6));
    ring.skip(6);
    ring.write(ramp(100, 6));
    const out = new Float32Array(6);
    expect(ring.read(out)).toBe(6);
    expect([...out]).toEqual([100, 101, 102, 103, 104, 105]);
  });

  it("peek leaves the samples in place", () => {
    const ring = new RingBuffer(8);
    ring.write(ramp(1, 4));
    const out = new Float32Array(2);
    expect(ring.peek(out)).toBe(2);
    expect(ring.available).toBe(4);
    ring.read(out);
    expect(ring.available).toBe(2);
  });

  it("returns only what is available when asked for more", () => {
    const ring = new RingBuffer(8);
    ring.write(ramp(1, 3));
    const out = new Float32Array(10);
    expect(ring.read(out)).toBe(3);
    expect(ring.read(out)).toBe(0);
  });

  it("skip and clear drop samples without copying", () => {
    const ring = new RingBuffer(8);
    ring.write(ramp(1, 6));
    expect(ring.skip(2)).toBe(2);
    expect(ring.skip(100)).toBe(4);
    expect(ring.skip(-3)).toBe(0);
    ring.write(ramp(1, 3));
    ring.clear();
    expect(ring.available).toBe(0);
    expect(ring.free).toBe(8);
  });

  it("stays correct over many interleaved writes and reads (seeded fuzz)", () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const ring = new RingBuffer(64);
    let writtenCounter = 0;
    let readCounter = 0;
    for (let step = 0; step < 5000; step += 1) {
      if (next() < 0.5) {
        const chunk = ramp(writtenCounter, Math.floor(next() * 40));
        writtenCounter += ring.write(chunk);
      } else {
        const out = new Float32Array(Math.floor(next() * 40));
        const got = ring.read(out);
        for (let i = 0; i < got; i += 1) expect(out[i]).toBe(readCounter + i);
        readCounter += got;
      }
      expect(ring.available).toBe(writtenCounter - readCounter);
      expect(ring.available + ring.free).toBe(64);
    }
  });
});
