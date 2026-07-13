import { describe, expect, it } from "vitest";
import { geometryCenter } from "./geometryCenter";

describe("geometryCenter", () => {
  it("returns Point coordinates when finite", () => {
    expect(
      geometryCenter({ type: "Point", coordinates: [139.767, 35.681] }),
    ).toEqual([139.767, 35.681]);
  });

  it("returns null for a Point with non-finite coordinates", () => {
    expect(
      geometryCenter({ type: "Point", coordinates: [Number.NaN, 35.681] }),
    ).toBeNull();
    expect(
      geometryCenter({ type: "Point", coordinates: [139.767, Number.POSITIVE_INFINITY] }),
    ).toBeNull();
  });

  it("returns the LineString bbox center", () => {
    expect(
      geometryCenter({
        type: "LineString",
        coordinates: [
          [139.766, 35.68],
          [139.768, 35.682],
        ],
      }),
    ).toEqual([139.767, 35.681]);
  });

  it("returns the Polygon bbox center", () => {
    expect(
      geometryCenter({
        type: "Polygon",
        coordinates: [
          [
            [139.766, 35.68],
            [139.768, 35.68],
            [139.768, 35.682],
            [139.766, 35.682],
            [139.766, 35.68],
          ],
        ],
      }),
    ).toEqual([139.767, 35.681]);
  });

  it("returns the MultiPolygon bbox center across rings", () => {
    expect(
      geometryCenter({
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [2, 0],
              [2, 2],
              [0, 2],
              [0, 0],
            ],
          ],
          [
            [
              [10, 10],
              [12, 10],
              [12, 12],
              [10, 12],
              [10, 10],
            ],
          ],
        ],
      }),
    ).toEqual([6, 6]);
  });

  it("recurses into GeometryCollection members", () => {
    expect(
      geometryCenter({
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [0, 0] },
          {
            type: "LineString",
            coordinates: [
              [4, 0],
              [4, 4],
            ],
          },
        ],
      }),
    ).toEqual([2, 2]);
  });

  it("returns null for nested empty coordinate arrays", () => {
    expect(
      geometryCenter({
        type: "Polygon",
        coordinates: [[]],
      }),
    ).toBeNull();
    expect(
      geometryCenter({
        type: "GeometryCollection",
        geometries: [{ type: "LineString", coordinates: [] }],
      }),
    ).toBeNull();
  });

  it("returns null when every coordinate pair is non-finite", () => {
    expect(
      geometryCenter({
        type: "LineString",
        coordinates: [
          [Number.NaN, Number.NaN],
          [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        ],
      }),
    ).toBeNull();
  });

  it("skips non-finite pairs and uses the remaining finite ones", () => {
    expect(
      geometryCenter({
        type: "LineString",
        coordinates: [
          [Number.NaN, 1],
          [0, 0],
          [2, 4],
          [Number.POSITIVE_INFINITY, 9],
        ],
      }),
    ).toEqual([1, 2]);
  });
});
