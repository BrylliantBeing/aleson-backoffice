/**
 * The cashier's end-of-day sales report, as printed on the counter's TM-T82X.
 *
 * A Z-report belongs on the till roll rather than on A4: it is read once at the
 * counter, signed, and filed with the drawer count, and it prints on the same
 * printer that has been issuing tickets all day. Same 80mm geometry and the
 * same writer as the ticket (see escpos.ts) — a top-to-bottom flow of lines
 * with nothing to align.
 *
 * Every figure carries its currency and nothing is summed across currencies:
 * PHP and MYR do not convert, so a drawer holding both reconciles as two
 * independent blocks, exactly as the Till tab does it.
 */

import {
  EscposWriter,
  FONT_A_COLS,
  FONT_B_COLS,
  concatBytes,
  pair,
  rule,
  wrap,
} from "@/utils/escpos";
import { money } from "@/utils/currency";
import { ISSUER } from "@/utils/ticketDoc";
import { ZReport } from "@/types/reports";

const W = FONT_A_COLS;

/** "05 Sep 2026 06:12 PM". Server timestamps on a report are already Manila
 *  wall clocks emitted without an offset, so the runtime parses them as local
 *  time — which at the counter is the same thing. */
const when = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-PH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const shortWhen = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-PH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

/** A signed amount, so a shortfall reads as one rather than as a bare figure. */
const signed = (n: number, currency: string) =>
  `${n < 0 ? "-" : n > 0 ? "+" : ""}${money(Math.abs(n), currency)}`;

export function renderZReport(report: ZReport): Uint8Array {
  const w = new EscposWriter();
  const closed = report.shift.status === "closed";

  w.init().font("A").align("center");
  w.bold(true).line(ISSUER.name).bold(false);
  w.font("B");
  for (const l of wrap(ISSUER.address, FONT_B_COLS)) w.line(l);
  w.line(ISSUER.tin);
  w.font("A");

  w.line(rule(W, "="));
  w.size(1, 2).bold(true).line("END OF DAY SALES").bold(false).size(1, 1);
  // An open shift can be printed as a mid-shift reading, but it must never be
  // mistaken for the closing document that gets filed with the cash.
  w.line(closed ? "Z-REPORT" : "X-READING (SHIFT STILL OPEN)");
  w.line(rule(W, "="));

  // ── Who and when ──────────────────────────────────────────────────────────
  w.align("left");
  w.line(pair("CASHIER", report.agent.name, W));
  w.line(pair("STATION", report.agent.ticket_station || "UNASSIGNED", W));
  w.line(pair("SHIFT NO.", `#${report.shift.id}`, W));
  w.line(pair("OPENED", when(report.shift.opened_at), W));
  w.line(pair("CLOSED", closed ? when(report.shift.closed_at) : "— still open —", W));
  w.line(rule(W));

  // ── Sales, one block per currency ─────────────────────────────────────────
  if (report.totals.length === 0) {
    w.align("center").line("NO SALES THIS SHIFT").align("left");
    w.line(rule(W));
  }
  for (const t of report.totals) {
    w.bold(true).line(`SALES — ${t.currency}`).bold(false);
    w.font("B");
    w.line(pair("  Bookings", String(t.bookings), FONT_B_COLS, "."));
    w.line(pair("  Passengers ticketed", String(t.tickets), FONT_B_COLS, "."));
    w.font("A");

    // Each tender totalled on its own, because each is reconciled against
    // something different: cash against the drawer, card and QR PH against the
    // gateway. A single "sales" figure cannot be checked against anything.
    for (const tender of t.tenders) {
      w.line(rule(W, "-"));
      w.bold(true)
        .line(pair(`  ${tender.label.toUpperCase()}`, money(tender.gross, t.currency), W))
        .bold(false);
      w.font("B");
      w.line(`    ${tender.bookings} ${tender.bookings === 1 ? "sale" : "sales"}`);
      if (tender.refunded > 0) {
        w.line(
          pair(
            `    less ${tender.refunds} refunded`,
            `-${money(tender.refunded, t.currency)}`,
            FONT_B_COLS,
            "."
          )
        );
      }
      // Voids are the counter's own corrections and are kept apart from
      // refunds, exactly as the operator's daily summary separates them.
      if (tender.cancelled > 0) {
        w.line(
          pair(
            `    less ${tender.cancels} voided`,
            `-${money(tender.cancelled, t.currency)}`,
            FONT_B_COLS,
            "."
          )
        );
      }
      if (tender.refunded > 0 || tender.cancelled > 0) {
        w.font("A");
        w.line(pair(`  ${tender.label.toUpperCase()} NET`, money(tender.net, t.currency), W));
      }
      w.font("A");
    }

    w.line(rule(W, "="));
    w.line(pair("  TICKET SALES", money(t.gross, t.currency), W));
    if (t.cancelled > 0) {
      w.line(pair("  CANCELS", `-${money(t.cancelled, t.currency)}`, W));
    }
    if (t.refunded > 0) {
      w.line(pair("  REFUNDS", `-${money(t.refunded, t.currency)}`, W));
    }
    w.bold(true).line(pair("  NET SALES", money(t.net, t.currency), W)).bold(false);

    const types = Object.entries(t.by_passenger_type);
    if (types.length > 0) {
      w.font("B");
      for (const l of wrap(
        types.map(([type, count]) => `${type} ${count}`).join("   "),
        FONT_B_COLS - 2
      )) {
        w.line(`  ${l}`);
      }
      w.font("A");
    }
    w.line(rule(W));
  }

  // ── Drawer, one block per currency ────────────────────────────────────────
  for (const d of report.drawer) {
    w.bold(true).line(`DRAWER — ${d.currency}`).bold(false);
    w.font("B");
    w.line(pair("  Opening float", money(d.opening_float, d.currency), FONT_B_COLS, "."));
    w.line(pair("  Cash sales", money(d.cash_sales, d.currency), FONT_B_COLS, "."));
    // Refunds handed back by hand and voided cash sales. Already taken off the
    // expected figure below; printed so a light drawer explains itself.
    if (d.cash_payouts > 0) {
      w.line(
        pair("  Less cash paid out", `-${money(d.cash_payouts, d.currency)}`, FONT_B_COLS, ".")
      );
    }
    w.font("A");
    w.line(pair("  EXPECTED IN DRAWER", money(d.expected_cash, d.currency), W));
    if (d.counted_cash !== null) {
      w.line(pair("  Counted", money(d.counted_cash, d.currency), W));
      w.bold(true)
        .line(pair("  VARIANCE", signed(d.variance ?? 0, d.currency), W))
        .bold(false);
    } else {
      w.font("B").line("  Not yet counted — close the till to reconcile.").font("A");
    }
    w.line(rule(W));
  }

  // ── Serials ───────────────────────────────────────────────────────────────
  // The serial range belongs on a Z-report: it is what the day's return is
  // reconciled against, and a break in it is what an audit looks for.
  w.bold(true).line("TICKETS ISSUED").bold(false);
  w.font("B");
  w.line(pair("  Count", String(report.tickets_issued), FONT_B_COLS, "."));
  w.line(pair("  First serial", report.serial_from ?? "—", FONT_B_COLS, "."));
  w.line(pair("  Last serial", report.serial_to ?? "—", FONT_B_COLS, "."));
  w.font("A");
  w.line(rule(W));

  // ── Sailings sold ─────────────────────────────────────────────────────────
  if (report.voyages.length > 0) {
    w.bold(true).line("SAILINGS SOLD").bold(false);
    w.font("B");
    for (const v of report.voyages) {
      w.line(`  ${v.vessel}`);
      w.line(`  ${v.route}  ${shortWhen(v.scheduled_departure)}`);
      for (const a of v.amounts) {
        w.line(
          pair(`    ${a.passengers} pax`, money(a.amount, a.currency), FONT_B_COLS, ".")
        );
      }
    }
    w.font("A");
    w.line(rule(W));
  }

  if (report.shift.notes) {
    w.bold(true).line("TILL NOTES").bold(false);
    w.font("B");
    for (const l of wrap(report.shift.notes, FONT_B_COLS)) w.line(l);
    w.font("A");
    w.line(rule(W));
  }

  // ── Sign-off ──────────────────────────────────────────────────────────────
  w.font("B");
  w.line(`Printed ${when(report.generated_at)}`);
  w.line(`by ${report.generated_by}`);
  w.font("A");
  w.feed(3);
  // Two signature blocks side by side, each caption centred under its own rule
  // rather than pushed to the paper's edges.
  const RULE = 20;
  const centred = (text: string) => {
    const pad = Math.max(0, Math.floor((RULE - text.length) / 2));
    return " ".repeat(pad) + text;
  };
  // Both lines stay in Font A: 48 Font-B characters span only three quarters of
  // the paper, so a caption set in B would not sit under the rule above it.
  w.line(pair("_".repeat(RULE), "_".repeat(RULE), W));
  w.line(pair(centred("Cashier"), centred("Verified by").padEnd(RULE), W));

  w.feed(3).cut();
  return w.toUint8Array();
}

/** One job, so a Z-report cannot be interleaved with a ticket on a shared
 *  printer — the same reason a multi-passenger sale prints as one job. */
export function renderZReportJob(report: ZReport): Uint8Array {
  return concatBytes([renderZReport(report)]);
}
