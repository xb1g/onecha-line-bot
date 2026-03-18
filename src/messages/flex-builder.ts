/**
 * LINE Flex Message builders for the Onecha fulfillment bot.
 * Dark theme, Thai language, admin-only.
 */

import { OrderDocument, CustomerDocument, WeeklyStats } from "../types/mongodb";
import { getShortOrderId, formatOrderAmount } from "../utils/order-formatting";

// =============================================================================
// Types
// =============================================================================

export interface FlexMessage {
  type: "flex";
  altText: string;
  contents: FlexBubble | FlexCarousel;
}

export interface FlexBubble {
  type: "bubble";
  size?: string;
  direction?: string;
  header?: FlexBox;
  hero?: FlexBox;
  body?: FlexBox;
  footer?: FlexBox;
  styles?: FlexBubbleStyles;
}

export interface FlexCarousel {
  type: "carousel";
  contents: FlexBubble[];
}

export interface FlexBox {
  type: "box";
  layout: "horizontal" | "vertical" | "baseline";
  contents: FlexComponent[];
  flex?: number;
  spacing?: string;
  margin?: string;
  paddingAll?: string;
  backgroundColor?: string;
  borderColor?: string;
  cornerRadius?: string;
  width?: string;
  height?: string;
  justifyContent?: string;
  alignItems?: string;
}

export interface FlexText {
  type: "text";
  text: string;
  size?: string;
  weight?: "regular" | "bold";
  color?: string;
  flex?: number;
  margin?: string;
  wrap?: boolean;
  maxLines?: number;
  align?: "start" | "center" | "end";
}

export interface FlexButton {
  type: "button";
  action: FlexAction;
  style?: "link" | "primary" | "secondary";
  color?: string;
  height?: string;
  margin?: string;
  flex?: number;
}

export interface FlexSeparator {
  type: "separator";
  margin?: string;
  color?: string;
}

export type FlexComponent = FlexBox | FlexText | FlexButton | FlexSeparator;

export interface FlexAction {
  type: "message" | "uri" | "postback" | "datetimepicker";
  label: string;
  data?: string;
  text?: string;
  uri?: string;
  mode?: string;
  initial?: string;
  max?: string;
  min?: string;
}

export interface FlexBubbleStyles {
  header?: FlexBlockStyle;
  body?: FlexBlockStyle;
  footer?: FlexBlockStyle;
}

export interface FlexBlockStyle {
  backgroundColor?: string;
  separator?: boolean;
  separatorColor?: string;
}

// =============================================================================
// Dark Theme Colors
// =============================================================================

const COLORS = {
  primary: "#6DB944",
  secondary: "#8ED964",
  background: "#000000",
  backgroundCard: "#0a0a0a",
  backgroundHeader: "#111111",
  border: "#6DB94433",
  warning: "#F59E0B",
  danger: "#EF4444",
  text: "#FFFFFF",
  textLight: "#9CA3AF",
  textMuted: "#6B7280",
};

// =============================================================================
// Order Card Builder
// =============================================================================

export function buildOrderCard(order: OrderDocument, customer?: CustomerDocument | null): FlexBubble {
  const orderId = getShortOrderId(order);

  const addr = order.shippingAddress;
  const addressLines: string[] = [];
  if (addr?.line1) addressLines.push(addr.line1);
  if (addr?.line2) addressLines.push(addr.line2);
  if (addr?.city || addr?.state || addr?.postalCode) {
    const cityState = [addr.city, addr.state].filter(Boolean).join(" ");
    if (cityState) addressLines.push(cityState);
    if (addr.postalCode) addressLines[addressLines.length - 1] += ` ${addr.postalCode}`;
  }
  const shippingAddress = addressLines.length > 0 ? addressLines.join("\n") : "-";

  const customerName = customer?.name || order.customerEmail.split("@")[0];
  const customerPhone = customer?.phone || "-";

  const ageHours = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / (1000 * 60 * 60));
  const ageBadge = ageHours >= 24 ? "🔴" : ageHours >= 12 ? "🟡" : "🟢";
  const ageText = ageHours >= 24 ? `${Math.floor(ageHours / 24)} วัน` : `${ageHours} ชม.`;

  const statusThai: Record<string, string> = {
    paid: "รอรับออเดอร์",
    processing: "กำลังเตรียม",
    shipped: "ส่งแล้ว",
  };
  const statusColor: Record<string, string> = {
    paid: COLORS.warning,
    processing: COLORS.primary,
    shipped: COLORS.secondary,
  };

  const shippingInfoText = `ชื่อ: ${customerName}\nเบอร์: ${customerPhone}\nที่อยู่: ${shippingAddress}`;

  const buttons: FlexComponent[] = [];

  if (order.status === "paid") {
    buttons.push(
      createButton("✓ รับ", `accept_order:${order._id}`, "primary"),
      createButton("📋 คัดลอก", `copy_shipping:${order._id}:${Buffer.from(shippingInfoText).toString('base64')}`, "secondary")
    );
  } else if (order.status === "processing") {
    buttons.push(
      createButton("🚚 ส่ง", `ship_order:${order._id}`, "primary"),
      createButton("📋 คัดลอก", `copy_shipping:${order._id}:${Buffer.from(shippingInfoText).toString('base64')}`, "secondary")
    );
  }

  return {
    type: "bubble",
    size: "kilo",
    styles: {
      header: { backgroundColor: COLORS.backgroundHeader },
      body: { backgroundColor: COLORS.backgroundCard },
      footer: { backgroundColor: COLORS.background, separator: true, separatorColor: COLORS.border },
    },
    header: {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: `${ageBadge} #${orderId}`, weight: "bold", size: "lg", color: COLORS.text, flex: 1 },
        { type: "text", text: ageText, size: "sm", color: COLORS.textLight, align: "end" },
      ],
      paddingAll: "md",
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        createField("สินค้า", order.items.map((i) => `${i.productName} x${i.quantity}`).join(", ")),
        createField("ชื่อลูกค้า", customerName),
        createField("เบอร์โทร", customerPhone),
        {
          type: "box",
          layout: "vertical",
          contents: [
            { type: "text", text: "ที่อยู่จัดส่ง", size: "xs", color: COLORS.textMuted },
            { type: "text", text: shippingAddress, size: "sm", color: COLORS.text, wrap: true, maxLines: 3 },
          ],
          margin: "sm",
        },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            { type: "text", text: "สถานะ", size: "sm", color: COLORS.textLight, flex: 1 },
            { type: "text", text: statusThai[order.status] || order.status, size: "sm", weight: "bold", color: statusColor[order.status] || COLORS.text, align: "end" },
          ],
          margin: "md",
        },
      ],
      paddingAll: "md",
    },
    footer: buttons.length > 0 ? {
      type: "box",
      layout: "horizontal",
      contents: buttons,
      spacing: "sm",
      paddingAll: "sm",
    } : undefined,
  };
}

// =============================================================================
// Daily Digest Builder
// =============================================================================

export function buildDailyDigestMessage(
  orders: OrderDocument[],
  date: Date,
  customers?: Map<string, CustomerDocument | null>
): FlexMessage {
  if (orders.length === 0) {
    return buildNoOrdersMessage(date);
  }

  const newOrders = orders.filter(o => o.status === "paid").length;
  const processingOrders = orders.filter(o => o.status === "processing").length;

  const headerBubble: FlexBubble = {
    type: "bubble",
    size: "kilo",
    styles: { body: { backgroundColor: COLORS.backgroundHeader } },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "☕ สวัสดีตอนเช้า!", size: "xl", weight: "bold", color: COLORS.primary },
        { type: "text", text: formatDateThai(date), size: "sm", color: COLORS.textLight, margin: "xs" },
        { type: "separator", margin: "md", color: COLORS.border },
        {
          type: "box",
          layout: "horizontal",
          contents: [
            createStatColumn(orders.length.toString(), "ออเดอร์ทั้งหมด"),
            createStatColumn(newOrders.toString(), "ใหม่", COLORS.warning),
            createStatColumn(processingOrders.toString(), "กำลังเตรียม", COLORS.primary),
          ],
          margin: "md",
        },
      ],
      paddingAll: "lg",
    },
  };

  const orderBubbles = orders.slice(0, 10).map(order =>
    buildOrderCard(order, customers?.get(order._id?.toString() || ""))
  );

  return {
    type: "flex",
    altText: `สรุปออเดอร์วันนี้: ${orders.length} รายการ`,
    contents: {
      type: "carousel",
      contents: [headerBubble, ...orderBubbles],
    },
  };
}

function buildNoOrdersMessage(date: Date): FlexMessage {
  return {
    type: "flex",
    altText: "ไม่มีออเดอร์วันนี้",
    contents: {
      type: "bubble",
      styles: { body: { backgroundColor: COLORS.backgroundCard } },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "☕ สวัสดีตอนเช้า!", size: "xl", weight: "bold", color: COLORS.primary, align: "center" },
          { type: "text", text: formatDateThai(date), size: "sm", color: COLORS.textLight, align: "center", margin: "xs" },
          { type: "separator", margin: "lg", color: COLORS.border },
          { type: "text", text: "ไม่มีออเดอร์ที่ต้องเตรียมวันนี้ 🍵", size: "lg", color: COLORS.secondary, align: "center", margin: "xl" },
        ],
        paddingAll: "xl",
        justifyContent: "center",
        alignItems: "center",
      },
    },
  };
}

// =============================================================================
// Reminder Builder
// =============================================================================

export function buildReminderMessage(
  order: OrderDocument,
  customer: CustomerDocument | null,
  daysSincePaid: number
): FlexMessage {
  const orderId = getShortOrderId(order);
  const urgency = daysSincePaid >= 7 ? "urgent" : daysSincePaid >= 3 ? "warning" : "normal";

  const headerText = urgency === "urgent" ? "🔴 เร่งด่วน!" : urgency === "warning" ? "🟡 เตือน" : "📦 ออเดอร์";
  const headerColor = urgency === "urgent" ? COLORS.danger : urgency === "warning" ? COLORS.warning : COLORS.primary;

  const addr = order.shippingAddress;
  const addressLines: string[] = [];
  if (addr?.line1) addressLines.push(addr.line1);
  if (addr?.line2) addressLines.push(addr.line2);
  if (addr?.city || addr?.state || addr?.postalCode) {
    const cityState = [addr.city, addr.state].filter(Boolean).join(" ");
    if (cityState) addressLines.push(cityState);
    if (addr.postalCode) addressLines[addressLines.length - 1] += ` ${addr.postalCode}`;
  }
  const shippingAddress = addressLines.length > 0 ? addressLines.join("\n") : "-";

  const customerName = customer?.name || order.customerEmail.split("@")[0];
  const customerPhone = customer?.phone || "-";
  const shippingInfoText = `ชื่อ: ${customerName}\nเบอร์: ${customerPhone}\nที่อยู่: ${shippingAddress}`;

  return {
    type: "flex",
    altText: `เตือน: ออเดอร์ #${orderId} รอส่งมา ${daysSincePaid} วัน`,
    contents: {
      type: "bubble",
      styles: {
        header: { backgroundColor: urgency === "urgent" ? "#1a0a0a" : COLORS.backgroundHeader },
        body: { backgroundColor: COLORS.backgroundCard },
        footer: { backgroundColor: COLORS.background, separator: true, separatorColor: COLORS.border },
      },
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: headerText, size: "lg", weight: "bold", color: headerColor },
          { type: "text", text: `ออเดอร์ #${orderId} รอมา ${daysSincePaid} วันแล้ว`, size: "sm", color: COLORS.textLight, margin: "xs" },
        ],
        paddingAll: "md",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          createField("สินค้า", order.items.map((i) => i.productName).join(", ")),
          createField("ชื่อลูกค้า", customerName),
          createField("เบอร์โทร", customerPhone),
          {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "ที่อยู่จัดส่ง", size: "xs", color: COLORS.textMuted },
              { type: "text", text: shippingAddress, size: "sm", color: COLORS.text, wrap: true, maxLines: 3 },
            ],
            margin: "sm",
          },
        ],
        paddingAll: "md",
      },
      footer: {
        type: "box",
        layout: "horizontal",
        contents: [
          createButton("🚚 ส่งเลย", `ship_order:${order._id}`, "primary"),
          createButton("📋 คัดลอก", `copy_shipping:${order._id}:${Buffer.from(shippingInfoText).toString('base64')}`, "secondary"),
        ],
        spacing: "sm",
        paddingAll: "sm",
      },
    },
  };
}

// =============================================================================
// Weekly Summary Builder
// =============================================================================

export function buildWeeklySummaryMessage(stats: WeeklyStats): FlexMessage {
  return {
    type: "flex",
    altText: "สรุปประจำสัปดาห์",
    contents: {
      type: "bubble",
      styles: {
        header: { backgroundColor: COLORS.backgroundHeader },
        body: { backgroundColor: COLORS.backgroundCard },
        footer: { backgroundColor: COLORS.background },
      },
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📊 สรุปประจำสัปดาห์", size: "xl", weight: "bold", color: COLORS.primary },
          { type: "text", text: "ย้อนหลัง 7 วัน", size: "sm", color: COLORS.textLight, margin: "xs" },
        ],
        paddingAll: "lg",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          createStatRow("📦 ส่งแล้ว", `${stats.ordersShipped} รายการ`),
          { type: "separator", margin: "md", color: COLORS.border },
          createStatRow("⏱️ เวลาเฉลี่ย", `${stats.avgTimeToShip.toFixed(1)} วัน`),
          { type: "separator", margin: "md", color: COLORS.border },
          createStatRow("⚠️ รอนาน", `${stats.stuckOrders} รายการ`, stats.stuckOrders > 0 ? COLORS.danger : COLORS.primary),
        ],
        paddingAll: "lg",
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: stats.stuckOrders === 0 ? "เยี่ยมมาก! 🎉" : "รีบส่งออเดอร์ที่ค้างอยู่นะ!",
            size: "md",
            color: COLORS.secondary,
            align: "center",
          },
        ],
        paddingAll: "md",
      },
    },
  };
}

// =============================================================================
// Command Dashboard Builder
// =============================================================================

export function buildCommandDashboard(): FlexMessage {
  return {
    type: "flex",
    altText: "เมนูวันชา",
    contents: {
      type: "bubble",
      styles: {
        header: { backgroundColor: COLORS.backgroundHeader },
        body: { backgroundColor: COLORS.backgroundCard },
      },
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "🍵 วันชา แดชบอร์ด", size: "xl", weight: "bold", color: COLORS.primary },
          { type: "text", text: "เลือกคำสั่งที่ต้องการ", size: "sm", color: COLORS.textLight, margin: "xs" },
        ],
        paddingAll: "lg",
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          createButton("📋 ออเดอร์วันนี้", "cmd:today_orders", "primary"),
          createButton("📦 กำลังเตรียมสินค้า", "cmd:processing_orders", "secondary"),
          createButton("🚚 รอจัดส่ง", "cmd:pending_shipments", "secondary"),
          { type: "separator", margin: "md", color: COLORS.border },
          createButton("📊 สรุปสัปดาห์", "cmd:weekly_stats", "link"),
        ],
        paddingAll: "lg",
      },
    },
  };
}

// =============================================================================
// Customer Notifications
// =============================================================================

export function buildCustomerShippingNotification(
  order: OrderDocument,
  trackingUrl: string,
  carrierName: string
): FlexMessage {
  return {
    type: "flex",
    altText: "สินค้าของคุณกำลังจัดส่ง! 📦",
    contents: {
      type: "bubble",
      styles: {
        header: { backgroundColor: COLORS.primary },
        body: { backgroundColor: COLORS.backgroundCard },
        footer: { backgroundColor: COLORS.background },
      },
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "🍵 มาต๋าของคุณกำลังจัดส่ง!", size: "lg", weight: "bold", color: COLORS.text },
        ],
        paddingAll: "lg",
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "ออเดอร์ของคุณถูกจัดส่งแล้ว!", size: "md", color: COLORS.text, margin: "sm" },
          { type: "separator", margin: "md", color: COLORS.border },
          createField("ขนส่ง", carrierName),
          createField("เลขพัสดุ", order.trackingNumber || ""),
          {
            type: "button",
            action: { type: "uri", label: "📦 ติดตามพัสดุ", uri: trackingUrl },
            style: "primary",
            color: COLORS.primary,
            margin: "lg",
          },
        ],
        paddingAll: "lg",
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "ขอบคุณที่สั่งซื้อครับ 🍵", size: "sm", color: COLORS.textLight, align: "center" },
        ],
        paddingAll: "md",
      },
    },
  };
}

export function buildCustomerOrderAcceptedMessage(order: OrderDocument): FlexMessage {
  const orderId = getShortOrderId(order);
  return {
    type: "flex",
    altText: "ออเดอร์ของคุณกำลังเตรียม!",
    contents: {
      type: "bubble",
      styles: { body: { backgroundColor: COLORS.backgroundCard } },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "📦 อัปเดตออเดอร์", size: "xl", weight: "bold", color: COLORS.primary },
          { type: "text", text: "ออเดอร์ #" + orderId, size: "sm", color: COLORS.textLight, margin: "xs" },
          { type: "separator", margin: "md", color: COLORS.border },
          { type: "text", text: "ออเดอร์ของคุณกำลังถูกเตรียมโดยทีมของเรา! 🍵", size: "md", color: COLORS.text, margin: "md" },
          { type: "text", text: "เราจะแจ้งให้ทราบเมื่อจัดส่งแล้ว", size: "sm", color: COLORS.textLight },
        ],
        paddingAll: "lg",
      },
    },
  };
}

export function buildCustomerOrderConfirmedMessage(order: OrderDocument): FlexMessage {
  const orderId = getShortOrderId(order);
  return {
    type: "flex",
    altText: "ได้รับออเดอร์แล้ว!",
    contents: {
      type: "bubble",
      styles: { body: { backgroundColor: COLORS.backgroundCard } },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "🍵 ได้รับออเดอร์แล้ว!", size: "xl", weight: "bold", color: COLORS.primary },
          { type: "text", text: "ออเดอร์ #" + orderId, size: "sm", color: COLORS.textLight, margin: "xs" },
          { type: "separator", margin: "md", color: COLORS.border },
          { type: "text", text: "ยอดรวม: " + formatOrderAmount(order.totalAmount), size: "lg", weight: "bold", color: COLORS.text, margin: "md" },
          { type: "text", text: "เราจะแจ้งเมื่อได้รับการยืนยันการชำระเงิน", size: "sm", color: COLORS.textLight },
        ],
        paddingAll: "lg",
      },
    },
  };
}

export function buildCustomerPaymentVerifiedMessage(order: OrderDocument): FlexMessage {
  const orderId = getShortOrderId(order);
  return {
    type: "flex",
    altText: "ยืนยันการชำระเงินแล้ว!",
    contents: {
      type: "bubble",
      styles: { body: { backgroundColor: COLORS.backgroundCard } },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "✅ ยืนยันการชำระเงินแล้ว!", size: "xl", weight: "bold", color: COLORS.primary },
          { type: "text", text: "ออเดอร์ #" + orderId, size: "sm", color: COLORS.textLight, margin: "xs" },
          { type: "separator", margin: "md", color: COLORS.border },
          { type: "text", text: "มาต๋าของคุณกำลังถูกเตรียมอย่างพิถีพิถัน! 🍵", size: "md", color: COLORS.text, margin: "md" },
          { type: "text", text: "เราจะแจ้งให้ทราบเมื่อจัดส่ง", size: "sm", color: COLORS.textLight },
        ],
        paddingAll: "lg",
      },
    },
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function createField(label: string, value: string): FlexBox {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: COLORS.textLight, flex: 1 },
      { type: "text", text: value, size: "sm", weight: "bold", color: COLORS.text, flex: 2, align: "end", wrap: true },
    ],
    margin: "sm",
  };
}

function createButton(label: string, postData: string, style: "primary" | "secondary" | "link"): FlexButton {
  const colors = {
    primary: COLORS.primary,
    secondary: "#333333",
    link: COLORS.text,
  };
  return {
    type: "button",
    action: { type: "postback", label, data: postData },
    style: style === "link" ? "link" : style,
    color: colors[style],
    height: "sm",
  };
}

function createStatColumn(value: string, label: string, color = COLORS.text): FlexBox {
  return {
    type: "box",
    layout: "vertical",
    contents: [
      { type: "text", text: value, size: "xl", weight: "bold", color, align: "center" },
      { type: "text", text: label, size: "xs", color: COLORS.textMuted, align: "center" },
    ],
    flex: 1,
  };
}

function createStatRow(label: string, value: string, valueColor = COLORS.primary): FlexBox {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "md", color: COLORS.text, flex: 1 },
      { type: "text", text: value, size: "lg", weight: "bold", color: valueColor, align: "end" },
    ],
    margin: "md",
  };
}

function formatDateThai(date: Date): string {
  const days = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const months = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
}
