import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getMetricsJson } from "../lib/metrics";

export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const metrics = getMetricsJson();
  
  res.status(200).json({
    timestamp: new Date().toISOString(),
    metrics,
  });
}
