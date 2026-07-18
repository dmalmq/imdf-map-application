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
