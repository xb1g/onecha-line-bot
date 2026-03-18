/**
 * Error classification and rescue for FSM handlers.
 * Provides structured error handling with user-friendly messages.
 */

import { logger } from "./logger";

export interface ErrorContext {
  leadId?: string;
  userId?: string;
  state?: string;
  quoteId?: string;
  operation?: string;
  [key: string]: unknown;
}

export interface RescuedError {
  userMessage: string;
  logLevel: "error" | "warn" | "info";
  retryable: boolean;
}

// Error types and their rescue strategies
const ERROR_RESCUES: Record<string, RescuedError> = {
  // MongoDB errors
  "MongoServerError": {
    userMessage: "ระบบกำลังมีปัญหา กรุณาลองอีกครั้ง",
    logLevel: "error",
    retryable: true,
  },
  "MongoNetworkError": {
    userMessage: "ระบบกำลังเชื่อมต่อ กรุณารอสักครู่",
    logLevel: "error",
    retryable: true,
  },
  
  // State transition errors
  "InvalidStateTransitionError": {
    userMessage: "เกิดข้อผิดพลาดในการเปลี่ยนสถานะ กรุณาลองอีกครั้ง",
    logLevel: "warn",
    retryable: false,
  },
  
  // Record not found
  "RecordNotFound": {
    userMessage: "ไม่พบข้อมูลที่ต้องการ",
    logLevel: "warn",
    retryable: false,
  },
  
  // OpenAI errors
  "RateLimitError": {
    userMessage: "กรุณารอสักครู่ ระบบกำลังทำงานหนัก",
    logLevel: "warn",
    retryable: true,
  },
  
  // LINE API errors
  "LINE_API_429": {
    userMessage: "ระบบกำลังยุ่ง กรุณาลองอีกครั้ง",
    logLevel: "warn",
    retryable: true,
  },
  
  // Quote errors
  "QuoteNotFound": {
    userMessage: "ไม่พบใบเสนอราคา",
    logLevel: "warn",
    retryable: false,
  },
  
  // Order errors
  "OrderNotFound": {
    userMessage: "ไม่พบออเดอร์",
    logLevel: "warn",
    retryable: false,
  },
  
  // Generic
  "Error": {
    userMessage: "ขออภัย เกิดข้อผิดพลาดชั่วคราว",
    logLevel: "error",
    retryable: false,
  },
};

/**
 * Classify an error and return rescue strategy
 */
export function classifyError(error: unknown): RescuedError {
  if (error instanceof Error) {
    // Check for specific error types
    if (error.name === "MongoServerError") {
      // Check for specific MongoDB error codes
      const mongoError = error as { code?: number };
      if (mongoError.code === 11000) {
        return { userMessage: "ข้อมูลซ้ำ กรุณาลองอีกครั้ง", logLevel: "warn", retryable: true };
      }
      return ERROR_RESCUES["MongoServerError"];
    }
    
    if (error.name === "MongoNetworkError") {
      return ERROR_RESCUES["MongoNetworkError"];
    }
    
    if (error.message?.includes("rate limit")) {
      return ERROR_RESCUES["RateLimitError"];
    }
    
    if (error.message?.includes("429")) {
      return ERROR_RESCUES["LINE_API_429"];
    }
    
    if (error.message?.includes("not found")) {
      return ERROR_RESCUES["RecordNotFound"];
    }
    
    if (error.message?.includes("quote")) {
      return ERROR_RESCUES["QuoteNotFound"];
    }
    
    if (error.message?.includes("order")) {
      return ERROR_RESCUES["OrderNotFound"];
    }
    
    if (error.message?.includes("transition")) {
      return ERROR_RESCUES["InvalidStateTransitionError"];
    }
  }
  
  return ERROR_RESCUES["Error"];
}

/**
 * Rescue an error with proper logging and user message
 */
export function rescueError(error: unknown, context: ErrorContext): { userMessage: string; shouldRetry: boolean } {
  const classification = classifyError(error);
  const errorObj = error instanceof Error ? error : new Error(String(error));
  
  // Log with appropriate level
  const logData = {
    ...context,
    errorName: errorObj.name,
    errorMessage: errorObj.message,
  };
  
  switch (classification.logLevel) {
    case "error":
      logger.error("Error rescued", logData, errorObj);
      break;
    case "warn":
      logger.warn("Error rescued", logData);
      break;
    case "info":
      logger.info("Error rescued", logData);
      break;
  }
  
  return {
    userMessage: classification.userMessage,
    shouldRetry: classification.retryable,
  };
}

/**
 * Wrapper for async operations with automatic rescue
 */
export async function withRescue<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  onError?: (message: string) => void
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    const { userMessage, shouldRetry } = rescueError(error, context);
    
    if (onError) {
      onError(userMessage);
    }
    
    // If retryable, could implement retry logic here
    if (shouldRetry) {
      // Retry once after a short delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        return await operation();
      } catch (retryError) {
        const finalRescue = rescueError(retryError, { ...context, retryAttempt: 1 });
        if (onError) {
          onError(finalRescue.userMessage);
        }
      }
    }
    
    return null;
  }
}
