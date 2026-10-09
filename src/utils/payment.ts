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

/** How each referenced tender's slip number is keyed at the counter. */
export type ExternalRefSpec = {
  length: number;
  digitsOnly: boolean;
  placeholder: string;
  hint: string;
};

/**
 * What the cashier keys for each tender that needs a reference.
 *
 * QR Ph is collected by scanning the customer's code in the AUB merchant app,
 * whose receipt shows a numeric Platform Order ID — the last 4 digits are
 * keyed. The card terminal's slip number can end in a letter, so card keeps
 * five characters with letters allowed: a reference the acquirer prints must
 * never be able to block a sale the customer has already been charged for.
 *
 * Mirrors EXTERNAL_REF_SPECS in the backend — if the two drift, the counter
 * refuses what the server would take, or worse.
 */
export const EXTERNAL_REF_SPECS: Record<"card" | "qrph", ExternalRefSpec> = {
  qrph: {
    length: 4,
    digitsOnly: true,
    placeholder: "Last 4 digits",
    hint: "Last 4 digits of the Platform Order ID in the AUB app.",
  },
  card: {
    length: 5,
    digitsOnly: false,
    placeholder: "Last 5 of ref",
    hint: "Last 5 of the order number on the card terminal slip.",
  },
};

export const externalRefSpec = (method: string): ExternalRefSpec | null =>
  method === "card" || method === "qrph" ? EXTERNAL_REF_SPECS[method] : null;

/**
 * Trim what the cashier types to what the field can hold: uppercase, only the
 * characters the tender's reference can contain, and no longer than it.
 */
export const clampExternalRef = (method: string, raw: string): string => {
  const spec = externalRefSpec(method);
  if (!spec) return raw;
  const kept = raw.toUpperCase().replace(spec.digitsOnly ? /[^0-9]/g : /[^A-Z0-9]/g, "");
  return kept.slice(0, spec.length);
};

/** Whether a keyed reference is one the server will accept. */
export const externalRefOk = (method: string, raw: string): boolean => {
  const spec = externalRefSpec(method);
  if (!spec) return true;
  const ref = raw.trim().toUpperCase();
  const pattern = spec.digitsOnly ? /^[0-9]+$/ : /^[A-Z0-9]+$/;
  return ref.length === spec.length && pattern.test(ref);
};

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
