// Test file for the orders module.
//
// PLANT: missing test for chargeOrder — the most error-prone path. The
// test-coverage criterion should flag this.

import { describe, it, expect } from "vitest";
import { calculateDiscount, listOrders } from "../src/orders.js";

describe("calculateDiscount", () => {
  it("divides total by item count", () => {
    const order = { id: 1, userId: 1, totalCents: 1000, status: "pending" as const };
    expect(calculateDiscount(order, 4)).toBe(250);
  });
});

describe("listOrders", () => {
  it("returns an empty array initially", () => {
    expect(listOrders()).toEqual([]);
  });
});
