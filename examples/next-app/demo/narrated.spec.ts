import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The narrated walkthrough: the picture half.
 *
 * Playwright records video and no audio, so the voice is produced separately
 * and laid over afterwards (`narrate.mjs` runs the three steps in order). What
 * keeps the two in step is that the *narration drives the timing*: each clip
 * was synthesised before this file runs, its length is in `manifest.json`, and
 * `say()` holds the scene for exactly that long while noting when it started.
 * The mux step then places each clip at its recorded start.
 *
 * It is a walkthrough rather than a slideshow on purpose. The app is opened,
 * typed into and clicked like a user would, against a real model, and the
 * narrator explains what is on screen. The few cards are for things there is
 * nothing to point at: why the project exists, and what it does not do yet.
 */

const WORK = resolve(__dirname, ".work");
const SIZE = { width: 1280, height: 720 };
const GENERATION_TIMEOUT = 6 * 60_000;
/** Breathing room after each clip, so sentences do not run into each other. */
const GAP_MS = 450;

interface Card {
  title: string;
  subtitle?: string;
  bullets: string[];
  footer?: string;
}
const narration = JSON.parse(readFileSync(resolve(__dirname, "narration.json"), "utf8")) as {
  clips: { id: string; caption: string }[];
  cards: Record<string, Card>;
};
const manifest = JSON.parse(readFileSync(resolve(WORK, "manifest.json"), "utf8")) as Record<
  string,
  { file: string; durationMs: number }
>;

const timeline: { id: string; atMs: number }[] = [];
let startedAt = 0;

/** Shows the clip's caption, notes when it began, and waits out its length. */
async function say(page: Page, id: string): Promise<void> {
  const clip = narration.clips.find((entry) => entry.id === id);
  const audio = manifest[id];
  if (!clip || !audio) throw new Error(`No narration clip "${id}".`);
  timeline.push({ id, atMs: Math.round(performance.now() - startedAt) });
  await caption(page, clip.caption);
  await page.waitForTimeout(audio.durationMs + GAP_MS);
}

/** Like `say`, but returns at once so something can happen while it plays. */
function sayDuring(page: Page, id: string): Promise<void> {
  return say(page, id);
}

async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate((message) => {
    let bar = document.getElementById("demo-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "demo-caption";
      Object.assign(bar.style, {
        position: "fixed",
        left: "50%",
        bottom: "16px",
        transform: "translateX(-50%)",
        maxWidth: "980px",
        padding: "9px 18px",
        borderRadius: "999px",
        background: "rgba(16, 16, 24, 0.9)",
        color: "#fff",
        font: "500 15px/1.4 ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
        textAlign: "center",
        boxShadow: "0 6px 24px rgba(0, 0, 0, 0.28)",
        zIndex: "10004",
        pointerEvents: "none",
      });
      document.body.appendChild(bar);
    }
    bar.textContent = message;
  }, text);
}

/**
 * A full-screen card, built with DOM calls and `textContent` only — the same
 * rule the app follows for model output applies to this script's own text.
 */
async function showCard(page: Page, card: Card): Promise<void> {
  await page.evaluate((content) => {
    document.getElementById("demo-card")?.remove();
    const root = document.createElement("div");
    root.id = "demo-card";
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      // Above the drawn pointer: there is nothing on a card to point at.
      zIndex: "10003",
      background: "linear-gradient(135deg, #0f1420 0%, #16233b 100%)",
      color: "#f2f4f8",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      padding: "0 110px 60px",
      font: "400 24px/1.5 ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
    });
    const add = (tag: string, text: string, style: Partial<CSSStyleDeclaration>) => {
      const element = document.createElement(tag);
      element.textContent = text;
      Object.assign(element.style, style);
      root.appendChild(element);
      return element;
    };
    add("h1", content.title, { margin: "0", fontSize: content.subtitle ? "64px" : "44px", fontWeight: "650" });
    if (content.subtitle) add("p", content.subtitle, { margin: "10px 0 0", fontSize: "26px", color: "#9fb4d6" });
    const list = add("ul", "", { margin: "34px 0 0", paddingLeft: "0", listStyle: "none" });
    for (const bullet of content.bullets) {
      const item = document.createElement("li");
      item.textContent = bullet;
      Object.assign(item.style, {
        margin: "0 0 16px",
        paddingLeft: "22px",
        borderLeft: "4px solid #3d8fdd",
      });
      list.appendChild(item);
    }
    if (content.footer) {
      add("p", content.footer, {
        margin: "22px 0 0",
        fontSize: "20px",
        color: "#9fb4d6",
        fontFamily: "ui-monospace, Consolas, monospace",
      });
    }
    document.body.appendChild(root);
  }, card);
}

const hideCard = (page: Page) => page.evaluate(() => document.getElementById("demo-card")?.remove());

/** The recorder does not capture the pointer, so the page draws one. */
async function installCursor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const dot = document.createElement("div");
    Object.assign(dot.style, {
      position: "fixed",
      width: "18px",
      height: "18px",
      borderRadius: "50%",
      background: "rgba(61, 143, 221, 0.55)",
      border: "2px solid #fff",
      boxShadow: "0 1px 6px rgba(0,0,0,0.4)",
      transform: "translate(-50%, -50%)",
      left: "640px",
      top: "360px",
      zIndex: "10002",
      pointerEvents: "none",
    });
    document.body.appendChild(dot);
    document.addEventListener("mousemove", (event) => {
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
    });
  });
}

/** Glides the pointer to an element, the way a hand would. */
async function pointAt(page: Page, selector: ReturnType<Page["locator"]>): Promise<void> {
  const box = await selector.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 });
}

async function spotlight(page: Page, testId: string, on: boolean): Promise<void> {
  await page.getByTestId(testId).evaluate((element, lit) => {
    element.style.transition = "box-shadow 250ms";
    element.style.boxShadow = lit ? "0 0 0 4px #3d8fdd" : "";
  }, on);
}

async function waitForResult(page: Page): Promise<void> {
  const footer = page.locator("footer");
  await expect(footer).toContainText(/Structured via|Failed after|ended without/, { timeout: GENERATION_TIMEOUT });
  await expect(footer, "the generation did not produce a validated document").toContainText("Structured via");
}

/**
 * Loads the model before the camera rolls.
 *
 * A cold model takes a minute or more to produce its first token, which on
 * video is a minute of nothing. One throwaway request, abandoned as soon as it
 * starts answering, moves that wait off screen. Abandoning it also cancels the
 * upstream generation, so it is not still running when the real one begins.
 */
async function warmUp(baseURL: string): Promise<void> {
  const controller = new AbortController();
  try {
    const response = await fetch(`${baseURL}/api/ui`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "warm up", audience: "executive" }),
      signal: controller.signal,
    });
    await response.body?.getReader().read();
  } catch {
    // The recording will report a real failure on its own, with more context.
  } finally {
    controller.abort();
  }
  await new Promise((done) => setTimeout(done, 3_000));
}

test("record the narrated walkthrough", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("baseURL is not configured.");
  mkdirSync(WORK, { recursive: true });
  await warmUp(baseURL);

  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: resolve(WORK, "video"), size: SIZE },
    colorScheme: "light",
  });
  const page = await context.newPage();
  startedAt = performance.now();

  // --- why this exists --------------------------------------------------------
  await showCard(page, narration.cards["intro"] as Card);
  await say(page, "intro");
  await showCard(page, narration.cards["problem"] as Card);
  await say(page, "problem");

  // --- open the app, as a user would -------------------------------------------
  const opening = sayDuring(page, "open-app");
  await page.goto(`${baseURL}/?frames=1`);
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();
  await installCursor(page);
  await caption(page, "Opening the reference app");
  await pointAt(page, page.getByLabel("Topic"));
  await page.waitForTimeout(1_800);
  await pointAt(page, page.getByLabel("Audience"));
  await page.waitForTimeout(1_500);
  await pointAt(page, page.getByRole("button", { name: "Generate" }));
  await opening;

  await pointAt(page, page.getByTestId("provider-banner"));
  await spotlight(page, "provider-banner", true);
  await say(page, "banner");
  await spotlight(page, "provider-banner", false);

  await pointAt(page, page.getByTestId("frame-inspector"));
  await spotlight(page, "frame-inspector", true);
  await say(page, "frames-panel");
  await spotlight(page, "frame-inspector", false);

  // --- the first generation ------------------------------------------------------
  await pointAt(page, page.getByRole("button", { name: "Generate" }));
  await say(page, "ask-1");
  await page.getByRole("button", { name: "Generate" }).click();
  await say(page, "streaming");
  await pointAt(page, page.getByTestId("frame-inspector"));
  await say(page, "frames-explained");
  await pointAt(page, page.getByTestId("document"));
  await say(page, "validated");
  await waitForResult(page);
  await page.locator("footer").scrollIntoViewIfNeeded();
  await pointAt(page, page.locator("footer"));
  await say(page, "result-1");
  await page.screenshot({ path: resolve(WORK, "still.png") });

  // --- a different question -------------------------------------------------------
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  const asking = sayDuring(page, "ask-2");
  await page.waitForTimeout(1_600);
  const topic = page.getByLabel("Topic");
  await pointAt(page, topic);
  await topic.fill("");
  await topic.pressSequentially("Kubernetes cluster reliability, last 30 days", { delay: 55 });
  await pointAt(page, page.getByLabel("Audience"));
  await page.getByLabel("Audience").selectOption("engineering");
  await asking;
  await pointAt(page, page.getByRole("button", { name: "Generate" }));
  await page.getByRole("button", { name: "Generate" }).click();
  await say(page, "new-layout");
  await say(page, "ladder");
  await waitForResult(page);
  await page.locator("footer").scrollIntoViewIfNeeded();
  await page.waitForTimeout(2_500);

  // --- what there is nothing to point at -------------------------------------------
  for (const id of ["found", "tradeoffs", "close"]) {
    await showCard(page, narration.cards[id] as Card);
    await say(page, id);
  }
  await page.waitForTimeout(800);
  await hideCard(page);

  const video = page.video();
  await context.close();
  if (!video) throw new Error("Playwright did not record a video.");
  await video.saveAs(resolve(WORK, "picture.webm"));
  writeFileSync(resolve(WORK, "timeline.json"), JSON.stringify(timeline, null, 2));
  console.log(`\nRecorded ${timeline.length} narrated clips over ${Math.round((performance.now() - startedAt) / 1000)}s.`);
});
