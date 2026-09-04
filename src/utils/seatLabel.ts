// Seat identity vs. seat label.
//
// A vessel's `seat_map` seat `name` must be unique across the whole vessel —
// tickets store it as `seat_number` and the DB enforces UNIQUE (trip_fk,
// seat_number). But the number painted on the ship repeats between classes
// (M/V Antonia 2 has both an Economy 42 and an Aircon 42), so those seats carry
// a hyphenated class prefix: `ECO-42`, `AC-42`. Operators and passengers only
// ever read the bare number, exactly as the operator's own seat map shows it.
//
// Vessels numbered the old way (`A1`, `B12`) or with bare numbers are untouched:
// only a `LETTERS-digits` prefix is stripped.

/** Display text for a seat taken from a `seat_map`. */
export const seatLabel = (seat: { name: string; label?: string | null }): string =>
  seat.label ?? seatNumberLabel(seat.name);

/** Display text for a seat number stored on a ticket (no seat_map at hand). */
export const seatNumberLabel = <T extends string | null | undefined>(seatNumber: T): T =>
  (typeof seatNumber === 'string'
    ? (seatNumber.replace(/^[A-Z]{2,4}-(?=\d)/, '') as T)
    : seatNumber);
