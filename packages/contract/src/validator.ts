import type { Contract } from "./contract.js";

/**
 * Checks one node's props against its component in a contract.
 *
 * The shape `relax-ui-render` expects for full browser validation. Kept in this
 * package because it needs Zod and the contract; a host loads it lazily, so a
 * same-origin route with `validate: "server"` never ships either (FR-208):
 *
 *   validator: () => import("./my-contract").then((m) => createValidator(m.contract))
 */
export interface PropsValidator {
  props(type: string, raw: unknown): { ok: true; props: Record<string, unknown> } | { ok: false; detail?: string };
}

export function createValidator(contract: Pick<Contract, "spec">): PropsValidator {
  return {
    props(type, raw) {
      const spec = contract.spec(type);
      if (!spec) return { ok: false, detail: "unknown type" };
      const result = spec.props.safeParse(raw ?? {});
      if (result.success) return { ok: true, props: result.data as Record<string, unknown> };
      // Field paths only, never values: the same redaction the server applies.
      return { ok: false, detail: result.error.issues.map((issue) => issue.path.join(".")).join(", ") };
    },
  };
}
