import { strict as assert } from "node:assert";
import { test, describe } from "node:test";

import { addScan, computeTotals, lineTotalCents, setQuantity, toSalePayload } from "./cart.ts";
import type { CartLine } from "./cart.ts";
import { formatMoney, parseMoneyToCents, roundHalfAwayFromZero } from "./money.ts";

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "11111111-1111-4111-8111-111111111111",
  name: "Coca-Cola 500ml",
  unitPriceCents: 120,
  quantity: 1,
  unit: "each",
  ...over,
});

describe("computeTotals", () => {
  test("no tax is just the sum of the lines", () => {
    const totals = computeTotals(
      [line({ quantity: 3 }), line({ productId: "b", unitPriceCents: 80, quantity: 2 })],
      { rate: 0, inclusive: false },
    );
    assert.equal(totals.subtotalCents, 520);
    assert.equal(totals.taxCents, 0);
    assert.equal(totals.totalCents, 520);
  });

  test("exclusive tax is added on top", () => {
    const totals = computeTotals([line({ quantity: 10 })], { rate: 0.15, inclusive: false });
    assert.equal(totals.subtotalCents, 1200);
    assert.equal(totals.taxCents, 180);
    assert.equal(totals.totalCents, 1380);
  });

  test("inclusive tax is backed out, leaving the total at the shelf price", () => {
    const totals = computeTotals([line({ quantity: 10 })], { rate: 0.15, inclusive: true });
    assert.equal(totals.subtotalCents, 1200);
    // 1200 * 0.15 / 1.15 = 156.52 -> 157
    assert.equal(totals.taxCents, 157);
    assert.equal(totals.totalCents, 1200);
  });

  test("matches the sales_totals_balance constraint in both tax modes", () => {
    const lines = [line({ quantity: 7 }), line({ productId: "b", unitPriceCents: 95, quantity: 3 })];

    const exclusive = computeTotals(lines, { rate: 0.15, inclusive: false }, 50);
    assert.equal(
      exclusive.totalCents,
      exclusive.subtotalCents - exclusive.discountCents + exclusive.taxCents,
    );

    const inclusive = computeTotals(lines, { rate: 0.15, inclusive: true }, 50);
    assert.equal(inclusive.totalCents, inclusive.subtotalCents - inclusive.discountCents);
  });

  test("discount is clamped to the subtotal, never producing a negative total", () => {
    const totals = computeTotals([line()], { rate: 0.15, inclusive: false }, 99_999);
    assert.equal(totals.discountCents, 120);
    assert.equal(totals.totalCents, 0);
  });

  test("negative discounts are ignored rather than inflating the bill", () => {
    const totals = computeTotals([line()], { rate: 0, inclusive: false }, -500);
    assert.equal(totals.discountCents, 0);
    assert.equal(totals.totalCents, 120);
  });

  test("weighed goods round to whole cents per line", () => {
    // 1.234 kg at 310c/kg = 382.54c
    const totals = computeTotals(
      [line({ unit: "kg", quantity: 1.234, unitPriceCents: 310 })],
      { rate: 0, inclusive: false },
    );
    assert.equal(totals.subtotalCents, 383);
    assert.ok(Number.isInteger(totals.totalCents));
  });

  test("an empty cart totals zero rather than NaN", () => {
    const totals = computeTotals([], { rate: 0.15, inclusive: true });
    assert.deepEqual(totals, {
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });
});

describe("addScan", () => {
  test("re-scanning a unit item bumps quantity instead of adding a row", () => {
    const cart = addScan(addScan([], line()), line());
    assert.equal(cart.length, 1);
    assert.equal(cart[0]!.quantity, 2);
  });

  test("weighed items stay separate — two weighings are two amounts", () => {
    const first = line({ unit: "kg", quantity: 1.5 });
    const second = line({ unit: "kg", quantity: 0.8 });
    const cart = addScan(addScan([], first), second);
    assert.equal(cart.length, 2);
  });

  test("the same product at a different price does not merge", () => {
    const cart = addScan(addScan([], line()), line({ unitPriceCents: 100 }));
    assert.equal(cart.length, 2);
  });
});

describe("setQuantity", () => {
  test("zero removes the line", () => {
    const cart = setQuantity([line()], line().productId, 0);
    assert.equal(cart.length, 0);
  });
});

describe("toSalePayload", () => {
  test("emits the shape process_sale expects", () => {
    const payload = toSalePayload([line({ quantity: 2 })], "abcd1234", "cash", 0, new Date(0));
    assert.equal(payload.client_id, "abcd1234");
    assert.equal(payload.payment_method, "cash");
    assert.deepEqual(payload.items, [
      { product_id: line().productId, quantity: 2, unit_price_cents: 120 },
    ]);
  });
});

describe("money", () => {
  test("rounds half away from zero, the way Postgres round() does", () => {
    assert.equal(roundHalfAwayFromZero(2.5), 3);
    assert.equal(roundHalfAwayFromZero(-2.5), -3); // Math.round would give -2
    assert.equal(roundHalfAwayFromZero(-0.5), -1);
  });

  test("parses the ways an owner actually types a price", () => {
    assert.equal(parseMoneyToCents("1,500", "USD"), 150_000);
    assert.equal(parseMoneyToCents("$12.50", "USD"), 1250);
    assert.equal(parseMoneyToCents("12,50", "EUR"), 1250);
    assert.equal(parseMoneyToCents("", "USD"), null);
    assert.equal(parseMoneyToCents("abc", "USD"), null);
  });

  test("respects currencies with no minor unit", () => {
    assert.equal(parseMoneyToCents("1500", "JPY"), 1500);
    assert.equal(lineTotalCents(line({ unitPriceCents: 1500 })), 1500);
  });

  test("formats without throwing on an unknown currency", () => {
    assert.ok(formatMoney(1200, "USD", "en-US").includes("12"));
    assert.ok(formatMoney(1200, "XYZ").includes("12"));
  });
});
