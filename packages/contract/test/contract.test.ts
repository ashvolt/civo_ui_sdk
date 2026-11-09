import { defineContract, displayText, standardContract, STANDARD_COMPONENT_NAMES, type Contract } from "relax-ui-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/** T-220. The twelve standard components: vocabulary, bounds, safety, extension. */

const node = (type: string, props: Record<string, unknown>, children?: unknown[]) => ({
  type,
  props,
  ...(children ? { children } : {}),
});
type Schemas = Pick<Contract, "nodeSchema" | "documentSchema">;
const valid = (contract: Schemas, n: unknown) => contract.nodeSchema.safeParse(n).success;
const doc = (contract: Schemas, root: unknown) => contract.documentSchema.safeParse({ root }).success;
const range = (n: number, f: (i: number) => unknown = (i) => `item ${i}`) => Array.from({ length: n }, (_, i) => f(i));

const EXPECTED_CHILDREN = {
  Stack: "required",
  Grid: "required",
  Card: "optional",
  Heading: "none",
  Text: "none",
  Metric: "none",
  List: "none",
  Table: "none",
  Callout: "none",
  Badge: "none",
  Link: "none",
  Chart: "none",
} as const;

describe("the standard contract (T-220)", () => {
  it("has exactly the twelve components of FR-210", () => {
    expect([...standardContract.names].sort()).toEqual(Object.keys(EXPECTED_CHILDREN).sort());
    expect([...STANDARD_COMPONENT_NAMES].sort()).toEqual(Object.keys(EXPECTED_CHILDREN).sort());
  });

  it.each(Object.entries(EXPECTED_CHILDREN))("%s takes children: %s", (name, policy) => {
    expect(standardContract.spec(name)?.children).toBe(policy);
  });

  it.each(Object.keys(EXPECTED_CHILDREN))("%s states a role and a description (FR-214)", (name) => {
    expect(standardContract.role(name)).toMatch(/^[a-z]+$/);
    expect(standardContract.spec(name)?.description?.length).toBeGreaterThan(10);
  });

  it("accepts a document that uses all twelve", () => {
    const root = node("Stack", { gap: "md" }, [
      node("Heading", { text: "Q3", level: 1 }),
      node("Grid", { columns: 2 }, [
        node("Metric", { label: "Spend", value: "£4.1bn", trend: "up", caption: "vs Q2" }),
        node("Card", { title: "Notes" }, [node("Text", { text: "Plain.", tone: "muted" })]),
      ]),
      node("List", { items: ["a", "b"], ordered: true }),
      node("Table", { columns: ["Region", "Spend"], rows: [["UK", "£1m"]] }),
      node("Callout", { tone: "warning", title: "Heads up", body: "Illustrative." }),
      node("Badge", { text: "beta", tone: "info" }),
      node("Link", { label: "Source", href: "https://example.com/report" }),
      node("Chart", { kind: "bar", title: "Spend", labels: ["Q1", "Q2"], series: [{ name: "UK", values: [1, 2] }] }),
    ]);
    const result = standardContract.documentSchema.safeParse({ root });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it("fills defaults", () => {
    const parsed = standardContract.nodeSchema.parse(node("Stack", {}, [node("Text", { text: "x" })])) as {
      props: Record<string, unknown>;
      children: { props: Record<string, unknown> }[];
    };
    expect(parsed.props).toEqual({ gap: "md", direction: "column" });
    expect(parsed.children[0]!.props.tone).toBe("default");
  });

  describe("children policy", () => {
    it("refuses children on a leaf", () => {
      expect(valid(standardContract, node("Heading", { text: "x" }, [node("Text", { text: "y" })]))).toBe(false);
    });
    it("refuses a container without children", () => {
      expect(valid(standardContract, node("Stack", {}))).toBe(false);
      expect(valid(standardContract, node("Grid", {}, []))).toBe(false);
    });
    it("lets a Card go without", () => {
      expect(valid(standardContract, node("Card", { title: "x" }))).toBe(true);
    });
    it("refuses a type outside the contract", () => {
      expect(valid(standardContract, node("Script", { text: "x" }))).toBe(false);
      expect(valid(standardContract, node("stack", {}, [node("Text", { text: "x" })]))).toBe(false);
    });
  });

  describe("bounds", () => {
    it("List: at most 20 items", () => {
      expect(valid(standardContract, node("List", { items: range(20) }))).toBe(true);
      expect(valid(standardContract, node("List", { items: range(21) }))).toBe(false);
    });

    it("Table: at most 8 columns and 50 rows of 8 cells", () => {
      const columns = range(8, (i) => `c${i}`);
      const row = range(8, () => "v");
      expect(valid(standardContract, node("Table", { columns, rows: range(50, () => row) }))).toBe(true);
      expect(valid(standardContract, node("Table", { columns: range(9), rows: [] }))).toBe(false);
      expect(valid(standardContract, node("Table", { columns, rows: range(51, () => row) }))).toBe(false);
      expect(valid(standardContract, node("Table", { columns, rows: [range(9, () => "v")] }))).toBe(false);
    });

    it("Chart: at most 4 series of 24 points", () => {
      const labels = range(24, (i) => `p${i}`);
      const series = (n: number, points: number) => range(n, (i) => ({ name: `s${i}`, values: range(points, (j) => j) }));
      expect(valid(standardContract, node("Chart", { kind: "line", title: "t", labels, series: series(4, 24) }))).toBe(true);
      expect(valid(standardContract, node("Chart", { kind: "line", title: "t", labels, series: series(5, 24) }))).toBe(false);
      expect(valid(standardContract, node("Chart", { kind: "line", title: "t", labels, series: series(1, 25) }))).toBe(false);
      expect(
        valid(standardContract, node("Chart", { kind: "bar", title: "t", labels: range(25), series: series(1, 2) })),
      ).toBe(false);
    });

    it("Chart: values are finite numbers", () => {
      const chart = (values: unknown[]) =>
        node("Chart", { kind: "bar", title: "t", labels: ["a"], series: [{ name: "s", values }] });
      expect(valid(standardContract, chart([1.5]))).toBe(true);
      expect(valid(standardContract, chart(["1"]))).toBe(false);
      expect(valid(standardContract, chart([Number.POSITIVE_INFINITY]))).toBe(false);
    });

    it("Grid: 1 to 4 columns; Heading: levels 1 to 4", () => {
      const kids = [node("Text", { text: "x" })];
      expect(valid(standardContract, node("Grid", { columns: 4 }, kids))).toBe(true);
      expect(valid(standardContract, node("Grid", { columns: 5 }, kids))).toBe(false);
      expect(valid(standardContract, node("Heading", { text: "x", level: 5 }))).toBe(false);
    });

    it("text is bounded and free of control characters", () => {
      expect(valid(standardContract, node("Text", { text: "a".repeat(2_000) }))).toBe(true);
      expect(valid(standardContract, node("Text", { text: "a".repeat(2_001) }))).toBe(false);
      expect(valid(standardContract, node("Text", { text: "bell\u0007" }))).toBe(false);
      expect(valid(standardContract, node("Badge", { text: "x".repeat(33) }))).toBe(false);
    });

    it("the document budget applies: nodes and depth", () => {
      const tiny = defineContract(standardContract.specs, { maxNodes: 3, maxDepth: 2 });
      const text = node("Text", { text: "x" });
      expect(doc(tiny, node("Stack", {}, [text, text]))).toBe(true);
      expect(doc(tiny, node("Stack", {}, [text, text, text]))).toBe(false);
      expect(doc(tiny, node("Stack", {}, [node("Stack", {}, [text])]))).toBe(false);
    });
  });

  describe("no actions (FR-213, C4)", () => {
    it("no component declares an event-handler or action prop", () => {
      for (const name of standardContract.names) {
        for (const key of propKeys(standardContract.spec(name)!.props)) {
          expect(key, `${name}.${key}`).not.toMatch(/^on[A-Z]|^(action|handler|script|onclick|formaction)$/i);
        }
      }
    });

    it("unknown props are dropped, never passed on", () => {
      const parsed = standardContract.nodeSchema.parse(node("Text", { text: "x", onClick: "alert(1)" })) as {
        props: Record<string, unknown>;
      };
      expect(parsed.props).toEqual({ text: "x", tone: "default" });
    });

    it.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>", "vbscript:x", "//evil.example/x"])(
      "Link refuses %s",
      (href) => {
        expect(valid(standardContract, node("Link", { label: "x", href }))).toBe(false);
      },
    );

    it.each(["https://example.com/a", "/reports/q3", "mailto:team@example.com"])("Link accepts %s", (href) => {
      expect(valid(standardContract, node("Link", { label: "x", href }))).toBe(true);
    });
  });
});

describe("extend (FR-212, C2)", () => {
  const Timeline = {
    description: "A sequence of dated events.",
    role: "list",
    children: "none" as const,
    props: z.object({ events: z.array(displayText(80)).max(10) }),
  };

  it("adds a component and keeps the twelve", () => {
    const extended = standardContract.extend({ Timeline });
    expect(extended.names).toHaveLength(13);
    expect(valid(extended, node("Timeline", { events: ["launch"] }))).toBe(true);
    for (const name of STANDARD_COMPONENT_NAMES) expect(extended.spec(name)).toBeDefined();
  });

  it("does not change the contract it extends", () => {
    standardContract.extend({ Timeline });
    expect(standardContract.names).toHaveLength(12);
    expect(valid(standardContract, node("Timeline", { events: [] }))).toBe(false);
  });

  it("overrides a standard component's schema", () => {
    const narrow = standardContract.extend({
      Link: {
        ...standardContract.specs.Link,
        props: z.object({ label: displayText(80), href: z.string().startsWith("https://bank.example/") }),
      },
    });
    expect(valid(narrow, node("Link", { label: "x", href: "https://bank.example/a" }))).toBe(true);
    expect(valid(narrow, node("Link", { label: "x", href: "https://example.com/a" }))).toBe(false);
    expect(narrow.role("Link")).toBe("link");
  });

  it("can set the budget", () => {
    expect(standardContract.extend({}, { maxNodes: 80, maxDepth: 6 }).limits).toEqual({ maxNodes: 80, maxDepth: 6 });
  });

  it("refuses to remove a standard component", () => {
    expect(() => standardContract.extend({ Chart: undefined } as never)).toThrowError(
      expect.objectContaining({ code: "config_invalid", message: expect.stringContaining("Chart") }),
    );
  });

  it.each([
    ["a lower-case name", { timeline: Timeline }],
    ["a name with symbols", { "Time-line": Timeline }],
    ["a name over 32 characters", { ["T" + "x".repeat(32)]: Timeline }],
    ["a missing role", { Timeline: { ...Timeline, role: "" } }],
    ["an event-handler prop", { Timeline: { ...Timeline, props: z.object({ onSelect: z.string() }) } }],
    ["a nested event-handler prop", { Timeline: { ...Timeline, props: z.object({ item: z.object({ onClick: z.string() }).optional() }) } }],
    ["a function prop", { Timeline: { ...Timeline, props: z.object({ format: z.function() }) } }],
  ])("refuses %s", (_name, additions) => {
    expect(() => standardContract.extend(additions as never)).toThrowError(
      expect.objectContaining({ code: "config_invalid" }),
    );
  });
});

/** Every property key reachable through a props schema, through common wrappers. */
function propKeys(schema: unknown): string[] {
  const keys: string[] = [];
  const stack = [schema];
  while (stack.length > 0) {
    const s = stack.pop() as { _def?: Record<string, unknown>; shape?: Record<string, unknown> } | undefined;
    const def = s?._def;
    if (!def) continue;
    if (def.typeName === "ZodObject") {
      const shape = (def.shape as () => Record<string, unknown>)();
      keys.push(...Object.keys(shape));
      stack.push(...Object.values(shape));
    }
    for (const k of ["innerType", "schema", "type"]) if (def[k]) stack.push(def[k]);
  }
  return keys;
}
