// Passenger categories for the ticketing-office booking flow. Mirrors the backend
// CATEGORY_TO_DB / SEAT_OCCUPYING in main.py — keep the two in sync.

export type Category =
  | "regular"
  | "minor"
  | "military"
  | "student"
  | "senior"
  | "infant"
  | "freepass";

// UI slug → DB-canonical passenger_type stored on fares/tickets.
export const CATEGORY_TO_DB: Record<Category, string> = {
  regular: "Adult",
  minor: "Child",
  senior: "Senior",
  student: "Student",
  military: "Military",
  infant: "Infant",
  freepass: "Free Pass",
};

/**
 * How a stored passenger_type reads on screen and on paper. Only Senior differs:
 * the category covers persons with disability too (same statutory discount),
 * but the stored value stays "Senior" so no fare or ticket row has to move.
 */
const DB_TYPE_LABELS: Record<string, string> = { Senior: "Senior/PWD" };

export const passengerTypeLabel = (dbType: string | null | undefined): string =>
  dbType ? DB_TYPE_LABELS[dbType] ?? dbType : "";

/**
 * The escort travelling free with a RO/RO cargo shipment — the truck's driver
 * or helper. Unlike every other category it has no row in `fares`: it is an
 * entitlement the counter grants against the shipper's paperwork, not a price
 * anyone can buy, and giving it a fare row would put a free ticket on the
 * public booking site (which builds its ticket types out of that table).
 *
 * So it is free by definition here, not by lookup, and a sale carrying one
 * always records the cargo reference it was issued against.
 */
export const FREE_PASS: Category = "freepass";

export interface CategoryMeta {
  key: Category;
  label: string;
  color: string; // accent for the passenger-row color bar / tint (mistake prevention)
  seatOccupying: boolean; // infants ride on a lap — no seat
}

// Fixed display order used for the count steppers and passenger rows.
export const CATEGORIES: CategoryMeta[] = [
  { key: "regular", label: "Regular", color: "#028cef", seatOccupying: true },
  // One fare for both: senior citizens and persons with disability get the same
  // statutory discount, so the counter sells them as one category. Stored as
  // "Senior" (CATEGORY_TO_DB) so fares, tickets and reports need no migration.
  { key: "senior", label: "Senior/PWD", color: "#f5a623", seatOccupying: true },
  { key: "student", label: "Student", color: "#2e9e5b", seatOccupying: true },
  { key: "military", label: "Military", color: "#5a6b7b", seatOccupying: true },
  { key: "minor", label: "Minor", color: "#8b5cf6", seatOccupying: true },
  { key: "infant", label: "Infant", color: "#ec4899", seatOccupying: false },
  // Last in the list because it is the rarest sale on the counter, and brown
  // because none of the six above it are: the colour bar down a passenger row
  // is there to stop a cashier reading one category as another, and a free ride
  // is the one that costs the operator money when it is entered by mistake.
  { key: "freepass", label: "Free Pass", color: "#8a5a2b", seatOccupying: true },
];

export const CATEGORY_META: Record<Category, CategoryMeta> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.key] = c;
    return acc;
  },
  {} as Record<Category, CategoryMeta>
);

export const SEAT_OCCUPYING: Category[] = CATEGORIES.filter(
  (c) => c.seatOccupying
).map((c) => c.key);

/** Age in whole years on a given date (default: today), from a 'YYYY-MM-DD' string. */
export function ageOn(birthdate: string, on: Date = new Date()): number {
  const [y, m, d] = birthdate.split("-").map(Number);
  let age = on.getFullYear() - y;
  const mo = on.getMonth() + 1;
  const day = on.getDate();
  if (mo < m || (mo === m && day < d)) age--;
  return age;
}

/**
 * Validate that a passenger's DOB matches the category they were placed in.
 * Returns an error string, or null when valid.
 *   infant 0–1 · minor 2–11 · senior/PWD ≥60, or any age on a PWD ID ·
 *   regular/student/military/free pass: no DOB gate.
 */
export function validateDob(
  category: Category,
  birthdate: string,
  idType: string = ""
): string | null {
  if (!birthdate) return "Date of birth is required.";
  const age = ageOn(birthdate);
  if (age < 0) return "Date of birth cannot be in the future.";
  switch (category) {
    case "infant":
      return age <= 1 ? null : "Infant must be 0–1 years old.";
    case "minor":
      return age >= 2 && age <= 11 ? null : "Minor must be 2–11 years old.";
    case "senior":
      // A PWD qualifies at any age; the PWD ID is what the gate checks.
      return age >= 60 || idType.trim() === "PWD ID"
        ? null
        : "Senior/PWD must be 60 or older, or present a PWD ID.";
    default:
      return null; // regular / student / military / free pass
  }
}

/**
 * Shortest name the manifest accepts. The gate matches the printed name against
 * the government ID presented, so a single initial ("J") can't be checked
 * against anything — mirrors the same rule on the public booking site.
 */
export const MIN_NAME_LENGTH = 2;

/** Longest cargo reference the counter may key — mirrors CARGO_REFERENCE_MAX
 *  in the backend, which is the width of the column it is stored in. */
export const CARGO_REFERENCE_MAX = 64;

/** Returns an error string for a too-short name, or null when it's usable. */
export function validateName(raw: string, label: string): string | null {
  const value = raw.trim();
  if (!value) return `${label} is required.`;
  if (value.length < MIN_NAME_LENGTH) {
    return `${label} must be at least ${MIN_NAME_LENGTH} characters.`;
  }
  return null;
}

/**
 * Contact number rules for the counter, mirroring `helper/validation.ts` on the
 * public booking site so the same number is accepted at both. Routes are PH ↔ MY,
 * so either country's mobile format is valid, plus a generic international form.
 *
 * The counter needs a number it can actually ring when a sailing is pulled, and
 * `keyboardType="phone-pad"` is a soft hint the web build does not enforce — so
 * without this check the field takes "09678837asfbas" happily.
 */
const PH_MOBILE_RE = /^(?:\+?63|0)9\d{9}$/;
const PH_LANDLINE_RE = /^(?:\+?63|0)[2-8]\d{7,9}$/;
const MY_MOBILE_RE = /^(?:\+?60|0)1\d{8,9}$/;
const INTERNATIONAL_RE = /^\+\d{8,15}$/;

/** Strips spaces, dashes, dots and brackets — what people actually type. */
export const normalisePhone = (raw: string): string => raw.replace(/[\s\-().]/g, "");

/**
 * Returns an error string, or null when the number looks usable. Pass
 * `required: false` where the number is optional — the counter takes a phone OR
 * an email, so a blank field is only an error when nothing else identifies them.
 */
export function validatePhone(raw: string, required = true): string | null {
  const value = normalisePhone(raw);
  if (!value) return required ? "Contact number is required." : null;
  if (!/^\+?\d+$/.test(value)) {
    return "Contact number can only contain digits, spaces and an optional “+”.";
  }
  if (PH_MOBILE_RE.test(value) || PH_LANDLINE_RE.test(value)) return null;
  if (MY_MOBILE_RE.test(value)) return null;
  if (INTERNATIONAL_RE.test(value)) return null;
  return "Enter a valid contact number, e.g. 0917 123 4567 or +63 917 123 4567.";
}

// Money formatting moved to utils/currency.ts when fares gained a currency —
// an amount can no longer be rendered without knowing which one it is in.
export { money, moneyWhole } from "./currency";
