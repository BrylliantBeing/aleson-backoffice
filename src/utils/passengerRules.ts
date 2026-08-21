// Passenger categories for the ticketing-office booking flow. Mirrors the backend
// CATEGORY_TO_DB / SEAT_OCCUPYING in main.py — keep the two in sync.

export type Category =
  | "regular"
  | "minor"
  | "military"
  | "student"
  | "senior"
  | "infant";

// UI slug → DB-canonical passenger_type stored on fares/tickets.
export const CATEGORY_TO_DB: Record<Category, string> = {
  regular: "Adult",
  minor: "Child",
  senior: "Senior",
  student: "Student",
  military: "Military",
  infant: "Infant",
};

export interface CategoryMeta {
  key: Category;
  label: string;
  color: string; // accent for the passenger-row color bar / tint (mistake prevention)
  seatOccupying: boolean; // infants ride on a lap — no seat
}

// Fixed display order used for the count steppers and passenger rows.
export const CATEGORIES: CategoryMeta[] = [
  { key: "regular", label: "Regular", color: "#028cef", seatOccupying: true },
  { key: "senior", label: "Senior", color: "#f5a623", seatOccupying: true },
  { key: "student", label: "Student", color: "#2e9e5b", seatOccupying: true },
  { key: "military", label: "Military", color: "#5a6b7b", seatOccupying: true },
  { key: "minor", label: "Minor", color: "#8b5cf6", seatOccupying: true },
  { key: "infant", label: "Infant", color: "#ec4899", seatOccupying: false },
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
 *   infant 0–1 · minor 2–11 · senior ≥60 · regular/student/military: no DOB gate.
 */
export function validateDob(
  category: Category,
  birthdate: string
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
      return age >= 60 ? null : "Senior must be 60 years or older.";
    default:
      return null; // regular / student / military
  }
}

/**
 * Shortest name the manifest accepts. The gate matches the printed name against
 * the government ID presented, so a single initial ("J") can't be checked
 * against anything — mirrors the same rule on the public booking site.
 */
export const MIN_NAME_LENGTH = 2;

/** Returns an error string for a too-short name, or null when it's usable. */
export function validateName(raw: string, label: string): string | null {
  const value = raw.trim();
  if (!value) return `${label} is required.`;
  if (value.length < MIN_NAME_LENGTH) {
    return `${label} must be at least ${MIN_NAME_LENGTH} characters.`;
  }
  return null;
}

// Money formatting moved to utils/currency.ts when fares gained a currency —
// an amount can no longer be rendered without knowing which one it is in.
export { money, moneyWhole } from "./currency";
