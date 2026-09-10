/**
 * The sailing's passenger manifest, as an A4 document printed through the
 * browser.
 *
 * Laid out to match the form the operator has always filed — the one the ALESON
 * Ticketing System v2 printed, reproduced here field for field: the letterhead,
 * the ROUTE / VOYAGE DATE / VOYAGE NO / STATION block, the "List of all
 * passengers on board the vessel …" sentence, the eight columns, and the
 * Republic of the Philippines attestation the master swears to and the port
 * countersigns. This sheet is handed to the coast guard, so its shape is not
 * ours to improve on; anything this system knows that the form has no box for
 * stays on the Reports screen rather than being added as a column.
 *
 * Deliberately NOT an ESC/POS job like the ticket and the Z-report. A manifest
 * is a tabular document of a hundred-odd rows, and 48 columns of 80mm roll
 * cannot carry name, age, sex, class, seat and serial on one line. So this
 * renders real HTML, paginated by the browser onto whatever office printer the
 * counter already has, with the column headers repeating on every sheet.
 *
 * Web only. The counter runs this app in a browser (see nginx.conf and the
 * print agent's reason for existing); a native build has no `window.print`, so
 * the screen offers the on-screen manifest instead of pretending to print.
 */

import { Platform } from "react-native";
import { Manifest, ManifestPassenger } from "@/types/reports";
import { seatNumberLabel } from "@/utils/seatLabel";
import { MANIFEST_MARK } from "@/utils/manifestMark";
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

/**
 * "07/09/2026 5:00:00 pm" — the operator's voyage-date format, day first.
 *
 * Read straight off the stored string rather than through a Date. A
 * scheduled_departure is naive Asia/Manila wall-clock time, so putting it
 * through the browser's locale machinery makes the printed hour depend on where
 * the machine thinks it is — and this sheet is sworn to. The characters the
 * server sent are the sailing time; they are simply re-punctuated here.
 */
const formatVoyageDate = (iso: string | null): string => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm, ss] = m;
  const hour24 = Number(hh);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = hour24 < 12 ? "am" : "pm";
  return `${d}/${mo}/${y} ${hour12}:${mm}:${ss ?? "00"} ${period}`;
};

const formatStamp = (iso: string | null): string => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d, hh, mm] = m;
  return `${d}/${mo}/${y} ${hh}:${mm}`;
};

/** "M" / "F" — a manifest sex column is one character wide. */
const sexLetter = (gender: string | null): string => {
  const g = (gender ?? "").trim().toLowerCase();
  if (g.startsWith("m")) return "M";
  if (g.startsWith("f")) return "F";
  return g ? "X" : "";
};

/**
 * "B-A2 62" — the class the berth belongs to and the number painted beside it.
 *
 * The seat's own bare number, not its seat_map identity: a prefixed "ECO-42"
 * would send someone hunting for a marking that does not exist aboard, and the
 * class is already stated by the first half of this cell.
 */
const cotNumber = (p: ManifestPassenger): string => {
  const cls = (p.class_code || p.accommodation_class || "").trim();
  const seat = seatNumberLabel(p.seat_number) ?? "";
  return [cls, seat].filter(Boolean).join(" ");
};

/**
 * The PASSPORT column, which means the travel document specifically.
 *
 * A PhilSys card or a driving licence is a valid ID to sell a domestic ticket
 * against but it is not a passport, and writing its number in this column would
 * tell an immigration officer on the Sandakan run that a passenger holds a
 * document they have never shown. Only a passport fills the box; everyone else
 * leaves it empty, exactly as the form has always come out.
 */
const passportNumber = (p: ManifestPassenger): string =>
  /passport/i.test(p.id_type ?? "") ? (p.id_number ?? "").trim() : "";

/**
 * The name as the form carries it: "SURNAME, Given -(09171234567)".
 *
 * The contact rides inside the name cell rather than in a column of its own
 * because the form has no column for it — which is why the old typed manifests
 * jammed the number in after the name in the first place. It is held per
 * booking, so a family travelling on one reference all show the same number,
 * and that is the number to ring about any of them.
 */
const nameCell = (p: ManifestPassenger): string => {
  const contact = (p.contact ?? "").trim();
  return contact
    ? `${esc(p.passenger_name)} <span class="ct">-(${esc(contact)})</span>`
    : esc(p.passenger_name);
};

/** The whole document, as a standalone HTML string. */
export function manifestHtml(manifest: Manifest): string {
  // Column widths are declared rather than left to the browser. Auto-layout
  // hands the widest content the most room, which starves the fixed-width
  // columns until a five-character code wraps onto two lines and every row goes
  // double-height. Percentages of the printable width, in the column order
  // below; they must sum to 100.
  const widths = [4, 12, 11, 39, 5, 5, 12, 12];
  const colgroup = `<colgroup>${widths
    .map((w) => `<col style="width:${w}%">`)
    .join("")}</colgroup>`;

  const route = `${esc(manifest.origin_code || manifest.origin)}-${esc(
    manifest.destination_code || manifest.destination
  )}`;

  const rows = manifest.passengers
    .map(
      (p, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td>${esc(cotNumber(p))}</td>
        <td>${esc(p.ticket_number || "")}</td>
        <td class="name">${nameCell(p)}</td>
        <td class="c">${p.age ?? ""}</td>
        <td class="c">${esc(sexLetter(p.gender))}</td>
        <td>${esc(passportNumber(p))}</td>
        <!-- Residence is a box on the form this system has never captured, so
             it prints empty for the pier to fill in by hand rather than being
             guessed at from the destination. -->
        <td></td>
      </tr>`
    )
    .join("\n");

  // Free passes are named individually rather than merely counted, and they are
  // listed under the tally rather than given a column: the form's eight columns
  // are the form, and a ninth would squeeze every row on every sailing for
  // something almost none of them carry. This line is the only place the
  // printed manifest ties a free ride to the shipment that earned it — the pair
  // is what a supervisor checks against the RO/RO paperwork, so both halves
  // have to be on the paper.
  const freePasses = manifest.passengers.filter((p) => p.cargo_reference);
  const freePassLine = freePasses.length
    ? `<div class="note">Free passes (RO/RO cargo): <b>${freePasses.length}</b> &nbsp;·&nbsp; ${freePasses
        .map((p) => `${esc(p.passenger_name)} (${esc(p.cargo_reference ?? "")})`)
        .join(" &nbsp;·&nbsp; ")}</div>`
    : "";
  // Only once the gate has actually worked the sailing. The copy printed before
  // departure — the one that goes aboard — has nothing to say here.
  const boardedLine =
    manifest.boarded > 0
      ? `<div class="note">Boarded at gate: <b>${manifest.boarded}</b> of ${manifest.total}
         &nbsp;·&nbsp; not scanned: <b>${manifest.total - manifest.boarded}</b></div>`
      : "";

  /** A form field: the caption, then the value sitting on a ruled line. */
  const field = (label: string, value: string, ruleWidth: string) =>
    `<td class="k">${label}</td><td class="v" style="width:${ruleWidth}"><span>${
      value || "&nbsp;"
    }</span></td>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Manifest ${route} ${esc(manifest.voyage_no || manifest.trip_id)}</title>
<style>
  /* Portrait A4: the table needs the width, and the browser's own print footer
     carries the page numbers the old form printed at the foot of each sheet. */
  @page { size: A4 portrait; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    font-size: 9pt;
    color: #000;
    background: #fff;
  }

  /* ── Letterhead ───────────────────────────────────────────────────────── */
  .head { text-align: center; margin-bottom: 10px; }
  .head .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    text-align: left;
  }
  .head .mark { width: 15mm; height: auto; }
  .head .name { font-size: 19pt; font-weight: 700; letter-spacing: .01em; }
  .head .addr { font-size: 9pt; margin-top: 1px; }
  .head .doc { font-size: 10pt; font-weight: 700; margin-top: 2px; }

  /* ── Voyage identity block ────────────────────────────────────────────── */
  /* Captions and ruled values, laid out as the pre-printed form has them:
     ROUTE / VOYAGE NO on the first line, VOYAGE DATE / STATION on the second. */
  /* Inset from the left margin the way the form sets its captions in, while the
     right-hand rules still run out to the margin. */
  table.ident {
    width: calc(100% - 12mm);
    margin: 0 0 8px 12mm;
    border-collapse: collapse;
  }
  table.ident td { padding: 2px 0; vertical-align: bottom; font-size: 9.5pt; }
  /* The captions take only the width of their own text; the two ruled values
     share what is left, so the right-hand rule reaches the margin the way the
     pre-printed form does. */
  table.ident .k { white-space: nowrap; padding-right: 4px; text-align: right; width: 1%; }
  table.ident .v {
    border-bottom: .8pt solid #000;
    font-family: "Courier New", monospace;
    letter-spacing: .04em;
    padding: 0 6px 1px;
    /* A long value must not push the rule past the caption beside it. */
    overflow: hidden;
    white-space: nowrap;
  }
  /* The gap that separates the left pair of fields from the right pair. */
  table.ident .gap { width: 8mm; }
  .intro { font-size: 9pt; margin: 8px 0 6px; }

  /* ── Passenger table ──────────────────────────────────────────────────── */
  /* Fixed layout so the declared column widths are honoured exactly, rather
     than being renegotiated around whatever the longest cell happens to be. */
  table.pax { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.pax th, table.pax td {
    padding: 1.6px 4px;
    text-align: left;
    vertical-align: top;
    /* A long foreign name must wrap inside its cell rather than push the table
       wider than the sheet. */
    overflow-wrap: anywhere;
  }
  table.pax th {
    font-size: 9pt;
    font-weight: 400;
    border-top: .8pt solid #000;
    border-bottom: .8pt solid #000;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  /* Repeat the column headings on every sheet, so a page separated from the set
     is still readable. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  table.pax td.n, table.pax td.c, table.pax th.c { text-align: center; }
  table.pax td.name .ct { white-space: nowrap; }
  table.pax tbody tr:last-child td { border-bottom: .8pt solid #000; }

  .tally { margin-top: 5px; font-size: 9pt; font-weight: 700; }
  .note { margin-top: 3px; font-size: 8pt; font-weight: 400; }
  .empty { padding: 10px 4px; font-size: 9pt; }

  /* ── Attestation ──────────────────────────────────────────────────────── */
  /* The sworn block is a unit: splitting the oath from the signature lines
     would leave a sheet the master cannot sign. */
  .oath {
    margin-top: 12mm;
    padding-top: 6px;
    border-top: .8pt solid #000;
    font-size: 9pt;
    line-height: 1.9;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .oath .body { margin-top: 10px; }
  /* The blanks the master and the authorising officer write into. */
  .oath .fill {
    display: inline-block;
    border-bottom: .8pt solid #000;
    vertical-align: baseline;
  }
  .oath .w-port { width: 55mm; }
  .oath .w-master { width: 78mm; }
  .oath .w-vessel { width: 48mm; }
  .oath .w-day { width: 22mm; }
  .oath .w-month { width: 28mm; }
  .oath .w-year { width: 10mm; }
  .sign { margin-top: 16mm; width: 100%; border-collapse: collapse; }
  /* Top-aligned, not bottom: "Empowered to administer oath under law" runs to
     two lines, and bottom alignment would lift its rule above the one beside
     it so the two signatures sit at different heights. */
  .sign td { width: 50%; padding-right: 10mm; vertical-align: top; }
  .sign .rule { border-bottom: .8pt solid #000; }
  .sign .cap { text-align: center; font-size: 9pt; padding-top: 2px; line-height: 1.3; }

  .foot { margin-top: 8mm; font-size: 7.5pt; color: #333; text-align: center; }
</style>
</head>
<body>
  <div class="head">
    <div class="brand">
      <img class="mark" src="${MANIFEST_MARK}" alt="">
      <div>
        <div class="name">${esc(ISSUER.name)}</div>
        <div class="addr">${esc(ISSUER.address)}</div>
      </div>
    </div>
    <div class="doc">PASSENGER MANIFEST</div>
  </div>

  <table class="ident">
    <tr>
      ${field("ROUTE:", route, "34%")}
      <td class="gap"></td>
      ${field("VOYAGE NO:", esc(manifest.voyage_no || ""), "auto")}
    </tr>
    <tr>
      ${field("VOYAGE DATE:", esc(formatVoyageDate(manifest.scheduled_departure)), "34%")}
      <td class="gap"></td>
      ${field("STATION:", esc(manifest.station || ""), "auto")}
    </tr>
  </table>

  <div class="intro">
    List of all passengers on board the vessel ${esc(manifest.vessel)} sailing from the
    Port of Embarkation ${esc(manifest.origin)} to Port of Destination
    ${esc((manifest.destination || "").toUpperCase())}.
  </div>

  <table class="pax">
    ${colgroup}
    <thead>
      <tr>
        <th class="c">No.</th>
        <th>Class/Cot No.</th>
        <th>Ticket No.</th>
        <th>Passenger Name</th>
        <th class="c">Age</th>
        <th class="c">Sex</th>
        <th>Passport</th>
        <th>Residence</th>
      </tr>
    </thead>
    <tbody>
${rows || `<tr><td class="empty" colspan="8">No passengers booked on this sailing.</td></tr>`}
    </tbody>
  </table>

  <div class="tally">TOTAL PASSENGERS: ${manifest.total}</div>
  ${freePassLine}
  ${boardedLine}

  <div class="oath">
    REPUBLIC OF THE PHILIPPINES<br>
    PORT OF <span class="fill w-port"></span>.) S.S.
    <div class="body">
      I <span class="fill w-master"></span> Master of the
      <span class="fill w-vessel"></span> do solemnly that the foregoing is a full and
      complete manifest of all passengers taken on board the said vessel on the present
      voyage and that the information herein contained is true and correct as to all
      passengers taken on board.
    </div>
    <table class="sign">
      <tr>
        <td></td>
        <td><div class="rule">&nbsp;</div><div class="cap">Master</div></td>
      </tr>
    </table>
    <div class="body">
      SUBSCRIBED and sworn to me before this <span class="fill w-day"></span> day of
      <span class="fill w-month"></span>, 20<span class="fill w-year"></span> certified as
      to the contents herein and PERMIT granted to Master to proceed to his Port of
      Destination.
    </div>
    <table class="sign">
      <tr>
        <td><div class="rule">&nbsp;</div><div class="cap">Authorizing Officer</div></td>
        <td><div class="rule">&nbsp;</div><div class="cap">Empowered to administer oath<br>under law</div></td>
      </tr>
    </table>
  </div>

  <div class="foot">
    Printed ${esc(formatStamp(manifest.generated_at))} by ${esc(manifest.generated_by)}
    &nbsp;·&nbsp; Trip ${esc(manifest.trip_id)}
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
      const go = () => {
        win.onafterprint = () => setTimeout(remove, 0);
        win.focus();
        win.print();
        // Chrome resolves print() before the dialog closes on some platforms,
        // so afterprint is the primary path and this only cleans up after a
        // browser that never fires it.
        setTimeout(remove, 60000);
      };
      // The letterhead is inlined, so there is nothing to fetch — but a browser
      // still decodes it asynchronously, and a frame that prints first prints
      // without it. Waited for, and only briefly: a manifest with no logo beats
      // a print button that appeared to do nothing.
      const pending = Array.from(win.document.images ?? []).filter((img) => !img.complete);
      if (!pending.length) {
        go();
        return;
      }
      let started = false;
      const once = () => {
        if (started) return;
        started = true;
        go();
      };
      let left = pending.length;
      pending.forEach((img) => {
        const tick = () => {
          if (--left === 0) once();
        };
        img.addEventListener("load", tick, { once: true });
        img.addEventListener("error", tick, { once: true });
      });
      setTimeout(once, 3000);
    };

    // srcdoc keeps the document on this origin without a second network round
    // trip, so the print dialog opens on the click that asked for it.
    frame.srcdoc = manifestHtml(manifest);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "The browser would not open a print dialog." };
  }
}
