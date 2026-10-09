/**
 * Produces the narrated walkthrough: voice, picture, then the two together.
 *
 *   pnpm demo:narrated                 # from the repository root
 *   DEMO_MODEL=qwen2.5:7b pnpm demo:narrated
 *   pnpm demo:narrated -- --mux-only   # re-lay the audio over the last recording
 *
 * Three steps, each using something that runs on this machine and nowhere else:
 *
 *   1. voice    Piper (MIT) reads `narration.json`, one WAV per clip.
 *   2. picture  Playwright drives the real app against a local model, holding
 *               each scene for the length of its clip and noting when it began.
 *   3. mux      ffmpeg places each clip at its recorded start and writes MP4.
 *
 * The voice is synthesised locally for the same reason the model is: a demo of
 * a project about keeping prompts on the machine should not send its own script
 * to somebody's cloud to be read aloud.
 *
 * One-time setup:
 *   pip install piper-tts
 *   python -m piper.download_voices en_US-ryan-high --data-dir ~/.cache/piper-voices
 * (`PIPER_VOICES` overrides the directory; `PYTHON` the interpreter.)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, "..");
const WORK = join(HERE, ".work");
const AUDIO = join(WORK, "audio");
const OUTPUT = resolve(APP, "../../docs/demo/relax-ui-walkthrough.mp4");
const VOICES = process.env.PIPER_VOICES ?? join(homedir(), ".cache", "piper-voices");
const PYTHON = process.env.PYTHON ?? "python";
const muxOnly = process.argv.includes("--mux-only");

const narration = JSON.parse(readFileSync(join(HERE, "narration.json"), "utf8"));
mkdirSync(AUDIO, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result;
}

/** Length of a PCM WAV, from its header: data bytes over bytes per second. */
function wavDurationMs(file) {
  const buffer = readFileSync(file);
  const byteRate = buffer.readUInt32LE(28);
  const dataAt = buffer.indexOf("data", 12, "ascii");
  const dataBytes = dataAt === -1 ? buffer.length - 44 : buffer.readUInt32LE(dataAt + 4);
  // Piper streams its output, so the header's size can be a placeholder.
  const real = dataBytes > 0 && dataBytes <= buffer.length ? dataBytes : buffer.length - (dataAt + 8);
  return Math.round((real / byteRate) * 1000);
}

// --- 1. voice -------------------------------------------------------------------
function synthesise() {
  if (!existsSync(join(VOICES, `${narration.voice}.onnx`))) {
    throw new Error(
      `Piper voice "${narration.voice}" not found in ${VOICES}.\n` +
        `  pip install piper-tts\n` +
        `  python -m piper.download_voices ${narration.voice} --data-dir "${VOICES}"`,
    );
  }
  const manifest = {};
  for (const clip of narration.clips) {
    // Named by content, so editing one sentence re-reads one clip, not sixteen.
    const hash = createHash("sha1").update(`${narration.voice}\n${clip.say}`).digest("hex").slice(0, 10);
    const file = join(AUDIO, `${clip.id}-${hash}.wav`);
    if (!existsSync(file)) {
      process.stdout.write(`voice    ${clip.id}\n`);
      run(PYTHON, ["-m", "piper", "-m", narration.voice, "--data-dir", VOICES, "-f", file], {
        input: clip.say,
        stdio: ["pipe", "ignore", "inherit"],
      });
    }
    manifest[clip.id] = { file, durationMs: wavDurationMs(file) };
  }
  writeFileSync(join(WORK, "manifest.json"), JSON.stringify(manifest, null, 2));
  const total = Object.values(manifest).reduce((sum, clip) => sum + clip.durationMs, 0);
  console.log(`voice    ${narration.clips.length} clips, ${(total / 60000).toFixed(1)} min of speech`);
  return manifest;
}

// --- 2. picture -----------------------------------------------------------------
function record() {
  run("pnpm", ["exec", "playwright", "test", "-c", "playwright.demo.config.ts"], {
    cwd: APP,
    shell: true,
    env: { ...process.env, DEMO_SPEC: "narrated.spec.ts" },
  });
}

// --- 3. mux ---------------------------------------------------------------------
function mux(manifest) {
  const timeline = JSON.parse(readFileSync(join(WORK, "timeline.json"), "utf8"));
  const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");

  const inputs = ["-i", join(WORK, "picture.webm")];
  const filters = [];
  timeline.forEach((entry, index) => {
    inputs.push("-i", manifest[entry.id].file);
    // `all=1` delays every channel; without it a stereo clip is delayed on one.
    filters.push(`[${index + 1}:a]adelay=${entry.atMs}:all=1[a${index}]`);
  });
  const mixed = timeline.map((_, index) => `[a${index}]`).join("");
  // normalize=0: the clips never overlap, so there is nothing to duck.
  filters.push(`${mixed}amix=inputs=${timeline.length}:normalize=0,aresample=44100[voice]`);

  // End a beat after the last word. The recording's own length includes
  // however long the browser took to close, which is dead air.
  const endMs = Math.max(...timeline.map((entry) => entry.atMs + manifest[entry.id].durationMs)) + 1_200;

  mkdirSync(dirname(OUTPUT), { recursive: true });
  run(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "0:v", "-map", "[voice]",
    // H.264 + AAC in MP4: plays in every browser, GitHub's viewer, and a phone.
    "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-pix_fmt", "yuv420p", "-r", "25",
    "-c:a", "aac", "-b:a", "112k",
    "-t", (endMs / 1000).toFixed(2),
    "-movflags", "+faststart",
    OUTPUT,
  ]);
  if (existsSync(join(WORK, "still.png"))) copyFileSync(join(WORK, "still.png"), OUTPUT.replace(/\.mp4$/, ".png"));
  console.log(`\nSaved ${OUTPUT} (${(statSync(OUTPUT).size / 1048576).toFixed(1)} MB)`);
}

const manifest = synthesise();
if (!muxOnly) record();
mux(manifest);
