import { ObjectId } from "mongodb";
import { getCollection } from "../lib/mongodb";
import { LineBotStateDocument } from "../types/mongodb";

const STATE_TTL_MINUTES = 10;
const COLLECTION_NAME = "lineBotStates";

/**
 * Set conversation state to await tracking number input from user
 */
export async function setAwaitingTrackingState(
  lineUserId: string,
  orderId: ObjectId,
  orderDisplayId?: string
): Promise<void> {
  const collection = await getCollection<LineBotStateDocument>(COLLECTION_NAME);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STATE_TTL_MINUTES * 60 * 1000);

  await collection.updateOne(
    { lineUserId },
    {
      $set: {
        lineUserId,
        pendingAction: "awaiting_tracking_number" as const,
        orderId,
        orderDisplayId,
        createdAt: now,
        expiresAt,
      },
    },
    { upsert: true }
  );
}

/**
 * Get current pending state for a user
 * Returns null if no pending state exists
 */
export async function getPendingState(
  lineUserId: string
): Promise<LineBotStateDocument | null> {
  const collection = await getCollection<LineBotStateDocument>(COLLECTION_NAME);
  const state = await collection.findOne({ lineUserId });

  if (!state) {
    return null;
  }

  // Check if state is expired
  if (isStateExpired(state)) {
    await clearPendingState(lineUserId);
    return null;
  }

  return state;
}

/**
 * Clear pending state for a user
 */
export async function clearPendingState(lineUserId: string): Promise<void> {
  const collection = await getCollection<LineBotStateDocument>(COLLECTION_NAME);
  await collection.deleteOne({ lineUserId });
}

/**
 * Check if a state has expired
 */
export function isStateExpired(state: LineBotStateDocument): boolean {
  const now = new Date();
  return state.expiresAt < now;
}

/**
 * Manual cleanup of expired states
 * Note: MongoDB TTL index handles automatic cleanup,
 * but this can be used for immediate cleanup if needed
 */
export async function cleanupExpiredStates(): Promise<number> {
  const collection = await getCollection<LineBotStateDocument>(COLLECTION_NAME);
  const now = new Date();
  const result = await collection.deleteMany({ expiresAt: { $lt: now } });
  return result.deletedCount || 0;
}
