import { describe, expect, it } from "vitest";
import { color2Fill, COLOR2_DEFAULT } from "./color2";

describe("color2Fill", () => {
  it("maps known values to their exact hex", () => {
    expect(color2Fill("橙")).toBe("#FFC090");
    expect(color2Fill("濃鼠")).toBe("#C8C9CA");
    expect(color2Fill("ラチ外白")).toBe("#FFFFFF");
  });
  it("maps 道白 to white", () => {
    expect(color2Fill("道白")).toBe("#FFFFFF");
  });
  it("returns the default gray for a present-but-unmapped value", () => {
    expect(color2Fill("未知の色")).toBe(COLOR2_DEFAULT);
    expect(COLOR2_DEFAULT).toBe("#808080");
  });
  it("returns null when the value is absent or blank", () => {
    expect(color2Fill(undefined)).toBeNull();
    expect(color2Fill(null)).toBeNull();
    expect(color2Fill("")).toBeNull();
    expect(color2Fill(42)).toBeNull();
  });
});
