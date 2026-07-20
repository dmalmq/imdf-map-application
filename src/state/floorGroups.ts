import type { ViewerLevel } from "../imdf/types";

/**
 * One displayed floor: every venue level sharing an ordinal collapsed into a
 * single entry. Multi-building GDB venues produce many levels per ordinal
 * (one per building); the viewer groups them so the floor selector shows one
 * button per ordinal and the map renders every same-ordinal level together.
 */
export interface FloorGroup {
  ordinal: number;
  /** First level at this ordinal (levels arrive descending-sorted). */
  representativeLevelId: string;
  /** Every level id sharing this ordinal. */
  levelIds: string[];
  label: Record<string, string>;
  shortName: Record<string, string>;
}

/** Most frequent record among `records` by JSON value; ties resolve to the first seen. */
function mostCommon(records: Record<string, string>[]): Record<string, string> {
  const counts = new Map<string, number>();
  const first = new Map<string, Record<string, string>>();
  let bestKey: string | null = null;
  let bestCount = 0;
  for (const rec of records) {
    const key = JSON.stringify(rec);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    if (!first.has(key)) {
      first.set(key, rec);
    }
    if (next > bestCount) {
      bestCount = next;
      bestKey = key;
    }
  }
  return bestKey === null ? {} : first.get(bestKey)!;
}

/**
 * Collapse `levels` into one [`FloorGroup`] per distinct ordinal, preserving the
 * input (descending-ordinal) order. The group label/short-name is the most
 * common source value among its members (ties → the representative). A venue
 * with one level per ordinal (typical IMDF) yields a 1:1 grouping.
 */
export function groupLevelsByOrdinal(levels: ViewerLevel[]): FloorGroup[] {
  const order: number[] = [];
  const byOrdinal = new Map<number, ViewerLevel[]>();
  for (const level of levels) {
    const bucket = byOrdinal.get(level.ordinal);
    if (bucket === undefined) {
      byOrdinal.set(level.ordinal, [level]);
      order.push(level.ordinal);
    } else {
      bucket.push(level);
    }
  }
  return order.map((ordinal) => {
    const members = byOrdinal.get(ordinal)!;
    return {
      ordinal,
      representativeLevelId: members[0]!.id,
      levelIds: members.map((m) => m.id),
      label: mostCommon(members.map((m) => m.label)),
      shortName: mostCommon(members.map((m) => m.shortName)),
    };
  });
}

/** Ordinal of the level with `levelId`, or `null` when unknown. */
export function ordinalOfLevel(levels: ViewerLevel[], levelId: string): number | null {
  return levels.find((level) => level.id === levelId)?.ordinal ?? null;
}

/** Every level id sharing `ordinal`, in input order. */
export function levelIdsForOrdinal(levels: ViewerLevel[], ordinal: number): string[] {
  return levels.filter((level) => level.ordinal === ordinal).map((level) => level.id);
}
