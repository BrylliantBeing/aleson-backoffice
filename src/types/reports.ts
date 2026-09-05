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
}

export interface Manifest {
  trip_id: number;
  vessel: string;
  route: string;
  origin: string;
  destination: string;
  origin_code: string | null;
  destination_code: string | null;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  actual_departure: string | null;
  status: string;
  total: number;
  boarded: number;
  minors: number;
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
