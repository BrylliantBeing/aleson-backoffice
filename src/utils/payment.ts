/** The tenders a counter can take. 'qrph' is the stored name of the rail. */
export type Tender = "cash" | "qrph" | "card";

/**
 * What each tender is called on screen.
 *
 * 'qrph' is how the rail is stored — on the booking, on a rebook fee and on
 * the end-of-day report — while "QR PH" is what the counter and the operator
 * call it. Keeping the two apart in one place is what stops a screen inventing
 * a third spelling that the reports then cannot group by.
 */
export const TENDER_LABELS: Record<Tender, string> = {
  cash: "CASH",
  qrph: "QR PH",
  card: "CARD",
};

export const TENDERS: readonly Tender[] = ["cash", "qrph", "card"];

/**
 * The tenders that settle on somebody else's system.
 *
 * Card and QR Ph are charged on the counter's own terminals and never through
 * this application, so the reference off the slip is the only handle tying the
 * payment to the acquirer's batch at close. Cash reconciles against the drawer
 * and has no counterparty to match.
 */
export const needsExternalRef = (method: string): boolean =>
  method === "card" || method === "qrph";

/**
 * Whether a keyed reference is one the server will accept.
 *
 * Five characters, letters allowed beside digits: an acquirer whose reference
 * ends in a letter must not be able to block a sale the customer has already
 * been charged for. Mirrors _validated_external_ref in the backend — if the
 * two drift, the counter refuses what the server would take, or worse.
 */
export const externalRefOk = (method: string, raw: string): boolean =>
  !needsExternalRef(method) || /^[A-Z0-9]{5}$/.test(raw.trim().toUpperCase());

/** Fold a keyed reference to the form the server stores. */
export const normaliseExternalRef = (raw: string): string =>
  raw.trim().toUpperCase();

// Suggested cash-tender amounts for a total: the exact amount plus the next round
// hundred / 500 / 1000 above it (e.g. 690 → 690, 700, 1000).
export const quickCashOptions = (total: number): number[] => {
  const t = Math.ceil(total);
  if (t <= 0) return [];
  const nm = (step: number) => Math.ceil(t / step) * step;
  return [...new Set([t, nm(100), nm(500), nm(1000)])]
    .filter((v) => v >= t)
    .sort((a, b) => a - b);
};
