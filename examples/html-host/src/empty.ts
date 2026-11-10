/**
 * The element registered and placed, and never given a document. FR-242: no
 * component implementation, and no validator, may load.
 */
import { defineGenUI } from "relax-ui-element";

defineGenUI();
document.body.dataset.ready = "true";
