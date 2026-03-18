import {
  LEAD_CAPTURE_PROMPT,
  NEGOTIATION_PROMPT,
  PRODUCT_DISCOVERY_PROMPT,
  QUALIFICATION_PROMPT,
} from "../prompts/lead-capture";
import { logger } from "../lib/logger";
import { consumeToken, getRateLimitKey } from "../lib/rate-limiter";
import { validateExtractionResult, hasHallucination } from "../lib/llm-validation";

export type ExtractionSchemaType =
  | "lead_capture"
  | "qualification"
  | "product_discovery"
  | "negotiation";

export interface LLMExtractionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  confidence?: number;
  needsClarification?: boolean;
  clarificationQuestions?: string[];
}

export interface ExtractionRequestContext {
  leadId?: string;
  lineUserId?: string;
  state?: string;
  [key: string]: unknown;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-nano-2026-03-17";
const parsedTimeout = Number.parseInt(process.env.OPENAI_TIMEOUT_MS || "10000", 10);
const OPENAI_TIMEOUT_MS = Number.isFinite(parsedTimeout) ? parsedTimeout : 10000;
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export async function extractIntent(
  message: string,
  schema: ExtractionSchemaType,
  context?: ExtractionRequestContext
): Promise<LLMExtractionResult> {
  const userId = context?.lineUserId || "anonymous";
  const rateLimitKey = getRateLimitKey(userId, schema);
  const rateLimitStatus = consumeToken(rateLimitKey);

  if (!rateLimitStatus.allowed) {
    logger.warn("OpenAI rate limit exceeded, using regex fallback", {
      leadId: context?.leadId,
      userId,
      schema,
      resetAt: rateLimitStatus.resetAt.toISOString(),
    });
    return fallbackExtraction(
      message,
      schema,
      `Rate limit exceeded. Please try again after ${rateLimitStatus.resetAt.toLocaleTimeString()}`
    );
  }

  if (!OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY not configured, using regex fallback", {
      leadId: context?.leadId,
      userId,
      schema,
    });
    return fallbackExtraction(message, schema, "OPENAI_API_KEY is not configured");
  }

  const systemPrompt = getSystemPrompt(schema);
  const userPrompt = buildUserPrompt(message, context);

  try {
    const response = await fetchWithTimeout(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("OpenAI request failed, using fallback", {
        leadId: context?.leadId,
        userId,
        schema,
        status: response.status,
        error: errorText,
      });
      return fallbackExtraction(message, schema, `OpenAI request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const payload = (await response.json()) as OpenAIChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();

    if (!content) {
      logger.warn("Empty response from OpenAI, using fallback", {
        leadId: context?.leadId,
        userId,
        schema,
      });
      return fallbackExtraction(message, schema, "Empty response from OpenAI");
    }

    const parsed = parseJsonObject(content);
    if (!parsed.success) {
      logger.warn("Failed to parse LLM JSON, using fallback", {
        leadId: context?.leadId,
        userId,
        schema,
        error: parsed.error,
      });
      return fallbackExtraction(message, schema, parsed.error);
    }

    // Validate against schema to catch hallucination
    const validation = validateExtractionResult(parsed.data, schema);
    if (hasHallucination(parsed.data, schema)) {
      logger.warn("LLM hallucination detected, using sanitized result", {
        leadId: context?.leadId,
        userId,
        schema,
        errors: validation.errors,
      });
    }

    const normalized = normalizeExtractionResult(validation.sanitized, schema);

    logger.debug("LLM extraction successful", {
      leadId: context?.leadId,
      userId,
      schema,
      confidence: normalized.confidence,
      remaining: rateLimitStatus.remaining,
    });

    return {
      success: true,
      data: normalized.data,
      confidence: normalized.confidence,
      needsClarification: normalized.needsClarification,
      clarificationQuestions: normalized.clarificationQuestions,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown LLM error";
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn("OpenAI request timeout, using fallback", {
        leadId: context?.leadId,
        userId,
        schema,
        timeout: OPENAI_TIMEOUT_MS,
      });
    } else {
      logger.error("LLM extraction error, using fallback", {
        leadId: context?.leadId,
        userId,
        schema,
      }, error instanceof Error ? error : undefined);
    }
    return fallbackExtraction(message, schema, errorMsg);
  }
}

export function extractWithRegex(
  message: string,
  schema?: ExtractionSchemaType
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const normalizedMessage = message.toLowerCase();

  const quantityMatch = normalizedMessage.match(/(\d+(?:\.\d+)?)\s*(kg|g|gram|grams|kilo|kilogram|kilograms)?/i);
  if (quantityMatch) {
    const value = Number.parseFloat(quantityMatch[1]);
    const unit = (quantityMatch[2] || "g").toLowerCase();
    const grams = unit.startsWith("kg") || unit.startsWith("kilo") ? value * 1000 : value;
    data.requestedQuantityGrams = Math.round(grams);
    data.monthlyUsageGrams = Math.round(grams);
  }

  const businessKeywords = ["cafe", "café", "coffee", "restaurant", "shop", "bakery", "ร้าน", "คาเฟ่", "กาแฟ"];
  if (businessKeywords.some((keyword) => normalizedMessage.includes(keyword))) {
    data.isBusinessLead = true;
  }

  if (/\b(next week|this week|tomorrow|today|ทันที|สัปดาห์หน้า|วันนี้|พรุ่งนี้)\b/i.test(message)) {
    data.timeline = message;
  }

  if (/\b(premium|cheap|price|budget|expensive|แพง|ถูก)\b/i.test(message)) {
    data.priceSensitivity = inferPriceSensitivity(message);
  }

  if (schema === "negotiation") {
    const discountMatch = normalizedMessage.match(/(\d+(?:\.\d+)?)\s*%/);
    if (discountMatch) {
      data.requestedDiscountPercentage = Number.parseFloat(discountMatch[1]);
      data.counterOffer = Math.max(0, Math.min(10, Math.round(data.requestedDiscountPercentage as number / 2)));
      data.recommendation = recommendDiscount(data.requestedDiscountPercentage as number);
    }
    if (/ลด|ส่วนลด|discount|cheap|ถูก/i.test(message)) {
      data.reason = message;
    }
  }

  if (schema === "qualification" || schema === "lead_capture") {
    const gradeKeywords: Array<{ grade: "ceremonial" | "premium" | "cafe" | "culinary"; keywords: string[] }> = [
      { grade: "ceremonial", keywords: ["ceremonial", "ceremony", "เกรดพิธี"] },
      { grade: "premium", keywords: ["premium", "พรีเมียม"] },
      { grade: "cafe", keywords: ["cafe", "café", "คาเฟ่"] },
      { grade: "culinary", keywords: ["culinary", "ครัว", "ทำอาหาร"] },
    ];

    const matchedGrades = gradeKeywords
      .filter(({ keywords }) => keywords.some((keyword) => normalizedMessage.includes(keyword)))
      .map(({ grade }) => grade);

    if (matchedGrades.length > 0) {
      data.interestedGrades = matchedGrades;
      data.preferredGrade = matchedGrades[0];
      data.recommendedGrades = matchedGrades;
    }
  }

  return data;
}

function getSystemPrompt(schema: ExtractionSchemaType): string {
  switch (schema) {
    case "lead_capture":
      return LEAD_CAPTURE_PROMPT;
    case "qualification":
      return QUALIFICATION_PROMPT;
    case "product_discovery":
      return PRODUCT_DISCOVERY_PROMPT;
    case "negotiation":
      return NEGOTIATION_PROMPT;
    default:
      return LEAD_CAPTURE_PROMPT;
  }
}

function buildUserPrompt(
  message: string,
  context?: ExtractionRequestContext
): string {
  const parts = [`Message: ${message}`];
  if (context && Object.keys(context).length > 0) {
    parts.push(`Context: ${JSON.stringify(context)}`);
  }
  return parts.join("\n");
}

function normalizeExtractionResult(
  data: Record<string, unknown>,
  schema: ExtractionSchemaType
): {
  data: Record<string, unknown>;
  confidence?: number;
  needsClarification?: boolean;
  clarificationQuestions?: string[];
} {
  const normalized: Record<string, unknown> = { ...data };

  const cafeName = normalized.cafeName ?? normalized["caféName"];
  if (cafeName !== undefined) {
    normalized.cafeName = cafeName;
  }

  if (schema === "negotiation") {
    const requested = toFiniteNumber(
      normalized.requestedDiscountPercentage ?? normalized.requested_discount_percentage
    );
    normalized.requestedDiscountPercentage = clamp(requested ?? 0, 0, 100);
    if (normalized.counterOffer !== undefined || normalized.counter_offer !== undefined) {
      normalized.counterOffer = clamp(
        toFiniteNumber(normalized.counterOffer ?? normalized.counter_offer) ?? 0,
        0,
        100
      );
    }
    if (!normalized.recommendation && !normalized.recommend) {
      normalized.recommendation = recommendDiscount(normalized.requestedDiscountPercentage as number);
    }
    if (normalized.recommendation === undefined && normalized.recommend !== undefined) {
      normalized.recommendation = normalized.recommend;
    }
    if (normalized.reason === undefined && normalized.negotiationReason !== undefined) {
      normalized.reason = normalized.negotiationReason;
    }
  }

  if (schema === "lead_capture" || schema === "qualification") {
    const quantity = toFiniteNumber(
      normalized.requestedQuantityGrams ?? normalized.requested_quantity_grams
    );
    if (quantity !== undefined) {
      normalized.requestedQuantityGrams = Math.max(0, Math.round(quantity));
    }
    const monthlyUsage = toFiniteNumber(normalized.monthlyUsageGrams ?? normalized.monthly_usage_grams);
    if (monthlyUsage !== undefined) {
      normalized.monthlyUsageGrams = Math.max(0, Math.round(monthlyUsage));
    }
    if (normalized.priceSensitivity === undefined && normalized.price_sensitivity !== undefined) {
      normalized.priceSensitivity = normalized.price_sensitivity;
    }
    if (normalized.interestedGrades === undefined && normalized.interested_grades !== undefined) {
      normalized.interestedGrades = normalizeGradeList(normalized.interested_grades);
    }
    if (normalized.recommendedGrades === undefined && normalized.recommended_grades !== undefined) {
      normalized.recommendedGrades = normalizeGradeList(normalized.recommended_grades);
    }
    if (normalized.preferredGrade === undefined && normalized.preferred_grade !== undefined) {
      normalized.preferredGrade = normalized.preferred_grade;
    }
    if (normalized.needsClarification === undefined && normalized.needs_clarification !== undefined) {
      normalized.needsClarification = Boolean(normalized.needs_clarification);
    }
    if (
      normalized.clarificationQuestions === undefined &&
      normalized.clarification_questions !== undefined &&
      Array.isArray(normalized.clarification_questions)
    ) {
      normalized.clarificationQuestions = normalized.clarification_questions;
    }
  }

  return {
    data: normalized,
    confidence: toFiniteNumber(normalized.confidence ?? normalized.confidence_score) ?? 0.75,
    needsClarification: Boolean(
      normalized.needsClarification ?? normalized.needs_clarification
    ),
    clarificationQuestions: Array.isArray(normalized.clarificationQuestions)
      ? normalized.clarificationQuestions
          .filter((question): question is string => typeof question === "string")
          .map((question) => question.trim())
          .filter(Boolean)
      : undefined,
  };
}

function fallbackExtraction(
  message: string,
  schema: ExtractionSchemaType,
  error: string | undefined
): LLMExtractionResult {
  const fallbackData = extractWithRegex(message, schema);

  if (Object.keys(fallbackData).length > 0) {
    const normalized = normalizeExtractionResult(fallbackData, schema);
    return {
      success: true,
      data: normalized.data,
      confidence: Math.min(normalized.confidence ?? 0.35, 0.5),
      needsClarification: normalized.needsClarification,
      clarificationQuestions: normalized.clarificationQuestions,
    };
  }

  return {
    success: false,
    error,
  };
}

function normalizeGradeList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const grades = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return grades.length > 0 ? grades : undefined;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }

  return undefined;
}

function parseJsonObject(content: string): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const trimmed = stripCodeFences(content).trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  const candidate = firstBrace >= 0 && lastBrace >= firstBrace
    ? trimmed.slice(firstBrace, lastBrace + 1)
    : trimmed;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { success: false, error: "LLM response was not a JSON object" };
    }
    return { success: true, data: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse LLM JSON response: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

function stripCodeFences(content: string): string {
  return content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function recommendDiscount(requestedDiscountPercentage: number): string {
  if (requestedDiscountPercentage <= 10) {
    return "accept";
  }
  if (requestedDiscountPercentage <= 20) {
    return "review";
  }
  return "escalate";
}

function inferPriceSensitivity(message: string): "low" | "medium" | "high" {
  const normalized = message.toLowerCase();
  if (normalized.includes("cheap") || normalized.includes("budget") || normalized.includes("ถูก")) {
    return "high";
  }
  if (normalized.includes("premium") || normalized.includes("expensive") || normalized.includes("แพง")) {
    return "low";
  }
  return "medium";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number = OPENAI_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}
