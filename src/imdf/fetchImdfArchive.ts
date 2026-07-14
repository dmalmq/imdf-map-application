import { ArchiveError } from "../errors/ArchiveError";

/**
 * Display/File name derived from the src URL's last path segment; ".zip" is
 * enforced because the archive worker rejects other file names.
 */
export function fileNameFromSrc(src: string, base?: string): string {
  let name = "";
  try {
    const pathname = new URL(src, base ?? window.location.href).pathname;
    const segments = pathname.split("/").filter((segment) => segment !== "");
    name = decodeURIComponent(segments[segments.length - 1] ?? "");
  } catch {
    name = "";
  }
  if (name === "") {
    name = "venue";
  }
  if (!name.toLowerCase().endsWith(".zip")) {
    name = `${name}.zip`;
  }
  return name;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Downloads an IMDF ZIP; failures surface as ArchiveError "fetch_failed" except aborts, which rethrow as-is. */
export async function fetchImdfFile(src: string, signal?: AbortSignal): Promise<File> {
  let response: Response;
  try {
    response = await fetch(src, { signal: signal ?? null });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ArchiveError("fetch_failed", "Could not download IMDF archive.", { src });
  }
  if (!response.ok) {
    throw new ArchiveError("fetch_failed", "Could not download IMDF archive.", {
      src,
      status: response.status,
    });
  }
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ArchiveError("fetch_failed", "Could not download IMDF archive.", { src });
  }
  return new File([blob], fileNameFromSrc(src), { type: "application/zip" });
}
