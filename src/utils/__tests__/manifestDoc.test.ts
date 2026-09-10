/**
 * The printed manifest is a filed document, not a screen: it is handed to the
 * vessel's master, sworn to, and countersigned at the port. Its shape is fixed
 * by the form the operator has always used, so these tests pin the parts a
 * refactor must not quietly change — the eight columns and their order, the
 * voyage-identity fields, the attestation, and the two cells whose content is a
 * judgement call (the cot number and the passport box).
 */

import { manifestHtml } from "@/utils/manifestDoc";
import { Manifest, ManifestPassenger } from "@/types/reports";
import { ISSUER } from "@/utils/ticketDoc";

const passenger = (over: Partial<ManifestPassenger> = {}): ManifestPassenger => ({
  ticket_id: 1,
  first_name: "Jul Hussin",
  last_name: "Baluan",
  passenger_name: "BALUAN, Jul Hussin",
  age: 56,
  gender: "Male",
  nationality: "Filipino",
  passenger_type: "Adult",
  seat_number: "AC-62",
  accommodation_class: "Aircon-A",
  class_code: "AC-A",
  ticket_number: "7947517",
  booking_reference: "ABC123",
  boarded_at: null,
  status: "Booked",
  contact: "09650967871",
  cargo_reference: null,
  id_type: null,
  id_number: null,
  ...over,
});

const manifest = (over: Partial<Manifest> = {}): Manifest => ({
  trip_id: 42,
  vessel: "MV ANTONIA 2",
  route: "Zamboanga City → Bongao",
  origin: "Zamboanga City",
  destination: "Bongao",
  origin_code: "ZAM",
  destination_code: "BGO",
  voyage_no: "0907ZAMBGO2026",
  station: "BLVD1",
  scheduled_departure: "2026-09-07T17:00:00",
  scheduled_arrival: "2026-09-08T09:00:00",
  actual_departure: null,
  status: "Scheduled",
  total: 1,
  boarded: 0,
  minors: 0,
  free_passes: 0,
  by_class: [{ accommodation_class: "Aircon-A", passengers: 1 }],
  by_gender: [{ gender: "Male", passengers: 1 }],
  passengers: [passenger()],
  generated_at: "2026-09-06T08:30:00",
  generated_by: "Brylle Tan",
  ...over,
});

/** The document's column headings, in the order they are printed. */
const headings = (html: string): string[] =>
  Array.from(html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)).map((m) => m[1].trim());

describe("the operator's manifest form", () => {
  it("prints the eight columns in the form's own order", () => {
    expect(headings(manifestHtml(manifest()))).toEqual([
      "No.",
      "Class/Cot No.",
      "Ticket No.",
      "Passenger Name",
      "Age",
      "Sex",
      "Passport",
      "Residence",
    ]);
  });

  it("carries its own letterhead mark, needing no fetch to print", () => {
    // The document is handed to a hidden iframe through srcdoc, whose base URL
    // is about:srcdoc — anything but an inlined mark resolves against nothing,
    // and the sheet comes out of the office printer with no letterhead.
    expect(manifestHtml(manifest())).toContain('src="data:image/png;base64,');
  });

  it("carries the letterhead, the voyage identity block and the embarkation line", () => {
    const html = manifestHtml(manifest());
    expect(html).toContain(ISSUER.name);
    expect(html).toContain("PASSENGER MANIFEST");
    expect(html).toContain("ROUTE:");
    expect(html).toContain("ZAM-BGO");
    expect(html).toContain("VOYAGE NO:");
    expect(html).toContain("0907ZAMBGO2026");
    expect(html).toContain("STATION:");
    expect(html).toContain("BLVD1");
    expect(html).toMatch(
      /List of all passengers on board the vessel MV ANTONIA 2 sailing from the\s+Port of Embarkation Zamboanga City to Port of Destination\s+BONGAO\./
    );
  });

  it("prints the voyage date day-first, off the stored Manila wall clock", () => {
    // 5pm on the 7th of September — not shifted by whatever timezone the
    // counter's browser believes it is in.
    expect(manifestHtml(manifest())).toContain("07/09/2026 5:00:00 pm");
  });

  it("ends with the attestation the master swears to and the port countersigns", () => {
    const html = manifestHtml(manifest());
    expect(html).toContain("REPUBLIC OF THE PHILIPPINES");
    expect(html).toContain("PORT OF");
    expect(html).toContain("Master of the");
    expect(html).toContain("SUBSCRIBED and sworn to me before this");
    expect(html).toContain("Authorizing Officer");
    expect(html).toContain("Empowered to administer oath");
    // The oath and the signature lines have to land on one sheet, or the master
    // is handed a page with nowhere to sign.
    expect(html).toMatch(/\.oath\s*\{[^}]*page-break-inside:\s*avoid/);
  });

  it("names the berth by class code and the number painted on the ship", () => {
    // AC-62 is the seat_map identity; 62 is what is written beside the cot.
    expect(manifestHtml(manifest())).toContain("AC-A 62");
    expect(manifestHtml(manifest())).not.toContain("AC-A AC-62");
  });

  it("falls back to the class name when a sailing predates the class codes", () => {
    const html = manifestHtml(
      manifest({ passengers: [passenger({ class_code: null })] })
    );
    expect(html).toContain("Aircon-A 62");
  });

  it("carries the booking's contact inside the name cell, as the form does", () => {
    expect(manifestHtml(manifest())).toContain("-(09650967871)");
  });

  it("fills the passport box only for an actual passport", () => {
    const withPassport = manifestHtml(
      manifest({
        passengers: [passenger({ id_type: "Passport", id_number: "P1234567A" })],
      })
    );
    expect(withPassport).toContain("P1234567A");

    // A PhilSys card is a valid ID to sell against, but writing its number in
    // the PASSPORT column would claim a travel document nobody presented.
    const withPhilSys = manifestHtml(
      manifest({
        passengers: [
          passenger({ id_type: "National ID (PhilSys)", id_number: "1234-5678-9012" }),
        ],
      })
    );
    expect(withPhilSys).not.toContain("1234-5678-9012");
  });

  it("totals the passengers and names every free pass with its cargo document", () => {
    const html = manifestHtml(
      manifest({
        total: 2,
        free_passes: 1,
        passengers: [
          passenger(),
          passenger({
            passenger_name: "SITCHON, Rey",
            passenger_type: "Free Pass",
            cargo_reference: "RORO-8891",
          }),
        ],
      })
    );
    expect(html).toContain("TOTAL PASSENGERS: 2");
    expect(html).toContain("SITCHON, Rey (RORO-8891)");
  });

  it("reports the gate's count only once the sailing has actually been scanned", () => {
    expect(manifestHtml(manifest())).not.toContain("Boarded at gate");
    expect(manifestHtml(manifest({ boarded: 1 }))).toContain("Boarded at gate");
  });

  it("escapes passenger data rather than letting it into the markup", () => {
    const html = manifestHtml(
      manifest({ passengers: [passenger({ passenger_name: "O'BRIEN & <b>SON</b>" })] })
    );
    expect(html).toContain("O'BRIEN &amp; &lt;b&gt;SON&lt;/b&gt;");
  });

  it("still renders a sheet for a sailing nobody booked", () => {
    const html = manifestHtml(manifest({ total: 0, passengers: [] }));
    expect(html).toContain("No passengers booked on this sailing.");
    expect(html).toContain("TOTAL PASSENGERS: 0");
    expect(html).toContain("REPUBLIC OF THE PHILIPPINES");
  });
});
