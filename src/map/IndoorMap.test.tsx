import { describe, expect, it } from "vitest";
import { revealOffset, selectionRevealOffset } from "./IndoorMap";

const viewport = { width: 500, height: 400 };
const padding = { top: 10, right: 20, bottom: 30, left: 40 };

describe("selection camera reveal", () => {
  it("does not move an already-visible selected point", () => {
    expect(revealOffset({ x: 250, y: 200 }, viewport, padding, 16)).toBeNull();
  });

  it("returns only the signed overflow needed to reveal an off-screen point", () => {
    expect(revealOffset({ x: 20, y: 390 }, viewport, padding, 16)).toEqual([-36, 36]);
    expect(revealOffset({ x: 490, y: 5 }, viewport, padding, 16)).toEqual([26, -21]);
  });

  it("skips desktop selection adjustment in compact mode", () => {
    expect(selectionRevealOffset(true, { x: 20, y: 390 }, viewport, padding, 16)).toBeNull();
    expect(selectionRevealOffset(false, { x: 20, y: 390 }, viewport, padding, 16)).toEqual([
      -36,
      36,
    ]);
  });
});
