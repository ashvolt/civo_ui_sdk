import { list, text, type BaseProps } from "../props.js";
import { h, type VNode } from "../vnode.js";

/**
 * The table is the root, so it carries the role. Cells wrap rather than the
 * table scrolling: eight bounded columns fit, and a block-displayed table loses
 * its semantics in some browsers.
 */
export function Table(p: BaseProps["Table"]): VNode {
  const columns = list<unknown>(p.columns);
  const caption = text(p.caption);
  return h(
    "table",
    { class: "gen-table", role: "table" },
    caption !== undefined && h("caption", {}, caption),
    h("thead", {}, h("tr", {}, ...columns.map((c) => h("th", { scope: "col" }, text(c))))),
    h(
      "tbody",
      {},
      // One cell per column, whatever the row holds: a short row is padded so
      // the grid stays aligned while a document is still streaming.
      ...list<unknown>(p.rows).map((row) => {
        const cells = list<unknown>(row);
        return h("tr", {}, ...columns.map((_, i) => h("td", {}, text(cells[i]) ?? "")));
      }),
    ),
  );
}

export default Table;
