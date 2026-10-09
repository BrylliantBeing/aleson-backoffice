/**
 * The quick-cash buttons on the payment panel.
 *
 * Ten lines of arithmetic that decide what a cashier taps instead of typing.
 * Every suggestion has to be a note the passenger could plausibly hand over
 * AND at least the amount owed — a button that tenders less than the total
 * would open a drawer on a short payment.
 */

import {
  clampExternalRef,
  externalRefOk,
  quickCashOptions,
} from "@/utils/payment";

describe("quickCashOptions", () => {
  it("offers the exact amount and the next round notes above it", () => {
    expect(quickCashOptions(690)).toEqual([690, 700, 1000]);
  });

  it("never suggests less than the total", () => {
    for (const total of [1, 99, 690, 1500, 4321.5]) {
      expect(quickCashOptions(total).every((v) => v >= total)).toBe(true);
    }
  });

  it("reads in ascending order", () => {
    const options = quickCashOptions(1234);
    expect(options).toEqual([...options].sort((a, b) => a - b));
  });

  it("collapses duplicates when the total is already a round note", () => {
    // 1000 is its own next-hundred, next-500 and next-1000, so it must appear
    // once rather than four times.
    expect(quickCashOptions(1000)).toEqual([1000]);
    expect(quickCashOptions(500)).toEqual([500, 1000]);
    expect(quickCashOptions(100)).toEqual([100, 500, 1000]);
  });

  it("rounds a fractional total up before suggesting anything", () => {
    // A cashier cannot be handed 690.40, and tendering 690 against 690.40
    // would be short.
    expect(quickCashOptions(690.4)).toEqual([691, 700, 1000]);
    expect(quickCashOptions(0.5)).toEqual([1, 100, 500, 1000]);
  });

  it("offers nothing at all when there is nothing to pay", () => {
    // A free-pass-only sale settles at zero; a drawer should not open on it.
    expect(quickCashOptions(0)).toEqual([]);
    expect(quickCashOptions(-50)).toEqual([]);
  });

  it("keeps suggesting round notes above a large total", () => {
    expect(quickCashOptions(4321)).toEqual([4321, 4400, 4500, 5000]);
  });

  it("suggests only the exact amount once it is past the largest note step", () => {
    expect(quickCashOptions(10000)).toEqual([10000]);
  });
});

describe("the settlement reference", () => {
  it("takes the last 4 digits of the AUB Platform Order ID for QR Ph", () => {
    expect(externalRefOk("qrph", "0427")).toBe(true);
    expect(externalRefOk("qrph", "04271")).toBe(false);
    expect(externalRefOk("qrph", "042")).toBe(false);
    expect(externalRefOk("qrph", "04A7")).toBe(false);
  });

  it("keeps five characters, letters allowed, for card", () => {
    expect(externalRefOk("card", "4A7B2")).toBe(true);
    expect(externalRefOk("card", "0427")).toBe(false);
  });

  it("asks nothing of cash", () => {
    expect(externalRefOk("cash", "")).toBe(true);
  });

  it("clamps what is typed to what the tender's field can hold", () => {
    // Separators and stray letters drop out, and typing past the length stops
    // there rather than shifting earlier digits out of the field.
    expect(clampExternalRef("qrph", "12a3-4")).toBe("1234");
    expect(clampExternalRef("qrph", "123456")).toBe("1234");
    expect(clampExternalRef("card", "4a7b2c")).toBe("4A7B2");
  });
});
