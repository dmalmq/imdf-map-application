import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CliUsageError, argValue, boundPort, promptPassword } from "./cli";

describe("platform CLI helpers", () => {
  it("rejects a missing option value instead of consuming the next flag", () => {
    expect(() => argValue(["--password", "--data", "./prod"], "--password")).toThrow(
      CliUsageError,
    );
    expect(() => argValue(["--data"], "--data")).toThrow(CliUsageError);
  });

  it("reads a TTY password without echo and restores raw mode", async () => {
    const input = new PassThrough() as PassThrough & {
      isTTY: boolean;
      isRaw: boolean;
      setRawMode(enabled: boolean): void;
    };
    input.isTTY = true;
    input.isRaw = false;
    const rawModes: boolean[] = [];
    input.setRawMode = (enabled) => {
      input.isRaw = enabled;
      rawModes.push(enabled);
    };
    const output = new PassThrough();
    let displayed = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      displayed += chunk;
    });

    const password = promptPassword("admin", input as unknown as NodeJS.ReadStream, output);
    input.write("secret\n");

    await expect(password).resolves.toBe("secret");
    expect(displayed).toContain("Password for admin:");
    expect(displayed).not.toContain("secret");
    expect(rawModes).toEqual([true, false]);
  });

  it("reports the actual bound TCP port", () => {
    expect(boundPort({ address: "127.0.0.1", family: "IPv4", port: 43123 })).toBe(43123);
    expect(() => boundPort(null)).toThrow("listening address");
  });
});
