import { ObjectId } from "mongodb";
import { getCollection } from "../lib/mongodb";
import {
  OrderDocument,
  CustomerDocument,
  WeeklyStats,
} from "../types/mongodb";

// =============================================================================
// Custom Error Classes
// =============================================================================

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = "OrderNotFoundError";
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid status transition from "${from}" to "${to}"`);
    this.name = "InvalidStatusTransitionError";
  }
}

export class OrderAlreadyAcceptedError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} has already been accepted`);
    this.name = "OrderAlreadyAcceptedError";
  }
}

// =============================================================================
// Fulfillment Service
// =============================================================================

export class FulfillmentService {
  /**
   * Get orders with status 'paid' or 'processing' for daily digest
   */
  async getDailyDigestOrders(): Promise<OrderDocument[]> {
    const collection = await getCollection<OrderDocument>("orders");
    const orders = await collection
      .find({
        status: { $in: ["paid", "processing"] },
      })
      .sort({ createdAt: -1 })
      .toArray();
    return orders;
  }

  /**
   * Accept an order and mark it as processing
   */
  async acceptOrder(
    orderId: string,
    lineUserId: string
  ): Promise<OrderDocument> {
    const collection = await getCollection<OrderDocument>("orders");
    const objectId = new ObjectId(orderId);

    const order = await collection.findOne({ _id: objectId });
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    if (order.status === "processing") {
      throw new OrderAlreadyAcceptedError(orderId);
    }

    if (order.status !== "paid") {
      throw new InvalidStatusTransitionError(order.status, "processing");
    }

    const statusHistoryEntry = {
      status: "processing",
      at: new Date(),
      by: lineUserId,
      note: "Order accepted via LINE bot",
    };

    await collection.updateOne(
      { _id: objectId },
      {
        $set: {
          status: "processing",
          acceptedAt: new Date(),
          acceptedBy: lineUserId,
          updatedAt: new Date(),
        },
        $push: {
          statusHistory: statusHistoryEntry,
        },
      }
    );

    const updatedOrder = await collection.findOne({ _id: objectId });
    return updatedOrder!;
  }

  /**
   * Schedule an order for later fulfillment
   */
  async scheduleFulfillment(
    orderId: string,
    lineUserId: string,
    scheduledDate: Date
  ): Promise<OrderDocument> {
    const collection = await getCollection<OrderDocument>("orders");
    const objectId = new ObjectId(orderId);

    const order = await collection.findOne({ _id: objectId });
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    if (order.status !== "paid" && order.status !== "processing") {
      throw new InvalidStatusTransitionError(
        order.status,
        "scheduled"
      );
    }

    await collection.updateOne(
      { _id: objectId },
      {
        $set: {
          scheduledShipDate: scheduledDate,
          scheduledBy: lineUserId,
          updatedAt: new Date(),
        },
      }
    );

    const updatedOrder = await collection.findOne({ _id: objectId });
    return updatedOrder!;
  }

  /**
   * Mark an order as shipped with tracking information
   */
  async shipOrder(
    orderId: string,
    trackingNumber: string,
    carrier: string,
    trackingUrl: string
  ): Promise<OrderDocument> {
    const collection = await getCollection<OrderDocument>("orders");
    const objectId = new ObjectId(orderId);

    const order = await collection.findOne({ _id: objectId });
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    if (order.status !== "processing" && order.status !== "paid") {
      throw new InvalidStatusTransitionError(order.status, "shipped");
    }

    const statusHistoryEntry = {
      status: "shipped",
      at: new Date(),
      note: `Shipped via ${carrier} with tracking ${trackingNumber}`,
    };

    await collection.updateOne(
      { _id: objectId },
      {
        $set: {
          status: "shipped",
          trackingNumber,
          carrier,
          trackingUrl,
          shippedAt: new Date(),
          customerNotified: false,
          updatedAt: new Date(),
        },
        $push: {
          statusHistory: statusHistoryEntry,
        },
      }
    );

    const updatedOrder = await collection.findOne({ _id: objectId });
    return updatedOrder!;
  }

  /**
   * Get unshipped orders (processing status)
   * Optionally filter for orders older than specified days
   */
  async getUnshippedOrders(
    olderThanDays?: number
  ): Promise<OrderDocument[]> {
    const collection = await getCollection<OrderDocument>("orders");

    const query: any = { status: "processing" };

    if (olderThanDays !== undefined) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      query.acceptedAt = { $lt: cutoffDate };
    }

    const orders = await collection
      .find(query)
      .sort({ acceptedAt: 1 })
      .toArray();
    return orders;
  }

  /**
   * Get escalated orders (processing for more than 5 days)
   */
  async getEscalatedOrders(): Promise<OrderDocument[]> {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const collection = await getCollection<OrderDocument>("orders");
    const orders = await collection
      .find({
        status: "processing",
        acceptedAt: { $lt: fiveDaysAgo },
      })
      .sort({ acceptedAt: 1 })
      .toArray();
    return orders;
  }

  /**
   * Get orders that need a reminder (processing for 3+ days, no reminder sent)
   */
  async getOrdersNeedingReminder(): Promise<OrderDocument[]> {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const collection = await getCollection<OrderDocument>("orders");
    const orders = await collection
      .find({
        status: "processing",
        acceptedAt: { $lt: threeDaysAgo },
        $or: [
          { lastReminderSent: { $exists: false } },
          { lastReminderSent: null },
        ],
      })
      .sort({ acceptedAt: 1 })
      .toArray();
    return orders;
  }

  /**
   * Mark that a reminder was sent for an order
   */
  async markReminderSent(orderId: string): Promise<void> {
    const collection = await getCollection<OrderDocument>("orders");
    const objectId = new ObjectId(orderId);

    const order = await collection.findOne({ _id: objectId });
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }

    await collection.updateOne(
      { _id: objectId },
      {
        $set: {
          lastReminderSent: new Date(),
          updatedAt: new Date(),
        },
        $inc: {
          reminderCount: 1,
        },
      }
    );
  }

  /**
   * Get weekly fulfillment statistics
   */
  async getWeeklyStats(): Promise<WeeklyStats> {
    const collection = await getCollection<OrderDocument>("orders");
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Get orders shipped in the last week
    const shippedOrders = await collection
      .find({
        status: "shipped",
        shippedAt: { $gte: oneWeekAgo },
      })
      .toArray();

    const ordersShipped = shippedOrders.length;

    // Calculate average time to ship
    let totalTimeToShip = 0;
    for (const order of shippedOrders) {
      if (order.acceptedAt && order.shippedAt) {
        totalTimeToShip +=
          order.shippedAt.getTime() - order.acceptedAt.getTime();
      }
    }
    const avgTimeToShip =
      ordersShipped > 0
        ? Math.round(totalTimeToShip / ordersShipped / (1000 * 60 * 60)) // Convert to hours
        : 0;

    // Get stuck orders (processing for more than 5 days)
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const stuckOrders = await collection.countDocuments({
      status: "processing",
      acceptedAt: { $lt: fiveDaysAgo },
    });

    return {
      ordersShipped,
      avgTimeToShip,
      stuckOrders,
    };
  }

  /**
   * Batch accept multiple orders
   */
  async acceptAllOrders(
    orderIds: string[],
    lineUserId: string
  ): Promise<{
    accepted: string[];
    failed: { orderId: string; error: string }[];
  }> {
    const accepted: string[] = [];
    const failed: { orderId: string; error: string }[] = [];

    for (const orderId of orderIds) {
      try {
        await this.acceptOrder(orderId, lineUserId);
        accepted.push(orderId);
      } catch (error) {
        failed.push({
          orderId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return { accepted, failed };
  }

  /**
   * Get a single order by ID
   */
  async getOrderById(orderId: string): Promise<OrderDocument | null> {
    const collection = await getCollection<OrderDocument>("orders");
    const objectId = new ObjectId(orderId);
    const order = await collection.findOne({ _id: objectId });
    return order;
  }

  /**
   * Get customer information for an order
   */
  async getCustomerForOrder(
    order: OrderDocument
  ): Promise<CustomerDocument | null> {
    if (!order.customerId) {
      return null;
    }

    const collection = await getCollection<CustomerDocument>("customers");
    const customer = await collection.findOne({ _id: order.customerId });
    return customer;
  }
}

// Export singleton instance
export const fulfillmentService = new FulfillmentService();
