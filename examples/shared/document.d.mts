/** Types for document.mjs, for the TypeScript hosts. */
export interface ExampleNode {
  type: string;
  key?: string;
  props: Record<string, unknown>;
  children?: ExampleNode[];
}
export declare const DOCUMENT: { root: ExampleNode & { children: ExampleNode[] } };
export declare function withLabel(label?: string): typeof DOCUMENT;
