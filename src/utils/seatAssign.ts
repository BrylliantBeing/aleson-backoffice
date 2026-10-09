// Seat assignment for the ticketing office. Hands out the lowest-numbered free
// seats in the class, in order (1, 2, 3, ...), so a vessel fills from seat 1 up
// and a group gets consecutive numbers whenever they are free. Numbers freed by
// a refund or an agent's manual pick are filled first. The agent can override
// the result in SeatAssignModal.

import { seatLabel } from "@/utils/seatLabel";

export interface Seat {
  name: string;
  // What the seat is painted with on the ship. Numbers repeat across classes on
  // some vessels, so `name` keeps a class prefix (it is what a ticket stores and
  // must stay unique per vessel) and `label` is what an agent reads off the map.
  label?: string;
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

// Seat name -> the label painted on the ship (falls back to the name). Tickets
// store the unique `name`; agents compare against the operator's numbered chart.
export const seatLabels = (map: SeatMap | null | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const deck of map?.decks ?? []) {
    for (const seat of deck.seats) out[seat.name] = seatLabel(seat);
  }
  return out;
};

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

// Seats compare by the number painted on the ship, read naturally: 2 before 10,
// A9 before A10 before B1. The unique name breaks ties between equal labels.
const bySeatNumber = (a: Seat, b: Seat): number =>
  seatLabel(a).localeCompare(seatLabel(b), undefined, { numeric: true }) ||
  a.name.localeCompare(b.name, undefined, { numeric: true });

export function autoAssignSeats(
  seatMap: SeatMap | null | undefined,
  className: string,
  unavailable: Iterable<string>,
  groupSize: number
): AssignResult {
  if (groupSize <= 0) return { ok: true, seats: [] };

  const taken = new Set(unavailable);
  const free = classSeats(seatMap, className).filter((s) => !taken.has(s.name));
  if (free.length < groupSize) {
    return { ok: false, seats: [], reason: "Not enough available seats in this class." };
  }

  return { ok: true, seats: free.sort(bySeatNumber).slice(0, groupSize).map((s) => s.name) };
}
