"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  INITIAL_STATE,
  runGeneration,
  type GenerationOptions,
  type GenerativeObjectState,
} from "./generation.js";

export type { GenerativeObjectState } from "./generation.js";

/** Options for {@link useGenerativeObject}. See {@link GenerationOptions}. */
export type UseGenerativeObjectOptions<T> = GenerationOptions<T>;

export interface UseGenerativeObjectResult<T> extends GenerativeObjectState<T> {
  /**
   * Starts reading the source. `body` is the POST body for a URL source and is
   * ignored by the others. A `stream` can be read once; pass a new one to
   * submit again.
   */
  submit: (body?: unknown) => Promise<void>;
  /** Stops reading. A socket is not closed — it belongs to you. */
  stop: () => void;
  reset: () => void;
}

/**
 * Consumes a generative UI source into React state.
 *
 * The hook is deliberately thin. It does not talk to a model, does not hold an
 * API key, and does not parse model output. Sources other than a same-origin
 * route are validated in full here before anything reaches state
 * (Constitution IV); the rules live in `runGeneration`, testable without React.
 *
 * Patches are applied with structural sharing, so components subscribed to an
 * untouched branch of the document keep their referential equality and skip
 * re-rendering while the rest of the tree streams in.
 */
export function useGenerativeObject<T>(
  options: UseGenerativeObjectOptions<T>,
): UseGenerativeObjectResult<T> {
  const [state, setState] = useState<GenerativeObjectState<T>>(INITIAL_STATE as GenerativeObjectState<T>);
  const abortRef = useRef<AbortController | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;

  // A stream that outlives its component would setState after unmount and, more
  // importantly, keep an inference request running that nobody will read.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((previous) => ({ ...previous, isStreaming: false }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE as GenerativeObjectState<T>);
  }, []);

  const submit = useCallback(async (body?: unknown) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...(INITIAL_STATE as GenerativeObjectState<T>), isStreaming: true });

    try {
      await runGeneration<T>(callbacks.current, body, controller.signal, (patch) => {
        // A stopped or superseded run must not write over what replaced it.
        if (!controller.signal.aborted) {
          setState((previous) => ({ ...previous, ...patch }));
        }
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { ...state, submit, stop, reset };
}
