/**
 * The passage ticket as printed on the counter's TM-T82X.
 *
 * The whole ticket is printed onto blank 80mm roll — logo, details, QR, VAT
 * breakdown and terms — so this is an ordered flow of lines rather than a set
 * of coordinates. There is nothing to align against, which is why none of this
 * is configurable per counter.
 *
 * Reading order follows the paper ticket it replaces, so a cashier or inspector
 * who knows the old form can still find things.
 */

import {
  EscposWriter,
  FONT_A_COLS,
  FONT_B_COLS,
  QrEc,
  concatBytes,
  pair,
  rule,
  wrap,
} from "@/utils/escpos";
import { TicketData, printableFare, vatBreakdown } from "@/utils/ticketLayout";

/**
 * BIR-registered details of the issuer. These used to be pre-printed on the
 * form by the printshop; now we print them, so they have to be right.
 *
 * !! `PERMIT_NUMBER` MUST BE SET BEFORE GOING LIVE !! System-generated serials
 * normally require a BIR Permit to Use for a computerised accounting system,
 * and its number belongs on every invoice. Left blank the line is omitted
 * rather than printing a placeholder that would look official and be false.
 */
export const ISSUER = {
  name: "ALESON SHIPPING LINES, INC.",
  address: "172 Veterans Avenue, Zamboanga City, Philippines",
  tin: "VAT Reg. TIN: 000-944-291-00000",
  permitNumber: "",
};

/** Printed small at the foot of every ticket. */
export const DEFAULT_TERMS =
  "Passengers should be on board one (1) hour before scheduled departure, " +
  "otherwise the reservation may be cancelled. This ticket is non-transferable " +
  "and is valid only for the voyage, date and vessel shown. Present this ticket " +
  "and a valid ID at the boarding gate.";

export interface TicketDocOptions {
  /**
   * Two-character key of the logo stored in the printer's NV flash, uploaded
   * once per printer with Epson's TM utility. Null skips it — a printer that
   * never had the logo loaded still prints a complete, usable ticket.
   */
  logoKeyCodes?: [string, string] | null;
  /** QR module size in dots. 6 gives roughly 25mm at 203 dpi. */
  qrModuleSize?: number;
  qrEc?: QrEc;
  terms?: string;
}

const DEFAULTS: Required<TicketDocOptions> = {
  logoKeyCodes: null,
  qrModuleSize: 6,
  qrEc: "M",
  terms: DEFAULT_TERMS,
};

/** Render one ticket, ending in a partial cut. */
export function renderTicket(data: TicketData, options: TicketDocOptions = {}): Uint8Array {
  const o = { ...DEFAULTS, ...options };
  const w = new EscposWriter();
  const W = FONT_A_COLS;

  w.init().font("A").align("center");

  if (o.logoKeyCodes) w.nvGraphic(o.logoKeyCodes[0], o.logoKeyCodes[1]).raw(0x0a);

  w.bold(true).line(ISSUER.name).bold(false);
  w.font("B");
  for (const l of wrap(ISSUER.address, FONT_B_COLS)) w.line(l);
  w.line(ISSUER.tin);
  if (ISSUER.permitNumber) w.line(ISSUER.permitNumber);
  w.font("A");

  w.line(rule(W, "="));
  w.line("PASSAGE TICKET / SALES INVOICE");
  // The serial is what an inspector and an auditor both look for first, so it
  // gets the only double-height line on the ticket.
  w.size(1, 2).bold(true).line(data.ticketNumber || "UNNUMBERED").bold(false).size(1, 1);
  w.line(rule(W, "="));

  // ── Voyage ────────────────────────────────────────────────────────────────
  w.align("left");
  w.line(pair("VESSEL", data.vessel, W));
  w.line(pair("ROUTE", data.route, W));
  w.line(pair("VOYAGE NO.", data.voyageNo, W));
  w.line(pair("DEPARTURE", `${data.departureDate} ${data.departureTime}`.trim(), W));
  w.line(pair("ACCOMMODATION", data.accommodation, W));
  if (data.seat) w.line(pair("SEAT", data.seat, W));
  w.line(pair("TRIP", data.tripKind, W));
  w.line(rule(W));

  // ── Passenger ─────────────────────────────────────────────────────────────
  w.line("PASSENGER (NON-TRANSFERABLE)");
  w.bold(true).line(data.passengerName).bold(false);
  w.line(
    pair(
      `NATIONALITY ${data.nationality}`,
      `AGE ${data.age}  SEX ${data.sex}`,
      W
    )
  );
  w.line(rule(W));

  // ── Money ─────────────────────────────────────────────────────────────────
  const vat = vatBreakdown(data.fareAmount, data.currency);
  const amt = (n: number) => printableFare(n, data.currency);
  w.font("B");
  w.line(pair("  VATable Sales", amt(vat.vatableSales), FONT_B_COLS, "."));
  w.line(pair("  VAT (12%)", amt(vat.vatAmount), FONT_B_COLS, "."));
  w.line(pair("  VAT-Exempt Sales", amt(vat.vatExempt), FONT_B_COLS, "."));
  w.line(pair("  VAT Zero-Rated Sales", amt(vat.zeroRated), FONT_B_COLS, "."));
  w.font("A");
  w.bold(true).line(pair("TOTAL AMOUNT DUE", data.fare, W)).bold(false);
  w.font("B");
  for (const l of wrap(data.amountInWords, FONT_B_COLS)) w.line(l);
  w.font("A");
  w.line(rule(W));

  // ── Boarding QR ───────────────────────────────────────────────────────────
  // Printed only when the server actually issued a token. A placeholder QR
  // would scan to nothing at the gate and look like a system fault.
  w.align("center");
  if (data.qrToken) {
    w.qr(data.qrToken, o.qrModuleSize, o.qrEc);
    w.raw(0x0a);
    w.font("B").line("Scan at the boarding gate").font("A");
  } else {
    w.font("B").line("** NO BOARDING CODE - SEE TICKET OFFICE **").font("A");
  }
  w.align("left");
  w.line(rule(W));

  // ── Issue ─────────────────────────────────────────────────────────────────
  w.line(pair("DATE ISSUED", data.dateIssued, W));
  w.line(pair("TICKET STATION", data.ticketStation, W));
  w.line(pair("ISSUED BY", data.issuedBy, W));
  w.line(rule(W));

  // ── Terms ─────────────────────────────────────────────────────────────────
  w.font("B");
  for (const l of wrap(o.terms, FONT_B_COLS)) w.line(l);
  w.font("A");
  w.align("center").line("GOOD FOR ONE PASSENGER");
  w.align("left");

  w.feed(3).cut();
  return w.toUint8Array();
}

/** Render a whole sale as ONE spooler job, in the order the serials were issued. */
export function renderTickets(
  tickets: TicketData[],
  options: TicketDocOptions = {}
): Uint8Array {
  return concatBytes(tickets.map((t) => renderTicket(t, options)));
}

/**
 * A self-contained sample ticket for the printer setup screen — real structure,
 * obviously fake values, and a QR token that is visibly a sample so a stray
 * test print can never be mistaken for a boarding pass.
 */
export function sampleTicket(): TicketData {
  return {
    ticketNumber: "SAMPLE-0000",
    qrToken: "00000000-0000-0000-0000-000000000000",
    vessel: "MV ALESON GRANDE",
    route: "ZAM-SDK",
    voyageNo: "0821ZAM2026",
    passengerName: "DELA CRUZ, JUAN P.",
    nationality: "FILIPINO",
    age: "36",
    sex: "M",
    accommodation: "TOURIST",
    seat: "12A",
    departureDate: "08/21/2026 Fri",
    departureTime: "06:00:00 PM",
    dateIssued: "08/17/2026",
    ticketStation: "ZAMBOANGA",
    issuedBy: "TEST PRINT",
    tripKind: "ONE WAY",
    fare: "P 1,800.00",
    amountInWords: "ONE THOUSAND EIGHT HUNDRED PESOS ONLY",
    fareAmount: 1800,
    currency: "PHP",
  };
}
