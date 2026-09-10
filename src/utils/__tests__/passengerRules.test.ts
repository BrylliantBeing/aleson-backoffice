/**
 * Who a passenger is, and whether the counter keyed them correctly.
 *
 * These rules decide what a passenger is charged and whether they occupy a
 * seat, so they mirror the backend's CATEGORY_TO_DB and SEAT_OCCUPYING. The
 * pairs are asserted here rather than assumed: a category that maps to the
 * wrong passenger_type prices the ticket off the wrong fare row.
 */

import {
  CATEGORIES,
  CATEGORY_META,
  CATEGORY_TO_DB,
  CARGO_REFERENCE_MAX,
  FREE_PASS,
  MIN_NAME_LENGTH,
  SEAT_OCCUPYING,
  ageOn,
  normalisePhone,
  validateDob,
  validateName,
  validatePhone,
} from "@/utils/passengerRules";

// A fixed "today" so an age boundary does not drift into failure overnight.
const TODAY = new Date(2026, 8, 6); // 6 September 2026

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(TODAY);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── The categories themselves ────────────────────────────────────────────────

describe("categories", () => {
  it("maps every UI slug to the passenger_type the backend stores", () => {
    expect(CATEGORY_TO_DB).toEqual({
      regular: "Adult",
      minor: "Child",
      senior: "Senior",
      student: "Student",
      military: "Military",
      infant: "Infant",
      freepass: "Free Pass",
    });
  });

  it("gives an infant no seat and everyone else one", () => {
    // Infants ride on a lap. A free pass rides in a seat like anyone else --
    // the entitlement is about who pays, not about where the person sits.
    expect(SEAT_OCCUPYING).not.toContain("infant");
    expect(SEAT_OCCUPYING).toContain(FREE_PASS);
    expect(SEAT_OCCUPYING).toHaveLength(CATEGORIES.length - 1);
  });

  it("indexes every category by its key", () => {
    for (const c of CATEGORIES) {
      expect(CATEGORY_META[c.key]).toBe(c);
    }
  });

  it("gives every category a colour of its own", () => {
    // The colour bar down a passenger row exists to stop a cashier reading
    // one category as another, so two categories sharing a colour defeats it.
    const colours = CATEGORIES.map((c) => c.color);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it("puts the free pass last, where the rarest sale belongs", () => {
    expect(CATEGORIES[CATEGORIES.length - 1].key).toBe(FREE_PASS);
  });
});

// ── Age ──────────────────────────────────────────────────────────────────────

describe("ageOn", () => {
  it("counts whole years", () => {
    expect(ageOn("2000-06-15", TODAY)).toBe(26);
  });

  it("does not count a birthday that has not happened yet this year", () => {
    expect(ageOn("2000-12-15", TODAY)).toBe(25);
  });

  it("does not count a birthday later this month", () => {
    expect(ageOn("2000-09-10", TODAY)).toBe(25);
  });

  it("counts a birthday that falls today", () => {
    expect(ageOn("2000-09-06", TODAY)).toBe(26);
  });

  it("defaults to today when no date is given", () => {
    expect(ageOn("2000-06-15")).toBe(26);
  });
});

// ── Category against date of birth ───────────────────────────────────────────

describe("validateDob", () => {
  it("requires a date of birth at all", () => {
    expect(validateDob("regular", "")).toBe("Date of birth is required.");
  });

  it("refuses a date in the future", () => {
    expect(validateDob("regular", "2030-01-01")).toBe(
      "Date of birth cannot be in the future."
    );
  });

  describe("infant: 0-1", () => {
    it("accepts a newborn and a one-year-old", () => {
      expect(validateDob("infant", "2026-08-01")).toBeNull();
      expect(validateDob("infant", "2025-01-01")).toBeNull();
    });

    it("refuses a two-year-old", () => {
      // Who needs a seat, and a fare.
      expect(validateDob("infant", "2024-01-01")).toBe("Infant must be 0–1 years old.");
    });
  });

  describe("minor: 2-11", () => {
    it("accepts both ends of the range", () => {
      expect(validateDob("minor", "2024-09-06")).toBeNull();   // turns 2 today
      expect(validateDob("minor", "2015-09-06")).toBeNull();   // turns 11 today
    });

    it("refuses someone on the day they turn twelve", () => {
      expect(validateDob("minor", "2014-09-06")).toBe("Minor must be 2–11 years old.");
    });

    it("refuses someone still an infant", () => {
      expect(validateDob("minor", "2025-06-01")).toBe("Minor must be 2–11 years old.");
    });

    it("refuses someone who has turned twelve", () => {
      expect(validateDob("minor", "2014-01-01")).toBe("Minor must be 2–11 years old.");
    });
  });

  describe("senior: 60 and over", () => {
    it("accepts someone on their sixtieth birthday", () => {
      expect(validateDob("senior", "1966-09-06")).toBeNull();
    });

    it("refuses someone a day short of sixty", () => {
      expect(validateDob("senior", "1966-09-07")).toBe("Senior must be 60 years or older.");
    });
  });

  it("gates no age on the categories that carry no age rule", () => {
    for (const category of ["regular", "student", "military", "freepass"] as const) {
      expect(validateDob(category, "1990-01-01")).toBeNull();
      expect(validateDob(category, "2020-01-01")).toBeNull();
    }
  });
});

// ── Names ────────────────────────────────────────────────────────────────────

describe("validateName", () => {
  it("accepts an ordinary name", () => {
    expect(validateName("Cruz", "Last name")).toBeNull();
  });

  it("refuses a single initial", () => {
    // The gate matches the printed name against the ID presented, and "J"
    // cannot be checked against anything.
    expect(MIN_NAME_LENGTH).toBe(2);
    expect(validateName("J", "First name")).toBe(
      "First name must be at least 2 characters."
    );
  });

  it("refuses a name that is only whitespace", () => {
    expect(validateName("   ", "First name")).toBe("First name is required.");
    expect(validateName("", "First name")).toBe("First name is required.");
  });

  it("judges the trimmed value, not what was typed", () => {
    expect(validateName("  Li  ", "First name")).toBeNull();
    expect(validateName("  J  ", "First name")).not.toBeNull();
  });

  it("names the field in its own error", () => {
    expect(validateName("", "Cargo reference")).toContain("Cargo reference");
  });
});

describe("the cargo reference bound", () => {
  it("matches the column it is stored in", () => {
    expect(CARGO_REFERENCE_MAX).toBe(64);
  });
});

// ── Contact numbers ──────────────────────────────────────────────────────────
// keyboardType="phone-pad" is a soft hint the web build does not enforce, so
// without this check the field takes "09678837asfbas" happily.

describe("normalisePhone", () => {
  it("strips what people actually type", () => {
    expect(normalisePhone("0917 123 4567")).toBe("09171234567");
    expect(normalisePhone("(032) 255-1234")).toBe("0322551234");
    expect(normalisePhone("+63.917.123.4567")).toBe("+639171234567");
  });
});

describe("validatePhone", () => {
  it.each([
    ["09171234567", "PH mobile"],
    ["+639171234567", "PH mobile, international form"],
    ["639171234567", "PH mobile, no plus"],
    ["0917 123 4567", "PH mobile as typed"],
    ["0322551234", "PH landline"],
    ["+60123456789", "MY mobile"],
    ["0123456789", "MY mobile, local form"],
    ["+6591234567", "another international number"],
  ])("accepts %s (%s)", (number) => {
    expect(validatePhone(number)).toBeNull();
  });

  it("refuses letters however they are dressed up", () => {
    expect(validatePhone("09678837asfbas")).toBe(
      "Contact number can only contain digits, spaces and an optional “+”."
    );
  });

  it("refuses a number that is the right shape but the wrong length", () => {
    expect(validatePhone("091712345")).not.toBeNull();
    expect(validatePhone("091712345678")).not.toBeNull();
  });

  it("requires a number by default", () => {
    expect(validatePhone("")).toBe("Contact number is required.");
    expect(validatePhone("   ")).toBe("Contact number is required.");
  });

  it("lets the field be blank when something else identifies the passenger", () => {
    // The counter takes a phone OR an email.
    expect(validatePhone("", false)).toBeNull();
  });

  it("still judges a number that was given even when it was optional", () => {
    expect(validatePhone("nonsense", false)).not.toBeNull();
  });
});
