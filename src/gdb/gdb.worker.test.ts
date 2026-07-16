import { describe, expect, it } from "vitest";
import { hasGeometry } from "./gdb.worker";

function feature(geometry: unknown): { type: "Feature"; geometry: unknown; properties: null } {
  return { type: "Feature", geometry, properties: null };
}

describe("hasGeometry", () => {
  it("rejects a Point with empty coordinates", () => {
    expect(hasGeometry(feature({ type: "Point", coordinates: [] }))).toBe(false);
  });

  it("rejects a Point with non-finite coordinates", () => {
    expect(hasGeometry(feature({ type: "Point", coordinates: [Number.NaN, 1] }))).toBe(false);
    expect(hasGeometry(feature({ type: "Point", coordinates: [1, Number.POSITIVE_INFINITY] }))).toBe(
      false,
    );
  });

  it("accepts a Point with a finite coordinate pair", () => {
    expect(hasGeometry(feature({ type: "Point", coordinates: [139.7, 35.6] }))).toBe(true);
  });

  it("rejects empty Polygon / Multi* coordinate arrays", () => {
    expect(hasGeometry(feature({ type: "Polygon", coordinates: [] }))).toBe(false);
    expect(hasGeometry(feature({ type: "MultiPoint", coordinates: [] }))).toBe(false);
    expect(hasGeometry(feature({ type: "MultiLineString", coordinates: [] }))).toBe(false);
    expect(hasGeometry(feature({ type: "MultiPolygon", coordinates: [] }))).toBe(false);
  });

  it("rejects a GeometryCollection with no members or only empty members", () => {
    expect(hasGeometry(feature({ type: "GeometryCollection", geometries: [] }))).toBe(false);
    expect(
      hasGeometry(
        feature({
          type: "GeometryCollection",
          geometries: [{ type: "Point", coordinates: [] }],
        }),
      ),
    ).toBe(false);
  });

  it("accepts a nested GeometryCollection that holds a valid coordinate pair", () => {
    expect(
      hasGeometry(
        feature({
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [] },
            {
              type: "GeometryCollection",
              geometries: [
                { type: "LineString", coordinates: [[Number.NaN, Number.NaN]] },
                {
                  type: "Polygon",
                  coordinates: [
                    [
                      [139.7, 35.6],
                      [139.8, 35.6],
                      [139.8, 35.7],
                      [139.7, 35.6],
                    ],
                  ],
                },
              ],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("rejects a feature with no geometry or empty type", () => {
    expect(hasGeometry(feature(null))).toBe(false);
    expect(hasGeometry(feature({ type: "", coordinates: [1, 2] }))).toBe(false);
    expect(hasGeometry({})).toBe(false);
  });

  it("accepts MultiPoint when at least one position is finite", () => {
    expect(
      hasGeometry(
        feature({
          type: "MultiPoint",
          coordinates: [
            [Number.NaN, 1],
            [139.7, 35.6],
          ],
        }),
      ),
    ).toBe(true);
  });
});
