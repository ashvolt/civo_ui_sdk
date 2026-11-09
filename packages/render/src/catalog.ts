/**
 * The resolved table of implementations for a page: which code renders each
 * component type, and whether it has arrived yet.
 *
 * Entries are eager (`templates`) or lazy (`loaders`). A loader is called the
 * first time a document uses its type, at most once per page, and its promise
 * is shared by every renderer using this catalog (data model G2). A failed load
 * marks the type failed until the next document, when it may be tried again
 * (G4) — never on the next frame, which would hammer a missing chunk several
 * times a second.
 *
 * Generic in what an implementation is: the DOM renderer stores templates, the
 * React renderer stores React components.
 */

export type Loader<I> = () => Promise<I>;
/** `lazy`: has a loader that has not been called yet. */
export type CatalogState = "ready" | "lazy" | "loading" | "failed" | "absent";

export interface CatalogOptions<I> {
  /** Implementations available immediately. */
  templates?: Readonly<Record<string, I>>;
  /** Implementations fetched on first use. An eager entry for a type wins. */
  loaders?: Readonly<Record<string, Loader<I>>>;
  /** Types to load now rather than on first use (FR-243). */
  preload?: readonly string[];
}

export interface Catalog<I = unknown> {
  /** The implementation, if it has arrived. */
  get(type: string): I | undefined;
  state(type: string): CatalogState;
  /** Starts loading `type` if it is lazy and not yet requested. Idempotent. */
  request(type: string): void;
  /** Called whenever a load settles, so renderers can draw what arrived. */
  subscribe(listener: () => void): () => void;
  /** A new document begins: failed types may be tried again. */
  startDocument(): void;
}

export function createCatalog<I>(options: CatalogOptions<I> = {}): Catalog<I> {
  const ready = new Map<string, I>(Object.entries(options.templates ?? {}));
  const loaders = new Map<string, Loader<I>>(Object.entries(options.loaders ?? {}));
  const loading = new Set<string>();
  const failed = new Set<string>();
  const retryable = new Set<string>();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  const catalog: Catalog<I> = {
    get: (type) => ready.get(type),

    state(type) {
      if (ready.has(type)) return "ready";
      if (loading.has(type)) return "loading";
      if (failed.has(type)) return retryable.has(type) ? "lazy" : "failed";
      return loaders.has(type) ? "lazy" : "absent";
    },

    request(type) {
      if (ready.has(type) || loading.has(type)) return;
      if (failed.has(type) && !retryable.has(type)) return;
      const loader = loaders.get(type);
      if (!loader) return;
      failed.delete(type);
      retryable.delete(type);
      loading.add(type);
      let promise: Promise<I>;
      try {
        promise = Promise.resolve(loader());
      } catch (cause) {
        promise = Promise.reject(cause);
      }
      promise.then(
        (implementation) => {
          loading.delete(type);
          if (implementation === undefined || implementation === null) {
            failed.add(type);
          } else {
            ready.set(type, implementation);
          }
          notify();
        },
        () => {
          loading.delete(type);
          failed.add(type);
          notify();
        },
      );
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    startDocument() {
      for (const type of failed) retryable.add(type);
    },
  };

  for (const type of options.preload ?? []) catalog.request(type);
  return catalog;
}
