import { createUIRegistry } from "relax-ui-core";
import { displayText, standardContract, urlString } from "relax-ui-contract";
import { z } from "zod";

/**
 * The component vocabulary this application is willing to let a model assemble.
 *
 * This file is the security boundary and the prompt, at the same time. Adding a
 * component makes it available to the model; removing it makes the model
 * structurally incapable of emitting it. There is no third place to check.
 *
 * It starts from the SDK's twelve standard components and narrows one: links
 * may point only at Civo. `extend` can add components or override a standard
 * one's schema, never remove one, so the base theme can draw everything here.
 *
 * Imported by both the route handler (to build the schema the model is decoded
 * against) and the client renderer (to validate and look up implementations).
 * One declaration, two consumers, no drift.
 */
export const dashboardContract = standardContract.extend(
  {
    Link: {
      ...standardContract.specs.Link,
      description: "A link to a source. The URL must be https and on civo.com.",
      props: z.object({
        label: displayText(80),
        // The URL guard runs at validation time, so a `javascript:` URL fails
        // the schema rather than reaching the DOM and being caught later.
        href: urlString({ schemes: ["https:"], allowedHosts: ["civo.com", "*.civo.com"] }),
      }),
    },
  },
  { maxNodes: 80, maxDepth: 6 },
);

/** The server's view of the same contract: adds the JSON Schema for the model. */
export const dashboardRegistry = createUIRegistry(dashboardContract.specs, dashboardContract.limits);

export const dashboardSchema = dashboardRegistry.structuredSchema(
  "Dashboard",
  "A compact analytics dashboard describing the requested topic.",
);

export type DashboardRegistry = typeof dashboardRegistry;
