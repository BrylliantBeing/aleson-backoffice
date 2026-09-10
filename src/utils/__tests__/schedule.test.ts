/**
 * Which days the counter's calendar leaves open.
 *
 * The backend decides whether a date has a trip by evaluating each schedule's
 * iCal rrule. This is the client's dependency-free reproduction of that, and
 * it deliberately works entirely in calendar-date space: it reads the
 * DTSTART's y/m/d and compares integer day numbers, so there is no
 * instant-to-local conversion to get wrong.
 *
 * That is the whole reason this module exists rather than pulling in `rrule` —
 * see the "rrule timezone gotcha". A DTSTART's calendar date is the Manila
 * date whether or not the TZID is present, which is why the TZID is read past
 * rather than applied.
 */

import {
  makeScheduleChecker,
  parseRRule,
  ruleMatchesDate,
  type RouteVoyage,
} from "@/utils/schedule";

// 2026-09-07 is a Monday.
const MON = "DTSTART;TZID=Asia/Manila:20260907T051500\nRRULE:FREQ=WEEKLY;BYDAY=MO";
const LEGACY_MON = "DTSTART:20260907T051500\nRRULE:FREQ=WEEKLY;BYDAY=MO";
const DAILY = "DTSTART;TZID=Asia/Manila:20260907T051500\nRRULE:FREQ=DAILY";

const matches = (rrule: string, iso: string) => {
  const rule = parseRRule(rrule)!;
  const [y, m, d] = iso.split("-").map(Number);
  return ruleMatchesDate(rule, y, m, d);
};

// ── Reading a stored rule ───────────────────────────────────────────────────

describe("parseRRule", () => {
  it("reads the TZID form the schedules now carry", () => {
    expect(parseRRule(MON)).toEqual({
      startY: 2026, startM: 9, startD: 7,
      freq: "WEEKLY", interval: 1, byday: [1], startMinutes: 315,
    });
  });

  it("still reads the legacy bare DTSTART", () => {
    // Which exists until /admin/seed has migrated a database.
    expect(parseRRule(LEGACY_MON)).toEqual(parseRRule(MON));
  });

  it("reads the departure as minutes past midnight", () => {
    expect(parseRRule(MON)!.startMinutes).toBe(5 * 60 + 15);
  });

  it("reports no time for a DTSTART that carries none", () => {
    // Such a rule cannot be judged against the clock, so its day stays
    // available rather than vanishing.
    const dateOnly = parseRRule("DTSTART;TZID=Asia/Manila:20260907\nRRULE:FREQ=DAILY");
    expect(dateOnly!.startMinutes).toBeNull();
  });

  it("defaults to daily when no FREQ is given", () => {
    expect(parseRRule("DTSTART:20260907T051500")!.freq).toBe("DAILY");
  });

  it("reads an interval and defaults it to one", () => {
    expect(parseRRule(`${DAILY};INTERVAL=3`)!.interval).toBe(3);
    expect(parseRRule(DAILY)!.interval).toBe(1);
  });

  it("reads every weekday code", () => {
    const rule = parseRRule(
      "DTSTART:20260907T051500\nRRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA"
    );
    expect(rule!.byday).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("ignores a weekday code it does not recognise", () => {
    const rule = parseRRule("DTSTART:20260907T051500\nRRULE:FREQ=WEEKLY;BYDAY=MO,XX");
    expect(rule!.byday).toEqual([1]);
  });

  it("reads nothing out of a rule with no DTSTART", () => {
    expect(parseRRule("RRULE:FREQ=WEEKLY;BYDAY=MO")).toBeNull();
    expect(parseRRule("")).toBeNull();
    expect(parseRRule(null)).toBeNull();
  });
});

// ── Matching a calendar day ─────────────────────────────────────────────────

describe("ruleMatchesDate", () => {
  it("fires a weekly Monday sailing on Mondays", () => {
    // The bug this shape of matcher avoids: an 05:15 Manila Monday expressed
    // in UTC is 21:15 Sunday, and BYDAY=MO then fires on Manila Tuesdays.
    expect(matches(MON, "2026-09-07")).toBe(true);
    expect(matches(MON, "2026-09-14")).toBe(true);
    expect(matches(MON, "2026-09-08")).toBe(false);
    expect(matches(MON, "2026-09-06")).toBe(false);
  });

  it("gives the legacy and TZID spellings the same answer", () => {
    for (const iso of ["2026-09-07", "2026-09-08", "2026-09-14"]) {
      expect(matches(LEGACY_MON, iso)).toBe(matches(MON, iso));
    }
  });

  it("never fires before the schedule started", () => {
    expect(matches(MON, "2026-08-31")).toBe(false);   // an earlier Monday
    expect(matches(DAILY, "2026-09-06")).toBe(false);
  });

  it("fires a daily sailing every day from its start", () => {
    for (const iso of ["2026-09-07", "2026-09-08", "2026-09-09"]) {
      expect(matches(DAILY, iso)).toBe(true);
    }
  });

  it("honours an interval on a daily rule", () => {
    const everyThird = `${DAILY};INTERVAL=3`;
    expect(matches(everyThird, "2026-09-07")).toBe(true);
    expect(matches(everyThird, "2026-09-08")).toBe(false);
    expect(matches(everyThird, "2026-09-10")).toBe(true);
  });

  it("honours an interval on a weekly rule", () => {
    const fortnightly = `${MON};INTERVAL=2`;
    expect(matches(fortnightly, "2026-09-07")).toBe(true);
    expect(matches(fortnightly, "2026-09-14")).toBe(false);
    expect(matches(fortnightly, "2026-09-21")).toBe(true);
  });

  it("derives the weekday from the start when BYDAY is absent", () => {
    const weekly = "DTSTART:20260907T051500\nRRULE:FREQ=WEEKLY";
    expect(matches(weekly, "2026-09-14")).toBe(true);
    expect(matches(weekly, "2026-09-15")).toBe(false);
  });

  it("fires a multi-day weekly sailing on each of its days", () => {
    const wed_sat = "DTSTART:20260907T051500\nRRULE:FREQ=WEEKLY;BYDAY=WE,SA";
    expect(matches(wed_sat, "2026-09-09")).toBe(true);   // Wednesday
    expect(matches(wed_sat, "2026-09-12")).toBe(true);   // Saturday
    expect(matches(wed_sat, "2026-09-10")).toBe(false);
  });

  it("handles a monthly rule on the day of the month it started", () => {
    const monthly = "DTSTART:20260907T051500\nRRULE:FREQ=MONTHLY";
    expect(matches(monthly, "2026-10-07")).toBe(true);
    expect(matches(monthly, "2026-10-08")).toBe(false);
  });

  it("handles a yearly rule", () => {
    const yearly = "DTSTART:20260907T051500\nRRULE:FREQ=YEARLY";
    expect(matches(yearly, "2027-09-07")).toBe(true);
    expect(matches(yearly, "2027-09-08")).toBe(false);
  });

  it("crosses a month and a year boundary without drifting", () => {
    const dec = "DTSTART:20261228T051500\nRRULE:FREQ=WEEKLY;BYDAY=MO";
    expect(matches(dec, "2026-12-28")).toBe(true);
    expect(matches(dec, "2027-01-04")).toBe(true);
    expect(matches(dec, "2027-01-05")).toBe(false);
  });

  it("is unaffected by a leap day falling in the span", () => {
    const feb = "DTSTART:20280221T051500\nRRULE:FREQ=WEEKLY;BYDAY=MO";
    expect(matches(feb, "2028-02-28")).toBe(true);   // 2028 is a leap year
    expect(matches(feb, "2028-03-06")).toBe(true);
  });
});

// ── The calendar predicate ──────────────────────────────────────────────────

const VOYAGES: RouteVoyage[] = [
  { origin: "Zamboanga", destination: "Jolo", rrule: MON },
  { origin: "Jolo", destination: "Zamboanga", rrule: DAILY },
];

// Sunday 6 September 2026, 08:00 local — the day before the Monday sailing.
const SUNDAY_MORNING = new Date(2026, 8, 6, 8, 0);

describe("makeScheduleChecker", () => {
  it("leaves every day enabled while the answer is not knowable yet", () => {
    // undefined means "we cannot know" — no route chosen, or voyages still
    // loading. Greying the calendar then would be a lie.
    expect(makeScheduleChecker(VOYAGES, "", "Jolo")).toBeUndefined();
    expect(makeScheduleChecker(VOYAGES, "Zamboanga", "")).toBeUndefined();
    expect(makeScheduleChecker(null, "Zamboanga", "Jolo")).toBeUndefined();
    expect(makeScheduleChecker([], "Zamboanga", "Jolo")).toBeUndefined();
  });

  it("greys everything when the route is known to have no sailings", () => {
    // All greyed reads as "no trips", which is the truth here.
    const check = makeScheduleChecker(VOYAGES, "Zamboanga", "Sandakan", SUNDAY_MORNING);
    expect(check).toBeDefined();
    expect(check!("2026-09-07")).toBe(false);
    expect(check!("2026-09-08")).toBe(false);
  });

  it("opens only the days the route actually runs", () => {
    const check = makeScheduleChecker(VOYAGES, "Zamboanga", "Jolo", SUNDAY_MORNING)!;
    expect(check("2026-09-07")).toBe(true);
    expect(check("2026-09-08")).toBe(false);
    expect(check("2026-09-14")).toBe(true);
  });

  it("reads the direction, not just the pair of ports", () => {
    // Zamboanga->Jolo is weekly; Jolo->Zamboanga is daily.
    const outbound = makeScheduleChecker(VOYAGES, "Zamboanga", "Jolo", SUNDAY_MORNING)!;
    const inbound = makeScheduleChecker(VOYAGES, "Jolo", "Zamboanga", SUNDAY_MORNING)!;
    expect(outbound("2026-09-08")).toBe(false);
    expect(inbound("2026-09-08")).toBe(true);
  });

  it("ignores a schedule an admin has deactivated", () => {
    const check = makeScheduleChecker(
      [{ origin: "Zamboanga", destination: "Jolo", rrule: MON, isActive: false }],
      "Zamboanga", "Jolo", SUNDAY_MORNING
    )!;
    expect(check("2026-09-07")).toBe(false);
  });

  it("treats a schedule with no isActive flag as running", () => {
    const check = makeScheduleChecker(VOYAGES, "Zamboanga", "Jolo", SUNDAY_MORNING)!;
    expect(check("2026-09-07")).toBe(true);
  });

  it("keeps today open while the boat is still to leave", () => {
    // Monday 05:00, against an 05:15 sailing.
    const beforeDeparture = new Date(2026, 8, 7, 5, 0);
    const check = makeScheduleChecker(VOYAGES, "Zamboanga", "Jolo", beforeDeparture)!;
    expect(check("2026-09-07")).toBe(true);
  });

  it("closes today once the last boat has gone", () => {
    // The backend stops offering a departure once its time has passed, so
    // leaving today enabled only sends the agent to an empty voyage list.
    const afterDeparture = new Date(2026, 8, 7, 6, 0);
    const check = makeScheduleChecker(VOYAGES, "Zamboanga", "Jolo", afterDeparture)!;
    expect(check("2026-09-07")).toBe(false);
  });

  it("closes today at the departure minute itself", () => {
    const atDeparture = new Date(2026, 8, 7, 5, 15);
    const check = makeScheduleChecker(VOYAGES, "Zamboanga", "Jolo", atDeparture)!;
    expect(check("2026-09-07")).toBe(false);
  });

  it("only closes TODAY, never a future day", () => {
    const afterDeparture = new Date(2026, 8, 7, 6, 0);
    const check = makeScheduleChecker(VOYAGES, "Zamboanga", "Jolo", afterDeparture)!;
    expect(check("2026-09-14")).toBe(true);
  });

  it("keeps today open when the schedule carries no time to judge", () => {
    const dateOnly: RouteVoyage[] = [{
      origin: "Zamboanga", destination: "Jolo",
      rrule: "DTSTART;TZID=Asia/Manila:20260101\nRRULE:FREQ=DAILY",
    }];
    const lateEvening = new Date(2026, 8, 7, 23, 0);
    const check = makeScheduleChecker(dateOnly, "Zamboanga", "Jolo", lateEvening)!;
    expect(check("2026-09-07")).toBe(true);
  });

  it("keeps a later sailing open after an earlier one has gone", () => {
    const twice: RouteVoyage[] = [
      { origin: "Zamboanga", destination: "Jolo", rrule: DAILY },                 // 05:15
      { origin: "Zamboanga", destination: "Jolo",
        rrule: "DTSTART;TZID=Asia/Manila:20260907T180000\nRRULE:FREQ=DAILY" },     // 18:00
    ];
    const midday = new Date(2026, 8, 7, 12, 0);
    const check = makeScheduleChecker(twice, "Zamboanga", "Jolo", midday)!;
    expect(check("2026-09-07")).toBe(true);
  });

  it("refuses a date it cannot parse rather than opening it", () => {
    const check = makeScheduleChecker(VOYAGES, "Zamboanga", "Jolo", SUNDAY_MORNING)!;
    expect(check("07/09/2026")).toBe(false);
    expect(check("")).toBe(false);
  });
});
