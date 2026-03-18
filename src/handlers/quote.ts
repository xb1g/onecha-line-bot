import { ObjectId } from "mongodb";
import type { LeadDocument, QuoteDocument, LeadState, CoffeeGrade } from "../types/lead";
import { leadService } from "../services/lead";
import { quoteService } from "../services/quote";
import { extractIntent } from "../services/llm";

export interface QuoteHandlerResult {
  success: boolean;
  replyMessage?: string;
  newState?: LeadState;
  error?: string;
}

export async function handleQuoteMessage(
  lead: LeadDocument,
  message: string
): Promise<QuoteHandlerResult> {
  try {
    const leadId = await ensureLeadId(lead);

    if (lead.state === "QUOTE_GENERATION") {
      const quote = await ensureQuote(lead, leadId);
      await leadService.transitionLead(lead.lineUserId, lead.state, "NEGOTIATION");

      return {
        success: true,
        newState: "NEGOTIATION",
        replyMessage: formatQuoteMessage(quote),
      };
    }

    if (lead.state === "NEGOTIATION") {
      const normalizedMessage = message.trim().toLowerCase();

      if (isAcceptanceMessage(normalizedMessage)) {
        await leadService.transitionLead(lead.lineUserId, lead.state, "ORDER_CONFIRMATION");
        return {
          success: true,
          newState: "ORDER_CONFIRMATION",
          replyMessage:
            "ขอบคุณครับ รบกวนยืนยันชื่อร้าน ที่อยู่จัดส่ง และเบอร์โทรสำหรับออกคำสั่งซื้อครับ",
        };
      }

      const extraction = await extractIntent(message, "negotiation", { leadId: leadId.toString() });
      const requestedDiscount = extractRequestedDiscount(extraction.data, message);
      const reason = extractReason(extraction.data, message);
      const quote =
        (await quoteService.getActiveQuoteForLead(leadId)) ?? (await ensureQuote(lead, leadId));

      if (requestedDiscount <= 0) {
        return {
          success: true,
          replyMessage:
            "ถ้าต้องการคุยเรื่องราคา บอกเปอร์เซ็นต์ส่วนลดที่ต้องการได้เลยครับ หรือพิมพ์ \"ตกลง\" เพื่อยืนยันใบเสนอราคา",
        };
      }

      if (requestedDiscount <= 10) {
        const quoteId = requireQuoteId(quote);
        await quoteService.addNegotiation(quoteId, requestedDiscount, requestedDiscount, reason);

        await leadService.transitionLead(lead.lineUserId, lead.state, "ORDER_CONFIRMATION");
        const refreshedQuote = await quoteService.getQuote(quoteId);

        return {
          success: true,
          newState: "ORDER_CONFIRMATION",
          replyMessage:
            `ยินดีด้วยครับ อนุมัติส่วนลด ${requestedDiscount}% แล้ว\n\n${formatQuoteMessage(refreshedQuote ?? quote)}\n\nรบกวนยืนยันชื่อร้าน ที่อยู่จัดส่ง และเบอร์โทรครับ`,
        };
      }

      if (requestedDiscount <= 20) {
        const quoteId = requireQuoteId(quote);
        await quoteService.addNegotiation(quoteId, requestedDiscount, 10, reason);

        return {
          success: true,
          replyMessage:
            "ขอเวลาตรวจสอบกับทีมงานก่อนครับ ถ้าต้องการเร่งได้ พิมพ์รายละเอียดการใช้งานหรือปริมาณเพิ่มเติมมาได้เลย",
        };
      }

      await leadService.transitionLead(lead.lineUserId, lead.state, "ESCALATION");
      await leadService.updateLead(lead.lineUserId, {
        escalatedReason: `requested-discount-${requestedDiscount}`,
        escalatedAt: new Date(),
      });

      return {
        success: true,
        newState: "ESCALATION",
        replyMessage:
          "คำขอส่วนลดระดับนี้ต้องให้ทีมงานดูแลต่อครับ เดี๋ยวมีเจ้าหน้าที่ติดต่อกลับเร็ว ๆ นี้",
      };
    }

    if (lead.state === "ORDER_CONFIRMATION") {
      return {
        success: true,
        replyMessage:
          "รับทราบครับ กรุณาส่งชื่อร้าน ที่อยู่จัดส่ง และเบอร์โทร เพื่อสรุปคำสั่งซื้อครับ",
      };
    }

    if (lead.state === "PAYMENT_PENDING") {
      return {
        success: true,
        replyMessage: "ขอบคุณครับ ตอนนี้รอยืนยันการชำระเงินอยู่ครับ",
      };
    }

    return {
      success: true,
      replyMessage: "รับทราบครับ",
    };
  } catch (error) {
    console.error("Quote handler error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown quote handler error",
      replyMessage: "ขออภัย เกิดข้อผิดพลาดชั่วคราว",
    };
  }
}

async function ensureLeadId(lead: LeadDocument): Promise<ObjectId> {
  if (lead._id) {
    return lead._id;
  }

  const reloaded = await leadService.getLead(lead.lineUserId);
  if (reloaded?._id) {
    return reloaded._id;
  }

  throw new Error("Lead is missing an ObjectId");
}

async function ensureQuote(lead: LeadDocument, leadId: ObjectId): Promise<QuoteDocument> {
  if (lead.activeQuoteId) {
    const existingQuote = await quoteService.getQuote(lead.activeQuoteId);
    if (existingQuote) {
      return existingQuote;
    }
  }

  const quantity = lead.requestedQuantityGrams || lead.monthlyUsageGrams || 500;
  const grade = chooseGrade(lead, quantity);

  const quote = await quoteService.generateQuote(
    leadId,
    lead.lineUserId,
    [
      {
        productId: `matcha-${grade}-${quantity}`,
        productName: `มัทฉะเกรด${gradeThai(grade)} ${quantity}g`,
        grade,
        quantityGrams: quantity,
      },
    ],
    0
  );

  if (quote._id) {
    await leadService.updateLead(lead.lineUserId, { activeQuoteId: quote._id });
  }

  return quote;
}

function requireQuoteId(quote: QuoteDocument): ObjectId {
  if (!quote._id) {
    throw new Error("Quote is missing an ObjectId");
  }

  return quote._id;
}

function chooseGrade(lead: LeadDocument, quantity: number): CoffeeGrade {
  const preferred = lead.interestedGrades?.[0];
  if (preferred) {
    return preferred;
  }

  if (quantity >= 1000) {
    return "premium";
  }

  return "cafe";
}

function gradeThai(grade: CoffeeGrade): string {
  switch (grade) {
    case "ceremonial":
      return "เซอรีเมอเนียล";
    case "premium":
      return "พรีเมียม";
    case "cafe":
      return "คาเฟ่";
    case "culinary":
      return "คิวลินารี";
  }
}

function extractRequestedDiscount(
  data: Record<string, unknown> | undefined,
  message: string
): number {
  const directValue = readNumber(data, ["requestedDiscountPercentage", "requestedDiscount", "discountPercentage"]);
  if (directValue > 0) {
    return directValue;
  }

  const percentMatch = message.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    return Number(percentMatch[1]);
  }

  return 0;
}

function extractReason(
  data: Record<string, unknown> | undefined,
  message: string
): string {
  const reason = readString(data, ["reason"]);
  if (reason) {
    return reason;
  }

  return message.trim();
}

function readNumber(
  data: Record<string, unknown> | undefined,
  keys: string[]
): number {
  if (!data) {
    return 0;
  }

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

function readString(
  data: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!data) {
    return undefined;
  }

  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function isAcceptanceMessage(message: string): boolean {
  return ["ตกลง", "โอเค", "ok", "accept", "confirm", "ยืนยัน"].some((token) =>
    message.includes(token)
  );
}

function formatQuoteMessage(quote: QuoteDocument): string {
  const money = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const items = quote.items
    .map((item) => {
      return `- ${item.productName} ${item.quantityGrams}g: ${money.format(item.subtotal)} บาท`;
    })
    .join("\n");

  const shippingNote = quote.shippingCost === 0
    ? "ค่าส่งฟรี"
    : `ค่าส่ง ${money.format(quote.shippingCost)} บาท`;

  const freeShippingNote = quote.shippingCost === 0 ? "\nได้รับสิทธิ์ค่าส่งฟรีตามยอดสั่ง" : "";

  return [
    "📋 ใบเสนอราคา",
    "",
    items,
    "",
    `ยอดย่อย: ${money.format(quote.subtotal)} บาท`,
    `ส่วนลด: ${quote.discountPercentage}% (-${money.format(quote.discountAmount)} บาท)`,
    shippingNote,
    "─────────────────",
    `รวม: ${money.format(quote.totalAmount)} บาท`,
    freeShippingNote,
    "",
    'พิมพ์ "ตกลง" เพื่อยืนยัน หรือบอกส่วนลดที่ต้องการได้ครับ',
  ]
    .filter(Boolean)
    .join("\n");
}
