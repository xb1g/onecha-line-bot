import { getCollection } from "../lib/mongodb";

const COOLDOWN_MS = 5 * 60 * 1000;
const COLLECTION = "bot_cooldowns";

export async function wasMenuSentRecently(
  userId: string,
  chatId: string
): Promise<boolean> {
  const coll = await getCollection(COLLECTION);
  const doc = await coll.findOne({ userId, chatId, type: "menu" });
  if (!doc) return false;
  return Date.now() - doc.sentAt.getTime() < COOLDOWN_MS;
}

export async function trackMenuSent(
  userId: string,
  chatId: string
): Promise<void> {
  const coll = await getCollection(COLLECTION);
  await coll.updateOne(
    { userId, chatId, type: "menu" },
    { $set: { sentAt: new Date() } },
    { upsert: true }
  );
}
