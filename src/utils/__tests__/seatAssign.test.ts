/**
 * Picking seats in number order.
 *
 * The office fills a vessel from seat 1 up: every group gets the lowest free
 * numbers in its class. The order is the number painted on the ship, not the
 * seat's position on the map or its stored name, and it is read as a number —
 * seat 2 comes before seat 10.
 */

import {
  NAME_TO_CODE,
  autoAssignSeats,
  classSeats,
  seatLabels,
  type Seat,
  type SeatMap,
} from "@/utils/seatAssign";

const seat = (name: string, x: number, y: number, class_code = "ECO", label?: string): Seat =>
  ({ name, x, y, class_code, ...(label ? { label } : {}) });

/** One deck, one row of `n` economy seats at y=1, x=1..n. */
const oneRow = (n: number): SeatMap => ({
  decks: [{ name: "Main", seats: Array.from({ length: n }, (_, i) => seat(`ECO-${i + 1}`, i + 1, 1)) }],
});

// ── Reading a seat map ──────────────────────────────────────────────────────

describe("classSeats", () => {
  const map: SeatMap = {
    decks: [{
      name: "Main",
      seats: [seat("ECO-1", 1, 1), seat("AC-1", 1, 2, "AC"), seat("ECO-2", 2, 1)],
    }],
  };

  it("translates the fare API's display name to the seat map's class code", () => {
    expect(classSeats(map, "Economy").map((s) => s.name)).toEqual(["ECO-1", "ECO-2"]);
    expect(classSeats(map, "Aircon").map((s) => s.name)).toEqual(["AC-1"]);
  });

  it("covers every class the operator sells", () => {
    expect(NAME_TO_CODE).toEqual({
      Economy: "ECO",
      Aircon: "AC",
      Cabin: "CAB",
      Suite: "SUI",
      "Aircon-A": "AC-A",
      "Aircon-B": "AC-B",
    });
  });

  it("accepts a raw class code for a class with no display name mapping", () => {
    expect(classSeats(map, "ECO").map((s) => s.name)).toEqual(["ECO-1", "ECO-2"]);
  });

  it("gathers seats from every deck", () => {
    const twoDecks: SeatMap = {
      decks: [
        { name: "Main", seats: [seat("A", 1, 1)] },
        { name: "Upper", seats: [seat("B", 1, 1)] },
      ],
    };
    expect(classSeats(twoDecks, "Economy")).toHaveLength(2);
  });

  it("finds nothing in a vessel with no map", () => {
    expect(classSeats(null, "Economy")).toEqual([]);
    expect(classSeats(undefined, "Economy")).toEqual([]);
    expect(classSeats({ decks: [] }, "Economy")).toEqual([]);
  });
});

describe("seatLabels", () => {
  it("maps the stored name to what is painted on the ship", () => {
    // Tickets store the prefixed unique name; the agent reads the bare number
    // off the operator's chart.
    const map: SeatMap = { decks: [{ name: "Main", seats: [seat("ECO-42", 1, 1)] }] };
    expect(seatLabels(map)).toEqual({ "ECO-42": "42" });
  });

  it("prefers an explicit label over the derived one", () => {
    const map: SeatMap = { decks: [{ name: "Main", seats: [seat("ECO-42", 1, 1, "ECO", "42A")] }] };
    expect(seatLabels(map)).toEqual({ "ECO-42": "42A" });
  });

  it("maps nothing for a vessel with no seat map", () => {
    expect(seatLabels(null)).toEqual({});
  });
});

// ── Assignment ──────────────────────────────────────────────────────────────

describe("autoAssignSeats", () => {
  it("assigns nothing for an empty group", () => {
    expect(autoAssignSeats(oneRow(6), "Economy", [], 0)).toEqual({ ok: true, seats: [] });
  });

  it("refuses when the class cannot seat the group", () => {
    const result = autoAssignSeats(oneRow(2), "Economy", [], 3);
    expect(result.ok).toBe(false);
    expect(result.seats).toEqual([]);
    expect(result.reason).toBe("Not enough available seats in this class.");
  });

  it("counts only the seats still free", () => {
    const result = autoAssignSeats(oneRow(4), "Economy", ["ECO-1", "ECO-2"], 3);
    expect(result.ok).toBe(false);
  });

  it("assigns exactly as many seats as the group needs", () => {
    for (const size of [1, 2, 3, 4]) {
      const result = autoAssignSeats(oneRow(8), "Economy", [], size);
      expect(result.ok).toBe(true);
      expect(result.seats).toHaveLength(size);
      expect(new Set(result.seats).size).toBe(size);
    }
  });

  it("never hands out a seat somebody already has", () => {
    const taken = ["ECO-2", "ECO-5"];
    const { seats } = autoAssignSeats(oneRow(8), "Economy", taken, 3);
    expect(seats.some((s) => taken.includes(s))).toBe(false);
  });

  it("only ever assigns seats of the class asked for", () => {
    const mixed: SeatMap = {
      decks: [{
        name: "Main",
        seats: [seat("AC-1", 1, 1, "AC"), seat("ECO-1", 2, 1), seat("ECO-2", 3, 1)],
      }],
    };
    expect(autoAssignSeats(mixed, "Economy", [], 2).seats).toEqual(["ECO-1", "ECO-2"]);
  });

  it("starts from seat 1 and counts up", () => {
    expect(autoAssignSeats(oneRow(10), "Economy", [], 4).seats)
      .toEqual(["ECO-1", "ECO-2", "ECO-3", "ECO-4"]);
  });

  it("carries on from the last seat sold", () => {
    expect(autoAssignSeats(oneRow(10), "Economy", ["ECO-1", "ECO-2", "ECO-3"], 2).seats)
      .toEqual(["ECO-4", "ECO-5"]);
  });

  it("fills a number freed earlier in the run before moving on", () => {
    // ECO-2 was refunded (or an agent hand-picked around it): it is the lowest
    // free number, so it goes first.
    expect(autoAssignSeats(oneRow(10), "Economy", ["ECO-1", "ECO-3", "ECO-4"], 2).seats)
      .toEqual(["ECO-2", "ECO-5"]);
  });

  it("reads seat numbers as numbers, not text", () => {
    // As text, "10" sorts before "2".
    const map: SeatMap = {
      decks: [{ name: "Main", seats: [seat("10", 1, 1), seat("9", 2, 1), seat("2", 3, 1)] }],
    };
    expect(autoAssignSeats(map, "Economy", [], 3).seats).toEqual(["2", "9", "10"]);
  });

  it("follows the painted number, not where the seat sits on the map", () => {
    // Ciara Joie 6 numbers some columns bottom-to-top: 3, 2, 1 left to right.
    const map: SeatMap = {
      decks: [{ name: "Main", seats: [seat("3", 1, 1), seat("2", 2, 1), seat("1", 3, 1)] }],
    };
    expect(autoAssignSeats(map, "Economy", [], 2).seats).toEqual(["1", "2"]);
  });

  it("orders by the painted label when the stored name says otherwise", () => {
    const map: SeatMap = {
      decks: [{
        name: "Main",
        seats: [seat("ECO-X", 1, 1, "ECO", "7"), seat("ECO-Y", 2, 1, "ECO", "3")],
      }],
    };
    expect(autoAssignSeats(map, "Economy", [], 1).seats).toEqual(["ECO-Y"]);
  });

  it("counts on across decks", () => {
    // Kristel Jane 5 numbers continuously from one deck to the next.
    const map: SeatMap = {
      decks: [
        { name: "Deck B", seats: [seat("1", 1, 1), seat("2", 2, 1)] },
        { name: "Deck C", seats: [seat("3", 1, 1), seat("4", 2, 1)] },
      ],
    };
    expect(autoAssignSeats(map, "Economy", ["1"], 2).seats).toEqual(["2", "3"]);
  });

  it("walks lettered rows in order: A9, A10, then B1", () => {
    const map: SeatMap = {
      decks: [{
        name: "Main",
        seats: [seat("B1", 1, 2), seat("A10", 10, 1), seat("A9", 9, 1)],
      }],
    };
    expect(autoAssignSeats(map, "Economy", [], 3).seats).toEqual(["A9", "A10", "B1"]);
  });

  it("takes the last remaining seats when the class is exactly full", () => {
    const { ok, seats } = autoAssignSeats(oneRow(3), "Economy", ["ECO-1"], 2);
    expect(ok).toBe(true);
    expect(seats).toEqual(["ECO-2", "ECO-3"]);
  });

  it("assigns nothing from a vessel with no seat map", () => {
    expect(autoAssignSeats(null, "Economy", [], 1).ok).toBe(false);
    expect(autoAssignSeats({ decks: [] }, "Economy", [], 1).ok).toBe(false);
  });

  it("accepts the unavailable list as any iterable", () => {
    // Callers pass a Set from the availability response as often as an array.
    const { seats } = autoAssignSeats(oneRow(4), "Economy", new Set(["ECO-1"]), 1);
    expect(seats).not.toContain("ECO-1");
  });
});
