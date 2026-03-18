# Onecha LINE Bot

LINE Messaging Bot for Onecha order fulfillment operations - deployed on **Vercel** using **Bun**.

## Features

- 📦 **Order Management**: Accept, ship, and track orders via LINE
- 📊 **Daily Digest**: Automatic daily order summary at 9:00 AM
- 📈 **Weekly Summary**: Weekly fulfillment statistics
- 🔔 **Reminders**: Alerts for stuck orders
- 👥 **Customer Notifications**: Notify customers via LINE or email

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   LINE API      │────▶│  Vercel Serverless
└─────────────────┘     │  Functions      │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │    MongoDB     │
                        │   (Shared)     │
                        └────────┬───────┘
                                 │
                                 ▼
                        ┌────────────────┐
                        │  Onecha Main   │
                        │   (Next.js)    │
                        └────────────────┘
```

## Setup

### Prerequisites

- [Bun](https://bun.sh) installed: `curl -fsSL https://bun.sh/install | bash`

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure Environment

Create a `.env.local` file:

```env
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_CHANNEL_SECRET=your_secret
LINE_ADMIN_GROUP_IDS=admin_group_id_1,admin_group_id_2
LINE_ADMIN_USER_IDS=user_id_1,user_id_2
MONGODB_URI=mongodb+srv://...
CRON_SECRET=your_secure_random_string
```

### 3. Setup MongoDB Indexes

```bash
bun run setup-indexes
```

### 4. Run Development Server

```bash
vercel dev
```

### 5. Configure LINE Webhook

In LINE Developers Console:
- Webhook URL: `https://your-domain.vercel.app/api/webhook`
- Enable webhook

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/webhook` | POST | LINE webhook receiver |
| `/api/cron/daily-digest` | GET | Trigger daily digest (cron) |
| `/api/cron/weekly-summary` | GET | Trigger weekly summary (cron) |
| `/health` | GET | Health check |

## Bot Commands

Type "วันชา" or "onecha" in LINE to open the command menu:

- 📋 ออเดอร์วันนี้ - Today's orders
- 📦 กำลังเตรียมสินค้า - Processing orders
- 🚚 รอจัดส่ง - Pending shipments
- 📊 สรุปสัปดาห์ - Weekly summary

## Deployment

### Deploy to Vercel

```bash
# Install Vercel CLI if not already installed
bun add -d vercel

# Login to Vercel
bunx vercel login

# Deploy
bunx vercel

# Deploy to production
bunx vercel --prod
```

Or use the script:
```bash
bun run deploy
```

### Environment Variables on Vercel

Set these in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | LINE channel access token |
| `LINE_CHANNEL_SECRET` | Yes | LINE channel secret |
| `LINE_ADMIN_GROUP_IDS` | No | Comma-separated admin group IDs |
| `LINE_ADMIN_GROUP_ID` | No | Legacy single admin group ID fallback |
| `LINE_ADMIN_USER_IDS` | No | Comma-separated admin user IDs |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `CRON_SECRET` | Yes | Secret for cron endpoints |

## Cron Job Setup

Since Vercel's cron jobs require a paid plan, use an external scheduler like [cron-job.org](https://cron-job.org) (free):

### Daily Digest (9:00 AM Thailand)
- **URL**: `https://your-domain.vercel.app/api/cron/daily-digest`
- **Method**: GET
- **Auth**: Bearer token (your `CRON_SECRET`)
- **Schedule**: `0 9 * * *` (9:00 AM daily)
- **Timezone**: Asia/Bangkok

### Weekly Summary (Monday 9:00 AM Thailand)
- **URL**: `https://your-domain.vercel.app/api/cron/weekly-summary`
- **Method**: GET
- **Auth**: Bearer token (your `CRON_SECRET`)
- **Schedule**: `0 9 * * 1` (9:00 AM Monday)
- **Timezone**: Asia/Bangkok

## Shared MongoDB Collections

| Collection | Owner | Description |
|------------|-------|-------------|
| `orders` | Shared | Order documents |
| `customers` | Shared | Customer documents |
| `line_bot_state` | LINE Bot | Conversation state |
| `bot_state` | LINE Bot | Bot configuration |

## License

MIT
