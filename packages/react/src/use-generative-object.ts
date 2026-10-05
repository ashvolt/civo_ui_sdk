"use client";

import {
  RelaxUIError,
  UIStreamAccumulator,
  type GenerationMetadata,
  type SchemaLike,
  type StructuringStrategyName,
  type UIStreamEvent,
} from "relax-ui-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { readUIStream } from "./stream.js";

export interface UseGenerativeObjectOptions<T> {
  /** Route that returns the SDK's SSE event stream. Usually a Next.js handler. */
  api: string;
  /**
   * Optional client-side re-validation of the completed object.
   *
   * The server already validated it; running the schema again here is defence
   * in depth for the case where the endpoint is not the one you think it is.
   * It costs a parse and it has caught real misconfigurations.
   */
  schema?: SchemaLike<T>;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  onComplete?: (value: T, metadata: GenerationMetadata) => void;
  onError?: (error: RelaxUIError) => void;
  /**
   * Called with every frame, in order, before it is applied to state.
   *
   * For inspecting the stream — a devtools panel, a frame counter, a test. It
   * is an observer, not a hook into the pipeline: the frame has already been
   * validated server-side and nothing returned from here changes what renders.
   */
  onFrame?: (event: UIStreamEvent<T>) => void;
}

export interface GenerativeObjectState<T> {
  /** The document as of the latest frame. Partial while streaming. */
  object: Partial<T> | undefined;
  /** Set only once the object has passed the full schema. */
  value: T | undefined;
  isStreaming: boolean;
  error: RelaxUIError | undefined;
  metadata: GenerationMetadata | undefined;
  /** Which structuring strategy the server ended up using. */
  strategy: StructuringStrategyName | undefined;
  /**
   * Id of the inference provider serving the generation, from the opening
   * frame. Undefined until then, and for servers that do not report one.
   */
  provider: string | undefined;
}

export interface UseGenerativeObjectResult<T> extends GenerativeObjectState<T> {
  submit: (body: unknown) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

const INITIAL: GenerativeObjectState<never> = {
  object: undefined,
  value: undefined,
  isStreaming: false,
  error: undefined,
  metadata: undefined,
  strategy: undefined,
  provider: undefined,
};

/**
 * Consumes the SDK's UI event stream into React state.
 *
 * The hook is deliberately thin. It does not talk to a model, does not hold an
 * API key, and does not parse model output — by the time bytes reach it they
 * describe a validated object taking shape. Everything that could be attacked
 * happens on the server, where the attacker cannot edit the code.
 *
 * Patches are applied with structural sharing, so components subscribed to an
 * untouched branch of the document keep their referential equality and skip
 * re-rendering while the rest of the tree streams in.
 */
export function useGenerativeObject<T>(
  options: UseGenerativeObjectOptions<T>,
): UseGenerativeObjectResult<T> {
  const [state, setState] = useState<GenerativeObjectState<T>>(INITIAL as GenerativeObjectState<T>);
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
    setState(INITIAL as GenerativeObjectState<T>);
  }, []);

  const submit = useCallback(async (body: unknown) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ ...(INITIAL as GenerativeObjectState<T>), isStreaming: true });

    const accumulator = new UIStreamAccumulator<T>();

    try {
      const response = await fetch(callbacks.current.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...callbacks.current.headers },
        ...(callbacks.current.credentials ? { credentials: callbacks.current.credentials } : {}),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new RelaxUIError({
          code: "http_error",
          message: `Generative UI endpoint returned ${response.status} ${response.statusText}.`,
          status: response.status,
          retryable: response.status >= 500,
        });
      }

      for await (const event of readUIStream<T>(response.body, controller.signal)) {
        callbacks.current.onFrame?.(event);
        accumulator.apply(event);
        applyToState(event, accumulator, setState, callbacks.current);
      }

      setState((previous) => ({ ...previous, isStreaming: false }));
    } catch (cause) {
      if (controller.signal.aborted) {
        setState((previous) => ({ ...previous, isStreaming: false }));
        return;
      }
      const error =
        cause instanceof RelaxUIError
          ? cause
          : new RelaxUIError({
              code: "transport_error",
              message: cause instanceof Error ? cause.message : String(cause),
              retryable: true,
              cause,
            });
      setState((previous) => ({ ...previous, isStreaming: false, error }));
      callbacks.current.onError?.(error);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  return { ...state, submit, stop, reset };
}

function applyToState<T>(
  event: UIStreamEvent<T>,
  accumulator: UIStreamAccumulator<T>,
  setState: React.Dispatch<React.SetStateAction<GenerativeObjectState<T>>>,
  options: UseGenerativeObjectOptions<T>,
): void {
  switch (event.type) {
    case "meta":
      setState((previous) => ({ ...previous, strategy: event.strategy, provider: event.provider }));
      return;

    case "patch":
    case "snapshot":
      setState((previous) => ({
        ...previous,
        object: accumulator.current() as Partial<T> | undefined,
      }));
      return;

    case "complete": {
      let value = event.value;
      if (options.schema) {
        const check = options.schema.safeParse(value as unknown);
        if (!check.success) {
          const error = new RelaxUIError({
            code: "schema_violation",
            message:
              "The completed object failed client-side re-validation. The endpoint is not " +
              "producing the schema this component expects.",
          });
          setState((previous) => ({ ...previous, isStreaming: false, error }));
          options.onError?.(error);
          return;
        }
        value = check.data as T;
      }
      setState((previous) => ({
        ...previous,
        object: value as Partial<T>,
        value,
        metadata: event.metadata,
        isStreaming: false,
      }));
      options.onComplete?.(value, event.metadata);
      return;
    }

    case "error": {
      const error = new RelaxUIError({
        code: (event.error.code as RelaxUIError["code"]) ?? "transport_error",
        message: event.error.message,
        retryable: event.error.retryable,
        ...(event.error.requestId ? { requestId: event.error.requestId } : {}),
        // Carried through so a caller can say *which* field broke. Already
        // redacted to pointers and issue codes upstream.
        ...(event.error.details !== undefined ? { details: event.error.details } : {}),
      });
      setState((previous) => ({ ...previous, isStreaming: false, error }));
      options.onError?.(error);
      return;
    }
  }
}
