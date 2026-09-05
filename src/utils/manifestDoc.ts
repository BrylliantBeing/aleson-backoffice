/**
 * The sailing's passenger manifest, as an A4 document printed through the
 * browser.
 *
 * Deliberately NOT an ESC/POS job like the ticket and the Z-report. A manifest
 * is a tabular document of a hundred-odd rows that is handed to the vessel and
 * to the port, and 48 columns of 80mm roll cannot carry name, age, sex,
 * nationality, class, seat and serial on one line. So this renders real HTML,
 * paginated by the browser onto whatever office printer the counter already
 * has, with the column headers repeating on every sheet.
 *
 * Web only. The counter runs this app in a browser (see nginx.conf and the
 * print agent's reason for existing); a native build has no `window.print`, so
 * the screen offers the on-screen manifest instead of pretending to print.
 */

import { Platform } from "react-native";
import { Manifest } from "@/types/reports";
import { seatNumberLabel } from "@/utils/seatLabel";
import { ISSUER } from "@/utils/ticketDoc";

/** Values come from passenger records, so every one of them is escaped before
 *  it reaches the document — a name with an "&" or a "<" would otherwise break
 *  the markup it lands in. */
const esc = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const dash = "—";

const formatDeparture = (iso: string | null): string => {
  if (!iso) return dash;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-PH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

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

const formatTime = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

/** "M" / "F" — a manifest column is one character wide. */
const sexLetter = (gender: string | null): string => {
  const g = (gender ?? "").trim().toLowerCase();
  if (g.startsWith("m")) return "M";
  if (g.startsWith("f")) return "F";
  return g ? "X" : dash;
};

/** The whole document, as a standalone HTML string. */
export function manifestHtml(manifest: Manifest): string {
  // Boarding scans only exist once the gate has worked the sailing, so the
  // column is dropped for the copy printed before departure — which is the one
  // that actually goes aboard.
  const showBoarded = manifest.boarded > 0;
  // Kept in one place: the two full-width rows (the running identity line and
  // the empty-sailing row) have to span whatever the passenger table currently
  // has, and a stale colspan misaligns the whole grid.
  const columns = showBoarded ? 12 : 11;
  // Column widths are declared rather than left to the browser. Auto-layout
  // hands the widest content the most room, which gave Contact a luxurious
  // column while squeezing Nationality and Ref until five-character codes
  // wrapped onto two lines and every row went double-height. Percentages of the
  // printable width, in the column order below; they must sum to 100.
  const widths = showBoarded
    ? [3, 22, 3.5, 3.5, 9.5, 7, 8, 4.5, 10, 13, 7, 9]
    : [3, 27, 3.5, 3.5, 9.5, 7.5, 8.5, 5, 10.5, 14, 8];
  const colgroup = `<colgroup>${widths
    .map((w) => `<col style="width:${w}%">`)
    .join("")}</colgroup>`;
  const voyage = `${esc(manifest.origin_code || manifest.origin)}-${esc(
    manifest.destination_code || manifest.destination
  )}`;

  const rows = manifest.passengers
    .map((p, i) => {
      const boardedCell = showBoarded
        ? `<td class="c">${p.boarded_at ? esc(formatTime(p.boarded_at)) : `<span class="miss">NO SHOW</span>`}</td>`
        : "";
      return `<tr>
        <td class="c num">${i + 1}</td>
        <td class="name">${esc(p.passenger_name)}</td>
        <td class="c">${p.age ?? dash}</td>
        <td class="c">${esc(sexLetter(p.gender))}</td>
        <td>${esc(p.nationality || dash)}</td>
        <td>${esc(p.passenger_type)}</td>
        <td>${esc(p.accommodation_class)}</td>
        <!-- The number painted on the ship, not the seat_map identity: a
             prefixed "ECO-42" would send someone hunting for a seat that has
             no such marking aboard. -->
        <td class="c">${esc(seatNumberLabel(p.seat_number))}</td>
        <td class="mono">${esc(p.ticket_number || dash)}</td>
        <td class="mono contact${(p.contact ?? "").includes("@") ? " email" : ""}">${esc(
          p.contact || dash
        )}</td>
        <td class="mono">${esc(p.booking_reference)}</td>
        ${boardedCell}
      </tr>`;
    })
    .join("\n");

  const classSummary = manifest.by_class
    .map((c) => `${esc(c.accommodation_class)} <b>${c.passengers}</b>`)
    .join(" &nbsp;·&nbsp; ");
  const genderSummary = manifest.by_gender
    .map((g) => `${esc(g.gender)} <b>${g.passengers}</b>`)
    .join(" &nbsp;·&nbsp; ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Manifest ${voyage} ${esc(manifest.trip_id)}</title>
<style>
  /* Portrait A4 with a narrow margin: the table needs the width, and the
     browser's own print header carries the page numbers. */
  @page { size: A4 portrait; margin: 11mm 9mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 8.5pt;
    color: #000;
    background: #fff;
  }
  .sheet { padding: 0; }
  .issuer { text-align: center; line-height: 1.35; }
  .issuer .name { font-size: 12pt; font-weight: 700; letter-spacing: .04em; }
  .issuer .meta { font-size: 7.5pt; }
  h1 {
    font-size: 13pt;
    letter-spacing: .18em;
    text-align: center;
    margin: 7px 0 4px;
    padding: 4px 0;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
  }
  .voyage {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6px;
  }
  .voyage td { padding: 2px 4px; vertical-align: top; }
  .voyage .k {
    font-size: 7pt;
    letter-spacing: .09em;
    color: #333;
    text-transform: uppercase;
    width: 22mm;
  }
  .voyage .v { font-weight: 700; font-size: 9.5pt; }
  .tally {
    border: 1px solid #000;
    padding: 4px 6px;
    margin-bottom: 6px;
    font-size: 8pt;
    line-height: 1.5;
  }
  .tally .total { font-size: 10pt; font-weight: 700; }
  /* Fixed layout so the declared column widths are honoured exactly, rather
     than being renegotiated around whatever the longest cell happens to be. */
  table.pax { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.pax th, table.pax td {
    border: .5pt solid #666;
    padding: 2.2px 3px;
    text-align: left;
    /* A long foreign name must wrap inside its cell rather than push the
       table wider than the sheet. */
    overflow-wrap: anywhere;
  }
  table.pax th {
    /* Sized so the longest heading ("NATIONALITY") sits on one line inside its
       declared column — a wrapped heading makes the repeating header row three
       lines deep on every sheet. */
    font-size: 6.5pt;
    letter-spacing: .02em;
    text-transform: uppercase;
    background: #e8e8e8;
    /* Keep the grey when the browser is set to skip backgrounds, otherwise the
       header row is indistinguishable from the data on a mono printer. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Repeat the column headings — and the sailing's identity above them — on
     every sheet, so a page separated from the set is still readable. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .runner th {
    background: #fff;
    text-transform: none;
    letter-spacing: 0;
    font-size: 7.5pt;
    border: none;
    border-bottom: 1.5pt solid #000;
    padding: 3px 0 2px;
  }
  td.c { text-align: center; }
  td.num { color: #444; }
  td.name { font-weight: 600; }
  td.mono { font-family: "Courier New", monospace; font-size: 7.5pt; }
  /* A phone number is the thing someone reads aloud off this sheet, so it must
     not be broken across two lines. An email address may wrap — it is the
     fallback, and only appears when no number was captured. */
  td.contact { white-space: nowrap; }
  td.contact.email { white-space: normal; overflow-wrap: anywhere; }
  .miss { font-weight: 700; }
  .sign { margin-top: 14mm; width: 100%; border-collapse: collapse; }
  .sign td { width: 33%; padding-right: 8mm; vertical-align: bottom; }
  .sign .rule { border-bottom: .8pt solid #000; height: 12mm; }
  .sign .cap {
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: .08em;
    padding-top: 3px;
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
<div class="sheet">
  <div class="issuer">
    <div class="name">${esc(ISSUER.name)}</div>
    <div class="meta">${esc(ISSUER.address)}</div>
  </div>
  <h1>PASSENGER MANIFEST</h1>

  <table class="voyage">
    <tr>
      <td class="k">Vessel</td><td class="v">${esc(manifest.vessel)}</td>
      <td class="k">Voyage</td><td class="v">${voyage} / ${esc(manifest.trip_id)}</td>
    </tr>
    <tr>
      <td class="k">Route</td><td class="v">${esc(manifest.origin)} &rarr; ${esc(manifest.destination)}</td>
      <td class="k">Departure</td><td class="v">${esc(formatDeparture(manifest.scheduled_departure))}</td>
    </tr>
  </table>

  <div class="tally">
    <span class="total">TOTAL PASSENGERS: ${manifest.total}</span>
    &nbsp;&nbsp;(minors under 18: <b>${manifest.minors}</b>)<br>
    By class: ${classSummary || dash}<br>
    By sex: ${genderSummary || dash}${
      showBoarded
        ? `<br>Boarded at gate: <b>${manifest.boarded}</b> of ${manifest.total}` +
          ` &nbsp;·&nbsp; not scanned: <b>${manifest.total - manifest.boarded}</b>`
        : ""
    }
  </div>

  <table class="pax">
    ${colgroup}
    <thead>
      <tr class="runner">
        <th colspan="${columns}">
          ${esc(manifest.vessel)} &nbsp;·&nbsp; ${esc(manifest.origin)} &rarr; ${esc(
            manifest.destination
          )} &nbsp;·&nbsp; ${esc(formatDeparture(manifest.scheduled_departure))}
          &nbsp;·&nbsp; ${manifest.total} passengers
        </th>
      </tr>
      <tr>
        <th>#</th>
        <th>Passenger name</th>
        <th>Age</th>
        <th>Sex</th>
        <th>Nationality</th>
        <th>Type</th>
        <th>Class</th>
        <th>Seat</th>
        <th>Ticket no.</th>
        <th>Contact</th>
        <th>Ref</th>
        ${showBoarded ? "<th>Boarded</th>" : ""}
      </tr>
    </thead>
    <tbody>
${rows || `<tr><td colspan="${columns}">No passengers booked on this sailing.</td></tr>`}
    </tbody>
  </table>

  <table class="sign">
    <tr>
      <td><div class="rule"></div><div class="cap">Prepared by (ticketing)</div></td>
      <td><div class="rule"></div><div class="cap">Vessel master</div></td>
      <td><div class="rule"></div><div class="cap">Port / Coast Guard</div></td>
    </tr>
  </table>

  <div class="foot">
    <span>Printed ${esc(formatStamp(manifest.generated_at))} by ${esc(manifest.generated_by)}</span>
    <span>Trip ${esc(manifest.trip_id)}</span>
  </div>
</div>
</body>
</html>`;
}

export interface ManifestPrintResult {
  ok: boolean;
  error?: string;
}

/**
 * Hand the document to the browser's print dialog.
 *
 * Printed from a hidden iframe rather than a popup window: `window.open` is
 * what pop-up blockers stop, and a blocked manifest looks to the cashier like
 * a printer that silently did nothing. The frame is torn down once printing
 * returns, with a timer behind it for the browsers that never fire afterprint.
 */
export function printManifest(manifest: Manifest): ManifestPrintResult {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return {
      ok: false,
      error: "Manifest printing is available in the browser at the counter.",
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
    frame.srcdoc = manifestHtml(manifest);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "The browser would not open a print dialog." };
  }
}
