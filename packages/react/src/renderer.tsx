"use client";

import type { ComponentSpec, ComponentSpecMap, UINode } from "relax-ui-core";
import { createCatalog, Resolver } from "relax-ui-render";
import * as React from "react";

/**
 * Rendering a model-authored component tree.
 *
 * The renderer resolves `node.type` through a lookup table the application
 * built, and re-validates `node.props` against the same spec the server used.
 * Both of those are already enforced upstream; doing them again here is the
 * point. Defence in depth is cheap when the check is a map lookup and a
 * `safeParse`, and the failure it guards against — a malformed document
 * reaching the DOM because one layer was misconfigured — is not cheap at all.
 *
 * There is no escape hatch for raw HTML. Not as an option, not behind a flag.
 * A single `dangerouslySetInnerHTML` would make every other control in this SDK
 * decorative.
 */

/**
 * What the renderer needs from a vocabulary: a spec per type and a depth
 * limit. A `UIRegistry` from `relax-ui-core` and a `Contract` from
 * `relax-ui-contract` both satisfy it, so either can drive rendering (FR-224).
 */
export interface RenderVocabulary<M extends ComponentSpecMap = ComponentSpecMap> {
  readonly specs: M;
  readonly limits: { readonly maxDepth: number };
  spec(type: string): ComponentSpec | undefined;
}

export interface GenerativeComponentProps<P = Record<string, unknown>> {
  props: P;
  children?: React.ReactNode;
  /** The node being rendered, for components that need identity or metadata. */
  node: UINode;
}

export type GenerativeComponent<P = Record<string, unknown>> = React.ComponentType<
  GenerativeComponentProps<P>
>;

export type ComponentImplementations<M extends ComponentSpecMap> = {
  [K in keyof M]: GenerativeComponent<never>;
};

export interface RenderFailure {
  reason: "unknown_type" | "invalid_props" | "depth_exceeded";
  type: string;
  detail?: string;
}

export interface GenerativeUIProps<M extends ComponentSpecMap> {
  registry: RenderVocabulary<M>;
  components: ComponentImplementations<M>;
  /** The node to render. `undefined` while the first frame is in flight. */
  node: UINode | undefined;
  /** Rendered in place of a node that fails a check. Default: nothing. */
  onInvalidNode?: (failure: RenderFailure) => React.ReactNode;
  /** Rendered while `node` is undefined. */
  placeholder?: React.ReactNode;
}

/**
 * Renders a validated UI document.
 *
 * Streaming means this is called with a *partial* tree many times per second.
 * Nodes are keyed by `node.key` when the model supplied one, so a list that
 * grows during streaming reconciles by identity instead of remounting every
 * child on each frame.
 */
export function GenerativeUI<M extends ComponentSpecMap>(
  props: GenerativeUIProps<M>,
): React.ReactElement | null {
  const { registry, components, node, onInvalidNode, placeholder } = props;
  const resolver = React.useMemo(() => resolverFor(registry, components), [registry, components]);

  if (!node) return <>{placeholder ?? null}</>;

  return <RenderNode resolver={resolver} node={node} depth={1} onInvalidNode={onInvalidNode} />;
}

/**
 * The render core's resolver, set up for React: the components are eager,
 * and validation is always full — the React renderer has always re-validated
 * every node, and keeps doing so.
 *
 * Only types with both a spec and a component are in the vocabulary, so a
 * missing component is an unknown type, as it always was.
 */
function resolverFor<M extends ComponentSpecMap>(
  registry: RenderVocabulary<M>,
  components: ComponentImplementations<M>,
): Resolver<GenerativeComponent<never>> {
  const implementations = components as unknown as Record<string, GenerativeComponent<never>>;
  const types = Object.keys(registry.specs).filter((type) => registry.spec(type) && implementations[type]);
  return new Resolver<GenerativeComponent<never>>({
    catalog: createCatalog({ templates: implementations }),
    types,
    validate: "full",
    validator: {
      props(type, raw) {
        const result = registry.spec(type)!.props.safeParse(raw);
        return result.success
          ? { ok: true, props: result.data as Record<string, unknown> }
          : { ok: false, detail: result.error!.issues.map((issue) => issue.path.join(".")).join(", ") };
      },
    },
    maxDepth: registry.limits.maxDepth,
  });
}

interface RenderNodeProps {
  resolver: Resolver<GenerativeComponent<never>>;
  node: UINode;
  depth: number;
  onInvalidNode?: (failure: RenderFailure) => React.ReactNode;
}

/**
 * One node. Memoised on its props: with the protocol's structural sharing an
 * untouched subtree is the same `node` object in the next frame, so React
 * skips it outright, as the DOM backend does.
 */
const RenderNode = /* @__PURE__ */ React.memo(function RenderNode({
  resolver,
  node,
  depth,
  onInvalidNode,
}: RenderNodeProps): React.ReactElement | null {
  const resolution = resolver.resolve(node, depth);

  if (resolution.kind === "skip") {
    // Outside the vocabulary, too deep, or props that fail their schema.
    // Render nothing rather than guess what was meant.
    const { reason, type, detail } = resolution.failure;
    const failure: RenderFailure = { reason: reason as RenderFailure["reason"], type, ...(detail !== undefined && reason === "invalid_props" ? { detail } : {}) };
    return <>{onInvalidNode?.(failure) ?? null}</>;
  }
  if (resolution.kind === "pending") return null;

  const Component = resolution.implementation;
  const children = Array.isArray(node.children) ? node.children : undefined;

  return (
    <Component props={resolution.props as never} node={node}>
      {children?.map((child, index) => (
        <RenderNode
          key={child?.key ?? `${child?.type ?? "node"}:${index}`}
          resolver={resolver}
          node={child}
          depth={depth + 1}
          onInvalidNode={onInvalidNode}
        />
      ))}
    </Component>
  );
});

/**
 * Binds a registry to its implementations once, so call sites pass only a node.
 *
 * Keeping the pairing in one place is not just ergonomics: a registry rendered
 * with someone else's component map is exactly the misconfiguration the
 * per-node re-validation exists to catch, and this makes it hard to write.
 */
export function createGenerativeRenderer<M extends ComponentSpecMap>(
  registry: RenderVocabulary<M>,
  components: ComponentImplementations<M>,
  defaults?: Pick<GenerativeUIProps<M>, "onInvalidNode" | "placeholder">,
): (props: Pick<GenerativeUIProps<M>, "node"> & Partial<GenerativeUIProps<M>>) => React.ReactElement | null {
  return function BoundGenerativeUI(props) {
    return (
      <GenerativeUI
        registry={registry}
        components={components}
        node={props.node}
        onInvalidNode={props.onInvalidNode ?? defaults?.onInvalidNode}
        placeholder={props.placeholder ?? defaults?.placeholder}
      />
    );
  };
}
