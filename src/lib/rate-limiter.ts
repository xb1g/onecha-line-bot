/**
 * Token bucket rate limiter for OpenAI API calls.
 * Limits to 10 requests/minute per conversation.
 */

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  queuePosition?: number;
}

interface BucketEntry {
  tokens: number;
  lastRefill: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60 * 1000, // 1 minute
};

/**
 * In-memory token bucket store (per conversation/user)
 */
const buckets = new Map<string, BucketEntry>();

/**
 * Get or create a token bucket for a key
 */
function getBucket(key: string, config: RateLimitConfig): BucketEntry {
  const now = Date.now();
  const existing = buckets.get(key);

  if (existing) {
    // Refill tokens based on time elapsed
    const elapsed = now - existing.lastRefill;
    const tokensToAdd = Math.floor(elapsed / config.windowMs) * config.maxRequests;

    if (tokensToAdd > 0) {
      existing.tokens = Math.min(config.maxRequests, existing.tokens + tokensToAdd);
      existing.lastRefill = now;
    }

    return existing;
  }

  const newBucket: BucketEntry = {
    tokens: config.maxRequests,
    lastRefill: now,
  };

  buckets.set(key, newBucket);
  return newBucket;
}

/**
 * Consume a token from the bucket
 */
export function consumeToken(key: string, config?: Partial<RateLimitConfig>): RateLimitStatus {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const bucket = getBucket(key, fullConfig);

  if (bucket.tokens > 0) {
    bucket.tokens--;
    return {
      allowed: true,
      remaining: bucket.tokens,
      resetAt: new Date(bucket.lastRefill + fullConfig.windowMs),
    };
  }

  return {
    allowed: false,
    remaining: 0,
    resetAt: new Date(bucket.lastRefill + fullConfig.windowMs),
  };
}

/**
 * Check rate limit without consuming token
 */
export function checkRateLimit(key: string, config?: Partial<RateLimitConfig>): RateLimitStatus {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const bucket = getBucket(key, fullConfig);

  return {
    allowed: bucket.tokens > 0,
    remaining: bucket.tokens,
    resetAt: new Date(bucket.lastRefill + fullConfig.windowMs),
  };
}

/**
 * Get rate limit key for a conversation
 */
export function getRateLimitKey(lineUserId: string, schema?: string): string {
  return schema ? `openai:${lineUserId}:${schema}` : `openai:${lineUserId}`;
}

/**
 * Reset bucket for a key (useful for testing)
 */
export function resetBucket(key: string): void {
  buckets.delete(key);
}
