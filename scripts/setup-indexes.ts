import { Collection, MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

async function setupIndexes() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  
  try {
    await client.connect();
    const db = client.db();

    console.log("Setting up indexes...");

    // LINE Bot State Collection
    console.log("\n🤖 Line bot state collection:");
    
    await db.createCollection("line_bot_state").catch(() => {});
    
    await ensureIndex(
      db.collection("line_bot_state"),
      { lineUserId: 1 },
      { unique: true }
    );
    console.log("  ✓ Created lineUserId index");

    await ensureIndex(
      db.collection("line_bot_state"),
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    );
    console.log("  ✓ Created TTL index on expiresAt");

    // Bot State Collection
    console.log("\n📊 Bot state collection:");
    await db.createCollection("bot_state").catch(() => {});
    await ensureIndex(db.collection("bot_state"), { key: 1 }, { unique: true });
    console.log("  ✓ Created key index");

    console.log("\n👥 LINE groups collection:");
    await db.createCollection("line_groups").catch(() => {});
    await ensureIndex(db.collection("line_groups"), { groupId: 1 }, { unique: true });
    console.log("  ✓ Created groupId index");
    await ensureIndex(db.collection("line_groups"), { role: 1, updatedAt: -1 });
    console.log("  ✓ Created role/updatedAt index");

    console.log("\n✅ All indexes created successfully!");
  } finally {
    await client.close();
  }
}

async function ensureIndex(
  collection: Collection,
  keys: Record<string, 1 | -1>,
  options: Record<string, unknown> = {}
) {
  try {
    await collection.createIndex(keys, options);
  } catch (error: any) {
    if (error?.code === 85 || error?.codeName === "IndexOptionsConflict") {
      return;
    }
    throw error;
  }
}

setupIndexes().catch(console.error);
