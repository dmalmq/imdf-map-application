import { BlobReader, TextWriter, ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";

export interface ImdfStats {
  levels: number;
  features: number;
  language: string | null;
  venueName: string | null;
}

export type ImdfValidationCode = "not_zip" | "too_large" | "missing_file" | "bad_json" | "bad_manifest";

export class ImdfValidationError extends Error {
  constructor(
    public readonly code: ImdfValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "ImdfValidationError";
  }
}

export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const REQUIRED = ["manifest.json", "venue.geojson", "level.geojson", "unit.geojson"];

/** Matches `name` at the archive root or nested exactly one folder deep. */
function findEntry(entries: Entry[], name: string): FileEntry | undefined {
  return entries.find((e) => {
    if (e.directory) {
      return false;
    }
    const parts = e.filename.split("/");
    return parts[parts.length - 1] === name && parts.length <= 2;
  }) as FileEntry | undefined;
}

async function readJson(entry: FileEntry): Promise<unknown> {
  const text = await entry.getData(new TextWriter());
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ImdfValidationError("bad_json", `${entry.filename} is not valid JSON`);
  }
}

function featureCount(parsed: unknown, filename: string): number {
  const fc = parsed as { type?: string; features?: unknown[] };
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new ImdfValidationError("bad_json", `${filename} is not a FeatureCollection`);
  }
  return fc.features.length;
}

export async function validateImdfArchive(bytes: Uint8Array): Promise<ImdfStats> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ImdfValidationError("too_large", "archive exceeds 200 MB");
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new ImdfValidationError("not_zip", "not a ZIP archive");
  }

  const reader = new ZipReader(new BlobReader(new Blob([bytes])));
  try {
    const entries = await reader.getEntries();

    for (const name of REQUIRED) {
      if (!findEntry(entries, name)) {
        throw new ImdfValidationError("missing_file", `archive is missing ${name}`);
      }
    }

    const manifest = (await readJson(findEntry(entries, "manifest.json")!)) as {
      version?: unknown;
      language?: unknown;
    };
    if (typeof manifest.version !== "string") {
      throw new ImdfValidationError("bad_manifest", "manifest.json has no version");
    }
    const language = typeof manifest.language === "string" ? manifest.language : null;

    let features = 0;
    let levels = 0;
    let venueName: string | null = null;
    for (const entry of entries) {
      if (entry.directory || !entry.filename.endsWith(".geojson")) {
        continue;
      }
      const parsed = await readJson(entry);
      const count = featureCount(parsed, entry.filename);
      features += count;
      const base = entry.filename.split("/").pop()!;
      if (base === "level.geojson") {
        levels = count;
      }
      if (base === "venue.geojson") {
        const first = (parsed as { features: Array<{ properties?: { name?: Record<string, string> } }> })
          .features[0];
        const names = first?.properties?.name;
        if (names) {
          venueName = names[language ?? ""] ?? Object.values(names)[0] ?? null;
        }
      }
    }

    return { levels, features, language, venueName };
  } finally {
    await reader.close();
  }
}
