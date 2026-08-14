import AsyncStorage from "@react-native-async-storage/async-storage";
import Background from "@/components/Background";
import CustomSelectList from "@/components/CustomSelectList";
import DateField from "@/components/DateField";
import MiniCalendar from "@/components/MiniCalendar";
import SeatAssignModal from "@/components/SeatAssignModal";
import TravelDateField from "@/components/TravelDateField";
import VoyageLegPicker from "@/components/VoyageLegPicker";
import Colors from "@/constants/Colors";
import { useAuth } from "@/context/AuthContext";
import { API_BASE, apiFetch } from "@/utils/api";
import {
  Category,
  CATEGORIES,
  CATEGORY_META,
  CATEGORY_TO_DB,
  peso,
  SEAT_OCCUPYING,
  validateDob,
} from "@/utils/passengerRules";
import { autoAssignSeats } from "@/utils/seatAssign";
import { makeScheduleChecker, RouteVoyage } from "@/utils/schedule";
import { quickCashOptions } from "@/utils/payment";
import { ClassInfo, TicketType, Voyage } from "@/types/voyage";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

// Remembers which physical ticket counter this device is printing at, across app
// restarts — each station keeps its own auto-incrementing ticket number sequence.
const TICKET_STATION_KEY = "aleson.ticket.station";

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
    const n = counts[c.key] || 0;
    if (n > 0) sum += (priceByType[c.key] ?? 0) * n;
  }
  return sum;
};

const BookingOffice = () => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
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

  // Route options from /routes
  const [origins, setOrigins] = useState<string[]>([]);
  const [destsByOrigin, setDestsByOrigin] = useState<Record<string, string[]>>({});

  // All active schedules (with rrules) — drives the mini-calendars' "no trips"
  // greying without a per-date round trip.
  const [allVoyages, setAllVoyages] = useState<RouteVoyage[]>([]);

  // ── Voyage + class selection ────────────────────────────────────────────
  const [depVoyages, setDepVoyages] = useState<Voyage[]>([]);
  const [retVoyages, setRetVoyages] = useState<Voyage[]>([]);
  const [loadingDep, setLoadingDep] = useState(false);
  const [loadingRet, setLoadingRet] = useState(false);
  const [depVoyageId, setDepVoyageId] = useState<number | null>(null);
  const [retVoyageId, setRetVoyageId] = useState<number | null>(null);
  const [depClass, setDepClass] = useState("");
  const [retClass, setRetClass] = useState("");

  // ── Seats (aligned to seat-occupying passenger order) ───────────────────
  const [depSeats, setDepSeats] = useState<string[]>([]);
  const [retSeats, setRetSeats] = useState<string[]>([]);
  // Consent to place mixed genders in one cabin/suite (single-gender otherwise).
  // Applied to every passenger in this booking (agents handle one party).
  const [mixedCabinOk, setMixedCabinOk] = useState(false);
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
  const [method, setMethod] = useState<"cash" | "card" | "qr" | "">("");
  const [tendered, setTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [qr, setQr] = useState<{ orderId: string; image: string } | null>(null);
  const [receipt, setReceipt] = useState<
    | {
        reference: string;
        change: number | null;
        method: string;
        total: number;
        ticketNumbers: (string | null)[] | null;
      }
    | null
  >(null);

  // ── Ticket number (printed on the physical passage ticket) ─────────────────
  // Editable, auto-incrementing per ticket station — one number per passenger
  // ticket. Prefilled from the station's running counter but can be corrected
  // by the cashier (e.g. after a paper skip/jam, or a freshly loaded booklet).
  const [ticketStation, setTicketStation] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [stationHydrated, setStationHydrated] = useState(false);

  const fetchNextTicketNumber = async (station: string) => {
    const st = station.trim().toUpperCase();
    if (!st) return;
    try {
      const res = await apiFetch(`/api/v1/office/ticket-number?station=${encodeURIComponent(st)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ticket_number) setTicketNumber(data.ticket_number);
    } catch {
      /* best-effort — cashier can still type the number in manually */
    }
  };

  // Rehydrate the remembered ticket station and prefill its next number.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TICKET_STATION_KEY);
        if (saved) {
          setTicketStation(saved);
          fetchNextTicketNumber(saved);
        }
      } catch {
        /* storage unavailable — station stays blank, cashier can type it in */
      } finally {
        setStationHydrated(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the station once hydration has run (avoids clobbering the saved
  // value with the initial empty state before rehydration completes).
  useEffect(() => {
    if (!stationHydrated) return;
    AsyncStorage.setItem(TICKET_STATION_KEY, ticketStation).catch(() => {});
  }, [ticketStation, stationHydrated]);

  const seatPax = SEAT_OCCUPYING.reduce((s, k) => s + (counts[k] || 0), 0);
  const totalPax = CATEGORIES.reduce((s, c) => s + (counts[c.key] || 0), 0);

  // Fetch route options once.
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/routes`)
      .then((r) => r.json())
      .then((rows: { origin: string; destination: string }[]) => {
        const oset = new Set<string>();
        const map: Record<string, string[]> = {};
        rows.forEach((r) => {
          oset.add(r.origin);
          (map[r.origin] ??= []).push(r.destination);
        });
        setOrigins([...oset]);
        setDestsByOrigin(map);
      })
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
              nationality: "Filipino",
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
  }, [origin, destination, depDate]);

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
  }, [tripType, origin, destination, retDate]);

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

  const depReady = depVoyageId != null && !!depClass;
  const retReady = tripType === "one-way" || (retVoyageId != null && !!retClass);
  const seatsOk =
    seatPax <= depAvail &&
    depSeats.length === seatPax &&
    (tripType === "one-way" || (seatPax <= retAvail && retSeats.length === seatPax));
  const revealed = depReady && retReady;

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

  const dobErrors = passengers.map((p) => validateDob(p.category, p.birthdate));

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

  const updatePassenger = (id: string, patch: Partial<PassengerRow>) =>
    setPassengers((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // Enter/next focus chain across passenger-detail inputs. Each row contributes
  // 5 typed fields in visual order — first, MI, last, birthdate, nationality
  // (the sex toggle isn't typed, so it's skipped) — and the last field rolls
  // over into the next passenger's first name.
  const PAX_FIELDS = 5;
  const paxInputRefs = useRef<Record<number, TextInput | null>>({});
  const focusPaxField = (flatIndex: number) =>
    paxInputRefs.current[flatIndex + 1]?.focus();

  // Validation gate for submission.
  const passengersComplete =
    passengers.length > 0 &&
    passengers.every(
      (p, i) =>
        p.first_name.trim() &&
        p.middle_initial.trim() &&
        p.last_name.trim() &&
        p.birthdate &&
        p.sex &&
        p.nationality.trim() &&
        !dobErrors[i]
    );
  const contactComplete = !!contactLast.trim() && (!!email.trim() || !!phone.trim());
  const tenderedNum = parseFloat(tendered) || 0;
  const cashOk = method !== "cash" || tenderedNum >= total;
  const change = method === "cash" ? tenderedNum - total : null;
  const quickTenders = quickCashOptions(total);

  const ticketNumberOk = !!ticketStation.trim() && !!ticketNumber.trim();

  const canConfirm =
    revealed &&
    seatsOk &&
    passengersComplete &&
    contactComplete &&
    ticketNumberOk &&
    total > 0 &&
    !!method &&
    cashOk &&
    !submitting;

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
        nationality: p.nationality.trim() || "Filipino",
        passenger_type: CATEGORY_TO_DB[p.category],
        mixed_ok: mixedCabinOk,
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
      ticket_station: ticketStation.trim().toUpperCase(),
      starting_ticket_number: ticketNumber.trim().toUpperCase(),
    };
  };

  // Poll QR settlement.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!qr) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/v1/cashier/status/${qr.orderId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.booking_reference) {
          if (pollRef.current) clearInterval(pollRef.current);
          setReceipt({
            reference: data.booking_reference,
            change: null,
            method: "qr",
            total,
            ticketNumbers: data.ticket_numbers ?? null,
          });
          setQr(null);
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr]);

  const handleConfirm = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/v1/office/payment", {
        method: "POST",
        body: JSON.stringify({
          amount: total,
          method,
          tendered: method === "cash" ? tenderedNum : null,
          booking: buildBooking(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data?.detail || "Payment failed. Please try again.");
        return;
      }
      if (method === "qr") {
        setQr({ orderId: data.order_id, image: data.qr_image });
      } else {
        setReceipt({
          reference: data.booking_reference,
          change: data.change ?? null,
          method,
          total,
          ticketNumbers: data.ticket_numbers ?? null,
        });
      }
    } catch {
      setErrorMsg("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTripType("one-way");
    setOrigin("");
    setDestination("");
    setDepDate(todayISO());
    setRetDate("");
    setCounts(emptyCounts());
    setDepVoyages([]);
    setRetVoyages([]);
    setDepVoyageId(null);
    setRetVoyageId(null);
    setDepClass("");
    setRetClass("");
    setDepSeats([]);
    setRetSeats([]);
    setMixedCabinOk(false);
    setPassengers([]);
    setContactFirst("");
    setContactLast("");
    setContactPaxId(null);
    setPhone("");
    setEmail("");
    setMethod("");
    setTendered("");
    setErrorMsg(null);
    setQr(null);
    setReceipt(null);
    setTicketNumber("");
    if (ticketStation.trim()) fetchNextTicketNumber(ticketStation);
  };

  const inputStyle = [
    styles.cInput,
    { borderColor: theme.border, color: theme.text, backgroundColor: theme.control },
  ];
  const panelChrome = { backgroundColor: theme.cardBackground, borderColor: theme.border };
  const hint = (msg: string) => (
    <Text style={{ color: theme.greyText, fontSize: 13, fontStyle: "italic" }}>{msg}</Text>
  );

  // ── Receipt view (compact, centered, no scroll) ─────────────────────────
  if (receipt) {
    return (
      <Background>
        <View style={styles.receiptScreen}>
          <View style={[styles.receiptCard, panelChrome]}>
            <FontAwesome name="check-circle" size={46} color="#2e9e5b" />
            <Text style={{ color: theme.greyText, fontSize: 13, marginTop: 8 }}>
              Booking reference
            </Text>
            <Text style={{ color: theme.text, fontSize: 38, fontWeight: "800", letterSpacing: 4 }}>
              {receipt.reference}
            </Text>
            <View style={{ width: "100%", marginTop: 10 }}>
              <View style={[styles.receiptRow, { borderTopColor: theme.border }]}>
                <Text style={[styles.receiptLabel, { color: theme.greyText }]}>Total paid</Text>
                <Text style={[styles.receiptValue, { color: theme.text }]}>{peso(receipt.total)}</Text>
              </View>
              <View style={[styles.receiptRow, { borderTopColor: theme.border }]}>
                <Text style={[styles.receiptLabel, { color: theme.greyText }]}>Payment</Text>
                <Text style={[styles.receiptValue, { color: theme.text }]}>
                  {receipt.method.toUpperCase()}
                </Text>
              </View>
              {receipt.change != null && (
                <View style={[styles.receiptRow, { borderTopColor: theme.border }]}>
                  <Text style={[styles.receiptLabel, { color: theme.greyText }]}>Change</Text>
                  <Text style={[styles.receiptValue, { color: "#2e9e5b", fontWeight: "800" }]}>
                    {peso(receipt.change)}
                  </Text>
                </View>
              )}
            </View>
            {receipt.ticketNumbers && receipt.ticketNumbers.length > 0 && (
              <View style={{ width: "100%", marginTop: 10 }}>
                <Text
                  style={{
                    color: theme.greyText,
                    fontSize: 11,
                    fontWeight: "700",
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  Ticket Number{receipt.ticketNumbers.length > 1 ? "s" : ""} — one per passenger
                </Text>
                {receipt.ticketNumbers.map((tn, i) => (
                  <View key={i} style={[styles.receiptRow, { borderTopColor: theme.border }]}>
                    <Text style={[styles.receiptLabel, { color: theme.greyText }]}>Passenger {i + 1}</Text>
                    <Text style={[styles.receiptValue, { color: theme.text }]}>{tn || "—"}</Text>
                  </View>
                ))}
              </View>
            )}
            <Pressable
              onPress={resetForm}
              style={[styles.primaryBtn, { backgroundColor: theme.tint, marginTop: 18, width: "100%" }]}
            >
              <Text style={styles.primaryBtnText}>New Booking</Text>
            </Pressable>
          </View>
        </View>
      </Background>
    );
  }

  const totalStr = peso(total);

  return (
    <Background>
      <View style={styles.screen}>
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
                <Text style={{ color: theme.primary, fontSize: 22, fontWeight: "800" }}>{totalStr}</Text>
              </View>
            )}
            <Pressable onPress={logout} style={styles.logoutBtn} hitSlop={6}>
              <FontAwesome name="sign-out" size={14} color={theme.greyText} />
              <Text style={{ color: theme.greyText, fontSize: 13 }}>Log out</Text>
            </Pressable>
          </View>
        </View>

        {/* 3-column grid filling the rest of the viewport (no scroll) */}
        <View style={styles.grid}>
          {/* ── Column 1: Trip ── */}
          <View style={[styles.col, { flex: 0.85, zIndex: 3 }]}>
            <View style={[styles.panel, panelChrome, { zIndex: 3 }]}>
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

              <View style={[styles.row2, { zIndex: 3 }]}>
                <View style={{ flex: 1, zIndex: 2 }}>
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

            <View style={[styles.panel, panelChrome, { flex: 1 }]}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Passengers</Text>
              <View style={styles.stepperGrid}>
                {CATEGORIES.map((c) => (
                  <View
                    key={c.key}
                    style={[styles.stepper, { borderColor: c.color, backgroundColor: c.color + "14" }]}
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
          <View style={[styles.col, { flex: 0.95, zIndex: 2 }]}>
            <View style={[styles.panel, panelChrome, { flex: 1 }]}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Voyage & Class</Text>
              {!canPickVoyage ? (
                hint("Select route, date(s), and passengers first.")
              ) : (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: 4 }}
                  showsVerticalScrollIndicator
                >
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
                </ScrollView>
              )}
            </View>
          </View>

          {/* ── Column 3: Passengers + contact + payment ── */}
          <View style={[styles.col, { flex: 2.2, zIndex: 1 }]}>
            <View style={[styles.panel, panelChrome, { flex: 1, zIndex: 2 }]}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Passenger Details</Text>
              {isRoomBooking && canPickVoyage && (
                <Pressable
                  style={styles.mixedRow}
                  onPress={() => setMixedCabinOk((v) => !v)}
                >
                  <View
                    style={[
                      styles.mixedBox,
                      { borderColor: mixedCabinOk ? theme.tint : theme.border },
                      mixedCabinOk && { backgroundColor: theme.tint },
                    ]}
                  >
                    {mixedCabinOk && <FontAwesome name="check" size={12} color="#fff" />}
                  </View>
                  <Text style={[styles.mixedText, { color: theme.text }]}>
                    Allow a mixed-gender cabin for this booking (e.g. married couples).
                    Cabins/suites are otherwise single-gender.
                  </Text>
                </Pressable>
              )}
              {!canPickVoyage ? (
                hint("Select route, date(s), and passengers first.")
              ) : (
                <>
                  <View style={styles.paxHead}>
                    <Text style={[styles.paxHeadCell, styles.cCat, { color: theme.greyText }]}>Passenger</Text>
                    <Text style={[styles.paxHeadCell, styles.cFirst, { color: theme.greyText }]}>First</Text>
                    <Text style={[styles.paxHeadCell, styles.cMi, { color: theme.greyText }]}>MI</Text>
                    <Text style={[styles.paxHeadCell, styles.cLast, { color: theme.greyText }]}>Last</Text>
                    <Text style={[styles.paxHeadCell, styles.cDob, { color: theme.greyText }]}>Birthdate</Text>
                    <Text style={[styles.paxHeadCell, styles.cSex, { color: theme.greyText }]}>Sex</Text>
                    <Text style={[styles.paxHeadCell, styles.cNat, { color: theme.greyText }]}>Nationality</Text>
                  </View>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 4 }}
                    showsVerticalScrollIndicator
                  >
                  {passengers.map((p, i) => {
                    const meta = CATEGORY_META[p.category];
                    const seat = seatByPassenger[p.id];
                    const nth = passengers
                      .slice(0, i + 1)
                      .filter((x) => x.category === p.category).length;
                    return (
                      <View
                        key={p.id}
                        style={[styles.paxRow, { borderLeftColor: meta.color, backgroundColor: meta.color + "0d" }]}
                      >
                        <View style={styles.cCat}>
                          <Text style={{ color: theme.text, fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
                            {meta.label} {nth}
                          </Text>
                          <Text style={{ color: theme.greyText, fontSize: 10 }} numberOfLines={1}>
                            {meta.seatOccupying
                              ? `Seat ${seat?.dep ?? "—"}${tripType === "round-trip" ? ` / ${seat?.ret ?? "—"}` : ""}`
                              : "Lap"}
                          </Text>
                        </View>
                        <TextInput
                          ref={(el) => {
                            paxInputRefs.current[i * PAX_FIELDS + 0] = el;
                          }}
                          style={[inputStyle, styles.cFirst]}
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
                          style={[inputStyle, styles.cMi]}
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
                          style={[inputStyle, styles.cLast]}
                          value={p.last_name}
                          onChangeText={(v) => updatePassenger(p.id, { last_name: v })}
                          placeholder="Last"
                          placeholderTextColor={theme.greyText}
                          returnKeyType="next"
                          blurOnSubmit={false}
                          onSubmitEditing={() => focusPaxField(i * PAX_FIELDS + 2)}
                        />
                        <View style={styles.cDob}>
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
                        <View style={[styles.cSex, styles.sexToggle]}>
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
                        <TextInput
                          ref={(el) => {
                            paxInputRefs.current[i * PAX_FIELDS + 4] = el;
                          }}
                          style={[inputStyle, styles.cNat]}
                          value={p.nationality}
                          onChangeText={(v) => updatePassenger(p.id, { nationality: v })}
                          placeholder="Filipino"
                          placeholderTextColor={theme.greyText}
                          returnKeyType={i === passengers.length - 1 ? "done" : "next"}
                          blurOnSubmit={i === passengers.length - 1}
                          onSubmitEditing={() => focusPaxField(i * PAX_FIELDS + 4)}
                        />
                      </View>
                    );
                  })}
                  </ScrollView>
                </>
              )}
            </View>

            {/* Contact + Payment */}
            <View style={[styles.panel, panelChrome, { zIndex: 1 }]}>
              <Text style={[styles.panelTitle, { color: theme.text }]}>Contact & Payment</Text>
              {!revealed ? (
                hint("Unlocks after choosing a voyage.")
              ) : qr ? (
                <View style={{ alignItems: "center", gap: 8 }}>
                  <Text style={{ color: theme.text, fontSize: 15 }}>Scan to pay {totalStr}</Text>
                  {qr.image ? (
                    <Image source={{ uri: qr.image }} style={{ width: 150, height: 150 }} />
                  ) : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator color={theme.tint} />
                    <Text style={{ color: theme.greyText, fontSize: 13 }}>Waiting for payment…</Text>
                  </View>
                </View>
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
                      style={[inputStyle, { flex: 1 }]}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="Phone"
                      keyboardType="phone-pad"
                      placeholderTextColor={theme.greyText}
                    />
                    <TextInput
                      style={[inputStyle, { flex: 1 }]}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="Email"
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholderTextColor={theme.greyText}
                    />
                  </View>

                  <View style={{ gap: 6 }}>
                    <Text style={{ color: theme.greyText, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" }}>
                      Ticket number — one per passenger
                    </Text>
                    <View style={styles.row2}>
                      <TextInput
                        style={[inputStyle, { flex: 1 }]}
                        value={ticketStation}
                        onChangeText={(t) => setTicketStation(t.toUpperCase())}
                        onEndEditing={() => {
                          if (!ticketNumber.trim()) fetchNextTicketNumber(ticketStation);
                        }}
                        placeholder="Ticket station (e.g. BLVD1)"
                        autoCapitalize="characters"
                        placeholderTextColor={theme.greyText}
                      />
                      <TextInput
                        style={[inputStyle, { flex: 1 }]}
                        value={ticketNumber}
                        onChangeText={(t) => setTicketNumber(t.toUpperCase())}
                        placeholder="Ticket number (e.g. A7945921)"
                        autoCapitalize="characters"
                        placeholderTextColor={theme.greyText}
                      />
                    </View>
                    <Pressable onPress={() => fetchNextTicketNumber(ticketStation)}>
                      <Text style={{ color: theme.tint, fontSize: 12, fontWeight: "600" }}>
                        Use next number for this station
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.pillRow}>
                    {(["cash", "qr", "card"] as const).map((m) => {
                      const active = method === m;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => setMethod(m)}
                          style={[
                            styles.pill,
                            { backgroundColor: active ? theme.tint : "transparent", borderColor: active ? theme.tint : theme.border },
                          ]}
                        >
                          <Text style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
                            {m.toUpperCase()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {method === "cash" && (
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
                                  ₱{amt.toLocaleString("en-PH")}
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
                            {peso(change ?? 0)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {errorMsg ? (
                    <Text style={{ color: "#e5484d", fontSize: 13 }}>{errorMsg}</Text>
                  ) : null}

                  <Pressable
                    onPress={handleConfirm}
                    disabled={!canConfirm}
                    style={[styles.confirmBtn, { backgroundColor: canConfirm ? theme.tint : theme.greyText }]}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Text style={styles.confirmText}>
                          {method === "qr" ? "Generate QR" : "Confirm Payment"}
                        </Text>
                        <Text style={styles.confirmTotal}>{totalStr}</Text>
                      </>
                    )}
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </View>
      </View>

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
    </Background>
  );
};

export default BookingOffice;

const styles = StyleSheet.create({
  screen: { flex: 1, gap: 10 },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  grid: { flex: 1, flexDirection: "row", gap: 10 },
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
    alignItems: "center",
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
  cInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Lato",
  },
  stepperGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    width: "47%",
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
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700", fontFamily: "Lato" },
  receiptScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  receiptCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    padding: 28,
    borderRadius: 20,
    borderWidth: 1,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  receiptLabel: { fontSize: 15 },
  receiptValue: { fontSize: 17, fontWeight: "600" },
});
