# AGENTS.md

AI Agent instructions for working with the Onecha LINE Bot codebase.

## Project Overview

Onecha LINE Bot is a LINE Messaging Bot with dual functionality:
1. **Admin Fulfillment Bot** - Order management for internal team (accept, ship, track orders)
2. **Customer Lead Bot** - AI-powered sales assistant using FSM (Finite State Machine) with OpenAI GPT integration

### Tech Stack

- **Runtime**: Node.js with TypeScript
- **Package Manager**: Bun
- **Deployment**: Vercel Serverless Functions
- **Database**: MongoDB (shared with main Onecha app)
- **AI**: OpenAI GPT for intent extraction
- **Messaging**: LINE Messaging API via `@line/bot-sdk`

## Architecture

```
                    ┌─────────────────┐
                    │   LINE API      │
                    └────────┬────────┘
                             │ Webhook
                             ▼
                    ┌─────────────────┐
                    │  /api/webhook   │ (Vercel Function)
                    │  handleWebhook  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ isAdmin()  │  │   FSM      │  │  Customer  │
     │   Yes      │  │  Router    │  │  Handler   │
     └─────┬──────┘  └─────┬──────┘  └────────────┘
           │               │
           ▼               ▼
  ┌────────────────┐ ┌────────────────┐
  │ Admin Commands │ │ Lead States:   │
  │ - Order mgmt   │ │ LEAD_CAPTURE   │
  │ - Daily digest │ │ QUALIFY_BULK   │
  │ - Weekly stats │ │ PRODUCT_DISC   │
  └────────────────┘ │ QUOTE_GEN      │
                     │ NEGOTIATION    │
                     └────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │   OpenAI GPT   │ (intent extraction)
                    └────────────────┘
```

## Dual Bot Routing

The webhook handler (`src/handlers/webhook.ts`) routes messages based on user type:

1. **Admin Users** (`isAdmin()`): Access fulfillment commands (orders, shipping, reports)
2. **Regular Users**: Routed through FSM for lead capture and sales conversation

## FSM (Finite State Machine) Flow

Located in `src/fsm/`:

| State | Handler | Purpose |
|-------|---------|---------|
| `LEAD_CAPTURE` | `handleLeadMessage` | Get cafe name, location, usage |
| `QUALIFY_BULK_INTENT` | `handleLeadMessage` | Determine price sensitivity, timeline |
| `PRODUCT_DISCOVERY` | `handleLeadMessage` | Identify interested coffee grades |
| `QUOTE_GENERATION` | `handleQuoteMessage` | Generate price quotes |
| `NEGOTIATION` | `handleQuoteMessage` | Handle discount requests |
| `ORDER_CONFIRMATION` | - | Await customer confirmation |
| `PAYMENT_PENDING` | - | Await payment |
| `ESCALATION` | - | Hand off to human |
| `RETENTION_LOOP` | - | Keep warm if not ready |
| `CANCELLED` / `FAILED` | - | Terminal states |

## LLM Integration

`src/services/llm.ts` uses OpenAI for structured intent extraction:

```typescript
// Extract structured data from free-form messages
const result = await extractIntent(message, "lead_capture", context);
// Returns: { cafeName, location, monthlyUsageGrams, etc. }
```

Prompts are in `src/prompts/lead-capture.ts`.

## Commands

```bash
# Install dependencies
bun install

# Run local dev server (Vercel)
bun run dev

# Type check only
bun run typecheck

# Build (TypeScript compilation)
bun run build

# Deploy to production
bun run deploy

# Setup MongoDB indexes
bun run setup-indexes

# Setup FSM indexes
bun run setup-fsm-indexes
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | LINE channel access token |
| `LINE_CHANNEL_SECRET` | Yes | LINE channel secret |
| `LINE_ADMIN_GROUP_IDS` | No | Comma-separated admin group IDs |
| `LINE_ADMIN_GROUP_ID` | No | Legacy single admin group fallback |
| `LINE_ADMIN_USER_IDS` | No | Comma-separated admin IDs |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `CRON_SECRET` | Yes | Bearer token for cron endpoints |
| `OPENAI_API_KEY` | Yes* | For LLM intent extraction |
| `OPENAI_MODEL` | No | Default: gpt-5.4-nano-2026-03-17 |

*Required for lead capture functionality

## API Endpoints (Vercel Serverless)

| Endpoint | File | Description |
|----------|------|-------------|
| `/api/webhook` | `api/webhook/index.ts` | LINE webhook receiver |
| `/api/cron/daily-digest` | `api/cron/daily-digest.ts` | Daily order digest |
| `/api/cron/weekly-summary` | `api/cron/weekly-summary.ts` | Weekly stats |
| `/health` | `api/health.ts` | Health check |

## Key Files

| File | Purpose |
|------|---------|
| `src/handlers/webhook.ts` | Main webhook router, admin vs FSM routing |
| `src/handlers/lead.ts` | Lead capture state handlers |
| `src/handlers/quote.ts` | Quote generation and negotiation |
| `src/fsm/router.ts` | FSM state routing logic |
| `src/fsm/states.ts` | State definitions and transitions |
| `src/services/llm.ts` | OpenAI GPT integration |
| `src/services/lead.ts` | Lead CRUD operations |
| `src/services/quote.ts` | Quote generation and pricing |
| `src/services/fulfillment.ts` | Order operations (admin) |
| `src/services/line-client.ts` | LINE Messaging API client |
| `src/messages/flex-builder.ts` | LINE Flex Message builders |
| `src/prompts/lead-capture.ts` | LLM system prompts |
| `src/types/lead.ts` | Lead/Quote TypeScript types |
| `src/types/mongodb.ts` | Order/Customer types |

## MongoDB Collections

### Admin/Orders
- `orders` - Order documents
- `customers` - Customer documents
- `line_bot_state` - Temporary conversation state (TTL: 10 min)
- `bot_state` - Bot configuration

### Lead Management
- `leads` - Lead documents with FSM state
- `quotes` - Generated quotes and negotiation history

## Admin Bot Commands

Type "วันชา" or "onecha" to open command dashboard:

| Command | Postback | Description |
|---------|----------|-------------|
| ออเดอร์วันนี้ | `cmd:today_orders` | Today's orders |
| กำลังเตรียมสินค้า | `cmd:processing_orders` | Processing orders |
| รอจัดส่ง | `cmd:pending_shipments` | Scheduled shipments |
| สรุปสัปดาห์ | `cmd:weekly_stats` | Weekly summary |

## Tracking Carriers (Thailand)

| Carrier | Pattern | Example |
|---------|---------|---------|
| Thai Post | `^[A-Z]{2}\d{9}TH$` | EE123456789TH |
| Flash | `^TH\d{10,}$` | TH1234567890 |
| J&T | `^\d{12,15}$` | 123456789012 |
| Kerry | `^KEX\d+$` | KEX123456 |
| DHL | `^\d{10}$` | 1234567890 |

## Cron Jobs

Use external scheduler (e.g., cron-job.org) hitting:

- **Daily Digest**: `GET /api/cron/daily-digest` at 9:00 AM Asia/Bangkok
- **Weekly Summary**: `GET /api/cron/weekly-summary` Monday 9:00 AM Asia/Bangkok

Both require `Authorization: Bearer <CRON_SECRET>` header.

## Code Style

- TypeScript strict mode
- Bun as package manager (not npm)
- Vercel serverless functions (not Express)
- Thai language for user-facing messages
- Dark theme for Flex messages (black/green)
- Async/await for async operations
