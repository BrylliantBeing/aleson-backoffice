import Background from "@/components/Background";
import CustomSelectList from "@/components/CustomSelectList";
import DateField from "@/components/DateField";
import EmailField from "@/components/EmailField";
import IdTypeField from "@/components/IdTypeField";
import MiniCalendar from "@/components/MiniCalendar";
import NationalityField from "@/components/NationalityField";
import PrinterSetupModal from "@/components/PrinterSetupModal";
import SeatAssignModal from "@/components/SeatAssignModal";
import Toast, { ToastRow } from "@/components/Toast";
import TravelDateField from "@/components/TravelDateField";
import VoyageLegPicker from "@/components/VoyageLegPicker";
import Colors from "@/constants/Colors";
import { DEFAULT_NATIONALITY } from "@/constants/nationalities";
import { useAuth } from "@/context/AuthContext";
import { useElementWidth } from "@/hooks/useElementWidth";
import { useLayout } from "@/hooks/useLayout";
import { API_BASE, apiFetch } from "@/utils/api";
import {
  CARGO_REFERENCE_MAX,
  Category,
  CATEGORIES,
  CATEGORY_META,
  CATEGORY_TO_DB,
  FREE_PASS,
  SEAT_OCCUPYING,
  validateDob,
  validateName,
  validatePhone,
} from "@/utils/passengerRules";
import { DEFAULT_CURRENCY, money, moneyWhole } from "@/utils/currency";
import { autoAssignSeats, seatLabels } from "@/utils/seatAssign";
import { makeScheduleChecker, RouteVoyage } from "@/utils/schedule";
import {
  TENDERS,
  TENDER_LABELS,
  clampExternalRef,
  externalRefOk,
  externalRefSpec,
  needsExternalRef,
  normaliseExternalRef,
  quickCashOptions,
} from "@/utils/payment";
import {
  loadPrinterSettings,
  PrinterSettings,
  printTickets,
  DEFAULT_SETTINGS,
} from "@/utils/printer";
import {
  attachServerTickets,
  buildTicketData,
  ServerTicket,
  TicketData,
} from "@/utils/ticketLayout";
import { ClassInfo, TicketType, Voyage } from "@/types/voyage";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  FlexStyle,
  ViewStyle,
} from "react-native";

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayISO = () => isoLocal(new Date());

interface PassengerRow {
  id: string;
  category: Category;
  first_name: string;
  middle_initial: string;
  last_name: string;
  birthdate: string;
  sex: string;
  nationality: string;
  // Government ID shown at the counter: which document it is, and its number.
  // Both required — the manifest is checked against the document presented at
  // boarding, and a number with no document type can't be checked against it.
  id_type: string;
  id_number: string;
  // Consent to share a cabin/suite with the opposite sex. Per passenger, not
  // per booking: the backend evaluates it per occupant, and consent given by
  // one traveller cannot stand in for another's.
  mixed_ok: boolean;
  // Free passes only: the cargo document this free ride was granted against —
  // the plate number or bill of lading on the shipper's paperwork. Per
  // passenger rather than per sale, because one party can escort two vehicles.
  cargo_reference: string;
}

const emptyCounts = (): Record<Category, number> =>
  CATEGORIES.reduce((a, c) => {
    a[c.key] = 0;
    return a;
  }, {} as Record<Category, number>);

const legFare = (
  v: Voyage | undefined,
  className: string,
  counts: Record<Category, number>
): number => {
  if (!v || !className) return 0;
  const cls = v.class_name?.[className];
  if (!cls) return 0;
  const priceByType: Record<string, number> = {};
  cls.ticket_type.forEach((t) => (priceByType[t.type] = t.price));
  let sum = 0;
  for (const c of CATEGORIES) {
    // A free pass is free by definition, not by lookup — it deliberately has no
    // row in `fares` (see FREE_PASS), so there is nothing here to add.
    if (c.key === FREE_PASS) continue;
    const n = counts[c.key] || 0;
    if (n > 0) sum += (priceByType[c.key] ?? 0) * n;
  }
  return sum;
};

/** One passenger's fare for a leg — the amount printed in that ticket's FARE box. */
const paxFare = (
  v: Voyage | undefined,
  className: string,
  category: Category
): number => {
  if (category === FREE_PASS) return 0;
  if (!v || !className) return 0;
  return v.class_name?.[className]?.ticket_type.find((t) => t.type === category)?.price ?? 0;
};

/** Currency a leg's fares are quoted in. Every fare on one sailing/class shares
 *  it, so the first entry answers for the leg. */
const legCurrency = (v: Voyage | undefined, className: string): string | null => {
  if (!v || !className) return null;
  return v.class_name?.[className]?.ticket_type[0]?.currency ?? null;
};

/** Panel widths the passenger table needs for each arrangement. Nine columns
 *  on one line only stop clipping — "ID / Passport" is the first to go — once
 *  the panel clears ~1060px; below ~520 even two lines are too tight and the
 *  row stacks. Both are the panel's outer width, padding included. */
const PAX_ROW_MIN = 1060;
/** Same nine columns plus the cargo reference a free pass carries. Only applies
 *  while a free pass is in the party — an ordinary sale keeps the old width and
 *  the old tier, so nothing about the common case changes. */
const PAX_ROW_CARGO_MIN = 1180;
const PAX_WRAP_MIN = 520;

/** Panel width below which the category steppers drop from two per line to
 *  one. Two-up, each box is ~47% of the panel, and under ~180px the +/-
 *  controls eat the label — leaving nothing but a coloured dot to tell
 *  "Regular" from "Senior". */
const STEPPER_TWO_UP_MIN = 400;

/** Panel width below which Origin and Destination stack instead of sharing a
 *  line. Side by side each select gets under ~135px, which is narrower than a
 *  port name plus its chevron — "Zamboanga" wraps onto a second line. */
const ROUTE_SIDE_BY_SIDE_MIN = 320;

const BookingOffice = () => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  const { compact, medium, wide } = useLayout();
  // Both panels lay out against their own width — see useElementWidth.
  const [paxPanelW, onPaxPanelLayout] = useElementWidth();
  const [paxSetupW, onPaxSetupLayout] = useElementWidth();
  const [tripW, onTripLayout] = useElementWidth();
  const { agent, logout } = useAuth();

  // ── Trip setup ──────────────────────────────────────────────────────────
  const [tripType, setTripType] = useState<"one-way" | "round-trip">("one-way");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [depDate, setDepDate] = useState(todayISO());
  const [retDate, setRetDate] = useState("");
  // Which leg the single shared calendar edits (website's `dateSelection`).
  const [activeLeg, setActiveLeg] = useState<"dep" | "ret">("dep");
  const [counts, setCounts] = useState<Record<Category, number>>(emptyCounts());

  // Route master data from /routes. Kept raw: it lists every route the operator
  // has ever defined, including ones with no sailing on the timetable, so the
  // pickers below narrow it against the schedules before offering it.
  const [routePairs, setRoutePairs] = useState<{ origin: string; destination: string }[]>([]);
  // Port name → ports.code, which the printed voyage number is built from.
  const [portCodes, setPortCodes] = useState<Record<string, string>>({});

  // All active schedules (with rrules) — drives the mini-calendars' "no trips"
  // greying without a per-date round trip.
  const [allVoyages, setAllVoyages] = useState<RouteVoyage[]>([]);

  // ── Voyage + class selection ────────────────────────────────────────────
  const [depVoyages, setDepVoyages] = useState<Voyage[]>([]);
  const [retVoyages, setRetVoyages] = useState<Voyage[]>([]);
  // Bumped after a completed sale to refetch the voyage lists even though the
  // route and date have deliberately NOT changed. The two effects below key off
  // the route and date alone, so without this they never run again once the
  // trip survives a sale — the lists would be cleared and stay empty, and the
  // clerk would have to retype the route to get their sailings back.
  const [voyageReload, setVoyageReload] = useState(0);
  const [loadingDep, setLoadingDep] = useState(false);
  const [loadingRet, setLoadingRet] = useState(false);
  const [depVoyageId, setDepVoyageId] = useState<number | null>(null);
  const [retVoyageId, setRetVoyageId] = useState<number | null>(null);
  const [depClass, setDepClass] = useState("");
  const [retClass, setRetClass] = useState("");

  // ── Seats (aligned to seat-occupying passenger order) ───────────────────
  const [depSeats, setDepSeats] = useState<string[]>([]);
  const [retSeats, setRetSeats] = useState<string[]>([]);
  const [seatModal, setSeatModal] = useState<null | "dep" | "ret">(null);

  // ── Passengers + contact ────────────────────────────────────────────────
  const [passengers, setPassengers] = useState<PassengerRow[]>([]);
  const [contactFirst, setContactFirst] = useState("");
  const [contactLast, setContactLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Which passenger (by id) supplies the contact name, or null for a separate person.
  const [contactPaxId, setContactPaxId] = useState<string | null>(null);

  // ── Payment ──────────────────────────────────────────────────────────────
  const [method, setMethod] = useState<"cash" | "card" | "qrph" | "">("");
  const [tendered, setTendered] = useState("");
  // The tail of the third-party order id, off the card terminal's slip or the
  // AUB app's QR Ph receipt (see EXTERNAL_REF_SPECS). Neither rail is charged through this system, so this is
  // the only handle the end-of-day report can reconcile them by.
  const [externalRef, setExternalRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Confirmed payments surface as a toast over the (already cleared) form — the
  // cashier stays on the booking screen and can start the next sale immediately.
  const [toast, setToast] = useState<
    | {
        reference: string;
        change: number | null;
        method: string;
        total: number;
        // Currency the sale settled in — the change handed back is in the same
        // one, so the toast has to name it.
        currency: string;
        ticketNumbers: (string | null)[] | null;
      }
    | null
  >(null);
  // Measured toast height, used to keep the grid clear of it while it is up.

  // ── Ticket printing ──────────────────────────────────────────────────────
  // Settings are per-counter (which Windows printer to use), so they load from
  // this machine's storage rather than the agent's account.
  const [printerSettings, setPrinterSettings] = useState<PrinterSettings>(DEFAULT_SETTINGS);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printMsg, setPrintMsg] = useState<string | null>(null);
  // The forms for the sale just completed. The booking screen is cleared the
  // instant a payment settles, so the printable ticket has to be captured
  // before the reset — that snapshot is also what Reprint re-sends after a jam.
  const lastTickets = useRef<TicketData[]>([]);

  useEffect(() => {
    loadPrinterSettings().then(setPrinterSettings);
  }, []);

  // The counter this cashier sells at, set by an admin on the account. It picks
  // the serial series their sales are numbered in, but the number itself is
  // taken by the server as each ticket is written — there is nothing here for
  // the cashier to see or set, and a serial they could edit would not be one.
  const ticketStation = agent?.ticket_station ?? null;

  const seatPax = SEAT_OCCUPYING.reduce((s, k) => s + (counts[k] || 0), 0);
  const totalPax = CATEGORIES.reduce((s, c) => s + (counts[c.key] || 0), 0);

  // Fetch route options once.
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/routes`)
      .then((r) => r.json())
      .then(
        (
          rows: {
            origin: string;
            destination: string;
            origin_code?: string;
            destination_code?: string;
          }[]
        ) => {
          const codes: Record<string, string> = {};
          rows.forEach((r) => {
            if (r.origin_code) codes[r.origin] = r.origin_code;
            if (r.destination_code) codes[r.destination] = r.destination_code;
          });
          setRoutePairs(
            rows.map((r) => ({ origin: r.origin, destination: r.destination }))
          );
          setPortCodes(codes);
        }
      )
      .catch(console.error);

    fetch(`${API_BASE}/api/v1/voyages`)
      .then((r) => r.json())
      .then((rows: RouteVoyage[]) => setAllVoyages(Array.isArray(rows) ? rows : []))
      .catch(console.error);
  }, []);

  // Reconcile passenger rows when counts change, preserving entered data.
  useEffect(() => {
    setPassengers((prev) => {
      const next: PassengerRow[] = [];
      for (const c of CATEGORIES) {
        const existing = prev.filter((p) => p.category === c.key);
        const n = counts[c.key] || 0;
        for (let i = 0; i < n; i++) {
          next.push(
            existing[i] ?? {
              id: `${c.key}-${i}`,
              category: c.key,
              first_name: "",
              middle_initial: "",
              last_name: "",
              birthdate: "",
              sex: "",
              nationality: DEFAULT_NATIONALITY,
              id_type: "",
              id_number: "",
              mixed_ok: false,
              cargo_reference: "",
            }
          );
        }
      }
      return next;
    });
  }, [counts]);

  // Mirror the chosen passenger's name into the contact fields (stays in sync as
  // that passenger's name is typed).
  useEffect(() => {
    const p = passengers.find((x) => x.id === contactPaxId);
    if (!p) return;
    setContactFirst(p.first_name);
    setContactLast(p.last_name);
  }, [contactPaxId, passengers]);

  // Default the contact to the sole passenger; drop a stale pick when the passenger
  // set changes. Keyed on the id set so name edits don't re-trigger it.
  const prevPaxIds = useRef("");
  useEffect(() => {
    const ids = passengers.map((p) => p.id).join(",");
    if (ids === prevPaxIds.current) return;
    prevPaxIds.current = ids;
    if (passengers.length === 1) setContactPaxId(passengers[0].id);
    else if (!passengers.some((p) => p.id === contactPaxId)) setContactPaxId(null);
  }, [passengers, contactPaxId]);

  const canPickVoyage =
    !!origin &&
    !!destination &&
    !!depDate &&
    (tripType === "one-way" || !!retDate) &&
    totalPax > 0;

  // Port pickers. A route with no active schedule sails on no date, so offering
  // it only walks the agent into a fully greyed calendar with nothing to explain
  // it — the website derives its ports from the timetable for the same reason.
  // Narrow the route list to the pairs that actually have a sailing; before the
  // schedules land there is nothing to narrow against, so offer the routes as-is
  // rather than briefly showing an empty picker.
  const { origins, destsByOrigin } = useMemo(() => {
    const sailed = new Set(
      allVoyages
        .filter((v) => v.isActive !== false)
        .map((v) => `${v.origin}\u0000${v.destination}`)
    );
    const served =
      sailed.size === 0
        ? routePairs
        : routePairs.filter((r) => sailed.has(`${r.origin}\u0000${r.destination}`));

    const oset = new Set<string>();
    const map: Record<string, string[]> = {};
    served.forEach((r) => {
      oset.add(r.origin);
      (map[r.origin] ??= []).push(r.destination);
    });
    return { origins: [...oset], destsByOrigin: map };
  }, [routePairs, allVoyages]);

  // Calendar greying: which dates the chosen route actually sails. Return leg is
  // the reverse route (destination → origin).
  const depHasVoyage = useMemo(
    () => makeScheduleChecker(allVoyages, origin, destination),
    [allVoyages, origin, destination]
  );
  const retHasVoyage = useMemo(
    () => makeScheduleChecker(allVoyages, destination, origin),
    [allVoyages, destination, origin]
  );

  // One-way has no return leg — keep the shared calendar pointed at departure.
  useEffect(() => {
    if (tripType === "one-way") setActiveLeg("dep");
  }, [tripType]);

  // One calendar for both legs: a tapped day fills whichever leg is active, then
  // advances/swaps like the website so a round trip is two quick taps.
  const pickCalendarDate = (sel: string) => {
    if (activeLeg === "dep") {
      if (tripType === "round-trip" && retDate && sel > retDate) {
        setDepDate(sel);
        setRetDate("");
        setActiveLeg("ret");
      } else {
        setDepDate(sel);
        if (tripType === "round-trip" && !retDate) setActiveLeg("ret");
      }
    } else {
      if (depDate && sel < depDate) {
        setDepDate(sel);
        setRetDate(depDate);
      } else {
        setRetDate(sel);
      }
    }
  };

  const activeDate = activeLeg === "dep" ? depDate : retDate;
  const calMinDate = activeLeg === "dep" ? todayISO() : depDate || todayISO();
  const calHasVoyage = activeLeg === "dep" ? depHasVoyage : retHasVoyage;

  // Fetch departure voyages.
  useEffect(() => {
    if (!origin || !destination || !depDate) {
      setDepVoyages([]);
      return;
    }
    setLoadingDep(true);
    fetch(
      `${API_BASE}/api/v1/voyages/available_seats/${encodeURIComponent(origin)}/${encodeURIComponent(destination)}/${depDate}`
    )
      .then((r) => r.json())
      .then((data: Record<string, Voyage>) => setDepVoyages(Object.values(data)))
      .catch(console.error)
      .finally(() => setLoadingDep(false));
    setDepVoyageId(null);
    setDepClass("");
  }, [origin, destination, depDate, voyageReload]);

  // Fetch return voyages (swapped route).
  useEffect(() => {
    if (tripType !== "round-trip" || !origin || !destination || !retDate) {
      setRetVoyages([]);
      return;
    }
    setLoadingRet(true);
    fetch(
      `${API_BASE}/api/v1/voyages/available_seats/${encodeURIComponent(destination)}/${encodeURIComponent(origin)}/${retDate}`
    )
      .then((r) => r.json())
      .then((data: Record<string, Voyage>) => setRetVoyages(Object.values(data)))
      .catch(console.error)
      .finally(() => setLoadingRet(false));
    setRetVoyageId(null);
    setRetClass("");
  }, [tripType, origin, destination, retDate, voyageReload]);

  const depVoyage = depVoyages.find((v) => v.voyage_id === depVoyageId);
  const retVoyage = retVoyages.find((v) => v.voyage_id === retVoyageId);

  // Cabin/suite bookings are single-gender rooms — offer the mixed-cabin opt-in.
  const isRoomBooking =
    ["Cabin", "Suite"].includes(depClass) ||
    (tripType === "round-trip" && ["Cabin", "Suite"].includes(retClass));

  // Auto-assign departure seats when voyage/class/group size changes.
  useEffect(() => {
    if (!depVoyage || !depClass || seatPax <= 0) {
      setDepSeats([]);
      return;
    }
    const res = autoAssignSeats(
      depVoyage.seat_map,
      depClass,
      depVoyage.unavailable_seats || [],
      seatPax
    );
    setDepSeats(res.ok ? res.seats : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depVoyageId, depClass, seatPax]);

  // Auto-assign return seats.
  useEffect(() => {
    if (tripType !== "round-trip" || !retVoyage || !retClass || seatPax <= 0) {
      setRetSeats([]);
      return;
    }
    const res = autoAssignSeats(
      retVoyage.seat_map,
      retClass,
      retVoyage.unavailable_seats || [],
      seatPax
    );
    setRetSeats(res.ok ? res.seats : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retVoyageId, retClass, seatPax, tripType]);

  const depAvail = depVoyage && depClass ? depVoyage.availablility?.[depClass] ?? 0 : 0;
  const retAvail = retVoyage && retClass ? retVoyage.availablility?.[retClass] ?? 0 : 0;

  const total =
    legFare(depVoyage, depClass, counts) +
    (tripType === "round-trip" ? legFare(retVoyage, retClass, counts) : 0);

  // One booking is paid as one amount, so both legs must price in the same
  // currency — nothing converts PHP to MYR. The backend rejects a mixed cart;
  // catching it here keeps the cashier from reaching the payment screen first.
  const depCurrency = legCurrency(depVoyage, depClass);
  const retCurrency = tripType === "round-trip" ? legCurrency(retVoyage, retClass) : null;
  const currency = depCurrency ?? retCurrency ?? DEFAULT_CURRENCY;
  const mixedCurrency =
    !!depCurrency && !!retCurrency && depCurrency !== retCurrency;

  const depReady = depVoyageId != null && !!depClass;
  const retReady = tripType === "one-way" || (retVoyageId != null && !!retClass);
  const seatsOk =
    seatPax <= depAvail &&
    depSeats.length === seatPax &&
    (tripType === "one-way" || (seatPax <= retAvail && retSeats.length === seatPax));
  const revealed = depReady && retReady;

  // Printed seat labels for the two legs, so the agent reads the same numbers
  // the operator's seat chart shows rather than the stored (prefixed) name.
  const depSeatLabels = useMemo(() => seatLabels(depVoyage?.seat_map), [depVoyage]);
  const retSeatLabels = useMemo(() => seatLabels(retVoyage?.seat_map), [retVoyage]);

  // Seat for a given passenger (aligned to seat-occupying order).
  const seatByPassenger = useMemo(() => {
    const map: Record<string, { dep: string | null; ret: string | null }> = {};
    let si = 0;
    for (const p of passengers) {
      if (CATEGORY_META[p.category].seatOccupying) {
        map[p.id] = { dep: depSeats[si] ?? null, ret: retSeats[si] ?? null };
        si++;
      } else {
        map[p.id] = { dep: null, ret: null };
      }
    }
    return map;
  }, [passengers, depSeats, retSeats]);

  // --- Seat holds ----------------------------------------------------------
  // The counter used to hold nothing. While a cashier entered passenger details
  // and counted out cash, the website could send somebody to a payment page for
  // the same berth; whoever confirmed second was refused at the till, with the
  // money already on the counter. The website has claimed a per-seat hold from
  // its picker all along, so the counter now does the same and the two compete
  // for inventory on equal terms instead of the counter always finding out last.
  //
  // A ref, not state: nothing renders from it, and it must survive the
  // re-render that every seat change causes without restarting the effect.
  const holdIdRef = useRef<string | null>(null);
  // Joined rather than passed as arrays — a fresh array identity on every
  // render would re-claim the hold in a loop.
  const depSeatKey = depSeats.join(",");
  const retSeatKey = retSeats.join(",");

  const releaseHold = React.useCallback(() => {
    const id = holdIdRef.current;
    if (!id) return;
    holdIdRef.current = null;
    // Best-effort: an abandoned cart should not sit on inventory for the full
    // TTL, but a failed release is not worth showing the cashier.
    apiFetch(`/api/v1/seat-holds/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => {}
    );
  }, []);

  useEffect(() => {
    const legs: any[] = [];
    // seat_meta carries gender + consent so a held berth can still drive the
    // single-gender cabin rule before it has a ticket to read them from.
    const metaFor = (which: "dep" | "ret") => {
      const meta: Record<string, { gender: string | null; mixed_ok: boolean }> = {};
      for (const p of passengers) {
        const seat = seatByPassenger[p.id]?.[which];
        if (seat) meta[seat] = { gender: p.sex || null, mixed_ok: !!p.mixed_ok };
      }
      return meta;
    };
    if (depVoyageId && depDate && depSeats.length) {
      legs.push({
        schedule_id: depVoyageId,
        date: depDate,
        class_name: depClass,
        seats: depSeats,
        seat_meta: metaFor("dep"),
      });
    }
    if (tripType === "round-trip" && retVoyageId && retDate && retSeats.length) {
      legs.push({
        schedule_id: retVoyageId,
        date: retDate,
        class_name: retClass,
        seats: retSeats,
        seat_meta: metaFor("ret"),
      });
    }
    if (!legs.length) return;

    let cancelled = false;
    // Debounced: the counter auto-assigns a whole party at once and the cashier
    // may then override individual berths, so this settles rather than firing
    // per keystroke.
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch("/api/v1/seat-holds", {
          method: "POST",
          body: JSON.stringify({ hold_id: holdIdRef.current, legs }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data?.hold_id) {
          holdIdRef.current = data.hold_id;
        } else if (res.status === 409) {
          // Somebody else is buying one of these berths right now. Say so here,
          // at the seat step, rather than letting the cashier discover it after
          // taking the money.
          setErrorMsg(
            typeof data?.detail === "string"
              ? data.detail
              : data?.detail?.message ||
                  "Someone else is booking one of these seats. Please pick another."
          );
        }
      } catch {
        // Offline or the API is down: the sale is refused at /office/payment
        // anyway, so there is nothing useful to say at this point.
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    depVoyageId, depDate, depClass, depSeatKey,
    retVoyageId, retDate, retClass, retSeatKey,
    tripType,
  ]);

  // Heartbeat. The hold's TTL is minutes and a counter sale can easily take
  // longer than that, so keep it alive for as long as this cart is open.
  useEffect(() => {
    const beat = setInterval(() => {
      const id = holdIdRef.current;
      if (!id) return;
      apiFetch("/api/v1/seat-holds/renew", {
        method: "POST",
        body: JSON.stringify({ hold_id: id }),
      }).catch(() => {});
    }, 60_000);
    return () => clearInterval(beat);
  }, []);

  // Give the berths back if the cashier walks away from the screen entirely.
  useEffect(() => releaseHold, [releaseHold]);

  // --- One click, one sale --------------------------------------------------
  // /office/payment settles cash on the spot, so a response lost on the way
  // back left the cashier looking at "Could not reach the server" for a sale
  // that had gone through — and clicking again booked the party twice. The key
  // is generated once per cart and resent unchanged, so the server can tell a
  // retry from a second sale. Cleared only when the cart is.
  const idemKeyRef = useRef<string | null>(null);
  const idempotencyKey = () => {
    if (!idemKeyRef.current) {
      idemKeyRef.current =
        globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
        `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    }
    return idemKeyRef.current;
  };

  const dobErrors = passengers.map((p) => validateDob(p.category, p.birthdate, p.id_type));
  // Names are matched against the ID at the gate, so a lone initial isn't enough.
  const nameErrors = passengers.map((p) => ({
    first: validateName(p.first_name, "First name"),
    last: validateName(p.last_name, "Last name"),
  }));

  // A RO/RO cargo escort can ride beside paying passengers, or be the whole
  // sale. The second is a different transaction and not merely a cheaper one:
  // there is no money to take, so it goes to its own endpoint rather than
  // through a payment rail (see handleConfirm), and the payment half of this
  // screen has nothing to ask for.
  const hasFreePass = passengers.some((p) => p.category === FREE_PASS);
  const freePassOnly =
    passengers.length > 0 && passengers.every((p) => p.category === FREE_PASS);

  // Contact-person picker: label each passenger like its detail row ("Regular 1").
  const contactBound = contactPaxId != null;
  const contactPaxOptions = passengers.map((p, i) => ({
    id: p.id,
    label: `${CATEGORY_META[p.category].label} ${
      passengers.slice(0, i + 1).filter((x) => x.category === p.category).length
    }`,
  }));

  const setCount = (key: Category, delta: number) =>
    setCounts((c) => ({ ...c, [key]: Math.max(0, (c[key] || 0) + delta) }));

  // Names go on the manifest, which is read at the pier and by Malaysian
  // immigration on the Sandakan run, so they are folded to upper case as they
  // are keyed — the counter has always written them that way, and a row typed
  // "dela cruz" should not print differently from the one beside it. Done on
  // the way into state rather than on submit so the clerk sees what will be
  // printed while they can still fix it.
  const NAME_KEYS = ["first_name", "middle_initial", "last_name"] as const;

  const updatePassenger = (id: string, patch: Partial<PassengerRow>) => {
    const next = { ...patch };
    for (const k of NAME_KEYS) {
      const v = next[k];
      if (typeof v === "string") next[k] = v.toUpperCase();
    }
    setPassengers((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  };

  // Enter/next focus chain across passenger-detail inputs. Each row contributes
  // 6 typed fields in visual order — first, MI, last, birthdate, ID type, ID
  // number (the sex toggle and the nationality dropdown aren't typed, so
  // they're skipped) — and the last field rolls over into the next passenger's
  // first name.
  const PAX_FIELDS = 6;
  // Row whose ID-type suggestions are showing. Each row sets its own stacking
  // order, so the list can only spill out of one if that row is lifted above
  // its neighbours — and which neighbours it has to clear depends on whether
  // the list opened downward or (on the last row of the scroller) upward.
  const [idTypeOpenRow, setIdTypeOpenRow] = useState<string | null>(null);
  const paxInputRefs = useRef<Record<number, TextInput | null>>({});
  const focusPaxField = (flatIndex: number) =>
    paxInputRefs.current[flatIndex + 1]?.focus();

  // Leaving the last passenger's ID number goes straight to the phone box.
  // Between the two sit the contact-person chips and the two contact-name
  // fields, which the clerk almost never touches — the contact defaults to the
  // sole passenger and the names mirror whoever is picked — so tabbing through
  // them was three dead stops on the way to the one box still worth typing.
  // Picking a different contact person is still there for the sale that needs
  // it; it is just no longer on the path of the sale that doesn't.
  const phoneRef = useRef<TextInput | null>(null);
  const tabToPhone = (e: any) => {
    const key = e?.nativeEvent?.key ?? e?.key;
    // Shift+Tab still walks back up the row it came from.
    const shifted = e?.nativeEvent?.shiftKey ?? e?.shiftKey;
    if (key !== "Tab" || shifted) return;
    e?.preventDefault?.();
    phoneRef.current?.focus();
  };
  // Which field ends the last row depends on the row: a free pass carries one
  // more after the ID number, and jumping to the phone box from the ID would
  // tab straight past the cargo reference the sale cannot go through without.
  const skipToPhone = (i: number) => (e: any) => {
    if (i !== passengers.length - 1) return;
    if (passengers[i]?.category === FREE_PASS) return;
    tabToPhone(e);
  };
  const skipFromCargo = (i: number) => (e: any) => {
    if (i !== passengers.length - 1) return;
    tabToPhone(e);
  };

  // Validation gate for submission.
  const passengersComplete =
    passengers.length > 0 &&
    passengers.every(
      (p, i) =>
        !nameErrors[i].first &&
        p.middle_initial.trim() &&
        !nameErrors[i].last &&
        p.birthdate &&
        p.sex &&
        p.nationality.trim() &&
        !dobErrors[i]
    );
  // Neither a phone nor an email is required at the counter. A walk-up
  // passenger often has neither to give, and they leave holding the printed
  // ticket rather than waiting on a confirmation email. Only a number that was
  // actually typed has to be a real one.
  const phoneError = validatePhone(phone, false);
  const tenderedNum = parseFloat(tendered) || 0;
  const cashOk = method !== "cash" || tenderedNum >= total;
  const change = method === "cash" ? tenderedNum - total : null;
  const quickTenders = quickCashOptions(total);

  // The two tenders that settle somewhere else and have to be tied back to it.
  const needsRef = needsExternalRef(method);
  const refClean = normaliseExternalRef(externalRef);
  const refOk = externalRefOk(method, externalRef);
  const refSpec = externalRefSpec(method);

  // Every reason this sale cannot go through, phrased as the fix and ordered the
  // way the cashier works down the screen. Confirm stays pressable while these
  // exist so a press names what is missing instead of doing nothing — a dead
  // button at the counter looks like a broken printer or a broken server.
  const missingPaxFields = (p: PassengerRow) => {
    const missing: string[] = [];
    if (!p.first_name.trim()) missing.push("first name");
    if (!p.last_name.trim()) missing.push("last name");
    if (!p.birthdate) missing.push("birthdate");
    if (!p.sex) missing.push("sex");
    if (!p.nationality.trim()) missing.push("nationality");
    // Infants ride on a lap under the parent's document and hold no ID of their
    // own, so theirs is optional rather than hidden — the family often does have
    // a passport for them, and Malaysian immigration wants it on the Sandakan
    // run. Half an entry is still rejected: a number with no document type
    // can't be checked against anything at the gate.
    const idOptional = p.category === "infant";
    const hasIdType = !!p.id_type.trim();
    const hasIdNumber = !!p.id_number.trim();
    if (!hasIdType && (!idOptional || hasIdNumber)) missing.push("ID type");
    if (!hasIdNumber && (!idOptional || hasIdType)) missing.push("ID number");
    // The whole audit trail for a free ride. Nothing else on the row records
    // which shipment it belonged to, and there is no cargo module to look it up
    // in later — if it is not keyed here it is gone.
    if (p.category === FREE_PASS && !p.cargo_reference.trim()) {
      missing.push("cargo reference");
    }
    return missing;
  };

  const confirmBlockers: string[] = [];
  // The station is printed on the ticket and identifies the counter on the
  // end-of-day report, so a sale still needs one — it just no longer has
  // anything to do with the ticket's number.
  if (!ticketStation) {
    confirmBlockers.push(
      "This account has no ticket counter assigned — an admin has to set one before you can sell."
    );
  }
  if (!depReady) confirmBlockers.push("Choose the departure voyage and class.");
  if (!retReady) confirmBlockers.push("Choose the return voyage and class.");
  if (revealed && !seatsOk) {
    confirmBlockers.push(
      `Assign ${seatPax} seat(s) — this class does not have that many free.`
    );
  }
  if (passengers.length === 0) {
    confirmBlockers.push("Add at least one passenger.");
  } else {
    passengers.forEach((p, i) => {
      const label = contactPaxOptions[i]?.label ?? `Passenger ${i + 1}`;
      const missing = missingPaxFields(p);
      const shortName = nameErrors[i].first ?? nameErrors[i].last;
      if (missing.length) {
        confirmBlockers.push(`${label}: fill in ${missing.join(", ")}.`);
      } else if (shortName) {
        confirmBlockers.push(`${label}: ${shortName}`);
      } else if (dobErrors[i]) {
        confirmBlockers.push(`${label}: ${dobErrors[i]}`);
      }
    });
  }
  if (!contactLast.trim()) confirmBlockers.push("Enter the contact person's last name.");
  if (phoneError) confirmBlockers.push(`Contact phone: ${phoneError}`);
  // A free-pass-only sale charges nothing, so there is no tender to choose and
  // no drawer to reconcile — and a zero total is the expected outcome rather
  // than the symptom of a missing fare it would be on any other sale.
  if (!freePassOnly) {
    if (!method) {
      confirmBlockers.push("Choose a payment method.");
    } else if (!cashOk) {
      confirmBlockers.push(
        `Cash tendered (${money(tenderedNum, currency)}) is less than the total ${money(
          total,
          currency
        )}.`
      );
    }
    if (!refOk) {
      confirmBlockers.push(
        method === "card"
          ? "Key the last 5 characters of the card terminal reference."
          : "Key the last 4 digits of the AUB Platform Order ID."
      );
    }
    if (revealed && total <= 0) {
      confirmBlockers.push("This sale totals zero — check the fares for the selected class.");
    }
  }
  if (mixedCurrency) {
    confirmBlockers.push(
      `This trip mixes ${depCurrency} and ${retCurrency} fares — sell the two legs as separate bookings.`
    );
  }

  const blockerMessage = () =>
    confirmBlockers.length === 1
      ? confirmBlockers[0]
      : `Can't confirm payment yet:\n${confirmBlockers.map((b) => `• ${b}`).join("\n")}`;

  const canConfirm = confirmBlockers.length === 0 && !submitting;

  const buildBooking = () => {
    let si = 0;
    const pax = passengers.map((p) => {
      const occ = CATEGORY_META[p.category].seatOccupying;
      const depSeat = occ ? depSeats[si] ?? null : null;
      const retSeat = occ ? retSeats[si] ?? null : null;
      if (occ) si++;
      return {
        first_name: p.first_name.trim(),
        middle_initial: p.middle_initial.trim(),
        last_name: p.last_name.trim(),
        birthdate: p.birthdate,
        gender: p.sex,
        nationality: p.nationality.trim() || DEFAULT_NATIONALITY,
        id_type: p.id_type.trim() || null,
        id_number: p.id_number.trim() || null,
        passenger_type: CATEGORY_TO_DB[p.category],
        // Only a free pass carries one, and the server refuses the sale if it
        // is blank — so this is the last point at which it can be lost.
        cargo_reference:
          p.category === FREE_PASS ? p.cargo_reference.trim() : null,
        mixed_ok: p.mixed_ok,
        departure_seat: depSeat,
        return_seat: retSeat,
      };
    });

    const departure = {
      schedule_id: depVoyageId,
      accommodation_class: depClass,
      date: `${depDate}T${depVoyage?.departure_time || "00:00:00"}`,
      origin,
      destination,
      seats: depSeats,
    };
    const return_trip =
      tripType === "round-trip"
        ? {
            schedule_id: retVoyageId,
            accommodation_class: retClass,
            date: `${retDate}T${retVoyage?.departure_time || "00:00:00"}`,
            origin: destination,
            destination: origin,
            seats: retSeats,
          }
        : null;

    return {
      contact: {
        first_name: contactFirst.trim(),
        last_name: contactLast.trim(),
        guest_email: email.trim(),
        guest_phone: phone.trim(),
        total_price: total,
      },
      departure,
      return_trip,
      passengers: pax,
      // The hold these berths were claimed under, so the server extends it for
      // the payment rather than minting a second one and colliding with our own
      // claim. Null before the hold lands (or if Valkey is down); the server
      // mints one in that case, exactly as it did before the counter held.
      hold_id: holdIdRef.current,
      // Neither the station nor the serial is sent: the server takes the station
      // from the selling agent's account and assigns serials from that counter's
      // sequence, so a client can neither pick its own numbers nor collide with
      // another counter mid-sale.
    };
  };

  /**
   * One printable ticket per passenger the server is about to create.
   *
   * Order matters: the backend numbers tickets departure-leg-first, all
   * passengers in row order, then the return leg (see _insert_leg_tickets), and
   * `attachServerTickets` pairs the returned serials and boarding tokens back by
   * position. Printing in any other order would put one passenger's QR on
   * another's ticket and board the wrong person.
   */
  const buildTickets = (): TicketData[] => {
    const issuedDateISO = todayISO();
    const tripKind = tripType === "one-way" ? "ONE WAY" : "ROUND TRIP";
    const legs = [
      {
        voyage: depVoyage,
        className: depClass,
        dateISO: depDate,
        from: origin,
        to: destination,
        seats: depSeats,
        labels: depSeatLabels,
      },
      ...(tripType === "round-trip"
        ? [
            {
              voyage: retVoyage,
              className: retClass,
              dateISO: retDate,
              from: destination,
              to: origin,
              seats: retSeats,
              labels: retSeatLabels,
            },
          ]
        : []),
    ];

    const out: TicketData[] = [];
    for (const leg of legs) {
      // Seats are handed out to seat-occupying passengers only, in row order —
      // the same walk buildBooking does, so a lap infant does not consume one.
      let si = 0;
      for (const p of passengers) {
        // The ticket prints the number painted on the seat, not the stored
        // (class-prefixed) name the manifest is keyed by.
        const seatName = CATEGORY_META[p.category].seatOccupying
          ? leg.seats[si++] ?? null
          : null;
        const seat = seatName ? leg.labels[seatName] ?? seatName : null;
        out.push(
          buildTicketData(
            {
              vessel: leg.voyage?.vessel_name ?? "",
              origin: leg.from,
              destination: leg.to,
              originCode: portCodes[leg.from] ?? "",
              destinationCode: portCodes[leg.to] ?? "",
              departDateISO: leg.dateISO,
              departTime: leg.voyage?.departure_time ?? null,
              accommodation: leg.className,
              tripKind,
              ticketStation: ticketStation ?? "",
              issuedBy: agent?.name ?? "",
              issuedDateISO,
            },
            {
              firstName: p.first_name,
              middleInitial: p.middle_initial,
              lastName: p.last_name,
              birthdate: p.birthdate,
              sex: p.sex,
              nationality: p.nationality,
              fare: paxFare(leg.voyage, leg.className, p.category),
              currency: legCurrency(leg.voyage, leg.className) ?? currency,
              seat,
              passengerType: CATEGORY_TO_DB[p.category],
              // A zero fare alone would print as an ordinary ticket that
              // happens to cost nothing — which is what a lap infant is. The
              // paper has to say which of the two this is, and what shipment
              // it was issued against, or the gate cannot tell them apart.
              freePass: p.category === FREE_PASS,
              cargoReference: p.cargo_reference.trim(),
            }
          )
        );
      }
    }
    return out;
  };

  /**
   * Send the captured forms to the counter's printer. Never blocks the sale:
   * the money is already taken and the booking already exists, so a printer
   * that is off or jammed becomes a message plus a Reprint button, not an error
   * on a completed transaction.
   */
  const printCapturedTickets = async (settings = printerSettings) => {
    if (!settings.enabled || lastTickets.current.length === 0) return;
    setPrintMsg(null);
    const result = await printTickets(lastTickets.current, settings);
    setPrintMsg(
      result.ok ? null : `Ticket did not print: ${result.error} Use Reprint once it's fixed.`
    );
  };

  const handleConfirm = async () => {
    setErrorMsg(null);
    setPrintMsg(null);
    // Nothing is charged and nothing prints until the form is complete, so say
    // exactly which fields are holding the sale up.
    if (confirmBlockers.length) {
      setErrorMsg(blockerMessage());
      return;
    }
    setSubmitting(true);
    // Snapshot the forms while the booking screen still holds the data — for QR
    // it settles minutes later, long after the cashier has moved on.
    lastTickets.current = buildTickets();
    try {
      // Nothing to charge means no payment rail at all: every one of them
      // refuses an amount of zero on purpose, so a sale that is only free
      // passes is issued through its own counter-authenticated endpoint.
      const res = await apiFetch(
        freePassOnly ? "/api/v1/office/free-pass" : "/api/v1/office/payment",
        {
          method: "POST",
          body: JSON.stringify(
            freePassOnly
              ? { booking: buildBooking(), idempotency_key: idempotencyKey() }
              : {
                  amount: total,
                  method,
                  tendered: method === "cash" ? tenderedNum : null,
                  external_ref: needsRef ? refClean : null,
                  booking: buildBooking(),
                  idempotency_key: idempotencyKey(),
                }
          ),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(
          data?.detail ||
            (freePassOnly
              ? "Could not issue the free pass. Please try again."
              : "Payment failed. Please try again.")
        );
        return;
      }
      completeSale({
        reference: data.booking_reference,
        change: data.change ?? null,
        method: freePassOnly ? "free_pass" : method,
        total,
        currency: data.currency ?? currency,
        ticketNumbers: data.ticket_numbers ?? null,
      }, data.tickets ?? null);
    } catch {
      setErrorMsg("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  // Clear the passengers and the payment, keep the sailing.
  //
  // A counter works a queue for one departure: the next customer almost always
  // wants the same route on the same day, and re-picking trip type, origin,
  // destination and date for every sale was four controls of pure repetition.
  // So the trip survives and only the party resets — passenger counts back to
  // zero, which is what makes the next sale start from a clean slate.
  //
  // The chosen voyage and class do NOT survive, deliberately: seat availability
  // has just changed by the sale that was made, and keeping the old lists would
  // offer seats sold thirty seconds ago. Dropping them is not enough on its own
  // — the fetch effects watch the route and date, which no longer change here —
  // so the reload counter is what actually brings the sailings back.
  const resetForNextSale = () => {
    setCounts(emptyCounts());
    // A completed sale already released its hold server-side (finalize_booking
    // does it once the tickets exist); this covers the cart being cleared
    // without a sale, and drops our copy of the id either way.
    releaseHold();
    // A new customer is a new sale: carrying the old key over would make the
    // first confirm replay the previous booking instead of taking this one.
    idemKeyRef.current = null;
    // Cleared for the instant before the refetch lands, so seats sold by the
    // sale just made are never briefly offered to the next customer.
    setDepVoyages([]);
    setRetVoyages([]);
    setVoyageReload((n) => n + 1);
    setDepVoyageId(null);
    setRetVoyageId(null);
    setDepClass("");
    setRetClass("");
    setDepSeats([]);
    setRetSeats([]);
    setPassengers([]);
    setContactFirst("");
    setContactLast("");
    setContactPaxId(null);
    setPhone("");
    setEmail("");
    setMethod("");
    setTendered("");
    setExternalRef("");
    setErrorMsg(null);
  };

  // Clear the counter for the next sale, then announce the completed one. The
  // toast keeps the reference, change and ticket numbers on screen while the
  // cashier hands over the money — no separate receipt screen to dismiss.
  const completeSale = (
    sale: NonNullable<typeof toast>,
    serverTickets?: ServerTicket[] | null
  ) => {
    // The serial and the boarding token are both assigned by the server, so the
    // snapshot taken before the call is incomplete until they are paired back in.
    lastTickets.current = attachServerTickets(lastTickets.current, serverTickets);
    resetForNextSale();
    setToast(sale);
    // Fire and forget: printing must not delay clearing the counter, and its
    // outcome is reported separately so a paper jam never looks like a failed sale.
    void printCapturedTickets();
  };

  // A settled free-pass sale reads differently everywhere it is reported: no
  // money came in, so "Total paid P 0.00" would be a statement about the
  // drawer that is not true of it.
  const freePassSale = toast?.method === "free_pass";
  const toastRows: ToastRow[] = toast
    ? [
        freePassSale
          ? { label: "Charged", value: "No charge" }
          : { label: "Total paid", value: money(toast.total, toast.currency) },
        {
          label: "Payment",
          value: freePassSale
            ? "FREE PASS"
            : TENDER_LABELS[toast.method as keyof typeof TENDER_LABELS]
              ?? toast.method.toUpperCase(),
        },
        ...(toast.change != null
          ? [{ label: "Change", value: money(toast.change, toast.currency), accent: true }]
          : []),
        ...(toast.ticketNumbers ?? []).map((tn, i) => ({
          label: `Ticket — passenger ${i + 1}`,
          value: tn || "—",
        })),
      ]
    : [];

  const inputStyle = [
    styles.cInput,
    { borderColor: theme.border, color: theme.text, backgroundColor: theme.control },
  ];
  const panelChrome = { backgroundColor: theme.cardBackground, borderColor: theme.border };

  // Only the wide desk layout is sized to the viewport: there the three columns
  // split the height and each panel scrolls in its own box. Anywhere narrower
  // the page itself scrolls, so panels must size to their content — `flex: 1`
  // inside a scroller collapses them to nothing.
  const paneFill: ViewStyle | null = wide ? { flex: 1 } : null;
  const gridStyle = wide
    ? [styles.grid, styles.gridFill]
    : medium
      ? [styles.grid, styles.gridWrap]
      : [styles.gridStack];
  // Medium keeps Trip and Voyage side by side and drops Passenger Details onto
  // its own full-width row — the pax table is what actually needs the width,
  // and a full row there is wider than the 2.2fr column it gets on a desk.
  const halfCol: ViewStyle = { flexBasis: "48%", flexGrow: 1, minWidth: 0 };
  const colTrip: ViewStyle | null = wide ? { flex: 0.85 } : compact ? null : halfCol;
  const colVoyage: ViewStyle | null = wide ? { flex: 0.95 } : compact ? null : halfCol;
  const colPax: ViewStyle | null = wide ? { flex: 2.2 } : compact ? null : { flexBasis: "100%" };

  const routeSideBySide =
    tripW === null ? !compact : tripW >= ROUTE_SIDE_BY_SIDE_MIN;

  // Two steppers per line while the panel can still give each one its label;
  // one per line otherwise. Same reasoning as the passenger table below.
  const stepperTwoUp =
    paxSetupW === null ? !compact : paxSetupW >= STEPPER_TWO_UP_MIN;

  // How the nine passenger columns are arranged is decided by the panel's own
  // width, not the window's: on a desk screen this panel is one column of a
  // three-column grid, so a 1280px window gives it less room than a 1024px one
  // (where it spans the full page). Measuring the panel is what keeps the
  // fields legible at every width instead of only the two the grid was drawn
  // for. Before the first layout pass, fall back to the viewport's own guess.
  const paxTier: "row" | "wrap" | "stack" =
    paxPanelW === null
      ? wide
        ? "row"
        : compact
          ? "stack"
          : "wrap"
      : paxPanelW >= (hasFreePass ? PAX_ROW_CARGO_MIN : PAX_ROW_MIN)
        ? "row"
        : paxPanelW >= PAX_WRAP_MIN
          ? "wrap"
          : "stack";

  // Below a single line the row wraps into lines instead: at "wrap" the name
  // and the travel document get a line each; at "stack" (a phone) it breaks
  // down further into name, birthdate/sex, then document. The bases decide
  // where the breaks fall — each line sums under 100% and the next field
  // pushes past it — and the grows keep each line flush. The sums leave room
  // for the 6px gaps, which count against the 100% too.
  const paxCell =
    paxTier === "stack"
      ? {
          cat: { flexBasis: "100%", flexGrow: 1 } as FlexStyle,
          first: { flexBasis: "38%", flexGrow: 38 } as FlexStyle,
          mi: { flexBasis: "13%", flexGrow: 13 } as FlexStyle,
          last: { flexBasis: "38%", flexGrow: 38 } as FlexStyle,
          dob: { flexBasis: "55%", flexGrow: 55 } as FlexStyle,
          sex: { flexBasis: "33%", flexGrow: 33 } as FlexStyle,
          nat: { flexBasis: "46%", flexGrow: 46 } as FlexStyle,
          idType: { flexBasis: "46%", flexGrow: 46 } as FlexStyle,
          id: { flexBasis: "100%", flexGrow: 1 } as FlexStyle,
          cargo: { flexBasis: "100%", flexGrow: 1 } as FlexStyle,
          mixed: { flexBasis: "100%", flexGrow: 1 } as FlexStyle,
        }
      : paxTier === "wrap"
        ? {
            cat: { flexBasis: "21%", flexGrow: 21 } as FlexStyle,
            first: { flexBasis: "31%", flexGrow: 31 } as FlexStyle,
            mi: { flexBasis: "9%", flexGrow: 9 } as FlexStyle,
            last: { flexBasis: "31%", flexGrow: 31 } as FlexStyle,
            dob: { flexBasis: "18%", flexGrow: 18 } as FlexStyle,
            sex: { flexBasis: "13%", flexGrow: 13 } as FlexStyle,
            nat: { flexBasis: "19%", flexGrow: 19 } as FlexStyle,
            idType: { flexBasis: "20%", flexGrow: 20 } as FlexStyle,
            id: { flexBasis: "20%", flexGrow: 20 } as FlexStyle,
            cargo: { flexBasis: "100%", flexGrow: 1 } as FlexStyle,
            mixed: { flexBasis: "100%", flexGrow: 1 } as FlexStyle,
          }
        : null;
  const hint = (msg: string) => (
    <Text style={{ color: theme.greyText, fontSize: 13, fontStyle: "italic" }}>{msg}</Text>
  );

  const paxRows = passengers.map((p, i) => {
    const meta = CATEGORY_META[p.category];
    const seat = seatByPassenger[p.id];
    const nth = passengers
      .slice(0, i + 1)
      .filter((x) => x.category === p.category).length;
    return (
      <View
        key={p.id}
        style={[
          styles.paxRow,
          paxTier !== "row" && styles.paxRowWrap,
          {
            borderLeftColor: meta.color,
            backgroundColor: meta.color + "0d",
            // Descending by row order, so the ID-type suggestions dropping out
            // of one row float over the rows below instead of being buried by
            // them — equal z-indexes hand it to whichever paints last. The open
            // row clears every other row, either way its list opened.
            zIndex:
              idTypeOpenRow === p.id ? passengers.length + 1 : passengers.length - i,
          },
        ]}
      >
        <View style={[styles.cCat, paxCell?.cat]}>
          <Text style={{ color: theme.text, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
            {meta.label} {nth}
          </Text>
          <Text style={{ color: theme.greyText, fontSize: 10 }} numberOfLines={1}>
            {meta.seatOccupying
              ? `Seat ${(seat?.dep && depSeatLabels[seat.dep]) ?? seat?.dep ?? "—"}${
                  tripType === "round-trip"
                    ? ` / ${(seat?.ret && retSeatLabels[seat.ret]) ?? seat?.ret ?? "—"}`
                    : ""
                }`
              : "Lap"}
          </Text>
        </View>
        <TextInput
          ref={(el) => {
            paxInputRefs.current[i * PAX_FIELDS + 0] = el;
          }}
          style={[
            inputStyle,
            styles.cFirst,
            paxCell?.first,
            !!p.first_name && !!nameErrors[i].first && styles.cInputInvalid,
          ]}
          value={p.first_name}
          onChangeText={(v) => updatePassenger(p.id, { first_name: v })}
          placeholder="First"
          placeholderTextColor={theme.greyText}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => focusPaxField(i * PAX_FIELDS + 0)}
        />
        <TextInput
          ref={(el) => {
            paxInputRefs.current[i * PAX_FIELDS + 1] = el;
          }}
          style={[inputStyle, styles.cMi, paxCell?.mi]}
          value={p.middle_initial}
          onChangeText={(v) => updatePassenger(p.id, { middle_initial: v.slice(0, 2) })}
          placeholder="MI"
          maxLength={2}
          placeholderTextColor={theme.greyText}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => focusPaxField(i * PAX_FIELDS + 1)}
        />
        <TextInput
          ref={(el) => {
            paxInputRefs.current[i * PAX_FIELDS + 2] = el;
          }}
          style={[
            inputStyle,
            styles.cLast,
            paxCell?.last,
            !!p.last_name && !!nameErrors[i].last && styles.cInputInvalid,
          ]}
          value={p.last_name}
          onChangeText={(v) => updatePassenger(p.id, { last_name: v })}
          placeholder="Last"
          placeholderTextColor={theme.greyText}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => focusPaxField(i * PAX_FIELDS + 2)}
        />
        <View style={[styles.cDob, paxCell?.dob]}>
          <DateField
            ref={(el) => {
              paxInputRefs.current[i * PAX_FIELDS + 3] = el;
            }}
            mode="past"
            value={p.birthdate}
            onChange={(d) => updatePassenger(p.id, { birthdate: d })}
            inputStyle={styles.cInput}
            error={!!p.birthdate && !!dobErrors[i]}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => focusPaxField(i * PAX_FIELDS + 3)}
          />
          {p.birthdate && dobErrors[i] ? (
            <Text style={{ color: "#e5484d", fontSize: 10 }} numberOfLines={1}>
              {dobErrors[i]}
            </Text>
          ) : null}
        </View>
        <View style={[styles.cSex, styles.sexToggle, paxCell?.sex]}>
          {(["Male", "Female"] as const).map((sx) => {
            const on = p.sex === sx;
            return (
              <Pressable
                key={sx}
                onPress={() => updatePassenger(p.id, { sex: sx })}
                style={[styles.sexBtn, { backgroundColor: on ? theme.tint : "transparent", borderColor: on ? theme.tint : theme.border }]}
              >
                <Text style={{ color: on ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
                  {sx[0]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <NationalityField
          value={p.nationality}
          onChange={(v) => updatePassenger(p.id, { nationality: v })}
          style={[styles.cNat, paxCell?.nat].filter(Boolean) as ViewStyle[]}
        />
        <IdTypeField
          ref={(el) => {
            paxInputRefs.current[i * PAX_FIELDS + 4] = el;
          }}
          value={p.id_type}
          onChange={(v) => updatePassenger(p.id, { id_type: v })}
          placeholder={p.category === "infant" ? "ID type (optional)" : "ID type"}
          onOpenChange={(isOpen) =>
            setIdTypeOpenRow((cur) => (isOpen ? p.id : cur === p.id ? null : cur))
          }
          style={[styles.cIdType, paxCell?.idType].filter(Boolean) as ViewStyle[]}
          inputStyle={styles.cInput}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => focusPaxField(i * PAX_FIELDS + 4)}
        />
        <TextInput
          ref={(el) => {
            paxInputRefs.current[i * PAX_FIELDS + 5] = el;
          }}
          style={[inputStyle, styles.cId, paxCell?.id]}
          value={p.id_number}
          // Document numbers are printed on the ticket and read back at the
          // gate, so they go on the manifest upper-case however they were
          // keyed. `autoCapitalize` is only a soft keyboard hint and does
          // nothing to a typed or scanned entry on the web build.
          onChangeText={(v) => updatePassenger(p.id, { id_number: v.toUpperCase() })}
          placeholder={p.category === "infant" ? "Optional" : "ID / Passport"}
          placeholderTextColor={theme.greyText}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType={i === passengers.length - 1 ? "done" : "next"}
          blurOnSubmit={false}
          onKeyPress={skipToPhone(i)}
          // Enter follows Tab to the same place rather than dead-ending, which
          // is what it did on the last row before.
          onSubmitEditing={() =>
            i === passengers.length - 1
              ? phoneRef.current?.focus()
              : focusPaxField(i * PAX_FIELDS + 5)
          }
        />
        {/* Only the free-pass rows carry it, and only while the party has one.
            Paying rows in a mixed party still get the empty cell on the
            single-line tier — without it their ID number would sit under the
            free pass's cargo reference and the columns would stop lining up. */}
        {hasFreePass &&
          (p.category === FREE_PASS ? (
            <TextInput
              style={[inputStyle, styles.cCargo, paxCell?.cargo]}
              value={p.cargo_reference}
              // Read back off the paperwork and matched against it by eye at the
              // pier, so it is stored the way the paperwork prints it.
              onChangeText={(v) =>
                updatePassenger(p.id, {
                  cargo_reference: v.toUpperCase().slice(0, CARGO_REFERENCE_MAX),
                })
              }
              placeholder="Cargo ref (plate / B/L)"
              placeholderTextColor={theme.greyText}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType={i === passengers.length - 1 ? "done" : "next"}
              blurOnSubmit={false}
              onKeyPress={skipFromCargo(i)}
              onSubmitEditing={() => phoneRef.current?.focus()}
            />
          ) : paxTier === "row" ? (
            <View style={[styles.cCargo, paxCell?.cargo]} />
          ) : null)}
        {isRoomBooking && (
          <Pressable
            onPress={() => updatePassenger(p.id, { mixed_ok: !p.mixed_ok })}
            style={[styles.cMixed, styles.mixedCell, paxCell?.mixed]}
          >
            <View
              style={[
                styles.mixedBox,
                { borderColor: p.mixed_ok ? theme.tint : theme.border },
                p.mixed_ok && { backgroundColor: theme.tint },
              ]}
            >
              {p.mixed_ok && <FontAwesome name="check" size={11} color="#fff" />}
            </View>
            {/* Column headings only exist on the single-line tier, so once the
                row wraps the checkbox has to name itself. */}
            {paxTier !== "row" && (
              <Text style={{ color: theme.text, fontSize: 12 }} numberOfLines={1}>
                OK to share a mixed-gender cabin
              </Text>
            )}
          </Pressable>
        )}
      </View>
    );
  });

  const voyageLegs = (
    <>
      <VoyageLegPicker
        theme={theme}
        label="Departure"
        loading={loadingDep}
        voyages={depVoyages}
        selectedId={depVoyageId}
        onSelectVoyage={(id) => {
          setDepVoyageId(id);
          setDepClass("");
        }}
        selectedClass={depClass}
        onSelectClass={setDepClass}
        seatPax={seatPax}
        seats={depSeats}
        onEditSeats={() => setSeatModal("dep")}
      />
      {tripType === "round-trip" && (
        <View style={{ marginTop: 12 }}>
          <VoyageLegPicker
            theme={theme}
            label="Return"
            loading={loadingRet}
            voyages={retVoyages}
            selectedId={retVoyageId}
            onSelectVoyage={(id) => {
              setRetVoyageId(id);
              setRetClass("");
            }}
            selectedClass={retClass}
            onSelectClass={setRetClass}
            seatPax={seatPax}
            seats={retSeats}
            onEditSeats={() => setSeatModal("ret")}
          />
        </View>
      )}
      {revealed && !seatsOk && (
        <Text style={{ color: "#e5484d", marginTop: 8, fontSize: 13 }}>
          Not enough seats for {seatPax} passenger(s) in this class.
        </Text>
      )}
    </>
  );

  const totalStr = money(total, currency);

  const screenBody = (
    <>
        {/* Slim top bar: agent · live total · logout */}
        <View style={[styles.topBar, panelChrome]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <FontAwesome name="user-circle" size={18} color={theme.tint} />
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: "700" }}>
              {agent?.name}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            {revealed && (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={{ color: theme.greyText, fontSize: 11, fontWeight: "700", letterSpacing: 1 }}>
                  TOTAL
                </Text>
                <Text style={{ color: theme.primary, fontSize: 22, fontWeight: "800" }}>
                  {freePassOnly ? "NO CHARGE" : totalStr}
                </Text>
              </View>
            )}
            <Pressable
              onPress={() => setPrinterOpen(true)}
              style={styles.logoutBtn}
              hitSlop={6}
            >
              <FontAwesome
                name="print"
                size={14}
                color={printerSettings.enabled ? theme.tint : theme.greyText}
              />
              <Text style={{ color: theme.greyText, fontSize: 13 }}>Printer</Text>
            </Pressable>
            <Pressable onPress={logout} style={styles.logoutBtn} hitSlop={6}>
              <FontAwesome name="sign-out" size={14} color={theme.greyText} />
              <Text style={{ color: theme.greyText, fontSize: 13 }}>Log out</Text>
            </Pressable>
          </View>
        </View>

        {/* 3-column grid filling the rest of the viewport (no scroll). The
            toast floats over this rather than being given room in it: reserving
            its footprint re-laid the whole grid out the moment a sale
            completed, shrinking all three columns and moving the panels under
            the cashier's eyes while they were still reading them. */}
        <View style={gridStyle}>
          {/* ── Column 1: Trip ── */}
          <View style={[styles.col, colTrip, { zIndex: 3 }]}>
            <View
              onLayout={onTripLayout}
              style={[styles.panel, panelChrome, { zIndex: 3 }]}
            >
              <Text style={[styles.panelTitle, { color: theme.text }]}>Trip</Text>

              <View style={styles.pillRow}>
                {(["one-way", "round-trip"] as const).map((t) => {
                  const active = tripType === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setTripType(t)}
                      style={[
                        styles.pill,
                        { backgroundColor: active ? theme.tint : "transparent", borderColor: active ? theme.tint : theme.border },
                      ]}
                    >
                      <Text style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
                        {t === "one-way" ? "One-way" : "Round trip"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View
                style={[
                  styles.row2,
                  !routeSideBySide && styles.row2Stacked,
                  { zIndex: 3 },
                ]}
              >
                {/* Origin outranks Destination. With equal z-index the later
                    sibling wins, so the open Origin list rendered behind the
                    Destination field wherever the two columns stack. */}
                <View style={{ flex: 1, zIndex: 3 }}>
                  <CustomSelectList
                    data={origins.map((o, i) => ({ key: String(i), value: o }))}
                    onSelect={(o) => {
                      setOrigin(o);
                      setDestination("");
                    }}
                    label="Origin"
                    placeholder="From"
                  />
                </View>
                <View style={{ flex: 1, zIndex: 2 }}>
                  <CustomSelectList
                    key={`dest-${origin}`}
                    data={(destsByOrigin[origin] || []).map((d, i) => ({ key: String(i), value: d }))}
                    onSelect={setDestination}
                    label="Destination"
                    placeholder="To"
                  />
                </View>
              </View>

              <TravelDateField
                label="Departure"
                value={depDate}
                onChange={setDepDate}
                active={tripType === "round-trip" && activeLeg === "dep"}
                onActivate={() => setActiveLeg("dep")}
              />
              {tripType === "round-trip" && (
                <TravelDateField
                  label="Return"
                  value={retDate}
                  onChange={setRetDate}
                  active={activeLeg === "ret"}
                  onActivate={() => setActiveLeg("ret")}
                />
              )}

              {/* One shared calendar — fills the active leg, greys the active
                  route's non-sailing days, and shows the round-trip range. */}
              <MiniCalendar
                value={activeDate || undefined}
                onChange={pickCalendarDate}
                minDate={calMinDate}
                hasVoyage={calHasVoyage}
                rangeStart={depDate || undefined}
                rangeEnd={tripType === "round-trip" ? retDate || undefined : undefined}
              />
            </View>

            <View onLayout={onPaxSetupLayout} style={[styles.panel, panelChrome, paneFill]}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Passengers</Text>
              <View style={styles.stepperGrid}>
                {CATEGORIES.map((c) => (
                  <View
                    key={c.key}
                    style={[
                      styles.stepper,
                      // Two-up until the box is too narrow to keep its label.
                      { width: stepperTwoUp ? "47%" : "100%" },
                      { borderColor: c.color, backgroundColor: c.color + "14" },
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
                      <View style={[styles.dot, { backgroundColor: c.color }]} />
                      <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }} numberOfLines={1}>
                        {c.label}
                      </Text>
                    </View>
                    <View style={styles.stepperControls}>
                      <Pressable onPress={() => setCount(c.key, -1)} style={[styles.stepBtn, { borderColor: c.color }]}>
                        <FontAwesome name="minus" size={10} color={c.color} />
                      </Pressable>
                      <Text style={{ color: theme.text, fontSize: 15, minWidth: 18, textAlign: "center", fontWeight: "700" }}>
                        {counts[c.key]}
                      </Text>
                      <Pressable onPress={() => setCount(c.key, 1)} style={[styles.stepBtn, { borderColor: c.color }]}>
                        <FontAwesome name="plus" size={10} color={c.color} />
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* ── Column 2: Voyage & class ── */}
          <View style={[styles.col, colVoyage, { zIndex: 2 }]}>
            <View style={[styles.panel, panelChrome, paneFill]}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Voyage & Class</Text>
              {!canPickVoyage ? (
                hint("Select route, date(s), and passengers first.")
              ) : (
                wide ? (
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 4 }}
                    showsVerticalScrollIndicator
                  >
                    {voyageLegs}
                  </ScrollView>
                ) : (
                  <View style={{ paddingBottom: 4 }}>{voyageLegs}</View>
                )
              )}
            </View>
          </View>

          {/* ── Column 3: Passengers + contact + payment ── */}
          <View style={[styles.col, colPax, { zIndex: 1 }]}>
            <View
              onLayout={onPaxPanelLayout}
              style={[styles.panel, panelChrome, paneFill, { zIndex: 2 }]}
            >
              <Text style={[styles.panelTitle, { color: theme.text }]}>Passenger Details</Text>

              {/* Nothing here for the ticket number: the server takes the next
                  serial in this counter's series as the sale is confirmed, and
                  the cashier sees the numbers issued on the completed-sale
                  toast. The only case worth raising before the form is filled in
                  is an account that cannot sell at all. */}
              {!ticketStation && (
                <View style={styles.mixedRow}>
                  <FontAwesome name="exclamation-triangle" size={13} color="#e5484d" />
                  <Text style={[styles.mixedText, { color: "#e5484d" }]}>
                    This account has no ticket counter assigned — ask an admin to set one
                    before selling.
                  </Text>
                </View>
              )}

              {isRoomBooking && canPickVoyage && (
                <View style={styles.mixedRow}>
                  <FontAwesome name="info-circle" size={13} color={theme.greyText} />
                  <Text style={[styles.mixedText, { color: theme.greyText }]}>
                    Cabins and suites are single-gender. Tick "Mixed OK" on each
                    passenger happy to share with the opposite sex (e.g. married
                    couples) — ask them, one answer cannot cover the whole party.
                  </Text>
                </View>
              )}
              {!canPickVoyage ? (
                hint("Select route, date(s), and passengers first.")
              ) : (
                <>
                  {/* Column headings only label anything while the row is a
                      single line; once it wraps, each field falls back to its
                      own placeholder. */}
                  {paxTier === "row" && (
                    <View style={styles.paxHead}>
                      <Text style={[styles.paxHeadCell, styles.cCat, { color: theme.greyText }]}>Passenger</Text>
                      <Text style={[styles.paxHeadCell, styles.cFirst, { color: theme.greyText }]}>First</Text>
                      <Text style={[styles.paxHeadCell, styles.cMi, { color: theme.greyText }]}>MI</Text>
                      <Text style={[styles.paxHeadCell, styles.cLast, { color: theme.greyText }]}>Last</Text>
                      <Text style={[styles.paxHeadCell, styles.cDob, { color: theme.greyText }]}>Birthdate</Text>
                      <Text style={[styles.paxHeadCell, styles.cSex, { color: theme.greyText }]}>Sex</Text>
                      <Text style={[styles.paxHeadCell, styles.cNat, { color: theme.greyText }]}>Nationality</Text>
                      <Text style={[styles.paxHeadCell, styles.cIdType, { color: theme.greyText }]}>ID Type</Text>
                      <Text style={[styles.paxHeadCell, styles.cId, { color: theme.greyText }]}>ID Number</Text>
                      {hasFreePass && (
                        <Text style={[styles.paxHeadCell, styles.cCargo, { color: theme.greyText }]}>
                          Cargo Ref
                        </Text>
                      )}
                      {isRoomBooking && (
                        <Text style={[styles.paxHeadCell, styles.cMixed, { color: theme.greyText }]}>Mixed OK</Text>
                      )}
                    </View>
                  )}
                  {wide ? (
                    <ScrollView
                      style={{ flex: 1 }}
                      contentContainerStyle={{ paddingBottom: 4 }}
                      showsVerticalScrollIndicator
                    >
                      {paxRows}
                    </ScrollView>
                  ) : (
                    <View style={{ paddingBottom: 4 }}>{paxRows}</View>
                  )}
                </>
              )}
            </View>

            {/* Contact + Payment */}
            <View style={[styles.panel, panelChrome, { zIndex: 1 }]}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Contact & Payment</Text>
              {!revealed ? (
                hint("Unlocks after choosing a voyage.")
              ) : (
                <>
                  {contactPaxOptions.length > 0 && (
                    <View style={{ gap: 6 }}>
                      <Text style={{ color: theme.greyText, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" }}>
                        Contact person
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {contactPaxOptions.map((o) => {
                          const active = contactPaxId === o.id;
                          return (
                            <Pressable
                              key={o.id}
                              onPress={() => setContactPaxId(o.id)}
                              style={[styles.classChip, { borderColor: active ? theme.tint : theme.border, backgroundColor: active ? theme.tint : "transparent" }]}
                            >
                              <Text style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "600" }}>{o.label}</Text>
                            </Pressable>
                          );
                        })}
                        <Pressable
                          onPress={() => setContactPaxId(null)}
                          style={[styles.classChip, { borderColor: !contactBound ? theme.tint : theme.border, backgroundColor: !contactBound ? theme.tint : "transparent" }]}
                        >
                          <Text style={{ color: !contactBound ? "#fff" : theme.text, fontSize: 13, fontWeight: "600" }}>Someone else</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                  <View style={styles.row2}>
                    <TextInput
                      style={[inputStyle, { flex: 1 }, contactBound && { opacity: 0.6 }]}
                      value={contactFirst}
                      onChangeText={setContactFirst}
                      editable={!contactBound}
                      placeholder="Contact first name"
                      placeholderTextColor={theme.greyText}
                    />
                    <TextInput
                      style={[inputStyle, { flex: 1 }, contactBound && { opacity: 0.6 }]}
                      value={contactLast}
                      onChangeText={setContactLast}
                      editable={!contactBound}
                      placeholder="Contact last name"
                      placeholderTextColor={theme.greyText}
                    />
                  </View>
                  <View style={styles.row2}>
                    <TextInput
                      ref={phoneRef}
                      style={[inputStyle, { flex: 1 }, !!phoneError && styles.cInputInvalid]}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="Phone (optional)"
                      keyboardType="phone-pad"
                      placeholderTextColor={theme.greyText}
                    />
                    <EmailField
                      value={email}
                      onChange={setEmail}
                      style={{ flex: 1 }}
                      inputStyle={inputStyle}
                      placeholder="Email (optional)"
                    />
                  </View>

                  {freePassOnly ? (
                    <View style={styles.mixedRow}>
                      <FontAwesome name="info-circle" size={13} color={theme.greyText} />
                      <Text style={[styles.mixedText, { color: theme.greyText }]}>
                        No charge — every passenger on this sale is a RO/RO cargo free
                        pass. Nothing is tendered and no change is due; the tickets print
                        as usual and the free passes appear on your end-of-day report
                        against the cargo reference keyed above.
                      </Text>
                    </View>
                  ) : (
                  <View style={styles.pillRow}>
                    {TENDERS.map((m) => {
                      const active = method === m;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => {
                            setMethod(m);
                            // Each rail carries its own settlement detail, and
                            // a reference left over from a mistaken tap would
                            // be filed against the wrong acquirer.
                            setExternalRef("");
                            setTendered("");
                          }}
                          style={[
                            styles.pill,
                            { backgroundColor: active ? theme.tint : "transparent", borderColor: active ? theme.tint : theme.border },
                          ]}
                        >
                          <Text style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
                            {TENDER_LABELS[m]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  )}
                  {!freePassOnly && needsRef && (
                    <View style={{ gap: 6 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <TextInput
                          style={[
                            inputStyle,
                            { flex: 1, minWidth: 0, letterSpacing: 2, fontWeight: "700" },
                            externalRef.length > 0 && !refOk && styles.cInputInvalid,
                          ]}
                          value={externalRef}
                          onChangeText={(v) => setExternalRef(clampExternalRef(method, v))}
                          placeholder={refSpec?.placeholder}
                          autoCapitalize="characters"
                          autoCorrect={false}
                          maxLength={refSpec?.length}
                          keyboardType={refSpec?.digitsOnly ? "number-pad" : "default"}
                          placeholderTextColor={theme.greyText}
                        />
                        <Text style={{ color: theme.greyText, fontSize: 11, flex: 1, lineHeight: 15 }}>
                          {refSpec?.hint}
                        </Text>
                      </View>
                    </View>
                  )}
                  {!freePassOnly && method === "cash" && (
                    <View style={{ gap: 8 }}>
                      {quickTenders.length > 0 && (
                        <View style={styles.quickCashRow}>
                          {quickTenders.map((amt) => {
                            const on = tenderedNum === amt;
                            return (
                              <Pressable
                                key={amt}
                                onPress={() => setTendered(String(amt))}
                                style={[styles.quickCashBtn, { backgroundColor: on ? theme.tint : "transparent", borderColor: on ? theme.tint : theme.border }]}
                              >
                                <Text style={{ color: on ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
                                  {moneyWhole(amt, currency)}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <TextInput
                          style={[inputStyle, { flex: 1 }]}
                          value={tendered}
                          onChangeText={setTendered}
                          placeholder="Tendered"
                          keyboardType="numeric"
                          placeholderTextColor={theme.greyText}
                        />
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: theme.greyText, fontSize: 10 }}>CHANGE</Text>
                          <Text style={{ fontSize: 17, fontWeight: "800", color: (change ?? 0) < 0 ? "#e5484d" : "#2e9e5b" }}>
                            {money(change ?? 0, currency)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {mixedCurrency ? (
                    <Text style={{ color: "#e5484d", fontSize: 13 }}>
                      This trip mixes {depCurrency} and {retCurrency} fares. Nothing
                      converts between them — sell the outbound and return legs as
                      two separate bookings.
                    </Text>
                  ) : null}

                  {errorMsg ? (
                    <Text style={{ color: "#e5484d", fontSize: 13, lineHeight: 18 }}>{errorMsg}</Text>
                  ) : null}

                  <Pressable
                    onPress={handleConfirm}
                    disabled={submitting}
                    style={[styles.confirmBtn, { backgroundColor: canConfirm ? theme.tint : theme.greyText }]}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Text style={styles.confirmText}>
                          {freePassOnly ? "Issue Free Pass" : "Confirm Payment"}
                        </Text>
                        <Text style={styles.confirmTotal}>
                          {freePassOnly ? "NO CHARGE" : totalStr}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </View>
    </>
  );

  return (
    <Background>
      {/* Only the desk layout fits the whole counter in one viewport; at any
          narrower width the panels stack and the page itself has to scroll. */}
      {wide ? (
        <View style={[styles.screen, styles.screenFill]}>{screenBody}</View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.screen}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {screenBody}
        </ScrollView>
      )}

      {/* Seat override modals */}
      <SeatAssignModal
        visible={seatModal === "dep"}
        seatMap={depVoyage?.seat_map ?? null}
        className={depClass}
        unavailableSeats={depVoyage?.unavailable_seats ?? []}
        seatGenders={depVoyage?.seat_genders ?? {}}
        maxSeats={seatPax}
        initialSelected={depSeats}
        title="Departure seats"
        onConfirm={(s) => {
          setDepSeats(s);
          setSeatModal(null);
        }}
        onClose={() => setSeatModal(null)}
      />
      <SeatAssignModal
        visible={seatModal === "ret"}
        seatMap={retVoyage?.seat_map ?? null}
        className={retClass}
        unavailableSeats={retVoyage?.unavailable_seats ?? []}
        seatGenders={retVoyage?.seat_genders ?? {}}
        maxSeats={seatPax}
        initialSelected={retSeats}
        title="Return seats"
        onConfirm={(s) => {
          setRetSeats(s);
          setSeatModal(null);
        }}
        onClose={() => setSeatModal(null)}
      />

      <PrinterSetupModal
        visible={printerOpen}
        onClose={() => setPrinterOpen(false)}
        onSaved={setPrinterSettings}
      />

      <Toast
        visible={!!toast}
        title={freePassSale ? "Free pass issued" : "Payment confirmed"}
        headline={toast?.reference}
        rows={toastRows}
        note={printMsg ?? undefined}
        // Sticky on purpose: the reference, change and ticket numbers stay on
        // screen for the whole hand-over — through a reprint, a query, or a
        // customer coming back — until the cashier closes it or the next sale
        // is confirmed and replaces it.
        duration={0}
        actionLabel={
          printerSettings.enabled && lastTickets.current.length > 0 ? "Reprint" : undefined
        }
        onAction={() => printCapturedTickets()}
        onDismiss={() => {
          setToast(null);
          setPrintMsg(null);
        }}
      />
    </Background>
  );
};

export default BookingOffice;

const styles = StyleSheet.create({
  screen: { gap: 10 },
  screenFill: { flex: 1 },
  topBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  grid: { flexDirection: "row", gap: 10 },
  gridFill: { flex: 1 },
  gridWrap: { flexWrap: "wrap" },
  gridStack: { flexDirection: "column", gap: 10 },
  col: { gap: 10 },
  panel: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  panelTitle: {
    fontSize: 13,
    fontWeight: "800",
    fontFamily: "Lato",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  mixedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 8,
    marginBottom: 4,
  },
  mixedBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  mixedText: { flex: 1, fontSize: 12, fontFamily: "Lato" },
  pillRow: { flexDirection: "row", gap: 8 },
  pill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
  },
  row2: { flexDirection: "row", gap: 10 },
  row2Stacked: { flexDirection: "column" },
  cInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Lato",
    // On web a bare <input> keeps `min-width: auto`, so it refuses to shrink
    // below its ~20-character intrinsic width. In the passenger row that let
    // First/Last/ID hold their full size and starve the flexible columns beside
    // them — Birthdate collapsed to nothing. Views already get min-width:0 from
    // react-native-web; inputs have to ask.
    minWidth: 0,
  },
  cInputInvalid: { borderColor: "#e5484d" },
  stepperGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexGrow: 1,
  },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, marginBottom: 6 },
  voyageOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  classChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  seatSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  editSeatsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  paxHead: { flexDirection: "row", gap: 6, paddingLeft: 12, paddingRight: 6, marginBottom: 2 },
  paxHeadCell: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  paxRowWrap: { flexWrap: "wrap", alignItems: "flex-start", paddingVertical: 8 },
  paxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderLeftWidth: 4,
    borderRadius: 8,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 5,
    marginBottom: 5,
  },
  cCat: { width: 96 },
  cFirst: { flex: 1.4 },
  cMi: { width: 42 },
  cLast: { flex: 1.4 },
  // Sized for a full MM-DD-YYYY, two characters wider than the old 2-digit year.
  cDob: { flex: 1.6 },
  cSex: { width: 84 },
  sexToggle: { flexDirection: "row", gap: 4 },
  sexBtn: {
    flex: 1,
    height: 34,
    borderWidth: 1.5,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cNat: { flex: 1.1 },
  cIdType: { flex: 1.3 },
  cId: { flex: 1.1 },
  cCargo: { flex: 1.2 },
  cMixed: { width: 62 },
  mixedCell: { flexDirection: "row", alignItems: "center", gap: 6 },
  payRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  quickCashRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quickCashBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  confirmBtn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minHeight: 46,
  },
  confirmText: { color: "#fff", fontSize: 15, fontWeight: "800", fontFamily: "Lato" },
  confirmTotal: { color: "#fff", fontSize: 18, fontWeight: "800", fontFamily: "Lato" },
});
