import { describe, expect, it } from "vitest";
import type { ViewerLevel } from "../imdf/types";
import { groupLevelsByOrdinal, levelIdsForOrdinal, ordinalOfLevel } from "./floorGroups";

function lvl(id: string, ordinal: number, short: string): ViewerLevel {
  return { id, ordinal, label: { en: short }, shortName: { en: short } };
}

// Descending-ordinal order, as normalizeVenue produces.
const TOKYO: ViewerLevel[] = [
  lvl("a2", 1, "2F"),
  lvl("b2", 1, "F2"),
  lvl("a1", 0, "1F"),
  lvl("b1", 0, "1F"),
  lvl("c1", 0, "地上1階"),
  lvl("aB1", -1, "B1"),
];

describe("groupLevelsByOrdinal", () => {
  it("collapses same-ordinal levels into one descending group each", () => {
    const groups = groupLevelsByOrdinal(TOKYO);
    expect(groups.map((g) => g.ordinal)).toEqual([1, 0, -1]);
    expect(groups[1]!.levelIds).toEqual(["a1", "b1", "c1"]);
    expect(groups[1]!.representativeLevelId).toBe("a1");
  });

  it("labels the group with the most common short_name (tie -> representative)", () => {
    const groups = groupLevelsByOrdinal(TOKYO);
    expect(groups[1]!.shortName["en"]).toBe("1F"); // 2x "1F" beats 1x "地上1階"
  });

  it("is a 1:1 no-op for single-level-per-ordinal venues", () => {
    const imdf = [lvl("x", 1, "2F"), lvl("y", 0, "1F")];
    const groups = groupLevelsByOrdinal(imdf);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.representativeLevelId)).toEqual(["x", "y"]);
    expect(groups.map((g) => g.levelIds)).toEqual([["x"], ["y"]]);
  });

  it("resolves ordinal of a level and level ids for an ordinal", () => {
    expect(ordinalOfLevel(TOKYO, "b1")).toBe(0);
    expect(ordinalOfLevel(TOKYO, "missing")).toBeNull();
    expect(levelIdsForOrdinal(TOKYO, 0)).toEqual(["a1", "b1", "c1"]);
    expect(levelIdsForOrdinal(TOKYO, 5)).toEqual([]);
  });
});
