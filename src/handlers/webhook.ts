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
  buildDailyDigestMessage,
  buildWeeklySummaryMessage,
} from "../messages/flex-builder";
import { hasAdminSession, createAdminSession } from "../services/admin-session";
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
  // Check environment variables first
  if (ADMIN_USER_IDS.includes(userId)) {
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

  if (!context.isAdminGroup && !(await isAdmin(userId))) {
    await replyError(replyToken, "คุณไม่มีสิทธิ์เข้าถึงระบบ");
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
        await replySuccess(replyToken, `รับออเดอร์ #${shortId} แล้ว!`);
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

  if (isMentioned) {
    if (context.isCustomerConversation) {
      return await handleCustomerConversation(
        context.conversationId,
        replyToken,
        text,
      );
    }

    if (!(await isAdmin(userId)) && !context.isAdminGroup) {
      return { status: "ignored", message: "Unauthorized" };
    }

    // Show command dashboard
    const message = buildCommandDashboard();
    await lineClient.replyMessage(replyToken, message);
    return { status: "success", message: "Command dashboard sent" };
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
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "❌ ระบบแอดมินไม่ได้เปิดใช้งาน",
    });
    return { status: "error", error: "Admin password not configured" };
  }

  // Check if user already has admin session
  if (await hasAdminSession(userId)) {
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "✅ คุณมีสิทธิ์แอดมินอยู่แล้ว\n\nพิมพ์ 'วันชา' เพื่อเปิดเมนู",
    });
    return { status: "success", message: "User already has admin session" };
  }

  // Set user as awaiting password input
  await setAwaitingAdminPassword(userId);

  await lineClient.replyMessage(replyToken, {
    type: "text",
    text: "🔐 กรุณากรอกรหัสผ่านแอดมิน:",
  });

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
    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "❌ ระบบแอดมินไม่ได้เปิดใช้งาน",
    });
    return { status: "error", error: "Admin password not configured" };
  }

  // Verify password
  if (password.trim() === adminPassword) {
    // Create admin session
    await createAdminSession(userId);
    await clearAdminLoginState(userId);

    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "✅ เข้าสู่ระบบแอดมินสำเร็จ!\n\nพิมพ์ 'วันชา' เพื่อเปิดเมนู",
    });

    return { status: "success", message: "Admin login successful" };
  } else {
    await clearAdminLoginState(userId);

    await lineClient.replyMessage(replyToken, {
      type: "text",
      text: "❌ รหัสผ่านไม่ถูกต้อง\n\nกรุณาลองใหม่อีกครั้ง",
    });

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
