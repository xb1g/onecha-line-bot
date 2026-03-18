import { MongoClient } from "mongodb";
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
    
    await db.collection("line_bot_state").createIndex(
      { lineUserId: 1 },
      { unique: true }
    );
    console.log("  ✓ Created lineUserId index");

    await db.collection("line_bot_state").createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    );
    console.log("  ✓ Created TTL index on expiresAt");

    // Bot State Collection
    console.log("\n📊 Bot state collection:");
    await db.createCollection("bot_state").catch(() => {});
    await db.collection("bot_state").createIndex({ key: 1 }, { unique: true });
    console.log("  ✓ Created key index");

    console.log("\n✅ All indexes created successfully!");
  } finally {
    await client.close();
  }
}

setupIndexes().catch(console.error);
