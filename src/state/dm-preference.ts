import { getCollection } from "../lib/mongodb";

const COLLECTION = "dm_preferences";

export async function canReceiveDM(userId: string): Promise<boolean> {
  const coll = await getCollection(COLLECTION);
  const doc = await coll.findOne({ userId });
  return doc?.canDM ?? false;
}

export async function setCanReceiveDM(
  userId: string,
  canDM: boolean
): Promise<void> {
  const coll = await getCollection(COLLECTION);
  await coll.updateOne(
    { userId },
    { $set: { userId, canDM, updatedAt: new Date() } },
    { upsert: true }
  );
}
