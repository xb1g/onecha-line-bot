import type { VercelRequest, VercelResponse } from "@vercel/node";
import { lineClient } from "../../src/services/line-client";

// Weekly summary cron endpoint for Vercel
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret for security
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace("Bearer ", "");

  if (token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await lineClient.sendWeeklySummary();
    return res.json(result);
  } catch (error) {
    console.error("Weekly summary error:", error);
    return res.status(500).json({ error: String(error) });
  }
}
