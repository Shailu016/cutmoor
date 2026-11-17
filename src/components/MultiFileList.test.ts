import { describe, expect, it } from "vitest";
import { moveItem } from "./MultiFileList";

describe("moveItem", () => {
  it("moves an item up or down by one place", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });
  it("leaves the order alone at the ends and for a bad index", () => {
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 5, 1)).toEqual(["a", "b"]);
  });
  it("does not change the list it was given", () => {
    const list = ["a", "b"];
    moveItem(list, 0, 1);
    expect(list).toEqual(["a", "b"]);
  });
});
