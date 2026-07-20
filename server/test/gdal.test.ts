import { describe, expect, it } from "vitest";
import { serializeGdalOperation } from "../src/gdb/gdal";

describe("serializeGdalOperation", () => {
  it("runs GDAL operations one at a time", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = serializeGdalOperation(async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
      return 1;
    });
    const second = serializeGdalOperation(async () => {
      order.push("second:start");
      order.push("second:end");
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("continues after a failed operation", async () => {
    await expect(
      serializeGdalOperation(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");

    await expect(serializeGdalOperation(async () => "next")).resolves.toBe("next");
  });
});
