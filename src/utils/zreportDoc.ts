/**
 * The cashier's end-of-day sales report, as an A4 document printed through the
 * browser.
 *
 * Same reasoning as the manifest (see manifestDoc.ts): this is a tabular
 * document that gets signed, filed with the drawer count and read again months
 * later by whoever reconciles the day. A tender breakdown is a grid — tender
 * against gross, refunds, voids and net — and a grid does not survive being
 * folded into 48 columns of 80mm roll. It also has to sit in a folder with the
 * manifest for the same day, which settles the paper size on its own.
 *
 * Every figure carries its currency and nothing is summed across currencies:
 * PHP and MYR do not convert, so a drawer holding both reconciles as two
 * independent blocks, exactly as the Till tab does it.
 *
 * Web only. The counter runs this app in a browser (see nginx.conf and the
 * print agent's reason for existing); a native build has no `window.print`, so
 * the screen offers the on-screen report instead of pretending to print.
 */

import { Platform } from "react-native";
import { money } from "@/utils/currency";
import { ISSUER } from "@/utils/ticketDoc";
import { ZReport } from "@/types/reports";

/** Notes and agent names are free text, so everything is escaped before it
 *  reaches the document — a till note with an "&" would otherwise break the
 *  markup it lands in. */
const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const dash = "—";

/** Server timestamps on a report are Manila wall clocks emitted without an
 *  offset, so the runtime parses them as local time — which at the counter is
 *  the same thing. */
const formatStamp = (iso: string | null): string => {
  if (!iso) return dash;
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

const shortStamp = (iso: string | null): string => {
  if (!iso) return dash;
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
const signed = (n: number, currency: string): string =>
  `${n < 0 ? "-" : n > 0 ? "+" : ""}${money(Math.abs(n), currency)}`;

/** A deduction is only worth a line when there is one; an empty cell reads
 *  faster than a column of zeroes. */
const less = (n: number, currency: string): string =>
  n > 0 ? `-${money(n, currency)}` : dash;

/** The whole document, as a standalone HTML string. */
export function zReportHtml(report: ZReport): string {
  const closed = report.shift.status === "closed";

  const salesBlocks = report.totals
    .map((t) => {
      const tenderRows = t.tenders
        .map(
          (tender) => `<tr>
        <td class="lbl">${esc(tender.label)}</td>
        <td class="c">${tender.bookings}</td>
        <td class="n">${esc(money(tender.gross, t.currency))}</td>
        <td class="n neg">${esc(less(tender.refunded, t.currency))}</td>
        <td class="n neg">${esc(less(tender.cancelled, t.currency))}</td>
        <td class="n b">${esc(money(tender.net, t.currency))}</td>
      </tr>`
        )
        .join("\n");

      const types = Object.entries(t.by_passenger_type);
      const typeLine = types.length
        ? types
            .map(([type, count]) => `${esc(type)} <b>${count}</b>`)
            .join(" &nbsp;·&nbsp; ")
        : dash;

      return `
  <h2>Sales &mdash; ${esc(t.currency)}</h2>
  <table class="grid tender">
    <colgroup>
      <col style="width:22%"><col style="width:10%"><col style="width:17%">
      <col style="width:17%"><col style="width:17%"><col style="width:17%">
    </colgroup>
    <thead>
      <tr>
        <th>Tender</th>
        <th class="c">Sales</th>
        <th class="n">Gross</th>
        <th class="n">Refunds</th>
        <th class="n">Voids</th>
        <th class="n">Net</th>
      </tr>
    </thead>
    <tbody>
${tenderRows || `<tr><td colspan="6">No sales taken on this shift.</td></tr>`}
    </tbody>
    <tfoot>
      <tr>
        <td class="lbl">TOTAL</td>
        <td class="c">${t.bookings}</td>
        <td class="n">${esc(money(t.gross, t.currency))}</td>
        <td class="n neg">${esc(less(t.refunded, t.currency))}</td>
        <td class="n neg">${esc(less(t.cancelled, t.currency))}</td>
        <td class="n">${esc(money(t.net, t.currency))}</td>
      </tr>
    </tfoot>
  </table>

  <div class="split">
    <!-- The operator's daily summary reads in exactly these four lines, so the
         report answers it in the same words and the same order. -->
    <table class="summary">
      <tr><td class="k">Ticket sales</td><td class="n">${esc(money(t.gross, t.currency))}</td></tr>
      <tr><td class="k">Less cancels</td><td class="n neg">${esc(less(t.cancelled, t.currency))}</td></tr>
      <tr><td class="k">Less refunds</td><td class="n neg">${esc(less(t.refunded, t.currency))}</td></tr>
      <tr class="net"><td class="k">NET SALES</td><td class="n">${esc(money(t.net, t.currency))}</td></tr>
    </table>
    <div class="pax">
      <div class="cap">Passengers ticketed</div>
      <div class="big">${t.tickets}</div>
      <div class="types">${typeLine}</div>
    </div>
  </div>`;
    })
    .join("\n");

  const drawerRows = report.drawer
    .map(
      (d) => `<tr>
        <td class="lbl">${esc(d.currency)}</td>
        <td class="n">${esc(money(d.opening_float, d.currency))}</td>
        <td class="n">${esc(money(d.cash_sales, d.currency))}</td>
        <td class="n neg">${esc(less(d.cash_payouts, d.currency))}</td>
        <td class="n b">${esc(money(d.expected_cash, d.currency))}</td>
        <td class="n">${d.counted_cash === null ? dash : esc(money(d.counted_cash, d.currency))}</td>
        <td class="n b">${
          d.counted_cash === null ? dash : esc(signed(d.variance ?? 0, d.currency))
        }</td>
      </tr>`
    )
    .join("\n");

  const voyageRows = report.voyages
    .map(
      (v) => `<tr>
        <td>${esc(v.vessel)}</td>
        <td>${esc(v.route)}</td>
        <td>${esc(shortStamp(v.scheduled_departure))}</td>
        <td class="c">${v.passengers}</td>
        <td class="n">${v.amounts
          .map((a) => esc(money(a.amount, a.currency)))
          .join("<br>")}</td>
      </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>End of day &mdash; shift ${esc(report.shift.id)}</title>
<style>
  /* Portrait A4. Wider margins than the manifest: this document has no table
     fighting for the full width, and it is filed in a folder that punches. */
  @page { size: A4 portrait; margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    color: #000;
    background: #fff;
  }
  .issuer { text-align: center; line-height: 1.35; }
  .issuer .name { font-size: 12pt; font-weight: 700; letter-spacing: .04em; }
  .issuer .meta { font-size: 7.5pt; }
  h1 {
    font-size: 13pt;
    letter-spacing: .18em;
    text-align: center;
    margin: 8px 0 4px;
    padding: 4px 0;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
  }
  /* An open shift can be read mid-day, but it must never be mistaken for the
     closing document that gets filed with the cash — so the distinction is a
     banner rather than a footnote. */
  .reading {
    text-align: center;
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: .12em;
    border: 1.5pt solid #000;
    padding: 3px;
    margin-bottom: 8px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    background: #e8e8e8;
  }
  .zline {
    text-align: center;
    font-size: 8pt;
    letter-spacing: .12em;
    margin-bottom: 8px;
  }
  h2 {
    font-size: 9.5pt;
    letter-spacing: .1em;
    text-transform: uppercase;
    margin: 12px 0 4px;
    padding-bottom: 2px;
    border-bottom: 1pt solid #000;
  }
  table.meta { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  table.meta td { padding: 2px 4px; vertical-align: top; }
  table.meta .k {
    font-size: 7pt;
    letter-spacing: .09em;
    color: #333;
    text-transform: uppercase;
    width: 24mm;
  }
  table.meta .v { font-weight: 700; font-size: 9.5pt; }
  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.grid th, table.grid td {
    border: .5pt solid #666;
    padding: 3px 5px;
    text-align: left;
    overflow-wrap: anywhere;
  }
  table.grid th {
    font-size: 7pt;
    letter-spacing: .04em;
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
  tr { page-break-inside: avoid; break-inside: avoid; }
  /* Money is compared down the column, so it is right-aligned and tabular —
     proportional digits make two figures of the same magnitude look different
     lengths. */
  .n {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .lbl { font-weight: 600; }
  .neg { color: #000; }
  .split {
    display: flex;
    gap: 8mm;
    align-items: flex-start;
    margin-top: 6px;
  }
  table.summary { border-collapse: collapse; width: 62%; }
  table.summary td { padding: 2.5px 5px; }
  table.summary .k {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: .06em;
  }
  table.summary tr.net td {
    border-top: 1pt solid #000;
    border-bottom: 2.5pt double #000;
    font-weight: 700;
    font-size: 11pt;
    padding-top: 4px;
  }
  .pax { flex: 1; border: 1px solid #000; padding: 4px 6px; }
  .pax .cap {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #333;
  }
  .pax .big { font-size: 15pt; font-weight: 700; line-height: 1.1; }
  .pax .types { font-size: 7.5pt; margin-top: 2px; }
  .serials { display: flex; gap: 6mm; }
  .serials .box {
    border: 1px solid #000;
    padding: 4px 8px;
    min-width: 34mm;
  }
  .serials .cap {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #333;
  }
  .serials .val {
    font-family: "Courier New", monospace;
    font-size: 11pt;
    font-weight: 700;
  }
  .notes {
    border: 1px solid #000;
    padding: 4px 6px;
    font-size: 8.5pt;
    white-space: pre-wrap;
  }
  .sign { margin-top: 12mm; width: 100%; border-collapse: collapse; }
  .sign td { width: 50%; padding-right: 10mm; vertical-align: bottom; }
  .sign .rule { border-bottom: .8pt solid #000; height: 12mm; }
  .sign .cap {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: .08em;
    padding-top: 3px;
  }
  .foot {
    margin-top: 8px;
    font-size: 7pt;
    color: #333;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="issuer">
    <div class="name">${esc(ISSUER.name)}</div>
    <div class="meta">${esc(ISSUER.address)}</div>
    <div class="meta">${esc(ISSUER.tin)}</div>
  </div>
  <h1>END OF DAY SALES</h1>
  ${
    closed
      ? `<div class="zline">Z-REPORT</div>`
      : `<div class="reading">X-READING &mdash; SHIFT STILL OPEN</div>`
  }

  <table class="meta">
    <tr>
      <td class="k">Cashier</td><td class="v">${esc(report.agent.name)}</td>
      <td class="k">Shift no.</td><td class="v">#${esc(report.shift.id)}</td>
    </tr>
    <tr>
      <td class="k">Station</td>
      <td class="v">${esc(report.agent.ticket_station || "UNASSIGNED")}</td>
      <td class="k">Opened</td>
      <td class="v">${esc(formatStamp(report.shift.opened_at))}</td>
    </tr>
    <tr>
      <td class="k">Printed</td>
      <td class="v">${esc(formatStamp(report.generated_at))}</td>
      <td class="k">Closed</td>
      <td class="v">${closed ? esc(formatStamp(report.shift.closed_at)) : "&mdash; still open &mdash;"}</td>
    </tr>
  </table>
${
  report.totals.length === 0
    ? `\n  <h2>Sales</h2>\n  <div class="notes">No sales were taken on this shift.</div>`
    : salesBlocks
}

  <h2>Cash drawer</h2>
  <table class="grid">
    <colgroup>
      <col style="width:10%"><col style="width:15%"><col style="width:15%">
      <col style="width:15%"><col style="width:15%"><col style="width:15%">
      <col style="width:15%">
    </colgroup>
    <thead>
      <tr>
        <th>Curr.</th>
        <th class="n">Opening float</th>
        <th class="n">Cash sales</th>
        <th class="n">Paid out</th>
        <th class="n">Expected</th>
        <th class="n">Counted</th>
        <th class="n">Variance</th>
      </tr>
    </thead>
    <tbody>
${drawerRows || `<tr><td colspan="7">No drawer was opened for this shift.</td></tr>`}
    </tbody>
  </table>
  ${
    report.drawer.some((d) => d.counted_cash === null)
      ? `<div class="foot"><span>Not yet counted &mdash; close the till to reconcile.</span><span></span></div>`
      : ""
  }

  <h2>Tickets issued</h2>
  <!-- The serial range belongs on a Z-report: it is what the day's return is
       reconciled against, and a break in it is what an audit looks for. -->
  <div class="serials">
    <div class="box"><div class="cap">Count</div><div class="val">${report.tickets_issued}</div></div>
    <div class="box"><div class="cap">First serial</div><div class="val">${esc(
      report.serial_from ?? dash
    )}</div></div>
    <div class="box"><div class="cap">Last serial</div><div class="val">${esc(
      report.serial_to ?? dash
    )}</div></div>
  </div>
${
  report.voyages.length === 0
    ? ""
    : `
  <h2>Sailings sold</h2>
  <table class="grid">
    <colgroup>
      <col style="width:24%"><col style="width:34%"><col style="width:18%">
      <col style="width:8%"><col style="width:16%">
    </colgroup>
    <thead>
      <tr>
        <th>Vessel</th>
        <th>Route</th>
        <th>Departure</th>
        <th class="c">Pax</th>
        <th class="n">Amount</th>
      </tr>
    </thead>
    <tbody>
${voyageRows}
    </tbody>
  </table>`
}
${
  report.shift.notes
    ? `\n  <h2>Till notes</h2>\n  <div class="notes">${esc(report.shift.notes)}</div>`
    : ""
}

  <table class="sign">
    <tr>
      <td><div class="rule"></div><div class="cap">Cashier</div></td>
      <td><div class="rule"></div><div class="cap">Verified by</div></td>
    </tr>
  </table>

  <div class="foot">
    <span>Printed ${esc(formatStamp(report.generated_at))} by ${esc(report.generated_by)}</span>
    <span>Shift ${esc(report.shift.id)}</span>
  </div>
</body>
</html>`;
}

export interface ZReportPrintResult {
  ok: boolean;
  error?: string;
}

/**
 * Hand the document to the browser's print dialog.
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
