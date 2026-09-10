/**
 * Picking seats for a group without splitting them up.
 *
 * Two rules do all the work, and both are easy to break by accident:
 *
 *   1. Seats are adjacent only on the SAME deck, SAME row, with consecutive
 *      columns. Different decks reuse the same x/y grid, and the last seat of
 *      one row is not next to the first seat of the next.
 *   2. An assignment must not strand a lone empty seat between two occupied
 *      ones — that seat becomes unsellable to anyone travelling in a pair.
 *
 * The picker shuffles, so most of these assert properties rather than exact
 * seats. Where an exact answer IS forced by the rules, it is asserted
 * directly — those are the cases that prove the constraint is doing something.
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

const rowOf = (names: string[], map: SeatMap) => {
  const all = map.decks.flatMap((d, di) => d.seats.map((s) => ({ ...s, deck: di })));
  return names.map((n) => all.find((s) => s.name === n)!);
};

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
    for (let i = 0; i < 40; i++) {
      const { seats } = autoAssignSeats(oneRow(8), "Economy", taken, 3);
      expect(seats.some((s) => taken.includes(s))).toBe(false);
    }
  });

  it("only ever assigns seats of the class asked for", () => {
    const mixed: SeatMap = {
      decks: [{
        name: "Main",
        seats: [seat("ECO-1", 1, 1), seat("ECO-2", 2, 1), seat("AC-1", 3, 1, "AC")],
      }],
    };
    for (let i = 0; i < 20; i++) {
      const { seats } = autoAssignSeats(mixed, "Economy", [], 2);
      expect(seats.sort()).toEqual(["ECO-1", "ECO-2"]);
    }
  });

  it("seats a group side by side when a run is long enough", () => {
    for (let i = 0; i < 40; i++) {
      const { seats } = autoAssignSeats(oneRow(10), "Economy", [], 3);
      const xs = rowOf(seats, oneRow(10)).map((s) => s.x).sort((a, b) => a - b);
      expect(xs[2] - xs[0]).toBe(2);   // three consecutive columns
    }
  });

  it("does not treat the end of one row as next to the start of the next", () => {
    // Two rows of two. A pair must land within one row, never straddling the
    // row edge.
    const twoRows: SeatMap = {
      decks: [{
        name: "Main",
        seats: [
          seat("A1", 1, 1), seat("A2", 2, 1),
          seat("B1", 1, 2), seat("B2", 2, 2),
        ],
      }],
    };
    for (let i = 0; i < 40; i++) {
      const sorted = [...autoAssignSeats(twoRows, "Economy", [], 2).seats].sort();
      expect([["A1", "A2"], ["B1", "B2"]]).toContainEqual(sorted);
    }
  });

  it("does not treat seats on different decks as adjacent", () => {
    // Both decks use the same x/y grid, so a picker that ignores the deck
    // would happily pair D0-1 with D1-2.
    const twoDecks: SeatMap = {
      decks: [
        { name: "Main", seats: [seat("D0-1", 1, 1), seat("D0-2", 2, 1)] },
        { name: "Upper", seats: [seat("D1-1", 1, 1), seat("D1-2", 2, 1)] },
      ],
    };
    for (let i = 0; i < 40; i++) {
      const sorted = [...autoAssignSeats(twoDecks, "Economy", [], 2).seats].sort();
      expect([["D0-1", "D0-2"], ["D1-1", "D1-2"]]).toContainEqual(sorted);
    }
  });

  it("does not pair seats across an aisle", () => {
    // A gap in x is an aisle: 2 and 5 are not neighbours.
    const withAisle: SeatMap = {
      decks: [{
        name: "Main",
        seats: [seat("E1", 1, 1), seat("E2", 2, 1), seat("E5", 5, 1), seat("E6", 6, 1)],
      }],
    };
    for (let i = 0; i < 40; i++) {
      const sorted = [...autoAssignSeats(withAisle, "Economy", [], 2).seats].sort();
      expect([["E1", "E2"], ["E5", "E6"]]).toContainEqual(sorted);
    }
  });

  it("never strands a lone seat between two occupied ones", () => {
    // ECO-1 is taken and the row is only three wide. Seating the passenger in
    // ECO-3 would leave ECO-2 flanked and unsellable, so ECO-2 is the only
    // acceptable answer whatever the shuffle does.
    for (let i = 0; i < 40; i++) {
      const { seats } = autoAssignSeats(oneRow(3), "Economy", ["ECO-1"], 1);
      expect(seats).toEqual(["ECO-2"]);
    }
  });

  it("treats a row edge as not stranding anything", () => {
    // ECO-1 has no left-hand neighbour, so taking ECO-2 leaves it at the edge
    // rather than flanked — a perfectly sellable single.
    const { seats, ok } = autoAssignSeats(oneRow(2), "Economy", [], 1);
    expect(ok).toBe(true);
    expect(["ECO-1", "ECO-2"]).toContain(seats[0]);
  });

  it("still seats a group too large for any single row", () => {
    // Falls back to filling from the largest runs, which is the point: it
    // always terminates with a valid set rather than refusing a big group.
    const twoRows: SeatMap = {
      decks: [{
        name: "Main",
        seats: [
          seat("A1", 1, 1), seat("A2", 2, 1),
          seat("B1", 1, 2), seat("B2", 2, 2),
        ],
      }],
    };
    const { ok, seats } = autoAssignSeats(twoRows, "Economy", [], 4);
    expect(ok).toBe(true);
    expect([...seats].sort()).toEqual(["A1", "A2", "B1", "B2"]);
  });

  it("clusters an oversized group into the fewest rows it can", () => {
    // Six passengers, one row of four and one of two: both rows are filled
    // rather than the group being scattered a seat at a time.
    const map: SeatMap = {
      decks: [{
        name: "Main",
        seats: [
          seat("A1", 1, 1), seat("A2", 2, 1), seat("A3", 3, 1), seat("A4", 4, 1),
          seat("B1", 1, 2), seat("B2", 2, 2),
        ],
      }],
    };
    const { seats } = autoAssignSeats(map, "Economy", [], 6);
    expect([...seats].sort()).toEqual(["A1", "A2", "A3", "A4", "B1", "B2"]);
  });

  it("takes the last remaining seats when the class is exactly full", () => {
    const { ok, seats } = autoAssignSeats(oneRow(3), "Economy", ["ECO-1"], 2);
    expect(ok).toBe(true);
    expect([...seats].sort()).toEqual(["ECO-2", "ECO-3"]);
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

  it("varies its answer across calls rather than always filling from one end", () => {
    // The shuffle is deliberate: always assigning ECO-1 first would wear one
    // end of the vessel and make every group sit on top of each other.
    const picks = new Set<string>();
    for (let i = 0; i < 60; i++) {
      picks.add(autoAssignSeats(oneRow(12), "Economy", [], 2).seats.join(","));
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});
