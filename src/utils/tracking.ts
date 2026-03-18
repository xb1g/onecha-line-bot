export type Carrier = "thai_post" | "flash" | "j&t" | "kerry" | "dhl" | "unknown";

export interface TrackingValidation {
  valid: boolean;
  carrier?: Carrier;
  carrierName?: string;
  trackingUrl?: string;
  error?: string;
}

export function validateTrackingNumber(tracking: string): TrackingValidation {
  const cleaned = tracking.trim().toUpperCase();

  // Thai Post: 13 chars, ends with TH
  if (/^[A-Z]{2}\d{9}TH$/.test(cleaned)) {
    return {
      valid: true,
      carrier: "thai_post",
      carrierName: "ไปรษณีย์ไทย",
      trackingUrl: `https://track.thailandpost.co.th/?track=${cleaned}`,
    };
  }

  // Flash: starts with TH, 12+ chars
  if (/^TH\d{10,}$/.test(cleaned)) {
    return {
      valid: true,
      carrier: "flash",
      carrierName: "Flash Express",
      trackingUrl: `https://www.flashexpress.com/fle/tracking?se=${cleaned}`,
    };
  }

  // J&T: 12-15 digits
  if (/^\d{12,15}$/.test(cleaned)) {
    return {
      valid: true,
      carrier: "j&t",
      carrierName: "J&T Express",
      trackingUrl: `https://www.jtexpress.co.th/track?billcode=${cleaned}`,
    };
  }

  // Kerry: starts with KEX
  if (/^KEX\d+$/.test(cleaned)) {
    return {
      valid: true,
      carrier: "kerry",
      carrierName: "Kerry Express",
      trackingUrl: `https://th.kerryexpress.com/en/track/?track=${cleaned}`,
    };
  }

  // DHL: 10 digits
  if (/^\d{10}$/.test(cleaned)) {
    return {
      valid: true,
      carrier: "dhl",
      carrierName: "DHL",
      trackingUrl: `https://www.dhl.com/th-en/home/tracking/tracking-parcel.html?submit=1&tracking-id=${cleaned}`,
    };
  }

  // Unknown but valid format (alphanumeric, 8+ chars)
  if (/^[A-Z0-9]{8,}$/.test(cleaned)) {
    return {
      valid: true,
      carrier: "unknown",
      carrierName: "ขนส่ง",
      trackingUrl: "",
    };
  }

  return { valid: false, error: "รูปแบบเลขพัสดุไม่ถูกต้อง" };
}

export function getCarrierName(carrier: Carrier): string {
  const names: Record<Carrier, string> = {
    "thai_post": "ไปรษณีย์ไทย",
    "flash": "Flash Express",
    "j&t": "J&T Express",
    "kerry": "Kerry Express",
    "dhl": "DHL",
    "unknown": "ขนส่ง",
  };
  return names[carrier];
}
