/**
 * Structured logging utility for FSM and lead handlers.
 * Includes context like leadId, userId, state for better debugging.
 */

export interface LogContext {
  leadId?: string;
  userId?: string;
  state?: string;
  quoteId?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

function formatLogEntry(entry: LogEntry): string {
  const base = `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`;

  if (entry.context && Object.keys(entry.context).length > 0) {
    const contextStr = Object.entries(entry.context)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return `${base} | ${contextStr}`;
  }

  return base;
}

function createLogEntry(
  level: LogEntry["level"],
  message: string,
  context?: LogContext,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
  };

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    };
  }

  return entry;
}

export const logger = {
  debug: (message: string, context?: LogContext) => {
    if (process.env.NODE_ENV === "development" || process.env.DEBUG) {
      console.debug(formatLogEntry(createLogEntry("debug", message, context)));
    }
  },

  info: (message: string, context?: LogContext) => {
    console.log(formatLogEntry(createLogEntry("info", message, context)));
  },

  warn: (message: string, context?: LogContext, error?: Error) => {
    console.warn(formatLogEntry(createLogEntry("warn", message, context, error)));
  },

  error: (message: string, context?: LogContext, error?: Error) => {
    console.error(formatLogEntry(createLogEntry("error", message, context, error)));
  },
};

/**
 * Helper to create consistent log context for FSM operations
 */
export function createFsmContext(
  leadId: string,
  userId: string,
  state: string,
  extra?: Record<string, unknown>
): LogContext {
  return {
    leadId,
    userId,
    state,
    ...extra,
  };
}
