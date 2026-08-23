import Colors from "@/constants/Colors";
import { Voyage } from "@/types/voyage";
import { apiFetch, API_BASE } from "@/utils/api";
import { Category, CATEGORY_TO_DB } from "@/utils/passengerRules";
import { money, moneyWhole } from "@/utils/currency";
import { quickCashOptions } from "@/utils/payment";
import { FontAwesome } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import SeatAssignModal from "./SeatAssignModal";
import VoyageLegPicker from "./VoyageLegPicker";

// DB-canonical passenger_type (as stored on tickets) → UI category slug, the
// inverse of CATEGORY_TO_DB — needed to price a ticket's existing passenger
// against a newly-picked voyage's per-category fares.
const DB_TO_CATEGORY: Record<string, Category> = Object.fromEntries(
  Object.entries(CATEGORY_TO_DB).map(([k, v]) => [v, k])
) as Record<string, Category>;

export interface RebookableTicket {
  id: number;
  price: number;
  /** Currency the ticket was sold in. A rebook stays on the same route, so the
   *  replacement is priced in the same currency; the backend rejects it if the
   *  fare table says otherwise, since a fare delta across currencies is
   *  meaningless with no conversion. */
  currency: string;
  passenger_type: string; // DB value, e.g. "Adult"
  accommodation_class: string;
  origin: string;
  destination: string;
  /**
   * Departure dates (ISO, ascending) the backend will accept for this ticket:
   * its own departure day, plus the next day when it is on the last sailing of
   * that day. The route is fixed to the ticket's own, so neither is pickable.
   */
  rebook_dates: string[];
  /**
   * The rebooking charge on this ticket. A rebooking is priced exactly like a
   * refund — the same share of the fare paid, off the same departure — so the
   * backend sends one figure that both modals quote. 0.10 of the fare while
   * the sailing is still to leave, 0.40 once it has gone.
   */
  cancellation_fee: number;
  fee_rate: number;
  /** Which side of departure this ticket sits on, and so which rate applies. */
  trip_departed: boolean;
}

interface RebookModalProps {
  visible: boolean;
  ticket: RebookableTicket | null;
  onClose: () => void;
  onSuccess: () => void;
}

// "2026-08-20" → "Thu, 20 Aug". Parsed as local parts, not via Date(iso),
// which would read the bare date as UTC and can land on the previous day.
const labelForDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const RebookModal = ({ visible, ticket, onClose, onSuccess }: RebookModalProps) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  // Route is fixed to the ticket's own — a rebook moves the passenger between
  // sailings, it can't re-plan the journey — so there is nothing to pick.
  const origin = ticket?.origin ?? "";
  const destination = ticket?.destination ?? "";
  const [date, setDate] = useState("");

  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [loadingVoyages, setLoadingVoyages] = useState(false);
  const [voyageId, setVoyageId] = useState<number | null>(null);
  const [selectedClass, setSelectedClass] = useState("");
  const [seat, setSeat] = useState<string | null>(null);
  const [seatModalVisible, setSeatModalVisible] = useState(false);

  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the ticket each time the modal opens. The ticket's own
  // departure day is the default (and often the only) allowed date.
  useEffect(() => {
    if (visible && ticket) {
      setDate(ticket.rebook_dates[0] ?? "");
      setVoyageId(null);
      setSelectedClass("");
      setSeat(null);
      setMethod("cash");
      setTendered("");
      setError(null);
    }
  }, [visible, ticket]);

  useEffect(() => {
    if (!origin || !destination || !date) {
      setVoyages([]);
      return;
    }
    setLoadingVoyages(true);
    fetch(
      `${API_BASE}/api/v1/voyages/available_seats/${encodeURIComponent(origin)}/${encodeURIComponent(destination)}/${date}`
    )
      .then((r) => r.json())
      .then((data: Record<string, Voyage>) => setVoyages(Object.values(data)))
      .catch(console.error)
      .finally(() => setLoadingVoyages(false));
    setVoyageId(null);
    setSelectedClass("");
    setSeat(null);
  }, [origin, destination, date]);

  const voyage = voyages.find((v) => v.voyage_id === voyageId);

  const newFare = useMemo(() => {
    if (!voyage || !selectedClass || !ticket) return null;
    const cls = voyage.class_name?.[selectedClass];
    if (!cls) return null;
    const category = DB_TO_CATEGORY[ticket.passenger_type];
    const t = cls.ticket_type.find((x) => x.type === category);
    return t ? t.price : null;
  }, [voyage, selectedClass, ticket]);

  const delta = newFare != null && ticket ? Math.round((newFare - ticket.price) * 100) / 100 : null;
  const owesMore = (delta ?? 0) > 0.01;

  // A rebooking is never free: the fee is owed whichever sailing is picked.
  // A *cheaper* new sailing is not netted off it — the backend leaves that
  // credit to a separate partial refund on the new ticket — so only a genuine
  // upgrade adds to what the counter collects today.
  const rebookFee = ticket?.cancellation_fee ?? 0;
  const amountDue = Math.round((Math.max(delta ?? 0, 0) + rebookFee) * 100) / 100;
  const owesPayment = amountDue > 0.01;

  const tenderedNum = parseFloat(tendered) || 0;
  const change = method === "cash" && owesPayment ? tenderedNum - amountDue : null;
  const quickTenders = owesPayment ? quickCashOptions(amountDue) : [];

  const paymentOk = !owesPayment || (method === "cash" ? tenderedNum >= amountDue : method === "card");

  const canConfirm = !!ticket && !!voyageId && !!selectedClass && !!seat && paymentOk && !submitting;

  const handleConfirm = async () => {
    if (!ticket || !canConfirm || !voyage) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/office/tickets/${ticket.id}/rebook`, {
        method: "POST",
        body: JSON.stringify({
          new_trip: {
            schedule_id: voyageId,
            date: `${date}T${voyage.departure_time || "00:00:00"}`,
            accommodation_class: selectedClass,
            seat_number: seat,
          },
          payment: owesPayment ? { method, tendered: method === "cash" ? tenderedNum : undefined } : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.detail || "Rebooking failed. Please try again.");
        return;
      }
      onSuccess();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ticket) return null;

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <View style={[styles.header, { borderBottomColor: theme.greyText + "33" }]}>
            <Text style={[styles.title, { color: theme.text }]}>Rebook ticket</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <FontAwesome name="close" size={20} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text style={[styles.subtitle, { color: theme.greyText }]}>
              Currently {ticket.accommodation_class} · {ticket.origin} → {ticket.destination} · {money(ticket.price, ticket.currency)}
            </Text>

            <View style={[styles.policyBox, { borderColor: theme.border }]}>
              <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>
                {origin} → {destination}
              </Text>
              <Text style={{ color: theme.greyText, fontSize: 12 }}>
                {ticket.rebook_dates.length > 1
                  ? "Last sailing of the day — this ticket may move to another sailing today or tomorrow, same route."
                  : "Rebooking stays on the same route and the same departure day."}
              </Text>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={[styles.fieldLabel, { color: theme.greyText }]}>NEW DEPARTURE DATE</Text>
              <View style={styles.pillRow}>
                {ticket.rebook_dates.map((d) => {
                  const active = date === d;
                  return (
                    <Pressable
                      key={d}
                      onPress={() => setDate(d)}
                      style={[
                        styles.pill,
                        { backgroundColor: active ? theme.tint : "transparent", borderColor: active ? theme.tint : theme.border },
                      ]}
                    >
                      <Text style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "700" }}>
                        {labelForDate(d)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <VoyageLegPicker
              theme={theme}
              label="Voyage"
              loading={loadingVoyages}
              voyages={voyages}
              selectedId={voyageId}
              onSelectVoyage={(id) => {
                setVoyageId(id);
                setSelectedClass("");
                setSeat(null);
              }}
              selectedClass={selectedClass}
              onSelectClass={(c) => {
                setSelectedClass(c);
                setSeat(null);
              }}
              seatPax={1}
              seats={seat ? [seat] : []}
              onEditSeats={() => setSeatModalVisible(true)}
            />

            {newFare != null && delta != null && (
              <View style={[styles.fareBox, { borderColor: theme.border }]}>
                <Text style={{ color: theme.greyText, fontSize: 12 }}>
                  New fare {money(newFare, ticket.currency)} vs. current{" "}
                  {money(ticket.price, ticket.currency)}
                </Text>
                <Text style={{ color: theme.greyText, fontSize: 12 }}>
                  Rebooking fee ({Math.round(ticket.fee_rate * 100)}%){" "}
                  {money(rebookFee, ticket.currency)}
                  {owesMore ? ` + ${money(delta, ticket.currency)} fare difference` : ""}
                </Text>
                <Text style={{ color: owesPayment ? "#e5484d" : "#2e9e5b", fontSize: 15, fontWeight: "800" }}>
                  {owesPayment
                    ? `Payment due: ${money(amountDue, ticket.currency)}`
                    : "No payment due"}
                </Text>
                <Text style={{ color: theme.greyText, fontSize: 11.5, lineHeight: 16 }}>
                  {ticket.trip_departed
                    ? "This sailing has already departed, so the higher rate applies."
                    : "This sailing has not departed yet."}
                </Text>
                {delta != null && delta < -0.01 && (
                  <Text style={{ color: theme.greyText, fontSize: 11.5, lineHeight: 16 }}>
                    The cheaper fare is not deducted here — refund the{" "}
                    {money(Math.abs(delta), ticket.currency)} difference on the new ticket
                    once this rebooking is done.
                  </Text>
                )}
              </View>
            )}

            {owesPayment && (
              <View style={{ gap: 8 }}>
                <View style={styles.pillRow}>
                  {(["cash", "card"] as const).map((m) => {
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
                                {moneyWhole(amt, ticket.currency)}
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
                          {money(change ?? 0, ticket.currency)}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: theme.greyText + "33" }]}>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm}
              style={[styles.confirmBtn, { backgroundColor: canConfirm ? theme.tint : theme.greyText }]}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Confirm Rebook</Text>}
            </Pressable>
          </View>
        </View>
      </View>

      <SeatAssignModal
        visible={seatModalVisible}
        seatMap={voyage?.seat_map ?? null}
        className={selectedClass}
        unavailableSeats={voyage?.unavailable_seats || []}
        seatGenders={voyage?.seat_genders}
        maxSeats={1}
        initialSelected={seat ? [seat] : []}
        title="Choose the new seat"
        onConfirm={(seats) => {
          setSeat(seats[0] ?? null);
          setSeatModalVisible(false);
        }}
        onClose={() => setSeatModalVisible(false)}
      />
    </Modal>
  );
};

export default RebookModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "90%", borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 18,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: "800", fontFamily: "Lato" },
  body: { padding: 18, gap: 14 },
  subtitle: { fontSize: 13, fontFamily: "Lato" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: "Lato",
    // On web a bare <input> keeps `min-width: auto`, so it refuses to shrink
    // below its ~20-character intrinsic width and starves whatever shares the
    // row with it. Views get min-width:0 from react-native-web; inputs ask.
    minWidth: 0,
  },
  fareBox: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  policyBox: { borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  pillRow: { flexDirection: "row", gap: 8 },
  pill: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, alignItems: "center" },
  quickCashRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  quickCashBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  errorText: { color: "#e5484d", fontSize: 13 },
  footer: { padding: 16, borderTopWidth: 1 },
  confirmBtn: { paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  confirmText: { color: "#fff", fontSize: 15, fontWeight: "800", fontFamily: "Lato" },
});
