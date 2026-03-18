import type { LeadState } from "../types/lead";

export const VALID_TRANSITIONS: Record<LeadState, LeadState[]> = {
  LEAD_CAPTURE: ["QUALIFY_BULK_INTENT", "FAILED"],
  QUALIFY_BULK_INTENT: ["PRODUCT_DISCOVERY", "FAILED"],
  PRODUCT_DISCOVERY: ["QUOTE_GENERATION", "FAILED", "RETENTION_LOOP"],
  QUOTE_GENERATION: ["NEGOTIATION", "ORDER_CONFIRMATION", "FAILED"],
  NEGOTIATION: ["ORDER_CONFIRMATION", "ESCALATION", "FAILED"],
  ORDER_CONFIRMATION: ["PAYMENT_PENDING", "CANCELLED", "FAILED"],
  PAYMENT_PENDING: ["ESCALATION", "CANCELLED", "RETENTION_LOOP", "FAILED"],
  ESCALATION: ["ORDER_CONFIRMATION", "CANCELLED", "FAILED"],
  RETENTION_LOOP: ["QUOTE_GENERATION", "CANCELLED", "FAILED"],
  CANCELLED: [],
  FAILED: [],
};

export interface StateDefinition {
  name: LeadState;
  description: string;
  allowedTransitions: LeadState[];
}

export const FSM_STATES: Record<LeadState, StateDefinition> = {
  LEAD_CAPTURE: {
    name: "LEAD_CAPTURE",
    description: "Capture the initial lead details from a LINE message.",
    allowedTransitions: VALID_TRANSITIONS.LEAD_CAPTURE,
  },
  QUALIFY_BULK_INTENT: {
    name: "QUALIFY_BULK_INTENT",
    description: "Qualify whether the user is a bulk-order buyer.",
    allowedTransitions: VALID_TRANSITIONS.QUALIFY_BULK_INTENT,
  },
  PRODUCT_DISCOVERY: {
    name: "PRODUCT_DISCOVERY",
    description: "Recommend matcha grades and shape the quote request.",
    allowedTransitions: VALID_TRANSITIONS.PRODUCT_DISCOVERY,
  },
  QUOTE_GENERATION: {
    name: "QUOTE_GENERATION",
    description: "Generate a priced quote for the lead.",
    allowedTransitions: VALID_TRANSITIONS.QUOTE_GENERATION,
  },
  NEGOTIATION: {
    name: "NEGOTIATION",
    description: "Handle discount negotiation within the allowed rules.",
    allowedTransitions: VALID_TRANSITIONS.NEGOTIATION,
  },
  ORDER_CONFIRMATION: {
    name: "ORDER_CONFIRMATION",
    description: "Collect order confirmation details before payment.",
    allowedTransitions: VALID_TRANSITIONS.ORDER_CONFIRMATION,
  },
  PAYMENT_PENDING: {
    name: "PAYMENT_PENDING",
    description: "Wait for payment verification.",
    allowedTransitions: VALID_TRANSITIONS.PAYMENT_PENDING,
  },
  ESCALATION: {
    name: "ESCALATION",
    description: "Route the lead to a human.",
    allowedTransitions: VALID_TRANSITIONS.ESCALATION,
  },
  RETENTION_LOOP: {
    name: "RETENTION_LOOP",
    description: "Keep the lead warm for a future order.",
    allowedTransitions: VALID_TRANSITIONS.RETENTION_LOOP,
  },
  CANCELLED: {
    name: "CANCELLED",
    description: "The lead is no longer active.",
    allowedTransitions: VALID_TRANSITIONS.CANCELLED,
  },
  FAILED: {
    name: "FAILED",
    description: "The lead was rejected or failed qualification.",
    allowedTransitions: VALID_TRANSITIONS.FAILED,
  },
};

export function isTerminalState(state: LeadState): boolean {
  return state === "CANCELLED" || state === "FAILED";
}

