import Background from "@/components/Background";
import CustomCalendar from "@/components/CustomCalendar";
import WholeCard from "@/components/WholeCard";
import Colors from "@/constants/Colors";
import { useAuth } from "@/context/AuthContext";
import { useLayout } from "@/hooks/useLayout";
import {
  Manifest,
  ManifestTrip,
  ZReport,
} from "@/types/reports";
import { apiFetch } from "@/utils/api";
import { money } from "@/utils/currency";
import { printManifest } from "@/utils/manifestDoc";
import { seatNumberLabel } from "@/utils/seatLabel";
import { printZReport } from "@/utils/zreportDoc";
import { FontAwesome } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

/**
 * Reports — the two documents a counter produces away from the selling screen.
 *
 * "End of day" is the cashier's own Z-report for a till shift: what they took,
 * broken down by tender and currency, reconciled against the drawer they
 * counted. The shift is the period rather than the calendar day because that
 * is the window the drawer agrees with.
 *
 * "Passenger manifest" is the sailing's passenger list, for the vessel and the
 * port.
 *
 * Both print A4 through the browser. Each is a grid that gets signed and filed
 * — the report with the day's cash, the manifest with the sailing — and neither
 * survives being folded into 80mm of till roll.
 */

type Section = "eod" | "manifest";

/** A row from GET /api/v1/office/shifts, trimmed to what the picker shows. */
interface ShiftRow {
  id: number;
  agent_id: number;
  agent_name: string;
  opened_at: string | null;
  closed_at: string | null;
  status: string;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const formatWhen = (value: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatTimeOnly = (value: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  });
};

/** How many passengers the on-screen manifest previews. The printed document
 *  carries everyone; this is only here to prove the right sailing was picked
 *  without scrolling a 200-row table on a counter monitor. */
const PREVIEW_ROWS = 12;

const Reports = () => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;
  const { compact } = useLayout();
  const { agent } = useAuth();

  const [section, setSection] = useState<Section>("eod");

  // ── End of day ────────────────────────────────────────────────────────────
  const [report, setReport] = useState<ZReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  // null = "whichever shift the server picks": the open one, else the last
  // closed one. That is what a cashier wants either side of counting the till.
  const [shiftId, setShiftId] = useState<number | null>(null);
  const [printMsg, setPrintMsg] =
    useState<{ ok: boolean; text: string } | null>(null);

  const loadReport = useCallback(async (id: number | null) => {
    setReportLoading(true);
    setReportError(null);
    setPrintMsg(null);
    try {
      const query = id === null ? "" : `?shift_id=${id}`;
      const res = await apiFetch(`/api/v1/office/reports/z-report${query}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Could not load the report.");
      setReport(data as ZReport);
    } catch (e: any) {
      setReport(null);
      setReportError(e?.message ?? "Could not reach the server.");
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport(shiftId);
  }, [loadReport, shiftId]);

  // Earlier shifts, so a report can be reprinted after the fact. The server
  // scopes this to the caller unless they are an admin, in which case it lists
  // every counter's and the picker doubles as the "whose report?" control.
  useEffect(() => {
    apiFetch("/api/v1/office/shifts?page_size=15")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setShifts(Array.isArray(d.items) ? d.items : []))
      .catch(() => setShifts([]));
  }, []);

  const printReport = () => {
    if (!report) return;
    setPrintMsg(null);
    const result = printZReport(report);
    setPrintMsg(
      result.ok
        ? { ok: true, text: "Opening the print dialog…" }
        : { ok: false, text: result.error ?? "Could not print." }
    );
  };

  // ── Manifest ──────────────────────────────────────────────────────────────
  const [manifestDate, setManifestDate] = useState(iso(new Date()));
  const [trips, setTrips] = useState<ManifestTrip[]>([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripId, setTripId] = useState<number | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestMsg, setManifestMsg] =
    useState<{ ok: boolean; text: string } | null>(null);

  /** Changing the day invalidates whatever sailing was chosen on the old one,
   *  so the selection is cleared here rather than in the fetch effect. */
  const pickManifestDate = (date: string) => {
    setTripId(null);
    setManifest(null);
    setManifestMsg(null);
    setManifestDate(date);
  };

  useEffect(() => {
    if (section !== "manifest") return;
    setTripsLoading(true);
    setManifestError(null);
    apiFetch(`/api/v1/office/manifest/trips?date=${manifestDate}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.detail || "Could not load sailings.");
        return data;
      })
      .then((d) => setTrips(Array.isArray(d.trips) ? d.trips : []))
      .catch((e) => {
        setTrips([]);
        setManifestError(e?.message ?? "Could not reach the server.");
      })
      .finally(() => setTripsLoading(false));
  }, [section, manifestDate]);

  const openManifest = async (trip: ManifestTrip) => {
    setTripId(trip.trip_id);
    setManifestLoading(true);
    setManifestError(null);
    setManifestMsg(null);
    setManifest(null);
    try {
      const res = await apiFetch(`/api/v1/office/trips/${trip.trip_id}/manifest`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Could not load the manifest.");
      setManifest(data as Manifest);
    } catch (e: any) {
      setManifestError(e?.message ?? "Could not reach the server.");
    } finally {
      setManifestLoading(false);
    }
  };

  const doPrintManifest = () => {
    if (!manifest) return;
    const result = printManifest(manifest);
    setManifestMsg(
      result.ok
        ? { ok: true, text: "Opening the print dialog…" }
        : { ok: false, text: result.error ?? "Could not print." }
    );
  };

  // ── Shared bits ───────────────────────────────────────────────────────────
  const chip = (
    label: string,
    active: boolean,
    onPress: () => void,
    key?: string
  ) => (
    <Pressable
      key={key ?? label}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.tint : "transparent",
          borderColor: active ? theme.tint : theme.border,
        },
      ]}
    >
      <Text
        style={{
          color: active ? "#fff" : theme.text,
          fontSize: 13,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  const detail = (label: string, value: string, strong = false) => (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: theme.greyText }]}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          { color: theme.text, fontWeight: strong ? "800" : "600" },
        ]}
      >
        {value}
      </Text>
    </View>
  );

  const message = (msg: { ok: boolean; text: string } | null) =>
    msg ? (
      <Text
        style={{
          color: msg.ok ? "#2e9e5b" : "#e5484d",
          fontSize: 13,
          marginTop: 10,
        }}
      >
        {msg.text}
      </Text>
    ) : null;

  return (
    <Background>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ zIndex: 30 }}>
          <WholeCard header="Reports" spacer={{ height: 14 }}>
            <Text style={{ color: theme.greyText, fontSize: 13, marginBottom: 12 }}>
              Your end-of-day sales report for a till shift, and the passenger
              manifest for a sailing.
            </Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {chip("End of day sales", section === "eod", () => setSection("eod"), "eod")}
              {chip(
                "Passenger manifest",
                section === "manifest",
                () => setSection("manifest"),
                "manifest"
              )}
            </View>
          </WholeCard>
        </View>

        {section === "eod" ? (
          <>
            <View style={{ zIndex: 20 }}>
              <WholeCard header="Which shift" spacer={{ height: 12 }}>
                <Text style={{ color: theme.greyText, fontSize: 13, marginBottom: 10 }}>
                  {agent?.role === "admin"
                    ? "Your current shift by default. Pick any counter's shift to pull their report."
                    : "Your current shift by default. Pick an earlier one to reprint its report."}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {chip("Current shift", shiftId === null, () => setShiftId(null), "current")}
                  {shifts.map((s) =>
                    chip(
                      `#${s.id} · ${
                        agent?.role === "admin" ? `${s.agent_name} · ` : ""
                      }${formatWhen(s.opened_at)}${s.status === "open" ? " · open" : ""}`,
                      shiftId === s.id,
                      () => setShiftId(s.id),
                      `s-${s.id}`
                    )
                  )}
                </View>
              </WholeCard>
            </View>

            {reportLoading ? (
              <ActivityIndicator size="large" color={theme.tint} style={{ marginTop: 30 }} />
            ) : reportError ? (
              <WholeCard spacer={{ height: 4 }}>
                <Text style={styles.error}>{reportError}</Text>
              </WholeCard>
            ) : report ? (
              <>
                <WholeCard header="End of Day Sales" spacer={{ height: 12 }}>
                  <View style={{ gap: 4 }}>
                    {detail("Cashier", report.agent.name)}
                    {detail("Station", report.agent.ticket_station || "Unassigned")}
                    {detail("Shift", `#${report.shift.id}`)}
                    {detail("Opened", formatWhen(report.shift.opened_at))}
                    {detail(
                      "Closed",
                      report.shift.status === "closed"
                        ? formatWhen(report.shift.closed_at)
                        : "Still open"
                    )}
                  </View>

                  {report.shift.status === "open" && (
                    // A mid-shift reading is legitimate, but it is not the
                    // document that gets filed with the counted cash.
                    <View
                      style={[
                        styles.notice,
                        { borderColor: theme.border, backgroundColor: theme.control },
                      ]}
                    >
                      <FontAwesome name="info-circle" size={14} color={theme.tint} />
                      <Text style={{ color: theme.text, fontSize: 12.5, flex: 1 }}>
                        This shift is still open, so the drawer has not been counted
                        yet. Printing now gives an X-reading; close the till for the
                        final Z-report.
                      </Text>
                    </View>
                  )}

                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={printReport}
                      style={[styles.button, { backgroundColor: theme.tint }]}
                    >
                      <View style={styles.buttonInner}>
                        <FontAwesome name="print" size={15} color="#fff" />
                        <Text style={styles.buttonText}>Print report (A4)</Text>
                      </View>
                    </Pressable>
                  </View>
                  {Platform.OS !== "web" && (
                    <Text style={{ color: theme.greyText, fontSize: 12.5, marginTop: 8 }}>
                      The report prints from the browser at the counter — the figures
                      below are the full record on this device.
                    </Text>
                  )}
                  {message(printMsg)}
                </WholeCard>

                {report.totals.length === 0 ? (
                  <WholeCard spacer={{ height: 4 }}>
                    <Text style={{ color: theme.greyText, textAlign: "center" }}>
                      No sales on this shift yet.
                    </Text>
                  </WholeCard>
                ) : (
                  report.totals.map((t) => (
                    <WholeCard
                      key={t.currency}
                      header={`Sales — ${t.currency}`}
                      spacer={{ height: 12 }}
                    >
                      <View style={styles.kpiRow}>
                        <View
                          style={[
                            styles.kpi,
                            { backgroundColor: theme.cardBackground, borderColor: theme.border },
                          ]}
                        >
                          <Text style={[styles.kpiValue, { color: theme.text }]}>
                            {money(t.net, t.currency)}
                          </Text>
                          <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                            Net sales
                          </Text>
                          <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                            Ticket sales {money(t.gross, t.currency)}
                            {t.cancelled > 0
                              ? ` · Cancels ${money(t.cancelled, t.currency)}`
                              : ""}
                            {t.refunded > 0
                              ? ` · Refunds ${money(t.refunded, t.currency)}`
                              : ""}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.kpi,
                            { backgroundColor: theme.cardBackground, borderColor: theme.border },
                          ]}
                        >
                          <Text style={[styles.kpiValue, { color: theme.text }]}>
                            {t.tickets}
                          </Text>
                          <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                            Passengers ticketed · {t.bookings}{" "}
                            {t.bookings === 1 ? "sale" : "sales"}
                          </Text>
                          <Text style={[styles.kpiLabel, { color: theme.greyText }]}>
                            {Object.entries(t.by_passenger_type)
                              .map(([type, count]) => `${type} ${count}`)
                              .join(" · ") || "—"}
                          </Text>
                        </View>
                      </View>

                      {/* Each tender totalled on its own — cash reconciles
                          against the drawer, card and QR PH against the
                          gateway, and one combined figure answers neither. */}
                      <View style={{ gap: 10, marginTop: 16 }}>
                        {t.tenders.map((tender) => (
                          <View
                            key={tender.method}
                            style={[styles.tender, { borderColor: theme.border }]}
                          >
                            <View style={styles.detailRow}>
                              <Text
                                style={{
                                  color: theme.text,
                                  fontSize: 14,
                                  fontWeight: "800",
                                  letterSpacing: 0.4,
                                }}
                              >
                                {tender.label.toUpperCase()}
                              </Text>
                              <Text
                                style={{ color: theme.text, fontSize: 15, fontWeight: "800" }}
                              >
                                {money(tender.net, t.currency)}
                              </Text>
                            </View>
                            <Text style={{ color: theme.greyText, fontSize: 12.5 }}>
                              {tender.bookings} {tender.bookings === 1 ? "sale" : "sales"}
                              {tender.refunded > 0 || tender.cancelled > 0
                                ? ` · gross ${money(tender.gross, t.currency)}`
                                : ""}
                              {tender.cancelled > 0
                                ? ` · ${tender.cancels} voided ${money(
                                    tender.cancelled,
                                    t.currency
                                  )}`
                                : ""}
                              {tender.refunded > 0
                                ? ` · ${tender.refunds} refunded ${money(
                                    tender.refunded,
                                    t.currency
                                  )}`
                                : ""}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </WholeCard>
                  ))
                )}

                {report.drawer.map((d) => (
                  <WholeCard
                    key={d.currency}
                    header={`Drawer — ${d.currency}`}
                    spacer={{ height: 12 }}
                  >
                    <View style={{ gap: 4 }}>
                      {detail("Opening float", money(d.opening_float, d.currency))}
                      {detail("Cash sales", money(d.cash_sales, d.currency))}
                      {d.cash_payouts > 0 &&
                        detail(
                          "Less cash paid out",
                          `−${money(d.cash_payouts, d.currency)}`
                        )}
                      {detail("Expected in drawer", money(d.expected_cash, d.currency), true)}
                      {d.counted_cash !== null ? (
                        <>
                          {detail("Counted", money(d.counted_cash, d.currency))}
                          <View style={styles.detailRow}>
                            <Text style={[styles.detailLabel, { color: theme.greyText }]}>
                              Variance
                            </Text>
                            <Text
                              style={[
                                styles.detailValue,
                                {
                                  color: (d.variance ?? 0) === 0 ? "#2e9e5b" : "#e5484d",
                                  fontWeight: "800",
                                },
                              ]}
                            >
                              {(d.variance ?? 0) > 0 ? "+" : ""}
                              {money(d.variance ?? 0, d.currency)}
                            </Text>
                          </View>
                        </>
                      ) : (
                        <Text style={{ color: theme.greyText, fontSize: 13, marginTop: 4 }}>
                          Not counted yet — close the till to reconcile.
                        </Text>
                      )}
                    </View>

                    {d.cash_payouts > 0 && (
                      <View
                        style={[
                          styles.notice,
                          { borderColor: theme.border, backgroundColor: theme.control },
                        ]}
                      >
                        <FontAwesome name="info-circle" size={14} color={theme.tint} />
                        <Text style={{ color: theme.text, fontSize: 12.5, flex: 1 }}>
                          {money(d.cash_payouts, d.currency)} left the drawer this shift as
                          cash refunds and voided cash sales. It is already deducted above,
                          so the expected figure is what the drawer should actually hold.
                        </Text>
                      </View>
                    )}
                  </WholeCard>
                ))}

                <WholeCard header="Tickets Issued" spacer={{ height: 12 }}>
                  <View style={{ gap: 4 }}>
                    {detail("Count", String(report.tickets_issued), true)}
                    {detail("First serial", report.serial_from ?? "—")}
                    {detail("Last serial", report.serial_to ?? "—")}
                  </View>
                </WholeCard>

                {report.voyages.length > 0 && (
                  <WholeCard header="Sailings Sold" spacer={{ height: 12 }}>
                    <View style={{ gap: 10 }}>
                      {report.voyages.map((v) => (
                        <View
                          key={v.trip_id}
                          style={[styles.row, { borderColor: theme.border }]}
                        >
                          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 14 }}>
                            {v.vessel}
                          </Text>
                          <Text style={{ color: theme.greyText, fontSize: 12.5 }}>
                            {v.route} · {formatWhen(v.scheduled_departure)}
                          </Text>
                          <Text style={{ color: theme.text, fontSize: 13, marginTop: 4 }}>
                            {v.amounts
                              .map(
                                (a) =>
                                  `${a.passengers} pax · ${money(a.amount, a.currency)}`
                              )
                              .join("   ")}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </WholeCard>
                )}
              </>
            ) : null}
          </>
        ) : (
          <>
            <View style={{ zIndex: 20 }}>
              <WholeCard header="Which sailing" spacer={{ height: 12 }}>
                <Text style={{ color: theme.greyText, fontSize: 13, marginBottom: 10 }}>
                  Pick the departure date, then the sailing whose manifest you need.
                </Text>
                <View style={{ maxWidth: 320, zIndex: 20 }}>
                  <CustomCalendar
                    key={`manifest-${manifestDate}`}
                    label="Departure date"
                    defaultDate={manifestDate}
                    onDateSelect={pickManifestDate}
                  />
                </View>

                {tripsLoading ? (
                  <ActivityIndicator color={theme.tint} style={{ marginTop: 16 }} />
                ) : trips.length === 0 ? (
                  <Text style={{ color: theme.greyText, fontSize: 13, marginTop: 14 }}>
                    No sailings scheduled on this date.
                  </Text>
                ) : (
                  <View style={{ gap: 8, marginTop: 14 }}>
                    {trips.map((t) => {
                      const active = tripId === t.trip_id;
                      return (
                        <Pressable
                          key={t.trip_id}
                          onPress={() => openManifest(t)}
                          style={[
                            styles.tripOption,
                            {
                              borderColor: active ? theme.tint : theme.border,
                              backgroundColor: active ? theme.tint + "14" : "transparent",
                            },
                          ]}
                        >
                          <FontAwesome
                            name={active ? "dot-circle-o" : "circle-o"}
                            size={15}
                            color={active ? theme.tint : theme.greyText}
                          />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text
                              style={{ color: theme.text, fontWeight: "700", fontSize: 14 }}
                              numberOfLines={1}
                            >
                              {t.vessel}
                            </Text>
                            <Text style={{ color: theme.greyText, fontSize: 12.5 }}>
                              {t.route}
                            </Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}>
                              {formatTimeOnly(t.scheduled_departure)}
                            </Text>
                            <Text style={{ color: theme.greyText, fontSize: 12 }}>
                              {t.passengers} pax
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {manifestError ? <Text style={styles.error}>{manifestError}</Text> : null}
              </WholeCard>
            </View>

            {manifestLoading ? (
              <ActivityIndicator size="large" color={theme.tint} style={{ marginTop: 30 }} />
            ) : manifest ? (
              <WholeCard header="Passenger Manifest" spacer={{ height: 12 }}>
                <View style={{ gap: 4 }}>
                  {detail("Vessel", manifest.vessel)}
                  {detail("Route", `${manifest.origin} → ${manifest.destination}`)}
                  {detail("Departure", formatWhen(manifest.scheduled_departure))}
                  {detail("Total passengers", String(manifest.total), true)}
                  {detail(
                    "By class",
                    manifest.by_class
                      .map((c) => `${c.accommodation_class} ${c.passengers}`)
                      .join(" · ") || "—"
                  )}
                  {detail(
                    "By sex",
                    manifest.by_gender
                      .map((g) => `${g.gender} ${g.passengers}`)
                      .join(" · ") || "—"
                  )}
                  {manifest.minors > 0 && detail("Minors under 18", String(manifest.minors))}
                  {manifest.boarded > 0 &&
                    detail("Boarded at gate", `${manifest.boarded} of ${manifest.total}`)}
                </View>

                <View style={styles.actionRow}>
                  <Pressable
                    onPress={doPrintManifest}
                    disabled={manifest.total === 0}
                    style={[
                      styles.button,
                      {
                        backgroundColor: theme.tint,
                        opacity: manifest.total === 0 ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View style={styles.buttonInner}>
                      <FontAwesome name="print" size={15} color="#fff" />
                      <Text style={styles.buttonText}>Print manifest (A4)</Text>
                    </View>
                  </Pressable>
                </View>
                {Platform.OS !== "web" && (
                  <Text style={{ color: theme.greyText, fontSize: 12.5, marginTop: 8 }}>
                    The manifest prints from the browser at the counter — the list below
                    is the full record on this device.
                  </Text>
                )}
                {message(manifestMsg)}

                {manifest.passengers.length > 0 && (
                  <View style={{ marginTop: 16, gap: 6 }}>
                    <Text
                      style={{
                        color: theme.greyText,
                        fontSize: 12,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                      }}
                    >
                      {manifest.passengers.length > PREVIEW_ROWS
                        ? `First ${PREVIEW_ROWS} of ${manifest.total} — the printed manifest carries everyone`
                        : "Passengers"}
                    </Text>
                    {manifest.passengers.slice(0, PREVIEW_ROWS).map((p, i) => (
                      <View
                        key={p.ticket_id}
                        style={[styles.paxRow, { borderColor: theme.border }]}
                      >
                        <Text style={{ color: theme.greyText, fontSize: 12, width: 26 }}>
                          {i + 1}
                        </Text>
                        <Text
                          style={{
                            color: theme.text,
                            fontSize: 13,
                            fontWeight: "600",
                            flex: 1,
                            minWidth: compact ? 120 : 180,
                          }}
                          numberOfLines={1}
                        >
                          {p.passenger_name}
                        </Text>
                        <Text style={{ color: theme.greyText, fontSize: 12 }}>
                          {p.age ?? "—"}/{(p.gender ?? "—").charAt(0)}
                        </Text>
                        <Text style={{ color: theme.greyText, fontSize: 12 }}>
                          {p.accommodation_class}
                        </Text>
                        <Text style={{ color: theme.text, fontSize: 12 }}>
                          {seatNumberLabel(p.seat_number)}
                        </Text>
                        <Text style={{ color: theme.greyText, fontSize: 12 }} numberOfLines={1}>
                          {p.contact ?? "—"}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </WholeCard>
            ) : null}
          </>
        )}

        <View style={{ height: 50 }} />
      </ScrollView>

    </Background>
  );
};

export default Reports;

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  error: { color: "#e5484d", fontFamily: "Lato", fontSize: 13, marginTop: 12 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
  },
  detailLabel: { fontSize: 13, flexShrink: 1 },
  detailValue: { fontSize: 13.5, textAlign: "right", flexShrink: 1 },
  kpiRow: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  kpi: {
    flex: 1,
    minWidth: 220,
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
  },
  kpiValue: { fontSize: 20, fontWeight: "800" },
  kpiLabel: { fontSize: 12 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "center",
    marginTop: 16,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttonText: { color: "#fff", fontFamily: "Lato", fontWeight: "700" },
  row: { borderWidth: 1, borderRadius: 12, padding: 12 },
  tender: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 3 },
  tripOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  paxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
});
