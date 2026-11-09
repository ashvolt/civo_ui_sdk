import type { VNode } from "./vnode.js";

/**
 * Props each base component draws, as the contract hands them over.
 *
 * Typed as the validated shape, but every template also tolerates a partial
 * one: under the `server` validation tier a same-origin stream's nodes arrive
 * unvalidated, mid-stream, with lists not yet started and strings half
 * written. A template renders what is there and never throws on what is not.
 */

type Tone = "info" | "success" | "warning" | "danger";

export interface BaseProps {
  Stack: { gap: "sm" | "md" | "lg"; direction: "column" | "row" };
  Grid: { columns: number };
  Card: { title?: string; subtitle?: string };
  Heading: { text: string; level: number };
  Text: { text: string; tone: "default" | "muted" };
  Metric: { label: string; value: string; trend?: "up" | "down" | "flat"; caption?: string };
  List: { items: string[]; ordered: boolean };
  Table: { caption?: string; columns: string[]; rows: string[][] };
  Callout: { tone: Tone; title: string; body: string };
  Badge: { text: string; tone: "neutral" | Tone };
  Link: { label: string; href: string };
  Chart: {
    kind: "bar" | "line";
    title: string;
    unit?: string;
    labels: string[];
    series: { name: string; values: number[] }[];
  };
}

export type BaseComponentName = keyof BaseProps;
export type Template<P> = (props: P) => VNode;
export type BaseTemplates = { [K in BaseComponentName]: Template<BaseProps[K]> };

/** `value` if it is one of `allowed`, else `fallback`. Keeps class names closed. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** A string, or nothing: a half-streamed prop may be absent or mistyped. */
export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** An array, or an empty one. */
export function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
}
