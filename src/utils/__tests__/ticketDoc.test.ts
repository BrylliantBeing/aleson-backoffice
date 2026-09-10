/**
 * What the counter's TM-T82X actually prints on a passage ticket.
 *
 * Only the lines whose absence a passenger or a checker would notice are
 * asserted here — the byte-level command stream is escpos.test.ts's job. The
 * TYPE line is the one this file exists for: it is what tells a discounted or
 * seatless ticket apart from a mispriced adult, at the ramp and in the audit.
 */

import { renderTicket, sampleTicket } from "@/utils/ticketDoc";
import { buildTicketData } from "@/utils/ticketLayout";

const LEG = {
  vessel: "MV Aleson Grande",
  origin: "Zamboanga",
  destination: "Sandakan",
  originCode: "ZAM",
  destinationCode: "SDK",
  departDateISO: "2026-06-15",
  departTime: "18:00:00",
  accommodation: "Tourist",
  tripKind: "ONE WAY",
  ticketStation: "ZAM",
  issuedBy: "Pedro Garcia",
  issuedDateISO: "2026-06-01",
};

const PAX = {
  firstName: "Juan",
  middleInitial: "D",
  lastName: "Dela Cruz",
  birthdate: "1990-01-01",
  sex: "Male",
  nationality: "Filipino",
  fare: 1800,
  currency: "PHP",
  seat: "ECO-12",
};

/** The printed document as text, with the ESC/POS command bytes dropped. */
const printed = (data = sampleTicket()): string =>
  Array.from(renderTicket(data))
    .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : b === 0x0a ? "\n" : ""))
    .join("");

describe("renderTicket — passenger type", () => {
  it("prints the fare category on an ordinary ticket", () => {
    const doc = printed(buildTicketData(LEG, { ...PAX, passengerType: "Senior" }));
    expect(doc).toMatch(/TYPE\s+SENIOR/);
  });

  it("prints INFANT on a lap infant's ticket", () => {
    // The one ticket with no seat on it. Without the type line a checker
    // cannot tell it from a ticket whose seat went missing.
    const doc = printed(
      buildTicketData(LEG, { ...PAX, passengerType: "Infant", fare: 0, seat: null })
    );
    expect(doc).toMatch(/TYPE\s+INFANT/);
    expect(doc).not.toMatch(/^SEAT/m);
  });

  it("keeps saying FREE PASS on a cargo escort's ticket, not its category", () => {
    // A free pass has to say why nothing was paid and against what — the
    // category alone ("FREE PASS") would drop the cargo reference's context.
    const doc = printed(
      buildTicketData(LEG, {
        ...PAX,
        passengerType: "Free Pass",
        fare: 0,
        freePass: true,
        cargoReference: "BL-12345",
      })
    );
    expect(doc).toMatch(/TYPE\s+FREE PASS \(RO\/RO CARGO\)/);
    expect(doc).toMatch(/CARGO REF\s+BL-12345/);
  });

  it("omits the line entirely when no category was captured", () => {
    // Rather than printing a TYPE row against nothing — which is what a sale
    // made before the field existed would produce on a reprint.
    const doc = printed(buildTicketData(LEG, PAX));
    expect(doc).not.toMatch(/\bTYPE\b/);
  });

  it("gives the printer-setup sample a category like a real ticket", () => {
    expect(printed()).toMatch(/TYPE\s+ADULT/);
  });
});
