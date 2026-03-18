/**
 * LINE Client Service - Handles all LINE Messaging API interactions.
 */

import axios from "axios";
import { getCollection } from "../lib/mongodb";
import { OrderDocument, CustomerDocument, WeeklyStats } from "../types/mongodb";
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
  private adminGroupId = process.env.LINE_ADMIN_GROUP_ID;

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

    const groupId = await this.getAdminGroupId();
    if (!groupId) {
      return {
        success: false,
        orderCount: 0,
        error: "Admin group ID not configured. Add bot to a group first.",
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
    const success = await this.sendFlexMessage(groupId, message);

    if (success) {
      await botState.updateOne(
        { key: "last_daily_digest" },
        { $set: { key: "last_daily_digest", value: today, updatedAt: new Date() } },
        { upsert: true }
      );
    }

    return { success, orderCount: orders.length };
  }

  /**
   * Send a reminder for an unshipped order.
   */
  async sendReminder(order: OrderDocument): Promise<boolean> {
    const groupId = await this.getAdminGroupId();
    if (!groupId) {
      console.error("Admin group ID not configured");
      return false;
    }

    const daysSincePaid = order.acceptedAt
      ? Math.floor((Date.now() - new Date(order.acceptedAt).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const customer = await fulfillmentService.getCustomerForOrder(order);
    const message = buildReminderMessage(order, customer, daysSincePaid);
    return await this.sendFlexMessage(groupId, message);
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

    const groupId = await this.getAdminGroupId();
    if (!groupId) {
      return { success: false, error: "Admin group ID not configured" };
    }

    const stats = await fulfillmentService.getWeeklyStats();
    const message = buildWeeklySummaryMessage(stats);
    const success = await this.sendFlexMessage(groupId, message);

    if (success) {
      await botState.updateOne(
        { key: "last_weekly_summary" },
        { $set: { key: "last_weekly_summary", value: thisWeek, updatedAt: new Date() } },
        { upsert: true }
      );
    }

    return { success };
  }

  /**
   * Get the admin group ID from database or env.
   */
  async getAdminGroupId(): Promise<string | null> {
    if (this.adminGroupId) {
      return this.adminGroupId;
    }

    const botState = await getCollection("bot_state");
    const groupState = await botState.findOne({ key: "admin_group_id" });
    return groupState?.value || null;
  }

  /**
   * Save the admin group ID (called when bot joins a group).
   */
  async saveAdminGroupId(groupId: string): Promise<void> {
    const botState = await getCollection("bot_state");
    await botState.updateOne(
      { key: "admin_group_id" },
      { $set: { key: "admin_group_id", value: groupId, updatedAt: new Date() } },
      { upsert: true }
    );
    this.adminGroupId = groupId;
    console.log(`Admin group ID saved: ${groupId}`);
  }
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