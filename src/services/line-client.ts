/**
 * LINE Client Service - Handles all LINE Messaging API interactions.
 */

import axios from "axios";
import { getCollection } from "../lib/mongodb";
import {
  OrderDocument,
  CustomerDocument,
  WeeklyStats,
  LineGroupDocument,
  LineGroupRole,
} from "../types/mongodb";
import {
  FlexMessage,
  buildDailyDigestMessage,
  buildReminderMessage,
  buildWeeklySummaryMessage,
} from "../messages/flex-builder";
import { fulfillmentService } from "./fulfillment";

export class LineClient {
  private channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  private channelSecret = process.env.LINE_CHANNEL_SECRET;
  private configuredAdminGroupIds = parseAdminGroupIds();

  /**
   * Send a Flex Message to a LINE user or group.
   */
  async sendFlexMessage(to: string, flexMessage: FlexMessage): Promise<boolean> {
    if (!this.channelAccessToken) {
      console.warn("LINE Disabled: Missing channel access token");
      return false;
    }

    try {
      await axios.post(
        "https://api.line.me/v2/bot/message/push",
        { to, messages: [flexMessage] },
        {
          headers: {
            Authorization: `Bearer ${this.channelAccessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      return true;
    } catch (error) {
      console.error("Failed to send LINE Flex message:", error);
      return false;
    }
  }

  /**
   * Send a reply message (responds to a webhook event).
   */
  async replyMessage(
    replyToken: string,
    message: FlexMessage | { type: "text"; text: string }
  ): Promise<boolean> {
    if (!this.channelAccessToken) {
      console.warn("LINE Disabled: Missing channel access token");
      return false;
    }

    try {
      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        { replyToken, messages: [message] },
        {
          headers: {
            Authorization: `Bearer ${this.channelAccessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      return true;
    } catch (error) {
      console.error("Failed to send LINE reply:", error);
      return false;
    }
  }

  /**
   * Send a text message to a LINE user or group.
   */
  async sendTextMessage(to: string, text: string): Promise<boolean> {
    if (!this.channelAccessToken) {
      console.warn("LINE Disabled: Missing channel access token");
      return false;
    }

    try {
      await axios.post(
        "https://api.line.me/v2/bot/message/push",
        { to, messages: [{ type: "text", text }] },
        {
          headers: {
            Authorization: `Bearer ${this.channelAccessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      return true;
    } catch (error) {
      console.error("Failed to send LINE text message:", error);
      return false;
    }
  }

  /**
   * Send the daily digest to the employee group.
   */
  async sendDailyDigest(): Promise<{ success: boolean; orderCount: number; error?: string }> {
    const botState = await getCollection("bot_state");
    const today = new Date().toDateString();
    const lastDigest = await botState.findOne({ key: "last_daily_digest" });

    if (lastDigest?.value === today) {
      console.log("Daily digest already sent today, skipping");
      return { success: true, orderCount: 0 };
    }

    const groupIds = await this.getAdminGroupIds();
    if (groupIds.length === 0) {
      return {
        success: false,
        orderCount: 0,
        error: "Admin group IDs not configured. Add the IDs to LINE_ADMIN_GROUP_IDS or let the bot join those groups.",
      };
    }

    const orders = await fulfillmentService.getDailyDigestOrders();
    const customers = new Map<string, CustomerDocument | null>();
    for (const order of orders) {
      if (order._id) {
        const customer = await fulfillmentService.getCustomerForOrder(order);
        customers.set(order._id.toString(), customer);
      }
    }

    const message = buildDailyDigestMessage(orders, new Date(), customers);
    const delivery = await this.sendFlexMessageToMany(groupIds, message);

    if (delivery.success) {
      await botState.updateOne(
        { key: "last_daily_digest" },
        { $set: { key: "last_daily_digest", value: today, updatedAt: new Date() } },
        { upsert: true }
      );
    }

    return {
      success: delivery.success,
      orderCount: orders.length,
      error: delivery.error,
    };
  }

  /**
   * Send a reminder for an unshipped order.
   */
  async sendReminder(order: OrderDocument): Promise<boolean> {
    const groupIds = await this.getAdminGroupIds();
    if (groupIds.length === 0) {
      console.error("Admin group IDs not configured");
      return false;
    }

    const daysSincePaid = order.acceptedAt
      ? Math.floor((Date.now() - new Date(order.acceptedAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const customer = await fulfillmentService.getCustomerForOrder(order);
    const message = buildReminderMessage(order, customer, daysSincePaid);
    const delivery = await this.sendFlexMessageToMany(groupIds, message);
    return delivery.success;
  }

  /**
   * Send the weekly summary to the employee group.
   */
  async sendWeeklySummary(): Promise<{ success: boolean; error?: string }> {
    const botState = await getCollection("bot_state");
    const thisWeek = getWeekNumber(new Date());
    const lastSummary = await botState.findOne({ key: "last_weekly_summary" });

    if (lastSummary?.value === thisWeek) {
      console.log("Weekly summary already sent this week, skipping");
      return { success: true };
    }

    const groupIds = await this.getAdminGroupIds();
    if (groupIds.length === 0) {
      return { success: false, error: "Admin group IDs not configured" };
    }

    const stats = await fulfillmentService.getWeeklyStats();
    const message = buildWeeklySummaryMessage(stats);
    const delivery = await this.sendFlexMessageToMany(groupIds, message);

    if (delivery.success) {
      await botState.updateOne(
        { key: "last_weekly_summary" },
        { $set: { key: "last_weekly_summary", value: thisWeek, updatedAt: new Date() } },
        { upsert: true }
      );
    }

    return {
      success: delivery.success,
      error: delivery.error,
    };
  }

  /**
   * Upsert a group record and return its effective role.
   */
  async registerGroup(groupId: string): Promise<LineGroupRole> {
    const role = this.getConfiguredRole(groupId);
    const groups = await getCollection<LineGroupDocument>("line_groups");
    const now = new Date();

    await groups.updateOne(
      { groupId },
      {
        $set: {
          groupId,
          role,
          sourceType: "group",
          updatedAt: now,
        },
        $setOnInsert: {
          joinedAt: now,
        },
      },
      { upsert: true }
    );

    return role;
  }

  /**
   * Get the role for a group ID.
   */
  async getGroupRole(groupId: string): Promise<LineGroupRole> {
    const configuredRole = this.getConfiguredRole(groupId);
    const groups = await getCollection<LineGroupDocument>("line_groups");
    const group = await groups.findOne({ groupId });

    if (!group) {
      return configuredRole;
    }

    if (group.role !== configuredRole) {
      await this.registerGroup(groupId);
      return configuredRole;
    }

    return group.role;
  }

  /**
   * Get all configured/persisted admin group IDs.
   */
  async getAdminGroupIds(): Promise<string[]> {
    await this.migrateLegacyAdminGroup();

    const groups = await getCollection<LineGroupDocument>("line_groups");
    const storedAdminGroupIds = await groups.distinct("groupId", { role: "admin" });

    return Array.from(new Set([...this.configuredAdminGroupIds, ...storedAdminGroupIds]));
  }

  private getConfiguredRole(groupId: string): LineGroupRole {
    return this.configuredAdminGroupIds.includes(groupId) ? "admin" : "customer";
  }

  private async sendFlexMessageToMany(
    groupIds: string[],
    flexMessage: FlexMessage
  ): Promise<{ success: boolean; error?: string }> {
    const results = await Promise.all(
      groupIds.map(async (groupId) => ({
        groupId,
        success: await this.sendFlexMessage(groupId, flexMessage),
      }))
    );

    const failed = results.filter((result) => !result.success).map((result) => result.groupId);
    if (failed.length === results.length) {
      return {
        success: false,
        error: `Failed to send to all admin groups: ${failed.join(", ")}`,
      };
    }

    if (failed.length > 0) {
      return {
        success: true,
        error: `Failed to send to some admin groups: ${failed.join(", ")}`,
      };
    }

    return { success: true };
  }

  private async migrateLegacyAdminGroup(): Promise<void> {
    const botState = await getCollection("bot_state");
    const legacy = await botState.findOne({ key: "admin_group_id" });

    if (!legacy?.value) {
      return;
    }

    await this.registerGroup(legacy.value);
  }
}

function parseAdminGroupIds(): string[] {
  const combined = [
    process.env.LINE_ADMIN_GROUP_IDS || "",
    process.env.LINE_ADMIN_GROUP_ID || "",
  ]
    .filter(Boolean)
    .join(",");

  return combined
    .split(",")
    .map((groupId) => groupId.trim())
    .filter(Boolean);
}

function getWeekNumber(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
}

export const lineClient = new LineClient();
export default lineClient;
