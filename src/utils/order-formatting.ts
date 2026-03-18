import { OrderDocument } from "../types/mongodb";

export function getShortOrderId(order: OrderDocument): string {
  return order._id?.toString().slice(-6).toUpperCase() || "NEW";
}

export function formatOrderAmount(amount: number): string {
  return `${amount.toLocaleString()} บาท`;
}
