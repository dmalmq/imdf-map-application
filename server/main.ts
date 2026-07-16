import path from "node:path";
import { CliUsageError, argValue, boundPort, promptPassword } from "./cli.js";
import { createApp } from "./app.js";
import { hashPassword } from "./auth.js";
import { PlatformStore } from "./store.js";


async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dataDir = path.resolve(argValue(args, "--data") ?? "./platform-data");

  if (args[0] === "add-user") {
    const username = args[1];
    const role = argValue(args, "--role");
    if (username === undefined || username.startsWith("--") || (role !== "admin" && role !== "user")) {
      console.error(
        "Usage: node server/dist/main.js add-user <name> --role admin|user [--password <pw>] [--data <dir>]",
      );
      process.exitCode = 1;
      return;
    }
    let password = argValue(args, "--password");
    if (password === null) {
      password = await promptPassword(username);
    }
    if (password.length < 4) {
      console.error("Password must be at least 4 characters.");
      process.exitCode = 1;
      return;
    }
    const store = await PlatformStore.open(dataDir);
    await store.upsertUser({ username, role, ...hashPassword(password) });
    console.log(`Stored ${role} account "${username}" in ${dataDir}`);
    return;
  }

  const port = Number(argValue(args, "--port") ?? "8080");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("Invalid --port; expected an integer between 0 and 65535.");
    process.exitCode = 1;
    return;
  }
  const appArg = argValue(args, "--app");
  const store = await PlatformStore.open(dataDir);
  const server = createApp({ store, appDir: appArg === null ? null : path.resolve(appArg) });
  server.listen(port, () => {
    const actualPort = boundPort(server.address());
    console.log(
      `GIS dataset platform listening on http://127.0.0.1:${actualPort} (data: ${dataDir})`,
    );
  });
}

void main().catch((error: unknown) => {
  if (error instanceof CliUsageError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
