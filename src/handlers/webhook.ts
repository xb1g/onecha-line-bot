/**
 * LINE Webhook Event Handler.
 * Thai language, admin-only access, dark theme.
 */

import {
  WebhookEvent,
  PostbackEvent,
  MessageEvent,
  JoinEvent,
  FollowEvent,
} from "@line/bot-sdk";
import { lineClient } from "../services/line-client";
import { fulfillmentService } from "../services/fulfillment";
import {
  setAwaitingTrackingState,
  getPendingState,
  clearPendingState,
  isStateExpired,
} from "../state/conversation";
import {
  wasMenuSentRecently,
  trackMenuSent,
} from "../state/menu-cooldown";
import {
  canReceiveDM,
  setCanReceiveDM,
} from "../state/dm-preference";
import { validateTrackingNumber } from "../utils/tracking";
import { getShortOrderId } from "../utils/order-formatting";
import { routeMessage } from "../fsm/router";
import { ObjectId } from "mongodb";
import { getCollection } from "../lib/mongodb";
import {
  OrderDocument,
  CustomerDocument,
  LineGroupRole,
} from "../types/mongodb";
import {
  buildCommandDashboard,
  buildCustomerMenu,
  buildStaffDashboard,
  buildHelpMessage,
  buildDailyDigestMessage,
  buildWeeklySummaryMessage,
} from "../messages/flex-builder";
import { hasAdminSession, createAdminSession } from "../services/admin-session";
import { memberRoleService } from "../services/member-role";
import {
  setAwaitingAdminPassword,
  getAdminLoginState,
  clearAdminLoginState,
} from "../state/admin-login";

// =============================================================================
// Admin Access Control
// =============================================================================

const ADMIN_USER_IDS = (process.env.LINE_ADMIN_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function isAdmin(userId: string): Promise<boolean> {
  // Check environment variables first (case-insensitive comparison for safety)
  const normalizedUserId = userId.toLowerCase();
  if (ADMIN_USER_IDS.some(id => id.toLowerCase() === normalizedUserId)) {
    return true;
  }

  // Check for active admin session
  return await hasAdminSession(userId);
}

// =============================================================================
// Types
// =============================================================================

export interface WebhookHandlerResult {
  status: "success" | "error" | "ignored";
  message?: string;
  error?: string;
}

interface ConversationContext {
  conversationId: string;
  groupId?: string;
  groupRole?: LineGroupRole;
  isAdminGroup: boolean;
  isCustomerConversation: boolean;
}

// =============================================================================
// Main Event Router
// =============================================================================

export async function handleWebhookEvent(
  event: WebhookEvent,
): Promise<WebhookHandlerResult> {
  try {
    switch (event.type) {
      case "postback":
        return await handlePostback(event);
      case "message":
        return await handleMessage(event);
      case "join":
        return await handleJoin(event);
      case "follow":
        return await handleFollow(event);
      case "unfollow":
        return { status: "ignored", message: "User unfollowed" };
      case "leave":
        return { status: "ignored", message: "Bot left group" };
      default:
        return {
          status: "ignored",
          message: `Unhandled event type: ${event.type}`,
        };
    }
  } catch (error) {
    console.error("Error handling webhook event:", error);
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// Postback Handler
// =============================================================================

async function handlePostback(
  event: PostbackEvent,
): Promise<WebhookHandlerResult> {
  const { data } = event.postback;
  const replyToken = event.replyToken;
  const userId = event.source.userId;
  const context = await getConversationContext(event);

  if (!userId) {
    return { status: "error", error: "No user ID in postback event" };
  }

  const isUserAdmin = await isAdmin(userId);
  const isUserStaff = context.groupId
    ? await memberRoleService.isStaffOrAdmin(context.groupId, userId)
    : false;

  // Allow access if: in admin group, admin ID in env var, admin session, or staff
  const hasAccess = context.isAdminGroup || isUserAdmin || isUserStaff;
  if (!hasAccess) {
    await replyError(replyToken, "คุณไม่มีสิทธิ์เข้าถึงระบบ\n(ติดต่อแอดมินเพื่อขอสิทธิ์)");
    return { status: "error", error: "Unauthorized" };
  }

  const [action, ...params] = data.split(":");

  switch (action) {
    case "accept_order": {
      const orderId = params[0];
      if (!orderId) {
        await replyError(replyToken, "ไม่พบรหัสออเดอร์");
        return { status: "error", error: "Missing order ID" };
      }

      try {
        const order = await fulfillmentService.acceptOrder(orderId, userId);
        const shortId = getShortOrderId(order);
        const dmSent = await lineClient.tryPushMessage(userId, {
          type: "text",
          text: `✅ รับออเดอร์ #${shortId} แล้ว!`,
        });
        if (!dmSent) {
          await replySuccess(replyToken, `รับออเดอร์ #${shortId} แล้ว!`);
        }
        return { status: "success", message: `Order ${orderId} accepted` };
      } catch (error: any) {
        await replyError(replyToken, error.message || "ไม่สามารถรับออเดอร์ได้");
        return { status: "error", error: error.message };
      }
    }

    case "copy_shipping": {
      const orderId = params[0];
      const encodedData = params[1];

      if (!encodedData) {
        await replyError(replyToken, "ไม่พบข้อมูลที่อยู่");
        return { status: "error", error: "Missing shipping data" };
      }

      try {
        const shippingInfo = Buffer.from(encodedData, "base64").toString(
          "utf-8",
        );
        await lineClient.replyMessage(replyToken, {
          type: "text",
          text: `📋 ข้อมูลจัดส่ง (ออเดอร์ #${orderId?.slice(-6).toUpperCase()})\n\n${shippingInfo}`,
        });
        return { status: "success", message: "Shipping info copied to chat" };
      } catch (error: any) {
        await replyError(replyToken, "ไม่สามารถคัดลอกข้อมูลได้");
        return { status: "error", error: error.message };
      }
    }

    case "fulfill_later": {
      const orderId = params[0];
      if (!orderId) {
        await replyError(replyToken, "ไม่พบรหัสออเดอร์");
        return { status: "error", error: "Missing order ID" };
      }

      const postbackParams = event.postback.params;
      const selectedDate =
        postbackParams && "date" in postbackParams
          ? postbackParams.date
          : undefined;
      if (!selectedDate) {
        await replyError(replyToken, "กรุณาเลือกวันที่");
        return { status: "error", error: "Missing date" };
      }

      try {
        const scheduledDate = new Date(selectedDate + "T09:00:00+07:00");
        const order = await fulfillmentService.scheduleFulfillment(
          orderId,
          userId,
          scheduledDate,
        );
        const shortId = getShortOrderId(order);

        const days = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
        const months = [
          "ม.ค.",
          "ก.พ.",
          "มี.ค.",
          "เม.ย.",
          "พ.ค.",
          "มิ.ย.",
          "ก.ค.",
          "ส.ค.",
          "ก.ย.",
          "ต.ค.",
          "พ.ย.",
          "ธ.ค.",
        ];
        const d = scheduledDate;
        const dateStr = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;

        await replySuccess(
          replyToken,
          `นัดส่งออเดอร์ #${shortId} วันที่ ${dateStr}`,
        );
        return { status: "success", message: `Order ${orderId} scheduled` };
      } catch (error: any) {
        await replyError(replyToken, error.message || "ไม่สามารถนัดเวลาได้");
        return { status: "error", error: error.message };
      }
    }

    case "ship_order": {
      const orderId = params[0];
      if (!orderId) {
        await replyError(replyToken, "ไม่พบรหัสออเดอร์");
        return { status: "error", error: "Missing order ID" };
      }

      try {
        const order = await fulfillmentService.getOrderById(orderId);
        if (!order) {
          await replyError(replyToken, "ไม่พบออเดอร์");
          return { status: "error", error: "Order not found" };
        }

        await setAwaitingTrackingState(
          userId,
          new ObjectId(orderId),
          getShortOrderId(order),
        );

        await lineClient.replyMessage(replyToken, {
          type: "text",
          text: `📦 กรุณากรอกเลขพัสดุสำหรับออเดอร์ #${getShortOrderId(order)}:`,
        });

        return {
          status: "success",
          message: `Awaiting tracking for ${orderId}`,
        };
      } catch (error: any) {
        await replyError(replyToken, error.message || "เกิดข้อผิดพลาด");
        return { status: "error", error: error.message };
      }
    }

    case "accept_all": {
      const orderIdsStr = params[0];
      if (!orderIdsStr) {
        await replyError(replyToken, "ไม่มีออเดอร์ที่จะรับ");
        return { status: "error", error: "Missing order IDs" };
      }

      const orderIds = orderIdsStr.split(",");
      const result = await fulfillmentService.acceptAllOrders(orderIds, userId);

      const message =
        result.accepted.length > 0
          ? `รับออเดอร์แล้ว ${result.accepted.length} รายการ!`
          : "ไม่มีออเดอร์ที่รับ";

      if (result.failed.length > 0) {
        await lineClient.replyMessage(replyToken, {
          type: "text",
          text: `${message}\n\n${result.failed.length} รายการรับไม่ได้`,
        });
      } else {
        await replySuccess(replyToken, message);
      }

      return {
        status: "success",
        message: `Accepted ${result.accepted.length} orders`,
      };
    }

    case "status_update": {
      const orderId = params[0];
      const newStatus = params[1];
      if (!orderId || !newStatus) {
        await replyError(replyToken, "ไม่พบข้อมูลออเดอร์");
        return { status: "error", error: "Missing data" };
      }

      try {
        const order = await fulfillmentService.updateOrderStatus(
          orderId,
          newStatus,
          userId
        );
        const shortId = getShortOrderId(order);
        const dmSent = await lineClient.tryPushMessage(userId, {
          type: "text",
          text: `✅ อัปเดตออเดอร์ #${shortId} เป็น ${getStatusLabel(newStatus)}`,
        });
        if (!dmSent) {
          await replySuccess(
            replyToken,
            `อัปเดตออเดอร์ #${shortId} เป็น ${getStatusLabel(newStatus)}`
          );
        }
        return { status: "success", message: `Order ${orderId} updated to ${newStatus}` };
      } catch (error: any) {
        await replyError(replyToken, error.message || "ไม่สามารถอัปเดตสถานะได้");
        return { status: "error", error: error.message };
      }
    }

    case "cmd": {
      return await handleCommand(replyToken, params[0]);
    }

    default:
      return {
        status: "ignored",
        message: `Unknown postback action: ${action}`,
      };
  }
}

// =============================================================================
// Command Handler
// =============================================================================

async function handleCommand(
  replyToken: string,
  command: string,
): Promise<WebhookHandlerResult> {
  switch (command) {
    case "today_orders": {
      const orders = await fulfillmentService.getDailyDigestOrders();
      const customers = new Map<string, CustomerDocument | null>();

      for (const order of orders) {
        if (order._id) {
          const customer = await fulfillmentService.getCustomerForOrder(order);
          customers.set(order._id.toString(), customer);
        }
      }

      const message = buildDailyDigestMessage(orders, new Date(), customers);
      await lineClient.replyMessage(replyToken, message);
      return { status: "success", message: "Today's orders sent" };
    }

    case "processing_orders": {
      const orders = await fulfillmentService.getUnshippedOrders();
      if (orders.length === 0) {
        await lineClient.replyMessage(replyToken, {
          type: "text",
          text: "✅ ไม่มีออเดอร์ที่กำลังเตรียม!",
        });
        return { status: "success", message: "No processing orders" };
      }

      const customers = new Map<string, CustomerDocument | null>();
      for (const order of orders) {
        if (order._id) {
          const customer = await fulfillmentService.getCustomerForOrder(order);
          customers.set(order._id.toString(), customer);
        }
      }

      const message = buildDailyDigestMessage(orders, new Date(), customers);
      await lineClient.replyMessage(replyToken, message);
      return { status: "success", message: "Processing orders sent" };
    }

    case "pending_shipments": {
      const orders = await getCollection<OrderDocument>("orders");
      const pendingOrders = await orders
        .find({
          scheduledShipDate: { $exists: true },
          status: { $in: ["paid", "processing"] },
        })
        .sort({ scheduledShipDate: 1 })
        .toArray();

      const scheduledOrders = pendingOrders.filter(
        (order) => order.scheduledShipDate instanceof Date,
      );

      if (scheduledOrders.length === 0) {
        await lineClient.replyMessage(replyToken, {
          type: "text",
          text: "📅 ไม่มีออเดอร์ที่นัดส่งไว้",
        });
        return { status: "success", message: "No pending shipments" };
      }

      const days = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
      const months = [
        "ม.ค.",
        "ก.พ.",
        "มี.ค.",
        "เม.ย.",
        "พ.ค.",
        "มิ.ย.",
        "ก.ค.",
        "ส.ค.",
        "ก.ย.",
        "ต.ค.",
        "พ.ย.",
        "ธ.ค.",
      ];

      const lines = scheduledOrders.map((o) => {
        const d = o.scheduledShipDate!;
        const dateStr = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
        return `${dateStr} - #${o._id?.toString().slice(-6).toUpperCase()}`;
      });

      await lineClient.replyMessage(replyToken, {
        type: "text",
        text: `📅 ออเดอร์ที่นัดส่งไว้:\n\n${lines.join("\n")}`,
      });
      return { status: "success", message: "Pending shipments sent" };
    }

    case "weekly_stats": {
      const stats = await fulfillmentService.getWeeklyStats();
      const message = buildWeeklySummaryMessage(stats);
      await lineClient.replyMessage(replyToken, message);
      return { status: "success", message: "Weekly stats sent" };
    }

    case "start_quote": {
      await lineClient.replyMessage(replyToken, {
        type: "text",
        text: "💬 กรุณาบอกความต้องการของคุณครับ\n\nเช่น:\n• ชื่อร้าน/ที่ตั้ง\n• ปริมาณที่ต้องการ (ขั้นต่ำ 500g)\n• เกรดที่สนใจ (ceremonial, premium, cafe, culinary)",
      });
      return { status: "success", message: "Quote flow started" };
    }

    case "show_grades": {
      const gradesMessage = `🍵 เกรดมัทฉะของเรา:

🏆 Ceremonial - เกรดพิธีกรรม สีเขียวสด หวานมัน ไม่ขม
⭐ Premium - เกรดพรีเมียม สมดุลรสชาติ เหมาะกับลาเต้
☕ Cafe - เกรดคาเฟ่ รสชาติเข้มข้น คุ้มค่า
🍳 Culinary - เกรดทำอาหาร สำหรับขนมและเบเกอรี่

💡 แนะนำ: ลองชิมตัวอย่างก่อนตัดสินใจสั่ง bulk ครับ`;
      await lineClient.replyMessage(replyToken, {
        type: "text",
        text: gradesMessage,
      });
      return { status: "success", message: "Grades info sent" };
    }

    case "check_order": {
      await lineClient.replyMessage(replyToken, {
        type: "text",
        text: "📦 กรุณาระบุเลขออเดอร์หรืออีเมลที่ใช้สั่งซื้อครับ",
      });
      return { status: "success", message: "Order check requested" };
    }

    case "contact_support": {
      await lineClient.replyMessage(replyToken, {
        type: "text",
        text: "👤 เจ้าหน้าที่จะติดต่อกลับเร็วที่สุดครับ\n\nหรือติดต่อทางไลน์: @onecha\nโทร: 092-XXXXXXX\nอีเมล: hello@onecha.co",
      });
      return { status: "success", message: "Support contact sent" };
    }

    case "staff_orders": {
      const orders = await fulfillmentService.getDailyDigestOrders();
      if (orders.length === 0) {
        await lineClient.replyMessage(replyToken, {
          type: "text",
          text: "✅ ไม่มีออเดอร์ที่ต้องทำ",
        });
        return { status: "success", message: "No orders" };
      }

      const customers = new Map<string, CustomerDocument | null>();
      for (const order of orders) {
        if (order._id) {
          const customer = await fulfillmentService.getCustomerForOrder(order);
          customers.set(order._id.toString(), customer);
        }
      }

      const message = buildDailyDigestMessage(orders, new Date(), customers);
      await lineClient.replyMessage(replyToken, message);
      return { status: "success", message: "Staff orders sent" };
    }

    case "status_blending":
    case "status_packing":
    case "status_shipping": {
      const statusMap: Record<string, string> = {
        status_blending: "blending",
        status_packing: "packing",
        status_shipping: "shipping",
      };
      const status = statusMap[command];
      const orders = await fulfillmentService.getOrdersByStatus(status as any);

      if (orders.length === 0) {
        await lineClient.replyMessage(replyToken, {
          type: "text",
          text: `ไม่มีออเดอร์ในสถานะ ${getStatusLabel(status)}`,
        });
        return { status: "success", message: "No orders in status" };
      }

      const { buildOrderStatusCard } = require("../messages/flex-builder");
      const bubbles = orders.map((order) => buildOrderStatusCard(order, status));

      await lineClient.replyMessage(replyToken, {
        type: "flex",
        altText: `ออเดอร์${getStatusLabel(status)}: ${orders.length} รายการ`,
        contents: {
          type: "carousel",
          contents: bubbles,
        },
      });
      return { status: "success", message: `Orders in ${status} sent` };
    }

    default:
      return { status: "ignored", message: `Unknown command: ${command}` };
  }
}

// =============================================================================
// Message Handler
// =============================================================================

async function handleMessage(
  event: MessageEvent,
): Promise<WebhookHandlerResult> {
  const userId = event.source.userId;
  const replyToken = event.replyToken;
  const context = await getConversationContext(event);

  if (!userId) {
    return { status: "error", error: "No user ID in message event" };
  }

  if (event.message.type !== "text") {
    return { status: "ignored", message: "Non-text message ignored" };
  }

  const text = event.message.text.trim();

  // Check for pending tracking input
  const pendingState = await getPendingState(userId);

  if (pendingState && !isStateExpired(pendingState) && context.isAdminGroup) {
    if (pendingState.pendingAction === "awaiting_tracking_number") {
      const lowerText = text.toLowerCase();
      if (
        lowerText === "cancel" ||
        lowerText === "ยกเลิก" ||
        lowerText === "exit" ||
        lowerText === "ออก"
      ) {
        await clearPendingState(userId);
        await lineClient.replyMessage(replyToken, {
          type: "text",
          text: "✅ ยกเลิกการกรอกเลขพัสดุแล้ว",
        });
        return { status: "success", message: "Tracking input cancelled" };
      }
      return await handleTrackingInput(userId, replyToken, text, pendingState);
    }
  }

  // Check for admin password input
  const adminLoginState = await getAdminLoginState(userId);
  if (adminLoginState) {
    return await handleAdminPasswordInput(userId, replyToken, text);
  }

  // Check for trigger words
  const lowerText = text.toLowerCase();
  const isMentioned =
    lowerText.startsWith("onecha") || lowerText.startsWith("วันชา");

  // Check for admin login command
  if (lowerText === "onecha admin login" || lowerText === "วันชา admin login") {
    return await handleAdminLogin(userId, replyToken);
  }

  if (
    lowerText === "onecha admin group add" ||
    lowerText === "วันชา admin group add"
  ) {
    return await handleAdminGroupAdd(userId, replyToken, context);
  }

  if (
    lowerText === "onecha admin group remove" ||
    lowerText === "วันชา admin group remove"
  ) {
    return await handleAdminGroupRemove(userId, replyToken, context);
  }

  if (lowerText === "onecha whoami" || lowerText === "วันชา whoami") {
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: `🆔 Your LINE user ID:\n\n${userId}\n\nAdd this to LINE_ADMIN_USER_IDS env var to make yourself an admin.`,
    });
    return { status: "success", message: "User ID sent" };
  }

  if (lowerText.startsWith("onecha staff add ") || lowerText.startsWith("วันชา staff add ")) {
    const targetUserId = text.split(" ").pop();
    return await handleStaffAdd(userId, replyToken, context, targetUserId);
  }

  if (lowerText.startsWith("onecha staff remove ") || lowerText.startsWith("วันชา staff remove ")) {
    const targetUserId = text.split(" ").pop();
    return await handleStaffRemove(userId, replyToken, context, targetUserId);
  }

  if (lowerText === "onecha staff list" || lowerText === "วันชา staff list") {
    return await handleStaffList(userId, replyToken, context);
  }

  if (lowerText === "onecha help" || lowerText === "วันชา help" || lowerText === "onecha -h" || lowerText === "วันชา -h") {
    const isUserAdmin = await isAdmin(userId);
    const isUserStaff = context.groupId
      ? await memberRoleService.isStaffOrAdmin(context.groupId, userId)
      : false;
    const helpMessage = buildHelpMessage(isUserAdmin, isUserStaff);
    await lineClient.replyMessage(replyToken, { type: "text", text: helpMessage });
    return { status: "success", message: "Help sent" };
  }

  if (isMentioned) {
    const isUserAdmin = await isAdmin(userId);
    const isUserStaff = context.groupId
      ? await memberRoleService.isStaffOrAdmin(context.groupId, userId)
      : false;

    // Check admin/staff status FIRST, before customer conversation check
    if (isUserAdmin) {
      const message = buildCommandDashboard();
      await lineClient.replyMessage(replyToken, message);
      return { status: "success", message: "Admin menu sent" };
    }

    if (isUserStaff) {
      const message = buildStaffDashboard();
      await lineClient.replyMessage(replyToken, message);
      return { status: "success", message: "Staff menu sent" };
    }

    // Only show customer menu if not admin/staff
    if (context.isCustomerConversation) {
      const message = buildCustomerMenu();
      await lineClient.replyMessage(replyToken, message);
      return { status: "success", message: "Customer menu sent" };
    } else {
      return { status: "ignored", message: "Unauthorized" };
    }
  }

  if (context.isAdminGroup) {
    return {
      status: "ignored",
      message: "Ignored non-command admin group message",
    };
  }

  return await handleCustomerConversation(
    context.conversationId,
    replyToken,
    text,
  );
}

async function handleStaffAdd(
  userId: string,
  replyToken: string,
  context: ConversationContext,
  targetUserId?: string,
): Promise<WebhookHandlerResult> {
  if (!(await isAdmin(userId))) {
    await replyError(replyToken, "คุณไม่มีสิทธิ์จัดการเจ้าหน้าที่");
    return { status: "error", error: "Unauthorized" };
  }

  if (!context.groupId) {
    await replyError(replyToken, "คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น");
    return { status: "error", error: "Not a group chat" };
  }

  if (!targetUserId) {
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "📝 ใช้: onecha staff add [userId]\n\nดูรายชื่อสมาชิก: onecha staff list",
    });
    return { status: "success", message: "Usage instructions sent" };
  }

  await memberRoleService.assignRole(context.groupId, targetUserId, "staff", userId);

  const profile = await lineClient.getUserProfile(targetUserId);
  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: `✅ ตั้ง ${profile?.displayName || targetUserId} เป็นเจ้าหน้าที่แล้ว`,
  });

  return { status: "success", message: "Staff added" };
}

async function handleStaffRemove(
  userId: string,
  replyToken: string,
  context: ConversationContext,
  targetUserId?: string,
): Promise<WebhookHandlerResult> {
  if (!(await isAdmin(userId))) {
    await replyError(replyToken, "คุณไม่มีสิทธิ์จัดการเจ้าหน้าที่");
    return { status: "error", error: "Unauthorized" };
  }

  if (!context.groupId || !targetUserId) {
    await replyError(replyToken, "ใช้: onecha staff remove [userId]");
    return { status: "error", error: "Invalid usage" };
  }

  await memberRoleService.removeRole(context.groupId, targetUserId);

  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: "✅ ยกเลิกสิทธิ์เจ้าหน้าที่แล้ว",
  });

  return { status: "success", message: "Staff removed" };
}

async function handleStaffList(
  userId: string,
  replyToken: string,
  context: ConversationContext,
): Promise<WebhookHandlerResult> {
  if (!(await isAdmin(userId))) {
    await replyError(replyToken, "คุณไม่มีสิทธิ์จัดการเจ้าหน้าที่");
    return { status: "error", error: "Unauthorized" };
  }

  if (!context.groupId) {
    await replyError(replyToken, "คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น");
    return { status: "error", error: "Not a group chat" };
  }

  await memberRoleService.syncGroupMembers(context.groupId);
  const members = await memberRoleService.listGroupMembers(context.groupId);

  if (members.length === 0) {
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "ไม่พบสมาชิกในกลุ่ม",
    });
    return { status: "success", message: "No members found" };
  }

  const lines = members.map((m) => {
    const roleLabel = m.role === "admin" ? "👑 แอดมิน" : m.role === "staff" ? "👷 เจ้าหน้าที่" : "👤 สมาชิก";
    return `${roleLabel}: ${m.displayName || m.userId}`;
  });

  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: `📋 รายชื่อสมาชิกกลุ่ม:\n\n${lines.join("\n")}\n\nเพิ่มเจ้าหน้าที่: onecha staff add [userId]`,
  });

  return { status: "success", message: "Staff list sent" };
}

// =============================================================================
// Tracking Input Handler
// =============================================================================

async function handleTrackingInput(
  userId: string,
  replyToken: string,
  trackingNumber: string,
  state: any,
): Promise<WebhookHandlerResult> {
  const orderId = state.orderId.toString();

  const validation = validateTrackingNumber(trackingNumber);

  if (!validation.valid) {
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: `❌ เลขพัสดุไม่ถูกต้อง: ${validation.error}\n\nลองอีกครั้ง:`,
    });
    return { status: "error", error: validation.error };
  }

  try {
    const order = await fulfillmentService.shipOrder(
      orderId,
      trackingNumber.toUpperCase(),
      validation.carrier || "unknown",
      validation.trackingUrl || "",
    );

    await clearPendingState(userId);
    const shortId = getShortOrderId(order);

    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: `✅ ส่งออเดอร์ #${shortId} แล้ว!\n\nขนส่ง: ${validation.carrierName}\nเลขพัสดุ: ${trackingNumber.toUpperCase()}`,
    });

    return { status: "success", message: `Order ${orderId} shipped` };
  } catch (error: any) {
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: `❌ ${error.message || "ไม่สามารถส่งออเดอร์ได้"}`,
    });
    return { status: "error", error: error.message };
  }
}

// =============================================================================
// Join Handler
// =============================================================================

async function handleJoin(event: JoinEvent): Promise<WebhookHandlerResult> {
  const replyToken = event.replyToken;

  if (event.source.type === "group") {
    const groupId = event.source.groupId;
    const role = await lineClient.registerGroup(groupId);

    if (role === "admin") {
      await lineClient.replyMessage(replyToken, {
        type: "text",
        text: `🍵 สวัสดีครับ! ผมบอทวันชา\n\nบันทึกกลุ่มนี้เป็นช่องแจ้งเตือนแอดมินแล้ว\n\nจะส่งสรุปออเดอร์ทุกวันเวลา 9:00 น.\n\nพิมพ์ "วันชา" เพื่อเปิดเมนู`,
      });
    } else {
      await lineClient.replyMessage(replyToken, {
        type: "text",
        text: `🍵 สวัสดีครับ! ผมบอทวันชา\n\nกลุ่มนี้ถูกตั้งเป็นกลุ่มลูกค้าโดยอัตโนมัติ\n\nผมช่วยตอบคำถามเรื่องสินค้า ราคา ออเดอร์ การชำระเงิน และบริการหลังการขายได้ครับ`,
      });
    }

    return { status: "success", message: `Joined ${role} group ${groupId}` };
  }

  return { status: "ignored", message: "Joined non-group chat" };
}

// =============================================================================
// Follow Handler
// =============================================================================

async function handleFollow(event: FollowEvent): Promise<WebhookHandlerResult> {
  const userId = event.source.userId;
  const replyToken = event.replyToken;

  if (!userId) {
    return { status: "error", error: "No user ID in follow event" };
  }

  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: `🍵 ยินดีต้อนรับสู่วันชา!\n\nจะแจ้งอัปเดตออเดอร์มาต๋าของคุณผ่าน LINE นี้นะครับ`,
  });

  return { status: "success", message: `User ${userId} followed` };
}

// =============================================================================
// Admin Login Handler
// =============================================================================

async function handleAdminLogin(
  userId: string,
  replyToken: string,
): Promise<WebhookHandlerResult> {
  const adminPassword = process.env.LINE_ADMIN_PASSWORD;

  if (!adminPassword) {
    await lineClient.sendTextMessage(userId, "❌ ระบบแอดมินไม่ได้เปิดใช้งาน\n\nกรุณาตั้งค่า LINE_ADMIN_PASSWORD");
    return { status: "error", error: "Admin password not configured" };
  }

  // Check if user already has admin session
  if (await hasAdminSession(userId)) {
    await lineClient.sendTextMessage(userId, "✅ คุณมีสิทธิ์แอดมินอยู่แล้ว\n\nพิมพ์ 'วันชา' เพื่อเปิดเมนู");
    return { status: "success", message: "User already has admin session" };
  }

  // Check if user is in LINE_ADMIN_USER_IDS (bypass password)
  const isEnvAdmin = ADMIN_USER_IDS.some(id => id.toLowerCase() === userId.toLowerCase());
  if (isEnvAdmin) {
    await createAdminSession(userId);
    await lineClient.sendTextMessage(userId, "✅ เข้าสู่ระบบแอดมินสำเร็จ!\n\nพิมพ์ 'วันชา' เพื่อเปิดเมนู");
    return { status: "success", message: "Admin login via env var" };
  }

  // Set user as awaiting password input
  await setAwaitingAdminPassword(userId);

  await lineClient.sendTextMessage(userId, "🔐 กรุณากรอกรหัสผ่านแอดมิน:");

  return { status: "success", message: "Password requested" };
}

// =============================================================================
// Admin Password Input Handler
// =============================================================================

async function handleAdminPasswordInput(
  userId: string,
  replyToken: string,
  password: string,
): Promise<WebhookHandlerResult> {
  const adminPassword = process.env.LINE_ADMIN_PASSWORD;

  if (!adminPassword) {
    await clearAdminLoginState(userId);
    await lineClient.sendTextMessage(userId, "❌ ระบบแอดมินไม่ได้เปิดใช้งาน\n\nกรุณาตั้งค่า LINE_ADMIN_PASSWORD");
    return { status: "error", error: "Admin password not configured" };
  }

  // Verify password (case-sensitive match)
  if (password === adminPassword) {
    // Create admin session
    await createAdminSession(userId);
    await clearAdminLoginState(userId);

    await lineClient.sendTextMessage(userId, "✅ เข้าสู่ระบบแอดมินสำเร็จ!\n\nพิมพ์ 'วันชา' เพื่อเปิดเมนู");

    return { status: "success", message: "Admin login successful" };
  } else {
    await clearAdminLoginState(userId);

    await lineClient.sendTextMessage(userId, "❌ รหัสผ่านไม่ถูกต้อง\n\nใช้คำสั่ง 'วันชา admin login' เพื่อลองใหม่");

    return { status: "error", error: "Invalid password" };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

async function replySuccess(
  replyToken: string,
  message: string,
): Promise<void> {
  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: `✅ ${message}`,
  });
}

async function replyError(replyToken: string, message: string): Promise<void> {
  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: `❌ ${message}`,
  });
}

async function getConversationContext(
  event: WebhookEvent,
): Promise<ConversationContext> {
  if (event.source.type === "group") {
    const groupId = event.source.groupId;
    await lineClient.registerGroup(groupId);
    const groupRole = await lineClient.getGroupRole(groupId);

    return {
      conversationId: groupId,
      groupId,
      groupRole,
      isAdminGroup: groupRole === "admin",
      isCustomerConversation: groupRole === "customer",
    };
  }

  const userId = event.source.userId;
  return {
    conversationId: userId || "unknown",
    isAdminGroup: false,
    isCustomerConversation: true,
  };
}

async function handleCustomerConversation(
  conversationId: string,
  replyToken: string,
  text: string,
): Promise<WebhookHandlerResult> {
  const fsmResult = await routeMessage(conversationId, text);
  if (fsmResult.replyMessage) {
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: fsmResult.replyMessage,
    });
  }

  if (fsmResult.success) {
    return {
      status: "success",
      message: fsmResult.newState
        ? `FSM routed to ${fsmResult.newState}`
        : "FSM routed",
    };
  }

  return {
    status: "error",
    error: fsmResult.error || "FSM routing failed",
  };
}

async function handleAdminGroupAdd(
  userId: string,
  replyToken: string,
  context: ConversationContext,
): Promise<WebhookHandlerResult> {
  if (!(await isAdmin(userId))) {
    await replyError(replyToken, "คุณไม่มีสิทธิ์จัดการกลุ่มแอดมิน");
    return { status: "error", error: "Unauthorized" };
  }

  if (!context.groupId) {
    await replyError(replyToken, "คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น");
    return { status: "error", error: "Not a group chat" };
  }

  await lineClient.setGroupRole(context.groupId, "admin");

  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: "✅ ตั้งกลุ่มนี้เป็นกลุ่มแอดมินแล้ว\n\nพิมพ์ 'วันชา' เพื่อเปิดเมนู",
  });

  return { status: "success", message: "Group set as admin" };
}

async function handleAdminGroupRemove(
  userId: string,
  replyToken: string,
  context: ConversationContext,
): Promise<WebhookHandlerResult> {
  if (!(await isAdmin(userId))) {
    await replyError(replyToken, "คุณไม่มีสิทธิ์จัดการกลุ่มแอดมิน");
    return { status: "error", error: "Unauthorized" };
  }

  if (!context.groupId) {
    await replyError(replyToken, "คำสั่งนี้ใช้ได้เฉพาะในกลุ่มเท่านั้น");
    return { status: "error", error: "Not a group chat" };
  }

  await lineClient.setGroupRole(context.groupId, "customer");

  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: "✅ ยกเลิกกลุ่มแอดมินแล้ว\n\nกลุ่มนี้จะถูกตั้งเป็นกลุ่มลูกค้า",
  });

  return { status: "success", message: "Group removed from admin" };
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    paid: "รอดำเนินการ",
    blending: "กำลังผสม",
    packing: "กำลังบรรจุ",
    shipping: "รอส่ง",
    shipped: "ส่งแล้ว",
    cancelled: "ยกเลิก",
    processing: "กำลังเตรียม",
  };
  return labels[status] || status;
}
