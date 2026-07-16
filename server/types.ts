/**
 * Wire types for the sharing platform server. src/platform/types.ts mirrors
 * these for the client; keep both in sync by hand. The server re-validates
 * all client input, so drift fails loudly rather than silently.
 */
export type DatasetKind = "venue-snapshot" | "imdf";
export type Role = "admin" | "user";

export interface CatalogEntry {
  id: string;
  name: string;
  kind: DatasetKind;
  levelCount: number;
  featureCount: number;
  sourceName: string;
  updatedAt: string;
}

export interface CommentRecord {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  levelId?: string;
  lngLat?: [number, number];
  featureId?: string;
}

export interface UserRecord {
  username: string;
  role: Role;
  salt: string;
  passwordHash: string;
}

export interface SessionRecord {
  token: string;
  username: string;
  createdAt: string;
}
