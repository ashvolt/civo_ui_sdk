import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The demo video, as a script.
 *
 * A recording nobody can regenerate goes stale the first time the UI changes,
 * so this one is produced by driving the real reference app: a real request to
 * a real route, answered by an open-weight model on this machine, rendered by
 * the real renderer. Nothing on screen is mocked. The captions are the only
 * thing this file adds to the page.
 *
 * Run it with `pnpm demo:record` (see `playwright.demo.config.ts`).
 */

// Playwright compiles this package's specs as CommonJS, so `__dirname` is the
// directory this file is in.
const OUTPUT = resolve(__dirname, "../../../docs/demo/generative-ui-local-model.webm");
const STILL = OUTPUT.replace(/\.webm$/, ".png");
const SIZE = { width: 1280, height: 720 };
const usingStub = process.env["DEMO_ENDPOINT"] === "stub";

/** How long a generation may take before the recording gives up. */
const GENERATION_TIMEOUT = 6 * 60_000;

/**
 * Shows a caption bar along the bottom of the page.
 *
 * Appended to `<body>` outside React's root, after hydration, so React neither
 * owns it nor removes it. Text is set with `textContent`: this script follows
 * the same rule as the app and puts nothing on the page as markup.
 */
async function caption(page: Page, text: string, holdMs = 0): Promise<void> {
  await page.evaluate((message) => {
    let bar = document.getElementById("demo-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "demo-caption";
      Object.assign(bar.style, {
        position: "fixed",
        left: "50%",
        bottom: "18px",
        transform: "translateX(-50%)",
        maxWidth: "1080px",
        width: "calc(100% - 48px)",
        padding: "12px 18px",
        borderRadius: "10px",
        background: "rgba(16, 16, 24, 0.92)",
        color: "#fff",
        font: "500 17px/1.4 ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
        textAlign: "center",
        boxShadow: "0 6px 24px rgba(0, 0, 0, 0.28)",
        zIndex: "9999",
        pointerEvents: "none",
      });
      document.body.appendChild(bar);
    }
    bar.textContent = message;
  }, text);
  if (holdMs > 0) await page.waitForTimeout(holdMs);
}

/** Draws attention to one element for a moment, then lets go of it. */
async function spotlight(page: Page, testId: string, holdMs: number): Promise<void> {
  const target = page.getByTestId(testId);
  await target.evaluate((element) => {
    element.style.transition = "box-shadow 200ms";
    element.style.boxShadow = "0 0 0 3px #3d8fdd";
  });
  await page.waitForTimeout(holdMs);
  await target.evaluate((element) => {
    element.style.boxShadow = "";
  });
}

async function generate(page: Page, during: string): Promise<{ frames: number; footer: string }> {
  await page.getByRole("button", { name: "Generate" }).click();
  await caption(page, during);

  const footer = page.locator("footer");
  // Either outcome ends the wait. A failed generation is still a true
  // recording of what happened, and the assertion below then fails loudly
  // rather than the script hanging until its timeout.
  await expect(footer).toContainText(/Structured via|Failed after|ended without/, {
    timeout: GENERATION_TIMEOUT,
  });
  await expect(footer, "the generation did not produce a validated document").toContainText("Structured via");

  const frames = Number(await page.getByTestId("frame-count").textContent());
  return { frames, footer: (await footer.textContent())?.trim() ?? "" };
}

test("record the demo", async ({ browser, baseURL }) => {
  mkdirSync(dirname(OUTPUT), { recursive: true });

  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: test.info().outputPath("video"), size: SIZE },
    colorScheme: "light",
  });
  const page = await context.newPage();

  // --- scene 1: what this is ------------------------------------------------
  await page.goto(`${baseURL}/?frames=1`);
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
  await caption(
    page,
    "relax-ui — generative UI. The model chooses the layout; the SDK validates every frame before the browser sees it.",
    5_000,
  );

  // --- scene 2: which endpoint, stated plainly --------------------------------
  await caption(
    page,
    usingStub
      ? "No model on this machine — a local stand-in endpoint is answering. Everything after it is the real pipeline."
      : "No relaxAI account in use. An open-weight model is running locally on Ollama — and the page says so.",
  );
  await spotlight(page, "provider-banner", 5_000);

  // --- scene 3: the first generation -----------------------------------------
  await caption(page, "One prompt. The document must be built from the seven components this app registered.", 3_500);
  const first = await generate(
    page,
    "Right: each row is one SSE frame — meta, then snapshots, then JSON patches. Left: the document they build.",
  );
  await caption(
    page,
    `${first.frames} frames. Constrained decoding on the local runtime; schema-validated on the server at every one.`,
    6_000,
  );
  await caption(page, first.footer, 4_500);
  // A still of the finished first generation, for the README.
  await page.screenshot({ path: STILL });

  // --- scene 4: a different question, a different layout -----------------------
  await page.getByLabel("Topic").fill("Kubernetes cluster reliability, last 30 days");
  await page.getByLabel("Audience").selectOption("engineering");
  await caption(page, "A different question for a different audience. Same route, same schema — a new layout.", 3_500);
  const second = await generate(
    page,
    "Nothing here is a template: the structure is decided per request, and only registered components can appear.",
  );
  await caption(page, `${second.frames} frames this time. ${second.footer}`, 6_000);

  // --- scene 5: the point -----------------------------------------------------
  await caption(
    page,
    "Same engine, validator and wire protocol serve relaxAI in production — the provider is one environment variable.",
    6_000,
  );

  const video = page.video();
  await context.close();
  if (!video) throw new Error("Playwright did not record a video.");
  await video.saveAs(OUTPUT);
  console.log(`\nSaved ${OUTPUT}`);
  console.log(`  generation 1: ${first.frames} frames — ${first.footer}`);
  console.log(`  generation 2: ${second.frames} frames — ${second.footer}`);
});
