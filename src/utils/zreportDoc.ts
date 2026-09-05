/**
 * The cashier's end-of-day pack, as A4 printed through the browser.
 *
 * Four documents, in the order the operator files them:
 *
 *   1. DAILY SUMMARY SALES REPORT — one line per sailing, then the totals the
 *      day's cash is counted against.
 *   2. REFUNDS — every ticket refunded on this shift.
 *   3. CANCELLED BOOKINGS — every ticket voided on this shift.
 *   4. TICKET SALES — every ticket issued, in serial order.
 *
 * All four print even when a section is empty. The pack is filed as a set and
 * read months later; a missing page is indistinguishable from a page that was
 * lost, whereas one saying "none this shift" answers the question.
 *
 * Same reasoning as the manifest (see manifestDoc.ts) for the paper size: these
 * are grids that get signed and filed, and a grid does not survive being folded
 * into 48 columns of 80mm roll.
 *
 * Every figure carries its currency and nothing is summed across currencies:
 * PHP and MYR do not convert, so a shift that took both reconciles as two
 * independent blocks, exactly as the Till tab does it.
 *
 * Web only. The counter runs this app in a browser (see nginx.conf and the
 * print agent's reason for existing); a native build has no `window.print`, so
 * the screen offers the on-screen report instead of pretending to print.
 */

import { Platform } from "react-native";
import { money } from "@/utils/currency";
import { ISSUER } from "@/utils/ticketDoc";
import {
  ReportCancelLine,
  ReportRefundLine,
  ReportSaleLine,
  ReportVoyageSummary,
  ZReport,
} from "@/types/reports";

/** Passenger names, till notes and agent names are free text, so everything is
 *  escaped before it reaches the document. */
const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const dash = "—";

/** Server timestamps are Manila wall clocks emitted without an offset, so the
 *  runtime parses them as local time — which at the counter is the same thing. */
const parse = (iso: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

/** "05 Sep 2026" */
const fmtDate = (iso: string | null): string => {
  const d = parse(iso);
  if (!d) return iso ? iso : dash;
  return d.toLocaleDateString("en-PH", { day: "2-digit", month: "short", year: "numeric" });
};

/** "05 Sep 2026, 06:12 PM" */
const fmtStamp = (iso: string | null): string => {
  const d = parse(iso);
  if (!d) return iso ? iso : dash;
  return d.toLocaleString("en-PH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

/** Accounting style: a negative reads as (₱6,912.00), the way the operator's
 *  own summary writes a sailing that only took refunds that day. */
const accounting = (n: number, currency: string): string =>
  n < 0 ? `(${money(Math.abs(n), currency)})` : money(n, currency);

/** A deduction is only worth a figure when there is one; an empty column of
 *  zeroes is slower to read than a column of dashes. */
const less = (n: number, currency: string): string => (n > 0 ? money(n, currency) : dash);

/** A signed amount, so a shortfall reads as one rather than as a bare figure. */
const signed = (n: number, currency: string): string =>
  `${n < 0 ? "-" : n > 0 ? "+" : ""}${money(Math.abs(n), currency)}`;

/** Currencies present anywhere in the pack, in a stable order. */
const currenciesOf = (report: ZReport): string[] => {
  const seen: string[] = [];
  const add = (c: string) => {
    if (c && !seen.includes(c)) seen.push(c);
  };
  report.totals.forEach((t) => add(t.currency));
  report.voyage_summary.forEach((v) => add(v.currency));
  report.drawer.forEach((d) => add(d.currency));
  return seen;
};

/** The identity strip every page in the pack repeats, so a sheet separated from
 *  the set still says whose shift it belongs to. */
const pageHead = (report: ZReport, title: string, subtitle: string): string => `
  <div class="issuer">
    <div class="name">${esc(ISSUER.name)}</div>
    <div class="meta">${esc(ISSUER.address)}</div>
  </div>
  <h1>${esc(title)}</h1>
  <div class="strip">
    <span><b>USER:</b> ${esc(report.agent.name)}</span>
    <span><b>STATION:</b> ${esc(report.agent.ticket_station || "UNASSIGNED")}</span>
    <span><b>SHIFT:</b> #${esc(report.shift.id)}</span>
    <span><b>${esc(subtitle)}</b></span>
  </div>`;

/** The signature block each page of the pack carries. */
const clerkBlock = (report: ZReport, caption: string): string => `
  <table class="sign">
    <tr>
      <td>
        <div class="cap">${esc(caption)}</div>
        <div class="rule">${esc(report.agent.name)}</div>
      </td>
      <td><div class="cap">Verified by</div><div class="rule">&nbsp;</div></td>
    </tr>
  </table>`;

// ── Page 1: the summary ─────────────────────────────────────────────────────

const summaryTable = (rows: ReportVoyageSummary[], currency: string): string => {
  const totals = rows.reduce(
    (a, r) => ({
      issued: a.issued + r.tickets_issued,
      sales: a.sales + r.ticket_sales,
      cancels: a.cancels + r.cancels,
      refunds: a.refunds + r.refunds,
      total: a.total + r.total_sales,
    }),
    { issued: 0, sales: 0, cancels: 0, refunds: 0, total: 0 }
  );
  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(r.route)}</td>
        <td>${esc(r.vessel)}</td>
        <td class="c">${esc(fmtDate(r.voyage_date))}</td>
        <td class="c">${r.tickets_issued}</td>
        <td class="n">${esc(money(r.ticket_sales, currency))}</td>
        <td class="n">${esc(less(r.cancels, currency))}</td>
        <td class="n">${esc(less(r.refunds, currency))}</td>
        <td class="n b">${esc(accounting(r.total_sales, currency))}</td>
      </tr>`
    )
    .join("\n");

  return `
  <h2>Sales by sailing &mdash; ${esc(currency)}</h2>
  <table class="grid">
    <colgroup>
      <col style="width:20%"><col style="width:13%"><col style="width:12%">
      <col style="width:8%"><col style="width:13%"><col style="width:11%">
      <col style="width:11%"><col style="width:12%">
    </colgroup>
    <thead>
      <tr>
        <th>Route</th>
        <th>Vessel</th>
        <th class="c">Voyage date</th>
        <th class="c">Tkts issued</th>
        <th class="n">Ticket sales</th>
        <th class="n">Cancels</th>
        <th class="n">Refunds</th>
        <th class="n">Total sales</th>
      </tr>
    </thead>
    <tbody>
${body || `<tr><td colspan="8" class="empty">No sailings traded on this shift.</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3">TOTAL</td>
        <td class="c">${totals.issued}</td>
        <td class="n">${esc(money(totals.sales, currency))}</td>
        <td class="n">${esc(less(totals.cancels, currency))}</td>
        <td class="n">${esc(less(totals.refunds, currency))}</td>
        <td class="n">${esc(accounting(totals.total, currency))}</td>
      </tr>
    </tfoot>
  </table>

  <table class="overall">
    <tr>
      <td class="k">Overall total</td>
      <td class="n big">${esc(accounting(totals.total, currency))}</td>
    </tr>
    <tr>
      <!-- No-show is not a state this system records. The line is kept so the
           sheet reconciles against the one it replaces, and reads zero. -->
      <td class="k">Total no-show</td>
      <td class="n">${esc(money(0, currency))}</td>
    </tr>
    <tr class="net">
      <td class="k">Total (with no-show)</td>
      <td class="n">${esc(accounting(totals.total, currency))}</td>
    </tr>
  </table>`;
};

const summaryPage = (report: ZReport): string => {
  const closed = report.shift.status === "closed";
  const currencies = currenciesOf(report);
  const perCurrency = currencies.length
    ? currencies
        .map((c) =>
          summaryTable(
            report.voyage_summary.filter((v) => v.currency === c),
            c
          )
        )
        .join("\n")
    : summaryTable([], "PHP");

  // One row per cashier, which for a shift report is one row — the shape is the
  // operator's, and it is what the cash is signed against.
  const userRows = report.totals
    .map(
      (t) => `<tr>
        <td>${esc(report.agent.name)}</td>
        <td class="c">${t.tickets}</td>
        <td class="c">${t.tenders.reduce((a, x) => a + x.cancels, 0)}</td>
        <td class="c">${t.tenders.reduce((a, x) => a + x.refunds, 0)}</td>
        <td class="n b">${esc(accounting(t.net, t.currency))}</td>
      </tr>`
    )
    .join("\n");

  const tenderRows = report.totals
    .map((t) =>
      t.tenders
        .map(
          (tender) => `<tr>
            <td>${esc(tender.label)}</td>
            <td class="c">${esc(t.currency)}</td>
            <td class="c">${tender.bookings}</td>
            <td class="n">${esc(money(tender.gross, t.currency))}</td>
            <td class="n">${esc(less(tender.refunded + tender.cancelled, t.currency))}</td>
            <td class="n b">${esc(money(tender.net, t.currency))}</td>
          </tr>`
        )
        .join("\n")
    )
    .join("\n");

  const drawerRows = report.drawer
    .map(
      (d) => `<tr>
        <td class="c">${esc(d.currency)}</td>
        <td class="n">${esc(money(d.opening_float, d.currency))}</td>
        <td class="n">${esc(money(d.cash_sales, d.currency))}</td>
        <td class="n">${esc(less(d.cash_payouts, d.currency))}</td>
        <td class="n b">${esc(money(d.expected_cash, d.currency))}</td>
        <td class="n">${d.counted_cash === null ? dash : esc(money(d.counted_cash, d.currency))}</td>
        <td class="n b">${
          d.counted_cash === null ? dash : esc(signed(d.variance ?? 0, d.currency))
        }</td>
      </tr>`
    )
    .join("\n");

  return `
<section class="page">
  ${pageHead(report, "Daily Summary Sales Report", `PRINTED: ${fmtDate(report.generated_at)}`)}
  ${
    closed
      ? ""
      : `<div class="reading">X-READING &mdash; SHIFT STILL OPEN, DRAWER NOT YET COUNTED</div>`
  }

  <table class="meta">
    <tr>
      <td class="k">Computer tkt nos.</td>
      <td class="v mono">${esc(report.serial_from ?? dash)} &ndash; ${esc(
        report.serial_to ?? dash
      )}</td>
      <td class="k">Shift opened</td>
      <td class="v">${esc(fmtStamp(report.shift.opened_at))}</td>
    </tr>
    <tr>
      <td class="k">Tickets issued</td>
      <td class="v">${report.tickets_issued}</td>
      <td class="k">Shift closed</td>
      <td class="v">${closed ? esc(fmtStamp(report.shift.closed_at)) : "&mdash; still open &mdash;"}</td>
    </tr>
  </table>
${perCurrency}

  <h2>By cashier</h2>
  <table class="grid">
    <colgroup>
      <col style="width:32%"><col style="width:15%"><col style="width:15%">
      <col style="width:15%"><col style="width:23%">
    </colgroup>
    <thead>
      <tr>
        <th>User</th>
        <th class="c">Total tickets</th>
        <th class="c">Total cancels</th>
        <th class="c">Total refunds</th>
        <th class="n">Total sales</th>
      </tr>
    </thead>
    <tbody>
${userRows || `<tr><td colspan="5" class="empty">No sales taken on this shift.</td></tr>`}
    </tbody>
  </table>

  <!-- Kept alongside the operator's own layout because a single "total cash"
       line cannot be checked against anything: only the cash row reaches the
       drawer, while card and QR PH settle with the gateway. -->
  <h2>By tender</h2>
  <table class="grid">
    <colgroup>
      <col style="width:20%"><col style="width:10%"><col style="width:12%">
      <col style="width:20%"><col style="width:18%"><col style="width:20%">
    </colgroup>
    <thead>
      <tr>
        <th>Tender</th>
        <th class="c">Curr.</th>
        <th class="c">Sales</th>
        <th class="n">Gross</th>
        <th class="n">Reversed</th>
        <th class="n">Net</th>
      </tr>
    </thead>
    <tbody>
${tenderRows || `<tr><td colspan="6" class="empty">No sales taken on this shift.</td></tr>`}
    </tbody>
  </table>

  <h2>Cash drawer</h2>
  <table class="grid">
    <colgroup>
      <col style="width:10%"><col style="width:15%"><col style="width:15%">
      <col style="width:15%"><col style="width:15%"><col style="width:15%">
      <col style="width:15%">
    </colgroup>
    <thead>
      <tr>
        <th class="c">Curr.</th>
        <th class="n">Opening float</th>
        <th class="n">Cash sales</th>
        <th class="n">Paid out</th>
        <th class="n">Expected</th>
        <th class="n">Counted</th>
        <th class="n">Variance</th>
      </tr>
    </thead>
    <tbody>
${drawerRows || `<tr><td colspan="7" class="empty">No drawer was opened for this shift.</td></tr>`}
    </tbody>
  </table>
${
  report.shift.notes
    ? `\n  <h2>Till notes</h2>\n  <div class="notes">${esc(report.shift.notes)}</div>`
    : ""
}
  ${clerkBlock(report, "Prepared by")}
  <div class="foot">
    <span>Printed ${esc(fmtStamp(report.generated_at))} by ${esc(report.generated_by)}</span>
    <span>Shift ${esc(report.shift.id)} &middot; page 1</span>
  </div>
</section>`;
};

// ── Page 2: refunds ─────────────────────────────────────────────────────────

const refundsPage = (report: ZReport, lines: ReportRefundLine[]): string => {
  const byCurrency = new Map<string, number>();
  lines.forEach((l) =>
    byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0) + l.total_refund)
  );
  const body = lines
    .map(
      (l) => `<tr>
        <td class="mono">${esc(l.ticket_number ?? dash)}</td>
        <td class="mono">${esc(l.voyage_no ?? dash)}</td>
        <td class="name">${esc(l.passenger)}</td>
        <td>${esc(l.discount)}</td>
        <td class="n">${esc(money(l.total_fare, l.currency))}</td>
        <td class="n">${esc(less(l.surcharge, l.currency))}</td>
        <td class="n">${esc(money(l.no_show, l.currency))}</td>
        <td class="n b">${esc(money(l.total_refund, l.currency))}</td>
      </tr>`
    )
    .join("\n");

  const totals = [...byCurrency.entries()]
    .map(
      ([c, amount]) =>
        `<tr><td class="k">Total refunds (${esc(c)})</td><td class="n big">${esc(
          money(amount, c)
        )}</td></tr>`
    )
    .join("\n");

  return `
<section class="page">
  ${pageHead(report, "Refunds", `SHIFT OPENED: ${fmtDate(report.shift.opened_at)}`)}
  <table class="grid">
    <colgroup>
      <col style="width:13%"><col style="width:15%"><col style="width:19%">
      <col style="width:12%"><col style="width:11%"><col style="width:10%">
      <col style="width:8%"><col style="width:12%">
    </colgroup>
    <thead>
      <tr>
        <th>Ticket #</th>
        <th>Voyage #</th>
        <th>Passenger</th>
        <th>Discount</th>
        <th class="n">Total fare</th>
        <th class="n">Surcharge</th>
        <th class="n">No show</th>
        <th class="n">Total refund</th>
      </tr>
    </thead>
    <tbody>
${body || `<tr><td colspan="8" class="empty">No refunds on this shift.</td></tr>`}
    </tbody>
  </table>

  <table class="overall">
${totals || `<tr><td class="k">Total refunds</td><td class="n big">${esc(money(0, "PHP"))}</td></tr>`}
    <tr><td class="k">Total no-show</td><td class="n">${esc(money(0, "PHP"))}</td></tr>
  </table>
  ${clerkBlock(report, "Clerk in charge")}
  <div class="foot">
    <span>Printed ${esc(fmtStamp(report.generated_at))} by ${esc(report.generated_by)}</span>
    <span>Shift ${esc(report.shift.id)} &middot; refunds</span>
  </div>
</section>`;
};

// ── Page 3: cancellations ───────────────────────────────────────────────────

const cancelsPage = (report: ZReport, lines: ReportCancelLine[]): string => {
  const byCurrency = new Map<string, number>();
  lines.forEach((l) =>
    byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0) + l.total_fare)
  );
  const body = lines
    .map(
      (l) => `<tr>
        <td class="mono">${esc(l.ticket_number ?? dash)}</td>
        <td class="mono">${esc(l.voyage_no ?? dash)}</td>
        <td class="name">${esc(l.passenger)}</td>
        <td>${esc(fmtStamp(l.date_issued))}</td>
        <td>${esc(fmtStamp(l.date_cancelled))}</td>
        <td class="n b">${esc(money(l.total_fare, l.currency))}</td>
      </tr>`
    )
    .join("\n");

  const totals = [...byCurrency.entries()]
    .map(
      ([c, amount]) =>
        `<tr><td class="k">Total cancels (${esc(c)})</td><td class="n big">${esc(
          money(amount, c)
        )}</td></tr>`
    )
    .join("\n");

  return `
<section class="page">
  ${pageHead(report, "Cancelled Bookings", `SHIFT OPENED: ${fmtDate(report.shift.opened_at)}`)}
  <table class="grid">
    <colgroup>
      <col style="width:14%"><col style="width:16%"><col style="width:23%">
      <col style="width:18%"><col style="width:18%"><col style="width:11%">
    </colgroup>
    <thead>
      <tr>
        <th>Ticket #</th>
        <th>Voyage #</th>
        <th>Passenger</th>
        <th>Date issued</th>
        <th>Date cancelled</th>
        <th class="n">Total fare</th>
      </tr>
    </thead>
    <tbody>
${body || `<tr><td colspan="6" class="empty">No cancellations on this shift.</td></tr>`}
    </tbody>
  </table>

  <table class="overall">
${totals || `<tr><td class="k">Total cancels</td><td class="n big">${esc(money(0, "PHP"))}</td></tr>`}
  </table>
  ${clerkBlock(report, "Clerk in charge")}
  <div class="foot">
    <span>Printed ${esc(fmtStamp(report.generated_at))} by ${esc(report.generated_by)}</span>
    <span>Shift ${esc(report.shift.id)} &middot; cancellations</span>
  </div>
</section>`;
};

// ── Page 4: ticket sales ────────────────────────────────────────────────────

const salesPage = (report: ZReport, lines: ReportSaleLine[]): string => {
  const byCurrency = new Map<string, number>();
  lines.forEach((l) => byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0) + l.fare));
  const body = lines
    .map(
      (l) => `<tr>
        <td class="mono">${esc(l.ticket_number ?? dash)}</td>
        <td class="name">${esc(l.passenger)}</td>
        <td class="c">${esc(l.route_code)}</td>
        <td class="c">${esc(l.accommodation)}</td>
        <td>${esc(l.discount)}</td>
        <td class="n b">${esc(money(l.fare, l.currency))}</td>
      </tr>`
    )
    .join("\n");

  const totals = [...byCurrency.entries()]
    .map(
      ([c, amount]) =>
        `<tr><td class="k">Total ticket sales (${esc(c)})</td><td class="n big">${esc(
          money(amount, c)
        )}</td></tr>`
    )
    .join("\n");

  return `
<section class="page last">
  ${pageHead(report, "Ticket Sales", `SHIFT OPENED: ${fmtDate(report.shift.opened_at)}`)}
  <table class="grid">
    <colgroup>
      <col style="width:14%"><col style="width:34%"><col style="width:12%">
      <col style="width:12%"><col style="width:16%"><col style="width:12%">
    </colgroup>
    <thead>
      <tr>
        <th>Ticket #</th>
        <th>Passenger</th>
        <th class="c">Route</th>
        <th class="c">Accommo</th>
        <th>Discount</th>
        <th class="n">Fare</th>
      </tr>
    </thead>
    <tbody>
${body || `<tr><td colspan="6" class="empty">No tickets issued on this shift.</td></tr>`}
    </tbody>
  </table>

  <table class="overall">
${totals || `<tr><td class="k">Total ticket sales</td><td class="n big">${esc(money(0, "PHP"))}</td></tr>`}
  </table>
  ${clerkBlock(report, "Clerk in charge")}
  <div class="foot">
    <span>Printed ${esc(fmtStamp(report.generated_at))} by ${esc(report.generated_by)}</span>
    <span>Shift ${esc(report.shift.id)} &middot; ticket sales</span>
  </div>
</section>`;
};

/** The whole pack, as a standalone HTML document. */
export function zReportHtml(report: ZReport): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>End of day &mdash; shift ${esc(report.shift.id)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 11mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 8.5pt;
    color: #000;
    background: #fff;
  }
  /* Each document in the pack starts its own sheet. The last one must not, or
     browsers emit a trailing blank page. */
  section.page { page-break-after: always; break-after: page; }
  section.page.last { page-break-after: auto; break-after: auto; }
  .issuer { text-align: center; line-height: 1.3; }
  .issuer .name { font-size: 12pt; font-weight: 700; letter-spacing: .04em; }
  .issuer .meta { font-size: 7.5pt; }
  h1 {
    font-size: 12.5pt;
    letter-spacing: .16em;
    text-transform: uppercase;
    text-align: center;
    margin: 7px 0 0;
    padding: 4px 0;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
  }
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: 4mm;
    font-size: 7.5pt;
    padding: 3px 0 6px;
    border-bottom: .5pt solid #999;
    margin-bottom: 7px;
  }
  .reading {
    text-align: center;
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: .1em;
    border: 1.5pt solid #000;
    padding: 3px;
    margin-bottom: 7px;
    background: #e8e8e8;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h2 {
    font-size: 9pt;
    letter-spacing: .1em;
    text-transform: uppercase;
    margin: 11px 0 4px;
    padding-bottom: 2px;
    border-bottom: 1pt solid #000;
  }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.meta td { padding: 1.5px 4px; vertical-align: top; }
  table.meta .k {
    font-size: 7pt;
    letter-spacing: .08em;
    color: #333;
    text-transform: uppercase;
    width: 30mm;
  }
  table.meta .v { font-weight: 700; font-size: 9pt; }
  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.grid th, table.grid td {
    border: .5pt solid #666;
    padding: 2.4px 4px;
    text-align: left;
    overflow-wrap: anywhere;
  }
  table.grid th {
    font-size: 6.8pt;
    letter-spacing: .03em;
    text-transform: uppercase;
    background: #e8e8e8;
    /* Keep the grey when the browser is set to skip backgrounds, otherwise the
       header row is indistinguishable from the data on a mono printer. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  table.grid tfoot td {
    font-weight: 700;
    border-top: 1.2pt solid #000;
    background: #f4f4f4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* The ticket-sales list runs to several sheets, so its headings repeat. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  /* Money is compared down the column, so it is right-aligned and tabular —
     proportional digits make two figures of the same magnitude look different
     lengths. */
  .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .name { font-weight: 600; }
  /* A station serial is its prefix plus an unpadded number — "BLVD7947125",
     four characters longer than the bare number the operator's form was ruled
     for — so the monospace runs a size down to keep it on one line. A wrapped
     serial doubles the height of every row on a 100-line page. */
  .mono { font-family: "Courier New", monospace; font-size: 7pt; letter-spacing: -.01em; }
  td.empty { text-align: center; font-style: italic; color: #444; }
  table.overall { border-collapse: collapse; margin: 7px 0 0 auto; min-width: 78mm; }
  table.overall td { padding: 2.5px 6px; }
  table.overall .k {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: .06em;
  }
  table.overall .big { font-size: 11pt; font-weight: 700; }
  table.overall tr.net td {
    border-top: 1pt solid #000;
    border-bottom: 2.5pt double #000;
    font-weight: 700;
  }
  .notes {
    border: 1px solid #000;
    padding: 4px 6px;
    font-size: 8.5pt;
    white-space: pre-wrap;
  }
  .sign { margin-top: 11mm; width: 100%; border-collapse: collapse; }
  .sign td { width: 50%; padding-right: 10mm; vertical-align: bottom; }
  .sign .cap {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #333;
  }
  .sign .rule {
    border-bottom: .8pt solid #000;
    height: 11mm;
    font-size: 8.5pt;
    padding-top: 8mm;
  }
  .foot {
    margin-top: 6px;
    font-size: 7pt;
    color: #333;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
${summaryPage(report)}
${refundsPage(report, report.refunds_detail ?? [])}
${cancelsPage(report, report.cancels_detail ?? [])}
${salesPage(report, report.sales_detail ?? [])}
</body>
</html>`;
}

export interface ZReportPrintResult {
  ok: boolean;
  error?: string;
}

/**
 * Hand the pack to the browser's print dialog.
 *
 * Printed from a hidden iframe rather than a popup window: `window.open` is
 * what pop-up blockers stop, and a blocked report looks to the cashier like a
 * printer that silently did nothing. The frame is torn down once printing
 * returns, with a timer behind it for the browsers that never fire afterprint.
 */
export function printZReport(report: ZReport): ZReportPrintResult {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return {
      ok: false,
      error: "Report printing is available in the browser at the counter.",
    };
  }
  try {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.visibility = "hidden";
    document.body.appendChild(frame);

    const remove = () => {
      // Guard the double call: afterprint and the fallback timer can both land.
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    };

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        remove();
        return;
      }
      win.onafterprint = () => setTimeout(remove, 0);
      win.focus();
      win.print();
      // Chrome resolves print() before the dialog closes on some platforms, so
      // afterprint is the primary path and this only cleans up after a browser
      // that never fires it.
      setTimeout(remove, 60000);
    };

    // srcdoc keeps the document on this origin without a second network round
    // trip, so the print dialog opens on the click that asked for it.
    frame.srcdoc = zReportHtml(report);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "The browser would not open a print dialog." };
  }
}
