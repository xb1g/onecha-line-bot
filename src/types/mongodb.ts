import { ObjectId } from "mongodb";
export type {
  CoffeeGrade,
  LeadDocument,
  LeadState,
  NegotiationHistoryEntry,
  PriceSensitivity,
  QuoteDocument,
  QuoteItemDocument,
  QuoteStatus,
} from "./lead";
export type { FSMState, LLMExtractionResult, StateTransition, TransitionContext } from "./fsm";

// =============================================================================
// LINE Bot Types
// =============================================================================

/** LINE Bot conversation state for multi-step interactions */
export interface LineBotStateDocument {
  _id?: ObjectId;
  lineUserId: string;
  pendingAction: "awaiting_tracking_number";
  orderId: ObjectId;
  orderDisplayId?: string;
  createdAt: Date;
  expiresAt: Date;
}

/** Bot configuration and state */
export interface BotStateDocument {
  _id?: ObjectId;
  key: string; // "admin_group_id", "last_daily_digest", "last_weekly_summary"
  value: string;
  updatedAt: Date;
}

export type LineGroupRole = "admin" | "customer";

export interface LineGroupDocument {
  _id?: ObjectId;
  groupId: string;
  role: LineGroupRole;
  sourceType: "group";
  joinedAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Shared Types (from main Onecha app)
// =============================================================================

export interface OrderDocument {
  _id?: ObjectId;
  customerId?: ObjectId;
  customerEmail: string;
  status: "pending" | "paid" | "processing" | "shipped" | "cancelled";
  items: OrderItem[];
  totalAmount: number;
  shippingAddress?: ShippingAddress;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  acceptedAt?: Date;
  acceptedBy?: string;
  shippedAt?: Date;
  scheduledShipDate?: Date;
  scheduledBy?: string;
  customerNotified?: boolean;
  lastReminderSent?: Date;
  reminderCount?: number;
  statusHistory?: StatusHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ShippingAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface StatusHistoryEntry {
  status: string;
  at: Date;
  by?: string;
  note?: string;
}

export interface CustomerDocument {
  _id?: ObjectId;
  email: string;
  name?: string;
  phone?: string;
  lineUserId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WeeklyStats {
  ordersShipped: number;
  avgTimeToShip: number;
  stuckOrders: number;
}
