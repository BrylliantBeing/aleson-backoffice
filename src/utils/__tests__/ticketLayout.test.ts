/**
 * What gets printed on a ticket.
 *
 * A ticket is a BIR principal invoice, so the fare in words, the VAT split and
 * the serial are not cosmetic — they are what makes the document valid. And
 * because the whole ticket prints on blank roll, everything here ends up on
 * paper exactly as these functions return it.
 */

import {
  VAT_RATE,
  amountInWords,
  attachServerTickets,
  buildReprintTickets,
  buildTicketData,
  buildVoyageNumber,
  formatDepartureDate,
  formatDepartureTime,
  formatPassengerName,
  formatRoute,
  printableFare,
  vatBreakdown,
  type TicketData,
} from "@/utils/ticketLayout";

// ── Dates and times ─────────────────────────────────────────────────────────

describe("formatDepartureDate", () => {
  it("reads the way the operator's existing tickets do", () => {
    expect(formatDepartureDate("2026-08-14")).toBe("08/14/2026 Fri");
  });

  it("does not shift the day into the previous one", () => {
    // `new Date("2026-08-14")` parses as UTC midnight, which is 14 Aug 08:00
    // in Manila but 13 Aug in the Americas. The date is parsed by hand for
    // exactly this reason.
    expect(formatDepartureDate("2026-01-01")).toBe("01/01/2026 Thu");
    expect(formatDepartureDate("2026-12-31")).toBe("12/31/2026 Thu");
  });

  it("pads a single-digit month and day", () => {
    expect(formatDepartureDate("2026-03-05")).toBe("03/05/2026 Thu");
  });

  it("prints nothing for a date it cannot read", () => {
    expect(formatDepartureDate("")).toBe("");
    expect(formatDepartureDate("not a date")).toBe("");
  });
});

describe("formatDepartureTime", () => {
  it("converts the stored 24-hour time to the printed 12-hour one", () => {
    expect(formatDepartureTime("18:00:00")).toBe("06:00:00 PM");
    expect(formatDepartureTime("05:15:00")).toBe("05:15:00 AM");
  });

  it("gets both ends of the clock right", () => {
    // Midnight and noon are where a naive `h % 12` prints "00".
    expect(formatDepartureTime("00:30:00")).toBe("12:30:00 AM");
    expect(formatDepartureTime("12:00:00")).toBe("12:00:00 PM");
  });

  it("accepts a time with no seconds", () => {
    expect(formatDepartureTime("18:00")).toBe("06:00:00 PM");
  });

  it("prints nothing when the schedule carries no time", () => {
    expect(formatDepartureTime(null)).toBe("");
    expect(formatDepartureTime(undefined)).toBe("");
    expect(formatDepartureTime("")).toBe("");
  });
});

// ── Identifiers ─────────────────────────────────────────────────────────────

describe("buildVoyageNumber", () => {
  it("is MMDD plus the origin port code plus the year", () => {
    expect(buildVoyageNumber("2026-08-14", "ZAM")).toBe("0814ZAM2026");
  });

  it("upper-cases a code an admin typed in lower case", () => {
    expect(buildVoyageNumber("2026-08-14", "zam")).toBe("0814ZAM2026");
  });

  it("still builds a number for a port with no code", () => {
    expect(buildVoyageNumber("2026-08-14", "")).toBe("08142026");
  });

  it("prints nothing when there is no departure date", () => {
    expect(buildVoyageNumber("", "ZAM")).toBe("");
  });
});

describe("formatRoute", () => {
  it("uses the two port codes", () => {
    expect(formatRoute("Zamboanga", "ZAM", "Sandakan", "SDK")).toBe("ZAM-SDK");
  });

  it("falls back to the port name so something readable still prints", () => {
    expect(formatRoute("Zamboanga", "", "Sandakan", "")).toBe("ZAMBOANGA-SANDAKAN");
  });

  it("mixes a coded port with an uncoded one", () => {
    expect(formatRoute("Zamboanga", "ZAM", "Sandakan", "")).toBe("ZAM-SANDAKAN");
  });
});

describe("formatPassengerName", () => {
  it("puts the last name first, as the ticket asks for", () => {
    expect(formatPassengerName("Juan", "P", "dela Cruz")).toBe("DELA CRUZ, JUAN P.");
  });

  it("adds the full stop to a middle initial that lacks one", () => {
    expect(formatPassengerName("Juan", "P.", "Cruz")).toBe("CRUZ, JUAN P.");
  });

  it("leaves out the middle initial entirely when there is none", () => {
    expect(formatPassengerName("Juan", "", "Cruz")).toBe("CRUZ, JUAN");
    expect(formatPassengerName("Juan", "   ", "Cruz")).toBe("CRUZ, JUAN");
  });

  it("trims what the cashier typed", () => {
    expect(formatPassengerName("  Juan ", " p ", "  Cruz ")).toBe("CRUZ, JUAN P.");
  });
});

// ── The fare in words ───────────────────────────────────────────────────────

describe("amountInWords", () => {
  it("spells the fare line on the invoice", () => {
    expect(amountInWords(1800, "PHP")).toBe("ONE THOUSAND EIGHT HUNDRED PESOS ONLY");
  });

  it("names the currency the fare was sold in", () => {
    // A ringgit fare that reads "PESOS" is a misstated invoice.
    expect(amountInWords(1800, "MYR")).toBe("ONE THOUSAND EIGHT HUNDRED RINGGIT ONLY");
  });

  it("spells the minor unit each currency uses", () => {
    expect(amountInWords(1.5, "PHP")).toBe("ONE PESOS AND FIFTY CENTAVOS ONLY");
    expect(amountInWords(1.5, "MYR")).toBe("ONE RINGGIT AND FIFTY SEN ONLY");
  });

  it("hyphenates the compound tens", () => {
    expect(amountInWords(45, "PHP")).toBe("FORTY-FIVE PESOS ONLY");
    expect(amountInWords(1234.56, "PHP")).toBe(
      "ONE THOUSAND TWO HUNDRED THIRTY-FOUR PESOS AND FIFTY-SIX CENTAVOS ONLY"
    );
  });

  it("spells the teens as single words", () => {
    expect(amountInWords(17, "PHP")).toBe("SEVENTEEN PESOS ONLY");
    expect(amountInWords(115, "PHP")).toBe("ONE HUNDRED FIFTEEN PESOS ONLY");
  });

  it("spells a free pass as zero rather than leaving the line blank", () => {
    expect(amountInWords(0, "PHP")).toBe("ZERO PESOS ONLY");
  });

  it("carries the larger groups", () => {
    expect(amountInWords(1_000_000, "PHP")).toBe("ONE MILLION PESOS ONLY");
    expect(amountInWords(2_500_000, "PHP")).toBe(
      "TWO MILLION FIVE HUNDRED THOUSAND PESOS ONLY"
    );
  });

  it("spells a fare that is only centavos", () => {
    expect(amountInWords(0.5, "PHP")).toBe("ZERO PESOS AND FIFTY CENTAVOS ONLY");
  });

  it("keeps the centavos on an odd fare", () => {
    expect(amountInWords(1799.99, "PHP")).toBe(
      "ONE THOUSAND SEVEN HUNDRED NINETY-NINE PESOS AND NINETY-NINE CENTAVOS ONLY"
    );
  });

  it("treats an unknown currency as pesos rather than printing nothing", () => {
    expect(amountInWords(100, "USD")).toBe("ONE HUNDRED PESOS ONLY");
    expect(amountInWords(100, null)).toBe("ONE HUNDRED PESOS ONLY");
  });
});

describe("printableFare", () => {
  it("uses an ASCII prefix the printer's code page can render", () => {
    // The thermal head has no ₱ glyph, and "P" is how the operator's existing
    // tickets already read.
    expect(printableFare(1800, "PHP")).toBe("P 1,800.00");
    expect(printableFare(1800, "MYR")).toBe("RM 1,800.00");
  });

  it("always shows the minor unit", () => {
    expect(printableFare(0, "PHP")).toBe("P 0.00");
  });
});

// ── VAT ─────────────────────────────────────────────────────────────────────

describe("vatBreakdown", () => {
  it("splits a VAT-inclusive peso fare at twelve per cent", () => {
    expect(VAT_RATE).toBe(0.12);
    expect(vatBreakdown(1120, "PHP")).toEqual({
      vatableSales: 1000,
      vatAmount: 120,
      vatExempt: 0,
      zeroRated: 0,
      total: 1120,
    });
  });

  it("derives the VAT by subtraction so the lines always add back to the total", () => {
    for (const fare of [1800, 1234.56, 99.99, 1, 750]) {
      const b = vatBreakdown(fare, "PHP");
      expect(b.vatableSales + b.vatAmount).toBeCloseTo(b.total, 2);
    }
  });

  it("reports a fare sold in another currency as zero-rated", () => {
    // Priced in ringgit is treated as an international leg.
    expect(vatBreakdown(1800, "MYR")).toEqual({
      vatableSales: 0,
      vatAmount: 0,
      vatExempt: 0,
      zeroRated: 1800,
      total: 1800,
    });
  });

  it("never reports a negative fare", () => {
    expect(vatBreakdown(-100, "PHP").total).toBe(0);
  });

  it("handles a free pass without dividing anything by zero", () => {
    expect(vatBreakdown(0, "PHP")).toEqual({
      vatableSales: 0, vatAmount: 0, vatExempt: 0, zeroRated: 0, total: 0,
    });
  });

  it("does not yet model the statutory exemptions", () => {
    // Senior citizen and PWD discounts are VAT-exempt by statute and are NOT
    // modelled — they currently fall into VATable sales. Pinned so the day
    // the operator's accountant confirms the rule, this test is the reminder
    // of what has to change.
    expect(vatBreakdown(1120, "PHP").vatExempt).toBe(0);
  });
});

// ── Assembling a ticket ─────────────────────────────────────────────────────

const LEG = {
  vessel: "M/V Antonia 2",
  origin: "Zamboanga",
  destination: "Sandakan",
  originCode: "ZAM",
  destinationCode: "SDK",
  departDateISO: "2026-08-14",
  departTime: "18:00:00",
  accommodation: "Cabin",
  tripKind: "One way",
  ticketStation: "Zamboanga",
  issuedBy: "pedro.garcia",
  issuedDateISO: "2026-08-01",
};

const PAX = {
  firstName: "Juan",
  middleInitial: "P",
  lastName: "dela Cruz",
  birthdate: "1990-05-20",
  sex: "male",
  nationality: "Filipino",
  fare: 1800,
  currency: "PHP",
  seat: "CAB-12",
  freePass: false,
  cargoReference: "",
};

describe("buildTicketData", () => {
  it("assembles everything the printed ticket shows", () => {
    const t = buildTicketData(LEG, PAX);
    expect(t.vessel).toBe("M/V ANTONIA 2");
    expect(t.route).toBe("ZAM-SDK");
    expect(t.voyageNo).toBe("0814ZAM2026");
    expect(t.passengerName).toBe("DELA CRUZ, JUAN P.");
    expect(t.departureDate).toBe("08/14/2026 Fri");
    expect(t.departureTime).toBe("06:00:00 PM");
    expect(t.fare).toBe("P 1,800.00");
    expect(t.amountInWords).toBe("ONE THOUSAND EIGHT HUNDRED PESOS ONLY");
  });

  it("prints the seat number painted on the ship, not the stored name", () => {
    // seat_map names are prefixed and unique across the vessel (CAB-12), but
    // the number on the bulkhead is just 12.
    expect(buildTicketData(LEG, PAX).seat).toBe("12");
  });

  it("ages the passenger as at the date the ticket was issued", () => {
    // Not as at today: a reprint pulled next year must not age the passenger.
    expect(buildTicketData(LEG, PAX).age).toBe("36");
  });

  it("leaves the age blank when no birthdate was captured", () => {
    expect(buildTicketData(LEG, { ...PAX, birthdate: "" }).age).toBe("");
  });

  it("reduces the sex to the single letter the form carries", () => {
    expect(buildTicketData(LEG, PAX).sex).toBe("M");
    expect(buildTicketData(LEG, { ...PAX, sex: "female" }).sex).toBe("F");
    expect(buildTicketData(LEG, { ...PAX, sex: "" }).sex).toBe("");
  });

  it("leaves the serial and the boarding token empty until the sale is confirmed", () => {
    const t = buildTicketData(LEG, PAX);
    expect(t.ticketNumber).toBe("");
    expect(t.qrToken).toBe("");
  });

  it("carries a free pass as its own flag, not as a zero fare", () => {
    // An infant on a lap is also zero, and the two are not the same document:
    // this one has to say on its face that it was issued against cargo.
    const t = buildTicketData(LEG, {
      ...PAX, fare: 0, freePass: true, cargoReference: "bl-12345",
    });
    expect(t.freePass).toBe(true);
    expect(t.cargoReference).toBe("BL-12345");
    expect(t.fareAmount).toBe(0);
  });

  it("prints the fare category the ticket was sold under", () => {
    // A discounted or seatless ticket has to say so on its face — a senior
    // fare and a lap infant both read as a mispriced adult otherwise.
    expect(buildTicketData(LEG, { ...PAX, passengerType: "Senior" }).passengerType)
      .toBe("SENIOR/PWD");
    expect(buildTicketData(LEG, { ...PAX, passengerType: "Infant", fare: 0 }).passengerType)
      .toBe("INFANT");
  });

  it("leaves the category blank when the caller did not supply one", () => {
    // Which is what makes the printed TYPE line conditional rather than a row
    // reading "TYPE" against nothing.
    expect(buildTicketData(LEG, PAX).passengerType).toBe("");
  });

  it("keeps the unformatted amount so VAT can be split at render time", () => {
    expect(buildTicketData(LEG, PAX).fareAmount).toBe(1800);
    expect(buildTicketData(LEG, PAX).currency).toBe("PHP");
  });
});

// ── Serials from the server ─────────────────────────────────────────────────

describe("attachServerTickets", () => {
  const built = [
    { ...buildTicketData(LEG, PAX), passengerName: "ONE" },
    { ...buildTicketData(LEG, PAX), passengerName: "TWO" },
  ] as TicketData[];

  it("fills in the serial and token the server issued, by position", () => {
    const out = attachServerTickets(built, [
      { ticket_number: "ZAMB1", qr_token: "tok-1" },
      { ticket_number: "ZAMB2", qr_token: "tok-2" },
    ]);
    expect(out[0]).toMatchObject({ passengerName: "ONE", ticketNumber: "ZAMB1", qrToken: "tok-1" });
    expect(out[1]).toMatchObject({ passengerName: "TWO", ticketNumber: "ZAMB2", qrToken: "tok-2" });
  });

  it("leaves a ticket the server did not return blank rather than borrowing its neighbour's", () => {
    // Printing one passenger's QR on another's ticket would board the wrong
    // person, so a short response must produce an unusable ticket, not a
    // plausible wrong one.
    const out = attachServerTickets(built, [{ ticket_number: "ZAMB1", qr_token: "tok-1" }]);
    expect(out[1].ticketNumber).toBe("");
    expect(out[1].qrToken).toBe("");
  });

  it("blanks everything when the server returned nothing at all", () => {
    for (const server of [null, undefined, []]) {
      const out = attachServerTickets(built, server);
      expect(out.every((t) => t.ticketNumber === "" && t.qrToken === "")).toBe(true);
    }
  });

  it("does not mutate the tickets it was given", () => {
    attachServerTickets(built, [{ ticket_number: "ZAMB1", qr_token: "tok-1" }]);
    expect(built[0].ticketNumber).toBe("");
  });
});

// ── Reprints ────────────────────────────────────────────────────────────────

describe("buildReprintTickets", () => {
  const BOOKING = {
    booking_reference: "ABC123",
    ticket_station: "Zamboanga",
    issued_by: "pedro.garcia",
    issued_date: "2026-08-01",
    trip_kind: "One way",
    tickets: [{
      ticket_number: "ZAMB1042",
      qr_token: "tok-1",
      vessel: "M/V Antonia 2",
      origin: "Zamboanga",
      origin_code: "ZAM",
      destination: "Sandakan",
      destination_code: "SDK",
      depart_date: "2026-08-14",
      depart_time: "18:00:00",
      accommodation_class: "Cabin",
      seat_number: "CAB-12",
      passenger_first_name: "Juan",
      passenger_middle_name: "P",
      passenger_last_name: "dela Cruz",
      passenger_birthdate: "1990-05-20",
      passenger_gender: "male",
      passenger_nationality: "Filipino",
      passenger_type: "Adult",
      cargo_reference: null,
      price: 1800,
      currency: "PHP",
    }],
  };

  it("rebuilds a ticket that already exists, serial and all", () => {
    const [t] = buildReprintTickets(BOOKING);
    expect(t.ticketNumber).toBe("ZAMB1042");
    expect(t.qrToken).toBe("tok-1");
    expect(t.passengerName).toBe("DELA CRUZ, JUAN P.");
    expect(t.fare).toBe("P 1,800.00");
  });

  it("keeps the ORIGINAL counter and cashier, not whoever is at the till now", () => {
    // A reprint is a copy of that invoice, not a new one.
    const [t] = buildReprintTickets(BOOKING);
    expect(t.ticketStation).toBe("ZAMBOANGA");
    expect(t.issuedBy).toBe("PEDRO.GARCIA");
    expect(t.dateIssued).toBe("08/01/2026");
  });

  it("recognises a cargo escort's ticket from its passenger type", () => {
    // The reprint's only way to tell a free pass from a fare that happens to
    // be zero.
    const [t] = buildReprintTickets({
      ...BOOKING,
      tickets: [{ ...BOOKING.tickets[0], passenger_type: "Free Pass", price: 0 }],
    });
    expect(t.freePass).toBe(true);
  });

  it("does not mistake a zero-fare infant for a free pass", () => {
    const [t] = buildReprintTickets({
      ...BOOKING,
      tickets: [{ ...BOOKING.tickets[0], passenger_type: "Infant", price: 0 }],
    });
    expect(t.freePass).toBe(false);
    // The reprint is a copy of the original invoice, so it has to carry the
    // same category the first print did.
    expect(t.passengerType).toBe("INFANT");
  });

  it("survives a row where the optional columns came back null", () => {
    const [t] = buildReprintTickets({
      ...BOOKING,
      tickets: [{
        ...BOOKING.tickets[0],
        vessel: null, origin: null, origin_code: null,
        destination: null, destination_code: null,
        depart_date: null, depart_time: null,
        passenger_middle_name: null, passenger_birthdate: null,
      }],
    });
    expect(t.departureDate).toBe("");
    expect(t.departureTime).toBe("");
    expect(t.age).toBe("");
    expect(t.passengerName).toBe("DELA CRUZ, JUAN");
  });
});
