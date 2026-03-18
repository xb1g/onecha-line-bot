import type { ObjectId } from "mongodb";

export type LeadState =
  | "LEAD_CAPTURE"
  | "QUALIFY_BULK_INTENT"
  | "PRODUCT_DISCOVERY"
  | "QUOTE_GENERATION"
  | "NEGOTIATION"
  | "ORDER_CONFIRMATION"
  | "PAYMENT_PENDING"
  | "ESCALATION"
  | "RETENTION_LOOP"
  | "CANCELLED"
  | "FAILED";

export type QuoteStatus = "pending" | "accepted" | "rejected" | "expired" | "negotiating";

export type CoffeeGrade = "ceremonial" | "premium" | "cafe" | "culinary";
export type PriceSensitivity = "low" | "medium" | "high";

export interface LeadDocument {
  _id?: ObjectId;
  lineUserId: string;
  state: LeadState;

  // Qualification data
  cafeName?: string;
  location?: string;
  monthlyUsageGrams?: number;
  priceSensitivity?: PriceSensitivity;
  timeline?: string;

  // Product interest
  interestedGrades?: CoffeeGrade[];
  requestedQuantityGrams?: number;

  // Quote reference
  activeQuoteId?: ObjectId;

  // Escalation
  escalatedReason?: string;
  escalatedAt?: Date;
  handledBy?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt?: Date;
}

export interface QuoteItemDocument {
  productId: string;
  productName: string;
  grade: CoffeeGrade;
  quantityGrams: number;
  unitPricePerGram: number;
  subtotal: number;
}

export interface NegotiationHistoryEntry {
  requestedDiscount: number;
  grantedDiscount: number;
  reason: string;
  at: Date;
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
  negotiationHistory?: NegotiationHistoryEntry[];
  status: QuoteStatus;
  expiresAt: Date;
  orderId?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
