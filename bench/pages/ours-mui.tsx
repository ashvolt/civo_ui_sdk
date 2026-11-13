/**
 * This SDK's element with the MUI sample connector (`relax-ui-connect-react`'s
 * `samples/mui.tsx`): every base type becomes an MUI component, mounted by
 * React in light mode. For the attack suites (T-441, every connector).
 */
import { defineGenUI } from "relax-ui-element";
import { mui } from "../../packages/connect-react/samples/mui.tsx";
import { elementAdapter } from "../src/adapters/element.ts";
import { installKitCss } from "../src/kit/index.ts";
import { installHarness } from "../src/probe/page.ts";

defineGenUI();
// Light mode: the kit's styles go in the page, as a light host's do.
installKitCss();
installHarness(elementAdapter("ours-mui", { mode: "light", connectors: [mui()] }));
