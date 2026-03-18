import express, { Request, Response } from "express";
import dotenv from "dotenv";
import { handleWebhookEvent } from "./handlers/webhook";
import { validateLineSignature } from "./utils/signature";
import { lineClient } from "./services/line-client";
import { fulfillmentService } from "./services/fulfillment";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Raw body for signature validation
app.use("/api/webhook", express.raw({ type: "application/json" }));

// Webhook endpoint
app.post("/api/webhook", async (req: Request, res: Response) => {
  const body = req.body.toString();
  const signature = req.headers["x-line-signature"] as string;
  const secret = process.env.LINE_CHANNEL_SECRET;

  if (!signature) {
    return res.status(401).json({ error: "Missing signature" });
  }

  if (!secret || !validateLineSignature(body, signature, secret)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const data = JSON.parse(body);
    const events = data.events || [];
    
    const results = await Promise.all(
      events.map((event: any) => handleWebhookEvent(event))
    );

    res.json({ status: "ok", processed: results.length });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Internal error" });
  }
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Daily digest cron endpoint
app.get("/api/cron/daily-digest", async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace("Bearer ", "");
  
  if (process.env.NODE_ENV !== "development" && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await lineClient.sendDailyDigest();
    
    // Send reminders for stuck orders
    const stuckOrders = await fulfillmentService.getOrdersNeedingReminder();
    for (const order of stuckOrders) {
      const daysSinceAccepted = order.acceptedAt
        ? Math.floor((Date.now() - new Date(order.acceptedAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      if (daysSinceAccepted >= 1) {
        await lineClient.sendReminder(order);
        await fulfillmentService.markReminderSent(order._id!.toString());
      }
    }

    res.json({ success: result.success, orderCount: result.orderCount, remindersSent: stuckOrders.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Weekly summary cron endpoint
app.get("/api/cron/weekly-summary", async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace("Bearer ", "");
  
  if (process.env.NODE_ENV !== "development" && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await lineClient.sendWeeklySummary();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.listen(PORT, () => {
  console.log(`🍵 Onecha LINE Bot running on port ${PORT}`);
});
