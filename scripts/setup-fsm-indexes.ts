import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

async function setupFsmIndexes() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    console.log("Setting up FSM indexes...");

    await db.createCollection("leads").catch(() => {});
    await db.collection("leads").createIndex({ lineUserId: 1 }, { unique: true });
    await db.collection("leads").createIndex({ lineUserId: 1, state: 1 });
    await db.collection("leads").createIndex({ createdAt: -1 });
    await db.collection("leads").createIndex(
      { lastMessageAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60 }
    );

    await db.createCollection("quotes").catch(() => {});
    await db.collection("quotes").createIndex({ leadId: 1 });
    await db.collection("quotes").createIndex({ lineUserId: 1 });
    await db.collection("quotes").createIndex({ status: 1 });
    await db.collection("quotes").createIndex({ expiresAt: 1 });

    console.log("✅ FSM indexes created successfully");
  } finally {
    await client.close();
  }
}

setupFsmIndexes().catch(error => {
  console.error("❌ Error creating FSM indexes:", error);
  process.exit(1);
});
