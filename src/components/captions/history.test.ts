import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, createHistory, HISTORY_LIMIT, redo, undo } from "./history";

describe("history", () => {
  it("undoes and redoes in order", () => {
    let h = createHistory("a");
    h = commit(h, "b");
    h = commit(h, "c");
    expect(h.present).toBe("c");
    h = undo(h);
    expect(h.present).toBe("b");
    h = undo(h);
    expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(h.present).toBe("c");
    expect(canRedo(h)).toBe(false);
  });

  it("a new edit after undo throws the redo branch away", () => {
    let h = commit(commit(createHistory("a"), "b"), "c");
    h = undo(h);
    h = commit(h, "x");
    expect(h.present).toBe("x");
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe("b");
  });

  it("committing the same object again is not a step", () => {
    const value = { n: 1 };
    const h = createHistory(value);
    expect(commit(h, value)).toBe(h);
  });

  it("undo and redo at the ends do nothing", () => {
    const h = createHistory(1);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("forgets the oldest steps past the limit but keeps the newest", () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 50; i += 1) h = commit(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    let back = h;
    while (canUndo(back)) back = undo(back);
    expect(back.present).toBe(50); // the first 50 steps were forgotten
    expect(h.present).toBe(HISTORY_LIMIT + 50);
  });
});
