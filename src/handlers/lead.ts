import type { LeadDocument, LeadState, CoffeeGrade } from "../types/lead";
import { leadService } from "../services/lead";
import { extractIntent, extractWithRegex } from "../services/llm";

export interface LeadHandlerResult {
  success: boolean;
  replyMessage?: string;
  newState?: LeadState;
  error?: string;
}

const MINIMUM_BULK_ORDER_GRAMS = 500;

export async function handleLeadMessage(
  lead: LeadDocument,
  message: string
): Promise<LeadHandlerResult> {
  try {
    const schemaType =
      lead.state === "QUALIFY_BULK_INTENT" ? "qualification" : "lead_capture";
    const extraction = await extractIntent(message, schemaType, { state: lead.state });

    const extractedData = extraction.success
      ? extraction.data ?? {}
      : { ...extractWithRegex(message) };

    if (isSpamLead(message, extractedData)) {
      await transitionLead(lead, "FAILED", {
        escalatedReason: "spam-detected",
      });

      return {
        success: true,
        newState: "FAILED",
        replyMessage: "ขออภัยครับ เราไม่สามารถดำเนินการต่อกับข้อความนี้ได้",
      };
    }

    if (extraction.success && extraction.needsClarification) {
      if (lead.state === "LEAD_CAPTURE") {
        await transitionLead(lead, "QUALIFY_BULK_INTENT");
      }

      return {
        success: true,
        newState: lead.state === "LEAD_CAPTURE" ? "QUALIFY_BULK_INTENT" : lead.state,
        replyMessage: buildClarificationReply(extraction.clarificationQuestions),
      };
    }

    await persistLeadDetails(lead.lineUserId, extractedData);

    const quantity = getRequestedQuantity(extractedData, lead);

    if (lead.state === "PRODUCT_DISCOVERY") {
      if (quantity >= MINIMUM_BULK_ORDER_GRAMS || hasEnoughContext(extractedData, lead)) {
        await transitionLead(lead, "QUOTE_GENERATION");
        return {
          success: true,
          newState: "QUOTE_GENERATION",
          replyMessage: "กำลังจัดเตรียมใบเสนอราคาให้ครับ",
        };
      }

      return {
        success: true,
        replyMessage: buildProductDiscoveryReply(lead),
      };
    }

    if (lead.state === "LEAD_CAPTURE" && quantity > 0 && quantity < MINIMUM_BULK_ORDER_GRAMS) {
      await transitionLead(lead, "QUALIFY_BULK_INTENT");
      return {
        success: true,
        newState: "QUALIFY_BULK_INTENT",
        replyMessage:
          "ขอบคุณครับ ขอถามเพิ่มอีกนิด: ปริมาณขั้นต่ำที่ต้องการ และร้าน/สาขาอยู่ที่ไหนครับ",
      };
    }

    if (quantity >= MINIMUM_BULK_ORDER_GRAMS) {
      await transitionLead(lead, "PRODUCT_DISCOVERY", {
        requestedQuantityGrams: quantity,
      });

      return {
        success: true,
        newState: "PRODUCT_DISCOVERY",
        replyMessage: buildProductDiscoveryReply(lead, quantity),
      };
    }

    if (lead.state === "QUALIFY_BULK_INTENT") {
      return {
        success: true,
        replyMessage:
          "เพื่อเสนอราคาสำหรับ bulk order ขอปริมาณสั่งซื้อขั้นต่ำ 500g และชื่อร้าน/ที่ตั้งด้วยครับ",
      };
    }

    if (lead.state === "LEAD_CAPTURE") {
      await transitionLead(lead, "QUALIFY_BULK_INTENT");
      return {
        success: true,
        newState: "QUALIFY_BULK_INTENT",
        replyMessage:
          "ขอข้อมูลเพิ่มอีกนิดครับ: ชื่อร้าน/ที่ตั้ง และปริมาณสั่งซื้อขั้นต่ำ 500g",
      };
    }

    return {
      success: true,
      replyMessage:
        "ขอข้อมูลเพิ่มนิดครับ เช่น จำนวนมัทฉะที่ต้องการต่อเดือน หรือปริมาณสั่งซื้อขั้นต่ำ 500g",
    };
  } catch (error) {
    console.error("Lead handler error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown lead handler error",
      replyMessage: "ขออภัย เกิดข้อผิดพลาดชั่วคราว",
    };
  }
}

async function persistLeadDetails(
  lineUserId: string,
  extractedData: Record<string, unknown>
): Promise<void> {
  const update: Partial<LeadDocument> = {};

  const cafeName = getString(extractedData, ["cafeName", "caféName"]);
  if (cafeName) update.cafeName = cafeName;

  const location = getString(extractedData, ["location"]);
  if (location) update.location = location;

  const timeline = getString(extractedData, ["timeline"]);
  if (timeline) update.timeline = timeline;

  const priceSensitivity = getString(extractedData, ["priceSensitivity"]);
  if (priceSensitivity === "low" || priceSensitivity === "medium" || priceSensitivity === "high") {
    update.priceSensitivity = priceSensitivity;
  }

  const monthlyUsageGrams = getNumber(extractedData, ["monthlyUsageGrams"]);
  if (monthlyUsageGrams > 0) update.monthlyUsageGrams = monthlyUsageGrams;

  const requestedQuantityGrams = getNumber(extractedData, ["requestedQuantityGrams", "specificQuantityGrams"]);
  if (requestedQuantityGrams > 0) update.requestedQuantityGrams = requestedQuantityGrams;

  const interestedGrades = getGrades(extractedData);
  if (interestedGrades.length > 0) update.interestedGrades = interestedGrades;

  if (Object.keys(update).length > 0) {
    await leadService.updateLead(lineUserId, update);
  }
}

async function transitionLead(
  lead: LeadDocument,
  toState: LeadState,
  extraData: Partial<LeadDocument> = {}
): Promise<void> {
  await leadService.transitionLead(lead.lineUserId, lead.state, toState);
  if (Object.keys(extraData).length > 0) {
    await leadService.updateLead(lead.lineUserId, extraData);
  }
}

function getRequestedQuantity(
  extractedData: Record<string, unknown>,
  lead: LeadDocument
): number {
  return (
    getNumber(extractedData, ["requestedQuantityGrams", "specificQuantityGrams"]) ||
    lead.requestedQuantityGrams ||
    lead.monthlyUsageGrams ||
    0
  );
}

function hasEnoughContext(
  extractedData: Record<string, unknown>,
  lead: LeadDocument
): boolean {
  return Boolean(
    getString(extractedData, ["cafeName", "caféName"]) ||
      lead.cafeName ||
      getString(extractedData, ["location"]) ||
      lead.location
  );
}

function buildClarificationReply(questions?: string[]): string {
  if (!questions || questions.length === 0) {
    return "ขอข้อมูลเพิ่มอีกนิดครับ เช่น ชื่อร้าน ที่ตั้ง และปริมาณที่ต้องการ";
  }

  return `ขอข้อมูลเพิ่มอีกนิดครับ:\n${questions.map((question) => `- ${question}`).join("\n")}`;
}

function buildProductDiscoveryReply(lead: LeadDocument, quantity?: number): string {
  const usedQuantity = quantity || lead.requestedQuantityGrams || lead.monthlyUsageGrams || MINIMUM_BULK_ORDER_GRAMS;
  const recommendedGrade = usedQuantity >= 1000 ? "พรีเมียม" : "คาเฟ่";

  return `ขอบคุณครับ! ปริมาณที่สอดคล้องกับการสั่งแบบ bulk แล้ว\n\nเราขอแนะนำมัทฉะเกรด${recommendedGrade} เหมาะกับการใช้งานประมาณ ${usedQuantity}g`;
}

function isSpamLead(message: string, extractedData: Record<string, unknown>): boolean {
  if (Boolean(extractedData.isSpam)) {
    return true;
  }

  const normalized = message.toLowerCase();
  return ["crypto", "investment", "lottery", "prize", "winner"].some((keyword) =>
    normalized.includes(keyword)
  );
}

function getString(
  data: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function getNumber(
  data: Record<string, unknown>,
  keys: string[]
): number {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function getGrades(data: Record<string, unknown>): CoffeeGrade[] {
  const rawGrades =
    data.interestedGrades ||
    data.grades ||
    data.preferredGrade ||
    data.preferredGrades;

  if (Array.isArray(rawGrades)) {
    return rawGrades.filter(isCoffeeGrade);
  }

  if (typeof rawGrades === "string" && isCoffeeGrade(rawGrades)) {
    return [rawGrades];
  }

  return [];
}

function isCoffeeGrade(value: unknown): value is CoffeeGrade {
  return value === "ceremonial" || value === "premium" || value === "cafe" || value === "culinary";
}
