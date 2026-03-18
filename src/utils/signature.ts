import crypto from "crypto";

export function validateLineSignature(body: string, signature: string, secret: string): boolean {
  if (!body || !signature || !secret) return false;
  try {
    const hmac = crypto.createHmac("sha256", secret).update(body).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch { return false; }
}

export function generateLineSignature(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}
