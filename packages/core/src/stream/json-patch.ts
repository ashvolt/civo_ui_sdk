import type { JsonValue } from "../types.js";

/**
 * A deliberately small subset of RFC 6902.
 *
 * Streaming a generative UI by re-sending the whole object on every token is
 * O(n^2) bytes; for a 40 KB dashboard spec that is megabytes of duplicated
 * payload over a mobile connection. Successive partial parses differ by very
 * little, so we ship the difference instead.
 *
 * Only `add`, `replace` and `remove` are emitted: `move`/`copy`/`test` buy
 * nothing here and every op we support is one a reviewer can check by eye.
 */
export type JsonPatchOp =
  | { op: "add"; path: string; value: JsonValue }
  | { op: "replace"; path: string; value: JsonValue }
  | { op: "remove"; path: string };

/** Encodes a single path segment per RFC 6901. */
export function encodePointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

export function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function toPointer(path: readonly (string | number)[]): string {
  return path.length === 0 ? "" : `/${path.map(encodePointerSegment).join("/")}`;
}

export function fromPointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split("/").map(decodePointerSegment);
}

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Computes the ops that turn `before` into `after`.
 *
 * Arrays are diffed positionally rather than by identity. That is the right
 * trade for generated UI: a model appends to a list far more often than it
 * splices into the middle of one, and positional diffing keeps the emitted ops
 * both minimal and trivially applicable.
 */
export function diffJson(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  basePath: readonly (string | number)[] = [],
): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  collect(before, after, basePath, ops);
  return ops;
}

function collect(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  path: readonly (string | number)[],
  ops: JsonPatchOp[],
): void {
  if (before === after) return;

  if (after === undefined) {
    ops.push({ op: "remove", path: toPointer(path) });
    return;
  }
  if (before === undefined) {
    ops.push({ op: "add", path: toPointer(path), value: after });
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of Object.keys(before)) {
      if (!(key in after)) ops.push({ op: "remove", path: toPointer([...path, key]) });
    }
    for (const key of Object.keys(after)) {
      collect(before[key], after[key], [...path, key], ops);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length);
    for (let i = 0; i < shared; i++) {
      collect(before[i], after[i], [...path, i], ops);
    }
    for (let i = before.length - 1; i >= after.length; i--) {
      ops.push({ op: "remove", path: toPointer([...path, i]) });
    }
    for (let i = before.length; i < after.length; i++) {
      ops.push({ op: "add", path: toPointer([...path, i]), value: after[i] as JsonValue });
    }
    return;
  }

  if (Number.isNaN(before as number) && Number.isNaN(after as number)) return;
  ops.push({ op: "replace", path: toPointer(path), value: after });
}

/**
 * Applies `ops` to `doc`, returning a new document. Structurally shares
 * untouched subtrees, so React consumers can keep using referential equality
 * to skip re-renders of the parts of the UI that did not change.
 */
export function applyPatch(doc: JsonValue | undefined, ops: readonly JsonPatchOp[]): JsonValue | undefined {
  let current = doc;
  for (const op of ops) {
    current = applyOne(current, fromPointer(op.path), op);
  }
  return current;
}

function applyOne(
  doc: JsonValue | undefined,
  segments: readonly string[],
  op: JsonPatchOp,
): JsonValue | undefined {
  if (segments.length === 0) {
    return op.op === "remove" ? undefined : op.value;
  }

  const [head, ...rest] = segments as [string, ...string[]];

  if (Array.isArray(doc)) {
    const index = head === "-" ? doc.length : Number(head);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Patch path expects an array index, got "${head}"`);
    }
    const next = doc.slice();
    if (rest.length === 0) {
      if (op.op === "remove") next.splice(index, 1);
      else if (op.op === "add") next.splice(index, 0, op.value);
      else next[index] = op.value;
    } else {
      const child = applyOne(next[index], rest, op);
      if (child === undefined) next.splice(index, 1);
      else next[index] = child;
    }
    return next;
  }

  const base: Record<string, JsonValue> = isPlainObject(doc) ? { ...doc } : {};
  if (rest.length === 0) {
    if (op.op === "remove") delete base[head];
    else base[head] = op.value;
  } else {
    const child = applyOne(base[head], rest, op);
    if (child === undefined) delete base[head];
    else base[head] = child;
  }
  return base;
}
