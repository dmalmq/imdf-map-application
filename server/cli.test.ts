// @vitest-environment node

import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliUsageError, argValue, assertOnlyOptions, boundPort, promptPassword } from "./cli";

afterEach(() => {
  vi.useRealTimers();
});

describe("platform CLI helpers", () => {
  it("rejects a missing option value instead of consuming the next flag", () => {
    expect(() => argValue(["--password", "--data", "./prod"], "--password")).toThrow(
      CliUsageError,
    );
    expect(() => argValue(["--data"], "--data")).toThrow(CliUsageError);
  });

  it("rejects unknown commands, options, and extra positional arguments", () => {
    expect(() => assertOnlyOptions(["--porrt", "8125"], 0, ["--port"])).toThrow(
      CliUsageError,
    );
    expect(() => assertOnlyOptions(["add-uesr", "admin"], 0, ["--port"])).toThrow(
      CliUsageError,
    );
    expect(() => assertOnlyOptions(["--port", "8125", "extra"], 0, ["--port"])).toThrow(
      CliUsageError,
    );
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


  it("rejects Ctrl-D and restores raw mode", async () => {
    vi.useFakeTimers();
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
    const password = promptPassword(
      "admin",
      input as unknown as NodeJS.ReadStream,
      new PassThrough(),
    );
    input.write("\u0004");
    const outcomePromise = Promise.race([
      password.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("pending"), 20);
      }),
    ]);
    await vi.advanceTimersByTimeAsync(20);
    expect(await outcomePromise).toBe("rejected");
    expect(rawModes).toEqual([true, false]);
  });
  it("reports the actual bound TCP port", () => {
    expect(boundPort({ address: "127.0.0.1", family: "IPv4", port: 43123 })).toBe(43123);
    expect(() => boundPort(null)).toThrow("listening address");
  });
});
