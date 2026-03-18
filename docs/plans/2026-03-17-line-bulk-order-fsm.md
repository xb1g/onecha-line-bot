# LINE Bulk Order FSM Implementation Plan

> **For Claude:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Lead-to-Order MVP for the LINE bulk order FSM — café owners can message the bot, get qualified, receive a quote, negotiate within rules, and complete payment.

**Architecture:** Event-driven FSM with MongoDB state persistence. Each lead/quote is a document with a `state` field. Webhook messages trigger state transitions via the FSM router. LLM (gpt-5.4-nano) extracts structured data from natural language messages.

**Tech Stack:** Node.js/TypeScript, MongoDB, LINE Bot SDK, OpenAI API (gpt-5.4-nano-2026-03-17)

---

## Scope Check

This plan covers **one subsystem**: LINE bulk order FSM (Lead → Quote → Order). Shopee integration is deferred to post-hackathon.

**In scope:**
- LEAD_CAPTURE → QUALIFY_BULK_INTENT → PRODUCT_DISCOVERY → QUOTE_GENERATION → NEGOTIATION → ORDER_CONFIRMATION → PAYMENT_PENDING
- ESCALATION state for edge cases
- RETENTION_LOOP (basic reorder reminder)

**Out of scope:**
- Multi-channel (LINE only)
- Advanced analytics dashboard
- Voice input
- Proactive AI reorder prediction

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/types/lead.ts` | LeadDocument, QuoteDocument, LeadState, QuoteState types |
| `src/types/fsm.ts` | FSM transition types, state machine types |
| `src/services/llm.ts` | OpenAI client, prompt templates, response parsing |
| `src/services/lead.ts` | Lead CRUD: create, update, get, transition state |
| `src/services/quote.ts` | Quote generation, discount calculation, validation |
| `src/fsm/states.ts` | FSM state definitions, valid transitions |
| `src/fsm/transitions.ts` | State transition logic, guards |
| `src/fsm/router.ts` | Route incoming messages to state handlers |
| `src/handlers/lead.ts` | LEAD_CAPTURE + QUALIFY_BULK_INTENT handlers |
| `src/handlers/quote.ts` | QUOTE_GENERATION + NEGOTIATION handlers |
| `src/prompts/lead-capture.ts` | LLM system prompts for each state |
| `scripts/setup-fsm-indexes.ts` | MongoDB index setup for leads/quotes |

### Modified Files

| File | Changes |
|------|---------|
| `src/handlers/webhook.ts` | Add FSM router integration, route non-command messages to FSM |
| `src/types/mongodb.ts` | Add LeadDocument, QuoteDocument interfaces |
| `package.json` | Add `openai` dependency |
| `.env.example` | Add `OPENAI_API_KEY` |

---

## Chunk 1: Types & Schema

### Task 1: Lead and Quote Type Definitions

**Files:**
- Create: `src/types/lead.ts`
- Create: `src/types/fsm.ts`

- [ ] **Step 1: Create LeadDocument and QuoteDocument types**

```typescript
// src/types/lead.ts
import { ObjectId } from "mongodb";

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

  // Qualification data
  caféName?: string;
  location?: string;
  monthlyUsageGrams?: number;
  priceSensitivity?: "low" | "medium" | "high";
  timeline?: string;

  // Product interest
  interestedGrades?: ("ceremonial" | "premium" | "cafe" | "culinary")[];
  requestedQuantityGrams?: number;

  // Quote reference
  activeQuoteId?: ObjectId;

  // Escalation
  escalatedReason?: string;
  escalatedAt?: Date;
  handledBy?: string; // LINE userId of human

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt?: Date;
}

export type QuoteStatus = "pending" | "accepted" | "rejected" | "expired" | "negotiating";

export interface QuoteDocument {
  _id?: ObjectId;
  leadId: ObjectId;
  lineUserId: string;

  // Quote items
  items: Array<{
    productId: string;
    productName: string;
    grade: "ceremonial" | "premium" | "cafe" | "culinary";
    quantityGrams: number;
    unitPricePerGram: number;
    subtotal: number;
  }>;

  // Pricing
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;

  // Negotiation
  originalTotalAmount: number;
  negotiationHistory?: Array<{
    requestedDiscount: number;
    grantedDiscount: number;
    reason: string;
    at: Date;
  }>;

  // Status
  status: QuoteStatus;
  expiresAt: Date;

  // Order reference (when accepted)
  orderId?: ObjectId;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Create FSM types**

```typescript
// src/types/fsm.ts
import { LeadState } from "./lead";

export interface StateTransition {
  from: LeadState;
  to: LeadState;
  condition?: (context: TransitionContext) => Promise<boolean>;
}

export interface TransitionContext {
  leadId: string;
  message: string;
  extractedData?: Record<string, unknown>;
  lineUserId: string;
}

export interface FSMState {
  name: LeadState;
  description: string;
  entryActions: Array<(context: TransitionContext) => Promise<void>>;
  exitActions: Array<(context: TransitionContext) => Promise<void>>;
  allowedTransitions: LeadState[];
}

export interface LLMExtractionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  confidence?: number;
  needsClarification?: boolean;
  clarificationQuestions?: string[];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/lead.ts src/types/fsm.ts
git commit -m "feat(fsm): add LeadDocument, QuoteDocument, and FSM types"
```

---

## Chunk 2: MongoDB Schema & Indexes

### Task 2: Extend MongoDB Types and Setup Indexes

**Files:**
- Modify: `src/types/mongodb.ts`
- Create: `scripts/setup-fsm-indexes.ts`

- [ ] **Step 1: Add LeadDocument and QuoteDocument to mongodb.ts**

```typescript
// src/types/mongodb.ts - Add at end

/** LINE Bot Lead Document for bulk order FSM */
export interface LeadDocument {
  _id?: ObjectId;
  lineUserId: string;
  state:
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

  // Qualification data
  caféName?: string;
  location?: string;
  monthlyUsageGrams?: number;
  priceSensitivity?: "low" | "medium" | "high";
  timeline?: string;

  // Product interest
  interestedGrades?: ("ceremonial" | "premium" | "cafe" | "culinary")[];
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

/** Quote Document for bulk order FSM */
export interface QuoteDocument {
  _id?: ObjectId;
  leadId: ObjectId;
  lineUserId: string;

  // Quote items
  items: Array<{
    productId: string;
    productName: string;
    grade: "ceremonial" | "premium" | "cafe" | "culinary";
    quantityGrams: number;
    unitPricePerGram: number;
    subtotal: number;
  }>;

  // Pricing
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;

  // Negotiation
  originalTotalAmount: number;
  negotiationHistory?: Array<{
    requestedDiscount: number;
    grantedDiscount: number;
    reason: string;
    at: Date;
  }>;

  // Status
  status: "pending" | "accepted" | "rejected" | "expired" | "negotiating";
  expiresAt: Date;

  // Order reference
  orderId?: ObjectId;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Create index setup script**

```typescript
// scripts/setup-fsm-indexes.ts
import { MongoClient } from "mongodb";

async function setupIndexes() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    // Leads collection indexes
    const leads = db.collection("leads");
    await leads.createIndex({ lineUserId: 1 });
    await leads.createIndex({ lineUserId: 1, state: 1 });
    await leads.createIndex({ createdAt: -1 });
    await leads.createIndex({ lastMessageAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30 day TTL for inactive leads

    // Quotes collection indexes
    const quotes = db.collection("quotes");
    await quotes.createIndex({ leadId: 1 });
    await quotes.createIndex({ lineUserId: 1 });
    await quotes.createIndex({ status: 1 });
    await quotes.createIndex({ expiresAt: 1 });

    console.log("✅ FSM indexes created successfully");
  } catch (error) {
    console.error("❌ Error creating indexes:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

setupIndexes();
```

- [ ] **Step 3: Add npm script to package.json**

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "setup-indexes": "tsx scripts/setup-indexes.ts",
    "setup-fsm-indexes": "tsx scripts/setup-fsm-indexes.ts"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/mongodb.ts scripts/setup-fsm-indexes.ts package.json
git commit -m "feat(fsm): add lead/quote types to mongodb.ts and index setup script"
```

---

## Chunk 3: LLM Service

### Task 3: OpenAI Integration for Intent Extraction

**Files:**
- Create: `src/services/llm.ts`
- Create: `src/prompts/lead-capture.ts`

- [ ] **Step 1: Create LLM service with OpenAI client**

```typescript
// src/services/llm.ts
import OpenAI from "openai";
import { LLMExtractionResult } from "../types/fsm";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "gpt-5.4-nano-2026-03-17";

export interface ExtractionSchema {
  type: "lead_capture" | "qualification" | "product_discovery" | "negotiation";
}

export async function extractIntent(
  message: string,
  schema: ExtractionSchema,
  context?: Record<string, unknown>
): Promise<LLMExtractionResult> {
  try {
    const systemPrompt = getSystemPrompt(schema.type);
    const userPrompt = buildUserPrompt(message, context);

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
      timeout: 10000, // 10 second timeout
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        success: false,
        error: "Empty response from LLM",
      };
    }

    const parsed = JSON.parse(content);
    return {
      success: true,
      data: parsed,
      confidence: parsed.confidence || 0.8,
      needsClarification: parsed.needs_clarification || false,
      clarificationQuestions: parsed.clarification_questions || [],
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: "Failed to parse LLM response as JSON",
      };
    }
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: "LLM request timed out",
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown LLM error",
    };
  }
}

function getSystemPrompt(type: string): string {
  switch (type) {
    case "lead_capture":
      return `You are extracting lead information from LINE messages for a B2B matcha wholesale business.
Extract: caféName, location, monthlyUsageGrams (estimate from context), timeline, interestedGrades.
Return JSON with these fields. Set needs_clarification to true if key info is missing.
Set confidence (0-1) based on how clear the intent is.
If spam or irrelevant, set isSpam: true.`;

    case "qualification":
      return `You are qualifying B2B matcha leads. Extract: priceSensitivity (low/medium/high),
specificQuantityGrams (500g+ only), preferredGrade (ceremonial/premium/cafe/culinary).
Return JSON. Flag needs_clarification if quantity < 500g or grade unclear.`;

    case "negotiation":
      return `You are analyzing negotiation requests. Extract: requestedDiscountPercentage (number),
reason (string). Determine if request is reasonable (< 10% = reasonable, 10-20% = needs review, > 20% = escalate).
Return JSON with requestedDiscountPercentage, reason, recommendation (accept/review/escalate).`;

    default:
      return `Extract structured data from the message. Return JSON.`;
  }
}

function buildUserPrompt(
  message: string,
  context?: Record<string, unknown>
): string {
  let prompt = `Message: "${message}"`;
  if (context) {
    prompt += `\nContext: ${JSON.stringify(context)}`;
  }
  return prompt;
}

// Fallback regex-based extraction for when LLM fails
export function extractWithRegex(message: string): Partial<LLMExtractionResult["data"]> {
  const data: Record<string, unknown> = {};

  // Extract numbers (potential quantity)
  const numberMatch = message.match(/(\d+)\s*(kg|g|grams|kilograms)?/i);
  if (numberMatch) {
    const num = parseInt(numberMatch[1]);
    const unit = numberMatch[2]?.toLowerCase();
    if (unit === "kg" || unit === "kilograms") {
      data.requestedQuantityGrams = num * 1000;
    } else if (unit === "g" || unit === "grams" || !unit) {
      data.requestedQuantityGrams = num;
    }
  }

  // Extract café-related keywords
  const cafeKeywords = ["café", "cafe", "coffee", "shop", "restaurant", "ร้าน", "คาเฟ่"];
  if (cafeKeywords.some(k => message.toLowerCase().includes(k))) {
    data.isBusinessLead = true;
  }

  return data;
}
```

- [ ] **Step 2: Create prompt templates**

```typescript
// src/prompts/lead-capture.ts
export const LEAD_CAPTURE_PROMPT = `You are a friendly B2B sales assistant for Onecha, a premium Japanese matcha supplier.
Your job is to qualify potential café owners and resellers who message us on LINE.

Extract the following from their message:
- caféName: Name of their café/business (if mentioned)
- location: City/area (if mentioned)
- monthlyUsageGrams: Estimated monthly matcha usage in grams
- timeline: When they need the matcha (e.g., "next week", "immediately")
- interestedGrades: Which grades they're interested in (ceremonial/premium/cafe/culinary)

Return as JSON. If info is missing, set needs_clarification: true and list questions to ask.

Examples:
"I want to buy 1kg of matcha for my café" →
  { caféName: null, monthlyUsageGrams: 1000, needs_clarification: true, clarification_questions: ["What's your café name?", "Where are you located?"] }

"Opening a matcha café in Bangkok, need 5kg monthly" →
  { location: "Bangkok", monthlyUsageGrams: 5000, needs_clarification: true, clarification_questions: ["What's your café name?"] }`;

export const QUALIFICATION_PROMPT = `You are qualifying a B2B matcha lead. They want 500g+ orders only.

Extract:
- priceSensitivity: "low" (premium focused), "medium", or "high" (price focused)
- specificQuantityGrams: Exact quantity they want (must be >= 500g)
- preferredGrade: "ceremonial", "premium", "cafe", or "culinary"

If quantity < 500g, set needs_clarification: true with message "Minimum order is 500g".
If grade unclear, ask which grade they need.

Return as JSON.`;

export const NEGOTIATION_PROMPT = `A customer is negotiating the quote price.

Extract:
- requestedDiscountPercentage: Number (0-100)
- reason: Their reason for discount

Analyze and return:
- recommendation: "accept" (< 10%), "review" (10-20%), or "escalate" (> 20%)
- counterOffer: Suggested counter discount percentage

Rules:
- Max auto-approve discount: 10%
- Free shipping threshold: Orders > 5000 THB
- Bundle incentive: Mention if ordering multiple grades

Return as JSON.`;
```

- [ ] **Step 3: Add OpenAI to package.json**

```json
{
  "dependencies": {
    "@line/bot-sdk": "^8.0.0",
    "mongodb": "^6.0.0",
    "openai": "^4.0.0"
  }
}
```

- [ ] **Step 4: Add OPENAI_API_KEY to .env.example**

```
MONGODB_URI=mongodb://localhost:27017/onecha
LINE_CHANNEL_ACCESS_TOKEN=your_token_here
LINE_CHANNEL_SECRET=your_secret_here
OPENAI_API_KEY=your_openai_key_here
PORT=3000
```

- [ ] **Step 5: Commit**

```bash
git add src/services/llm.ts src/prompts/lead-capture.ts package.json .env.example
git commit -m "feat(llm): add OpenAI service for intent extraction with fallback"
```

---

## Chunk 4: Lead & Quote Services

### Task 4: Lead CRUD Service

**Files:**
- Create: `src/services/lead.ts`

- [ ] **Step 1: Create LeadService with CRUD operations**

```typescript
// src/services/lead.ts
import { ObjectId } from "mongodb";
import { getCollection } from "../lib/mongodb";
import { LeadDocument, LeadState } from "../types/lead";

export class LeadService {
  /**
   * Create or get existing lead for a LINE user
   */
  async getOrCreateLead(lineUserId: string): Promise<LeadDocument> {
    const collection = await getCollection<LeadDocument>("leads");

    // Check for existing lead
    const existing = await collection.findOne({ lineUserId });
    if (existing) {
      return existing;
    }

    // Create new lead
    const newLead: LeadDocument = {
      lineUserId,
      state: "LEAD_CAPTURE",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: new Date(),
    };

    await collection.insertOne(newLead);
    return { ...newLead, _id: newLead._id! };
  }

  /**
   * Get lead by LINE user ID
   */
  async getLead(lineUserId: string): Promise<LeadDocument | null> {
    const collection = await getCollection<LeadDocument>("leads");
    return collection.findOne({ lineUserId });
  }

  /**
   * Update lead with extracted data
   */
  async updateLead(
    lineUserId: string,
    data: Partial<LeadDocument>
  ): Promise<LeadDocument> {
    const collection = await getCollection<LeadDocument>("leads");

    const result = await collection.findOneAndUpdate(
      { lineUserId },
      {
        $set: {
          ...data,
          updatedAt: new Date(),
          lastMessageAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      throw new Error("Lead not found");
    }

    return result;
  }

  /**
   * Transition lead to a new state
   */
  async transitionLead(
    lineUserId: string,
    fromState: LeadState,
    toState: LeadState
  ): Promise<LeadDocument> {
    const collection = await getCollection<LeadDocument>("leads");

    // Verify current state
    const lead = await collection.findOne({ lineUserId });
    if (!lead) {
      throw new Error("Lead not found");
    }

    if (lead.state !== fromState) {
      throw new Error(
        `Invalid state transition: expected ${fromState}, got ${lead.state}`
      );
    }

    const result = await collection.findOneAndUpdate(
      { lineUserId },
      {
        $set: {
          state: toState,
          updatedAt: new Date(),
          lastMessageAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      throw new Error("Failed to transition lead");
    }

    return result;
  }

  /**
   * Get leads needing follow-up (stuck in state too long)
   */
  async getStuckLeads(maxHours: number = 24): Promise<LeadDocument[]> {
    const collection = await getCollection<LeadDocument>("leads");
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - maxHours);

    return collection
      .find({
        state: { $in: ["QUALIFY_BULK_INTENT", "QUOTE_GENERATION", "NEGOTIATION"] },
        lastMessageAt: { $lt: cutoff },
      })
      .toArray();
  }
}

export const leadService = new LeadService();
```

- [ ] **Step 2: Create QuoteService**

```typescript
// src/services/quote.ts
import { ObjectId } from "mongodb";
import { getCollection } from "../lib/mongodb";
import { QuoteDocument, QuoteStatus } from "../types/lead";

export interface QuoteItemInput {
  productId: string;
  productName: string;
  grade: "ceremonial" | "premium" | "cafe" | "culinary";
  quantityGrams: number;
}

export interface QuoteCalculation {
  items: Array<{
    productId: string;
    productName: string;
    grade: string;
    quantityGrams: number;
    unitPricePerGram: number;
    subtotal: number;
  }>;
  subtotal: number;
  discountPercentage: number;
  discountAmount: number;
  shippingCost: number;
  totalAmount: number;
}

export class QuoteService {
  /**
   * Generate a new quote for a lead
   */
  async generateQuote(
    leadId: ObjectId,
    lineUserId: string,
    items: QuoteItemInput[],
    discountPercentage: number = 0
  ): Promise<QuoteDocument> {
    const collection = await getCollection<QuoteDocument>("quotes");

    // Calculate prices
    const calculation = this.calculateQuote(items, discountPercentage);

    const quote: QuoteDocument = {
      leadId,
      lineUserId,
      items: calculation.items,
      subtotal: calculation.subtotal,
      discountPercentage: calculation.discountPercentage,
      discountAmount: calculation.discountAmount,
      shippingCost: calculation.shippingCost,
      totalAmount: calculation.totalAmount,
      originalTotalAmount: calculation.subtotal + calculation.shippingCost,
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await collection.insertOne(quote);
    return { ...quote, _id: quote._id! };
  }

  /**
   * Calculate quote pricing
   */
  private calculateQuote(
    items: QuoteItemInput[],
    discountPercentage: number
  ): QuoteCalculation {
    // Base prices per gram (would come from database in production)
    const basePrices: Record<string, number> = {
      ceremonial: 0.50, // 500 THB/kg
      premium: 0.35,    // 350 THB/kg
      cafe: 0.25,       // 250 THB/kg
      culinary: 0.15,   // 150 THB/kg
    };

    const calculatedItems = items.map(item => {
      const unitPricePerGram = basePrices[item.grade] || 0.25;
      return {
        productId: item.productId,
        productName: item.productName,
        grade: item.grade,
        quantityGrams: item.quantityGrams,
        unitPricePerGram,
        subtotal: unitPricePerGram * item.quantityGrams,
      };
    });

    const subtotal = calculatedItems.reduce((sum, item) => sum + item.subtotal, 0);
    const discountAmount = subtotal * (discountPercentage / 100);
    const afterDiscount = subtotal - discountAmount;

    // Free shipping for orders > 5000 THB
    const shippingCost = afterDiscount >= 5000 ? 0 : 200;
    const totalAmount = afterDiscount + shippingCost;

    return {
      items: calculatedItems,
      subtotal,
      discountPercentage,
      discountAmount,
      shippingCost,
      totalAmount,
    };
  }

  /**
   * Get quote by ID
   */
  async getQuote(quoteId: ObjectId): Promise<QuoteDocument | null> {
    const collection = await getCollection<QuoteDocument>("quotes");
    return collection.findOne({ _id: quoteId });
  }

  /**
   * Get active quote for a lead
   */
  async getActiveQuoteForLead(leadId: ObjectId): Promise<QuoteDocument | null> {
    const collection = await getCollection<QuoteDocument>("quotes");
    return collection.findOne({
      leadId,
      status: { $in: ["pending", "negotiating"] },
    });
  }

  /**
   * Accept a quote (transition to order)
   */
  async acceptQuote(quoteId: ObjectId, orderId: ObjectId): Promise<QuoteDocument> {
    const collection = await getCollection<QuoteDocument>("quotes");

    const result = await collection.findOneAndUpdate(
      { _id: quoteId },
      {
        $set: {
          status: "accepted",
          orderId,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      throw new Error("Quote not found");
    }

    return result;
  }

  /**
   * Add negotiation entry to quote
   */
  async addNegotiation(
    quoteId: ObjectId,
    requestedDiscount: number,
    grantedDiscount: number,
    reason: string
  ): Promise<void> {
    const collection = await getCollection<QuoteDocument>("quotes");

    await collection.updateOne(
      { _id: quoteId },
      {
        $set: {
          status: "negotiating",
          discountPercentage: grantedDiscount,
          updatedAt: new Date(),
        },
        $push: {
          negotiationHistory: {
            requestedDiscount,
            grantedDiscount,
            reason,
            at: new Date(),
          },
        },
      }
    );
  }
}

export const quoteService = new QuoteService();
```

- [ ] **Step 3: Commit**

```bash
git add src/services/lead.ts src/services/quote.ts
git commit -m "feat(services): add LeadService and QuoteService with CRUD operations"
```

---

## Chunk 5: FSM Router & State Handlers

### Task 5: FSM Router and State Handlers

**Files:**
- Create: `src/fsm/states.ts`
- Create: `src/fsm/transitions.ts`
- Create: `src/fsm/router.ts`
- Create: `src/handlers/lead.ts`
- Create: `src/handlers/quote.ts`

- [ ] **Step 1: Define FSM states and valid transitions**

```typescript
// src/fsm/states.ts
import { LeadState } from "../types/lead";
import { FSMState } from "../types/fsm";

export const VALID_TRANSITIONS: Record<LeadState, LeadState[]> = {
  LEAD_CAPTURE: ["QUALIFY_BULK_INTENT", "FAILED"],
  QUALIFY_BULK_INTENT: ["PRODUCT_DISCOVERY", "RETENTION_LOOP", "FAILED"],
  PRODUCT_DISCOVERY: ["QUOTE_GENERATION", "RETENTION_LOOP"],
  QUOTE_GENERATION: ["NEGOTIATION", "ORDER_CONFIRMATION", "RETENTION_LOOP"],
  NEGOTIATION: ["ORDER_CONFIRMATION", "ESCALATION", "FAILED"],
  ORDER_CONFIRMATION: ["PAYMENT_PENDING"],
  PAYMENT_PENDING: ["ESCALATION", "CANCELLED", "RETENTION_LOOP"],
  ESCALATION: ["ORDER_CONFIRMATION", "CANCELLED", "FAILED"],
  RETENTION_LOOP: ["QUOTE_GENERATION", "CANCELLED"],
  CANCELLED: [],
  FAILED: [],
};

export const FSM_STATES: Record<LeadState, FSMState> = {
  LEAD_CAPTURE: {
    name: "LEAD_CAPTURE",
    description: "Capture initial lead information",
    entryActions: [sendGreeting],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.LEAD_CAPTURE,
  },
  QUALIFY_BULK_INTENT: {
    name: "QUALIFY_BULK_INTENT",
    description: "Qualify the lead (café name, quantity, timeline)",
    entryActions: [askQualificationQuestions],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.QUALIFY_BULK_INTENT,
  },
  PRODUCT_DISCOVERY: {
    name: "PRODUCT_DISCOVERY",
    description: "Recommend matcha grades based on needs",
    entryActions: [recommendProducts],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.PRODUCT_DISCOVERY,
  },
  QUOTE_GENERATION: {
    name: "QUOTE_GENERATION",
    description: "Generate priced quote",
    entryActions: [generateAndSendQuote],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.QUOTE_GENERATION,
  },
  NEGOTIATION: {
    name: "NEGOTIATION",
    description: "Handle discount requests within rules",
    entryActions: [],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.NEGOTIATION,
  },
  ORDER_CONFIRMATION: {
    name: "ORDER_CONFIRMATION",
    description: "Collect billing and shipping details",
    entryActions: [collectOrderDetails],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.ORDER_CONFIRMATION,
  },
  PAYMENT_PENDING: {
    name: "PAYMENT_PENDING",
    description: "Await payment verification",
    entryActions: [sendInvoice],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.PAYMENT_PENDING,
  },
  ESCALATION: {
    name: "ESCALATION",
    description: "Human handoff required",
    entryActions: [notifyAdmin],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.ESCALATION,
  },
  RETENTION_LOOP: {
    name: "RETENTION_LOOP",
    description: "Nurture lead for future conversion",
    entryActions: [scheduleFollowUp],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.RETENTION_LOOP,
  },
  CANCELLED: {
    name: "CANCELLED",
    description: "Lead cancelled",
    entryActions: [],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.CANCELLED,
  },
  FAILED: {
    name: "FAILED",
    description: "Lead failed qualification (spam, etc.)",
    entryActions: [],
    exitActions: [],
    allowedTransitions: VALID_TRANSITIONS.FAILED,
  },
};

// Placeholder action functions (implement in handlers)
async function sendGreeting() {}
async function askQualificationQuestions() {}
async function recommendProducts() {}
async function generateAndSendQuote() {}
async function collectOrderDetails() {}
async function sendInvoice() {}
async function notifyAdmin() {}
async function scheduleFollowUp() {}
```

- [ ] **Step 2: Create transition logic**

```typescript
// src/fsm/transitions.ts
import { LeadState } from "../types/lead";
import { TransitionContext } from "../types/fsm";
import { VALID_TRANSITIONS } from "./states";

export class TransitionError extends Error {
  constructor(from: LeadState, to: LeadState, reason: string) {
    super(`Cannot transition from ${from} to ${to}: ${reason}`);
    this.name = "TransitionError";
  }
}

export async function canTransition(
  from: LeadState,
  to: LeadState,
  context: TransitionContext
): Promise<boolean> {
  const allowedTransitions = VALID_TRANSITIONS[from];

  if (!allowedTransitions.includes(to)) {
    return false;
  }

  // Additional business logic checks
  if (to === "FAILED" && from === "LEAD_CAPTURE") {
    // Can only fail if spam detected
    const isSpam = await checkSpam(context.message);
    return isSpam;
  }

  if (to === "ESCALATION") {
    // Escalation requires a reason
    return !!context.extractedData?.escalationReason;
  }

  return true;
}

async function checkSpam(message: string): Promise<boolean> {
  const spamKeywords = ["crypto", "investment", "lottery", "prize", "winner"];
  return spamKeywords.some(k => message.toLowerCase().includes(k));
}

export async function executeTransition(
  from: LeadState,
  to: LeadState,
  context: TransitionContext
): Promise<void> {
  const canTransition = await canTransition(from, to, context);

  if (!canTransition) {
    throw new TransitionError(from, to, "Transition not allowed");
  }

  // Execute exit actions for current state
  // Execute entry actions for new state
}
```

- [ ] **Step 3: Create FSM router**

```typescript
// src/fsm/router.ts
import { leadService } from "../services/lead";
import { extractIntent, extractWithRegex } from "../services/llm";
import { handleLeadMessage } from "../handlers/lead";
import { handleQuoteMessage } from "../handlers/quote";
import { FSM_STATES } from "./states";

export interface FSMRouterResult {
  success: boolean;
  replyMessage?: string;
  newState?: string;
  error?: string;
}

export async function routeMessage(
  lineUserId: string,
  message: string
): Promise<FSMRouterResult> {
  try {
    // Get or create lead
    const lead = await leadService.getOrCreateLead(lineUserId);
    const currentState = lead.state;

    // Update last message timestamp
    await leadService.updateLead(lineUserId, { lastMessageAt: new Date() });

    // Route based on state
    switch (currentState) {
      case "LEAD_CAPTURE":
      case "QUALIFY_BULK_INTENT":
      case "PRODUCT_DISCOVERY":
        return handleLeadMessage(lead, message);

      case "QUOTE_GENERATION":
      case "NEGOTIATION":
        return handleQuoteMessage(lead, message);

      case "ORDER_CONFIRMATION":
        return handleOrderConfirmation(lead, message);

      case "PAYMENT_PENDING":
        return {
          success: true,
          replyMessage: "รอการยืนยันการชำระเงินครับ",
        };

      case "ESCALATION":
        return {
          success: true,
          replyMessage: "เจ้าหน้าที่ของเราจะติดต่อกลับเร็วๆ นี้ครับ",
        };

      case "RETENTION_LOOP":
        return handleRetentionLoop(lead, message);

      case "CANCELLED":
      case "FAILED":
        return {
          success: false,
          replyMessage: "ขออภัย เราไม่สามารถดำเนินการต่อได้",
        };

      default:
        return {
          success: false,
          error: `Unknown state: ${currentState}`,
        };
    }
  } catch (error) {
    console.error("FSM router error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function handleOrderConfirmation() {
  // TODO: Implement order detail collection
  return { success: true, replyMessage: "รับทราบครับ" };
}

async function handleRetentionLoop() {
  // TODO: Implement retention nurturing
  return { success: true, replyMessage: "ขอบคุณที่สนใจวันชาครับ" };
}
```

- [ ] **Step 4: Create lead handler**

```typescript
// src/handlers/lead.ts
import { LeadDocument } from "../types/lead";
import { leadService } from "../services/lead";
import { extractIntent, extractWithRegex } from "../services/llm";
import { lineService } from "../services/LineService";

export async function handleLeadMessage(
  lead: LeadDocument,
  message: string
): Promise<{ success: boolean; replyMessage?: string; newState?: string }> {
  try {
    // Extract intent with LLM
    const extraction = await extractIntent(message, { type: "lead_capture" });

    // Fallback to regex if LLM fails
    if (!extraction.success) {
      const regexData = extractWithRegex(message);
      return handleWithExtractedData(lead, message, regexData);
    }

    if (extraction.needsClarification && extraction.clarificationQuestions) {
      // Ask clarifying questions
      const questions = extraction.clarificationQuestions.join("\n");
      return {
        success: true,
        replyMessage: `ขอข้อมูลเพิ่มเติมครับ:\n${questions}`,
      };
    }

    return handleWithExtractedData(lead, message, extraction.data || {});
  } catch (error) {
    console.error("Lead handler error:", error);
    return {
      success: false,
      replyMessage: "ขออภัย เกิดข้อผิดพลาดชั่วคราว",
    };
  }
}

async function handleWithExtractedData(
  lead: LeadDocument,
  message: string,
  data: Record<string, unknown>
): Promise<{ success: boolean; replyMessage?: string; newState?: string }> {
  const currentState = lead.state;

  if (currentState === "LEAD_CAPTURE") {
    // Update lead with extracted data
    const updateData: Partial<LeadDocument> = {};

    if (data.caféName) {
      updateData.caféName = data.caféName as string;
    }
    if (data.location) {
      updateData.location = data.location as string;
    }
    if (data.monthlyUsageGrams) {
      updateData.monthlyUsageGrams = data.monthlyUsageGrams as number;
    }
    if (data.requestedQuantityGrams) {
      updateData.requestedQuantityGrams = data.requestedQuantityGrams as number;
    }

    await leadService.updateLead(lead.lineUserId, updateData);

    // Check if we have enough info to qualify
    const quantity = updateData.requestedQuantityGrams || lead.requestedQuantityGrams;
    if (quantity && quantity >= 500) {
      // Transition to PRODUCT_DISCOVERY
      const newLead = await leadService.transitionLead(
        lead.lineUserId,
        "LEAD_CAPTURE",
        "PRODUCT_DISCOVERY"
      );

      return {
        success: true,
        replyMessage: `ขอบคุณครับ! เราขอแนะนำชาเขียวมัทฉะเกรด${quantity >= 1000 ? "พรีเมียม" : "คาเฟ่"} เหมาะสำหรับร้านของคุณ`,
        newState: "PRODUCT_DISCOVERY",
      };
    }

    // Not enough info, stay in LEAD_CAPTURE
    return {
      success: true,
      replyMessage: "ขอถามเพิ่มเติมครับ: คุณต้องการมัทฉะปริมาณเท่าไรครับ? (ขั้นต่ำ 500g)",
    };
  }

  if (currentState === "QUALIFY_BULK_INTENT") {
    // Similar logic for qualification
    return { success: true, replyMessage: "รับทราบครับ" };
  }

  if (currentState === "PRODUCT_DISCOVERY") {
    // Transition to quote generation
    const newLead = await leadService.transitionLead(
      lead.lineUserId,
      "PRODUCT_DISCOVERY",
      "QUOTE_GENERATION"
    );

    return {
      success: true,
      replyMessage: "เรากำลังเตรียมใบเสนอราคาให้ครับ",
      newState: "QUOTE_GENERATION",
    };
  }

  return { success: true, replyMessage: "รับทราบครับ" };
}
```

- [ ] **Step 5: Create quote handler**

```typescript
// src/handlers/quote.ts
import { LeadDocument } from "../types/lead";
import { quoteService } from "../services/quote";
import { extractIntent } from "../services/llm";
import { ObjectId } from "mongodb";

export async function handleQuoteMessage(
  lead: LeadDocument,
  message: string
): Promise<{ success: boolean; replyMessage?: string; newState?: string }> {
  try {
    const currentState = lead.state;

    if (currentState === "QUOTE_GENERATION") {
      // Generate initial quote
      if (!lead.activeQuoteId) {
        const quote = await quoteService.generateQuote(
          lead._id!,
          lead.lineUserId,
          [
            {
              productId: "matcha-cafe-500",
              productName: "มัทฉะ คาเฟ่ เกรด 500g",
              grade: "cafe",
              quantityGrams: lead.requestedQuantityGrams || 500,
            },
          ],
          0
        );

        await leadService.updateLead(lead.lineUserId, {
          activeQuoteId: quote._id!,
        });

        const formattedQuote = formatQuoteMessage(quote);
        return {
          success: true,
          replyMessage: formattedQuote,
          newState: "NEGOTIATION",
        };
      }
    }

    if (currentState === "NEGOTIATION") {
      // Handle negotiation
      const extraction = await extractIntent(message, { type: "negotiation" });

      if (extraction.success && extraction.data) {
        const requestedDiscount = extraction.data.requestedDiscountPercentage as number || 0;

        if (requestedDiscount <= 10) {
          // Auto-approve
          const quote = await quoteService.getActiveQuoteForLead(lead._id!);
          if (quote) {
            await quoteService.addNegotiation(
              quote._id!,
              requestedDiscount,
              requestedDiscount,
              "Auto-approved (< 10%)"
            );

            const updatedQuote = await quoteService.getQuote(quote._id!);
            if (updatedQuote) {
              return {
                success: true,
                replyMessage: `ยินดีด้วย! เราอนุมัติส่วนลด ${requestedDiscount}%\n\n${formatQuoteMessage(updatedQuote)}`,
                newState: "ORDER_CONFIRMATION",
              };
            }
          }
        } else if (requestedDiscount <= 20) {
          return {
            success: true,
            replyMessage: "ขอตรวจสอบกับทีมงานสักครู่นะครับ",
          };
        } else {
          // Escalate
          await leadService.transitionLead(
            lead.lineUserId,
            "NEGOTIATION",
            "ESCALATION"
          );

          // Notify admin
          await notifyAdminEscalation(lead, requestedDiscount);

          return {
            success: true,
            replyMessage: "เราจะให้ทีมงานติดต่อกลับเพื่อ讨论รายละเอียดครับ",
            newState: "ESCALATION",
          };
        }
      }
    }

    return { success: true, replyMessage: "รับทราบครับ" };
  } catch (error) {
    console.error("Quote handler error:", error);
    return {
      success: false,
      replyMessage: "ขออภัย เกิดข้อผิดพลาด",
    };
  }
}

function formatQuoteMessage(quote: any): string {
  const items = quote.items.map((item: any) =>
    `- ${item.productName} ${item.quantityGrams}g: ${item.subtotal} บาท`
  ).join("\n");

  return `📋 ใบเสนอราคา

${items}

ย่อย: ${quote.subtotal} บาท
ส่วนลด: ${quote.discountPercentage}% (-${quote.discountAmount} บาท)
ค่าส่ง: ${quote.shippingCost} บาท
─────────────────
รวม: ${quote.totalAmount} บาท

พิมพ์ "ตกลง" เพื่อยืนยัน หรือขอส่วนลดเพิ่มเติมครับ`;
}

async function notifyAdminEscalation(lead: LeadDocument, discount: number) {
  // TODO: Send LINE message to admin group
  console.log(`Escalation: Lead ${lead.lineUserId} requested ${discount}% discount`);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/fsm/states.ts src/fsm/transitions.ts src/fsm/router.ts src/handlers/lead.ts src/handlers/quote.ts
git commit -m "feat(fsm): add FSM router and state handlers for lead/quote flow"
```

---

## Chunk 6: Webhook Integration

### Task 6: Integrate FSM with LINE Webhook

**Files:**
- Modify: `src/handlers/webhook.ts`

- [ ] **Step 1: Update webhook handler to route to FSM**

```typescript
// src/handlers/webhook.ts - Modify handleMessage function
import { routeMessage } from "../fsm/router";

async function handleMessage(event: MessageEvent): Promise<WebhookHandlerResult> {
  const userId = event.source.userId;
  const replyToken = event.replyToken;

  if (!userId) {
    return { status: "error", error: "No user ID in message event" };
  }

  if (event.message.type !== "text") {
    return { status: "ignored", message: "Non-text message ignored" };
  }

  const text = (event.message as TextMessageContent).text.trim();

  // Check for pending tracking input (existing fulfillment flow)
  const pendingState = await getPendingState(userId);
  if (pendingState && !isStateExpired(pendingState)) {
    if (pendingState.pendingAction === "awaiting_tracking_number") {
      return await handleTrackingInput(userId, replyToken, text, pendingState);
    }
  }

  // Check for admin commands (existing fulfillment flow)
  const isMentioned = text.toLowerCase().startsWith("onecha") ||
                      text.toLowerCase().startsWith("วันชา");

  if (!isMentioned) {
    // Route to FSM for bulk order handling
    const fsmResult = await routeMessage(userId, text);

    if (fsmResult.success && fsmResult.replyMessage) {
      await lineService.replyMessage(replyToken, {
        type: "text",
        text: fsmResult.replyMessage,
      });
    } else if (fsmResult.error) {
      console.error("FSM error:", fsmResult.error);
    }

    return { status: "success", message: "Routed to FSM" };
  }

  // Admin check before showing dashboard
  if (!(await isAdmin(userId))) {
    return { status: "ignored", message: "Unauthorized" };
  }

  // Show command dashboard (existing fulfillment flow)
  const message = buildCommandDashboard();
  await lineService.replyMessage(replyToken, message);
  return { status: "success", message: "Command dashboard sent" };
}
```

- [ ] **Step 2: Test webhook integration**

Run the dev server and test with LINE messaging:

```bash
npm run dev
```

Expected: Messages to the bot should now trigger FSM flow.

- [ ] **Step 3: Commit**

```bash
git add src/handlers/webhook.ts
git commit -m "feat(webhook): integrate FSM router for non-command messages"
```

---

## Testing Checklist

Before marking complete, verify:

- [ ] `npm run setup-fsm-indexes` creates indexes successfully
- [ ] Leading with "I want 1kg matcha" → LEAD_CAPTURE → QUALIFY flow
- [ ] Quantity >= 500g → transitions to PRODUCT_DISCOVERY
- [ ] Quote generation → shows formatted quote
- [ ] Negotiation < 10% → auto-approved
- [ ] Negotiation > 20% → ESCALATION
- [ ] Admin commands ("วันชา") still work for fulfillment

---

## Execution Handoff

The plan is saved to `docs/plans/2026-03-17-line-bulk-order-fsm.md`.

**Ready to execute?** Say: **"Execute the plan at `docs/plans/2026-03-17-line-bulk-order-fsm.md` using subagent-driven-development."**
