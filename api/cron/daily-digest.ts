import type { VercelRequest, VercelResponse } from "@vercel/node";
import { lineClient } from "../../src/services/line-client";
import { fulfillmentService } from "../../src/services/fulfillment";

// Daily digest cron endpoint for Vercel
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret for security
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace("Bearer ", "");

  if (token !== process.env.CRON_SECRET) {
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

    return res.json({
      success: result.success,
      orderCount: result.orderCount,
      remindersSent: stuckOrders.length,
    });
  } catch (error) {
    console.error("Daily digest error:", error);
    return res.status(500).json({ error: String(error) });
  }
}
