import type { GenerationTrace } from "../generate.js";
import type { StructuringStrategyName } from "../types.js";

/**
 * Counters, not traces.
 *
 * An SDK that phones home is a non-starter for the buyer who chose relaxAI to
 * keep data in one jurisdiction, so this collector has no transport at all: it
 * accumulates numbers in memory and hands them to whatever the application
 * already runs. Nothing here can hold a prompt, a completion, or a user
 * identifier, because nothing here accepts a string from the model.
 */
export interface GenerationMetrics {
  generations: number;
  downgrades: Record<string, number>;
  repairs: number;
  strategyUsage: Record<StructuringStrategyName, number>;
}

export function emptyMetrics(): GenerationMetrics {
  return {
    generations: 0,
    downgrades: {},
    repairs: 0,
    strategyUsage: { native_json_schema: 0, tool_call: 0, prompted_json: 0 },
  };
}

export class MetricsCollector {
  private metrics = emptyMetrics();

  /** Pass as `onEvent` to `generateObject` / `streamObject`. */
  readonly handler = (event: GenerationTrace): void => {
    switch (event.type) {
      case "strategy_downgraded": {
        const key = `${event.from}->${event.to}`;
        this.metrics.downgrades[key] = (this.metrics.downgrades[key] ?? 0) + 1;
        return;
      }
      case "repair_attempt":
        this.metrics.repairs += 1;
        return;
      case "validated":
        this.metrics.generations += 1;
        this.metrics.strategyUsage[event.strategy] += 1;
        return;
      default:
        return;
    }
  };

  snapshot(): GenerationMetrics {
    return {
      generations: this.metrics.generations,
      repairs: this.metrics.repairs,
      downgrades: { ...this.metrics.downgrades },
      strategyUsage: { ...this.metrics.strategyUsage },
    };
  }

  reset(): void {
    this.metrics = emptyMetrics();
  }
}
