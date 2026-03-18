# AGENT.md

AI Agent instructions for working with the Onecha LINE Bot codebase.

## Project Overview

Onecha LINE Bot is a standalone LINE Messaging Bot for order fulfillment operations. It connects to a shared MongoDB database with the main Onecha e-commerce platform.

### Purpose
- Accept/process/ship orders via LINE messages
- Send daily order digests to admin group
- Send weekly fulfillment summaries
- Alert on stuck orders
- Notify customers via LINE

### Tech Stack
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB (shared with main Onecha app)
- **Messaging**: LINE Messaging API via `@line/bot-sdk`
- **HTTP Client**: Axios

## Architecture

```
┌─────────────────┐
│   LINE API      │
└────────┬────────┘
         │ Webhook
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Express Server │     │    MongoDB      │
│  (this repo)    │────▶│   (shared)      │
└─────────────────┘     └─────────────────┘
```

### Data Flow

1. **Incoming Webhook**: LINE → `/api/webhook` → `handleWebhookEvent()` → Route to handler
2. **Admin Commands**: User types "วันชา" → Show command dashboard → Postback action
3. **Cron Jobs**: Vercel Cron → `/api/cron/*` → Send digest/summary
4. **Customer Notifications**: Main app can call bot API to notify customers

## Key Files

| File | Purpose |
|------|---------|
| `src/server.ts` | Express server entry point, routes |
| `src/handlers/webhook.ts` | Main webhook event router |
| `src/services/line-client.ts` | LINE API client (send/reply messages) |
| `src/services/fulfillment.ts` | Order operations (accept, ship, etc.) |
| `src/messages/flex-builder.ts` | LINE Flex Message builders |
| `src/state/conversation.ts` | Multi-step conversation state |
| `src/utils/tracking.ts` | Tracking number validation |
| `src/utils/signature.ts` | Webhook signature validation |
| `src/types/mongodb.ts` | TypeScript interfaces |
| `src/lib/mongodb.ts` | Database connection |

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Setup MongoDB indexes
npm run setup-indexes
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | From LINE Developers Console |
| `LINE_CHANNEL_SECRET` | Yes | From LINE Developers Console |
| `LINE_ADMIN_GROUP_ID` | No | Auto-set when bot joins group |
| `LINE_ADMIN_USER_IDS` | No | Comma-separated admin user IDs |
| `MONGODB_URI` | Yes | MongoDB connection string (shared) |
| `PORT` | No | Server port (default: 3001) |
| `NODE_ENV` | No | development/production |
| `CRON_SECRET` | No | Bearer token for cron endpoints |

## API Endpoints

### Webhook
```
POST /api/webhook
```
Receives LINE webhook events. Validates signature, routes to handlers.

### Cron Jobs
```
GET /api/cron/daily-digest
GET /api/cron/weekly-summary
```
Triggered by Vercel Cron or manual call. Requires `Authorization: Bearer <CRON_SECRET>`.

### Health Check
```
GET /health
```
Returns `{ status: "ok", timestamp: "..." }`

## Bot Commands

Users type "วันชา" or "onecha" to open the command dashboard:

| Command | Postback Action | Description |
|---------|-----------------|-------------|
| ออเดอร์วันนี้ | `cmd:today_orders` | Show today's orders |
| กำลังเตรียมสินค้า | `cmd:processing_orders` | Show processing orders |
| รอจัดส่ง | `cmd:pending_shipments` | Show scheduled shipments |
| สรุปสัปดาห์ | `cmd:weekly_stats` | Weekly statistics |

## Postback Actions

| Action | Format | Description |
|--------|--------|-------------|
| Accept Order | `accept_order:<orderId>` | Mark order as processing |
| Ship Order | `ship_order:<orderId>` | Request tracking number |
| Copy Shipping | `copy_shipping:<orderId>:<base64>` | Show shipping info |
| Schedule | `fulfill_later:<orderId>` | Schedule for date |
| Accept All | `accept_all:<orderId>,<orderId>` | Batch accept |

## Conversation State

Multi-step workflows use MongoDB-backed state with 10-minute TTL:

```typescript
// User clicks "Ship" button
setAwaitingTrackingState(userId, orderId, displayId)

// User types tracking number
getPendingState(userId) // Returns state if not expired
validateTrackingNumber(input) // Validates and identifies carrier
shipOrder(orderId, tracking, carrier, url)
clearPendingState(userId)
```

## Tracking Number Validation

Supports Thai carriers:

| Carrier | Pattern | Example |
|---------|---------|---------|
| Thai Post | `^[A-Z]{2}\d{9}TH$` | EE123456789TH |
| Flash | `^TH\d{10,}$` | TH1234567890 |
| J&T | `^\d{12,15}$` | 123456789012 |
| Kerry | `^KEX\d+$` | KEX123456 |
| DHL | `^\d{10}$` | 1234567890 |

## MongoDB Collections

### Shared with Main App
- `orders` - Order documents (read/write)
- `customers` - Customer documents (read)

### Owned by LINE Bot
- `line_bot_state` - Conversation state (TTL: 10 min)
- `bot_state` - Bot config (admin_group_id, last_digest, etc.)

## Error Handling

Custom error classes in `fulfillment.ts`:

```typescript
throw new OrderNotFoundError(orderId)
throw new InvalidStatusTransitionError(orderId, fromStatus, toStatus)
throw new OrderAlreadyAcceptedError(orderId, acceptedBy)
```

## Testing Checklist

Before deploying:

1. [ ] Webhook receives and validates signature
2. [ ] Bot responds to "วันชา" trigger
3. [ ] Command dashboard shows correctly
4. [ ] Accept order updates status
5. [ ] Ship order accepts tracking number
6. [ ] Tracking validation works for all carriers
7. [ ] Daily digest sends to admin group
8. [ ] Weekly summary sends correctly
9. [ ] Conversation state expires after 10 min
10. [ ] Health check returns 200

## Deployment

### Vercel
```bash
vercel deploy --prod
```

Set environment variables in Vercel dashboard.

### Railway
```bash
railway up
```

### Docker
```bash
docker build -t onecha-line-bot .
docker run -p 3001:3001 --env-file .env onecha-line-bot
```

## LINE Developers Console Setup

1. Create Messaging API channel
2. Enable webhook
3. Set webhook URL: `https://your-domain.com/api/webhook`
4. Copy Channel Access Token and Secret to `.env`
5. Add bot to admin group (it will auto-save group ID)

## Common Tasks

### Add new command
1. Add button in `buildCommandDashboard()` in `flex-builder.ts`
2. Add case in `handleCommand()` in `webhook.ts`

### Add new carrier
1. Add pattern in `validateTrackingNumber()` in `tracking.ts`
2. Add carrier name in `getCarrierName()`

### Add new Flex message
1. Create builder function in `flex-builder.ts`
2. Use `COLORS` constant for dark theme
3. Export and use in handler

### Debug webhook
```bash
# Use ngrok for local testing
ngrok http 3001
# Update webhook URL in LINE Console
# Check logs in terminal
```

## Code Style

- TypeScript strict mode
- Async/await for async operations
- Singleton pattern for services
- Thai language for user-facing messages
- Dark theme for Flex messages (black background, green accents)

## Related Repositories

- **onecha-landing-page**: Main e-commerce platform (Next.js)
- **onecha-line-bot**: This repository (LINE Bot)

Both connect to the same MongoDB database.