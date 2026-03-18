import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: ".env.local" });

async function listGroupIds() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error("MONGODB_URI not set");
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db();

    const lineGroups = db.collection("line_groups");
    const botState = db.collection("bot_state");
    const configuredAdminGroups = parseConfiguredAdminGroups();
    const adminGroups = await lineGroups.find({ role: "admin" }).toArray();
    const customerGroups = await lineGroups.find({ role: "customer" }).toArray();
    const legacyAdminGroup = await botState.findOne({ key: "admin_group_id" });

    console.log("=== LINE Group IDs ===");
    if (configuredAdminGroups.length > 0) {
      console.log("Configured Admin Groups:");
      configuredAdminGroups.forEach((groupId) => console.log(`- ${groupId}`));
      console.log("");
    }

    if (adminGroups.length > 0) {
      console.log("Admin Groups:");
      adminGroups.forEach((group) => console.log(`- ${group.groupId}`));
    } else {
      console.log("No admin groups found");
    }

    if (customerGroups.length > 0) {
      console.log("\nCustomer Groups:");
      customerGroups.forEach((group) => console.log(`- ${group.groupId}`));
    }

    if (legacyAdminGroup) {
      console.log("\nLegacy bot_state admin_group_id:");
      console.log(`- ${legacyAdminGroup.value}`);
    }
  } catch (error) {
    console.error("Error:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

listGroupIds();

function parseConfiguredAdminGroups(): string[] {
  return [
    process.env.LINE_ADMIN_GROUP_IDS || "",
    process.env.LINE_ADMIN_GROUP_ID || "",
  ]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((groupId) => groupId.trim())
    .filter(Boolean);
}
