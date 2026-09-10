/**
 * Shapes returned by the office reporting endpoints, shared by the Reports
 * screen and the two document renderers (thermal Z-report, A4 manifest).
 */

/**
 * One tender's trading, totalled on its own.
 *
 * Cash, card and QR PH are answered separately because they are separate
 * questions: only cash reaches the drawer and gets counted against this, while
 * card and QR PH settle with the gateway and are reconciled against it. The
 * server folds the two spellings of the QR PH rail ('qr' at the counter,
 * 'qrph' on the website) into this one line.
 */
export interface ReportTender {
  method: string;
  /** "Cash" / "Card" / "QR PH" — the server decides how a tender is named. */
  label: string;
  bookings: number;
  /** Count of rebook fees and fare upgrades collected on this tender.
   *
   *  Apart from `bookings` because a top-up is not a sale — it is a second
   *  payment against one somebody already made, often on another day and
   *  another tender. Its money IS in `gross`, because it is in the drawer. */
  rebooks: number;
  gross: number;
  /** Count of refunds paid back against this tender. */
  refunds: number;
  refunded: number;
  /** Count of tickets voided against this tender. A void is the counter
   *  correcting its own mistake and returns the whole fare, so it is reported
   *  apart from a refund, which withholds a cancellation fee. */
  cancels: number;
  cancelled: number;
  /** Gross less refunds less voids. */
  net: number;
}

/** One currency's trading for a shift. PHP and MYR never sum — every figure
 *  on a report carries the currency it was taken in. */
export interface ReportTotal {
  currency: string;
  bookings: number;
  tickets: number;
  gross: number;
  refunded: number;
  cancelled: number;
  net: number;
  tenders: ReportTender[];
  by_passenger_type: Record<string, number>;
}

/** One currency's drawer line. `counted_cash`/`variance` are null until the
 *  cashier has actually counted, i.e. while the shift is still open. */
export interface ReportDrawerLine {
  currency: string;
  opening_float: number;
  cash_sales: number;
  expected_cash: number;
  counted_cash: number | null;
  variance: number | null;
  /** Cash handed back over the counter this shift: refunds settled by hand and
   *  voided cash sales. Already deducted from expected_cash — it is reported so
   *  a drawer holding less than the day's sales explains itself. */
  cash_payouts: number;
}

export interface ReportVoyage {
  trip_id: number;
  vessel: string;
  route: string;
  scheduled_departure: string | null;
  passengers: number;
  amounts: { currency: string; passengers: number; amount: number }[];
}

/**
 * One sailing's line on the front page of the operator's pack.
 *
 * Not a roll-up of what the shift sold: a refund paid today against a ticket
 * sold last week belongs to that older sailing, which then appears here with no
 * tickets issued and a negative total. The server unions sales, refunds and
 * voids on (sailing, currency) for exactly that reason.
 */
export interface ReportVoyageSummary {
  trip_id: number;
  currency: string;
  /** "Zamboanga - Bongao". */
  route: string;
  /** "ZAM-BGO", as the ticket-sales page prints it. */
  route_code: string;
  vessel: string;
  /** "0831ZAMBGO2026" — the operator's own way of naming a sailing. */
  voyage_no: string | null;
  voyage_date: string | null;
  scheduled_departure: string | null;
  tickets_issued: number;
  ticket_sales: number;
  cancels: number;
  refunds: number;
  /** ticket_sales - cancels - refunds; negative on a refund-only sailing. */
  total_sales: number;
}

/** One line of the REFUNDS page. */
export interface ReportRefundLine {
  ticket_number: string | null;
  voyage_no: string | null;
  /** "SURNAME, Given". */
  passenger: string;
  discount: string;
  total_fare: number;
  /** What was withheld — total_fare less total_refund. */
  surcharge: number;
  /** Not a state this system records; the column exists so the sheet matches
   *  the one it replaces, and reads zero. */
  no_show: number;
  total_refund: number;
  currency: string;
  refunded_at: string | null;
}

/** One line of the CANCELLED BOOKINGS page. Both stamps are shown because the
 *  pair is the point: a void minutes after issue is a counter slip. */
export interface ReportCancelLine {
  ticket_number: string | null;
  voyage_no: string | null;
  passenger: string;
  date_issued: string | null;
  date_cancelled: string | null;
  total_fare: number;
  currency: string;
}

/**
 * One card or QR Ph sale of the shift, with the reference the cashier keyed
 * off the terminal slip.
 *
 * Neither rail settles through this system, so the tender totals cannot be
 * matched to anything on their own: the acquirer sends a batch of references
 * and amounts, and this is the only list holding both sides of it.
 */
export interface ReportSettlementLine {
  booking_reference: string;
  /** Storage key — "card" or "qrph". */
  method: string;
  /** How the counter says it: "Card", "QR PH". */
  label: string;
  /** Last 5 of the third-party order id. Blank on a sale taken before the
   *  counter started keying it, which can only be matched by amount and time. */
  external_ref: string | null;
  amount: number;
  currency: string;
  settled_at: string | null;
  /** Set only when the line is a rebook fee rather than a sale, and naming the
   *  ticket that was moved. The acquirer's batch does not distinguish the two,
   *  so a fee has to say what it was — otherwise it reads as a booking whose
   *  reference cannot be found. */
  rebooked_ticket_number: string | null;
}

/** One line of the TICKET SALES page. */
export interface ReportSaleLine {
  ticket_number: string | null;
  passenger: string;
  route_code: string;
  accommodation: string;
  seat_number: string;
  discount: string;
  fare: number;
  currency: string;
}

export interface ZReport {
  shift: {
    id: number;
    status: "open" | "closed";
    opened_at: string | null;
    closed_at: string | null;
    notes: string | null;
  };
  agent: {
    id: number;
    name: string;
    email: string;
    ticket_station: string | null;
  };
  totals: ReportTotal[];
  drawer: ReportDrawerLine[];
  tickets_issued: number;
  /** First and last serial this shift issued, in issue order — the range the
   *  day's return is reconciled against, and where a gap would show. */
  serial_from: string | null;
  serial_to: string | null;
  voyages: ReportVoyage[];
  /** The operator's pack: front-page summary, then a page each for the
   *  refunds, the voids and the tickets issued. */
  voyage_summary: ReportVoyageSummary[];
  /** The card/QR Ph references the shift settled against. */
  settlements: ReportSettlementLine[];
  refunds_detail: ReportRefundLine[];
  cancels_detail: ReportCancelLine[];
  sales_detail: ReportSaleLine[];
  generated_at: string;
  generated_by: string;
}

export interface ManifestPassenger {
  ticket_id: number;
  first_name: string;
  last_name: string;
  /** "SURNAME, Given" — the order a manifest is checked against IDs. */
  passenger_name: string;
  age: number | null;
  gender: string | null;
  nationality: string | null;
  passenger_type: string;
  seat_number: string;
  accommodation_class: string;
  ticket_number: string | null;
  booking_reference: string;
  boarded_at: string | null;
  status: string;
  /** Phone (preferred) or email, held per booking — everyone travelling on one
   *  reference shares it. Null when the sale captured neither. */
  contact: string | null;
  /** Set only on a free pass: the RO/RO cargo document the free ride was issued
   *  against, so the manifest can be checked against the shipper's paperwork at
   *  the pier. Null on every paying passenger. */
  cargo_reference: string | null;
  /** Code of the accommodation class ("AC-A"), as the deck plan and the cabin
   *  door are marked. The "Class/Cot No." column prints this, not the name. */
  class_code: string | null;
  /** Government ID presented at booking. The PASSPORT column is filled from
   *  these two only when the document actually is a passport. */
  id_type: string | null;
  id_number: string | null;
}

export interface Manifest {
  trip_id: number;
  vessel: string;
  route: string;
  origin: string;
  destination: string;
  origin_code: string | null;
  destination_code: string | null;
  /** "0907ZAMBGO2026" — how the operator names this sailing on paper. */
  voyage_no: string | null;
  /** Ticket station of the counter that pulled the manifest ("BLVD1"). */
  station: string | null;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  actual_departure: string | null;
  status: string;
  total: number;
  boarded: number;
  minors: number;
  /** How many aboard are travelling free with RO/RO cargo. */
  free_passes: number;
  by_class: { accommodation_class: string; passengers: number }[];
  by_gender: { gender: string; passengers: number }[];
  passengers: ManifestPassenger[];
  generated_at: string;
  generated_by: string;
}

/** A sailing offered in the manifest picker. */
export interface ManifestTrip {
  trip_id: number;
  scheduled_departure: string | null;
  status: string;
  vessel: string;
  route: string;
  origin: string;
  destination: string;
  passengers: number;
}
