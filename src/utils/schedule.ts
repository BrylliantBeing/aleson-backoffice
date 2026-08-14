// Dependency-free voyage-schedule matcher. The backend decides whether a date
// has a trip by evaluating each schedule's iCal rrule (`check_date_in_rrule`).
// The website reproduces this with the `rrule` + `moment` libraries and has to
// carefully format occurrences in UTC to avoid marking the wrong calendar day
// (the "rrule timezone gotcha"). Here we match entirely in calendar-date space —
// we only ever read the DTSTART's y/m/d and compare integer day-numbers — so
// there is no instant→local conversion to get wrong.
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

export function parseRRule(rrule: string | null | undefined): ParsedRule | null {
  if (!rrule) return null;
  const dt = /DTSTART:(\d{4})(\d{2})(\d{2})/.exec(rrule);
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
  return { startY: +dt[1], startM: +dt[2], startD: +dt[3], freq, interval, byday };
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

/**
 * Build a predicate `(iso) => boolean` telling whether the given route runs on a
 * date. Returns `undefined` when we can't know yet (no route chosen, or voyages
 * not loaded) so the calendar leaves every day enabled instead of greying them.
 * When the route is known but has no active schedules in that direction, the
 * predicate reports every day as unavailable (all greyed = "no trips").
 */
export function makeScheduleChecker(
  voyages: RouteVoyage[] | null | undefined,
  origin: string,
  destination: string
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

  return (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return false;
    return rules.some((r) => ruleMatchesDate(r, +m[1], +m[2], +m[3]));
  };
}
