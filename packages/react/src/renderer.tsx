"use client";

import type { ComponentSpecMap, UINode, UIRegistry } from "@civo/relax-ui-core";
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
  registry: UIRegistry<M>;
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

  if (!node) return <>{placeholder ?? null}</>;

  return (
    <RenderNode
      registry={registry}
      components={components}
      node={node}
      depth={1}
      onInvalidNode={onInvalidNode}
    />
  );
}

interface RenderNodeProps<M extends ComponentSpecMap> {
  registry: UIRegistry<M>;
  components: ComponentImplementations<M>;
  node: UINode;
  depth: number;
  onInvalidNode?: (failure: RenderFailure) => React.ReactNode;
}

function RenderNode<M extends ComponentSpecMap>({
  registry,
  components,
  node,
  depth,
  onInvalidNode,
}: RenderNodeProps<M>): React.ReactElement | null {
  const fail = (failure: RenderFailure): React.ReactElement | null => (
    <>{onInvalidNode?.(failure) ?? null}</>
  );

  if (depth > registry.limits.maxDepth) {
    return fail({ reason: "depth_exceeded", type: String(node?.type) });
  }

  if (!node || typeof node !== "object" || typeof node.type !== "string") {
    return fail({ reason: "unknown_type", type: String((node as { type?: unknown })?.type) });
  }

  const spec = registry.spec(node.type);
  const Component = components[node.type as keyof M] as GenerativeComponent<never> | undefined;
  if (!spec || !Component) {
    // A type outside the registry can only mean a compromised or mismatched
    // stream. Render nothing rather than guess what was meant.
    return fail({ reason: "unknown_type", type: node.type });
  }

  const validated = spec.props.safeParse(node.props ?? {});
  if (!validated.success) {
    return fail({
      reason: "invalid_props",
      type: node.type,
      detail: validated.error.issues.map((issue) => issue.path.join(".")).join(", "),
    });
  }

  const children = Array.isArray(node.children) ? node.children : undefined;

  return (
    <Component props={validated.data as never} node={node}>
      {children?.map((child, index) => (
        <RenderNode
          key={child?.key ?? `${child?.type ?? "node"}:${index}`}
          registry={registry}
          components={components}
          node={child}
          depth={depth + 1}
          onInvalidNode={onInvalidNode}
        />
      ))}
    </Component>
  );
}

/**
 * Binds a registry to its implementations once, so call sites pass only a node.
 *
 * Keeping the pairing in one place is not just ergonomics: a registry rendered
 * with someone else's component map is exactly the misconfiguration the
 * per-node re-validation exists to catch, and this makes it hard to write.
 */
export function createGenerativeRenderer<M extends ComponentSpecMap>(
  registry: UIRegistry<M>,
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
