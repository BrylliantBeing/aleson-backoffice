// Currencies a fare can be quoted in. Must stay in sync with the backend's
// CURRENCIES tuple. Sailings are international (PH ↔ MY) and nothing converts
// between the two: a ticket is sold, refunded and reconciled in the currency it
// was priced in, so every amount on screen has to carry its own.
export const CURRENCIES = ["PHP", "MYR"] as const;

export type Currency = (typeof CURRENCIES)[number];

export const DEFAULT_CURRENCY: Currency = "PHP";

const SYMBOLS: Record<string, string> = {
  PHP: "₱",
  MYR: "RM",
};

export function currencySymbol(currency?: string | null): string {
  return SYMBOLS[currency ?? ""] ?? `${currency ?? DEFAULT_CURRENCY} `;
}

/** e.g. money(1800, "MYR") -> "RM1,800.00" */
export const money = (n: number, currency?: string | null) =>
  currencySymbol(currency) +
  n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/** Grouped thousands without cents — for the quick-cash denomination buttons. */
export const moneyWhole = (n: number, currency?: string | null) =>
  currencySymbol(currency) + n.toLocaleString("en-PH");
