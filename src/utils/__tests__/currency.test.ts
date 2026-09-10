/**
 * PHP and MYR side by side.
 *
 * Sailings are international (PH <-> MY) and nothing converts between the two:
 * a ticket is sold, refunded and reconciled in the currency it was priced in.
 * So every amount rendered anywhere in this app has to carry its own currency,
 * and these three functions are the only place that happens.
 */

import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  currencySymbol,
  money,
  moneyWhole,
} from "@/utils/currency";

describe("the currencies a fare can be quoted in", () => {
  it("is exactly the pair the backend accepts", () => {
    // Must stay in sync with main.py's CURRENCIES tuple; a third one here
    // would render an amount the API will refuse to take payment for.
    expect(CURRENCIES).toEqual(["PHP", "MYR"]);
    expect(DEFAULT_CURRENCY).toBe("PHP");
  });
});

describe("currencySymbol", () => {
  it("knows both currencies the operator sells in", () => {
    expect(currencySymbol("PHP")).toBe("₱");
    expect(currencySymbol("MYR")).toBe("RM");
  });

  it("labels an unknown currency rather than rendering a bare number", () => {
    // An amount with no currency marker at all is the one thing a counter
    // must never be shown.
    expect(currencySymbol("USD")).toBe("USD ");
    expect(currencySymbol("SGD")).toBe("SGD ");
  });

  it("falls back to naming the default when no currency is given", () => {
    // Deliberately "PHP " and not "₱": a missing currency is a data problem,
    // and spelling it out makes that visible on screen instead of quietly
    // presenting the amount as pesos.
    expect(currencySymbol(null)).toBe("PHP ");
    expect(currencySymbol(undefined)).toBe("PHP ");
  });
});

describe("money", () => {
  it("renders pesos and ringgit with their own marks", () => {
    expect(money(1800, "PHP")).toBe("₱1,800.00");
    expect(money(1800, "MYR")).toBe("RM1,800.00");
  });

  it("always shows centavos, even on a whole amount", () => {
    expect(money(7, "PHP")).toBe("₱7.00");
    expect(money(0, "PHP")).toBe("₱0.00");
  });

  it("groups thousands so a cashier can read a large total at a glance", () => {
    expect(money(1234567.5, "PHP")).toBe("₱1,234,567.50");
  });

  it("rounds to two decimals rather than showing a float artefact", () => {
    expect(money(0.1 + 0.2, "PHP")).toBe("₱0.30");
    expect(money(10.005, "PHP")).toMatch(/^₱10\.0[01]$/);
  });

  it("renders a refund as a negative amount", () => {
    expect(money(-250, "PHP")).toBe("₱-250.00");
  });
});

describe("moneyWhole", () => {
  it("drops the centavos for the quick-cash buttons", () => {
    // The denomination buttons are notes, and "₱1,000.00" on a button reads
    // as a price rather than as the note the cashier is holding.
    expect(moneyWhole(1000, "PHP")).toBe("₱1,000");
    expect(moneyWhole(500, "MYR")).toBe("RM500");
  });

  it("still groups thousands", () => {
    expect(moneyWhole(1000000, "PHP")).toBe("₱1,000,000");
  });
});
