// Build @kiriko/wasm (wasm-pack). cc-rs compiles zstd-sys (C) for the
// wasm32-unknown-unknown target and needs clang — MSVC cannot target wasm. On
// Windows, if clang isn't already resolvable on PATH, locate an LLVM install
// and point cc-rs at it via CC_/AR_ for the target. No-op on Linux/macOS/CI,
// where clang is normally on PATH already.
//
// wasm-pack args mirror core/crates/kiriko-wasm/package.json ("build").
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.resolve(scriptDir, "../core/crates/kiriko-wasm");
const env = { ...process.env };

function onPath(tool) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [tool], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

if (
  process.platform === "win32" &&
  env.CC_wasm32_unknown_unknown === undefined &&
  !onPath("clang")
) {
  const binDir = [
    "C:\\Program Files\\LLVM\\bin",
    "C:\\Program Files (x86)\\LLVM\\bin",
  ].find((dir) => existsSync(path.join(dir, "clang.exe")));

  if (binDir === undefined) {
    console.error(
      "[build-wasm] clang not found. Install LLVM (`winget install LLVM.LLVM`) " +
        "or set CC_wasm32_unknown_unknown to a clang that can target wasm32.",
    );
    process.exit(1);
  }

  env.CC_wasm32_unknown_unknown = path.join(binDir, "clang.exe");
  env.AR_wasm32_unknown_unknown = path.join(binDir, "llvm-ar.exe");
  console.log(`[build-wasm] clang not on PATH; using LLVM at ${binDir}`);
}

const result = spawnSync(
  "wasm-pack",
  ["build", "--target", "web", "--release", "--out-dir", "pkg"],
  { cwd: wasmDir, env, stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
