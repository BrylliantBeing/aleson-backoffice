/**
 * Turns a confirmed sale into the values printed on one passage ticket.
 *
 * This file used to also own WHERE each value landed on a pre-printed carbon
 * form — rows, columns, copies, form length. That is all gone: the TM-T82X
 * prints the whole ticket onto blank thermal roll, so placement is a top-to-
 * bottom flow decided in `ticketDoc.ts` and there is nothing to calibrate.
 * What is left here is formatting: the operator's date, name, voyage-number and
 * currency conventions, which are independent of any printer.
 */

import { ageOn } from "@/utils/passengerRules";
import { seatNumberLabel } from "@/utils/seatLabel";

/** One printed passage ticket. Values are already formatted for the paper. */
export interface TicketData {
  /** BIR serial, assigned by the server. Empty until the sale is confirmed. */
  ticketNumber: string;
  /** Boarding token the gate scans. Empty until the sale is confirmed. */
  qrToken: string;
  vessel: string;
  route: string;
  voyageNo: string;
  passengerName: string;
  nationality: string;
  age: string;
  sex: string;
  accommodation: string;
  seat: string;
  departureDate: string;
  departureTime: string;
  dateIssued: string;
  ticketStation: string;
  issuedBy: string;
  tripKind: string;
  /** Formatted for print, e.g. "P 1,800.00". */
  fare: string;
  amountInWords: string;
  /** Unformatted, so the VAT split can be computed at render time. */
  fareAmount: number;
  currency: string;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

const MONTHS_DD = (d: Date) =>
  `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-08-14" → a local Date, avoiding the UTC shift `new Date(str)` applies. */
const parseISODate = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

/** "2026-08-14" → "08/14/2026 Fri", matching the operator's existing tickets. */
export const formatDepartureDate = (iso: string): string => {
  const d = parseISODate(iso);
  if (!d) return "";
  return `${MONTHS_DD(d)} ${DAY_ABBR[d.getDay()]}`;
};

/** "18:00:00" → "06:00:00 PM". */
export const formatDepartureTime = (time: string | null | undefined): string => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(time ?? "");
  if (!m) return "";
  const h24 = Number(m[1]);
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, "0")}:${m[2]}:${m[3] ?? "00"} ${suffix}`;
};

/**
 * Voyage number in the operator's format: MMDD + origin port code + YYYY,
 * e.g. departing Zamboanga on 14 Aug 2026 → "0814ZAM2026".
 *
 * The code comes from `ports.code` via /api/v1/routes, so it is whatever an
 * admin has set for that port — change it there, not here, if the printed code
 * should differ from the one the rest of the system uses.
 */
export const buildVoyageNumber = (departISO: string, originCode: string): string => {
  const d = parseISODate(departISO);
  if (!d) return "";
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${mmdd}${(originCode || "").toUpperCase()}${d.getFullYear()}`;
};

/**
 * "ZAM-SDK" — the two ports' 3-letter codes. Falls back to the port name for a
 * port with no code set, which at least prints something readable.
 */
export const formatRoute = (
  origin: string,
  originCode: string,
  destination: string,
  destinationCode: string
): string =>
  `${(originCode || origin || "").trim()}-${(destinationCode || destination || "").trim()}`.toUpperCase();

/** "DELA CRUZ, JUAN P" — last name first, as the ticket asks for. */
export const formatPassengerName = (
  first: string,
  middleInitial: string,
  last: string
): string => {
  const mi = (middleInitial || "").trim().replace(/\.$/, "");
  return `${last.trim()}, ${first.trim()}${mi ? ` ${mi.toUpperCase()}.` : ""}`.toUpperCase();
};

const ONES = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
  "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
  "SEVENTEEN", "EIGHTEEN", "NINETEEN",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];

const under1000 = (n: number): string => {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} HUNDRED`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
};

// Currency wording and prefix for the printed ticket. The printer's code page
// has no peso or ringgit glyph to rely on, so the fare prints an ASCII prefix —
// "P" for pesos, which is how the operator's existing tickets already read, and
// "RM" for ringgit.
const CURRENCY_WORDS: Record<string, { major: string; minor: string; prefix: string }> = {
  PHP: { major: "PESOS", minor: "CENTAVOS", prefix: "P" },
  MYR: { major: "RINGGIT", minor: "SEN", prefix: "RM" },
};

const wordsFor = (currency?: string | null) =>
  CURRENCY_WORDS[(currency ?? "PHP").toUpperCase()] ?? CURRENCY_WORDS.PHP;

/** 1800 → "ONE THOUSAND EIGHT HUNDRED PESOS ONLY" (the fare line on the form). */
export const amountInWords = (amount: number, currency?: string | null): string => {
  const { major, minor } = wordsFor(currency);
  const whole = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  if (whole === 0 && cents === 0) return `ZERO ${major} ONLY`;

  const groups: [number, string][] = [
    [1_000_000_000, "BILLION"],
    [1_000_000, "MILLION"],
    [1_000, "THOUSAND"],
  ];
  let rest = whole;
  const parts: string[] = [];
  for (const [value, name] of groups) {
    if (rest >= value) {
      parts.push(`${under1000(Math.floor(rest / value))} ${name}`);
      rest %= value;
    }
  }
  if (rest > 0) parts.push(under1000(rest));

  const spelled = parts.length ? parts.join(" ") : "ZERO";
  return cents > 0
    ? `${spelled} ${major} AND ${under1000(cents)} ${minor} ONLY`
    : `${spelled} ${major} ONLY`;
};

/** "P 1,800.00" / "RM 1,800.00" — ASCII prefix for the printer's code page. */
export const printableFare = (amount: number, currency?: string | null): string =>
  `${wordsFor(currency).prefix} ${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// ── VAT ─────────────────────────────────────────────────────────────────────

export const VAT_RATE = 0.12;

export interface VatBreakdown {
  vatableSales: number;
  vatAmount: number;
  vatExempt: number;
  zeroRated: number;
  total: number;
}

/**
 * Split a VAT-INCLUSIVE fare into the lines the sales invoice must show.
 *
 * !! CONFIRM WITH THE OPERATOR'S ACCOUNTANT BEFORE GOING LIVE !!
 * The rule applied here is the common one — domestic carriage priced in PHP is
 * VATable at 12% inclusive, and a fare sold in another currency is treated as
 * an international leg and reported zero-rated. Discounted categories that are
 * VAT-exempt by statute (senior citizen, PWD) are NOT modelled: they currently
 * fall into VATable sales. If the operator grants statutory discounts, this
 * function is where that belongs, and getting it wrong misstates a tax return.
 */
export const vatBreakdown = (amount: number, currency?: string | null): VatBreakdown => {
  const total = Math.max(0, amount);
  const isDomestic = (currency ?? "PHP").toUpperCase() === "PHP";
  if (!isDomestic) {
    return { vatableSales: 0, vatAmount: 0, vatExempt: 0, zeroRated: total, total };
  }
  const vatableSales = Math.round((total / (1 + VAT_RATE)) * 100) / 100;
  // Derive VAT by subtraction so the lines always add back to the total.
  const vatAmount = Math.round((total - vatableSales) * 100) / 100;
  return { vatableSales, vatAmount, vatExempt: 0, zeroRated: 0, total };
};

// ── Ticket assembly ─────────────────────────────────────────────────────────

/** Everything a leg of the sale contributes to its passengers' tickets. */
export interface TicketLegContext {
  vessel: string;
  origin: string;
  destination: string;
  originCode: string;
  destinationCode: string;
  departDateISO: string;
  departTime: string | null;
  accommodation: string;
  tripKind: string;
  ticketStation: string;
  issuedBy: string;
  issuedDateISO: string;
}

export interface TicketPassenger {
  firstName: string;
  middleInitial: string;
  lastName: string;
  birthdate: string;
  sex: string;
  nationality: string;
  fare: number;
  /** Currency the fare was sold in — an international leg prints in MYR. */
  currency?: string | null;
  /** Empty for a passenger who occupies no seat (a lap infant). */
  seat?: string | null;
}

/**
 * Build a ticket's printable values from the booking screen's own state.
 *
 * `ticketNumber` and `qrToken` are left empty: both are assigned by the server
 * when the tickets are created, and are filled in by `attachServerTickets` once
 * the payment response comes back.
 */
export function buildTicketData(
  leg: TicketLegContext,
  pax: TicketPassenger
): TicketData {
  const issued = parseISODate(leg.issuedDateISO) ?? new Date();
  const currency = (pax.currency ?? "PHP").toUpperCase();
  return {
    ticketNumber: "",
    qrToken: "",
    vessel: (leg.vessel || "").toUpperCase(),
    route: formatRoute(leg.origin, leg.originCode, leg.destination, leg.destinationCode),
    voyageNo: buildVoyageNumber(leg.departDateISO, leg.originCode),
    passengerName: formatPassengerName(pax.firstName, pax.middleInitial, pax.lastName),
    nationality: (pax.nationality || "").toUpperCase(),
    age: pax.birthdate ? String(ageOn(pax.birthdate, issued)) : "",
    sex: (pax.sex || "").trim().charAt(0).toUpperCase(),
    accommodation: (leg.accommodation || "").toUpperCase(),
    // Printed as the number painted on the ship, not the prefixed stored name.
    seat: seatNumberLabel(pax.seat || "").toUpperCase(),
    departureDate: formatDepartureDate(leg.departDateISO),
    departureTime: formatDepartureTime(leg.departTime),
    dateIssued: MONTHS_DD(issued),
    ticketStation: (leg.ticketStation || "").toUpperCase(),
    issuedBy: (leg.issuedBy || "").toUpperCase(),
    tripKind: leg.tripKind.toUpperCase(),
    fare: printableFare(pax.fare, currency),
    amountInWords: amountInWords(pax.fare, currency),
    fareAmount: pax.fare,
    currency,
  };
}

/** A ticket as the server created it. */
export interface ServerTicket {
  ticket_number?: string | null;
  qr_token?: string | null;
}

/**
 * Fill in the server-assigned serial and boarding token.
 *
 * Matched by position: the backend creates tickets departure-leg-first, all
 * passengers in row order, then the return leg (see `_insert_leg_tickets`), and
 * `buildTickets` walks the same order. A ticket the server did not return is
 * left with empty values rather than borrowing its neighbour's — printing one
 * passenger's QR on another's ticket would board the wrong person.
 */
export function attachServerTickets(
  tickets: TicketData[],
  server: ServerTicket[] | null | undefined
): TicketData[] {
  const rows = server ?? [];
  return tickets.map((t, i) => ({
    ...t,
    ticketNumber: (rows[i]?.ticket_number ?? "").toString(),
    qrToken: (rows[i]?.qr_token ?? "").toString(),
  }));
}

// ── Reprint ─────────────────────────────────────────────────────────────────

/** One live ticket as POST /office/bookings/{ref}/reprint returns it. */
export interface ReprintTicket {
  ticket_number: string | null;
  qr_token: string | null;
  vessel: string | null;
  origin: string | null;
  origin_code: string | null;
  destination: string | null;
  destination_code: string | null;
  /** Naive Asia/Manila wall clock, already split by the server so no client
   *  timezone can shift the printed departure. */
  depart_date: string | null;
  depart_time: string | null;
  accommodation_class: string | null;
  seat_number: string | null;
  passenger_first_name: string | null;
  passenger_middle_name: string | null;
  passenger_last_name: string | null;
  passenger_birthdate: string | null;
  passenger_gender: string | null;
  passenger_nationality: string | null;
  price: number;
  currency: string;
}

/** A past sale, ready to print again. */
export interface ReprintBooking {
  booking_reference: string;
  /** The ORIGINAL sale's issuing counter, agent and date — a reprint is a copy
   *  of that invoice, not a new one from whoever is standing at the till. */
  ticket_station: string;
  issued_by: string;
  issued_date: string | null;
  trip_kind: string;
  tickets: ReprintTicket[];
}

/**
 * Rebuild the printable tickets for a sale that is no longer on screen.
 *
 * The booking screen prints from the forms it captured; a reprint has only what
 * Postgres kept, so this is the same assembly fed from the server's row instead
 * of the cashier's typing. Serials and boarding tokens come from the row rather
 * than being left blank — these tickets already exist, so nothing is issued.
 */
export function buildReprintTickets(booking: ReprintBooking): TicketData[] {
  const built = booking.tickets.map((t) =>
    buildTicketData(
      {
        vessel: t.vessel ?? "",
        origin: t.origin ?? "",
        destination: t.destination ?? "",
        originCode: t.origin_code ?? "",
        destinationCode: t.destination_code ?? "",
        departDateISO: t.depart_date ?? "",
        departTime: t.depart_time,
        accommodation: t.accommodation_class ?? "",
        tripKind: booking.trip_kind,
        ticketStation: booking.ticket_station,
        issuedBy: booking.issued_by,
        issuedDateISO: booking.issued_date ?? "",
      },
      {
        firstName: t.passenger_first_name ?? "",
        middleInitial: t.passenger_middle_name ?? "",
        lastName: t.passenger_last_name ?? "",
        birthdate: t.passenger_birthdate ?? "",
        sex: t.passenger_gender ?? "",
        nationality: t.passenger_nationality ?? "",
        fare: t.price,
        currency: t.currency,
        seat: t.seat_number,
      }
    )
  );
  return attachServerTickets(built, booking.tickets);
}
