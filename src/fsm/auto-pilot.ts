/**
 * Auto-pilot rules for FSM state transitions.
 * Handles simple transitions automatically (e.g., empty message → prompt for input).
 */

import type { LeadState } from "../types/lead";
import { logger } from "../lib/logger";

export interface AutoPilotRule {
  fromState: LeadState;
  condition: (message: string, context: AutoPilotContext) => boolean;
  action: "prompt" | "transition" | "escalate";
  targetState?: LeadState;
  replyMessage: string;
}

export interface AutoPilotContext {
  userId: string;
  leadId?: string;
  messageCount?: number;
  lastMessageAt?: Date;
}

export interface AutoPilotResult {
  handled: boolean;
  newState?: LeadState;
  replyMessage?: string;
  action?: "prompt" | "transition" | "escalate";
}

/**
 * Escape hatch keyword - user can type this to escalate to human
 */
const HUMAN_KEYWORDS = [
  "speak to human",
  "speaktohuman",
  "human",
  "agent",
  "ติดต่อเจ้าหน้าที่",
  "เจ้าหน้าที่",
  "คุยกับคน",
];

/**
 * Check if user wants to speak to a human (escape hatch)
 */
function wantsHuman(message: string): boolean {
  const normalized = message.toLowerCase().trim();
  return HUMAN_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Check if message is essentially empty (just whitespace or minimal)
 */
function isEmptyMessage(message: string): boolean {
  return message.trim().length === 0;
}

/**
 * Check if message is just a greeting without substance
 */
function isGreetingOnly(message: string): boolean {
  const greetings = ["hi", "hello", "hey", "สวัสดี", "หวัดดี", "ดี"];
  const normalized = message.toLowerCase().trim();
  return greetings.includes(normalized);
}

/**
 * Auto-pilot rules for automatic state handling
 */
export const AUTO_PILOT_RULES: AutoPilotRule[] = [
  // Escape hatch: speak to human
  {
    fromState: "LEAD_CAPTURE",
    condition: (msg) => wantsHuman(msg),
    action: "escalate",
    targetState: "ESCALATION",
    replyMessage:
      "เข้าใจครับ เดี๋ยวจะให้เจ้าหน้าที่ติดต่อกลับเร็ว ๆ นี้ครับ",
  },
  {
    fromState: "QUALIFY_BULK_INTENT",
    condition: (msg) => wantsHuman(msg),
    action: "escalate",
    targetState: "ESCALATION",
    replyMessage:
      "เข้าใจครับ เดี๋ยวจะให้เจ้าหน้าที่ติดต่อกลับเร็ว ๆ นี้ครับ",
  },
  {
    fromState: "PRODUCT_DISCOVERY",
    condition: (msg) => wantsHuman(msg),
    action: "escalate",
    targetState: "ESCALATION",
    replyMessage:
      "เข้าใจครับ เดี๋ยวจะให้เจ้าหน้าที่ติดต่อกลับเร็ว ๆ นี้ครับ",
  },
  {
    fromState: "QUOTE_GENERATION",
    condition: (msg) => wantsHuman(msg),
    action: "escalate",
    targetState: "ESCALATION",
    replyMessage:
      "เข้าใจครับ เดี๋ยวจะให้เจ้าหน้าที่ติดต่อกลับเร็ว ๆ นี้ครับ",
  },
  {
    fromState: "NEGOTIATION",
    condition: (msg) => wantsHuman(msg),
    action: "escalate",
    targetState: "ESCALATION",
    replyMessage:
      "เข้าใจครับ เดี๋ยวจะให้เจ้าหน้าที่ติดต่อกลับเร็ว ๆ นี้ครับ",
  },

  // Empty message handling
  {
    fromState: "LEAD_CAPTURE",
    condition: (msg) => isEmptyMessage(msg),
    action: "prompt",
    replyMessage:
      "สวัสดีครับ ยินดีต้อนรับสู่ Onecha กรุณาบอกชื่อร้านและที่อยู่เพื่อให้เราสามารถให้ข้อมูลได้ถูกต้องครับ",
  },
  {
    fromState: "QUALIFY_BULK_INTENT",
    condition: (msg) => isEmptyMessage(msg),
    action: "prompt",
    replyMessage:
      "รบกวนบอกปริมาณการใช้มัทฉะต่อเดือน (เป็นกรัม) เพื่อให้เราแนะนำราคาที่เหมาะสมครับ",
  },
  {
    fromState: "PRODUCT_DISCOVERY",
    condition: (msg) => isEmptyMessage(msg),
    action: "prompt",
    replyMessage:
      "รบกวนบอกเกรดมัทฉะที่สนใจ (เซอรีเมอเนียล/พรีเมียม/คาเฟ่/คิวลินารี) หรือบอกว่าใช้ทำอะไรครับ",
  },

  // Greeting only - prompt for actual info
  {
    fromState: "LEAD_CAPTURE",
    condition: (msg) => isGreetingOnly(msg),
    action: "prompt",
    replyMessage:
      "สวัสดีครับ กรุณาบอกชื่อร้านและที่อยู่ให้เราทราบด้วยครับ",
  },
];

/**
 * Apply auto-pilot rules to determine if message should be handled automatically
 */
export function applyAutoPilot(
  state: LeadState,
  message: string,
  context: AutoPilotContext
): AutoPilotResult {
  const rules = AUTO_PILOT_RULES.filter((rule) => rule.fromState === state);

  for (const rule of rules) {
    if (rule.condition(message, context)) {
      logger.info("Auto-pilot rule triggered", {
        leadId: context.leadId,
        userId: context.userId,
        state,
        action: rule.action,
        targetState: rule.targetState,
      });

      return {
        handled: true,
        newState: rule.targetState,
        replyMessage: rule.replyMessage,
        action: rule.action,
      };
    }
  }

  return { handled: false };
}
