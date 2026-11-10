import type { GenUIElement, RenderState } from "relax-ui-element";

/** Shows each element's state next to it, from its events alone. */
export function showState(el: GenUIElement): void {
  const output = document.querySelector<HTMLOutputElement>(`output[for="${el.id}"]`);
  el.addEventListener("gen-ui:state", (event) => {
    const state = (event as CustomEvent<RenderState>).detail;
    el.dataset.status = state.status;
    if (!output) return;
    const parts: string[] = [state.status];
    if (state.provider) parts.push(`provider ${state.provider}`);
    if (state.fallbacks.length) parts.push(`base theme for ${state.fallbacks.join(", ")}`);
    if (state.overrides.length) parts.push(`overrides: ${state.overrides.join("; ")}`);
    if (state.error) parts.push(`${state.error.code}: ${state.error.message}`);
    output.value = parts.join(" · ");
  });
}

/** One variant switch for every element on the page: an attribute, no re-render. */
export function variantSwitch(): void {
  const select = document.querySelector<HTMLSelectElement>("#variant");
  select?.addEventListener("change", () => {
    for (const el of document.querySelectorAll("gen-ui")) el.setAttribute("variant", select.value);
  });
}
