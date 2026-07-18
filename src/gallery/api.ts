export interface ApiUser {
  id: number;
  username: string;
  role: string;
}

export interface VenueRow {
  id: number;
  slug: string;
  name: string;
  createdAt: string;
}

export interface VenueSummary extends VenueRow {
  latest: {
    seq: number;
    status: string;
    stats: { levels: number; features: number } | null;
    createdAt: string;
  } | null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function datasetBundleUrl(slug: string): string {
  return `/v/default/${slug}/bundle`;
}
/**
 * Corrective copy for the stable structured error codes a failed publish job
 * persists as `{"code","message","details"?}` JSON (kiriko-model importer
 * codes plus publish-runner codes). Server messages and details are internal
 * and never shown to the user.
 */
const publishErrorCopy: Record<string, string | undefined> = {
  unsupported_file: "This file is not a valid IMDF ZIP archive.",
  archive_too_large:
    "This archive exceeds the 100 MiB compressed or 300 MiB uncompressed limit.",
  unsafe_archive_path: "This archive contains an unsafe file path and was rejected.",
  invalid_archive: "This ZIP is encrypted, damaged, or has conflicting archive records.",
  missing_required_file: "This archive is missing a required IMDF file.",
  invalid_json: "One of the IMDF files is not valid JSON.",
  invalid_manifest_version: "This archive must use IMDF manifest version 1.0.0.",
  invalid_feature_collection: "One of the IMDF GeoJSON files has an invalid feature collection.",
  duplicate_feature_id: "The archive contains the same IMDF feature ID more than once.",
  stale_version: "This upload was replaced before publishing finished. Upload the archive again.",
};

const publishFailedFallback = "Publishing failed on the server. Try uploading the archive again.";

/**
 * Turns a persisted publish-job error string into readable corrective copy.
 * Structured JSON errors map by stable code; unknown or malformed JSON falls
 * back to generic copy (never raw JSON or internal messages); pre-structured
 * plain text (legacy rows, client-side "timed out") passes through unchanged.
 */
export function publishErrorMessage(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    const code = (parsed as { code?: unknown }).code;
    if (typeof code === "string") {
      return publishErrorCopy[code] ?? publishFailedFallback;
    }
  }
  return publishFailedFallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : {},
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  async me(): Promise<ApiUser | null> {
    try {
      return (await request<{ user: ApiUser }>("/api/auth/me")).user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  },

  async login(username: string, password: string): Promise<ApiUser> {
    const { user } = await request<{ user: ApiUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    return user;
  },

  async logout(): Promise<void> {
    await request<void>("/api/auth/logout", { method: "POST" });
  },

  async listVenues(): Promise<VenueSummary[]> {
    return (await request<{ venues: VenueSummary[] }>("/api/venues")).venues;
  },

  async createVenue(name: string): Promise<VenueRow> {
    return (
      await request<{ venue: VenueRow }>("/api/venues", {
        method: "POST",
        body: JSON.stringify({ name }),
      })
    ).venue;
  },

  async deleteVenue(id: number): Promise<void> {
    await request<void>(`/api/venues/${id}`, { method: "DELETE" });
  },

  uploadVersion(
    venueId: number,
    file: File,
    onProgress: (fraction: number) => void,
  ): Promise<{ jobId: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/venues/${venueId}/versions`);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded / event.total);
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status === 202) {
          resolve(JSON.parse(xhr.responseText) as { jobId: string });
        } else {
          reject(new ApiError(xhr.status, xhr.responseText));
        }
      });
      xhr.addEventListener("error", () => {
        reject(new ApiError(0, "network error"));
      });
      const form = new FormData();
      form.append("file", file);
      xhr.send(form);
    });
  },

  async waitForJob(
    jobId: string,
  ): Promise<{ status: "done" } | { status: "error"; error: string }> {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const job = await request<{ status: string; error: string | null }>(`/api/jobs/${jobId}`);
      if (job.status === "done") {
        return { status: "done" };
      }
      if (job.status === "error") {
        return { status: "error", error: job.error ?? "unknown error" };
      }
      if (Date.now() > deadline) {
        return { status: "error", error: "timed out" };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  },
};
