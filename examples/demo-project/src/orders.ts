// Order processing with deliberate issues for the deskcheck demo.

interface Order {
  id: number;
  userId: number;
  totalCents: number;
  status: "pending" | "paid" | "shipped" | "cancelled";
}

const orders: Map<number, Order> = new Map();

/**
 * Charge an order via the payment provider.
 *
 * PLANT: unhandled promise rejection — the inner `chargeCard` returns a
 * promise but we don't await or catch. Errors will surface as
 * UnhandledPromiseRejection at runtime.
 *
 * PLANT: no validation that the order is actually in `pending` state. A
 * caller could re-charge a paid order.
 */
export function chargeOrder(orderId: number): void {
  const order = orders.get(orderId);
  if (!order) return;
  chargeCard(order.totalCents);
  order.status = "paid";
}

declare function chargeCard(cents: number): Promise<void>;

/**
 * Calculate a discount for an order.
 *
 * PLANT: division by zero possible if the order has no items. The function
 * also doesn't validate input.
 */
export function calculateDiscount(order: Order, itemCount: number): number {
  return order.totalCents / itemCount;
}

export function listOrders(): Order[] {
  return Array.from(orders.values());
}
