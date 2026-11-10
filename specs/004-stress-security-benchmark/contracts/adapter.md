# Contract — Renderer adapter

Every renderer under test, this SDK's and each contender's, is wrapped in one
adapter shape, so that the runner treats them identically (plan D2–D4).

```ts
interface Adapter {
  readonly id: RendererId;                        // data model §7
  readonly packages: Record<string, string>;      // exact versions, recorded with results

  /** Can this renderer express the workload? If not, why (FR-422). */
  supports(workload: Workload): { ok: true } | { ok: false; reason: string };

  /** Encode a step's frames in this renderer's own wire format (D3). */
  encode(frames: readonly Document[]): EncodedStream;

  /** In the page: mount the renderer into `host`, ready for frames. */
  mount(host: HTMLElement, contract: BenchContract): Promise<Mounted>;
}

interface Mounted {
  /** Feed the next encoded frame through the renderer's own entry point. */
  push(chunk: EncodedChunk): void;
  /** The stream is complete. */
  end(): void;
  /** Resolves when the renderer reports the document drawn. */
  done(): Promise<void>;
  /** Tear down; the soak checks this leaves nothing behind. */
  unmount(): void;
}
```

| Adapter | Wire format fed to `push` | Entry point |
|---|---|---|
| `ours-element` | protocol 1 SSE bytes | `<gen-ui>.source = { stream }` |
| `ours-react` | protocol 1 SSE bytes | `useGenerativeObject({ source: { stream } })` + renderer |
| `ours-vue-host`, `ours-angular-host` | protocol 1 SSE bytes | `<gen-ui>` inside the framework app |
| `json-render` | JSONL RFC 6902 lines | `createSpecStreamCompiler` → `<Renderer spec registry>` |
| `a2ui-lit`, `a2ui-react`, `a2ui-angular` | v0.9 messages: `createSurface`, then `updateComponents` per frame | `MessageProcessor.processMessages` → surface |
| `openui` | growing OpenUI Lang text | `<Renderer response library isStreaming>` |
| `ai-sdk` | growing partial-JSON text | `useObject`'s parser → hand-written React components |

**Rules**

- Components in every adapter draw the shared kit's templates, so markup is
  identical. The structural check must pass before timing counts.
- An adapter may not cache across runs, pre-render, or skip validation that
  its renderer performs by default.
- Validation tier for this SDK: `full` for every workload, as for a foreign
  source. That is the strictest and slowest setting, and the fair one.
