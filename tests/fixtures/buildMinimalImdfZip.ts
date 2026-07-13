/**
 * Deterministic builder for the synthetic Apple-shaped minimal IMDF ZIP.
 *
 * Reads `tests/fixtures/minimal-imdf/` relative to this module (Node/vitest only —
 * never imported from browser code). Entries are written with a fixed
 * lastModDate and sorted name order so two builds produce identical bytes.
 *
 * Unsafe-path variants: zip.js rejects names containing `..` / absolute paths
 * on add. For those tests, pass `extraEntries` with a safe temporary name and
 * then call `patchZipEntryName(bytes, fromName, toName)` which rewrites the
 * local-file and central-directory headers in place (same-length rename only).
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BlobWriter,
  Uint8ArrayReader,
  ZipWriter,
  configure,
} from "@zip.js/zip.js";

configure({ useWebWorkers: false });

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "minimal-imdf",
);

/** Fixed last-mod so ZIP headers are byte-stable across machines/runs. */
const FIXED_LAST_MOD = new Date(Date.UTC(2026, 0, 1));

export interface BuildMinimalImdfZipOptions {
  /** Root entry names to skip (e.g. `["manifest.json"]`). */
  omitEntries?: string[];
  /** Additional root entries; values are UTF-8 text or raw bytes. */
  extraEntries?: Record<string, string | Uint8Array>;
  /** Replace content of existing entries (same name). */
  replaceEntries?: Record<string, string | Uint8Array>;
}

async function loadBaseEntries(): Promise<Map<string, Uint8Array>> {
  const names = await readdir(FIXTURE_DIR);
  const entries = new Map<string, Uint8Array>();
  for (const name of names) {
    // Only root files; ignore nested dirs if any appear later.
    if (name.includes("/") || name.includes("\\") || name.startsWith(".")) {
      continue;
    }
    const abs = path.join(FIXTURE_DIR, name);
    const buf = await readFile(abs);
    entries.set(name, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
  return entries;
}

/**
 * Build a deterministic minimal IMDF ZIP as raw bytes.
 * Entry order is sorted by name; lastModDate is always 2026-01-01T00:00:00Z.
 */
export async function buildMinimalImdfZip(
  overrides?: BuildMinimalImdfZipOptions,
): Promise<Uint8Array> {
  const omit = new Set(overrides?.omitEntries ?? []);
  const entries = await loadBaseEntries();

  for (const name of omit) {
    entries.delete(name);
  }

  if (overrides?.replaceEntries) {
    for (const [name, value] of Object.entries(overrides.replaceEntries)) {
      entries.set(
        name,
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      );
    }
  }

  if (overrides?.extraEntries) {
    for (const [name, value] of Object.entries(overrides.extraEntries)) {
      entries.set(
        name,
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      );
    }
  }

  const sortedNames = [...entries.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const writer = new ZipWriter(new BlobWriter("application/zip"), {
    // Keep compression deterministic and avoid level variance.
    level: 6,
    extendedTimestamp: false,
  });

  for (const name of sortedNames) {
    const data = entries.get(name);
    if (data === undefined) {
      continue;
    }
    await writer.add(name, new Uint8ArrayReader(data), {
      lastModDate: FIXED_LAST_MOD,
      extendedTimestamp: false,
      level: 6,
    });
  }

  const blob = await writer.close();
  const ab = await blob.arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Rewrite a ZIP entry name in local + central headers in place.
 * `fromName` and `toName` MUST be the same byte length (ASCII recommended).
 * Used for unsafe-path tests (`../evil.json`) that zip.js refuses to add.
 *
 * Example (equal-length names required):
 *   const safe = await buildMinimalImdfZip({
 *     extraEntries: { "evil_path.js": "{}" }, // 12 chars
 *   });
 *   const evil = patchZipEntryName(safe, "evil_path.js", "../evil.json");
 */
export function patchZipEntryName(
  zipBytes: Uint8Array,
  fromName: string,
  toName: string,
): Uint8Array {
  const from = new TextEncoder().encode(fromName);
  const to = new TextEncoder().encode(toName);
  if (from.length !== to.length) {
    throw new Error(
      `patchZipEntryName requires equal-length names (got ${from.length} vs ${to.length})`,
    );
  }

  const out = new Uint8Array(zipBytes);
  // Scan for filename bytes that sit after a local-file or central-dir header.
  // Local header: signature 0x04034b50, then name at offset +30.
  // Central header: signature 0x02014b50, then name at offset +46.
  let found = 0;
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig =
      out[i]! |
      (out[i + 1]! << 8) |
      (out[i + 2]! << 16) |
      (out[i + 3]! << 24);
    let nameOffset = -1;
    if (sig === 0x04034b50) {
      nameOffset = i + 30;
    } else if (sig === 0x02014b50) {
      nameOffset = i + 46;
    }
    if (nameOffset < 0 || nameOffset + from.length > out.length) {
      continue;
    }
    let match = true;
    for (let j = 0; j < from.length; j++) {
      if (out[nameOffset + j] !== from[j]) {
        match = false;
        break;
      }
    }
    if (!match) {
      continue;
    }
    out.set(to, nameOffset);
    found += 1;
  }
  if (found < 2) {
    // Expect at least local + central occurrences.
    throw new Error(
      `patchZipEntryName: expected ≥2 occurrences of "${fromName}", found ${found}`,
    );
  }
  return out;
}

export async function writeMinimalImdfZip(outPath: string): Promise<void> {
  const bytes = await buildMinimalImdfZip();
  await writeFile(outPath, bytes);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href;

if (isMain) {
  const out =
    process.argv[2] ??
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "minimal-imdf.zip",
    );
  await writeMinimalImdfZip(out);
  // eslint-disable-next-line no-console
  console.log(`wrote ${out}`);
}

