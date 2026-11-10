/** This SDK's Web Component; see src/adapters/element.ts. */
import { elementAdapter } from "../src/adapters/element.ts";
import { installHarness } from "../src/probe/page.ts";

installHarness(elementAdapter());
