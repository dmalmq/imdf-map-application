import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type JobRunner = (payloadJson: string) => Promise<unknown>;

export class JobQueue {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database.Database,
    private readonly runners: Record<string, JobRunner>,
  ) {}

  enqueue(kind: string, payload: unknown): string {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO jobs (id, kind, payload_json) VALUES (?, ?, ?)")
      .run(id, kind, JSON.stringify(payload));
    this.chain = this.chain.then(() => this.run(id, kind));
    return id;
  }

  /** Resolves when every enqueued job has finished (tests, shutdown). */
  idle(): Promise<void> {
    return this.chain;
  }

  private async run(id: string, kind: string): Promise<void> {
    const update = this.db.prepare(
      "UPDATE jobs SET status = ?, result_json = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
    );
    update.run("running", null, null, id);
    const runner = this.runners[kind];
    try {
      if (!runner) {
        throw new Error(`no runner for job kind ${kind}`);
      }
      const row = this.db.prepare("SELECT payload_json AS p FROM jobs WHERE id = ?").get(id) as {
        p: string;
      };
      const result = await runner(row.p);
      update.run("done", JSON.stringify(result ?? null), null, id);
    } catch (error) {
      update.run("error", null, error instanceof Error ? error.message : String(error), id);
    }
  }
}
