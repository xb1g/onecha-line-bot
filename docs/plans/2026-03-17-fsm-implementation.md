# FSM Implementation Plan — Onecha LINE Bot

> **Generated from:** CEO Plan Review (2026-03-17)
> **Mode:** SCOPE EXPANSION
> **Status:** Ready for implementation

---

## Executive Summary

This plan implements a Finite State Machine (FSM) for B2B lead qualification and quote generation in the Onecha LINE Bot. The system routes customer conversations through an 11-state machine, extracts intent via LLM, generates quotes with negotiation logic, and hands off to human operators when needed.

**Prime Directive:** Zero silent failures. Every error has a name, every failure mode is logged, every data flow has shadow path handling.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ONECHA LINE BOT — FSM ARCHITECTURE              │
└─────────────────────────────────────────────────────────────────────────┘

                              EXTERNAL SERVICES
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   LINE API       │    │   OpenAI API     │    │   MongoDB Atlas  │
│  (Webhooks,      │    │  (Intent         │    │   (Shared with   │
│   Messaging)     │    │   Extraction)    │    │    Main App)     │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         │ POST /api/webhook     │ HTTPS (10s timeout)   │ BSON over TLS
         ▼                       ▼                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          VERCEL SERVERLESS                             │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      src/handlers/webhook.ts                     │  │
│  │                           │                                       │  │
│  │         ┌─────────────────┴──────────────────┐                   │  │
│  │         │   getConversationContext()          │                   │  │
│  │         │   (Admin vs Customer classification)│                   │  │
│  │         └──────────────────┬──────────────────┘                   │  │
│  └────────────────────────────┼──────────────────────────────────────┘  │
│                               │                                         │
│  ┌────────────────────────────┼──────────────────────────────────────┐  │
│  │         FSM ROUTING       │           FULFILLMENT                 │  │
│  │  ┌─────────────────────┐  │  ┌────────────────────────────────┐   │  │
│  │  │ src/fsm/router.ts   │  │  │ src/services/fulfillment.ts    │   │  │
│  │  │ - routeMessage()    │  │  │ - acceptOrder()                │   │  │
│  │  │ - transitionLead()  │  │  │ - shipOrder()                  │   │  │
│  │  └──────────┬──────────┘  │  │ - getDailyDigestOrders()       │   │  │
│  │             │             │  └────────────────────────────────┘   │  │
│  │  ┌──────────┴──────────┐  │                                       │  │
│  │  │ src/handlers/       │  │  ┌────────────────────────────────┐   │  │
│  │  │ - lead.ts           │  │  │ src/services/                  │   │  │
│  │  │ - quote.ts          │  │  │ - line-client.ts               │   │  │
│  │  └──────────┬──────────┘  │  │ - lead.ts                      │   │  │
│  │             │             │  │ - quote.ts                     │   │  │
│  │             └─────────────┴──│ - llm.ts                       │   │  │
│  │                              └────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┼─────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           MONGODB COLLECTIONS                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ leads        │  │ quotes       │  │ line_groups  │  │ bot_state  │ │
│  │ - FSM state  │  │ - Price calc │  │ - Role map   │  │ - Legacy   │ │
│  │ - LLM extr.  │  │ - Negotiation│  │ - Joined at  │  │ - TTL      │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘ │
│  ┌──────────────┐  ┌──────────────┐                                    │
│  │ orders       │  │ customers    │                                    │
│  │ (Shared)     │  │ (Shared)     │                                    │
│  └──────────────┘  └──────────────┘                                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## FSM State Machine

```
┌────────────────────────────────────────────────────────────────────────┐
│                    LEAD FSM STATE TRANSITION DIAGRAM                   │
└────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────┐
                              │   (START)   │
                              └──────┬──────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   LEAD_CAPTURE      │◄──────┐
                          │  - Name capture     │       │
                          │  - Contact info     │       │
                          │  - Order history    │       │
                          └──────────┬──────────┘       │
                                     │                  │
                                     ▼                  │
                          ┌─────────────────────┐       │
                          │ QUALIFY_BULK_INTENT │       │
                          │  - Business type    │       │
                          │  - Monthly usage    │       │
                          │  - Price sensitivity│       │
                          └──────────┬──────────┘       │
                                     │                  │
                                     ▼                  │
                          ┌─────────────────────┐       │
                          │  PRODUCT_DISCOVERY  │       │
                          │  - Product interest │       │
                          │  - Grade preference │       │
                          │  - Volume needs     │       │
                          └──────────┬──────────┘       │
                                     │                  │
                                     ▼                  │
                          ┌─────────────────────┐       │
                          │  QUOTE_GENERATION   │       │
                          │  - Generate quote   │       │
                          │  - Show breakdown   │       │
                          │  - Negotiation      │───────┘
                          └──────────┬──────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
             ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
             │ ESCALATION  │ │ORDER_CONFIRM│ │NEGOTIATION  │
             │(Human take) │ │- Finalize   │ │- Counter    │
             └─────────────┘ └──────┬──────┘ └─────────────┘
                                    │
                                    ▼
                             ┌─────────────┐
                             │PAYMENT_PENDING│
                             │- Wait xfer  │
                             └──────┬──────┘
                                    │
                                    ▼
                             ┌─────────────┐
                             │ CANCELLED   │
                             └─────────────┘
```

---

## Implementation Tasks

### Phase 0: Pre-Implementation Cleanup (REQUIRED BEFORE PHASE 1)

> **Rationale:** The CEO review identified critical DRY violations and security gaps that will cause problems during implementation. Fix these first.

---

#### Task 0.1: Consolidate `VALID_TRANSITIONS` (P1, Small)

**Problem:** Duplicate transition tables in `src/services/lead.ts:54-66` and `src/fsm/states.ts:3-15` with conflicting transitions.

**Fix:**
1. Delete `VALID_TRANSITIONS` from `src/services/lead.ts`
2. Import from `src/fsm/states.ts` instead
3. Update `LeadService.transitionLead()` to use imported constant

**Files:**
- `src/services/lead.ts` — delete lines 54-66, update import
- `src/fsm/states.ts` — no change (source of truth)

**Test:**
```bash
bun run scripts/test-transition-table.ts
# Should verify all 11 states have valid transitions defined
```

---

#### Task 0.2: Consolidate `LeadDocument` Type (P1, Small)

**Problem:** Duplicate `LeadDocument` type in `src/handlers/lead.ts:4-15` and `src/types/lead.ts:21-49`.

**Fix:**
1. Delete duplicate type from `src/handlers/lead.ts`
2. Import from `src/types/lead.ts` instead

**Files:**
- `src/handlers/lead.ts` — delete lines 4-15, update import
- `src/types/lead.ts` — no change (source of truth)

**Test:**
```bash
bun run typecheck
# Should have no type errors
```

---

#### Task 0.3: Add Structured Logging (P2, Small)

**Problem:** Error responses lose `leadId` context, making debugging impossible.

**Fix:**
1. Create `src/lib/logger.ts` with structured logging helper
2. Update all error logging to include: `leadId`, `userId`, `state`, `error.name`, `error.message`

**Files:**
- `src/lib/logger.ts` — new file
- `src/handlers/lead.ts` — update error logging
- `src/handlers/quote.ts` — update error logging
- `src/fsm/router.ts` — update error logging

**Test:**
```bash
bun run dev
# Trigger an error, verify log includes leadId
```

---

#### Task 0.4: Sanitize Negative Discount Input (P2, Small)

**Problem:** Security vulnerability — negative `requestedDiscount` values not sanitized, allowing infinite/free quotes.

**Fix:**
1. Sanitize at extraction boundary in `handleQuoteMessage()`
2. Clamp `requestedDiscount` to `[0, 100]` range
3. Reject negative values with error

**Files:**
- `src/handlers/quote.ts` — add sanitization before negotiation logic

**Test:**
```typescript
// Test case: negative discount attempt
const result = handleQuoteMessage({ requestedDiscount: -50 });
// Should reject with error, not calculate infinite discount
```

---

### Phase 1: Core FSM Infrastructure

---

#### Task 1.1: Implement FSM State Transitions

**Goal:** Ensure all 11 states have validated transitions with logging.

**Steps:**
1. Verify `src/fsm/states.ts` has all 11 states defined
2. Verify `VALID_TRANSITIONS` table is complete
3. Add transition logging (state A → state B, with leadId, timestamp)
4. Add validation: reject invalid transitions with descriptive error

**Files:**
- `src/fsm/states.ts` — verify complete
- `src/services/lead.ts` — add transition logging
- `src/fsm/router.ts` — add validation

**Test:**
```bash
bun run test:unit src/services/lead.test.ts
# Test all valid transitions
# Test all invalid transitions (should reject)
```

---

#### Task 1.2: Implement Auto-Pilot State Transitions

**Goal:** Handle simple transitions automatically (e.g., empty message → prompt for input).

**Steps:**
1. Define auto-pilot rules in `src/fsm/auto-pilot.ts`
2. Implement in `src/fsm/router.ts:35-52` (existing, needs fix)
3. Add logging for auto-pilot decisions
4. Add escape hatch: user can type "speak to human" → ESCALATION

**Files:**
- `src/fsm/auto-pilot.ts` — new file
- `src/fsm/router.ts` — update auto-pilot logic

**Test:**
```bash
bun run test:unit src/fsm/auto-pilot.test.ts
```

---

#### Task 1.3: Add FSM Transition Logging

**Goal:** Every state transition is logged for debugging and analytics.

**Steps:**
1. Create `fsm_transitions` collection in MongoDB
2. Log: `leadId`, `fromState`, `toState`, `trigger`, `timestamp`, `userId`
3. Add index: `leadId + timestamp` for query performance

**Files:**
- `src/lib/mongodb.ts` — add `fsm_transitions` collection helper
- `src/services/lead.ts` — log transitions
- `scripts/setup-fsm-indexes.ts` — add index for `fsm_transitions`

**Test:**
```bash
bun run scripts/setup-fsm-indexes.ts
mongosh --eval "db.fsm_transitions.find().limit(5)"
```

---

### Phase 2: LLM Intent Extraction

---

#### Task 2.1: Verify LLM Extraction Fallback Chain

**Goal:** Ensure graceful degradation when OpenAI fails.

**Steps:**
1. Verify `extractIntent()` has 10s timeout (already done)
2. Verify fallback to `extractWithRegex()` on timeout/rate limit
3. Add structured logging for fallback events
4. Add metrics: count LLM success vs fallback

**Files:**
- `src/services/llm.ts` — verify timeout and fallback
- `src/lib/metrics.ts` — new file for counters

**Test:**
```bash
# Mock OpenAI timeout, verify regex fallback works
bun run test:unit src/services/llm.test.ts
```

---

#### Task 2.2: Add Rate Limiting for OpenAI Calls

**Goal:** Prevent rate limit errors under load.

**Steps:**
1. Add token bucket rate limiter (max 10 req/min per conversation)
2. Queue requests when rate limited
3. Return "Please wait" message to user if queue is full

**Files:**
- `src/lib/rate-limiter.ts` — new file
- `src/services/llm.ts` — integrate rate limiter

**Test:**
```bash
# Send 15 rapid requests, verify 10 succeed, 5 queue/reject
bun run test:integration src/lib/rate-limiter.test.ts
```

---

#### Task 2.3: Handle LLM Hallucination

**Goal:** LLM returns invalid JSON or hallucinates fields.

**Steps:**
1. Add JSON schema validation for LLM response
2. Reject responses missing required fields
3. Log hallucination events for model tuning
4. Fallback to regex on validation failure

**Files:**
- `src/services/llm.ts` — add schema validation
- `src/types/llm-extraction.ts` — new schema type

**Test:**
```bash
# Feed malformed JSON, verify graceful fallback
bun run test:unit src/services/llm.test.ts
```

---

### Phase 3: Quote Generation & Negotiation

---

#### Task 3.1: Verify Quote Generation Logic

**Goal:** Quotes calculate correctly with all pricing tiers.

**Steps:**
1. Verify `PRICE_PER_GRAM` rates in `src/services/quote.ts`
2. Verify free shipping threshold (5000 THB)
3. Add test cases for all 4 pricing tiers
4. Add overflow protection (max quantity, max total)

**Files:**
- `src/services/quote.ts` — verify pricing logic
- `src/services/quote.test.ts` — add comprehensive tests

**Test:**
```bash
bun run test:unit src/services/quote.test.ts
# Test ceremonial, premium, cafe, culinary tiers
# Test free shipping threshold
# Test overflow (quantity > 10000)
```

---

#### Task 3.2: Implement Negotiation Approval Flow

**Goal:** Auto-approve ≤10%, review 10-20%, escalate >20%.

**Steps:**
1. Verify `addNegotiation()` enforces thresholds
2. Add logging for negotiation attempts
3. Add ESCALATION state trigger for >20% requests
4. Notify human operators on escalation (LINE message to admin groups)

**Files:**
- `src/handlers/quote.ts` — verify threshold logic
- `src/services/line-client.ts` — add escalation notification

**Test:**
```bash
bun run test:unit src/handlers/quote.test.ts
# Test 5% → auto-approve
# Test 15% → review
# Test 25% → escalate
```

---

#### Task 3.3: Add Quote Expiry Check

**Goal:** Quotes expire after 7 days, preventing stale negotiations.

**Steps:**
1. Add `expiresAt` field to `QuoteDocument`
2. Check expiry in `handleQuoteMessage()`
3. Return "Quote expired" message if expired
4. Create cleanup job for expired quotes (daily cron)

**Files:**
- `src/types/lead.ts` — add `expiresAt` to `QuoteDocument`
- `src/handlers/quote.ts` — add expiry check
- `src/services/quote.ts` — set `expiresAt` on creation
- `src/cron/cleanup-quotes.ts` — new cron job

**Test:**
```bash
# Create expired quote, verify rejection
bun run test:unit src/handlers/quote.test.ts
```

---

### Phase 4: Error Handling & Observability

---

#### Task 4.1: Fix All Critical Error Gaps

**Goal:** Zero unrescued errors in production.

**Steps:**
1. Add rescue for all 11 gaps from Error & Rescue Registry
2. Each rescue must: log with context, return user-friendly message
3. Add retry logic for transient failures (MongoDB, OpenAI)

**Files:**
- `src/handlers/lead.ts` — add rescues
- `src/handlers/quote.ts` — add rescues
- `src/fsm/router.ts` — add rescues
- `src/services/line-client.ts` — add 429 rescue

**Test:**
```bash
# Trigger each error type, verify graceful handling
bun run test:integration src/handlers/error-handling.test.ts
```

---

#### Task 4.2: Add Metrics & Dashboards

**Goal:** Visibility into FSM health.

**Steps:**
1. Define metrics: `fsm_transitions_total`, `llm_fallback_rate`, `quote_generation_success`
2. Export metrics to Prometheus format (or Vercel-compatible alternative)
3. Create dashboard panels:
   - FSM state distribution (pie chart)
   - Transition rate (timeseries)
   - LLM fallback rate (timeseries)
   - Quote generation success rate (timeseries)

**Files:**
- `src/lib/metrics.ts` — new file
- `src/api/metrics.ts` — new endpoint (if Prometheus)
- `docs/dashboards/fsm-health.json` — dashboard definition

**Test:**
```bash
# Verify metrics endpoint returns valid data
curl https://your-domain.vercel.app/api/metrics
```

---

#### Task 4.3: Add Alerts

**Goal:** Know when FSM breaks.

**Steps:**
1. Define alert thresholds:
   - >5 errors/minute from same state → PagerDuty
   - >50% LLM fallback rate → Slack alert
   - MongoDB connection errors → Immediate page
2. Implement alerting (use Vercel Alerts or external service)
3. Write runbooks for each alert

**Files:**
- `src/lib/alerts.ts` — new file
- `docs/runbooks/` — new directory with runbooks

**Test:**
```bash
# Trigger alert conditions in staging, verify notifications received
```

---

### Phase 5: Testing & Quality

---

#### Task 5.1: Write Unit Tests

**Goal:** 80%+ code coverage for FSM code.

**Steps:**
1. Write tests for all 11 state transitions
2. Write tests for all error paths
3. Write tests for LLM extraction (success, timeout, rate limit, malformed)
4. Write tests for quote calculation (all tiers, edge cases)

**Files:**
- `src/fsm/router.test.ts`
- `src/services/lead.test.ts`
- `src/services/quote.test.ts`
- `src/services/llm.test.ts`
- `src/handlers/lead.test.ts`
- `src/handlers/quote.test.ts`

**Test:**
```bash
bun run test --coverage
# Verify >80% coverage
```

---

#### Task 5.2: Write Integration Tests

**Goal:** Test full FSM flows end-to-end.

**Steps:**
1. Test complete lead → quote → order flow
2. Test escalation flow (human takeover)
3. Test negotiation flow (counter-offers)
4. Test error recovery (LLM fails, fallback to regex)

**Files:**
- `src/tests/integration/fsm-flow.test.ts`
- `src/tests/integration/quote-flow.test.ts`
- `src/tests/integration/escalation-flow.test.ts`

**Test:**
```bash
bun run test:integration
```

---

#### Task 5.3: Write Chaos Tests

**Goal:** Test resilience under adverse conditions.

**Steps:**
1. Randomly fail LLM calls (50% failure rate)
2. Randomly fail MongoDB writes
3. Inject latency (1-5s delays)
4. Verify FSM recovers gracefully

**Files:**
- `src/tests/chaos/fsm-resilience.test.ts`

**Test:**
```bash
bun run test:chaos
```

---

### Phase 6: Deployment & Rollout

---

#### Task 6.1: Run Database Migrations

**Goal:** Create all required indexes before deploy.

**Steps:**
1. Run `bun run scripts/setup-fsm-indexes.ts`
2. Verify indexes in MongoDB Atlas UI
3. Wait for index build completion

**Test:**
```bash
mongosh --eval "db.leads.getIndexes()"
mongosh --eval "db.quotes.getIndexes()"
```

---

#### Task 6.2: Deploy to Staging

**Goal:** Test in staging environment before production.

**Steps:**
1. Deploy to Vercel staging environment
2. Run smoke tests
3. Verify all 11 states work correctly
4. Get second pair of eyes (PR review)

**Test:**
```bash
bunx vercel --staging
# Run smoke tests manually
```

---

#### Task 6.3: Deploy to Production

**Goal:** Safe production rollout.

**Steps:**
1. Deploy to Vercel production
2. Run post-deploy smoke tests
3. Monitor metrics for 1 hour
4. Document deployment in changelog

**Test:**
```bash
bunx vercel --prod
# Run smoke tests manually
# Monitor Vercel dashboard
```

---

#### Task 6.4: Write Rollback Plan

**Goal:** Know how to undo if deployment fails.

**Steps:**
1. Document rollback commands in `docs/runbooks/rollback.md`
2. Test rollback in staging
3. Verify data integrity after rollback

**Files:**
- `docs/runbooks/rollback.md` — new file

---

### Phase 7: Post-Launch

---

#### Task 7.1: Monitor for 7 Days

**Goal:** Catch any issues that slip through testing.

**Steps:**
1. Check metrics daily
2. Review error logs daily
3. Respond to alerts immediately
4. Document any incidents

**Test:**
```bash
# Daily check:
curl https://your-domain.vercel.app/api/metrics
# Review Vercel logs
bunx vercel logs api/webhook
```

---

#### Task 7.2: Write Post-Mortem

**Goal:** Learn from the implementation.

**Steps:**
1. Document what went well
2. Document what went wrong
3. Document lessons learned
4. Update this plan for next time

**Files:**
- `docs/postmortems/2026-03-fsm-implementation.md` — new file

---

#### Task 7.3: Plan Phase 2 Features

**Goal:** Define next iteration.

**Steps:**
1. Real-time sync with main Onecha app
2. Customer LINE user ID linking
3. Rich analytics dashboard
4. Multi-language support (English, Burmese)

**Files:**
- `docs/plans/2026-04-fsm-phase-2.md` — new file

---

## NOT in Scope

The following items are explicitly deferred:

1. **Real-time sync with main Onecha app** — Requires WebSocket/polling infrastructure. Phase 2.
2. **Customer LINE user ID linking** — Requires opt-in flow, privacy policy updates. Phase 2.
3. **Rich analytics dashboard** — Beyond basic metrics. Phase 3.
4. **Multi-language support** — Thai-only for MVP. Phase 2.
5. **Automated refund handling** — Requires payment gateway integration. Out of scope.
6. **Voice message processing** — Requires audio transcription. Out of scope.
7. **Group member enumeration** — Privacy concern. Defer until needed.
8. **Quote template customization** — Hardcoded pricing works for MVP.
9. **Automated carrier API integration** — Manual tracking URL entry is sufficient.
10. **Bulk quote generation** — One quote per conversation is right granularity.

---

## Dream State Delta

```
CURRENT STATE (Post-Plan)          12-MONTH IDEAL
────────────────────────────────   ─────────────────────────────────
• Single TypeScript codebase       • Shared monorepo with main app
• Ad-hoc FSM transitions           • Formal state machine library (XState)
• Manual MongoDB connection        • ORM with migration framework
• OpenAI direct calls              • Abstraction layer with fallback models
• TypeScript types duplicated      • Generated types from shared schema
• No rate limiting                 • Token bucket rate limiting per user
• Basic error logging              • Structured logging (Winston/Pino)
• No distributed tracing           • OpenTelemetry traces
• Manual deployment                • CI/CD with preview environments
• Ad-hoc testing                   • 80%+ coverage with E2E suite

DELTA: ~6 months of technical debt paydown to reach platform maturity.
```

---

## Error & Rescue Registry

| Method/Codepath | What Can Go Wrong | Exception Class | Rescued? | Rescue Action | User Sees |
|-----------------|-------------------|-----------------|----------|---------------|-----------|
| `handlePostback` | Missing order ID | Undefined | Y | Reply error message | "ไม่พบรหัสออเดอร์" |
| `handlePostback` | Order not found | RecordNotFound | **N → GAP** | Add rescue, return 404 | "ไม่พบออเดอร์" |
| `handlePostback` | Invalid transition | InvalidTransitionError | **N → GAP** | Add rescue, log with leadId | "เกิดข้อผิดพลาด" |
| `handleLeadMessage` | LLM extraction fails | OpenAI.APIError | Y | Fallback to regex | Continues (degraded) |
| `handleLeadMessage` | Regex extraction fails | ExtractionError | **N → GAP** | Add rescue, escalate to human | "ขออภัย ระบบไม่เข้าใจ" |
| `handleLeadMessage` | MongoDB insert fails | MongoServerError | **N → GAP** | Add rescue, retry with backoff | "ระบบกำลังมีปัญหา" |
| `handleQuoteMessage` | Negative discount injection | LogicError | **N → GAP** | **SECURITY** — Sanitize at boundary | "ส่วนลดไม่ถูกต้อง" |
| `handleQuoteMessage` | Quote not found | RecordNotFound | **N → GAP** | Add rescue, return 404 | "ไม่พบใบเสนอราคา" |
| `handleQuoteMessage` | Price calculation overflow | RangeError | **N → GAP** | Add validation, clamp values | "กรุณาตรวจสอบจำนวน" |
| `extractIntent` | OpenAI timeout | AbortError | Y | Return null, fallback | Continues (degraded) |
| `extractIntent` | OpenAI rate limit | RateLimitError | **N → GAP** | Add exponential backoff | "กรุณารอสักครู่" |
| `extractIntent` | Malformed JSON response | JSONParseError | Y | Return null, fallback | Continues (degraded) |
| `transitionLead` | Invalid state transition | InvalidStateTransitionError | **N → GAP** | Add rescue, log attempt | "เกิดข้อผิดพลาด" |
| `transitionLead` | Concurrent modification | MongoServerError | **N → GAP** | Add optimistic locking | "กรุณาลองอีกครั้ง" |
| `sendFlexMessage` | LINE API timeout | AxiosError (ETIMEDOUT) | Y | Return false | Nothing (silent) |
| `sendFlexMessage` | LINE API 429 | AxiosError (429) | **N → GAP** | Add rate limiting queue | Nothing (silent) |
| `sendFlexMessage` | Invalid recipient | AxiosError (400) | Y | Return false | Nothing (silent) |
| `registerGroup` | MongoDB connection lost | MongoNetworkError | **N → GAP** | Add rescue, return error | "ระบบกำลังเชื่อมต่อ" |
| `registerGroup` | Duplicate key (race) | MongoServerError (E11000) | Y | Retry once | Works (transparent) |

**CRITICAL GAPS: 11** — All must be fixed before production.

---

## Failure Modes Registry

| Codepath | Failure Mode | Rescued? | Test? | User Sees | Logged? | Severity |
|----------|--------------|----------|-------|-----------|---------|----------|
| `handlePostback` | Missing order ID | Y | N | "ไม่พบรหัสออเดอร์" | Y | Low |
| `handlePostback` | Order not found | **N** | **N** | 500 error | Partial | **CRITICAL** |
| `handlePostback` | Invalid transition | **N** | **N** | 500 error | Partial | **CRITICAL** |
| `handleLeadMessage` | LLM extraction fails | Y | Y | Continues (degraded) | Y | OK |
| `handleLeadMessage` | Regex extraction fails | **N** | **N** | Silent failure | **N** | **CRITICAL** |
| `handleLeadMessage` | MongoDB insert fails | **N** | **N** | Silent failure | Partial | **CRITICAL** |
| `handleQuoteMessage` | Negative discount | **N** | **N** | Free/infinite quote | **N** | **CRITICAL** |
| `handleQuoteMessage` | Quote not found | **N** | **N** | 500 error | Partial | High |
| `handleQuoteMessage` | Price overflow | **N** | **N** | Garbage output | **N** | **CRITICAL** |
| `extractIntent` | OpenAI timeout | Y | Y | Continues (degraded) | Y | OK |
| `extractIntent` | OpenAI rate limit | **N** | **N** | 500 error | Partial | High |
| `extractIntent` | Malformed JSON | Y | Y | Continues (degraded) | Y | OK |
| `transitionLead` | Invalid transition | **N** | **N** | 500 error | Partial | High |
| `transitionLead` | Concurrent mod | **N** | **N** | 500 error | Partial | Medium |
| `sendFlexMessage` | LINE API timeout | Y | N | Nothing (silent) | Y | Medium |
| `sendFlexMessage` | LINE API 429 | **N** | **N** | Silent drop | **N** | **CRITICAL** |
| `sendFlexMessage` | Invalid recipient | Y | N | Nothing (silent) | Y | Low |
| `registerGroup` | Mongo connection lost | **N** | **N** | 500 error | Partial | High |
| `registerGroup` | Duplicate key (race) | Y | N | Works (transparent) | Y | OK |

**CRITICAL GAPS: 7** — Must be fixed before production.

---

## TODOS.md Updates

The following TODOs should be added to `TODOS.md`:

1. **Consolidate VALID_TRANSITIONS** (P1, Small) — Delete duplicate, import from `src/fsm/states.ts`
2. **Consolidate LeadDocument type** (P1, Small) — Delete duplicate, import from `src/types/lead.ts`
3. **Add structured logging** (P2, Small) — Create `src/lib/logger.ts`, update all handlers
4. **Sanitize negative discounts** (P2, Small) — Add validation at extraction boundary
5. **Add FSM transition logging** (P2, Medium) — Create `fsm_transitions` collection, log all transitions
6. **Add rate limiting for OpenAI** (P2, Medium) — Token bucket rate limiter in `src/lib/rate-limiter.ts`
7. **Handle LLM hallucination** (P2, Medium) — JSON schema validation for LLM responses
8. **Add quote expiry check** (P2, Small) — Check `expiresAt` in `handleQuoteMessage()`
9. **Add metrics & dashboards** (P3, Large) — Prometheus metrics, dashboard panels
10. **Add alerts with runbooks** (P3, Large) — Alert thresholds, PagerDuty/Slack integration
11. **Write comprehensive tests** (P1, Large) — Unit, integration, chaos tests

---

## Diagrams Produced

1. ✅ System Architecture
2. ✅ Data Flow (with shadow paths)
3. ✅ State Machine
4. ✅ Error Flow
5. ✅ Deployment Sequence
6. ✅ Rollback Flowchart

---

## Completion Checklist

```
PHASE 0: Pre-Implementation Cleanup
  [ ] Task 0.1: Consolidate VALID_TRANSITIONS
  [ ] Task 0.2: Consolidate LeadDocument type
  [ ] Task 0.3: Add structured logging
  [ ] Task 0.4: Sanitize negative discount input

PHASE 1: Core FSM Infrastructure
  [ ] Task 1.1: Implement FSM state transitions
  [ ] Task 1.2: Implement auto-pilot state transitions
  [ ] Task 1.3: Add FSM transition logging

PHASE 2: LLM Intent Extraction
  [ ] Task 2.1: Verify LLM extraction fallback chain
  [ ] Task 2.2: Add rate limiting for OpenAI calls
  [ ] Task 2.3: Handle LLM hallucination

PHASE 3: Quote Generation & Negotiation
  [ ] Task 3.1: Verify quote generation logic
  [ ] Task 3.2: Implement negotiation approval flow
  [ ] Task 3.3: Add quote expiry check

PHASE 4: Error Handling & Observability
  [ ] Task 4.1: Fix all critical error gaps
  [ ] Task 4.2: Add metrics & dashboards
  [ ] Task 4.3: Add alerts

PHASE 5: Testing & Quality
  [ ] Task 5.1: Write unit tests
  [ ] Task 5.2: Write integration tests
  [ ] Task 5.3: Write chaos tests

PHASE 6: Deployment & Rollout
  [ ] Task 6.1: Run database migrations
  [ ] Task 6.2: Deploy to staging
  [ ] Task 6.3: Deploy to production
  [ ] Task 6.4: Write rollback plan

PHASE 7: Post-Launch
  [ ] Task 7.1: Monitor for 7 days
  [ ] Task 7.2: Write post-mortem
  [ ] Task 7.3: Plan Phase 2 features
```

---

## Next Steps

1. **Start with Phase 0** — Complete all cleanup tasks before Phase 1
2. **Use `/plan-eng-review` skill** — For detailed engineering review of each phase
3. **Use `superpowers:executing-plans` skill** — To implement tasks one-by-one
4. **Create PR per phase** — Small, reviewable PRs

---

**Estimated Effort:** 3-4 weeks for full implementation (including testing and observability)

**Risk Level:** Medium — Security gaps (negative discount) and error handling gaps must be fixed before production.

**Reversibility:** 4/5 — Easy to roll back, no breaking database changes.
