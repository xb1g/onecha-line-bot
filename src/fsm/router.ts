import type { LeadDocument, LeadState } from "../types/lead";
import { isTerminalState, FSM_STATES } from "./states";
import { applyAutoPilot } from "./auto-pilot";
import { leadService } from "../services/lead";
import { handleLeadMessage } from "../handlers/lead";
import { handleQuoteMessage } from "../handlers/quote";
import { logger } from "../lib/logger";

export interface FSMRouterResult {
  success: boolean;
  replyMessage?: string;
  newState?: LeadState;
  error?: string;
}

export async function routeMessage(
  lineUserId: string,
  message: string
): Promise<FSMRouterResult> {
  try {
    const lead = await leadService.getOrCreateLead(lineUserId);
    await leadService.updateLead(lineUserId, { lastMessageAt: new Date() });

    if (isTerminalState(lead.state)) {
      return buildTerminalResponse(lead.state);
    }

    const stateDefinition = FSM_STATES[lead.state];
    if (!stateDefinition) {
      logger.error("Unknown lead state in FSM router", {
        userId: lineUserId,
        leadId: lead._id?.toString(),
        state: lead.state,
      });
      return {
        success: false,
        error: `Unknown lead state: ${lead.state}`,
        replyMessage: "ขออภัย ระบบยังไม่รองรับสถานะนี้ครับ",
      };
    }

    // Check auto-pilot rules first
    const autoPilotResult = applyAutoPilot(lead.state, message, {
      userId: lineUserId,
      leadId: lead._id?.toString(),
    });

    if (autoPilotResult.handled) {
      // If auto-pilot suggests a transition, apply it
      if (autoPilotResult.newState && autoPilotResult.action === "escalate") {
        await leadService.transitionLead(lineUserId, lead.state, autoPilotResult.newState);
        await leadService.updateLead(lineUserId, {
          escalatedReason: "auto-pilot-human-request",
          escalatedAt: new Date(),
        });
      }

      return {
        success: true,
        newState: autoPilotResult.newState ?? lead.state,
        replyMessage: autoPilotResult.replyMessage,
      };
    }

    // Continue with normal state handling...

    if (lead.state === "LEAD_CAPTURE" || lead.state === "QUALIFY_BULK_INTENT" || lead.state === "PRODUCT_DISCOVERY") {
      const leadResult = await handleLeadMessage(lead, message);

      if (leadResult.newState !== "QUOTE_GENERATION") {
        return leadResult;
      }

      const refreshedLead = await leadService.getLead(lineUserId);
      if (!refreshedLead) {
        return leadResult;
      }

      const quoteResult = await handleQuoteMessage(refreshedLead, message);
      if (quoteResult.success) {
        return quoteResult;
      }

      return leadResult;
    }

    if (lead.state === "QUOTE_GENERATION" || lead.state === "NEGOTIATION") {
      return await handleQuoteMessage(lead as LeadDocument, message);
    }

    if (lead.state === "ORDER_CONFIRMATION") {
      return {
        success: true,
        newState: "ORDER_CONFIRMATION",
        replyMessage:
          "รับทราบครับ กรุณายืนยันชื่อร้าน ที่อยู่จัดส่ง และเบอร์โทรเพื่อสรุปคำสั่งซื้อครับ",
      };
    }

    if (lead.state === "PAYMENT_PENDING") {
      return {
        success: true,
        newState: "PAYMENT_PENDING",
        replyMessage: "ขอบคุณครับ ตอนนี้รอยืนยันการชำระเงินอยู่ครับ",
      };
    }

    if (lead.state === "ESCALATION") {
      return {
        success: true,
        newState: "ESCALATION",
        replyMessage: "เจ้าหน้าที่ของเราจะติดต่อกลับเร็ว ๆ นี้ครับ",
      };
    }

    if (lead.state === "RETENTION_LOOP") {
      return {
        success: true,
        newState: "RETENTION_LOOP",
        replyMessage: "ขอบคุณที่สนใจครับ ถ้าพร้อมสั่งเมื่อไร ทักมาได้เลย",
      };
    }

    return {
      success: true,
      replyMessage: "รับทราบครับ",
      newState: lead.state,
    };
  } catch (error) {
    console.error("FSM router error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown FSM error",
      replyMessage: "ขออภัย เกิดข้อผิดพลาดชั่วคราว",
    };
  }
}

function buildTerminalResponse(state: LeadState): FSMRouterResult {
  if (state === "FAILED") {
    return {
      success: true,
      newState: "FAILED",
      replyMessage: "ขออภัยครับ เราไม่สามารถดำเนินการต่อกับคำขอนี้ได้",
    };
  }

  return {
    success: true,
    newState: state,
    replyMessage: "รับทราบครับ คำขอนี้ถูกยกเลิกแล้ว",
  };
}
