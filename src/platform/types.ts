/** Client mirror of server/types.ts — keep field-for-field in sync. */
export type DatasetKind = "venue-snapshot" | "imdf";
export type Role = "admin" | "user";

export interface AccountInfo {
  username: string;
  role: Role;
}

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

export interface CommentInput {
  text: string;
  levelId?: string;
  lngLat?: [number, number];
  featureId?: string;
}
