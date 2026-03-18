/**
 * Simple metrics collection for FSM monitoring.
 * Collects counters for key operations.
 */

export interface MetricCounter {
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp: number;
}

// In-memory metrics store
const counters = new Map<string, number>();
const labelData = new Map<string, Record<string, string>>();

/**
 * Increment a counter metric
 */
export function incrementCounter(name: string, metricLabels?: Record<string, string>, value = 1): void {
  const key = metricLabels ? `${name}:${JSON.stringify(metricLabels)}` : name;
  const current = counters.get(key) || 0;
  counters.set(key, current + value);
  
  if (metricLabels) {
    labelData.set(key, metricLabels);
  }
}

/**
 * Get current counter value
 */
export function getCounter(name: string, metricLabels?: Record<string, string>): number {
  const key = metricLabels ? `${name}:${JSON.stringify(metricLabels)}` : name;
  return counters.get(key) || 0;
}

/**
 * Get all metrics in Prometheus format
 */
export function getMetrics(): string {
  const lines: string[] = [];
  
  for (const [key, value] of counters) {
    const metricLabels = labelData.get(key);
    if (metricLabels && Object.keys(metricLabels).length > 0) {
      const labelStr = Object.entries(metricLabels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      lines.push(`${key}{${labelStr}} ${value}`);
    } else {
      lines.push(`${key} ${value}`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Get metrics as JSON
 */
export function getMetricsJson(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of counters) {
    result[key] = value;
  }
  return result;
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  counters.clear();
  labelData.clear();
}

// Predefined metric names
export const METRICS = {
  FSM_TRANSITIONS_TOTAL: "fsm_transitions_total",
  LLM_CALLS_TOTAL: "llm_calls_total",
  LLM_FALLBACK_TOTAL: "llm_fallback_total",
  QUOTE_GENERATED_TOTAL: "quote_generated_total",
  QUOTE_ACCEPTED_TOTAL: "quote_accepted_total",
  NEGOTIATION_ATTEMPTS_TOTAL: "negotiation_attempts_total",
  ERRORS_TOTAL: "errors_total",
  WEBHOOK_EVENTS_TOTAL: "webhook_events_total",
} as const;
