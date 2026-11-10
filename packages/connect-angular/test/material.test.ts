// @vitest-environment happy-dom
// Just-in-time compilation, as in Angular's own unit tests: the app itself is
// compiled ahead of time and never ships the compiler.
import "@angular/compiler";
import { beforeAll, describe, expect, it } from "vitest";
import { createApplication } from "@angular/platform-browser";
import type { EnvironmentInjector } from "@angular/core";
import { conformance } from "../../element/test/conformance.js";
import { mount, REPORT, until } from "../../element/test/helpers.js";
import { material, MATERIAL_TYPES } from "../../../examples/angular-host/src/connectors/material.js";

/**
 * T-252: the Angular Material sample, through `relax-ui-connect-angular`,
 * passes the same conformance suite as every other connector (T-243), in
 * `light` mode.
 */

let injector: EnvironmentInjector;
beforeAll(async () => {
  injector = (await createApplication({ providers: [] })).injector;
});

conformance("angular-material (Angular)", { connectors: () => [material(injector)], mode: "light", implemented: MATERIAL_TYPES });

describe("Angular Material renders its own components", () => {
  it("mat-card, mat-table and mat-chip, with the renderer's children projected", async () => {
    const el = mount({ mode: "light" }, { connectors: [material(injector)], source: { document: REPORT } });
    await until(() => el.state.status === "complete" && el.querySelector("mat-card") !== null, "render");
    const card = el.querySelector('mat-card[role="region"]')!;
    expect(card.querySelector("mat-card-title")!.textContent).toBe("Regions");
    // Children drawn by the renderer, projected into <ng-content>.
    expect(card.querySelector("mat-card-content gen-children table[mat-table]")).not.toBeNull();
    expect(card.querySelectorAll("tr[mat-row]")).toHaveLength(2);
    expect(el.state.fallbacks.sort()).toEqual(["Heading", "Link", "List", "Stack", "Text"]);
    el.remove();
  });
});
