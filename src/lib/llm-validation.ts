/**
 * JSON schema validation for LLM extraction results.
 * Prevents hallucination by validating required fields.
 */

import type { ExtractionSchemaType } from "../services/llm";

export interface ValidationRule {
  field: string;
  type: "string" | "number" | "boolean" | "array";
  required?: boolean;
  allowedValues?: unknown[];
  min?: number;
  max?: number;
}

export interface SchemaValidation {
  rules: ValidationRule[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitized: Record<string, unknown>;
}

/**
 * Schema definitions for each extraction type
 */
const SCHEMA_DEFINITIONS: Record<ExtractionSchemaType, SchemaValidation> = {
  lead_capture: {
    rules: [
      { field: "cafeName", type: "string", required: false },
      { field: "location", type: "string", required: false },
      { field: "monthlyUsageGrams", type: "number", required: false, min: 0, max: 1000000 },
      { field: "priceSensitivity", type: "string", required: false, allowedValues: ["low", "medium", "high"] },
      { field: "timeline", type: "string", required: false },
      { field: "needsClarification", type: "boolean", required: false },
      { field: "clarificationQuestions", type: "array", required: false },
      { field: "confidence", type: "number", required: false, min: 0, max: 1 },
    ],
  },
  qualification: {
    rules: [
      { field: "cafeName", type: "string", required: false },
      { field: "location", type: "string", required: false },
      { field: "monthlyUsageGrams", type: "number", required: false, min: 0, max: 1000000 },
      { field: "priceSensitivity", type: "string", required: false, allowedValues: ["low", "medium", "high"] },
      { field: "timeline", type: "string", required: false },
      { field: "interestedGrades", type: "array", required: false },
      { field: "needsClarification", type: "boolean", required: false },
      { field: "clarificationQuestions", type: "array", required: false },
      { field: "confidence", type: "number", required: false, min: 0, max: 1 },
    ],
  },
  product_discovery: {
    rules: [
      { field: "interestedGrades", type: "array", required: false },
      { field: "preferredGrade", type: "string", required: false },
      { field: "requestedQuantityGrams", type: "number", required: false, min: 0, max: 1000000 },
      { field: "needsClarification", type: "boolean", required: false },
      { field: "clarificationQuestions", type: "array", required: false },
      { field: "confidence", type: "number", required: false, min: 0, max: 1 },
    ],
  },
  negotiation: {
    rules: [
      { field: "requestedDiscountPercentage", type: "number", required: false, min: 0, max: 100 },
      { field: "counterOffer", type: "number", required: false, min: 0, max: 100 },
      { field: "reason", type: "string", required: false },
      { field: "recommendation", type: "string", required: false, allowedValues: ["accept", "review", "escalate"] },
      { field: "confidence", type: "number", required: false, min: 0, max: 1 },
    ],
  },
};

/**
 * Validate a value against a rule
 */
function validateValue(value: unknown, rule: ValidationRule): string | null {
  if (value === undefined || value === null) {
    if (rule.required) {
      return `Required field "${rule.field}" is missing`;
    }
    return null;
  }

  // Type validation
  switch (rule.type) {
    case "string":
      if (typeof value !== "string") {
        return `Field "${rule.field}" must be a string, got ${typeof value}`;
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `Field "${rule.field}" must be a number, got ${typeof value}`;
      }
      if (rule.min !== undefined && value < rule.min) {
        return `Field "${rule.field}" must be >= ${rule.min}, got ${value}`;
      }
      if (rule.max !== undefined && value > rule.max) {
        return `Field "${rule.field}" must be <= ${rule.max}, got ${value}`;
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        return `Field "${rule.field}" must be a boolean, got ${typeof value}`;
      }
      break;
    case "array":
      if (!Array.isArray(value)) {
        return `Field "${rule.field}" must be an array, got ${typeof value}`;
      }
      break;
  }

  // Allowed values validation
  if (rule.allowedValues !== undefined && !rule.allowedValues.includes(value)) {
    return `Field "${rule.field}" must be one of [${rule.allowedValues.join(", ")}], got "${value}"`;
  }

  return null;
}

/**
 * Validate LLM extraction result against schema
 */
export function validateExtractionResult(
  data: Record<string, unknown>,
  schema: ExtractionSchemaType
): ValidationResult {
  const validation = SCHEMA_DEFINITIONS[schema];
  if (!validation) {
    return {
      valid: false,
      errors: [`Unknown schema type: ${schema}`],
      sanitized: {},
    };
  }

  const errors: string[] = [];
  const sanitized: Record<string, unknown> = {};

  for (const rule of validation.rules) {
    const value = data[rule.field];
    const error = validateValue(value, rule);

    if (error) {
      errors.push(error);
    } else if (value !== undefined && value !== null) {
      // Only include valid, non-null values in sanitized output
      sanitized[rule.field] = value;
    }
  }

  // Remove hallucinated fields not in schema
  for (const key of Object.keys(data)) {
    if (!validation.rules.some((rule) => rule.field === key)) {
      errors.push(`Unexpected field "${key}" removed (possible hallucination)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Check if result has hallucination (unexpected fields)
 */
export function hasHallucination(
  data: Record<string, unknown>,
  schema: ExtractionSchemaType
): boolean {
  const validation = SCHEMA_DEFINITIONS[schema];
  if (!validation) return true;

  const allowedFields = new Set(validation.rules.map((r) => r.field));
  return Object.keys(data).some((key) => !allowedFields.has(key));
}
