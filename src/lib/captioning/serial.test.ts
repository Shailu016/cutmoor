import { describe, expect, it } from "vitest";
import { serialQueue } from "./serial";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("serialQueue", () => {
  it("never runs two jobs at once and keeps the order", async () => {
    const run = serialQueue();
    let active = 0;
    let most = 0;
    const order: number[] = [];
    const job = (id: number, ms: number) => run(async () => {
      active += 1;
      most = Math.max(most, active);
      await sleep(ms);
      order.push(id);
      active -= 1;
      return id;
    });
    const results = await Promise.all([job(1, 15), job(2, 1), job(3, 5)]);
    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(most).toBe(1);
  });

  it("passes a failure to its own caller only, and the next job still runs", async () => {
    const run = serialQueue();
    const failing = run(async () => {
      throw new Error("boom");
    });
    const after = run(async () => "fine");
    await expect(failing).rejects.toThrow("boom");
    await expect(after).resolves.toBe("fine");
  });
});
