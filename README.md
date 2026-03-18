# Onecha LINE Bot

LINE Messaging Bot for Onecha order fulfillment operations.

## Features

- 📦 **Order Management**: Accept, ship, and track orders via LINE
- 📊 **Daily Digest**: Automatic daily order summary at 9:00 AM
- 📈 **Weekly Summary**: Weekly fulfillment statistics
- 🔔 **Reminders**: Alerts for stuck orders
- 👥 **Customer Notifications**: Notify customers via LINE or email

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   LINE API      │────▶│  onecha-line-bot│
└─────────────────┘     └────────┬────────┘
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

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in:

```env
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_CHANNEL_SECRET=your_secret
LINE_ADMIN_GROUP_ID=your_group_id
LINE_ADMIN_USER_IDS=user_id_1,user_id_2
MONGODB_URI=mongodb://localhost:27017/onecha
```

### 3. Setup MongoDB Indexes

```bash
npm run setup-indexes
```

### 4. Run Development Server

```bash
npm run dev
```

### 5. Configure LINE Webhook

In LINE Developers Console:
- Webhook URL: `https://your-domain.com/api/webhook`
- Enable webhook

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/webhook` | POST | LINE webhook receiver |
| `/api/cron/daily-digest` | GET | Trigger daily digest |
| `/api/cron/weekly-summary` | GET | Trigger weekly summary |
| `/health` | GET | Health check |

## Bot Commands

Type "วันชา" or "onecha" in LINE to open the command menu:

- 📋 ออเดอร์วันนี้ - Today's orders
- 📦 กำลังเตรียมสินค้า - Processing orders
- 🚚 รอจัดส่ง - Pending shipments
- 📊 สรุปสัปดาห์ - Weekly summary

## Deployment

### Vercel

```bash
vercel deploy
```

### Railway

```bash
railway login
railway init
railway up
```

### Docker

```bash
docker build -t onecha-line-bot .
docker run -p 3001:3001 onecha-line-bot
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | LINE channel access token |
| `LINE_CHANNEL_SECRET` | Yes | LINE channel secret |
| `LINE_ADMIN_GROUP_ID` | No | Admin group ID (auto-set on join) |
| `LINE_ADMIN_USER_IDS` | No | Comma-separated admin user IDs |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `PORT` | No | Server port (default: 3001) |
| `CRON_SECRET` | No | Secret for cron endpoints |

## Shared MongoDB Collections

| Collection | Owner | Description |
|------------|-------|-------------|
| `orders` | Shared | Order documents |
| `customers` | Shared | Customer documents |
| `line_bot_state` | LINE Bot | Conversation state |
| `bot_state` | LINE Bot | Bot configuration |

## License

MIT
