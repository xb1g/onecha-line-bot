import { ObjectId } from "mongodb";
import { getCollection } from "../lib/mongodb";

export type QuoteStatus = "pending" | "accepted" | "rejected" | "expired" | "negotiating";

export type QuoteGrade = "ceremonial" | "premium" | "cafe" | "culinary";

export interface QuoteItemInput {
  productId: string;
  productName: string;
  grade: QuoteGrade;
  quantityGrams: number;
}

export interface QuoteItemDocument extends QuoteItemInput {
  unitPricePerGram: number;
  subtotal: number;
}

export interface QuoteDocument {
  _id?: ObjectId;
  leadId: ObjectId;
  lineUserId: string;
  items: QuoteItemDocument[];
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
  originalTotalAmount: number;
  negotiationHistory?: Array<{
    requestedDiscount: number;
    grantedDiscount: number;
    reason: string;
    at: Date;
  }>;
  status: QuoteStatus;
  expiresAt: Date;
  orderId?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteCalculation {
  items: QuoteItemDocument[];
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
  originalTotalAmount: number;
}

const QUOTE_COLLECTION = "quotes";
const DEFAULT_SHIPPING_COST = 200;
const FREE_SHIPPING_THRESHOLD = 5000;
const DEFAULT_EXPIRY_DAYS = 7;
const MAX_QUANTITY_GRAMS = 100000; // 100kg max per item
const MAX_TOTAL_AMOUNT = 10000000; // 10M THB max total

const PRICE_PER_GRAM: Record<QuoteGrade, number> = {
  ceremonial: 0.5,
  premium: 0.35,
  cafe: 0.25,
  culinary: 0.15,
};

const MAX_DISCOUNT_PERCENTAGE = 100;

export class QuoteService {
  async generateQuote(
    leadId: ObjectId,
    lineUserId: string,
    items: QuoteItemInput[],
    discountPercentage = 0
  ): Promise<QuoteDocument> {
    if (items.length === 0) {
      throw new Error("Quote must contain at least one item");
    }

    const sanitizedDiscount = this.sanitizeDiscount(discountPercentage);
    const calculation = this.calculateQuote(items, sanitizedDiscount);
    const now = new Date();

    const quote: QuoteDocument = {
      leadId,
      lineUserId,
      items: calculation.items,
      subtotal: calculation.subtotal,
      discountPercentage: calculation.discountPercentage,
      discountAmount: calculation.discountAmount,
      shippingCost: calculation.shippingCost,
      totalAmount: calculation.totalAmount,
      originalTotalAmount: calculation.originalTotalAmount,
      status: "pending",
      expiresAt: new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    };

    const collection = await getCollection<QuoteDocument>(QUOTE_COLLECTION);
    const result = await collection.insertOne(quote);
    const created = await collection.findOne({ _id: result.insertedId });
    return created ?? { ...quote, _id: result.insertedId };
  }

  calculateQuote(
    items: QuoteItemInput[],
    discountPercentage = 0
  ): QuoteCalculation {
    if (items.length === 0) {
      throw new Error("Cannot calculate quote without items");
    }

    const sanitizedDiscount = this.sanitizeDiscount(discountPercentage);
    const calculatedItems = items.map((item) => this.calculateItem(item));
    const subtotal = roundMoney(
      calculatedItems.reduce((sum, item) => sum + item.subtotal, 0)
    );
    
    // Overflow protection
    if (subtotal > MAX_TOTAL_AMOUNT) {
      throw new Error(`Subtotal exceeds maximum of ${MAX_TOTAL_AMOUNT} THB`);
    }
    
    const discountAmount = roundMoney(subtotal * (sanitizedDiscount / 100));
    const afterDiscount = roundMoney(subtotal - discountAmount);
    const shippingCost = afterDiscount >= FREE_SHIPPING_THRESHOLD ? 0 : DEFAULT_SHIPPING_COST;
    const totalAmount = roundMoney(afterDiscount + shippingCost);
    
    // Overflow protection for total
    if (totalAmount > MAX_TOTAL_AMOUNT) {
      throw new Error(`Total amount exceeds maximum of ${MAX_TOTAL_AMOUNT} THB`);
    }

    return {
      items: calculatedItems,
      subtotal,
      discountPercentage: sanitizedDiscount,
      discountAmount,
      shippingCost,
      totalAmount,
      originalTotalAmount: roundMoney(subtotal + (subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : DEFAULT_SHIPPING_COST)),
    };
  }

  async getQuote(quoteId: ObjectId | string): Promise<QuoteDocument | null> {
    const collection = await getCollection<QuoteDocument>(QUOTE_COLLECTION);
    return await collection.findOne({ _id: this.toObjectId(quoteId) });
  }

  async getQuotesForLead(leadId: ObjectId | string): Promise<QuoteDocument[]> {
    const collection = await getCollection<QuoteDocument>(QUOTE_COLLECTION);
    return await collection
      .find({ leadId: this.toObjectId(leadId) })
      .sort({ createdAt: -1 })
      .toArray();
  }

  async getActiveQuoteForLead(leadId: ObjectId | string): Promise<QuoteDocument | null> {
    const collection = await getCollection<QuoteDocument>(QUOTE_COLLECTION);
    return await collection.findOne({
      leadId: this.toObjectId(leadId),
      status: { $in: ["pending", "negotiating"] },
    });
  }

  async acceptQuote(quoteId: ObjectId | string, orderId: ObjectId | string): Promise<QuoteDocument> {
    return await this.updateQuoteStatus(quoteId, "accepted", {
      orderId: this.toObjectId(orderId),
    });
  }

  async rejectQuote(quoteId: ObjectId | string): Promise<QuoteDocument> {
    return await this.updateQuoteStatus(quoteId, "rejected");
  }

  async expireQuote(quoteId: ObjectId | string): Promise<QuoteDocument> {
    return await this.updateQuoteStatus(quoteId, "expired");
  }

  async addNegotiation(
    quoteId: ObjectId | string,
    requestedDiscount: number,
    grantedDiscount: number,
    reason: string
  ): Promise<QuoteDocument> {
    const collection = await getCollection<QuoteDocument>(QUOTE_COLLECTION);
    const objectId = this.toObjectId(quoteId);
    const sanitizedRequested = this.sanitizeDiscount(requestedDiscount);
    const sanitizedGranted = this.sanitizeDiscount(grantedDiscount);
    const now = new Date();

    await collection.updateOne(
      { _id: objectId },
      {
        $set: {
          status: "negotiating",
          discountPercentage: sanitizedGranted,
          updatedAt: now,
        },
        $push: {
          negotiationHistory: {
            requestedDiscount: sanitizedRequested,
            grantedDiscount: sanitizedGranted,
            reason,
            at: now,
          },
        },
      }
    );

    const updated = await collection.findOne({ _id: objectId });
    if (!updated) {
      throw new Error(`Quote not found for ID ${objectId.toHexString()}`);
    }

    return updated;
  }

  async getExpiredQuotes(): Promise<QuoteDocument[]> {
    const collection = await getCollection<QuoteDocument>(QUOTE_COLLECTION);
    return await collection.find({ expiresAt: { $lt: new Date() }, status: { $ne: "accepted" } }).sort({ expiresAt: 1 }).toArray();
  }

  private calculateItem(item: QuoteItemInput): QuoteItemDocument {
    if (!item.productId.trim()) {
      throw new Error("productId is required");
    }
    if (!item.productName.trim()) {
      throw new Error("productName is required");
    }
    if (!Number.isFinite(item.quantityGrams) || item.quantityGrams <= 0) {
      throw new Error("quantityGrams must be a positive number");
    }
    if (item.quantityGrams > MAX_QUANTITY_GRAMS) {
      throw new Error(`quantityGrams exceeds maximum of ${MAX_QUANTITY_GRAMS}g`);
    }

    const unitPricePerGram = PRICE_PER_GRAM[item.grade];
    if (unitPricePerGram === undefined) {
      throw new Error(`Unsupported grade: ${item.grade}`);
    }

    const subtotal = roundMoney(unitPricePerGram * item.quantityGrams);
    
    // Overflow protection
    if (subtotal > MAX_TOTAL_AMOUNT) {
      throw new Error("Subtotal exceeds maximum allowed amount");
    }

    return {
      productId: item.productId.trim(),
      productName: item.productName.trim(),
      grade: item.grade,
      quantityGrams: Math.round(item.quantityGrams),
      unitPricePerGram,
      subtotal,
    };
  }

  private sanitizeDiscount(discountPercentage: number): number {
    if (!Number.isFinite(discountPercentage)) {
      return 0;
    }
    return clamp(Math.round(discountPercentage * 100) / 100, 0, MAX_DISCOUNT_PERCENTAGE);
  }

  private async updateQuoteStatus(
    quoteId: ObjectId | string,
    status: QuoteStatus,
    extraSet: Partial<QuoteDocument> = {}
  ): Promise<QuoteDocument> {
    const collection = await getCollection<QuoteDocument>(QUOTE_COLLECTION);
    const objectId = this.toObjectId(quoteId);
    const now = new Date();

    await collection.updateOne(
      { _id: objectId },
      {
        $set: {
          status,
          updatedAt: now,
          ...extraSet,
        },
      }
    );

    const updated = await collection.findOne({ _id: objectId });
    if (!updated) {
      throw new Error(`Quote not found for ID ${objectId.toHexString()}`);
    }

    return updated;
  }

  private toObjectId(value: ObjectId | string): ObjectId {
    return value instanceof ObjectId ? value : new ObjectId(value);
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const quoteService = new QuoteService();
