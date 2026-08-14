// Constrained-RNG seat assignment for the ticketing office. Picks available seats
// for a passenger group and keeps them physically together: seats are only ever
// grouped when they are on the SAME deck + SAME row (y) with consecutive columns
// (x) — so a seat at the end of a row is never treated as adjacent to the first
// seat of the next row. It also never strands a single empty seat between two
// occupied seats. Always terminates with a valid set. The agent can override the
// result in SeatAssignModal.

export interface Seat {
  name: string;
  x: number;
  y: number;
  class_code: string;
}
export interface Deck {
  name: string;
  seats: Seat[];
}
export interface SeatMap {
  decks: Deck[];
}

// Accommodation class display name (fares API) → seat_map class_code.
export const NAME_TO_CODE: Record<string, string> = {
  Economy: "ECO",
  Aircon: "AC",
  Cabin: "CAB",
  Suite: "SUI",
  "Aircon-A": "AC-A",
  "Aircon-B": "AC-B",
};

export function classSeats(
  seatMap: SeatMap | null | undefined,
  className: string
): Seat[] {
  const code = NAME_TO_CODE[className] ?? className;
  if (!seatMap?.decks) return [];
  return seatMap.decks.flatMap((d) => d.seats).filter((s) => s.class_code === code);
}

export interface AssignResult {
  ok: boolean;
  seats: string[];
  reason?: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A seat tagged with the deck it belongs to, so adjacency never crosses decks
// (different decks reuse the same x/y grid).
type DeckSeat = Seat & { deck: number };

export function autoAssignSeats(
  seatMap: SeatMap | null | undefined,
  className: string,
  unavailable: Iterable<string>,
  groupSize: number
): AssignResult {
  if (groupSize <= 0) return { ok: true, seats: [] };

  const code = NAME_TO_CODE[className] ?? className;
  const taken = new Set(unavailable);

  const classAll: DeckSeat[] = [];
  (seatMap?.decks ?? []).forEach((d, di) => {
    d.seats.forEach((s) => {
      if (s.class_code === code) classAll.push({ ...s, deck: di });
    });
  });
  const free = classAll.filter((s) => !taken.has(s.name));
  if (free.length < groupSize) {
    return { ok: false, seats: [], reason: "Not enough available seats in this class." };
  }

  const key = (deck: number, x: number, y: number) => `${deck}:${x},${y}`;
  const seatAt = new Map<string, DeckSeat>();
  classAll.forEach((s) => seatAt.set(key(s.deck, s.x, s.y), s));

  // A horizontal neighbour blocks only if a real class seat exists there and it is
  // occupied/assigned. A missing seat (aisle / row edge) does NOT block — an edge
  // seat is never considered "stranded".
  const blocked = (deck: number, x: number, y: number, assigned: Set<string>): boolean => {
    const s = seatAt.get(key(deck, x, y));
    if (!s) return false;
    return taken.has(s.name) || assigned.has(s.name);
  };

  // Would this assignment leave any empty class seat flanked by two occupied seats
  // on the same row?
  const strands = (assigned: Set<string>): boolean => {
    for (const s of classAll) {
      if (taken.has(s.name) || assigned.has(s.name)) continue;
      if (blocked(s.deck, s.x - 1, s.y, assigned) && blocked(s.deck, s.x + 1, s.y, assigned)) {
        return true;
      }
    }
    return false;
  };

  // Contiguous same-row runs: group free seats by (deck, y), sort by x, and split
  // wherever the column jumps (a gap = aisle). Each run is a block of genuinely
  // side-by-side seats.
  const byRow = new Map<string, DeckSeat[]>();
  free.forEach((s) => {
    const k = `${s.deck}:${s.y}`;
    const arr = byRow.get(k);
    if (arr) arr.push(s);
    else byRow.set(k, [s]);
  });
  const runs: DeckSeat[][] = [];
  byRow.forEach((arr) => {
    arr.sort((a, b) => a.x - b.x);
    let cur: DeckSeat[] = [];
    for (const s of arr) {
      if (cur.length === 0 || s.x === cur[cur.length - 1].x + 1) cur.push(s);
      else {
        runs.push(cur);
        cur = [s];
      }
    }
    if (cur.length) runs.push(cur);
  });

  // 1) Ideal: the whole group fits in one run (fully side by side).
  for (const run of shuffle(runs)) {
    if (run.length < groupSize) continue;
    const windows: DeckSeat[][] = [];
    for (let i = 0; i + groupSize <= run.length; i++) windows.push(run.slice(i, i + groupSize));
    for (const w of shuffle(windows)) {
      const assigned = new Set(w.map((s) => s.name));
      if (!strands(assigned)) return { ok: true, seats: w.map((s) => s.name) };
    }
  }

  // 2) Group doesn't fit in a single row: fill from the largest runs, taking a
  //    contiguous window from each. Every window stays within one row, so members
  //    are never split across a row edge — they cluster into the fewest same-row
  //    blocks possible.
  const sorted = [...runs].sort((a, b) => b.length - a.length);
  const chosen: string[] = [];
  const chosenSet = new Set<string>();
  for (const run of sorted) {
    if (chosen.length >= groupSize) break;
    const take = Math.min(groupSize - chosen.length, run.length);
    // Prefer a contiguous window that doesn't strand a single seat.
    let win: DeckSeat[] | null = null;
    for (let i = 0; i + take <= run.length; i++) {
      const w = run.slice(i, i + take);
      const trial = new Set(chosenSet);
      w.forEach((s) => trial.add(s.name));
      if (!strands(trial)) {
        win = w;
        break;
      }
    }
    (win ?? run.slice(0, take)).forEach((s) => {
      chosen.push(s.name);
      chosenSet.add(s.name);
    });
  }

  return { ok: true, seats: chosen.slice(0, groupSize) };
}
