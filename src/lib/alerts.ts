/**
 * Alerting system for FSM health monitoring.
 * Logs alerts when thresholds are breached.
 */

import { logger } from "./logger";
import { getCounter, incrementCounter } from "./metrics";

export interface AlertThreshold {
  metric: string;
  threshold: number;
  windowMinutes: number;
  severity: "warning" | "critical";
}

// Alert history to prevent spam
const alertHistory = new Map<string, number>();
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Default thresholds
const DEFAULT_THRESHOLDS: AlertThreshold[] = [
  { metric: "errors_total", threshold: 5, windowMinutes: 1, severity: "critical" },
  { metric: "llm_fallback_rate", threshold: 0.5, windowMinutes: 5, severity: "warning" },
];

/**
 * Check if we should fire an alert
 */
export function checkAlert(threshold: AlertThreshold): boolean {
  const currentValue = getCounter(threshold.metric);
  
  if (currentValue >= threshold.threshold) {
    const alertKey = `${threshold.metric}:${threshold.threshold}`;
    const lastAlert = alertHistory.get(alertKey);
    const now = Date.now();
    
    // Check cooldown
    if (!lastAlert || now - lastAlert > ALERT_COOLDOWN_MS) {
      alertHistory.set(alertKey, now);
      return true;
    }
  }
  
  return false;
}

/**
 * Fire an alert
 */
export function fireAlert(threshold: AlertThreshold, currentValue: number): void {
  const message = `ALERT [${threshold.severity.toUpperCase()}]: ${threshold.metric} = ${currentValue} (threshold: ${threshold.threshold})`;
  
  if (threshold.severity === "critical") {
    logger.error(message, {
      metric: threshold.metric,
      currentValue,
      threshold: threshold.threshold,
      windowMinutes: threshold.windowMinutes,
    });
  } else {
    logger.warn(message, {
      metric: threshold.metric,
      currentValue,
      threshold: threshold.threshold,
      windowMinutes: threshold.windowMinutes,
    });
  }
}

/**
 * Check all thresholds and fire alerts
 */
export function checkAllAlerts(): void {
  for (const threshold of DEFAULT_THRESHOLDS) {
    if (checkAlert(threshold)) {
      const currentValue = getCounter(threshold.metric);
      fireAlert(threshold, currentValue);
    }
  }
}

/**
 * Record error and check if alert should fire
 */
export function recordError(errorType: string): void {
  incrementCounter("errors_total", { type: errorType });
  
  // Check if we should fire immediate alert
  const errorCount = getCounter("errors_total");
  if (errorCount >= 5) {
    const threshold: AlertThreshold = {
      metric: "errors_total",
      threshold: 5,
      windowMinutes: 1,
      severity: "critical",
    };
    
    if (checkAlert(threshold)) {
      fireAlert(threshold, errorCount);
    }
  }
}

/**
 * Calculate and record LLM fallback rate
 */
export function recordLlmFallback(): void {
  incrementCounter("llm_fallback_total");
  
  const total = getCounter("llm_calls_total");
  const fallback = getCounter("llm_fallback_total");
  
  if (total > 0) {
    const rate = fallback / total;
    
    if (rate >= 0.5) {
      const threshold: AlertThreshold = {
        metric: "llm_fallback_rate",
        threshold: 0.5,
        windowMinutes: 5,
        severity: "warning",
      };
      
      if (checkAlert(threshold)) {
        fireAlert(threshold, rate);
      }
    }
  }
}
