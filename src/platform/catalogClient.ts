import type {
  AccountInfo,
  CatalogEntry,
  CommentInput,
  CommentRecord,
  DatasetKind,
} from "./types";

export class PlatformError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }
}

async function toPlatformError(response: Response): Promise<PlatformError> {
  let code = "http_error";
  let message = `Request failed (${response.status}).`;
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === "string") {
      code = body.code;
    }
    if (typeof body.message === "string") {
      message = body.message;
    }
  } catch {
    // keep defaults
  }
  return new PlatformError(response.status, code, message);
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw await toPlatformError(response);
  }
  return (await response.json()) as T;
}

export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogEntry[]> {
  const body = await requestJson<{ datasets: CatalogEntry[] }>("/api/catalog", {
    signal: signal ?? null,
  });
  return body.datasets;
}

/** Availability probe: any failure (network, non-2xx, timeout) is null, never a throw. */
export async function probeCatalog(timeoutMs = 3000): Promise<CatalogEntry[] | null> {
  try {
    return await fetchCatalog(AbortSignal.timeout(timeoutMs));
  } catch {
    return null;
  }
}

export function datasetBlobUrl(id: string): string {
  return `/datasets/${encodeURIComponent(id)}.zip`;
}

export function datasetViewUrl(id: string, embed = false): string {
  const query = new URLSearchParams({ dataset: id });
  if (embed) {
    query.set("embed", "1");
  }
  return `${window.location.origin}/?${query.toString()}`;
}

/** Dataset id suggestion from a display name; non-ASCII names fall back to "dataset". */
export function slugifyDatasetId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return /^[a-z0-9]/.test(slug) ? slug : "dataset";
}

export interface PublishMeta {
  id: string;
  name: string;
  kind: DatasetKind;
  levelCount: number;
  featureCount: number;
  sourceName: string;
}

export async function publishDataset(meta: PublishMeta, data: Blob): Promise<CatalogEntry> {
  const query = new URLSearchParams({
    name: meta.name,
    kind: meta.kind,
    levelCount: String(meta.levelCount),
    featureCount: String(meta.featureCount),
    sourceName: meta.sourceName,
  });
  const body = await requestJson<{ dataset: CatalogEntry }>(
    `/api/datasets/${encodeURIComponent(meta.id)}?${query.toString()}`,
    { method: "PUT", body: data, headers: { "content-type": "application/zip" } },
  );
  return body.dataset;
}

export async function fetchComments(
  datasetId: string,
  signal?: AbortSignal,
): Promise<CommentRecord[]> {
  const body = await requestJson<{ comments: CommentRecord[] }>(
    `/api/datasets/${encodeURIComponent(datasetId)}/comments`,
    { signal: signal ?? null },
  );
  return body.comments;
}

export async function postComment(
  datasetId: string,
  input: CommentInput,
): Promise<CommentRecord> {
  const body = await requestJson<{ comment: CommentRecord }>(
    `/api/datasets/${encodeURIComponent(datasetId)}/comments`,
    {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
    },
  );
  return body.comment;
}

export async function deleteComment(datasetId: string, commentId: string): Promise<void> {
  const response = await fetch(
    `/api/datasets/${encodeURIComponent(datasetId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw await toPlatformError(response);
  }
}

export async function login(username: string, password: string): Promise<AccountInfo> {
  const body = await requestJson<{ account: AccountInfo }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    headers: { "content-type": "application/json" },
  });
  return body.account;
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/logout", { method: "POST" });
  if (!response.ok) {
    throw await toPlatformError(response);
  }
}

export async function fetchMe(): Promise<AccountInfo | null> {
  const response = await fetch("/api/me");
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw await toPlatformError(response);
  }
  const body = (await response.json()) as { account: AccountInfo };
  return body.account;
}
