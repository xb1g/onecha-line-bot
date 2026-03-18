export const LEAD_CAPTURE_PROMPT = `You are extracting structured lead data from LINE messages for a B2B matcha wholesaler.

Return strict JSON only. Do not include markdown, code fences, or commentary.

Extract these fields when present:
- cafeName: name of the cafe, restaurant, or business
- location: city, district, or region
- monthlyUsageGrams: estimated monthly consumption in grams
- timeline: when they need the product
- interestedGrades: array of matcha grades the customer mentioned
- priceSensitivity: "low", "medium", or "high"
- requestedQuantityGrams: quantity they asked for, if explicit
- isSpam: true only when the message is clearly irrelevant or promotional spam

Use null for missing scalar values and [] for missing arrays.
Set needsClarification to true when the lead looks real but important details are missing.
Include clarificationQuestions with short, specific questions when clarification is needed.
Set confidence from 0 to 1 based on how explicit the message is.`;

export const QUALIFICATION_PROMPT = `You are qualifying a B2B matcha lead.

Return strict JSON only. Do not include markdown, code fences, or commentary.

Extract:
- priceSensitivity: "low", "medium", or "high"
- requestedQuantityGrams: the quantity they want, if explicit
- preferredGrade: one of "ceremonial", "premium", "cafe", or "culinary"
- timeline: buying timeline if mentioned

Rules:
- If the request is under 500g, set needsClarification to true and explain that the minimum order is 500g.
- If the grade is unclear, ask which grade they need.
- Use null for missing values.`;

export const PRODUCT_DISCOVERY_PROMPT = `You are recommending matcha products for a wholesale lead.

Return strict JSON only. Do not include markdown, code fences, or commentary.

Extract or infer:
- recommendedGrades: array of likely grades to show the customer
- recommendedQuantityGrams: a sensible starting quantity
- rationale: short explanation for the recommendation

Prefer conservative recommendations that match the lead's stated usage and price sensitivity.`;

export const NEGOTIATION_PROMPT = `You are analyzing a discount negotiation request for a B2B quote.

Return strict JSON only. Do not include markdown, code fences, or commentary.

Extract:
- requestedDiscountPercentage: number from 0 to 100
- reason: the customer's stated reason, if any
- recommendation: "accept", "review", or "escalate"
- counterOffer: a suggested counter discount percentage

Rules:
- Requests below 10% are usually safe to accept.
- Requests from 10% to 20% require review.
- Requests above 20% should be escalated.
- If the message is not a negotiation, leave requestedDiscountPercentage at 0 and recommendation at "review".`;
