/**
 * The outermost kit element: what the document drew. A contender may wrap it
 * in elements of its own (OpenUI's renderer adds a `<div aria-busy>`); those
 * are the contender's, not the document's, and are left out of the
 * comparison.
 */
export function componentRoot(host: HTMLElement): Element | null {
  const theme = host.querySelector(".gen-theme");
  if (!theme) return null;
  const walk = document.createTreeWalker(theme, NodeFilter.SHOW_ELEMENT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if ([...(n as Element).classList].some((c) => c.startsWith("gen-"))) return n as Element;
  }
  return null;
}
