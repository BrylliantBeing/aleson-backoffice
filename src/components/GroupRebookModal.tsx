import Colors from "@/constants/Colors";
import { Voyage } from "@/types/voyage";
import { apiFetch, API_BASE } from "@/utils/api";
import { money, moneyWhole } from "@/utils/currency";
import { Category, CATEGORY_TO_DB, passengerTypeLabel, SEAT_OCCUPYING } from "@/utils/passengerRules";
import {
  Tender,
  TENDERS,
  TENDER_LABELS,
  clampExternalRef,
  externalRefOk,
  externalRefSpec,
  needsExternalRef,
  normaliseExternalRef,
  quickCashOptions,
} from "@/utils/payment";
import { seatNumberLabel } from "@/utils/seatLabel";
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
import TravelDateField from "./TravelDateField";
import VoyageLegPicker from "./VoyageLegPicker";

// DB-canonical passenger_type → UI category slug, the inverse of
// CATEGORY_TO_DB. Needed to price an existing ticket's passenger against a
// newly-picked voyage's per-category fares.
const DB_TO_CATEGORY: Record<string, Category> = Object.fromEntries(
  Object.entries(CATEGORY_TO_DB).map(([k, v]) => [v, k])
) as Record<string, Category>;

/** One passenger of the party being moved. All must be on the same sailing. */
export interface GroupRebookTicket {
  id: number;
  passenger_name: string;
  /** DB-canonical: "Adult", "Infant", "Free Pass", … */
  passenger_type: string;
  price: number;
  currency: string;
  seat_number: string | null;
  /** What this ticket alone is charged to move, from the booking lookup. */
  cancellation_fee: number;
}

interface Props {
  visible: boolean;
  bookingReference: string | null;
  tickets: GroupRebookTicket[];
  origin: string;
  destination: string;
  /** Where the date picker opens — the party's own departure day. */
  defaultDate: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

const occupiesSeat = (dbType: string) =>
  SEAT_OCCUPYING.includes(DB_TO_CATEGORY[dbType] ?? "regular");

const GroupRebookModal: React.FC<Props> = ({
  visible,
  bookingReference,
  tickets,
  origin,
  destination,
  defaultDate,
  onClose,
  onSuccess,
}) => {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme] ?? Colors.light;

  const [date, setDate] = useState("");
  const [voyages, setVoyages] = useState<Voyage[]>([]);
  const [loadingVoyages, setLoadingVoyages] = useState(false);
  const [voyageId, setVoyageId] = useState<number | null>(null);
  const [selectedClass, setSelectedClass] = useState("");
  const [seats, setSeats] = useState<string[]>([]);
  const [seatModalVisible, setSeatModalVisible] = useState(false);

  const [method, setMethod] = useState<Tender>("cash");
  const [tendered, setTendered] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = tickets[0]?.currency ?? "PHP";

  // Seats are picked as a flat list for the passengers that take one, and are
  // handed back out in the same order — a lap infant is skipped rather than
  // counted, exactly as the booking screen does it.
  const seatHolders = useMemo(
    () => tickets.filter((t) => occupiesSeat(t.passenger_type)),
    [tickets]
  );

  useEffect(() => {
    if (visible) {
      setDate(defaultDate ?? "");
      setVoyageId(null);
      setSelectedClass("");
      setSeats([]);
      setMethod("cash");
      setTendered("");
      setExternalRef("");
      setError(null);
    }
  }, [visible, defaultDate]);

  useEffect(() => {
    if (!visible || !origin || !destination || !date) {
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
    setSeats([]);
  }, [visible, origin, destination, date]);

  const voyage = voyages.find((v) => v.voyage_id === voyageId);

  /** What each passenger is charged to move, priced the way the server does. */
  const quotes = useMemo(() => {
    const cls = voyage && selectedClass ? voyage.class_name?.[selectedClass] : null;
    return tickets.map((t) => {
      const category = DB_TO_CATEGORY[t.passenger_type];
      const fare = cls?.ticket_type.find((x) => x.type === category)?.price ?? null;
      const delta = fare != null ? Math.round((fare - t.price) * 100) / 100 : null;
      // A cheaper sailing is a credit, not a discount on the fee — the server
      // takes the same view, and the counter must not quote otherwise.
      const due =
        delta == null
          ? null
          : Math.round((Math.max(delta, 0) + t.cancellation_fee) * 100) / 100;
      return { ticket: t, newFare: fare, delta, due };
    });
  }, [tickets, voyage, selectedClass]);

  const priced = quotes.every((q) => q.due != null);
  const amountDue = priced
    ? Math.round(quotes.reduce((sum, q) => sum + (q.due ?? 0), 0) * 100) / 100
    : 0;
  const owesPayment = priced && amountDue > 0.01;

  const tenderedNum = parseFloat(tendered) || 0;
  const change = method === "cash" && owesPayment ? tenderedNum - amountDue : null;
  const quickTenders = owesPayment ? quickCashOptions(amountDue) : [];

  const needsRef = needsExternalRef(method);
  const refOk = externalRefOk(method, externalRef);
  const refSpec = externalRefSpec(method);
  const paymentOk =
    !owesPayment || (method === "cash" ? tenderedNum >= amountDue : refOk);

  const seatsReady = seats.length === seatHolders.length;
  const canConfirm =
    !!bookingReference && !!voyageId && !!selectedClass && seatsReady && priced &&
    paymentOk && !submitting;

  const handleConfirm = async () => {
    if (!canConfirm || !voyage || !bookingReference) return;
    setSubmitting(true);
    setError(null);
    try {
      // Seats go to the passengers that take one, in order. An infant sends
      // none and does not advance the cursor.
      let si = 0;
      const body = {
        new_trip: {
          schedule_id: voyageId,
          date: `${date}T${voyage.departure_time || "00:00:00"}`,
          accommodation_class: selectedClass,
        },
        moves: tickets.map((t) => ({
          ticket_id: t.id,
          seat_number: occupiesSeat(t.passenger_type) ? seats[si++] ?? null : null,
        })),
        payment: owesPayment
          ? {
              method,
              tendered: method === "cash" ? tenderedNum : undefined,
              external_ref: needsRef ? normaliseExternalRef(externalRef) : null,
            }
          : null,
      };
      const res = await apiFetch(
        `/api/v1/office/bookings/${encodeURIComponent(bookingReference)}/rebook-group`,
        { method: "POST", body: JSON.stringify(body) }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.detail || "Could not move these passengers. Please try again.");
        return;
      }
      onSuccess(
        `${tickets.length} passenger${tickets.length === 1 ? "" : "s"} moved` +
          (data.amount_collected > 0
            ? ` · collected ${money(data.amount_collected, data.currency)}`
            : " · no charge") +
          (data.change != null && data.change > 0
            ? ` · change ${money(data.change, data.currency)}`
            : "")
      );
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!bookingReference || tickets.length === 0) return null;

  const inputStyle = [
    styles.input,
    { borderColor: theme.border, backgroundColor: theme.control, color: theme.text },
  ];

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: theme.background }]}>
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: theme.text }]}>
                  Move {tickets.length} passenger{tickets.length === 1 ? "" : "s"}
                </Text>
                <Text style={{ color: theme.greyText, fontSize: 12.5, marginTop: 2 }}>
                  {origin} → {destination} · booking {bookingReference}
                </Text>
              </View>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <FontAwesome name="close" size={18} color={theme.greyText} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
              {/* The fee is per ticket, and a counter quoting a party needs to
                  be able to say so before the customer asks. */}
              <Text style={{ color: theme.greyText, fontSize: 12.5, lineHeight: 18 }}>
                Each passenger is charged their own rebooking fee, exactly as they
                would be moving alone. Moving together saves the queue, not the fare.
              </Text>

              <TravelDateField label="New departure date" value={date} onChange={setDate} />

              <VoyageLegPicker
                theme={theme}
                label="Voyage"
                loading={loadingVoyages}
                voyages={voyages}
                selectedId={voyageId}
                onSelectVoyage={(id) => {
                  setVoyageId(id);
                  setSelectedClass("");
                  setSeats([]);
                }}
                selectedClass={selectedClass}
                onSelectClass={(c) => {
                  setSelectedClass(c);
                  setSeats([]);
                }}
                seatPax={seatHolders.length}
                seats={seats}
                onEditSeats={() => setSeatModalVisible(true)}
              />

              {/* Who is moving, and what each of them costs. */}
              <View style={{ gap: 8 }}>
                <Text style={[styles.fieldLabel, { color: theme.greyText }]}>PASSENGERS</Text>
                {quotes.map((q, i) => {
                  const holderIndex = seatHolders.findIndex((h) => h.id === q.ticket.id);
                  const newSeat = holderIndex >= 0 ? seats[holderIndex] : null;
                  return (
                    <View
                      key={q.ticket.id}
                      style={[styles.paxRow, { borderColor: theme.border }]}
                    >
                      <View style={{ flex: 1, gap: 2, minWidth: 150 }}>
                        <Text style={{ color: theme.text, fontSize: 13.5, fontWeight: "700" }}>
                          {q.ticket.passenger_name} · {passengerTypeLabel(q.ticket.passenger_type)}
                        </Text>
                        <Text style={{ color: theme.greyText, fontSize: 12 }}>
                          {occupiesSeat(q.ticket.passenger_type)
                            ? `Seat ${seatNumberLabel(q.ticket.seat_number)} → ${
                                newSeat ? seatNumberLabel(newSeat) : "not chosen"
                              }`
                            : "No seat · travels on a lap"}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>
                          {q.due != null ? money(q.due, currency) : "—"}
                        </Text>
                        <Text style={{ color: theme.greyText, fontSize: 11 }}>
                          fee {money(q.ticket.cancellation_fee, currency)}
                          {q.delta != null && q.delta > 0.01
                            ? ` + ${money(q.delta, currency)} fare`
                            : ""}
                          {q.delta != null && q.delta < -0.01 ? " · cheaper sailing" : ""}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              {quotes.some((q) => (q.delta ?? 0) < -0.01) && (
                <Text style={{ color: theme.greyText, fontSize: 12, lineHeight: 17 }}>
                  A cheaper sailing is not deducted here. Move the party first, then
                  refund the difference on the new tickets so each movement of money
                  keeps its own record.
                </Text>
              )}

              <View style={[styles.totalRow, { borderColor: theme.border }]}>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: "700" }}>
                  Total to collect
                </Text>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "800" }}>
                  {priced ? money(amountDue, currency) : "—"}
                </Text>
              </View>

              {owesPayment && (
                <View style={{ gap: 8 }}>
                  <View style={styles.pillRow}>
                    {TENDERS.map((m) => {
                      const active = method === m;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => {
                            setMethod(m);
                            setExternalRef("");
                            setTendered("");
                          }}
                          style={[
                            styles.pill,
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
                            {TENDER_LABELS[m]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {needsRef && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <TextInput
                        style={[
                          inputStyle,
                          { flex: 1, minWidth: 0, letterSpacing: 2, fontWeight: "700" },
                          externalRef.length > 0 && !refOk && { borderColor: "#e5484d" },
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
                        One charge for the whole party. {refSpec?.hint}
                      </Text>
                    </View>
                  )}

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
                                style={[
                                  styles.quickCashBtn,
                                  {
                                    backgroundColor: on ? theme.tint : "transparent",
                                    borderColor: on ? theme.tint : theme.border,
                                  },
                                ]}
                              >
                                <Text
                                  style={{
                                    color: on ? "#fff" : theme.text,
                                    fontSize: 13,
                                    fontWeight: "700",
                                  }}
                                >
                                  {moneyWhole(amt, currency)}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      )}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <TextInput
                          style={[inputStyle, { flex: 1, minWidth: 0 }]}
                          value={tendered}
                          onChangeText={setTendered}
                          placeholder="Tendered"
                          keyboardType="numeric"
                          placeholderTextColor={theme.greyText}
                        />
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={{ color: theme.greyText, fontSize: 10 }}>CHANGE</Text>
                          <Text
                            style={{
                              fontSize: 17,
                              fontWeight: "800",
                              color: (change ?? 0) < 0 ? "#e5484d" : "#2e9e5b",
                            }}
                          >
                            {money(change ?? 0, currency)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {error ? (
                <Text style={{ color: "#e5484d", fontSize: 13, lineHeight: 18 }}>{error}</Text>
              ) : null}

              <Pressable
                onPress={handleConfirm}
                disabled={!canConfirm}
                style={[
                  styles.confirmBtn,
                  { backgroundColor: canConfirm ? theme.tint : theme.greyText },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800" }}>
                    {owesPayment
                      ? `Confirm & collect ${money(amountDue, currency)}`
                      : "Confirm move"}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <SeatAssignModal
        visible={seatModalVisible}
        seatMap={voyage?.seat_map ?? null}
        className={selectedClass}
        unavailableSeats={voyage?.unavailable_seats || []}
        seatGenders={voyage?.seat_genders}
        maxSeats={seatHolders.length}
        initialSelected={seats}
        title={`Choose ${seatHolders.length} new seat${seatHolders.length === 1 ? "" : "s"}`}
        onConfirm={(chosen) => {
          setSeats(chosen);
          setSeatModalVisible(false);
        }}
        onClose={() => setSeatModalVisible(false)}
      />
    </>
  );
};

export default GroupRebookModal;

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { maxHeight: "92%", borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: { fontSize: 18, fontWeight: "800" },
  closeBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  fieldLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  paxRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 12,
  },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  quickCashRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickCashBtn: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  confirmBtn: { borderRadius: 12, alignItems: "center", paddingVertical: 14, marginTop: 4 },
});
