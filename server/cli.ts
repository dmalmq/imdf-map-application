import type { Server } from "node:http";
import { createInterface } from "node:readline/promises";

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function argValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new CliUsageError(`${flag} requires a value.`);
  }
  return value;
}

export function assertOnlyOptions(
  args: string[],
  startIndex: number,
  allowedFlags: readonly string[],
): void {
  for (let index = startIndex; index < args.length; index += 2) {
    const flag = args[index];
    if (flag === undefined || !allowedFlags.includes(flag)) {
      throw new CliUsageError(`Unknown argument: ${flag ?? ""}`);
    }
    const value = args[index + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new CliUsageError(`${flag} requires a value.`);
    }
  }
}

export async function promptPassword(
  username: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<string> {
  const prompt = `Password for ${username}: `;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    const rl = createInterface({ input, output, terminal: false });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  output.write(prompt);
  const wasRaw = input.isRaw ?? false;
  input.setRawMode(true);
  input.setEncoding("utf8");
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    let settled = false;
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.setRawMode(wasRaw);
      input.pause();
      output.write("\n");
      if (error === undefined) resolve(value);
      else reject(error);
    }
    function onEnd() {
      finish(new Error("Password input ended."));
    }
    function onError(error: Error) {
      finish(error);
    }
    function onData(chunk: string | Buffer) {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u0003") {
          finish(new Error("Password prompt cancelled."));
          return;
        }
        if (character === "\u0004") {
          finish(new Error("Password input ended."));
          return;
        }
        if (character === "\b" || character === "\u007f") {
          value = Array.from(value).slice(0, -1).join("");
        } else if (character >= " ") {
          value += character;
        }
      }
    }
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("error", onError);
  });
}

export function boundPort(address: ReturnType<Server["address"]>): number {
  if (address === null || typeof address === "string") {
    throw new Error("Server has no TCP listening address.");
  }
  return address.port;
}
