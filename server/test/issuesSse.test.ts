import { type IncomingMessage, get } from "node:http";
import type { AddressInfo } from "node:net";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import type Database from "better-sqlite3";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueEventHub, IssueSseCapacityError } from "../src/issues/events";
import { IssueRepository } from "../src/issues/repository";
import { issueSseRoutes, type IssueSseRepository } from "../src/issues/sseRoutes";
import { cleanupTestApps, makeTestDb } from "./helpers";

const PUBLIC_A = "a".repeat(64);
const PUBLIC_B = "b".repeat(64);
const PUBLIC_C = "c".repeat(64);

interface LiveResponse {
  readonly response: IncomingMessage;
  readonly text: string;
  waitForText(expected: string): Promise<void>;
  waitForEnd(): Promise<void>;
  destroy(): void;
}

const apps = new Set<FastifyInstance>();
const responses = new Set<LiveResponse>();

afterEach(async () => {
  vi.restoreAllMocks();
  for (const response of responses) {
    response.destroy();
  }
  responses.clear();
  for (const app of apps) {
    await app.close();
  }
  apps.clear();
  await cleanupTestApps();
});

function connect(app: FastifyInstance, path: string): Promise<LiveResponse> {
  const address = app.server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const request = get(`http://127.0.0.1:${address.port}${path}`, (response) => {
      response.setEncoding("utf8");
      let text = "";
      response.on("data", (chunk: string) => {
        text += chunk;
      });
      const live: LiveResponse = {
        response,
        get text() {
          return text;
        },
        waitForText(expected) {
          if (text.includes(expected)) return Promise.resolve();
          return new Promise<void>((resolveWait, rejectWait) => {
            const onData = () => {
              if (text.includes(expected)) {
                cleanup();
                resolveWait();
              }
            };
            const onEnd = () => {
              cleanup();
              rejectWait(new Error(`response ended before ${JSON.stringify(expected)}: ${JSON.stringify(text)}`));
            };
            const cleanup = () => {
              response.off("data", onData);
              response.off("end", onEnd);
            };
            response.on("data", onData);
            response.on("end", onEnd);
          });
        },
        waitForEnd() {
          if (response.complete || response.destroyed) return Promise.resolve();
          return new Promise<void>((resolveEnd, rejectEnd) => {
            response.once("end", resolveEnd);
            response.once("error", rejectEnd);
          });
        },
        destroy() {
          response.destroy();
        },
      };
      responses.add(live);
      resolve(live);
    });
    request.once("error", reject);
  });
}

function seedPublishedVersion(
  publicVersionId = PUBLIC_A,
  versionId = 100,
): { db: Database.Database; repository: IssueRepository } {
  const db = makeTestDb();
  db.prepare("INSERT INTO venues (id, tenant_id, slug, name) VALUES (10, 1, 'station', 'Station')").run();
  db.prepare(
    `INSERT INTO versions (id, venue_id, seq, public_id, source_blob_hash, bundle_hash, status)
     VALUES (?, 10, 1, ?, 'source', 'bundle', 'published')`,
  ).run(versionId, publicVersionId);
  db.prepare("INSERT INTO comment_state (version_id, revision, next_pin_number) VALUES (?, 4, 1)").run(versionId);
  return { db, repository: new IssueRepository(db) };
}

async function makeFocusedApp(options: {
  repository?: IssueSseRepository;
  maxConnections?: number;
  maxPerVersion?: number;
} = {}): Promise<{ app: FastifyInstance; hub: IssueEventHub; repository: IssueSseRepository }> {
  const repository = options.repository ?? seedPublishedVersion().repository;
  const hub = new IssueEventHub({
    maxConnections: options.maxConnections ?? 512,
    maxPerVersion: options.maxPerVersion ?? 128,
  });
  const app = fastify();
  await app.register(issueSseRoutes, { repository, hub });
  app.addHook("preClose", async () => hub.close());
  await app.listen({ host: "127.0.0.1", port: 0 });
  apps.add(app);
  return { app, hub, repository };
}

const event = (revision: number) => `event: revision\ndata: ${JSON.stringify({ revision })}\n\n`;
const pathFor = (publicId: string) => `/api/review/versions/${publicId}/issues/events`;

describe("IssueEventHub", () => {
  it("rejects per-version and global capacity before allocating a listener", () => {
    const perVersion = new IssueEventHub({ maxConnections: 2, maxPerVersion: 1 });
    const unsubscribe = perVersion.subscribe(PUBLIC_A, () => {}, () => {});
    let perVersionError: unknown;
    try {
      perVersion.subscribe(PUBLIC_A, () => {}, () => {});
    } catch (error) {
      perVersionError = error;
    }
    expect(perVersionError).toBeInstanceOf(IssueSseCapacityError);
    expect((perVersionError as IssueSseCapacityError).scope).toBe("version");
    expect(perVersion.totalSubscribers).toBe(1);
    unsubscribe();

    const global = new IssueEventHub({ maxConnections: 2, maxPerVersion: 2 });
    global.subscribe(PUBLIC_A, () => {}, () => {});
    global.subscribe(PUBLIC_B, () => {}, () => {});
    let globalError: unknown;
    try {
      global.subscribe(PUBLIC_C, () => {}, () => {});
    } catch (error) {
      globalError = error;
    }
    expect(globalError).toBeInstanceOf(IssueSseCapacityError);
    expect((globalError as IssueSseCapacityError).scope).toBe("global");
    expect(global.totalSubscribers).toBe(2);
  });

  it("makes unsubscribe idempotent and removes empty public-ID state", () => {
    const hub = new IssueEventHub({ maxConnections: 1, maxPerVersion: 1 });
    const unsubscribe = hub.subscribe(PUBLIC_A, () => {}, () => {});
    unsubscribe();
    unsubscribe();
    expect(hub.totalSubscribers).toBe(0);

    const replacement = hub.subscribe(PUBLIC_A, () => {}, () => {});
    expect(hub.totalSubscribers).toBe(1);
    replacement();
  });

  it("publishes and closes only the exact permanent public ID", () => {
    const hub = new IssueEventHub({ maxConnections: 2, maxPerVersion: 2 });
    const revisionsA: number[] = [];
    const revisionsB: number[] = [];
    const closes: string[] = [];
    hub.subscribe(PUBLIC_A, (revision) => revisionsA.push(revision), () => closes.push("a"));
    hub.subscribe(PUBLIC_B, (revision) => revisionsB.push(revision), () => closes.push("b"));

    hub.publishRevision(PUBLIC_B, 7);
    hub.closeVersion(PUBLIC_A);

    expect(revisionsA).toEqual([]);
    expect(revisionsB).toEqual([7]);
    expect(closes).toEqual(["a"]);
    expect(hub.totalSubscribers).toBe(1);
    hub.publishRevision(PUBLIC_A, 8);
    expect(revisionsA).toEqual([]);
  });

  it("globally closes every subscription, clears capacity, and ignores later publication", () => {
    const hub = new IssueEventHub({ maxConnections: 2, maxPerVersion: 2 });
    const revisions: number[] = [];
    const closes: string[] = [];
    hub.subscribe(PUBLIC_A, (revision) => revisions.push(revision), () => closes.push("a"));
    hub.subscribe(PUBLIC_B, (revision) => revisions.push(revision), () => closes.push("b"));

    hub.close();
    hub.close();
    hub.publishRevision(PUBLIC_A, 99);

    expect(closes).toEqual(["a", "b"]);
    expect(revisions).toEqual([]);
    expect(hub.totalSubscribers).toBe(0);
  });
});

describe("issue revision SSE", () => {
  it("emits the current revision immediately with exact stream headers and no issue body", async () => {
    const { app, hub } = await makeFocusedApp();
    const response = await connect(app, pathFor(PUBLIC_A));
    await response.waitForText(event(4));

    expect(response.response.statusCode).toBe(200);
    expect(response.response.headers).toMatchObject({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    expect(response.text).toBe(event(4));
    expect(response.text).not.toMatch(/body|delta|issues/i);
    expect(hub.totalSubscribers).toBe(1);
  });

  it("subscribes before reading current state and emits the maximum buffered revision", async () => {
    const hub = new IssueEventHub({ maxConnections: 2, maxPerVersion: 2 });
    const repository: IssueSseRepository = {
      resolvePublishedVersion(publicId) {
        return publicId === PUBLIC_A
          ? { versionId: 100, publicVersionId: PUBLIC_A, bundleHash: "bundle" }
          : null;
      },
      getCurrentRevision(versionId) {
        expect(versionId).toBe(100);
        hub.publishRevision(PUBLIC_A, 6);
        hub.publishRevision(PUBLIC_A, 9);
        return 7;
      },
    };
    const app = fastify();
    await app.register(issueSseRoutes, { repository, hub });
    app.addHook("preClose", async () => hub.close());
    await app.listen({ host: "127.0.0.1", port: 0 });
    apps.add(app);

    const response = await connect(app, pathFor(PUBLIC_A));
    await response.waitForText(event(9));
    expect(response.text).toBe(event(9));
  });

  it("streams committed revisions only to the matching permanent public ID after numeric ID reuse", async () => {
    const db = makeTestDb();
    db.prepare("INSERT INTO venues (id, tenant_id, slug, name) VALUES (10, 1, 'station', 'Station')").run();
    db.prepare(
      `INSERT INTO versions (id, venue_id, seq, public_id, source_blob_hash, bundle_hash, status)
       VALUES (100, 10, 1, ?, 'source-a', 'bundle-a', 'published')`,
    ).run(PUBLIC_A);
    const repository = new IssueRepository(db);
    const { app, hub } = await makeFocusedApp({ repository });
    const oldResponse = await connect(app, pathFor(PUBLIC_A));
    await oldResponse.waitForText(event(0));

    db.prepare("DELETE FROM venues WHERE id = 10").run();
    db.prepare("INSERT INTO venues (id, tenant_id, slug, name) VALUES (10, 1, 'station', 'Station')").run();
    db.prepare(
      `INSERT INTO versions (id, venue_id, seq, public_id, source_blob_hash, bundle_hash, status)
       VALUES (100, 10, 1, ?, 'source-b', 'bundle-b', 'published')`,
    ).run(PUBLIC_B);
    const replacementResponse = await connect(app, pathFor(PUBLIC_B));
    await replacementResponse.waitForText(event(0));

    hub.publishRevision(PUBLIC_B, 1);
    await replacementResponse.waitForText(event(1));
    await waitForImmediate();
    expect(oldResponse.text).toBe(event(0));
    expect(replacementResponse.text).toBe(event(0) + event(1));
  });

  it("writes a heartbeat comment on the exact 15-second interval", async () => {
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    const { app } = await makeFocusedApp();
    const response = await connect(app, pathFor(PUBLIC_A));
    await response.waitForText(event(4));

    const heartbeatCall = intervalSpy.mock.calls.find((call) => call[1] === 15_000);
    expect(heartbeatCall).toBeDefined();
    const heartbeat = heartbeatCall![0] as () => void;
    heartbeat();
    await response.waitForText(": heartbeat\n\n");
    expect(response.text).toBe(event(4) + ": heartbeat\n\n");
  });

  it("returns a non-hijacked JSON 503 with Retry-After for global and per-version capacity", async () => {
    const perVersion = await makeFocusedApp({ maxConnections: 2, maxPerVersion: 1 });
    const first = await connect(perVersion.app, pathFor(PUBLIC_A));
    await first.waitForText(event(4));
    const rejectedPerVersion = await connect(perVersion.app, pathFor(PUBLIC_A));
    await rejectedPerVersion.waitForEnd();
    expect(rejectedPerVersion.response.statusCode).toBe(503);
    expect(rejectedPerVersion.response.headers).toMatchObject({
      "content-type": expect.stringContaining("application/json"),
      "cache-control": "no-store",
      "retry-after": "15",
    });
    expect(JSON.parse(rejectedPerVersion.text)).toEqual({
      error: "sse_capacity",
      message: "Too many issue event streams are open.",
    });

    first.destroy();
    await vi.waitFor(() => expect(perVersion.hub.totalSubscribers).toBe(0));

    const global = await makeFocusedApp({ maxConnections: 1, maxPerVersion: 2 });
    const globalFirst = await connect(global.app, pathFor(PUBLIC_A));
    await globalFirst.waitForText(event(4));
    const rejectedGlobal = await connect(global.app, pathFor(PUBLIC_A));
    await rejectedGlobal.waitForEnd();
    expect(rejectedGlobal.response.statusCode).toBe(503);
    expect(rejectedGlobal.response.headers).toMatchObject({
      "cache-control": "no-store",
      "retry-after": "15",
    });
    expect(JSON.parse(rejectedGlobal.text)).toEqual({
      error: "sse_capacity",
      message: "Too many issue event streams are open.",
    });
    expect(global.hub.totalSubscribers).toBe(1);
  });

  it("releases capacity on disconnect and when a deleted version is closed", async () => {
    const { db, repository } = seedPublishedVersion();
    db.prepare("INSERT INTO venues (id, tenant_id, slug, name) VALUES (11, 1, 'annex', 'Annex')").run();
    db.prepare(
      `INSERT INTO versions (id, venue_id, seq, public_id, source_blob_hash, bundle_hash, status)
       VALUES (101, 11, 1, ?, 'source-b', 'bundle-b', 'published')`,
    ).run(PUBLIC_B);
    const { app, hub } = await makeFocusedApp({ repository, maxConnections: 1, maxPerVersion: 1 });

    const disconnected = await connect(app, pathFor(PUBLIC_A));
    await disconnected.waitForText(event(4));
    disconnected.destroy();
    await vi.waitFor(() => expect(hub.totalSubscribers).toBe(0));

    const deleted = await connect(app, pathFor(PUBLIC_A));
    await deleted.waitForText(event(4));
    hub.closeVersion(PUBLIC_A);
    await deleted.waitForEnd();
    expect(hub.totalSubscribers).toBe(0);

    const replacement = await connect(app, pathFor(PUBLIC_B));
    await replacement.waitForText(event(0));
    expect(hub.totalSubscribers).toBe(1);
  });

  it("returns the same public 404 for unknown and unpublished versions without reserving capacity", async () => {
    const { db, repository } = seedPublishedVersion();
    db.prepare("INSERT INTO versions (id, venue_id, seq, public_id, source_blob_hash, status) VALUES (101, 10, 2, ?, 'source-b', 'draft')").run(PUBLIC_B);
    const { app, hub } = await makeFocusedApp({ repository });

    for (const publicId of [PUBLIC_B, PUBLIC_C]) {
      const response = await connect(app, pathFor(publicId));
      await response.waitForEnd();
      expect(response.response.statusCode).toBe(404);
      expect(JSON.parse(response.text)).toEqual({
        error: "not_found",
        message: "The review issue was not found.",
      });
    }
    expect(hub.totalSubscribers).toBe(0);
  });

  it("closes a deliberately live real socket during preClose so app.close resolves", async () => {
    const { app, hub } = await makeFocusedApp();
    const response = await connect(app, pathFor(PUBLIC_A));
    await response.waitForText(event(4));

    const ended = response.waitForEnd();
    await expect(app.close()).resolves.toBeUndefined();
    apps.delete(app);
    await ended;
    expect(hub.totalSubscribers).toBe(0);
  });
});
