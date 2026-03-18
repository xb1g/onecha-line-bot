import type { VercelRequest, VercelResponse } from "@vercel/node";

// Health check endpoint
export default function handler(_req: VercelRequest, res: VercelResponse) {
  return res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || "development",
  });
}
