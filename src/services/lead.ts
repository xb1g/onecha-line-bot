import { ObjectId } from "mongodb";
import { getCollection } from "../lib/mongodb";

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

export interface LeadDocument {
  _id?: ObjectId;
  lineUserId: string;
  state: LeadState;
  cafeName?: string;
  location?: string;
  monthlyUsageGrams?: number;
  priceSensitivity?: "low" | "medium" | "high";
  timeline?: string;
  interestedGrades?: Array<"ceremonial" | "premium" | "cafe" | "culinary">;
  requestedQuantityGrams?: number;
  activeQuoteId?: ObjectId;
  escalatedReason?: string;
  escalatedAt?: Date;
  handledBy?: string;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt?: Date;
}

export interface LeadUpdateInput {
  cafeName?: string;
  location?: string;
  monthlyUsageGrams?: number;
  priceSensitivity?: "low" | "medium" | "high";
  timeline?: string;
  interestedGrades?: Array<"ceremonial" | "premium" | "cafe" | "culinary">;
  requestedQuantityGrams?: number;
  activeQuoteId?: ObjectId | null;
  escalatedReason?: string;
  escalatedAt?: Date | null;
  handledBy?: string | null;
  lastMessageAt?: Date;
}

const LEAD_COLLECTION = "leads";

const VALID_TRANSITIONS: Record<LeadState, LeadState[]> = {
  LEAD_CAPTURE: ["QUALIFY_BULK_INTENT", "PRODUCT_DISCOVERY", "FAILED"],
  QUALIFY_BULK_INTENT: ["PRODUCT_DISCOVERY", "QUOTE_GENERATION", "RETENTION_LOOP", "FAILED"],
  PRODUCT_DISCOVERY: ["QUOTE_GENERATION", "RETENTION_LOOP", "FAILED"],
  QUOTE_GENERATION: ["NEGOTIATION", "ORDER_CONFIRMATION", "RETENTION_LOOP", "FAILED"],
  NEGOTIATION: ["ORDER_CONFIRMATION", "ESCALATION", "FAILED", "CANCELLED"],
  ORDER_CONFIRMATION: ["PAYMENT_PENDING", "CANCELLED", "ESCALATION"],
  PAYMENT_PENDING: ["ESCALATION", "CANCELLED", "RETENTION_LOOP"],
  ESCALATION: ["ORDER_CONFIRMATION", "CANCELLED", "FAILED"],
  RETENTION_LOOP: ["QUOTE_GENERATION", "CANCELLED", "FAILED"],
  CANCELLED: [],
  FAILED: [],
};

export class LeadService {
  async getOrCreateLead(lineUserId: string): Promise<LeadDocument> {
    const collection = await getCollection<LeadDocument>(LEAD_COLLECTION);
    const existing = await collection.findOne({ lineUserId });
    if (existing) {
      return existing;
    }

    const now = new Date();
    const newLead: LeadDocument = {
      lineUserId,
      state: "LEAD_CAPTURE",
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    };

    const result = await collection.insertOne(newLead);
    const created = await collection.findOne({ _id: result.insertedId });
    return created ?? { ...newLead, _id: result.insertedId };
  }

  async getLead(lineUserId: string): Promise<LeadDocument | null> {
    const collection = await getCollection<LeadDocument>(LEAD_COLLECTION);
    return await collection.findOne({ lineUserId });
  }

  async getLeadById(leadId: ObjectId | string): Promise<LeadDocument | null> {
    const collection = await getCollection<LeadDocument>(LEAD_COLLECTION);
    return await collection.findOne({ _id: this.toObjectId(leadId) });
  }

  async updateLead(lineUserId: string, data: LeadUpdateInput): Promise<LeadDocument> {
    const collection = await getCollection<LeadDocument>(LEAD_COLLECTION);
    const now = new Date();
    const { setDoc, unsetDoc } = this.buildUpdateDoc(data, now);

    await collection.updateOne(
      { lineUserId },
      {
        $set: {
          ...setDoc,
          updatedAt: now,
          lastMessageAt: data.lastMessageAt ?? now,
        },
        ...(Object.keys(unsetDoc).length > 0 ? { $unset: unsetDoc } : {}),
      }
    );

    const updated = await collection.findOne({ lineUserId });
    if (!updated) {
      throw new Error(`Lead not found for LINE user ${lineUserId}`);
    }

    return updated;
  }

  async updateLeadById(leadId: ObjectId | string, data: LeadUpdateInput): Promise<LeadDocument> {
    const collection = await getCollection<LeadDocument>(LEAD_COLLECTION);
    const objectId = this.toObjectId(leadId);
    const now = new Date();
    const { setDoc, unsetDoc } = this.buildUpdateDoc(data, now);

    await collection.updateOne(
      { _id: objectId },
      {
        $set: {
          ...setDoc,
          updatedAt: now,
          lastMessageAt: data.lastMessageAt ?? now,
        },
        ...(Object.keys(unsetDoc).length > 0 ? { $unset: unsetDoc } : {}),
      }
    );

    const updated = await collection.findOne({ _id: objectId });
    if (!updated) {
      throw new Error(`Lead not found for ID ${objectId.toHexString()}`);
    }

    return updated;
  }

  async transitionLead(
    lineUserId: string,
    fromState: LeadState,
    toState: LeadState
  ): Promise<LeadDocument> {
    const collection = await getCollection<LeadDocument>(LEAD_COLLECTION);
    const lead = await collection.findOne({ lineUserId });

    if (!lead) {
      throw new Error(`Lead not found for LINE user ${lineUserId}`);
    }

    if (lead.state !== fromState) {
      throw new Error(`Invalid state transition: expected ${fromState}, got ${lead.state}`);
    }

    if (!VALID_TRANSITIONS[fromState].includes(toState)) {
      throw new Error(`Invalid state transition from ${fromState} to ${toState}`);
    }

    const now = new Date();
    await collection.updateOne(
      { lineUserId },
      {
        $set: {
          state: toState,
          updatedAt: now,
          lastMessageAt: now,
        },
      }
    );

    const updated = await collection.findOne({ lineUserId });
    if (!updated) {
      throw new Error(`Lead not found for LINE user ${lineUserId}`);
    }

    return updated;
  }

  async setQuoteReference(
    lineUserId: string,
    activeQuoteId: ObjectId | null
  ): Promise<LeadDocument> {
    return await this.updateLead(lineUserId, { activeQuoteId });
  }

  async getStuckLeads(maxHours = 24): Promise<LeadDocument[]> {
    const collection = await getCollection<LeadDocument>(LEAD_COLLECTION);
    const cutoff = new Date(Date.now() - maxHours * 60 * 60 * 1000);

    return await collection
      .find({
        state: { $in: ["QUALIFY_BULK_INTENT", "QUOTE_GENERATION", "NEGOTIATION"] },
        lastMessageAt: { $lt: cutoff },
      })
      .sort({ lastMessageAt: 1 })
      .toArray();
  }

  async getLeadsByState(state: LeadState): Promise<LeadDocument[]> {
    const collection = await getCollection<LeadDocument>(LEAD_COLLECTION);
    return await collection.find({ state }).sort({ createdAt: -1 }).toArray();
  }

  private buildUpdateDoc(
    data: LeadUpdateInput,
    now: Date
  ): {
    setDoc: Partial<LeadDocument>;
    unsetDoc: Record<string, "">;
  } {
    const setDoc: Partial<LeadDocument> = {};
    const unsetDoc: Record<string, ""> = {};

    if (data.cafeName !== undefined) {
      setDoc.cafeName = data.cafeName;
    }
    if (data.location !== undefined) {
      setDoc.location = data.location;
    }
    if (data.monthlyUsageGrams !== undefined) {
      setDoc.monthlyUsageGrams = data.monthlyUsageGrams;
    }
    if (data.priceSensitivity !== undefined) {
      setDoc.priceSensitivity = data.priceSensitivity;
    }
    if (data.timeline !== undefined) {
      setDoc.timeline = data.timeline;
    }
    if (data.interestedGrades !== undefined) {
      setDoc.interestedGrades = data.interestedGrades;
    }
    if (data.requestedQuantityGrams !== undefined) {
      setDoc.requestedQuantityGrams = data.requestedQuantityGrams;
    }
    if (data.activeQuoteId !== undefined) {
      if (data.activeQuoteId === null) {
        unsetDoc.activeQuoteId = "";
      } else {
        setDoc.activeQuoteId = data.activeQuoteId;
      }
    }
    if (data.escalatedReason !== undefined) {
      setDoc.escalatedReason = data.escalatedReason;
    }
    if (data.escalatedAt !== undefined) {
      if (data.escalatedAt === null) {
        unsetDoc.escalatedAt = "";
      } else {
        setDoc.escalatedAt = data.escalatedAt;
      }
    }
    if (data.handledBy !== undefined) {
      if (data.handledBy === null) {
        unsetDoc.handledBy = "";
      } else {
        setDoc.handledBy = data.handledBy;
      }
    }

    if (data.lastMessageAt !== undefined) {
      setDoc.lastMessageAt = data.lastMessageAt;
    } else {
      setDoc.lastMessageAt = now;
    }

    return { setDoc, unsetDoc };
  }

  private toObjectId(value: ObjectId | string): ObjectId {
    return value instanceof ObjectId ? value : new ObjectId(value);
  }
}

export const leadService = new LeadService();
export { VALID_TRANSITIONS as LEAD_VALID_TRANSITIONS };
