// Dependency-free voyage-schedule matcher. The backend decides whether a date
// has a trip by evaluating each schedule's iCal rrule (`check_date_in_rrule`).
// The website reproduces this with the `rrule` + `moment` libraries and has to
// carefully format occurrences in UTC to avoid marking the wrong calendar day
// (the "rrule timezone gotcha"). Here we match entirely in calendar-date space —
// we only ever read the DTSTART's y/m/d and compare integer day-numbers — so
// there is no instant→local conversion to get wrong. That remains true now
// that schedules carry TZID=Asia/Manila: the DTSTART's calendar date is the
// Manila date either way, so nothing here needs to change with the timezone.
//
// The rrules this system uses are simple: FREQ=DAILY and FREQ=WEEKLY;BYDAY=...,
// almost always INTERVAL=1. We still handle INTERVAL>1 and MONTHLY/YEARLY so an
// admin-added schedule doesn't silently mismatch.

export interface ParsedRule {
  startY: number;
  startM: number; // 1-12
  startD: number;
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  byday: number[]; // JS getDay codes (Sun=0 … Sat=6); empty = derive from start
  // Departure time as minutes past midnight, Manila wall clock. Null when the
  // DTSTART carries no time — such a rule can't be judged against the clock, so
  // its day stays available rather than vanishing.
  startMinutes: number | null;
}

const DAY_CODE: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

// Schedules carry their zone as `DTSTART;TZID=Asia/Manila:...`; the bare
// `DTSTART:` form predates that and still exists until /admin/seed migrates a
// database, so both are accepted. The TZID is deliberately ignored rather than
// applied: this matcher works purely in calendar-date space (see the header
// note), and the DTSTART's y/m/d is already the Manila wall-clock date the
// operator scheduled.
const DTSTART_RE = /DTSTART(?:;[^:\n]*)?:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/;

export function parseRRule(rrule: string | null | undefined): ParsedRule | null {
  if (!rrule) return null;
  const dt = DTSTART_RE.exec(rrule);
  if (!dt) return null;
  const freqM = /FREQ=([A-Z]+)/.exec(rrule);
  const freq = (freqM?.[1] as ParsedRule["freq"]) ?? "DAILY";
  const intM = /INTERVAL=(\d+)/.exec(rrule);
  const interval = intM ? Math.max(1, parseInt(intM[1], 10)) : 1;
  const bydayM = /BYDAY=([A-Z,]+)/.exec(rrule);
  const byday = bydayM
    ? bydayM[1]
        .split(",")
        .map((c) => DAY_CODE[c])
        .filter((n) => n !== undefined)
    : [];
  const startMinutes = dt[4] !== undefined ? +dt[4] * 60 + +dt[5] : null;
  return {
    startY: +dt[1],
    startM: +dt[2],
    startD: +dt[3],
    freq,
    interval,
    byday,
    startMinutes,
  };
}

// Integer day-number for a calendar date (UTC epoch days) — DST-proof and cheap
// to diff/compare.
const dayNumber = (y: number, m: number, d: number) =>
  Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);

const utcWeekday = (dn: number) => new Date(dn * 86_400_000).getUTCDay();
const mondayOf = (dn: number) => dn - ((utcWeekday(dn) + 6) % 7);

export function ruleMatchesDate(
  rule: ParsedRule,
  y: number,
  m: number,
  d: number
): boolean {
  const start = dayNumber(rule.startY, rule.startM, rule.startD);
  const target = dayNumber(y, m, d);
  if (target < start) return false;

  switch (rule.freq) {
    case "DAILY":
      return (target - start) % rule.interval === 0;

    case "WEEKLY": {
      const wd = utcWeekday(target);
      const allowed = rule.byday.length ? rule.byday : [utcWeekday(start)];
      if (!allowed.includes(wd)) return false;
      if (rule.interval === 1) return true;
      const weeks = (mondayOf(target) - mondayOf(start)) / 7;
      return weeks % rule.interval === 0;
    }

    case "MONTHLY": {
      if (d !== rule.startD) return false;
      const months = (y - rule.startY) * 12 + (m - rule.startM);
      return months >= 0 && months % rule.interval === 0;
    }

    case "YEARLY":
      return (
        m === rule.startM &&
        d === rule.startD &&
        (y - rule.startY) % rule.interval === 0
      );

    default:
      return false;
  }
}

export interface RouteVoyage {
  origin: string;
  destination: string;
  rrule: string;
  isActive?: boolean;
}

// Local calendar day, matching the todayISO() the booking screen greys from.
// The counter machine keeps Manila time, which is the clock the timetable is
// written in, so local getters are the right ones here.
const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

/**
 * Build a predicate `(iso) => boolean` telling whether the given route runs on a
 * date. Returns `undefined` when we can't know yet (no route chosen, or voyages
 * not loaded) so the calendar leaves every day enabled instead of greying them.
 * When the route is known but has no active schedules in that direction, the
 * predicate reports every day as unavailable (all greyed = "no trips").
 *
 * Today counts as running only while a sailing is still to come: the backend
 * stops offering a departure once its time has passed, so leaving today enabled
 * after the last boat has gone only sends the agent to an empty voyage list.
 */
export function makeScheduleChecker(
  voyages: RouteVoyage[] | null | undefined,
  origin: string,
  destination: string,
  now: Date = new Date()
): ((iso: string) => boolean) | undefined {
  if (!origin || !destination || !voyages || voyages.length === 0) return undefined;

  const rules = voyages
    .filter(
      (v) =>
        v.origin === origin &&
        v.destination === destination &&
        v.isActive !== false
    )
    .map((v) => parseRRule(v.rrule))
    .filter((r): r is ParsedRule => !!r);

  if (rules.length === 0) return () => false;

  const todayISO = localISO(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return false;
    return rules.some((r) => {
      if (!ruleMatchesDate(r, +m[1], +m[2], +m[3])) return false;
      if (iso === todayISO && r.startMinutes !== null && r.startMinutes <= nowMinutes) {
        return false; // that boat has already sailed
      }
      return true;
    });
  };
}
