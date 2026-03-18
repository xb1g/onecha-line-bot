import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleWebhookEvent } from "../../src/handlers/webhook";
import { validateLineSignature } from "../../src/utils/signature";

// LINE webhook receiver for Vercel serverless
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Get the raw body for signature validation
  const body = JSON.stringify(req.body);
  const signature = req.headers["x-line-signature"] as string;
  const secret = process.env.LINE_CHANNEL_SECRET;

  if (!signature) {
    return res.status(401).json({ error: "Missing signature" });
  }

  if (!secret || !validateLineSignature(body, signature, secret)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  try {
    const data = req.body;
    const events = data.events || [];

    const results = await Promise.all(
      events.map((event: any) => handleWebhookEvent(event))
    );

    return res.json({ status: "ok", processed: results.length });
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).json({ error: "Internal error" });
  }
}
