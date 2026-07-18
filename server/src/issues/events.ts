import type { IssueRevisionPublisher } from "./service";

export type IssueSseCapacityScope = "global" | "version";

export class IssueSseCapacityError extends Error {
  readonly code = "sse_capacity" as const;

  constructor(readonly scope: IssueSseCapacityScope) {
    super("Too many issue event streams are open.");
    this.name = "IssueSseCapacityError";
  }
}

export interface IssueEventHubOptions {
  maxConnections: number;
  maxPerVersion: number;
}

interface Subscription {
  readonly listener: (revision: number) => void;
  readonly closeListener: () => void;
  active: boolean;
}

export class IssueEventHub implements IssueRevisionPublisher {
  readonly #maxConnections: number;
  readonly #maxPerVersion: number;
  readonly #subscribers = new Map<string, Set<Subscription>>();
  #totalSubscribers = 0;
  #closed = false;

  constructor(options: IssueEventHubOptions) {
    this.#maxConnections = options.maxConnections;
    this.#maxPerVersion = options.maxPerVersion;
  }

  get totalSubscribers(): number {
    return this.#totalSubscribers;
  }

  subscribe(
    publicVersionId: string,
    listener: (revision: number) => void,
    closeListener: () => void,
  ): () => void {
    if (this.#closed) {
      closeListener();
      return () => {};
    }
    if (this.#totalSubscribers >= this.#maxConnections) {
      throw new IssueSseCapacityError("global");
    }
    const existing = this.#subscribers.get(publicVersionId);
    if ((existing?.size ?? 0) >= this.#maxPerVersion) {
      throw new IssueSseCapacityError("version");
    }

    const subscription: Subscription = { listener, closeListener, active: true };
    const subscribers = existing ?? new Set<Subscription>();
    if (existing === undefined) {
      this.#subscribers.set(publicVersionId, subscribers);
    }
    subscribers.add(subscription);
    this.#totalSubscribers += 1;

    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      if (subscribers.delete(subscription)) {
        this.#totalSubscribers -= 1;
      }
      if (subscribers.size === 0 && this.#subscribers.get(publicVersionId) === subscribers) {
        this.#subscribers.delete(publicVersionId);
      }
    };
  }

  publishRevision(publicVersionId: string, revision: number): void {
    if (this.#closed) return;
    const subscribers = this.#subscribers.get(publicVersionId);
    if (subscribers === undefined) return;
    for (const subscription of [...subscribers]) {
      if (!subscription.active) continue;
      try {
        subscription.listener(revision);
      } catch {
        subscription.active = false;
        if (subscribers.delete(subscription)) {
          this.#totalSubscribers -= 1;
        }
      }
    }
    if (subscribers.size === 0 && this.#subscribers.get(publicVersionId) === subscribers) {
      this.#subscribers.delete(publicVersionId);
    }
  }

  closeVersion(publicVersionId: string): void {
    const subscribers = this.#subscribers.get(publicVersionId);
    if (subscribers === undefined) return;
    this.#subscribers.delete(publicVersionId);
    const activeSubscriptions = [...subscribers].filter((subscription) => subscription.active);
    for (const subscription of activeSubscriptions) {
      subscription.active = false;
    }
    this.#totalSubscribers -= activeSubscriptions.length;
    for (const subscription of activeSubscriptions) {
      try {
        subscription.closeListener();
      } catch {
        // One broken socket must not prevent the remaining version streams from closing.
      }
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const publicVersionId of [...this.#subscribers.keys()]) {
      this.closeVersion(publicVersionId);
    }
    this.#subscribers.clear();
    this.#totalSubscribers = 0;
  }
}
